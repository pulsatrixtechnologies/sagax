import { describe, expect, it } from "vitest";
import type { Message, StoreChange } from "../store.ts";
import { createOriginApprovals, humanApprovalRoot, type OriginApprovalsDeps } from "./origin-approvals.ts";

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
  const deps: OriginApprovalsDeps = {
    store, rootFor: threadId => threadId === "work" ? "human" : undefined,
    mayRelay: () => reachable, speaker: () => ({ botId: "worker", name: "Worker", color: "blue" }),
  };
  const relay = createOriginApprovals(deps);
  relay.subscribe();
  const ask = () => store.appendMessage("work", { role: "bot", kind: "options", card: {
    title: "Allow Worker?", subtitle: "run the command", tool: "Bash", options: ["Allow", "Deny"], requestId: "request-1", allowKey: "mcp:the-tool",
  } });
  return { store, relay, ask, deps, confidential, request: () => store.messagesFor("human")[0]!.card!.requestId!, revoke: () => { reachable = false; } };
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
