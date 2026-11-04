import { describe, expect, it, vi } from "vitest";
import type { Message, StoreChange } from "../store.ts";
import { createOriginApprovals, humanApprovalRoot, type OriginApprovalsDeps } from "./origin-approvals.ts";
import { approvalAudience, approvalDelivery, approvalAnswerStatus } from "./approval-audience.ts";

function fixture() {
  const threads = new Map<string, Message[]>();
  const listeners = new Set<(change: StoreChange) => void>();
  const confidential = new Set<string>();
  let reachable = true;
  const store: OriginApprovalsDeps["store"] = {
    messagesFor: threadId => threads.get(threadId) ?? [],
    appendMessage: (threadId, message) => {
      const full = { id: `m-${threads.size}-${store.messagesFor(threadId).length}`, at: 10, ...message } as Message;
      threads.set(threadId, [...store.messagesFor(threadId), full]);
      for (const listener of listeners) listener({ type: "message", threadId, message: full });
      return full;
    },
    patchMessage: (threadId, messageId, patch) => {
      const old = store.messagesFor(threadId).find(row => row.id === messageId);
      if (!old) return null;
      const full = { ...old, ...patch };
      threads.set(threadId, store.messagesFor(threadId).map(row => row.id === messageId ? full : row));
      for (const listener of listeners) listener({ type: "message.patch", threadId, message: full });
      return full;
    },
    onChange: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    isConfidentialThread: threadId => confidential.has(threadId),
  };
  const withdraw = vi.fn();
  const deps: OriginApprovalsDeps = {
    store, withdraw, rootFor: threadId => threadId === "work" ? "human" : undefined,
    mayRelay: () => reachable, speaker: () => ({ botId: "worker", name: "Worker", color: "blue" }),
  };
  const relay = createOriginApprovals(deps);
  relay.subscribe();
  const ask = () => store.appendMessage("work", { role: "bot", kind: "options", card: {
    title: "Allow Worker?", subtitle: "run the command", tool: "Bash", options: ["Allow", "Deny"], requestId: "request-1", allowKey: "mcp:the-tool",
  } });
  return { store, relay, ask, deps, confidential, withdraw, deleteThread: (threadId: string, emit = true) => { threads.delete(threadId); if (emit) for (const listener of listeners) listener({ type: "thread.deleted", threadId }); }, request: () => store.messagesFor("human")[0]!.card!.requestId!, revoke: () => { reachable = false; } };
}

describe("approvals in the human initiating chat", () => {
  it("follows a nested handoff to the proven human root, with background fallback", () => {
    const root = { id: "root", rootId: "root", threadId: "human", origin: { kind: "user", request: "Do it" } };
    const parent = { id: "middle", rootId: "root", threadId: "middle-work" };
    const coordinator = { assignerOf: () => parent, node: () => root } as unknown as Parameters<typeof humanApprovalRoot>[0];
    expect(humanApprovalRoot(coordinator, "work")).toBe("human");
    expect(humanApprovalRoot(coordinator, "human")).toBeUndefined();
    root.origin.kind = "outside";
    expect(humanApprovalRoot(coordinator, "work")).toBeUndefined();
    expect(humanApprovalRoot({ assignerOf: () => undefined, node: () => undefined }, "work")).toBeUndefined();
  });

  it("links one actionable view to the exact source and never creates a second request", () => {
    const { ask, store, relay, request } = fixture();
    const original = ask();
    const mirror = store.messagesFor("human")[0]!;
    expect(mirror).toMatchObject({ kind: "options", from: { botId: "worker" }, card: { tool: "Bash", approvalOrigin: { threadId: "work", messageId: original.id, requestId: "request-1" } } });
    expect(mirror.card!.requestId).not.toBe("request-1");
    expect(relay.sourceFor("human", request())).toEqual({ threadId: "work", requestId: "request-1" });
    expect(relay.sourceFor("work", "request-1")).toBeNull();
    const canonical = store.messagesFor("work")[0]!;
    store.patchMessage("work", canonical.id, { card: { ...canonical.card!, reviewing: true } });
    expect(store.messagesFor("human")).toHaveLength(1);
    expect(store.messagesFor("human")[0]!.card?.reviewing).toBe(true);
    expect(store.messagesFor("human")[0]!.card?.approvalDestination).toBeUndefined();
  });

  it("routes a nested human room request without treating room work as user permission", () => {
    const root = { id: "root", rootId: "root", groupId: "room", threadId: "human-room", request: "human-message", origin: { kind: "outside" } };
    const coordinator = { assignerOf: () => ({ id: "nested", rootId: "root" }), node: () => root } as unknown as Parameters<typeof humanApprovalRoot>[0];
    expect(humanApprovalRoot(coordinator, "work", candidate => candidate.request === "human-message")).toBe("human-room");
    expect(root.origin.kind).toBe("outside");
    expect(humanApprovalRoot(coordinator, "work", () => false)).toBeUndefined();
    expect(humanApprovalRoot(coordinator, "human-room", () => true)).toBeUndefined();
  });

  it("keeps a relayed room card with its original answerer, not every room member", () => {
    const f = fixture();
    f.ask();
    const view = f.store.messagesFor("human")[0]!;
    const audience = approvalAudience({ ownerUserId: "source-person", host: { kind: "fleet" } });
    expect(approvalDelivery({ audience, viewer: { userId: "source-person", deviceId: null }, message: view, ownerName: "Source person" })).toBe(view);
    const other = approvalDelivery({ audience, viewer: { userId: "room-member", deviceId: null }, message: view, ownerName: "Source person" });
    expect(other).not.toHaveProperty("card");
    expect(JSON.stringify(other)).not.toContain("run the command");
    expect(approvalAnswerStatus({ question: false, audience, callerUserId: "room-member" })).toBe(403);
    expect(approvalAnswerStatus({ question: false, audience, callerUserId: "source-person" })).toBeNull();
  });

  it("follows the running room speaker through a nested room assignment", () => {
    const root = { id: "root", rootId: "root", groupId: "human-room", threadId: "human", origin: { kind: "user", request: "Do it" } };
    const coordinator = {
      assignerOf: () => undefined,
      active: () => [
        { threadId: "work-room", botId: "worker", status: "queued", parentId: "other", rootId: "other-root" },
        { threadId: "work-room", botId: "worker", status: "running", parentId: "middle", rootId: "root" },
      ],
      node: (id: string) => id === "root" ? root : undefined,
    } as unknown as Parameters<typeof humanApprovalRoot>[0];
    expect(humanApprovalRoot(coordinator, "work-room", () => false, "worker")).toBe("human");
    expect(humanApprovalRoot(coordinator, "work-room", () => false, "another-bot")).toBeUndefined();
  });

  it.each([
    { answered: "allow", answeredBy: { kind: "session", name: "Person" } },
    { answered: "deny" }, { dismissed: true }, { expired: true }, { answered: "unavailable", dismissed: true },
  ])("mirrors settlement and rejects replay: %j", settlement => {
    const { ask, store, relay, request } = fixture();
    ask();
    const original = store.messagesFor("work")[0]!;
    store.patchMessage("work", original.id, { card: { ...original.card!, ...settlement } as Message["card"] });
    expect(store.messagesFor("human")[0]!.card).toMatchObject(settlement);
    expect(relay.sourceFor("human", request())).toBe(false);
  });

  it.each(["work", "human"])("keeps confidential %s isolated", confidentialThread => {
    const { ask, confidential, store } = fixture();
    confidential.add(confidentialThread);
    ask();
    expect(store.messagesFor("human")).toEqual([]);
  });

  it("refuses another person's root or a revoked route without copying new words", () => {
    const f = fixture();
    f.revoke();
    f.ask();
    expect(f.store.messagesFor("human")).toEqual([]);
    const g = fixture();
    g.ask();
    g.revoke();
    const original = g.store.messagesFor("work")[0]!;
    g.store.patchMessage("work", original.id, { card: { ...original.card!, subtitle: "new private words", answered: "allow" } });
    expect(g.store.messagesFor("human")[0]!.card).toMatchObject({ dismissed: true, subtitle: "run the command" });
    expect(g.relay.sourceFor("human", g.request())).toBe(false);
  });

  it("requires the source's durable backlink, including after a relay restart", () => {
    const { ask, store, deps, request } = fixture();
    ask();
    const restarted = createOriginApprovals(deps);
    expect(restarted.sourceFor("human", request())).toEqual({ threadId: "work", requestId: "request-1" });
    const original = store.messagesFor("work")[0]!;
    store.patchMessage("work", original.id, { card: { ...original.card!, approvalDestination: { threadId: "elsewhere", messageId: "forged" } } });
    expect(restarted.sourceFor("human", request())).toBe(false);
  });

  it("recovers a committed view whose backlink write was interrupted", () => {
    const { ask, store, relay, request } = fixture();
    ask();
    const original = store.messagesFor("work")[0]!;
    store.patchMessage("work", original.id, { card: { ...original.card!, approvalDestination: undefined } });
    expect(store.messagesFor("human")).toHaveLength(1);
    expect(relay.sourceFor("human", request())).toEqual({ threadId: "work", requestId: "request-1" });
  });

  it("dismisses the view when its execution thread is deleted", () => {
    const { ask, relay, store, request } = fixture();
    ask();
    relay.observe({ type: "thread.deleted", threadId: "work" });
    expect(store.messagesFor("human")[0]!.card?.dismissed).toBe(true);
    expect(relay.sourceFor("human", request())).toBe(false);
  });

  it("withdraws a deleted destination's notice, clears its backlink and falls back to the source", () => {
    const f = fixture();
    f.ask();
    const original = f.store.messagesFor("work")[0]!;
    const viewRequest = f.request();
    expect(f.relay.notificationFor("work", original.id)).toEqual({ threadId: "human", requestId: viewRequest });
    f.revoke(); // The deleted chat is no longer a readable destination.
    f.deleteThread("human");
    expect(f.withdraw).toHaveBeenCalledExactlyOnceWith("human", viewRequest);
    const source = f.store.messagesFor("work")[0]!;
    expect(source.card?.approvalDestination).toBeUndefined();
    expect(source.card?.answered).toBeUndefined();
    expect(f.relay.notificationFor("work", original.id)).toEqual({ threadId: "work", requestId: "request-1" });
    f.store.patchMessage("work", source.id, { card: { ...source.card!, answered: "deny" } });
    expect(f.store.messagesFor("human")).toEqual([]);
    expect(f.relay.notificationFor("work", original.id)).toBeUndefined();
  });

  it("uses the current address after an asynchronous review or revoked route", () => {
    const f = fixture();
    const source = f.ask();
    f.revoke();
    expect(f.relay.notificationFor("work", source.id)).toEqual({ threadId: "work", requestId: "request-1" });
    f.store.patchMessage("work", source.id, { card: { ...f.store.messagesFor("work")[0]!.card!, answered: "allow" } });
    expect(f.relay.notificationFor("work", source.id)).toBeUndefined();
  });

  it("repairs a destination deleted before the prior process could clear its backlink", () => {
    const f = fixture();
    const source = f.ask();
    const requestId = f.request();
    f.deleteThread("human", false);
    f.revoke();
    const restarted = createOriginApprovals(f.deps);
    restarted.observe({ type: "message.patch", threadId: "work", message: f.store.messagesFor("work")[0]! });
    expect(f.withdraw).toHaveBeenCalledExactlyOnceWith("human", requestId);
    expect(f.store.messagesFor("work")[0]!.card?.approvalDestination).toBeUndefined();
    expect(restarted.notificationFor("work", source.id)).toEqual({ threadId: "work", requestId: "request-1" });
  });

  it("distinguishes identical provider request ids on simultaneous peer threads", () => {
    const { ask, store, relay, deps } = fixture();
    deps.rootFor = () => "human";
    ask();
    const original = store.messagesFor("work")[0]!;
    const { approvalDestination: _destination, ...card } = original.card!;
    store.appendMessage("other-work", { role: "bot", kind: "options", card });
    const views = store.messagesFor("human");
    expect(views).toHaveLength(2);
    expect(views[0]!.card!.requestId).not.toBe(views[1]!.card!.requestId);
    expect(views[0]!.card!.allowKey).not.toBe(views[1]!.card!.allowKey);
    expect(views[1]!.card!.approvalOrigin!.allowKey).toBe("mcp:the-tool");
    expect(relay.sourceFor("human", views[0]!.card!.requestId!)).toEqual({ threadId: "work", requestId: "request-1" });
    expect(relay.sourceFor("human", views[1]!.card!.requestId!)).toEqual({ threadId: "other-work", requestId: "request-1" });
  });
});
