import { describe, expect, it } from "vitest";

import type { TurnFacts } from "../shared/bot-act.ts";
import type { BotActService } from "./bot-act.ts";
import { sagaxInternalTool } from "./sagax-internal-tools.ts";
import { createSettingsActions, settingStepUpClasses, type SettingsActionDeps } from "./settings-actions.ts";

const PERSON: TurnFacts = { automation: false, guest: false, requestUsable: true, senderUnproven: false, provenPerson: "pr_owner", sharedServer: true };

function harness(over: Partial<SettingsActionDeps> & { mode?: "ask" | "auto" | "full"; facts?: TurnFacts; routeStatus?: number; answer?: unknown } = {}) {
  const planned: Array<{ effect: string; path: string; method: string; body?: unknown; stepUpClasses: readonly string[]; primary?: unknown }> = [];
  const audits: unknown[] = [];
  const screens: unknown[] = [];
  const acts = {
    async handlePlanned(input: Parameters<BotActService["handlePlanned"]>[0]) {
      const target = input.target.kind === "route" ? input.target : { method: "UI", path: `ui:${input.target.command}`, body: input.target.input };
      planned.push({ effect: input.plan.effect, path: target.path, method: target.method, body: target.body, stepUpClasses: input.plan.stepUpClasses, ...(input.plan.primary ? { primary: input.plan.primary } : {}) });
      if (target.method === "GET") return { status: 200, body: { text: JSON.stringify(over.answer ?? {}) } };
      if (input.plan.effect === "hold") return { status: 200, body: { held: true, text: "Approval needed." } };
      const status = over.routeStatus ?? 200;
      if (status < 400) input.plan.onDone?.("run");
      return status < 400 ? { status, body: { text: "{}" } } : { status, body: { error: "forbidden: not yours" } };
    },
    async handle() { return { status: 200, body: { held: true, text: "Approval needed." } }; },
  } as unknown as BotActService;
  const service = createSettingsActions({
    organization: () => false,
    facts: () => over.facts ?? PERSON,
    acts: () => acts,
    operatorId: () => "pr_operator",
    botOwner: (id) => (id === "theirs" ? "pr_other" : "pr_owner"),
    botOfThread: (id) => (id === "th1" ? "b1" : null),
    routineBot: (id) => (id === "r1" ? "b1" : id === "r2" ? "theirs" : null),
    groupOwner: () => "pr_owner",
    turnMode: () => over.mode ?? "auto",
    keyRequired: () => [],
    audit: (row) => audits.push(row),
    screen: (_facts, command, input) => { screens.push({ command, input }); return { status: 200, body: { text: "Done." } }; },
    ...over,
  });
  const call = (args: Record<string, unknown>) => service.handle({ args, botId: "b1", threadId: "th1", generation: "g", botName: "Scout", botColor: "#000" });
  return { call, planned, audits, screens };
}

describe("sagax_settings", () => {
  it("Full on the person's own request runs at once and says so to the route (JC 2026-10-20), even for the speaking bot", async () => {
    const primary = { botId: "b1", botName: "Scout", messageId: "m1" };
    const h = harness({ mode: "ask", personAsked: () => ({ message: "Mets-toi en Full.", primary }) });
    const done = await h.call({ action: "set", key: "bot.approvalMode", value: "full", quote: "Mets-toi en Full" });
    expect(String(done.body.text)).toMatch(/^Done.*next message/);
    expect(h.planned).toMatchObject([{ effect: "run", method: "PATCH", path: "/api/bots/b1", body: { approvalMode: "full", confirmFullAccess: true }, primary }]);
    // without the person's words: the card, and no marker
    const card = harness({ mode: "ask" });
    await card.call({ action: "set", key: "bot.approvalMode", value: "full" });
    expect(card.planned[0]).toMatchObject({ effect: "hold" });
    expect(card.planned[0]!.primary).toBeUndefined();
  });

  it("applies the owner's own bot setting at Approve for me, without a card, and records it", async () => {
    const h = harness();
    const result = await h.call({ action: "set", key: "bot.approvalMode", target: "b2", value: "auto" });
    expect(result.body.text).toContain("Done");
    expect(h.planned).toEqual([expect.objectContaining({ effect: "run", method: "PATCH", path: "/api/bots/b2", body: { approvalMode: "auto" } })]);
    expect(h.audits).toEqual([expect.objectContaining({ key: "bot.approvalMode", value: "auto", how: "run", actor: "pr_owner" })]);
  });

  it("applies the managed teams of the owner's Primary Bot and a routine put in their own conversation", async () => {
    const h = harness();
    await h.call({ action: "set", key: "bot.managedSections", value: ["Built-in"] });
    await h.call({ action: "set", key: "routine.thread", target: "r1", value: "th1" });
    expect(h.planned.map((row) => row.effect)).toEqual(["run", "run"]);
    expect(h.planned[1]).toMatchObject({ path: "/api/routines/r1", body: { resultsThreadId: "th1" } });
  });

  it("keeps a card for Full, a deletion, a secret, another person and the organization", async () => {
    const h = harness({ mode: "full" });
    for (const args of [
      { key: "bot.approvalMode", value: "full" },
      { key: "routine.delete", target: "r1", value: true },
      { key: "credentials.item", value: { name: "x", password: "y" } },
      { key: "bot.share", value: { target: "user:pr_x", level: "use" } },
      { key: "org.allowFullAccess", value: true },
    ]) {
      const result = await h.call({ action: "set", ...args });
      expect(result.body.text, args.key).toContain("Approval needed.");
    }
    expect(h.planned.every((row) => row.effect === "hold")).toBe(true);
    expect(h.audits).toEqual([]);
  });

  it("keeps a card at Ask, and for someone else's routine", async () => {
    expect((await harness({ mode: "ask" }).call({ action: "set", key: "bot.name", value: "Owl" })).body.text).toContain("this bot is at Ask");
    expect((await harness().call({ action: "set", key: "routine.enabled", target: "r2", value: false })).body.text).toContain("not the person's own");
  });

  it("asks for the key when the person protects a class of the change", async () => {
    const h = harness({ keyRequired: (_person, classes) => classes.filter((name) => name === "rule-change") });
    expect((await h.call({ action: "set", key: "bot.approvalMode", target: "b2", value: "auto" })).body.text).toContain("security key");
    expect(h.planned[0]!.stepUpClasses).toContain("rule-change");
  });

  it("relays the route's own refusal: a member does not do by bot what they cannot do by hand", async () => {
    const result = await harness({ routeStatus: 403 }).call({ action: "set", key: "bot.name", value: "Owl" });
    expect(result.status).toBe(403);
    expect(result.body.error).toContain("forbidden");
  });

  it("refuses a routine or webhook turn, an unknown key and a value of the wrong kind, with what to do", async () => {
    const h = harness();
    expect((await h.call({ action: "set", key: "bot.nope", value: 1 })).body.error).toContain("action list");
    expect((await h.call({ action: "set", key: "bot.approvalMode", value: "sometimes" })).body.error).toContain("enum:");
    expect((await h.call({ action: "list", family: "routine" })).body.text).toContain("routine.schedule");
  });

  it("reads a setting with the person's rights", async () => {
    const h = harness({ answer: { bots: [{ id: "b1", modelSelection: { model: "m", effort: "low" } }] } });
    const read = await h.call({ action: "get", key: "bot.effort" });
    expect(JSON.parse(String(read.body.text))).toEqual({ key: "bot.effort", value: "low" });
    await h.call({ action: "set", key: "bot.effort", value: "high" });
    expect(h.planned.at(-1)).toMatchObject({ method: "PATCH", body: { modelSelection: { model: "m", effort: "high" } } });
  });

  it("sets a device preference in the person's open app at Approve for me, and asks at Ask", async () => {
    const h = harness();
    await h.call({ action: "set", key: "appearance.skin", value: "night" });
    expect(h.screens).toEqual([{ command: "setPreference", input: { key: "omb-skin", value: "night" } }]);
    expect((await harness({ mode: "ask" }).call({ action: "set", key: "appearance.skin", value: "night" })).body.text).toContain("Approval needed.");
  });

  it("classes the change for the key: a write is irreversible, Full carries every class", () => {
    expect(settingStepUpClasses(["own"], { method: "PATCH", path: "/api/bots/b1" })).toEqual(["irreversible"]);
    expect(settingStepUpClasses(["own"], { method: "PATCH", path: "/api/routines/r1" })).toContain("always-grant");
    expect(settingStepUpClasses(["rule-change"], { method: "PATCH", path: "/api/bots/b1" }, "full").length).toBeGreaterThan(4);
  });

  it("is Sagax's own tool on every engine: the engine's gate never asks twice (Claude, Grok, pi, chat engines)", () => {
    for (const spelling of ["mcp__agents__sagax_settings", "agents__sagax_settings", "agents.sagax_settings", "agents:sagax_settings"]) {
      expect(sagaxInternalTool(spelling), spelling).toBe("agents");
    }
    // a foreign server that spells the same name is not Sagax's
    expect(sagaxInternalTool("mcp__agents__sagax_settings", ["agents"])).toBeNull();
  });

  it("never lets a target or a value name another route", async () => {
    const h = harness();
    for (const target of ["..", ".", "../config", "b1/tasks", "b1%2F..", "a b"]) {
      expect((await h.call({ action: "set", key: "bot.name", target, value: "x" })).status, target).toBe(400);
    }
    expect((await h.call({ action: "set", key: "connections.mcpServerRemove", value: ".." })).status).toBe(400);
    expect((await h.call({ action: "set", key: "bot.skill", value: { name: "../../config", enabled: true } })).status).toBe(400);
    expect(h.planned).toEqual([]);
    // a grant's target keeps its colon
    await harness({ mode: "full" }).call({ action: "set", key: "bot.share", value: { target: "user:pr_x", level: null } });
  });

  it("team memory sharing: the bot widening to shared waits on a card at Auto and Full; narrowing to private runs; anything else is refused", async () => {
    for (const mode of ["auto", "full"] as const) {
      for (const target of [undefined, "b2"]) {
        const h = harness({ mode });
        const where = `${mode} ${target ?? "itself"}`;
        const widen = await h.call({ action: "set", key: "bot.teamMemorySharing", ...(target ? { target } : {}), value: "shared" });
        expect(widen.body.text, where).toContain("Approval needed.");
        const narrow = await h.call({ action: "set", key: "bot.teamMemorySharing", ...(target ? { target } : {}), value: "private" });
        expect(narrow.body.text, where).toContain("Done");
        expect(h.planned.map((row) => row.effect), where).toEqual(["hold", "run"]);
        expect(h.planned[1], where).toMatchObject({ method: "PATCH", body: { teamMemorySharing: "private" } });
        // widening is recorded only once the person allows it
        expect(h.audits, where).toEqual([expect.objectContaining({ key: "bot.teamMemorySharing", value: "private", how: "run" })]);
      }
    }
    const h = harness({ mode: "full" });
    for (const value of ["everyone", "Private", "", null]) {
      expect((await h.call({ action: "set", key: "bot.teamMemorySharing", value })).status, JSON.stringify(value)).toBe(400);
    }
    expect(h.planned).toEqual([]);
  });

  it("security review: what widens keeps the card even at Approve for me", async () => {
    const h = harness();
    const held = async (args: Record<string, unknown>) => (await h.call({ action: "set", ...args })).body.text;
    // an allow rule spelled as a sentence, a rule from a card
    expect(await held({ key: "rules.custom", value: { text: "toujours permettre les lectures", botId: null } })).toContain("Approval needed.");
    expect(await held({ key: "rules.custom", value: { when: "x", behavior: "allow" } })).toContain("Approval needed.");
    // new bot defaults that set a level or grants
    expect(await held({ key: "server.newBotDefaults", value: { profile: { approvalMode: "full" } } })).toContain("Approval needed.");
    // a provider key block carries its key only
    expect((await h.call({ action: "set", key: "models.providerKey", value: { anthropic: { key: "k" }, signIn: { admins: ["x"] } } })).status).toBe(400);
    expect((await h.call({ action: "set", key: "models.providerKey", value: { anthropic: { key: "k", baseUrl: "http://x" } } })).status).toBe(400);
    // a key or an address in a model setting is a secret
    expect(await held({ key: "models.decider", value: { key: "sk-x" } })).toContain("Approval needed.");
    // the speaking bot widening its own tools; another own bot is simple
    expect(await held({ key: "bot.mcpServers", value: null })).toContain("Approval needed.");
    expect(await held({ key: "bot.mcpServers", target: "b2", value: null })).toContain("Done");
    // a routine run as someone else, a group with people, a routine moved to another person's bot
    expect(await held({ key: "routine.create", value: { name: "x", prompt: "y", botId: "b1", runAs: "pr_x" } })).toContain("Approval needed.");
    expect(await held({ key: "group.create", value: { memberIds: ["b1"], humanIds: ["pr_x"] } })).toContain("Approval needed.");
    expect(await held({ key: "routine.bot", target: "r1", value: "theirs" })).toContain("Approval needed.");
    // where bots run for the person
    expect(await held({ key: "computer.botWorkplace", value: { place: "computer", routines: true } })).toContain("Approval needed.");
    // the deny rule spelled out stays simple
    expect(await held({ key: "rules.custom", value: { when: "x", behavior: "deny" } })).toContain("Done");
    // a long value is shown by its keys and fingerprint on the card
    expect(h.planned.some((row) => row.effect === "hold")).toBe(true);
  });
});

describe("askedChange (a Primary Bot's change on the person's words, security review 2026-10-20)", () => {
  it("turns cards off only, with the level, the bot and the rule's own words named", async () => {
    const { askedChange } = await import("./settings-actions.ts");
    expect(askedChange("Mets Katarina en auto", "bot.approvalMode", "auto", "Katarina", false)).toBe(true);
    // security review 2026-10-20: the level and the bot are in the quote itself
    expect(askedChange("Ne mets pas Katarina en Full, mets Zed en Full", "bot.approvalMode", "full", "Katarina", false, undefined, "mets Zed en Full")).toMatch(/Katarina/);
    expect(askedChange("Mets Zed en Full", "bot.approvalMode", "full", undefined, true, undefined, "Mets Zed en Full", "Scout")).toMatch(/itself/);
    expect(askedChange("Mets-toi en Full", "bot.approvalMode", "full", undefined, true, undefined, "Mets-toi en Full", "Scout")).toBe(true);
    expect(askedChange("Mets Katarina en auto", "bot.approvalMode", "full", "Katarina", false)).toMatch(/level full/);
    expect(askedChange("Fais-moi un rapport complet", "bot.approvalMode", "full", "Katarina", false)).not.toBe(true);
    expect(askedChange("Mets-la en auto", "bot.approvalMode", "auto", "Katarina", false)).toMatch(/Katarina/);
    // anything that is not an approval level or a rule keeps its card
    expect(askedChange("Mets Katarina en auto", "bot.title", "x", "Katarina", false)).not.toBe(true);
    expect(askedChange("Mets Katarina en auto", "bot.alwaysAllow", ["Bash"], "Katarina", false)).not.toBe(true);
    // a new rule's words and an exact command are the person's own
    expect(askedChange("Ajoute une note au billet", "rules.custom", { when: "toute commande", behavior: "allow" }, undefined, true)).not.toBe(true);
    expect(askedChange("Toujours permettre la commande npm test pour Katarina", "rules.custom", { when: "la commande npm test", behavior: "allow", botId: "kat" }, undefined, true)).toBe(true);
    // the behavior and "every bot" are said too; a one-word when is no rule
    expect(askedChange("mets une règle qui bloque les paiements", "rules.custom", { when: "les paiements", behavior: "allow" }, undefined, true)).not.toBe(true);
    expect(askedChange("mets une règle qui bloque les paiements par carte", "rules.custom", { when: "les paiements par carte", behavior: "allow", botId: "kat" }, undefined, true)).not.toBe(true);
    expect(askedChange("mets une règle qui bloque les paiements par carte", "rules.custom", { when: "les paiements par carte", behavior: "deny", botId: "kat" }, undefined, true)).toBe(true);
    expect(askedChange("Toujours permettre la commande npm test", "rules.custom", { when: "la commande npm test", behavior: "allow" }, undefined, true)).not.toBe(true);
    expect(askedChange("Toujours permettre la commande npm test pour tous les bots", "rules.custom", { when: "la commande npm test", behavior: "allow" }, undefined, true)).toBe(true);
    expect(askedChange("ajoute tout au rapport", "rules.custom", { when: "tout", behavior: "allow", botId: "kat" }, undefined, true)).not.toBe(true);
    expect(askedChange("Ajoute une note au billet", "rules.commandAllow", { command: "rm -rf /", cwd: "/", providerInstanceId: "claude" }, "Katarina", true)).not.toBe(true);
    // a rule removed is one the message names
    expect(askedChange("Retire la règle", "rules.ownerDelete", true, undefined, true, "Run a command (printf primary-later)")).not.toBe(true);
    expect(askedChange("Retire la règle printf", "rules.ownerDelete", true, undefined, true, "Run a command (printf primary-later)")).not.toBe(true);
    expect(askedChange("Retire la règle printf primary-later", "rules.ownerDelete", true, undefined, true, "Run a command (printf primary-later)")).toBe(true);
  });
});

describe("askedBotChange (the Primary Bot changes the person's bots on their words, 2026-10-20)", () => {
  it("runs a named bot's model, archive and deletion, and refuses what the words do not say", async () => {
    const { askedBotChange } = await import("./settings-actions.ts");
    const order = "Passe SWAT, DOGE, Bot Designer et Disk Saver sur l'instance claudeApi";
    const model = (names: string[], valueNames: string[]) => askedBotChange({ key: "bot.model", family: "bot", value: {}, quote: order, names, speakingBot: false, valueNames });
    for (const name of ["SWAT", "DOGE", "Bot Designer", "Disk Saver"]) expect(model([name], ["claudeApi", "claude-opus"])).toBe(true);
    // a bot or an engine the words do not name
    expect(model(["Katarina"], ["claudeApi"])).toMatch(/Katarina/);
    expect(model(["SWAT"], ["codex"])).toMatch(/engine or model/);
    expect(askedBotChange({ key: "bot.hidden", family: "bot", value: true, quote: "Archive Disk Saver", names: ["Disk Saver"], speakingBot: false })).toBe(true);
    expect(askedBotChange({ key: "bot.hidden", family: "bot", value: true, quote: "Passe Disk Saver sur codex", names: ["Disk Saver"], speakingBot: false })).toMatch(/archive/);
    expect(askedBotChange({ key: "bot.delete", family: "bot", value: true, quote: "Supprime DOGE", names: ["DOGE"], speakingBot: false })).toBe(true);
    expect(askedBotChange({ key: "bot.delete", family: "bot", value: true, quote: "Archive DOGE", names: ["DOGE"], speakingBot: false })).toMatch(/delete/);
    // a new title is the person's own words
    expect(askedBotChange({ key: "bot.title", family: "bot", value: "Night shift", quote: "Renomme le titre de SWAT en Night shift", names: ["SWAT"], speakingBot: false })).toBe(true);
    expect(askedBotChange({ key: "bot.title", family: "bot", value: "Owned", quote: "Renomme SWAT", names: ["SWAT"], speakingBot: false })).toMatch(/new text/);
    // standing grants, sharing and other families keep their card
    expect(askedBotChange({ key: "bot.toolGrant", family: "bot", value: {}, quote: "Mets SWAT", names: ["SWAT"], speakingBot: false })).toMatch(/only/);
    expect(askedBotChange({ key: "account.email", family: "account", value: "x", quote: "Change mon courriel", names: [], speakingBot: true })).toMatch(/only/);
    // security review 2026-10-20: one quote carries one kind of change, a
    // question or a refusal right after it does not ask, a bare "you" is not the bot
    expect(askedBotChange({ key: "bot.persona", family: "bot", value: "x", quote: "change le modèle de Ember", names: ["Ember"], speakingBot: false })).toMatch(/which setting/);
    expect(askedBotChange({ key: "bot.cwd", family: "bot", value: "/", quote: "change le dossier de Ember", names: ["Ember"], speakingBot: false })).toMatch(/only/);
    expect(askedBotChange({ key: "bot.delete", family: "bot", value: true, quote: "supprime Ember", message: "supprime Ember ? non, pas encore", names: ["Ember"], speakingBot: false })).toMatch(/question/);
    expect(askedBotChange({ key: "bot.delete", family: "bot", value: true, quote: "ne supprime pas Ember", names: ["Ember"], speakingBot: false })).toMatch(/refuse/);
    expect(askedBotChange({ key: "routine.create", family: "routine", value: {}, quote: "use the web", names: ["Cryptic"], speakingBot: true, speakingName: "Cryptic" })).toMatch(/itself/);
    expect(askedBotChange({ key: "bot.persona", family: "bot", value: "x", quote: "can you change your tone", names: ["Cryptic"], speakingBot: true, speakingName: "Cryptic" })).toMatch(/itself/);
    // the speaking bot itself: "toi" or its name
    expect(askedBotChange({ key: "bot.effort", family: "bot", value: "high", quote: "mets-toi en effort high", names: ["Cryptic"], speakingBot: true, speakingName: "Cryptic" })).toBe(true);
  });
});
