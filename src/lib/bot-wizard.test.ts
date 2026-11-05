import { describe, expect, it, vi } from "vitest";

import { newWizardDraft } from "../../shared/bot-wizard";
import {
  createWizardBot,
  finishWizard,
  guideBot,
  isDesignerBot,
  createDesignerBot,
  designerProfile,
  pendingRules,
  routineBody,
  ruleBody,
  scheduleLabel,
  setSuggestedRule,
  wizardSuggestions,
} from "./bot-wizard";

const draft = (extra: Partial<ReturnType<typeof newWizardDraft>> = {}) => ({
  ...newWizardDraft({ botId: "bot-1", owner: "pr_me", origin: "new", mode: "manual", roleId: "inbox", now: 1 }),
  ...extra,
});

describe("the wizard's calls", () => {
  it("creates the bot on the server's Auto defaults and suggested name", async () => {
    const request = vi.fn(async (path: string) => path === "/api/bot-defaults"
      ? { modelSelection: { instanceId: "i1", model: "auto", auto: true }, suggestedName: "Nova" }
      : { bot: { id: "bot-9", name: "Nova" } });
    const bot = await createWizardBot(request as never);
    expect(bot.id).toBe("bot-9");
    expect(request).toHaveBeenLastCalledWith("/api/bots", { method: "POST", body: JSON.stringify({ name: "Nova", modelSelection: { instanceId: "i1", model: "auto", auto: true } }) });
  });

  it("a ticked rule becomes the person's custom rule for this bot; unticked, it is removed", async () => {
    expect(ruleBody("ask-send-mail", "bot-1", "fr")).toEqual({ when: "envoyer un courriel", behavior: "ask", botId: "bot-1", riskScope: [] });
    expect(ruleBody("nope", "bot-1", "fr")).toBeNull();
    const request = vi.fn(async () => ({ rule: { id: "rule-7" } }));
    expect(await setSuggestedRule(draft(), "deny-delete-mail", true, "en", request as never)).toEqual({ "deny-delete-mail": "rule-7" });
    expect(request).toHaveBeenCalledWith("/api/custom-rules", { method: "POST", body: JSON.stringify({ when: "delete emails", behavior: "deny", botId: "bot-1", riskScope: [] }) });
    request.mockClear();
    expect(await setSuggestedRule(draft({ rules: { "deny-delete-mail": "rule-7" } }), "deny-delete-mail", false, "en", request as never)).toEqual({ "deny-delete-mail": null });
    expect(request).toHaveBeenCalledWith("/api/custom-rules/rule-7", { method: "DELETE" });
    // already applied: nothing twice
    request.mockClear();
    expect(await setSuggestedRule(draft({ rules: { "deny-delete-mail": "rule-7" } }), "deny-delete-mail", true, "en", request as never)).toEqual({});
    expect(request).not.toHaveBeenCalled();
  });

  it("finds the rules the Primary Bot marked pending", () => {
    expect(pendingRules({ rules: { a: "pending", b: "rule-1" } })).toEqual(["a"]);
  });

  it("creates the picked routines when the wizard finishes, and reports the ones that fail", async () => {
    expect(routineBody("inbox-triage", "bot-1", "fr")).toEqual({
      name: "Tri du courriel", prompt: expect.stringContaining("courriels non lus"), botId: "bot-1", target: "bot", enabled: true,
      schedule: { type: "daily", time: "08:30", weekdays: [1, 2, 3, 4, 5] },
    });
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === "/api/routines" && String(init?.body).includes("Afternoon")) throw new Error("no");
      if (path.endsWith("/finish")) return { draft: { ...draft(), status: "done" } };
      return { routine: { id: "r" } };
    });
    const result = await finishWizard(draft({ routines: ["inbox-triage", "inbox-afternoon"] }), "en", request as never);
    expect(result.failed).toEqual(["Afternoon follow-ups"]);
    expect(result.draft.status).toBe("done");
    expect(request).toHaveBeenLastCalledWith("/api/bot-wizard/bot-1/finish", { method: "POST", body: "{}" });
  });

  it("the guide is the Primary Bot, else another bot, never the one being made", () => {
    const bots = [{ id: "new", chiefOfStaff: true }, { id: "a" }, { id: "p", chiefOfStaff: true }, { id: "h", hidden: true, chiefOfStaff: true }];
    expect(guideBot(bots, "new")?.id).toBe("p");
    expect(guideBot([{ id: "new" }, { id: "a" }], "new")?.id).toBe("a");
    expect(guideBot([{ id: "new" }], "new")).toBeNull();
  });

  it("#2045: the guide is the viewer's own Primary Bot, never another person's", () => {
    const bots = [
      { id: "new", ownerUserId: "person-a" },
      { id: "theirs", chiefOfStaff: true, ownerUserId: "person-b" },
      { id: "mine", chiefOfStaff: true, ownerUserId: "person-a" },
      { id: "other", ownerUserId: "person-a" },
    ];
    expect(guideBot(bots, "new", "person-a")?.id).toBe("mine");
    expect(guideBot(bots, "new", "person-b")?.id).toBe("theirs");
  });

  it("a Bot designer leads first, in either language, and never the one being made", () => {
    const bots = [{ id: "p", chiefOfStaff: true }, { id: "d", name: "  Concepteur de  bots " }, { id: "x", name: "Bot Designer", hidden: true }];
    expect(guideBot(bots, "new")?.id).toBe("d");
    expect(guideBot([{ id: "new", name: "Bot designer" }, { id: "p", chiefOfStaff: true }], "new")?.id).toBe("p");
    expect(isDesignerBot({ name: "BOT DESIGNER" })).toBe(true);
    expect(isDesignerBot({ name: "Designer" })).toBe(false);
  });

  it("creates the Bot designer with the person's own rights, on the Auto model, in their language", async () => {
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === "/api/bot-defaults") return { modelSelection: { instanceId: "claude", model: "auto", auto: true } };
      return { bot: { id: "d", ...JSON.parse(String(init?.body)) } };
    });
    const bot = await createDesignerBot("fr-CA", request as never);
    expect(bot.name).toBe("Concepteur de bots");
    const body = JSON.parse(String(request.mock.calls[1]![1]!.body));
    expect(Object.keys(body).sort()).toEqual(["description", "modelSelection", "name", "settings", "title"]);
    expect(body.settings.soul).toContain("bot.wizard");
    expect(designerProfile("en").name).toBe("Bot designer");
  });

  it("the wizard's bot starts with no MCP server when asked", async () => {
    const request = vi.fn(async (path: string, init?: RequestInit) => path === "/api/bot-defaults" ? {} : { bot: JSON.parse(String(init?.body)) });
    expect(await createWizardBot(request as never, { noMcp: true })).toEqual({ settings: { mcpServers: [] } });
    expect(await createWizardBot(request as never)).toEqual({});
  });

  it("names a schedule", () => {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    expect(scheduleLabel("08:00", [1, 2, 3, 4, 5], days, "weekdays", "every day")).toBe("08:00, weekdays");
    expect(scheduleLabel("08:00", [0, 1, 2, 3, 4, 5, 6], days, "weekdays", "every day")).toBe("08:00, every day");
    expect(scheduleLabel("16:00", [5], days, "weekdays", "every day")).toBe("16:00, Fri");
  });

  it("suggests only the role's tools", () => {
    expect(wizardSuggestions("coder", "en").tools).toEqual(["computer", "mcp", "apps"]);
    expect(wizardSuggestions("", "en").tools).toEqual(["apps", "mcp", "computer", "browser"]);
  });
});
