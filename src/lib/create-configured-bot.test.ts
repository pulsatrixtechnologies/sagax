import { afterEach, describe, expect, it, vi } from "vitest";
import { api, persistBotUpdate, type Bot } from "@/state/store";
import { BotCreationDraft, EMPTY_BOT_DEFAULTS } from "./bot-creation-draft";
import { createConfiguredBot } from "./create-configured-bot";

afterEach(() => vi.unstubAllGlobals());

describe("configured bot creation", () => {
  function fixture(mode: "ask" | "auto" | "full" | "custom", fail = 0, selection?: Bot["modelSelection"]) {
    const draft = new BotCreationDraft(EMPTY_BOT_DEFAULTS, vi.fn());
    draft.patch({ name: "Fixture", approvalMode: mode, notifications: false });
    let bot = { ...draft.bot, id: "created", threadId: "initial", approvalMode: "ask" } as Bot;
    if (selection) bot.modelSelection = selection;
    const events: string[] = [];
    const bodies: unknown[] = [];
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      events.push(`${init?.method} ${path}`);
      const body = JSON.parse(String(init?.body ?? "{}"));
      bodies.push(body);
      if (init?.method === "PATCH") bot = { ...bot, ...body };
      return { bot };
    }) as unknown as typeof api;
    let grants = 0;
    const approvals = { setMode: vi.fn(async (_id: string, grant: string, options?: { threadId?: string }) => {
      events.push(`grant ${options?.threadId ?? "bot"}`);
      if (++grants === fail) throw new Error("Grant rejected");
      bot = { ...bot, approvalMode: grant } as Bot;
      return bot;
    }) };
    return { draft, events, bodies, request, approvals, getBot: () => bot };
  }

  it("sets the chosen audience in the first creation request", async () => {
    const f = fixture("ask");
    await createConfiguredBot(f.draft, f.request, persistBotUpdate, f.approvals, "admins");
    expect(f.events[0]).toBe("POST /api/bots");
    expect(f.bodies[0]).toMatchObject({ visibility: "admins", useDefaults: false });
  });

  it("applies tool restrictions atomically before a new bot is published", async () => {
    const f = fixture("ask");
    f.draft.patch({ toolScope: { allow: [], deny: ["mcp:mail:send"] } });
    await createConfiguredBot(f.draft, f.request, persistBotUpdate, f.approvals);
    expect(f.bodies[0]).toMatchObject({ settings: { toolScope: { allow: [], deny: ["mcp:mail:send"] } } });
    expect(f.bodies[1]).not.toHaveProperty("toolScope");
  });

  it("sends only member fields when an organization member creates a bot", async () => {
    const f = fixture("auto");
    f.draft.patch({ computer: "vm", cwd: "/tmp", soul: "Be brief.", notifications: false });
    f.draft.setMemory("MEMORY.md", "notes");
    await createConfiguredBot(f.draft, f.request, persistBotUpdate, f.approvals, undefined, { memberFieldsOnly: true });
    expect(f.bodies[0]).toMatchObject({ name: "Fixture", requireAvailableModel: true, useDefaults: false });
    expect(f.bodies[0]).not.toHaveProperty("section");
    expect(f.bodies[0]).not.toHaveProperty("visibility");
    expect(f.bodies[0]).not.toHaveProperty("preset");
    expect(f.bodies[1]).not.toHaveProperty("computer");
    expect(f.bodies[1]).not.toHaveProperty("cwd");
    expect(f.bodies[1]).not.toHaveProperty("approvalMode");
    expect(f.bodies[1]).toMatchObject({ soul: "Be brief.", notifications: false });
  });

  it("writes the member's starter memory and makes their new bot their Primary Bot (2026-10-26)", async () => {
    const f = fixture("auto");
    f.draft.patch({ chiefOfStaff: true });
    f.draft.setMemory("MEMORY.md", "notes");
    await createConfiguredBot(f.draft, f.request, persistBotUpdate, f.approvals, undefined, {
      memberFieldsOnly: true, memberMayWrite: (field) => field !== "cwd",
    });
    expect(f.events.some((event) => event.includes("/memory/file"))).toBe(true);
    expect(f.bodies.some((body) => (body as { chiefOfStaff?: boolean }).chiefOfStaff === true)).toBe(true);
  });

  it("keeps the permission settings a member's profile opens (#1076)", async () => {
    const f = fixture("auto");
    f.draft.patch({ computer: "vm", proactiveMode: "off", voiceNotes: false, acknowledgeLocalAuto: true });
    const approvalLevel = new Set(["approvalMode", "autoApprove", "acknowledgeLocalAuto", "proactiveMode"]);
    await createConfiguredBot(f.draft, f.request, persistBotUpdate, f.approvals, undefined, {
      memberFieldsOnly: true, memberMayWrite: field => approvalLevel.has(field),
    });
    expect(f.bodies[1]).toMatchObject({ approvalMode: "auto", proactiveMode: "off", acknowledgeLocalAuto: true });
    // what the profile does not open stays out, as before
    expect(f.bodies[1]).not.toHaveProperty("computer");
    expect(f.bodies[1]).not.toHaveProperty("voiceNotes");
    expect(f.bodies[1]).not.toHaveProperty("confirmFullAccess");
  });

  it("keeps the server-completed workspace effort when applying draft settings", async () => {
    const selection = { instanceId: "claude", model: "sonnet", effort: "high" as const };
    const f = fixture("ask", 0, selection);
    f.draft.setModel({ instanceId: selection.instanceId, model: selection.model });
    const result = await createConfiguredBot(f.draft, f.request, persistBotUpdate, f.approvals);
    expect(f.bodies[0]).toMatchObject({ modelSelection: { instanceId: "claude", model: "sonnet" } });
    expect(f.bodies[1]).toMatchObject({ modelSelection: selection });
    expect(result.bot.modelSelection).toEqual(selection);
  });

  for (const mode of ["ask", "auto", "full", "custom"] as const) {
    it(`commits ${mode} settings without reapplying the template`, async () => {
      const f = fixture(mode);
      const result = await createConfiguredBot(f.draft, f.request, persistBotUpdate, f.approvals);
      expect(f.bodies[0]).toMatchObject({ useDefaults: false, name: "Fixture" });
      expect(result.bot).toMatchObject({ approvalMode: mode, notifications: false });
      expect(result.warnings).toEqual([]);
      // Full goes over HTTP (omb #2701); Custom still uses the desktop bridge.
      expect(f.events.filter(event => event.startsWith("grant"))).toEqual(
        mode === "custom" ? ["grant bot", "grant initial"] : [],
      );
      if (mode === "full") {
        expect(f.events).toEqual([
          "POST /api/bots",
          "PATCH /api/bots/created",
          "PATCH /api/bots/created/tasks/initial",
        ]);
      }
      expect(f.events).not.toContain("DELETE /api/bots/created");
    });
  }

  it("applies Full to the bot and its first thread over the API when there is no desktop bridge", async () => {
    const f = fixture("full");
    const result = await createConfiguredBot(f.draft, f.request, persistBotUpdate, undefined);
    expect(result.bot).toMatchObject({ approvalMode: "full" });
    expect(f.events).toEqual(["POST /api/bots", "PATCH /api/bots/created", "PATCH /api/bots/created/tasks/initial"]);
    expect(f.bodies[1]).toMatchObject({ approvalMode: "full" });
    expect(f.bodies[2]).toEqual({ approvalMode: "full" });
    for (const body of f.bodies) expect(body).not.toHaveProperty("confirmFullAccess");
  });

  it("still refuses Custom without the desktop bridge and removes the half-made bot", async () => {
    const f = fixture("custom");
    await expect(createConfiguredBot(f.draft, f.request, persistBotUpdate, undefined)).rejects.toThrow("desktop app on the computer that runs this server");
    expect(f.events).toEqual(["POST /api/bots", "DELETE /api/bots/created"]);
  });

  it("rolls back when the Custom desktop grant fails", async () => {
    const f = fixture("custom", 1);
    await expect(createConfiguredBot(f.draft, f.request, persistBotUpdate, f.approvals)).rejects.toThrow("Grant rejected");
    expect(f.events.at(-1)).toBe("DELETE /api/bots/created");
  });

  it("rolls back when the Full thread PATCH fails after the bot grant", async () => {
    const f = fixture("full");
    f.request.mockImplementation(async (path: string, init?: RequestInit) => {
      f.events.push(`${init?.method} ${path}`);
      const body = JSON.parse(String(init?.body ?? "{}"));
      f.bodies.push(body);
      if (init?.method === "PATCH" && path.includes("/tasks/")) throw new Error("Thread grant rejected");
      if (init?.method === "PATCH") {
        const bot = { ...f.getBot(), ...body } as Bot;
        return { bot };
      }
      return { bot: f.getBot() };
    });
    await expect(createConfiguredBot(f.draft, f.request, persistBotUpdate, undefined)).rejects.toThrow("Thread grant rejected");
    expect(f.events.at(-1)).toBe("DELETE /api/bots/created");
  });

  it("does not grant the initial thread when the bot PATCH returns the wrong mode", async () => {
    const f = fixture("full");
    f.request.mockImplementation(async (path: string, init?: RequestInit) => {
      f.events.push(`${init?.method} ${path}`);
      const body = JSON.parse(String(init?.body ?? "{}"));
      f.bodies.push(body);
      if (init?.method === "POST") return { bot: f.getBot() };
      if (init?.method === "PATCH" && path === "/api/bots/created") {
        return { bot: { ...f.getBot(), approvalMode: "ask" } as Bot };
      }
      if (init?.method === "DELETE") return { bot: f.getBot() };
      return { bot: { ...f.getBot(), ...body } as Bot };
    });
    await expect(createConfiguredBot(f.draft, f.request, persistBotUpdate, undefined)).rejects.toThrow("was not granted");
    expect(f.events.filter((event) => event.includes("/tasks/"))).toEqual([]);
    expect(f.events.at(-1)).toBe("DELETE /api/bots/created");
  });
});
