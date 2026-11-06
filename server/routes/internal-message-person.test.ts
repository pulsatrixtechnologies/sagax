import { describe, expect, it, vi } from "vitest";
import { createInternalMessagePersonRoutes } from "./internal-message-person.ts";
import { PASS } from "./table.ts";

function json(res: { status?: number; body?: unknown }, status: number, body: unknown) {
  res.status = status;
  res.body = body;
}

function deps(overrides: Record<string, unknown> = {}) {
  const messages: Array<{ threadId: string; message: Record<string, unknown> }> = [];
  const groups = [
    {
      id: "g-existing",
      name: "Owner, Ada",
      threadId: "t-group",
      memberIds: ["bot-1"],
      humanIds: ["pr_owner", "pr_ada"],
      unreadFor: [] as string[],
    },
  ];
  const bot = { id: "bot-1", name: "Scout", color: "green", threadId: "t-bot", alwaysAllow: [] as string[] };
  return {
    organization: () => true,
    store: {
      bot: (id: string) => (id === bot.id ? bot : null),
      groups,
      group: (id: string) => groups.find((group) => group.id === id) ?? null,
      appendMessage: (threadId: string, message: Record<string, unknown>) => {
        messages.push({ threadId, message });
        return { id: `m-${messages.length}` };
      },
      patchGroup: (id: string, patch: Record<string, unknown>) => {
        const group = groups.find((entry) => entry.id === id);
        if (!group) return null;
        Object.assign(group, patch);
        return group;
      },
    },
    approvalBus: {
      store: {
        appendMessage: () => ({ id: "card", card: {} }),
        messagesFor: () => [],
        projectBotForTask: () => null,
        groupByThread: () => null,
        bot: () => bot,
        setTaskActivity: () => undefined,
        setActivity: () => undefined,
        patchMessage: () => undefined,
      },
      broadcast: () => undefined,
      autoApply: () => true,
    },
    connectorThread: () => ({ group: undefined }),
    effectiveBotOwner: () => "pr_owner",
    resolvePerson: (id: string) => id === "pr_ada"
      ? { ok: true as const, id: "pr_ada", name: "Ada" }
      : id === "pr_owner"
        ? { ok: true as const, id: "pr_owner", name: "Owner" }
      : id === "pr_robot"
        ? { ok: false as const, code: "service_account" as const }
        : { ok: false as const, code: "unknown_person" as const },
    displayName: (id: string) => id === "pr_owner" ? "Owner" : id === "pr_ada" ? "Ada" : id,
    createChannel: vi.fn((input: { name: string; memberIds: string[]; humanIds: string[] }) => {
      const created = {
        id: "g-new",
        name: input.name,
        threadId: "t-new",
        memberIds: input.memberIds,
        humanIds: input.humanIds,
        unreadFor: [] as string[],
      };
      groups.unshift(created);
      return created;
    }),
    markCreatedBy: vi.fn(),
    notify: vi.fn(),
    isUnattended: () => false,
    requireActive: () => undefined,
    messages,
    bot,
    groups,
    ...overrides,
  };
}

async function call(route: ReturnType<typeof createInternalMessagePersonRoutes>, body: Record<string, unknown>, capability = { botId: "bot-1", threadId: "t-bot", generation: "1" }) {
  const res: { status?: number; body?: unknown } = {};
  await route({
    res: res as never,
    path: "/api/internal/message-person",
    method: "POST",
    json: json as never,
    capability: capability as never,
    readBody: async () => body,
  });
  return res;
}

describe("createInternalMessagePersonRoutes", () => {
  it("passes other paths", async () => {
    const route = createInternalMessagePersonRoutes(deps() as never);
    expect(await route({
      res: {} as never, path: "/api/internal/post-to-room", method: "POST",
      json: json as never, capability: { botId: "bot-1", threadId: "t-bot", generation: "1" } as never,
      readBody: async () => ({}),
    })).toBe(PASS);
  });

  it("posts into an existing triad after Full access auto-allow", async () => {
    const d = deps();
    const route = createInternalMessagePersonRoutes(d as never);
    const res = await call(route, { principalId: "pr_ada", message: "Deploy at 4." });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, groupId: "g-existing", created: false });
    expect(d.messages.some((row) => row.threadId === "t-group" && row.message.text === "Deploy at 4.")).toBe(true);
    expect(d.notify).toHaveBeenCalledWith(expect.objectContaining({
      kind: "message", audience: ["pr_ada"], groupId: "g-existing",
    }));
    expect(d.createChannel).not.toHaveBeenCalled();
  });

  it("creates the triad when none exists", async () => {
    const d = deps();
    d.groups.length = 0;
    const route = createInternalMessagePersonRoutes(d as never);
    const res = await call(route, { principal_id: "pr_ada", message: "Hello Ada" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ok: true, groupId: "g-new", created: true });
    expect(d.createChannel).toHaveBeenCalledWith(expect.objectContaining({
      memberIds: ["bot-1"],
      humanIds: ["pr_owner", "pr_ada"],
    }));
    expect(d.markCreatedBy).toHaveBeenCalledWith("g-new", "pr_owner");
  });

  it("refuses the owner, a service account, a solo server and a missing message", async () => {
    const route = createInternalMessagePersonRoutes(deps() as never);
    expect((await call(route, { principalId: "pr_owner", message: "hi" })).body).toMatchObject({ code: "self" });
    expect((await call(route, { principalId: "pr_robot", message: "hi" })).body).toMatchObject({ code: "service_account" });
    expect((await call(route, { principalId: "pr_ada", message: "" })).status).toBe(400);

    const solo = createInternalMessagePersonRoutes(deps({ organization: () => false }) as never);
    expect((await call(solo, { principalId: "pr_ada", message: "hi" })).body).toMatchObject({ code: "identity_perspicax" });
  });
});
