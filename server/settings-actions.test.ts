import { describe, expect, it } from "vitest";

import type { TurnFacts } from "../shared/bot-act.ts";
import type { BotActService } from "./bots/bot-act.ts";
import { sagaxInternalTool } from "./sagax-internal-tools.ts";
import { SETTINGS } from "../shared/settings-actions.ts";
import { createSettingsActions, finalRefusal, settingStepUpClasses, type SettingsActionDeps } from "./settings-actions.ts";

const PERSON: TurnFacts = { automation: false, guest: false, requestUsable: true, senderUnproven: false, provenPerson: "pr_owner", sharedServer: true };

function harness(over: Partial<SettingsActionDeps> & { mode?: "ask" | "auto" | "full"; facts?: TurnFacts; routeStatus?: number | ((method: string, path: string) => number); answer?: unknown } = {}) {
  const planned: Array<{ effect: string; path: string; method: string; body?: unknown; stepUpClasses: readonly string[]; primary?: unknown; rule?: { scope: Record<string, string> }; noRule?: boolean }> = [];
  const audits: unknown[] = [];
  const screens: unknown[] = [];
  const acts = {
    async handlePlanned(input: Parameters<BotActService["handlePlanned"]>[0]) {
      const target = input.target.kind === "route" ? input.target : { method: "UI", path: `ui:${input.target.command}`, body: input.target.input };
      planned.push({ effect: input.plan.effect, path: target.path, method: target.method, body: target.body, stepUpClasses: input.plan.stepUpClasses, ...(input.plan.primary ? { primary: input.plan.primary } : {}), ...(input.plan.rule ? { rule: input.plan.rule } : {}), ...(input.plan.noRule ? { noRule: true } : {}) });
      const routeStatus = typeof over.routeStatus === "function" ? over.routeStatus(target.method, target.path) : over.routeStatus ?? 200;
      if (target.method === "GET" || input.plan.summary === "Read a setting") {
        if (routeStatus >= 400) return { status: routeStatus, body: { error: "forbidden: not yours" } };
        return { status: 200, body: { text: JSON.stringify(typeof over.answer === "function" ? (over.answer as (path: string) => unknown)(target.path) : over.answer ?? {}) } };
      }
      if (input.plan.effect === "hold") return { status: 200, body: { held: true, text: "Approval needed." } };
      const status = routeStatus;
      if (status < 400) input.plan.onDone?.("run");
      // a device setting's change answers what the person's app now holds
      const written = target.path === "/api/me/device-settings/apply" && over.answer !== undefined ? JSON.stringify(typeof over.answer === "function" ? (over.answer as (path: string) => unknown)(target.path) : over.answer) : "{}";
      return status < 400 ? { status, body: { text: written } } : { status, body: { error: "forbidden: not yours" } };
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
  it("#3480: the person's words set the bot's own quiet mode at once, at Ask too, and the bot says the one line", async () => {
    const planned: Array<{ effect: string; method: string; path: string; body?: unknown }> = [];
    const said = "Done: I am staying quiet and will reach you only when I need your answer.";
    const acts = {
      async handlePlanned(input: Parameters<BotActService["handlePlanned"]>[0]) {
        const target = input.target as { method: string; path: string; body?: unknown };
        planned.push({ effect: input.plan.effect, method: target.method, path: target.path, body: target.body });
        return { status: 200, body: { text: JSON.stringify({ botId: "b1", quiet: true, said }) } };
      },
    } as unknown as BotActService;
    const h = harness({ mode: "ask", acts: () => acts, ownWords: () => null });
    const done = await h.call({ action: "set", key: "bot.quietMode", value: true });
    expect(planned).toEqual([{ effect: "run", method: "PUT", path: "/api/bots/b1/quiet", body: { on: true, via: "words" } }]);
    expect(String(done.body.text)).toBe(`Done: Quiet mode for this bot changed. Tell the person this one line, then end your turn: ${said}`);
    await h.call({ action: "set", key: "notifications.quietMode", value: false });
    expect(planned[1]).toEqual({ effect: "run", method: "PUT", path: "/api/me/quiet", body: { on: false, via: "words" } });
  });

  it("#3480: on a routine, wake or peer turn quiet mode is refused in one line and nothing is shown", async () => {
    for (const key of ["bot.quietMode", "notifications.quietMode"]) {
      const h = harness({ mode: "full", ownWords: () => "This turn is not the person's own message (a routine, a webhook, another bot or someone else): it answers no card." });
      const refused = await h.call({ action: "set", key, value: true });
      expect(refused.status).toBe(403);
      expect(String(refused.body.error ?? refused.body.text)).toMatch(/^Quiet mode changes only when your person tells you so in their own message.*not changed\..*Do not retry; say nothing about it\.$/);
      expect(h.planned).toEqual([]);
      expect(h.audits).toEqual([]);
      // without a way to tell, never
      const none = harness({ mode: "full" });
      expect((await none.call({ action: "set", key, value: false })).status).toBe(403);
      expect(none.planned).toEqual([]);
    }
  });

  it("Full on the person's own request runs at once and says so to the route(2026-10-20), even for the speaking bot", async () => {
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

  it("applies routine model and effort as own settings without an access grant card", async () => {
    for (const mode of ["auto", "full"] as const) {
      const h = harness({ mode, keyRequired: (_person, classes) => classes.includes("always-grant") ? ["always-grant"] : [] });
      for (const [key, value] of [["routine.model", "fast"], ["routine.effort", "low"], ["routine.effort", null]] as const) {
        const result = await h.call({ action: "set", key, target: "r1", value });
        expect(result.body.text).toContain("Done");
        expect(h.planned.at(-1)?.effect).toBe("run");
        expect(h.planned.at(-1)?.stepUpClasses).not.toContain("always-grant");
      }
    }
  });

  it("applies the managed teams of the owner's Primary Bot and a routine's new name", async () => {
    const h = harness();
    await h.call({ action: "set", key: "bot.managedSections", value: ["Built-in"] });
    await h.call({ action: "set", key: "routine.name", target: "r1", value: "Morning" });
    expect(h.planned.map((row) => row.effect)).toEqual(["run", "run"]);
    expect(h.planned[1]).toMatchObject({ path: "/api/routines/r1", body: { name: "Morning" } });
  });

  it("keeps a card for Full, another person and the organization; the person's own secret follows the level (#1545, 2026-10-28)", async () => {
    const own = harness({ mode: "full" });
    expect((await own.call({ action: "set", key: "credentials.item", value: { name: "x", password: "y" } })).body.text).toMatch(/^Done/);
    expect(own.audits).toEqual([expect.objectContaining({ key: "credentials.item", secret: true })]);
    const h = harness({ mode: "full" });
    for (const args of [
      { key: "bot.approvalMode", value: "full" },
      { key: "bot.share", value: { target: "user:pr_x", level: "use" } },
      { key: "org.allowFullAccess", value: true },
    ]) {
      const result = await h.call({ action: "set", ...args });
      expect(result.body.text, args.key).toContain("Approval needed.");
    }
    expect(h.planned.every((row) => row.effect === "hold")).toBe(true);
    expect(h.audits).toEqual([]);
  });

  it("deletes the person's own routine and bot at Approve for me and Full without a card (2026-10-26)", async () => {
    for (const mode of ["auto", "full"] as const) {
      const h = harness({ mode });
      await h.call({ action: "set", key: "routine.delete", target: "r1", value: true });
      await h.call({ action: "set", key: "bot.delete", target: "b2", value: true });
      expect(h.planned.map((row) => row.effect), mode).toEqual(["run", "run"]);
    }
    // at Ask the level still asks
    const ask = harness({ mode: "ask" });
    expect((await ask.call({ action: "set", key: "routine.delete", target: "r1", value: true })).body.text).toContain("this bot is at Ask");
  });

  it("keeps the card for deleting a group with another person in it, someone else's routine, a shared team or an unknown group", async () => {
    const alone = harness({ mode: "full", groupHumans: () => ["pr_owner"] });
    await alone.call({ action: "set", key: "group.delete", target: "g1", value: true });
    expect(alone.planned.map((row) => row.effect)).toEqual(["run"]);
    for (const over of [{ groupHumans: () => ["pr_owner", "pr_bob"] }, { groupHumans: () => null }, {}]) {
      const h = harness({ mode: "full", ...over });
      expect((await h.call({ action: "set", key: "group.delete", target: "g1", value: true })).body.text).toContain("Approval needed.");
    }
    const theirs = harness({ mode: "full" });
    expect((await theirs.call({ action: "set", key: "routine.delete", target: "r2", value: true })).body.text).toContain("Approval needed.");
    const team = harness({ mode: "full" });
    expect((await team.call({ action: "set", key: "section.delete", target: "Sales", value: true })).body.text).toContain("Approval needed.");
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

  it("#1098: a change to rules or the approval level keeps its card and offers Always allow for this exact value", async () => {
    const h = harness({ mode: "ask" });
    await h.call({ action: "set", key: "bot.approvalMode", target: "b2", value: "auto" });
    expect(h.planned[0]!.effect).toBe("hold");
    expect(h.planned[0]!.noRule).toBeUndefined();
    expect(h.planned[0]!.rule?.scope).toMatchObject({ setting: "bot.approvalMode", target: "b2", value: expect.any(String) });
  });

  it("relays the route's own refusal: a member does not do by bot what they cannot do by hand", async () => {
    const result = await harness({ routeStatus: 403 }).call({ action: "set", key: "bot.name", value: "Owl" });
    expect(result.status).toBe(403);
    expect(result.body.error).toContain("forbidden");
    // #3091: the refusal tells the model it is final, so a routine does not loop on it
    expect(result.body.error).toContain("This refusal is final: do not retry");
  });

  it("#3091: every failure says whether to retry, and a note is never added twice", () => {
    expect(String(finalRefusal({ status: 404, body: { error: "No bot b9." } }).body.error)).toContain("does not exist");
    expect(String(finalRefusal({ status: 422, body: { error: "Bad value." } }).body.error)).toContain("Do not send this same call again");
    expect(String(finalRefusal({ status: 502, body: { error: "Upstream." } }).body.error)).toContain("Do not retry it in this turn");
    const once = finalRefusal({ status: 403, body: { error: "No. This refusal is final: do not retry this call." } });
    expect(String(once.body.error).match(/refusal is final/g)).toHaveLength(1);
    expect(finalRefusal({ status: 200, body: { text: "ok" } })).toEqual({ status: 200, body: { text: "ok" } });
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

  // #1674: a model change is the bot's own, as Edit bot makes it: it names
  // the bot's thread (this conversation for the speaking bot, else the one
  // the person sees), or a bot with several threads refuses it
  it("names each bot's thread with a new model, for one bot and for several", async () => {
    const model = { instanceId: "claude", model: "opus" };
    const h = harness({ answer: { bots: [{ id: "b1", threadId: "th-other" }, { id: "b2", threadId: "th-b2" }] } });
    const done = await h.call({ action: "set", key: "bot.model", target: "b1,b2", value: model });
    expect(String(done.body.text), JSON.stringify(done.body)).toMatch(/^2 of 2 bots changed/);
    const patches = h.planned.filter((row) => row.method === "PATCH");
    expect(patches).toMatchObject([
      { path: "/api/bots/b1", body: { modelSelection: model, threadId: "th1" } },
      { path: "/api/bots/b2", body: { modelSelection: model, threadId: "th-b2" } },
    ]);
    // another setting names no thread
    await h.call({ action: "set", key: "bot.name", target: "b2", value: "Owl" });
    expect(h.planned.at(-1)?.body).toEqual({ name: "Owl" });
  });

  // 2026-10-28 (one source of truth): the level is the bot's own setting, as
  // Permissions shows it, never the level of the conversation the read
  // landed on; this conversation's real level is said beside it.
  it("reads the bot's own approval setting, and this conversation's real level when it differs", async () => {
    const projected = { bots: [{ id: "b1", approvalMode: "ask", approvalSetting: "full" }] };
    const plain = await harness({ answer: projected }).call({ action: "get", key: "bot.approvalMode" });
    expect(JSON.parse(String(plain.body.text))).toEqual({ key: "bot.approvalMode", value: "full" });
    const seen: Array<[string, string | undefined]> = [];
    const h = harness({
      answer: projected,
      approvalLevel: (botId, threadId) => { seen.push([botId, threadId]); return { setting: "full", applied: { mode: "ask", reason: "engine" } }; },
    });
    const read = await h.call({ action: "get", key: "bot.approvalMode" });
    expect(JSON.parse(String(read.body.text))).toEqual({ key: "bot.approvalMode", value: "full", thisConversation: "ask", because: "engine" });
    expect(seen).toEqual([["b1", "th1"]]);
    const same = await harness({ answer: projected, approvalLevel: () => ({ setting: "full" }) }).call({ action: "get", key: "bot.approvalMode" });
    expect(JSON.parse(String(same.body.text))).toEqual({ key: "bot.approvalMode", value: "full" });
  });

  it("sets a device preference in the person's open app at Approve for me, and asks at Ask", async () => {
    const h = harness();
    const done = await h.call({ action: "set", key: "appearance.skin", value: "night" });
    expect(done.body.text).toMatch(/^Done/);
    // #1545 (2026-10-28): through the device channel, the person's open app answers
    expect(h.planned).toMatchObject([{ effect: "run", method: "POST", path: "/api/me/device-settings/apply", body: { op: "set", key: "omb-skin", value: "night" } }]);
    expect(h.audits).toEqual([expect.objectContaining({ key: "appearance.skin", value: "night", how: "run", actor: "pr_owner" })]);
    const ask = harness({ mode: "ask" });
    expect((await ask.call({ action: "set", key: "appearance.skin", value: "night" })).body.text).toContain("Approval needed.");
    expect(ask.planned).toMatchObject([{ effect: "hold", path: "/api/me/device-settings/apply" }]);
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
    // a key or an address in a model setting is a secret: the organization's keeps its card
    expect(await held({ key: "models.decider", value: { key: "sk-x" } })).toMatch(/^Done/);
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
    expect(askedChange("Mets Ottoline en auto", "bot.approvalMode", "auto", "Ottoline", false)).toBe(true);
    // security review 2026-10-20: the level and the bot are in the quote itself
    expect(askedChange("Ne mets pas Ottoline en Full, mets Zed en Full", "bot.approvalMode", "full", "Ottoline", false, undefined, "mets Zed en Full")).toMatch(/Ottoline/);
    expect(askedChange("Mets Zed en Full", "bot.approvalMode", "full", undefined, true, undefined, "Mets Zed en Full", "Scout")).toMatch(/itself/);
    expect(askedChange("Mets-toi en Full", "bot.approvalMode", "full", undefined, true, undefined, "Mets-toi en Full", "Scout")).toBe(true);
    expect(askedChange("Mets Ottoline en auto", "bot.approvalMode", "full", "Ottoline", false)).toMatch(/level full/);
    expect(askedChange("Fais-moi un rapport complet", "bot.approvalMode", "full", "Ottoline", false)).not.toBe(true);
    expect(askedChange("Mets-la en auto", "bot.approvalMode", "auto", "Ottoline", false)).toMatch(/Ottoline/);
    // anything that is not an approval level or a rule keeps its card
    expect(askedChange("Mets Ottoline en auto", "bot.title", "x", "Ottoline", false)).not.toBe(true);
    expect(askedChange("Mets Ottoline en auto", "bot.alwaysAllow", ["Bash"], "Ottoline", false)).not.toBe(true);
    // a new rule's words and an exact command are the person's own
    expect(askedChange("Ajoute une note au billet", "rules.custom", { when: "toute commande", behavior: "allow" }, undefined, true)).not.toBe(true);
    expect(askedChange("Toujours permettre la commande npm test pour Ottoline", "rules.custom", { when: "la commande npm test", behavior: "allow", botId: "kat" }, undefined, true)).toBe(true);
    // the behavior and "every bot" are said too; a one-word when is no rule
    expect(askedChange("mets une règle qui bloque les paiements", "rules.custom", { when: "les paiements", behavior: "allow" }, undefined, true)).not.toBe(true);
    expect(askedChange("mets une règle qui bloque les paiements par carte", "rules.custom", { when: "les paiements par carte", behavior: "allow", botId: "kat" }, undefined, true)).not.toBe(true);
    expect(askedChange("mets une règle qui bloque les paiements par carte", "rules.custom", { when: "les paiements par carte", behavior: "deny", botId: "kat" }, undefined, true)).toBe(true);
    expect(askedChange("Toujours permettre la commande npm test", "rules.custom", { when: "la commande npm test", behavior: "allow" }, undefined, true)).not.toBe(true);
    expect(askedChange("Toujours permettre la commande npm test pour tous les bots", "rules.custom", { when: "la commande npm test", behavior: "allow" }, undefined, true)).toBe(true);
    expect(askedChange("ajoute tout au rapport", "rules.custom", { when: "tout", behavior: "allow", botId: "kat" }, undefined, true)).not.toBe(true);
    expect(askedChange("Ajoute une note au billet", "rules.commandAllow", { command: "rm -rf /", cwd: "/", providerInstanceId: "claude" }, "Ottoline", true)).not.toBe(true);
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
    expect(model(["Ottoline"], ["claudeApi"])).toMatch(/Ottoline/);
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
    expect(askedBotChange({ key: "routine.create", family: "routine", value: {}, quote: "use the web", names: ["Quasar"], speakingBot: true, speakingName: "Quasar" })).toMatch(/itself/);
    expect(askedBotChange({ key: "bot.persona", family: "bot", value: "x", quote: "can you change your tone", names: ["Quasar"], speakingBot: true, speakingName: "Quasar" })).toMatch(/itself/);
    // the speaking bot itself: "toi" or its name
    expect(askedBotChange({ key: "bot.effort", family: "bot", value: "high", quote: "mets-toi en effort high", names: ["Quasar"], speakingBot: true, speakingName: "Quasar" })).toBe(true);
  });
});

// #1545: every setting the person can manage, gated by the bot's level only
describe("sagax_settings engines and preferences (#1545)", () => {
  const ENGINES = { instances: [
    { instanceId: "claude", displayName: "Claude", driverKind: "claudeAgent", snapshot: { state: "available", authenticated: true, account: { email: "a@example.com" } }, models: { default: "opus" } },
    { instanceId: "claude-2", displayName: "Work account", driverKind: "claudeAgent", snapshot: { state: "available", authenticated: false }, claudeAccount: { isDefault: false } },
    { instanceId: "company.x", displayName: "Company", driverKind: "claudeAgent", readOnly: true, snapshot: { state: "available" } },
  ] };

  it("reads the bot workplace from the person's own preferences, the default when unset, and says where it lives on a personal computer", async () => {
    const set = harness({ organization: () => true, answer: { preferences: { "sagax.botWorkplace.v1": "{\"place\":\"server\",\"routines\":true}" } } });
    const read = await set.call({ action: "get", key: "computer.botWorkplace" });
    expect(JSON.parse(String(read.body.text))).toEqual({ key: "computer.botWorkplace", value: { place: "server", routines: true, network: "all" } });
    expect(set.planned).toMatchObject([{ method: "GET", path: "/api/me/preferences" }]);
    const unset = await harness({ organization: () => true, answer: { preferences: {} } }).call({ action: "get", key: "computer.botWorkplace" });
    expect(JSON.parse(String(unset.body.text))).toMatchObject({ value: { place: "computer", routines: false, network: "all" }, note: expect.stringMatching(/default/) });
    // a personal computer: asked of the person's open app (#1545, 2026-10-28)
    const solo = harness({ organization: () => false, answer: (path: string) => path === "/api/me/device-settings/apply" ? { value: "{\"place\":\"server\"}", device: "desktop" } : {} });
    const local = await solo.call({ action: "get", key: "computer.botWorkplace" });
    expect(local.status).toBe(200);
    expect(JSON.parse(String(local.body.text))).toEqual({ key: "computer.botWorkplace", value: { place: "server", routines: false, network: "all" }, device: "desktop" });
    expect(solo.planned).toMatchObject([{ effect: "run", method: "POST", path: "/api/me/device-settings/apply", body: { op: "get", key: "sagax.botWorkplace.v1" } }]);
    // the look of a personal computer is kept by its server
    const skin = harness({ organization: () => false, answer: { preferences: { "omb-skin": "midnight" } } });
    expect(JSON.parse(String((await skin.call({ action: "get", key: "appearance.skin" })).body.text))).toMatchObject({ value: "midnight" });
    expect(skin.planned).toMatchObject([{ method: "GET", path: "/api/me/appearance" }]);
  });

  it("lists the engines and accounts the person sees, and one engine by its id", async () => {
    const h = harness({ answer: ENGINES });
    const list = JSON.parse(String((await h.call({ action: "get", key: "models.engines" })).body.text));
    expect(list.value).toEqual([
      { instanceId: "claude", name: "Claude", driver: "claudeAgent", state: "available", signedIn: true, account: "a@example.com", defaultModel: "opus" },
      { instanceId: "claude-2", name: "Work account", driver: "claudeAgent", state: "available", signedIn: false, claudeAccount: true },
      { instanceId: "company.x", name: "Company", driver: "claudeAgent", state: "available", signedIn: null, readOnly: true },
    ]);
    const one = JSON.parse(String((await h.call({ action: "get", key: "models.engine", target: "claude-2" })).body.text));
    expect(one.value).toMatchObject({ instanceId: "claude-2", signedIn: false });
    expect((await h.call({ action: "get", key: "models.engine" })).body.error).toMatch(/engine's id/);
  });

  it("adds a Claude account by the screen's route, then posts its sign-in card; never one already signed in or managed elsewhere", async () => {
    const cards: unknown[] = [];
    const h = harness({ answer: ENGINES, card: (_input, card) => { cards.push(card); return { status: 201, body: { text: "posted" } }; } });
    const added = await h.call({ action: "set", key: "models.claudeAccount", value: { name: " Work account " } });
    expect(added.body.text).toMatch(/^Done/);
    expect(h.planned.at(-1)).toMatchObject({ effect: "run", method: "POST", path: "/api/instances/claude-accounts", body: { displayName: "Work account" } });
    const signIn = await h.call({ action: "set", key: "models.engineSignIn", target: "claude-2", value: true });
    expect(signIn.body.text).toMatch(/sign-in card for Work account/);
    expect(cards).toEqual([{ kind: "engineSignIn", instanceId: "claude-2", name: "Work account" }]);
    expect((await h.call({ action: "set", key: "models.engineSignIn", target: "claude", value: true })).body.text).toMatch(/already signed in/);
    expect((await h.call({ action: "set", key: "models.engineSignIn", target: "company.x", value: true })).body.error).toMatch(/read only/);
    expect((await h.call({ action: "set", key: "models.engineSignIn", target: "nope", value: true })).status).toBe(404);
    expect(cards).toHaveLength(1);
    // the card is posted with the person's rights: an engine they cannot read gets none
    const refused = harness({ routeStatus: 403, card: (_input, card) => { cards.push(card); return { status: 201, body: {} }; } });
    expect((await refused.call({ action: "set", key: "models.engineSignIn", target: "claude-2", value: true })).status).toBe(403);
    expect(cards).toHaveLength(1);
    expect((await h.call({ action: "set", key: "models.claudeAccount", value: { configDir: "/x" } })).body.error).toMatch(/name/);
  });

  // criteria 3 to 5: capability is the person's rights (the route's answer),
  // permission is the bot's level; an engine others use keeps its card
  it("matrix: admin and member, Ask, Approve for me and Full, personal and organization server", async () => {
    const adminOnly = (method: string, path: string) => method !== "GET" && path.startsWith("/api/instances") ? 403 : 200;
    const keys: Array<{ key: string; value: unknown; target?: string }> = [
      { key: "models.claudeAccount", value: { name: "Work" } },
      { key: "models.chatgptAccount", value: { name: "Work" } },
      { key: "models.engine", target: "claude-2", value: { displayName: "Main" } },
      { key: "models.engineSignOut", target: "claude-2", value: true },
      { key: "models.engineRemove", target: "claude-2", value: true },
    ];
    for (const organization of [false, true]) {
      for (const role of ["admin", "member"] as const) {
        for (const mode of ["ask", "auto", "full"] as const) {
          for (const { key, value, target } of keys) {
            const h = harness({ mode, organization: () => organization, ...(role === "member" ? { routeStatus: adminOnly } : {}) });
            const result = await h.call({ action: "set", key, value, ...(target ? { target } : {}) });
            // a removal of the person's own engine on their own computer follows the level (2026-10-26);
            // 2026-10-28: on an organization server, adding an account or renaming
            // one follows the level too; signing out or removing an engine whose
            // users are unknown keeps the card (others' work may stop)
            const sensitive = organization && (key === "models.engineSignOut" || key === "models.engineRemove");
            const expected = mode === "ask" || sensitive ? "hold" : "run";
            // never refused as UI only: the change runs, or waits on the person's card
            expect(result.body.error ?? "", `${key} ${role} ${mode}`).not.toMatch(/no read|not available|see it at/);
            expect(h.planned.at(-1)?.effect, `${key} ${role} ${mode} org=${organization}`).toBe(expected);
            // a member's change the route refuses comes back as the route's refusal
            if (role === "member" && expected === "run") expect(result.status, key).toBe(403);
            if (role === "admin" && expected === "run") expect(result.body.text, key).toMatch(/^Done/);
          }
        }
      }
    }
  });
});

describe("sagax_settings engines of an organization server: the card only when others use the engine (#1545, 2026-10-28)", () => {
  const changes: Array<{ key: string; value: unknown; target?: string; reach: boolean }> = [
    { key: "models.claudeAccount", value: { name: "Work" }, reach: false },
    { key: "models.chatgptAccount", value: { name: "Work" }, reach: false },
    { key: "models.antigravityAccount", value: { name: "Work", source: "antigravity" }, reach: false },
    { key: "models.engine", target: "claude-2", value: { displayName: "Main" }, reach: false },
    { key: "models.engineInstall", target: "claude-2", value: true, reach: false },
    { key: "models.engineRefresh", target: "claude-2", value: true, reach: false },
    { key: "models.claudeUpdate", target: "claude-2", value: true, reach: false },
    { key: "models.antigravityLeftovers", target: "antigravity", value: true, reach: false },
    { key: "models.engine", target: "claude-2", value: { cli: "/opt/claude" }, reach: true },
    { key: "models.engine", target: "claude-2", value: { displayName: "Main", configDir: "/x" }, reach: true },
    { key: "models.engineSignOut", target: "claude-2", value: true, reach: true },
    { key: "models.engineRemove", target: "claude-2", value: true, reach: true },
  ];

  it("admin and member, Ask, Approve for me and Full: no Bypass card for what touches the admin alone", async () => {
    const adminOnly = (method: string, path: string) => method !== "GET" && path.startsWith("/api/instances") ? 403 : 200;
    for (const used of [true, false, undefined]) {
      for (const role of ["admin", "member"] as const) {
        for (const mode of ["ask", "auto", "full"] as const) {
          for (const { key, value, target, reach } of changes) {
            const seen: Array<[string, string | null]> = [];
            const h = harness({
              mode, organization: () => true,
              engineShared: (id, speaker) => { seen.push([id, speaker]); return used; },
              ...(role === "member" ? { routeStatus: adminOnly } : {}),
            });
            const result = await h.call({ action: "set", key, value, ...(target ? { target } : {}) });
            const label = `${key} ${JSON.stringify(value)} ${role} ${mode} used=${used}`;
            // others' work: the card at every level, unless nobody else uses it
            const expected = mode === "ask" || (reach && used !== false) ? "hold" : "run";
            expect(h.planned.at(-1)?.effect, label).toBe(expected);
            if (target) expect(seen, label).toEqual([[target, "pr_owner"]]);
            if (expected === "hold" && mode !== "ask") expect(result.body.text, label).toMatch(/another person/);
            // the person's rights stay the route's: a member is refused by the route
            if (role === "member" && expected === "run") expect(result.status, label).toBe(403);
            if (role === "admin" && expected === "run") expect(result.body.text, label).toMatch(/^Done/);
          }
        }
      }
    }
  });

  it("asks nothing about others on a personal server: the level decides", async () => {
    for (const { key, value, target } of changes) {
      const h = harness({ mode: "full", engineShared: () => true });
      await h.call({ action: "set", key, value, ...(target ? { target } : {}) });
      expect(h.planned.at(-1)?.effect, key).toBe("run");
    }
  });
});

describe("sagax_settings engine sign-in on an organization server (#1545)", () => {
  it("checks the person's own subscription, not the server's sign-in", async () => {
    const cards: unknown[] = [];
    const answer = (path: string) => path === "/api/me/engines" ? { engines: [
      { instanceId: "claude", displayName: "Claude", subscription: { supported: true, signedIn: false } },
      { instanceId: "codex", displayName: "Codex", subscription: { supported: true, signedIn: true } },
      { instanceId: "grok", displayName: "Grok API", subscription: { supported: false, signedIn: false } },
    ] } : {};
    const h = harness({ organization: () => true, answer, card: (_input, card) => { cards.push(card); return { status: 201, body: {} }; } });
    expect((await h.call({ action: "set", key: "models.engineSignIn", target: "claude", value: true })).body.text).toMatch(/sign-in card for Claude/);
    expect((await h.call({ action: "set", key: "models.engineSignIn", target: "codex", value: true })).body.text).toMatch(/already signed in/);
    expect((await h.call({ action: "set", key: "models.engineSignIn", target: "grok", value: true })).body.error).toMatch(/no personal sign-in/);
    expect(cards).toEqual([{ kind: "engineSignIn", instanceId: "claude", name: "Claude" }]);
    expect(h.planned.every((row) => row.path === "/api/me/engines")).toBe(true);
    // the person's own subscription is theirs: signing it out follows the level
    const out = harness({ organization: () => true, mode: "auto" });
    await out.call({ action: "set", key: "models.mySignOut", target: "claude", value: true });
    expect(out.planned.at(-1)).toMatchObject({ effect: "run", method: "POST", path: "/api/me/engines/claude/login/sign-out" });
  });
});

describe("sagax_settings: the rest of Settings (#1545, lot 2)", () => {
  it("writes each provider key where the screen does, and reads only which are saved", async () => {
    const h = harness({ mode: "full", answer: { anthropic: { configured: true }, tts: { keys: { elevenlabs: true, fish: false } }, imageGen: { openaiConfigured: false } } });
    await h.call({ action: "set", key: "models.providerKey", value: { anthropic: { key: "sk-a" }, elevenlabs: { key: "el" }, fishAudio: { key: "fa" } } });
    expect(h.planned.at(-1)).toMatchObject({ method: "PATCH", path: "/api/config", body: { anthropic: { key: "sk-a" }, tts: { key: "el", fishKey: "fa" } } });
    const saved = JSON.parse(String((await h.call({ action: "get", key: "models.providerKey" })).body.text));
    expect(saved.value).toMatchObject({ anthropic: true, elevenlabs: true, fishAudio: false, openaiImage: false });
    expect(JSON.stringify(saved)).not.toMatch(/sk-a|"el"/);
    expect((await h.call({ action: "set", key: "models.providerKey", value: { nope: { key: "x" } } })).body.error).toMatch(/not a provider key/);
  });

  it("lists the vault with the person's own POST listing, names and sites only", async () => {
    const items = [{ id: "v1", kind: "login", name: "Shop", username: "me@example.com", domains: ["shop.example"], hasPassword: true, source: "local", grants: [{ botId: "b1" }], card: { last4: "4242" } }];
    const h = harness({ answer: { items } });
    const all = JSON.parse(String((await h.call({ action: "get", key: "credentials.item" })).body.text));
    expect(all.value).toEqual([{ id: "v1", kind: "login", name: "Shop", domains: ["shop.example"], hasPassword: true, source: "local", grants: [{ botId: "b1" }] }]);
    expect(h.planned[0]).toMatchObject({ effect: "run", method: "POST", path: "/api/me/credentials/list", body: {} });
    const one = JSON.parse(String((await h.call({ action: "get", key: "credentials.item", target: "v1" })).body.text));
    expect(one.value).not.toHaveProperty("username");
    const access = JSON.parse(String((await h.call({ action: "get", key: "credentials.botAccess", target: "v1" })).body.text));
    expect(access.value).toEqual([{ botId: "b1" }]);
  });

  it("every setting has a get, or is an action the screen offers (create, delete, run, test, sign-in)", () => {
    const actions = /(?:update|reset|power|Action|Attach|Revoke|create|delete|remove|Delete|Remove|run|Run|Test|SignIn|SignOut|Install|Refresh|Update|Account|Disconnect|Telegram|WhatsApp|commandAllow|template\.|section\.bots|account\.avatar|computer\.rename|liveKeyRemove|Export|Add|Classes|Rotate)/;
    const missing = SETTINGS.filter((spec) => !spec.read && !actions.test(spec.key)).map((spec) => spec.key);
    expect(missing).toEqual([]);
  });

  it("reads a device-only preference in the person's open app, and relays when none is open (#1545, 2026-10-28)", async () => {
    for (const organization of [true, false]) {
      const h = harness({ organization: () => organization, answer: { key: "omb-send-key", value: "mod-enter", device: "desktop" } });
      const read = await h.call({ action: "get", key: "appearance.sendKey" });
      expect(read.status).toBe(200);
      expect(JSON.parse(String(read.body.text))).toEqual({ key: "appearance.sendKey", value: "mod-enter", device: "desktop" });
      expect(h.planned).toMatchObject([{ method: "POST", path: "/api/me/device-settings/apply", body: { op: "get", key: "omb-send-key" } }]);
      // no app open: the route's plain answer, never a made-up value
      const none = harness({ organization: () => organization, routeStatus: 409 });
      const closed = await none.call({ action: "get", key: "appearance.sendKey" });
      expect(closed.status).toBe(409);
    }
  });

  it("matrix for the new keys: the level decides on a personal server, the organization keeps its card", async () => {
    const cases: Array<{ key: string; value: unknown; target?: string; card?: true }> = [
      { key: "account.usageMeter", value: true },
      { key: "notifications.blocks", value: { unblock: "pr_x" } },
      { key: "account.experimental", value: { features: { browser: true } } },
      { key: "bot.inboundMail", value: "scout" },
      { key: "bot.host", value: null },
      { key: "models.ttsModel", value: "v2" },
      { key: "org.phoneCalls", value: { enabled: true }, card: true },
      { key: "models.myVoiceKeys", value: { fish: { key: "k" } } },
    ];
    for (const mode of ["ask", "auto", "full"] as const) {
      for (const { key, value, target, card } of cases) {
        const h = harness({ mode });
        await h.call({ action: "set", key, value, ...(target ? { target } : {}) });
        expect(h.planned.at(-1)?.effect, `${key} ${mode}`).toBe(mode === "ask" || card ? "hold" : "run");
      }
    }
  });
});

describe("sagax_settings: the actions Settings offers (#1545, lot 3)", () => {
  it("runs each action by the screen's own route and body", async () => {
    const h = harness({ mode: "full" });
    const cases: Array<[Record<string, unknown>, { method: string; path: string; body?: unknown }]> = [
      [{ key: "computer.update", value: true }, { method: "POST", path: "/api/computer/update", body: {} }],
      [{ key: "computer.reset", value: true }, { method: "POST", path: "/api/computer/reset", body: { confirm: true } }],
      [{ key: "computer.power", value: "stop" }, { method: "POST", path: "/api/me/server-environment/power", body: { action: "stop", confirm: true } }],
      [{ key: "computer.localVmAction", value: "ensure" }, { method: "POST", path: "/api/local-computer/ensure", body: { reason: "person" } }],
      [{ key: "server.boxes", value: { sleep: "box1" } }, { method: "POST", path: "/api/computers/boxes/box1/sleep" }],
      [{ key: "org.invites", value: { invite: "new@example.com" } }, { method: "POST", path: "/api/org/invites", body: { email: "new@example.com" } }],
      [{ key: "bot.librarySkills", target: "b1", value: ["writer"] }, { method: "PUT", path: "/api/bots/b1/skills-library", body: { skills: ["writer"] } }],
      [{ key: "bot.history", target: "b1", value: { id: "v3", expectedRevision: 7 } }, { method: "POST", path: "/api/bots/b1/history/restore", body: { id: "v3", expectedRevision: 7 } }],
    ];
    for (const [args, route] of cases) {
      await h.call({ action: "set", ...args });
      expect(h.planned.at(-1), String(args.key)).toMatchObject(route);
    }
    expect((await h.call({ action: "set", key: "computer.update", value: false })).body.error).toMatch(/value is true/);
  });

  it("matrix: admin and member, Ask, Approve for me and Full; a member's refusal is the route's own", async () => {
    const adminRoutes = /^\/api\/(computers|computer\/(maintenance|disk-saver)|tool-grants|org|moderation|admin|local-computer)/;
    const cases: Array<{ key: string; value: unknown; sensitive?: true }> = [
      { key: "computer.update", value: true },
      { key: "computer.power", value: "start" },
      { key: "server.maintenance", value: { enabled: true } },
      { key: "computer.localVmAction", value: "start" },
      { key: "computer.reset", value: true },
      { key: "server.diskSaver", value: { categories: ["cache"] }, sensitive: true },
      { key: "org.toolGrants", value: "tg_1", sensitive: true },
      { key: "org.invites", value: { invite: "a@example.com" }, sensitive: true },
      { key: "org.pageRevoke", value: "p1", sensitive: true },
    ];
    for (const role of ["admin", "member"] as const) {
      for (const mode of ["ask", "auto", "full"] as const) {
        for (const { key, value, sensitive } of cases) {
          const h = harness({ mode, ...(role === "member" ? { routeStatus: (method: string, path: string) => method !== "GET" && adminRoutes.test(path) ? 403 : 200 } : {}) });
          const result = await h.call({ action: "set", key, value });
          const expected = mode === "ask" || sensitive ? "hold" : "run";
          expect(h.planned.at(-1)?.effect, `${key} ${role} ${mode}`).toBe(expected);
          if (expected === "run") {
            const adminOnly = adminRoutes.test(String(h.planned.at(-1)?.path));
            expect(result.status, `${key} ${role}`).toBe(role === "member" && adminOnly ? 403 : 200);
          }
        }
      }
    }
  });
});

describe("sagax_settings: the settings kept only in the person's open app (#1545, 2026-10-28)", () => {
  const changes: Array<{ key: string; value: unknown; sent: string }> = [
    { key: "device.openAtLogin", value: "on", sent: "on" },
    { key: "device.updateChannel", value: "nightly", sent: "nightly" },
    { key: "device.updateWhenAway", value: true, sent: "true" },
    { key: "device.appIcon", value: "owl:snowy", sent: "owl:snowy" },
    { key: "device.microphone", value: "default", sent: "default" },
    { key: "device.keepAwake", value: false, sent: "false" },
    { key: "device.remoteAccess", value: true, sent: "true" },
    { key: "device.pairing", value: true, sent: "true" },
    { key: "device.pairedDeviceRemove", value: "dev1", sent: "dev1" },
    { key: "device.computerSharing", value: { server: "s1", terminal: false }, sent: "{\"server\":\"s1\",\"terminal\":false}" },
    { key: "device.serverMode", value: "leave", sent: "leave" },
    { key: "device.haptics", value: false, sent: "false" },
  ];

  it("reads each one in the person's open app, never a note or a refusal", async () => {
    for (const { key } of changes) {
      const h = harness({ answer: { key, value: "true", device: key === "device.haptics" ? "ios" : "desktop" } });
      const read = await h.call({ action: "get", key });
      expect(read.status, key).toBe(200);
      expect(JSON.parse(String(read.body.text)), key).toMatchObject({ key, value: true });
      expect(h.planned, key).toMatchObject([{ effect: "run", method: "POST", path: "/api/me/device-settings/apply", body: { op: "get", key } }]);
    }
  });

  it("matrix: admin and member, Ask, Approve for me and Full: the bot's level is the only gate", async () => {
    for (const organization of [false, true]) {
      for (const role of ["admin", "member"] as const) {
        for (const mode of ["ask", "auto", "full"] as const) {
          for (const { key, value, sent } of changes) {
            // a member's own device: the same rights as an admin's
            const h = harness({ mode, organization: () => organization, answer: { key, value: sent, device: "desktop" }, ...(role === "member" ? { operatorId: () => "pr_member" } : {}) });
            const result = await h.call({ action: "set", key, value });
            const label = `${key} ${role} ${mode} org=${organization}`;
            expect(result.body.error ?? "", label).not.toMatch(/UI only|stays the person's|not available/);
            expect(h.planned.at(-1), label).toMatchObject({ effect: mode === "ask" ? "hold" : "run", method: "POST", path: "/api/me/device-settings/apply", body: { op: "set", key, value: sent } });
            if (mode !== "ask") expect(result.body.text, label).toMatch(/^Done.*open desktop app/);
            if (mode !== "ask") expect(h.audits, label).toEqual([expect.objectContaining({ key, how: "run" })]);
          }
        }
      }
    }
  });

  it("relays the app's own answer: none open, none keeps it, or it said why", async () => {
    for (const status of [409, 422, 504, 400]) {
      const h = harness({ routeStatus: (method, path) => method === "POST" && path === "/api/me/device-settings/apply" ? status : 200 });
      const result = await h.call({ action: "set", key: "device.openAtLogin", value: "off" });
      expect(result.status, String(status)).toBe(status);
      expect(h.audits).toEqual([]);
    }
  });

  it("says when a synced preference was saved for the person with no app open", async () => {
    const h = harness({ organization: () => true, answer: { device: "server" } });
    expect((await h.call({ action: "set", key: "notifications.readReceipts", value: false })).body.text).toMatch(/no app was open/);
  });
});

describe("sagax_settings: secrets and purchases, by reference (#1545, 2026-10-28)", () => {
  const changes: Array<{ key: string; value: unknown; target?: string; path: string }> = [
    { key: "credentials.item", value: { name: "Bank", password: { $secret: "generate", length: 20 } }, path: "/api/me/credentials" },
    { key: "credentials.item", target: "it1", value: { password: { $secret: "copy", from: "it2", field: "password" } }, path: "/api/me/credentials/it1" },
    { key: "credentials.delete", target: "it1", value: true, path: "/api/me/credentials/it1" },
    { key: "credentials.botAccess", target: "it1", value: { botId: "b2", allow: true }, path: "/api/me/credentials/it1/grants" },
    { key: "credentials.wallets", value: { wallet: "link", chosen: true }, path: "/api/me/credentials/wallets" },
    { key: "credentials.onePassword", value: { vaultId: "v1", itemId: "i1" }, path: "/api/me/credentials/onepassword/import" },
    { key: "security.keyClasses", value: ["destructive"], path: "/api/security-keys/classes" },
    { key: "security.keyName", value: { id: "k1", name: "Blue key" }, path: "/api/security-keys/k1" },
    { key: "connections.webhookSecretRotate", value: "wh1", path: "/api/webhooks/wh1/rotate" },
    { key: "connections.webSearch", value: { provider: "brave", key: { $secret: "copy", from: "it2", field: "apiKey" } }, path: "/api/me/web-search" },
    { key: "models.engineKeySaved", target: "openai", value: { key: { $secret: "copy", from: "it2", field: "apiKey" } }, path: "/api/instances/openai/api-key" },
    { key: "connections.cloudAgentKey", value: { provider: "cursor", token: { $secret: "copy", from: "it2", field: "apiKey" } }, path: "/api/me/cloud-agent-providers/cursor" },
    { key: "device.vaultExport", value: "bitwarden-json", path: "/api/me/device-settings/apply" },
    { key: "device.securityKeyAdd", value: "Blue key", path: "/api/me/device-settings/apply" },
    { key: "device.securityKeyRemove", value: "k1", path: "/api/me/device-settings/apply" },
  ];

  it("matrix: admin and member, Ask, Approve for me and Full: the bot's level is the only gate for the person's own secrets", async () => {
    for (const role of ["admin", "member"] as const) {
      for (const mode of ["ask", "auto", "full"] as const) {
        for (const { key, value, target, path } of changes) {
          const h = harness({ mode, vaultValue: () => "copied-secret", ...(role === "member" ? { operatorId: () => "pr_member" } : {}) });
          const result = await h.call({ action: "set", key, value, ...(target ? { target } : {}) });
          const label = `${key} ${role} ${mode}`;
          expect(result.body.error ?? "", label).not.toMatch(/person's to|never through a bot|stays the person's|UI only/);
          expect(h.planned.at(-1), label).toMatchObject({ effect: mode === "ask" ? "hold" : "run", path });
          // the bot is never told a secret's value
          expect(JSON.stringify(result), label).not.toMatch(/copied-secret/);
          if (mode !== "ask") expect(h.audits, label).toEqual([expect.objectContaining({ key, how: "run" })]);
        }
      }
    }
  });

  it("resolves a reference on the server: generated, or copied from the person's own vault", async () => {
    const copies: string[] = [];
    const h = harness({ vaultValue: (person, item, field) => { copies.push(`${person} ${item} ${field}`); return "copied-secret"; } });
    await h.call({ action: "set", key: "credentials.item", value: { name: "Bank", password: { $secret: "generate", length: 20 } } });
    const made = (h.planned.at(-1)!.body as { password: string }).password;
    expect(made).toMatch(/^.{20}$/);
    await h.call({ action: "set", key: "credentials.item", target: "it1", value: { password: { $secret: "copy", from: "it2", field: "password" } } });
    expect(h.planned.at(-1)!.body).toEqual({ password: "copied-secret" });
    expect(copies).toEqual(["pr_owner it2 password"]);
    // the journal keeps the reference hidden, never the value
    expect(h.audits.every((row) => (row as { secret: boolean }).secret)).toBe(true);
    // a reference the server cannot resolve is refused before any route
    const bad = harness({ vaultValue: () => { throw new Error("No such item"); } });
    expect((await bad.call({ action: "set", key: "credentials.item", target: "it1", value: { password: { $secret: "copy", from: "nope", field: "password" } } })).body.error).toMatch(/No such item/);
    expect((await bad.call({ action: "set", key: "credentials.item", value: { password: { $secret: "steal" } } })).body.error).toMatch(/generate or copy/);
    expect(bad.planned).toEqual([]);
    // a reference turns any change into a secret one (hidden in the journal)
    const ws = harness();
    await ws.call({ action: "set", key: "connections.webSearch", value: { provider: "brave", key: { $secret: "generate" } } });
    expect(ws.audits).toEqual([expect.objectContaining({ secret: true })]);
  });

  it("keeps the organization's card for the organization's secrets, at every level", async () => {
    for (const mode of ["auto", "full"] as const) {
      for (const args of [
        { key: "org.botSecrets", value: { op: "replace", id: "s1", value: { $secret: "generate" } } },
        { key: "models.providerKey", value: { anthropic: { key: { $secret: "copy", from: "it2", field: "apiKey" } } } },
        { key: "models.decider", value: { key: "sk-x" } },
      ]) {
        const h = harness({ mode, organization: () => true, vaultValue: () => "copied-secret" });
        const result = await h.call({ action: "set", ...args });
        expect(h.planned.at(-1)?.effect, `${args.key} ${mode}`).toBe("hold");
        expect(String(result.body.text)).not.toMatch(/copied-secret/);
      }
    }
  });
});

describe("sagax_settings: a bot's routines, every one and several at once (2026-10-29)", () => {
  const routines = Array.from({ length: 23 }, (_, index) => ({ id: `r${index + 1}`, name: `Routine ${index + 1}`, prompt: "Read the queue and summarize it. ".repeat(80), enabled: true, schedule: { type: "daily", time: "09:00" }, nextRunAt: 1_800_000_000_000 }));

  it("regression: reads back all 23 routines of a bot, page by page, with the person's rights", async () => {
    const h = harness({ answer: { routines } });
    const seen: string[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const read = await h.call({ action: "get", key: "routine.list", target: "b2", value: { offset } });
      expect(read.status).toBe(200);
      const parsed = JSON.parse(String(read.body.text)) as { value: { total: number; nextOffset: number | null; routines: Array<{ id: string }> } };
      expect(parsed.value.total).toBe(23);
      seen.push(...parsed.value.routines.map((row) => row.id));
      offset = parsed.value.nextOffset;
    }
    expect(seen).toEqual(routines.map((routine) => routine.id));
    expect(h.planned[0]).toMatchObject({ method: "GET", path: "/api/routines" });
  });

  it("turns several routines off, on, or deletes them in one change by the bulk route", async () => {
    const h = harness({ mode: "full" });
    await h.call({ action: "set", key: "routine.bulk", target: "b2", value: { ids: ["r1", "r2"], enabled: false } });
    await h.call({ action: "set", key: "routine.bulk", target: "b2", value: { ids: "all", delete: true } });
    expect(h.planned).toMatchObject([
      { effect: "run", method: "POST", path: "/api/routines/bulk", body: { botId: "b2", action: "disable", routineIds: ["r1", "r2"] } },
      { effect: "run", method: "POST", path: "/api/routines/bulk", body: { botId: "b2", action: "delete", all: true } },
    ]);
    expect(h.audits).toHaveLength(2);
    expect((await h.call({ action: "set", key: "routine.bulk", value: { ids: [] , enabled: true } })).body.error).toMatch(/routine ids/);
    expect((await h.call({ action: "set", key: "routine.bulk", value: { ids: "all" } })).body.error).toMatch(/enabled/);
  });

  it("matrix: admin and member, Ask, Approve for me and Full; one card for the whole change at Ask; someone else's bot keeps its card", async () => {
    for (const role of ["admin", "member"] as const) {
      for (const mode of ["ask", "auto", "full"] as const) {
        for (const value of [{ ids: ["r1", "r2"], enabled: false }, { ids: "all", enabled: true }, { ids: "all", delete: true }]) {
          // a member without the right to run that bot's routines: the route's own refusal
          const h = harness({ mode, ...(role === "member" ? { routeStatus: (method: string) => method === "POST" ? 403 : 200 } : {}) });
          const result = await h.call({ action: "set", key: "routine.bulk", target: "b2", value });
          expect(h.planned, `${role} ${mode}`).toHaveLength(1);
          const expected = mode === "ask" ? "hold" : "run";
          expect(h.planned[0]!.effect, `${role} ${mode} ${JSON.stringify(value)}`).toBe(expected);
          if (expected === "run") expect(result.status).toBe(role === "member" ? 403 : 200);
        }
        const theirs = harness({ mode });
        expect((await theirs.call({ action: "set", key: "routine.bulk", target: "theirs", value: { ids: "all", delete: true } })).body.text).toContain("Approval needed.");
      }
    }
  });

  it("#1643: the person's chosen option, passed as quote, deletes them at once from their Primary Bot, even at Ask", async () => {
    const primary = { botId: "b1", botName: "Scout", messageId: "m2" };
    const h = harness({ mode: "ask", targetName: (kind, id) => kind === "bot" && id === "b2" ? "Ember" : undefined,
      personAsked: () => ({ message: "A. Tout supprimer\nSupprimer les 41 anciennes routines d'Ember", primary }) });
    const done = await h.call({ action: "set", key: "routine.bulk", target: "b2", value: { ids: "all", delete: true }, quote: "Supprimer les 41 anciennes routines d'Ember" });
    expect(String(done.body.text)).toMatch(/^Done/);
    expect(h.planned[0]).toMatchObject({ effect: "run", path: "/api/routines/bulk", primary });
    // words that do not say delete keep the card
    const other = harness({ mode: "ask", targetName: () => "Ember", personAsked: () => ({ message: "Garde les routines d'Ember", primary }) });
    await other.call({ action: "set", key: "routine.bulk", target: "b2", value: { ids: "all", delete: true }, quote: "Garde les routines d'Ember" });
    expect(other.planned[0]!.effect).toBe("hold");
  });
});

describe("sagax_settings: the memory's topic files (2026-10-29)", () => {
  it("lists, reads, writes, renames, deletes and undoes by the Memory panel's routes, on its own bot or another of the person's", async () => {
    const h = harness({ mode: "full", answer: { index: { path: "MEMORY.md" }, topics: [{ path: "memory/clients.md" }], text: "# Clients", entries: [{ id: "c1" }] } });
    const files = JSON.parse(String((await h.call({ action: "get", key: "bot.memoryFiles" })).body.text));
    expect(files.value.topics).toEqual([{ path: "memory/clients.md" }]);
    await h.call({ action: "get", key: "bot.memoryFile", target: "b2", value: { path: "memory/clients.md" } });
    expect(h.planned.at(-1)).toMatchObject({ method: "GET", path: "/api/bots/b2/memory/file" });
    const cases: Array<[unknown, { method: string; path: string; body?: unknown }]> = [
      [{ path: "memory/clients.md", text: "# Clients\n" }, { method: "PUT", path: "/api/bots/b2/memory/file", body: { path: "memory/clients.md", text: "# Clients\n" } }],
      [{ path: "memory/clients.md", renameTo: "memory/customers.md" }, { method: "POST", path: "/api/bots/b2/memory/rename", body: { from: "memory/clients.md", to: "memory/customers.md" } }],
      [{ path: "memory/customers.md", delete: true }, { method: "DELETE", path: "/api/bots/b2/memory/file" }],
    ];
    for (const [value, route] of cases) {
      const done = await h.call({ action: "set", key: "bot.memoryFile", target: "b2", value });
      expect(String(done.body.text), JSON.stringify(value)).toMatch(/^Done/);
      expect(h.planned.at(-1)).toMatchObject({ effect: "run", ...route });
    }
    await h.call({ action: "set", key: "bot.memoryUndo", target: "b2", value: "c1" });
    expect(h.planned.at(-1)).toMatchObject({ effect: "run", method: "POST", path: "/api/bots/b2/memory/journal/c1/revert" });
    expect(h.audits.length).toBe(4);
    expect((await h.call({ action: "set", key: "bot.memoryFile", value: { text: "x" } })).body.error).toMatch(/value.path/);
  });

  it("matrix: admin and member, Ask, Approve for me and Full; another person's bot keeps its card; a refusal is the route's own", async () => {
    for (const role of ["admin", "member"] as const) {
      for (const mode of ["ask", "auto", "full"] as const) {
        for (const value of [{ path: "memory/a.md", text: "a" }, { path: "memory/a.md", renameTo: "memory/b.md" }, { path: "memory/b.md", delete: true }]) {
          // a member who may not change that bot's memory: the route answers 403
          const h = harness({ mode, ...(role === "member" ? { routeStatus: (method: string) => method === "GET" ? 200 : 403 } : {}) });
          const result = await h.call({ action: "set", key: "bot.memoryFile", target: "b2", value });
          const expected = mode === "ask" ? "hold" : "run";
          expect(h.planned.at(-1)?.effect, `${role} ${mode} ${JSON.stringify(value)}`).toBe(expected);
          if (expected === "run") expect(result.status).toBe(role === "member" ? 403 : 200);
        }
        const theirs = harness({ mode });
        expect((await theirs.call({ action: "set", key: "bot.memoryFile", target: "theirs", value: { path: "memory/a.md", text: "a" } })).body.text).toContain("Approval needed.");
      }
    }
  });
});

describe("sagax_settings: a skill from GitHub (2026-10-29)", () => {
  it("imports by Persona > Skills' own route, on itself or another of the person's bots, then turns it on or off", async () => {
    const h = harness({ mode: "full" });
    const cases: Array<[unknown, string]> = [
      [{ repo: "acme/skills", path: "skills/pdf" }, "acme/skills/skills/pdf"],
      [{ repo: "acme/skills", path: "/skills/pdf/", ref: "v2" }, "https://github.com/acme/skills/tree/v2/skills/pdf"],
      [{ repo: "acme/skills" }, "acme/skills"],
      ["https://github.com/acme/skills/blob/main/pdf/SKILL.md", "https://github.com/acme/skills/blob/main/pdf/SKILL.md"],
    ];
    for (const [value, source] of cases) {
      const done = await h.call({ action: "set", key: "bot.skillImport", target: "b2", value });
      expect(String(done.body.text)).toMatch(/^Done/);
      expect(h.planned.at(-1)).toMatchObject({ effect: "run", method: "POST", path: "/api/bots/b2/skills", body: { source } });
    }
    await h.call({ action: "set", key: "bot.skillImport", value: { repo: "acme/skills" } });
    expect(h.planned.at(-1)).toMatchObject({ path: "/api/bots/b1/skills" });
    await h.call({ action: "set", key: "bot.skill", target: "b2", value: { name: "pdf", enabled: true } });
    expect(h.planned.at(-1)).toMatchObject({ method: "PATCH", path: "/api/bots/b2/skills/pdf", body: { enabled: true } });
    expect((await h.call({ action: "set", key: "bot.skillImport", value: { repo: "not a repo" } })).body.error).toMatch(/owner\/repo/);
  });

  it("matrix: admin and member, Ask, Approve for me and Full; another person's bot keeps its card; a refusal is the route's own", async () => {
    for (const role of ["admin", "member"] as const) {
      for (const mode of ["ask", "auto", "full"] as const) {
        for (const [key, value] of [["bot.skillImport", { repo: "acme/skills", path: "pdf" }], ["bot.skill", { name: "pdf", enabled: false }]] as const) {
          const h = harness({ mode, ...(role === "member" ? { routeStatus: (method: string) => method === "GET" ? 200 : 403 } : {}) });
          const result = await h.call({ action: "set", key, target: "b2", value });
          const expected = mode === "ask" ? "hold" : "run";
          expect(h.planned.at(-1)?.effect, `${key} ${role} ${mode}`).toBe(expected);
          if (expected === "run") expect(result.status).toBe(role === "member" ? 403 : 200);
        }
        const theirs = harness({ mode });
        expect((await theirs.call({ action: "set", key: "bot.skillImport", target: "theirs", value: { repo: "acme/skills" } })).body.text).toContain("Approval needed.");
      }
    }
  });
});

describe("sagax_settings: plugins, MCP servers and a routine's webhook (2026-10-29)", () => {
  it("installs a plugin for one bot or for every bot, updates, turns off and removes it, by Connect apps' own routes", async () => {
    const h = harness({ mode: "full" });
    const cases: Array<[unknown, { method: string; path: string; body?: unknown }]> = [
      [{ marketplace: "pulsatrix", plugin: "pulsatrix-flow" }, { method: "POST", path: "/api/bots/b2/plugins/install", body: { marketplace: "pulsatrix", plugin: "pulsatrix-flow" } }],
      [{ marketplace: "acme", plugin: "acme-flow", everyone: true }, { method: "POST", path: "/api/marketplaces/acme/plugins/acme-flow", body: {} }],
      [{ marketplace: "acme", plugin: "acme-flow", everyone: true, update: true }, { method: "POST", path: "/api/marketplaces/acme/plugins/acme-flow/update" }],
      [{ key: "pulsatrix-flow@pulsatrix", enabled: false }, { method: "PATCH", path: "/api/bots/b2/plugins/pulsatrix-flow@pulsatrix", body: { enabled: false } }],
      [{ key: "pulsatrix-flow@pulsatrix", uninstall: true }, { method: "DELETE", path: "/api/bots/b2/plugins/pulsatrix-flow@pulsatrix" }],
      [{ marketplace: "acme", plugin: "acme-flow", everyone: true, uninstall: true }, { method: "DELETE", path: "/api/marketplaces/acme/plugins/acme-flow" }],
    ];
    for (const [value, route] of cases) {
      const done = await h.call({ action: "set", key: "bot.plugin", target: "b2", value });
      expect(String(done.body.text), JSON.stringify(value)).toMatch(/^Done/);
      expect(h.planned.at(-1)).toMatchObject({ effect: "run", ...route });
    }
    expect((await h.call({ action: "set", key: "bot.plugin", value: { marketplace: "../x", plugin: "y" } })).body.error).toMatch(/marketplace, plugin/);
    // Everyone on an organization server reaches other people's bots: the organization's card
    const org = harness({ mode: "full", organization: () => true });
    expect((await org.call({ action: "set", key: "bot.plugin", value: { marketplace: "acme", plugin: "acme-flow", everyone: true } })).body.text).toContain("Approval needed.");
    expect((await org.call({ action: "set", key: "bot.plugin", value: { marketplace: "acme", plugin: "acme-flow" } })).body.text).toMatch(/^Done/);
  });

  it("attaches or detaches one MCP server on a bot from its current list", async () => {
    const answer = (path: string) => path === "/api/mcp/servers"
      ? { servers: [{ name: "crm" }, { name: "docs" }] }
      : { bots: [{ id: "b2", mcpServers: ["docs"] }, { id: "b3" }] };
    const h = harness({ mode: "full", answer });
    await h.call({ action: "set", key: "bot.mcpServer", target: "b2", value: { name: "crm", attached: true } });
    expect(h.planned.at(-1)).toMatchObject({ effect: "run", method: "PATCH", path: "/api/bots/b2", body: { mcpServers: ["docs", "crm"] } });
    await h.call({ action: "set", key: "bot.mcpServer", target: "b2", value: { name: "docs", attached: false } });
    expect(h.planned.at(-1)).toMatchObject({ body: { mcpServers: [] } });
    // a bot on every server: detaching one keeps the others
    await h.call({ action: "set", key: "bot.mcpServer", target: "b3", value: { name: "crm", attached: false } });
    expect(h.planned.at(-1)).toMatchObject({ method: "PATCH", path: "/api/bots/b3", body: { mcpServers: ["docs"] } });
    expect((await h.call({ action: "set", key: "bot.mcpServer", target: "b3", value: { name: "crm", attached: true } })).body.text).toMatch(/already attached/);
    // attaching a server to the speaking bot itself widens it: the person's Allow, as for bot.mcpServers
    const self = harness({ mode: "full", answer });
    expect((await self.call({ action: "set", key: "bot.mcpServer", value: { name: "crm", attached: true } })).body.text).toBeDefined();
  });

  // #1992: get goes through sagax_settings to GET /api/me/capabilities (servers),
  // never POST /api/me/mcp/servers which only adds a server.
  it("reads connections.mcpServer through get on the capabilities list (#1992)", async () => {
    const servers = [{ name: "notes", enabled: true, url: "https://notes.example.test" }];
    const h = harness({
      organization: () => true,
      answer: (path: string) => path === "/api/me/capabilities"
        ? { github: { connected: false }, servers, sandbox: false }
        : {},
    });
    const read = await h.call({ action: "get", key: "connections.mcpServer" });
    expect(read.status).toBe(200);
    expect(JSON.parse(String(read.body.text))).toEqual({ key: "connections.mcpServer", value: servers });
    expect(h.planned).toEqual([expect.objectContaining({ method: "GET", path: "/api/me/capabilities", effect: "run" })]);
    expect(JSON.stringify(h.planned)).not.toMatch(/POST only|\/api\/me\/mcp\/servers"/);
    const enabled = await h.call({ action: "get", key: "connections.mcpServerEnabled" });
    expect(JSON.parse(String(enabled.body.text))).toEqual({ key: "connections.mcpServerEnabled", value: servers });
  });

  it("routine.requiresComputer turns the need on and off and keeps the skills and MCP needs (#1996)", async () => {
    const answer = { routines: [{ id: "r1", botId: "bot-a", requires: { skills: ["osprey-digest"], mcpServers: ["wren"] } }] };
    const h = harness({ mode: "full", answer });
    const on = await h.call({ action: "set", key: "routine.requiresComputer", target: "r1", value: true });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect(h.planned.at(-1)).toMatchObject({ method: "PATCH", path: "/api/routines/r1", body: { requires: { skills: ["osprey-digest"], mcpServers: ["wren"], computer: true } } });
    const bare = harness({ mode: "full", answer: { routines: [{ id: "r1", botId: "bot-a", requires: { computer: true } }] } });
    await bare.call({ action: "set", key: "routine.requiresComputer", target: "r1", value: false });
    expect(bare.planned.at(-1)).toMatchObject({ method: "PATCH", path: "/api/routines/r1", body: { requires: null } });
    expect((await h.call({ action: "set", key: "routine.requiresComputer", target: "r1", value: "yes" })).status).toBe(400);
  });

  it("reads a webhook routine's address, never a key, and rotates its key for the person to copy", async () => {
    const answer = { webhooks: [{ id: "wh1", routineId: "r1", endpointId: "wh_abc", enabled: true, tokenLast4: "9xQz", tokenPending: false }], ingress: { baseUrl: "https://hooks.example.test/" } };
    const h = harness({ mode: "full", answer });
    const read = JSON.parse(String((await h.call({ action: "get", key: "routine.webhook", target: "r1" })).body.text));
    expect(read.value).toMatchObject({ webhookId: "wh1", url: "https://hooks.example.test/hooks/wh_abc", keyEndsWith: "9xQz", keyWaitingForThePerson: false });
    const done = await h.call({ action: "set", key: "routine.webhook", target: "r1", value: "rotate" });
    expect(String(done.body.text)).toMatch(/^Done.*waits for the person.*Show the token/);
    expect(h.planned.at(-1)).toMatchObject({ effect: "run", method: "POST", path: "/api/webhooks/wh1/rotate" });
    expect(JSON.stringify(done.body)).not.toMatch(/whsec_|Bearer [A-Za-z0-9]/);
    const none = harness({ mode: "full", answer: { webhooks: [], ingress: {} } });
    expect((await none.call({ action: "set", key: "routine.webhook", target: "r1", value: "rotate" })).status).toBe(404);
  });

  it("matrix: admin and member, Ask, Approve for me and Full; another person's bot keeps its card; a refusal is the route's own", async () => {
    const answer = (path: string) => path === "/api/webhooks"
      ? { webhooks: [{ id: "wh1", routineId: "r1", endpointId: "e" }, { id: "wh2", routineId: "r2", endpointId: "f" }] }
      : { bots: [{ id: "b2", mcpServers: ["docs"] }] };
    const cases: Array<{ key: string; target: string; value: unknown }> = [
      { key: "bot.plugin", target: "b2", value: { marketplace: "acme", plugin: "acme-flow" } },
      { key: "bot.plugin", target: "b2", value: { key: "acme-flow@acme", uninstall: true } },
      { key: "bot.mcpServer", target: "b2", value: { name: "crm", attached: true } },
      { key: "bot.mcpServer", target: "b2", value: { name: "docs", attached: false } },
      { key: "routine.webhook", target: "r1", value: "rotate" },
    ];
    for (const role of ["admin", "member"] as const) {
      for (const mode of ["ask", "auto", "full"] as const) {
        for (const { key, target, value } of cases) {
          const h = harness({ mode, answer, ...(role === "member" ? { routeStatus: (method: string) => method === "GET" ? 200 : 403 } : {}) });
          const result = await h.call({ action: "set", key, target, value });
          const expected = mode === "ask" ? "hold" : "run";
          expect(h.planned.at(-1)?.effect, `${key} ${role} ${mode}`).toBe(expected);
          if (expected === "run") expect(result.status, key).toBe(role === "member" ? 403 : 200);
        }
        const theirs = harness({ mode, answer });
        expect((await theirs.call({ action: "set", key: "bot.plugin", target: "theirs", value: { marketplace: "acme", plugin: "acme-flow" } })).body.text).toContain("Approval needed.");
        expect((await theirs.call({ action: "set", key: "routine.webhook", target: "r2", value: "rotate" })).body.text).toContain("Approval needed.");
      }
    }
  });
});

describe("sagax_settings: several bots in one call (2026-10-29, Edit N bots)", () => {
  it("changes each bot in turn, as one call each, and answers one line per bot", async () => {
    const h = harness({ routeStatus: (_method, path) => path === "/api/bots/b3" ? 409 : 200, targetName: (_kind, id) => ({ b2: "Atlas", b3: "Iris", b4: "Lina" })[id] });
    const result = await h.call({ action: "set", key: "bot.approvalMode", target: "b2, b3,b4", value: "auto" });
    expect(h.planned.map((row) => row.path)).toEqual(["/api/bots/b2", "/api/bots/b3", "/api/bots/b4"]);
    const text = String(result.body.text);
    expect(text).toMatch(/^2 of 3 bots changed\./);
    expect(text).toContain("Atlas: Done");
    expect(text).toContain("Iris: refused:");
    // each bot is journaled as its own change
    expect(h.audits).toHaveLength(2);
  });

  it("keeps each bot's own card: another person's bot waits, the person's own runs", async () => {
    const h = harness();
    await h.call({ action: "set", key: "bot.approvalMode", target: "b2,theirs", value: "auto" });
    expect(h.planned.map((row) => row.effect)).toEqual(["run", "hold"]);
  });

  it("refuses when every bot refuses, and past the limit", async () => {
    const h = harness({ routeStatus: 403 });
    const result = await h.call({ action: "set", key: "bot.approvalMode", target: "b2,b3", value: "auto" });
    expect(result.status).toBe(400);
    const many = Array.from({ length: 26 }, (_, index) => `b${index + 10}`).join(",");
    expect((await harness().call({ action: "set", key: "bot.approvalMode", target: many, value: "auto" })).body.error).toMatch(/At most 25/);
  });

  it("splits only a bot key's target", async () => {
    const h = harness();
    const result = await h.call({ action: "set", key: "routine.name", target: "r1,r2", value: "Morning" });
    expect(result.status).toBe(400);
    expect(h.planned).toEqual([]);
  });
});

describe("sagax_settings: reads a routine makes of a whole family (#3126)", () => {
  const answer = (path: string) =>
    path === "/api/custom-rules" ? { rules: [{ id: "cr1", when: "a read", behavior: "allow" }] }
      : path === "/api/approval-rules" ? { rules: [{ id: "ar1", behavior: "allow" }] }
        : {};

  it("a get of a rule kind with no target reads every rule instead of refusing", async () => {
    const h = harness({ answer });
    const owner = await h.call({ action: "get", key: "rules.owner" });
    expect(owner.status).toBe(200);
    expect(JSON.parse(String(owner.body.text))).toMatchObject({ key: "rules.owner", value: { rules: [{ id: "ar1" }] } });
    const custom = await h.call({ action: "get", key: "rules.customUpdate" });
    expect(custom.status).toBe(200);
    expect(JSON.parse(String(custom.body.text))).toMatchObject({ key: "rules.customUpdate", value: [{ id: "cr1" }] });
  });

  it("a get with a target still reads that one rule", async () => {
    const h = harness({ answer });
    const one = await h.call({ action: "get", key: "rules.customUpdate", target: "cr1" });
    expect(JSON.parse(String(one.body.text))).toMatchObject({ value: { id: "cr1", behavior: "allow" } });
    expect((await h.call({ action: "get", key: "rules.customUpdate", target: "nope" })).status).toBe(404);
  });

  it("a get naming the family reads every value it holds", async () => {
    for (const args of [{ action: "get", key: "rules" }, { action: "get", family: "rules" }]) {
      const result = await harness({ answer }).call(args);
      expect(result.status).toBe(200);
      const body = JSON.parse(String(result.body.text));
      expect(body.family).toBe("rules");
      expect(Object.keys(body.values)).toEqual(expect.arrayContaining(["rules.custom", "rules.owner", "rules.customUpdate"]));
    }
  });

  it("a record read whose route names the record still needs its target", async () => {
    const result = await harness({ answer }).call({ action: "get", key: "routine.name" });
    expect(result.status).toBe(400);
  });
});
