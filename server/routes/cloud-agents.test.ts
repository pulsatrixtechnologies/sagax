// The bot's cloud agent list answers from the stored records only (no
// provider call when a thread opens), scoped on the server to what the
// viewer may see and, with ?thread=, to one thread.
import type { ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import type { CloudAgentRecord } from "../../shared/cloud-agents.ts";
import type { CloudAgentManager } from "../cloud-agents/manager.ts";
import type { CloudAgentCredentialStore } from "../cloud-agents/credentials.ts";
import type { RequestAuth } from "../request-auth.ts";
import { createCloudAgentRoutes } from "./cloud-agents.ts";

const rec = (id: string, principalId: string, threadId: string) => ({ id, principalId, threadId, botId: "b1" }) as CloudAgentRecord;

describe("GET /api/bots/:id/cloud-agents", () => {
  it("lists only what the viewer may see, for the thread asked, without syncing", async () => {
    const syncBot = vi.fn();
    const manager = { list: () => [rec("ca_1", "alice", "t1"), rec("ca_2", "bob", "t1"), rec("ca_3", "alice", "t2")], syncBot } as unknown as CloudAgentManager;
    const route = createCloudAgentRoutes({
      manager,
      credentials: {} as CloudAgentCredentialStore,
      providerLabel: (id) => id,
      botVisible: () => true,
      principalId: () => "alice",
      botName: () => "Bot",
      recordVisible: (_auth, record) => record.principalId === "alice",
    });
    const json = vi.fn();
    const url = new URL("http://x/api/bots/b1/cloud-agents?thread=t1");
    await route({ req: {} as never, res: {} as ServerResponse, url, path: url.pathname, method: "GET", auth: {} as RequestAuth, json: json as never, readBody: (async () => ({})) as never });
    expect(json).toHaveBeenCalledWith(expect.anything(), 200, { items: [expect.objectContaining({ id: "ca_1" })] });
    expect(syncBot).not.toHaveBeenCalled();
  });
});

describe("GET /api/bots/:id/cloud-agents/:agentId", () => {
  const route = (records: CloudAgentRecord[], refresh = vi.fn()) => createCloudAgentRoutes({
    manager: { get: (id: string) => records.find((r) => r.id === id) ?? null, refresh } as unknown as CloudAgentManager,
    credentials: {} as CloudAgentCredentialStore,
    providerLabel: (id) => id,
    botVisible: () => true,
    principalId: () => "alice",
    botName: () => "Bot",
    recordVisible: (_auth, record) => record.principalId === "alice" || record.threadId === "shared",
  });
  const call = async (handler: ReturnType<typeof route>, id: string) => {
    const json = vi.fn();
    const url = new URL(`http://x/api/bots/b1/cloud-agents/${id}`);
    await handler({ req: {} as never, res: {} as ServerResponse, url, path: url.pathname, method: "GET", auth: {} as RequestAuth, json: json as never, readBody: (async () => ({})) as never });
    return json.mock.calls[0]!;
  };

  it("hides a record of someone else's thread and never refreshes with their credentials", async () => {
    const refresh = vi.fn();
    const handler = route([rec("ca_1", "bob", "private"), rec("ca_2", "bob", "shared"), rec("ca_3", "alice", "t1")], refresh);
    expect((await call(handler, "ca_1"))[1]).toBe(404);
    expect((await call(handler, "ca_2"))[1]).toBe(200);
    expect(refresh).not.toHaveBeenCalled();
    expect((await call(handler, "ca_3"))[1]).toBe(200);
    expect(refresh).toHaveBeenCalledWith("ca_3");
  });
});
