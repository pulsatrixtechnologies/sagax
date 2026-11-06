import { describe, expect, it, vi } from "vitest";
import { BotCreationDraft, EMPTY_BOT_DEFAULTS } from "./bot-creation-draft";
import { api } from "@/state/store";

describe("isolated creation draft", () => {
  it("starts a new bot on Full access, This computer included (omb #2808)", () => {
    const local = new BotCreationDraft({ ...EMPTY_BOT_DEFAULTS, profile: { computer: "local" } }, vi.fn());
    expect(local.template.profile.approvalMode).toBe("full");
    // a template that names a mode keeps it
    const asked = new BotCreationDraft({ ...EMPTY_BOT_DEFAULTS, profile: { computer: "local", approvalMode: "ask" } }, vi.fn());
    expect(asked.template.profile.approvalMode).toBe("ask");
  });
  it("clears a selection without exposing a malformed null bot status", async () => {
    const draft = new BotCreationDraft({ ...EMPTY_BOT_DEFAULTS, profile: { toolScope: { allow: [] } } }, vi.fn());
    expect(draft.bot).toHaveProperty("toolScope", { allow: [] });
    await draft.request(`/api/bots/${draft.id}`, { method: "PATCH", body: JSON.stringify({ toolScope: null }) });
    expect(draft.bot.toolScope).toBeUndefined();
    expect(draft.export().profile.toolScope).toBeNull();
  });
  it("keeps profile, memory and routine edits local until commitment", async () => {
    const network = vi.fn();
    const draft = new BotCreationDraft(EMPTY_BOT_DEFAULTS, vi.fn(), network as typeof api);
    // Full is a plain preference: no consent rides along, and the all-threads
    // scope of bot settings never lands in the template.
    draft.patch({ name: "Ada", approvalMode: "full", applyToAllThreads: true });
    expect(draft.consent).toEqual({});
    draft.setMemory("MEMORY.md", "A synthetic preference");
    await draft.request("/api/routines", { method: "POST", body: JSON.stringify({ botId: draft.id,
      name: "Status", prompt: "Check status", schedule: { type: "daily", time: "09:00", weekdays: [1] } }) });
    const template = draft.export();
    expect(network).not.toHaveBeenCalled();
    expect(template.profile).toEqual({ name: "Ada", approvalMode: "full" });
    expect(template.memory).toEqual({ "MEMORY.md": "A synthetic preference" });
    expect(template.routines[0]).not.toHaveProperty("botId");
    expect(template.routines[0]).not.toHaveProperty("id");
    draft.dispose();
    expect(network).not.toHaveBeenCalled();
  });

  it("keeps and clears a routine's effort in the creation draft", async () => {
    const draft = new BotCreationDraft(EMPTY_BOT_DEFAULTS, vi.fn());
    await draft.request("/api/routines", { method: "POST", body: JSON.stringify({ botId: draft.id,
      name: "Check", prompt: "Check status", effort: "low", schedule: { type: "daily", time: "09:00", weekdays: [1] } }) });
    const id = draft.routines[0]!.id;
    expect(draft.routines[0]?.effort).toBe("low");
    await draft.request(`/api/routines/${id}`, { method: "PATCH", body: JSON.stringify({ ...draft.routines[0], name: "Renamed", effort: undefined }) });
    expect(draft.routines[0]?.effort).toBe("low");
    await draft.request(`/api/routines/${id}`, { method: "PATCH", body: JSON.stringify({ ...draft.routines[0], effort: null }) });
    expect(draft.routines[0]?.effort).toBeUndefined();
  });

  it("makes independent copies and new routine identities for every draft", () => {
    const defaults = { ...EMPTY_BOT_DEFAULTS, profile: { name: "Default" }, routines: [{
      name: "Status", prompt: "Check status", enabled: false, schedule: { type: "once" as const, at: 123456789 },
    }] };
    const first = new BotCreationDraft(defaults, vi.fn());
    const second = new BotCreationDraft(defaults, vi.fn());
    first.patch({ name: "Changed" });
    expect(defaults.profile.name).toBe("Default");
    expect(second.bot.name).toBe("Default");
    expect(first.id).not.toBe(second.id);
    expect(first.routines[0].id).not.toBe(second.routines[0].id);
    expect(first.routines[0].botId).toBe(first.id);
    expect(second.routines[0].enabled).toBe(false);
  });

  it("refuses unsupported and cross-bot operations rather than reaching the live API", async () => {
    const network = vi.fn();
    const draft = new BotCreationDraft(EMPTY_BOT_DEFAULTS, vi.fn(), network as typeof api);
    for (const path of ["/api/bots/real-bot", `/api/bots/${draft.id}/messages`, "/api/routines/real-id"]) {
      await expect(draft.request(path, { method: "POST" })).rejects.toThrow();
    }
    await expect(draft.request("/api/routines", { method: "POST", body: JSON.stringify({ botId: "real-bot" }) })).rejects.toThrow("another bot");
    expect(network).not.toHaveBeenCalled();
  });

  it("imports a preview without installing it, and enables only the reviewed draft copy", async () => {
    const skill = { name: "fixture", description: "Fixture", source: "example/fixture", warnings: [], text: "synthetic", enabled: false };
    const network = vi.fn().mockResolvedValue({ skills: [skill] });
    const draft = new BotCreationDraft(EMPTY_BOT_DEFAULTS, vi.fn(), network as typeof api);
    await draft.request(`/api/bots/${draft.id}/skills`, { method: "POST", body: JSON.stringify({ source: skill.source }) });
    expect(network).toHaveBeenCalledWith("/api/bot-defaults/skills/preview", expect.anything());
    expect(draft.template.skills[0].enabled).toBe(false);
    await draft.request(`/api/bots/${draft.id}/skills/fixture`, { method: "PATCH", body: JSON.stringify({ enabled: true }) });
    expect(network).toHaveBeenCalledTimes(1);
    expect(draft.export().skills[0].enabled).toBe(true);
  });
});
