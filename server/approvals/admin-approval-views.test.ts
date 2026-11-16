import { describe, expect, it, vi } from "vitest";
import type { Message } from "../store.ts";
import { createAdminApprovalViews, type AdminApprovalViewsDeps } from "./admin-approval-views.ts";
import { createOriginApprovals } from "./origin-approvals.ts";

function fixture() {
  const threads = new Map<string, Message[]>();
  const confidential = new Set<string>();
  let n = 0;
  const store = {
    messagesFor: (threadId: string) => threads.get(threadId) ?? [],
    appendMessage: (threadId: string, message: Omit<Message, "id" | "at">) => {
      const full = { id: `m-${n++}`, at: 10, ...message } as Message;
      threads.set(threadId, [...store.messagesFor(threadId), full]);
      return full;
    },
    patchMessage: (threadId: string, messageId: string, patch: Partial<Message>) => {
      const old = store.messagesFor(threadId).find((row) => row.id === messageId);
      if (!old) return null;
      const full = { ...old, ...patch } as Message;
      threads.set(threadId, store.messagesFor(threadId).map((row) => row.id === messageId ? full : row));
      return full;
    },
    isConfidentialThread: (threadId: string) => confidential.has(threadId),
    onChange: () => () => {},
  };
  const admins = new Map<string, string>([["p-ada", "home-ada"], ["p-lin", "home-lin"]]);
  const openCard = (card?: Message["card"]) => Boolean(card?.requestId && !card.answered && !card.dismissed && !card.expired);
  const withdraw = vi.fn();
  const roleListeners: Array<() => void> = [];
  const deps: AdminApprovalViewsDeps = {
    store: store as unknown as AdminApprovalViewsDeps["store"],
    enabled: () => true,
    sources: () => store.messagesFor("member-work")
      .filter((row) => row.card?.adminApproval && openCard(row.card))
      .map((message) => ({ threadId: "member-work", message, botId: "nimbus", botName: "Nimbus", personName: "Erin" })),
    openRows: () => [...threads.entries()].flatMap(([threadId, rows]) => rows.filter((row) => openCard(row.card)).map((message) => ({ threadId, message }))),
    message: (threadId, messageId) => store.messagesFor(threadId).find((row) => row.id === messageId),
    admins: () => [...admins.keys()],
    home: (principalId) => admins.get(principalId) ?? null,
    speaker: () => ({ botId: "nimbus", name: "Nimbus", color: "blue" }),
    withdraw,
    onAdminsChanged: (listener) => { roleListeners.push(listener); },
  };
  const views = createAdminApprovalViews(deps);
  const ask = (extra: Partial<NonNullable<Message["card"]>> = {}) => store.appendMessage("member-work", { role: "bot", kind: "options", card: {
    title: "Approval needed", subtitle: "cat /etc/hostname", tool: "Bash", options: ["Allow", "Deny"], requestId: "req-1",
    adminApproval: true, adminNames: ["Ada", "Lin"], ...extra,
  } });
  const viewsIn = (threadId: string) => store.messagesFor(threadId).filter((row) => row.card?.approvalOrigin?.admin);
  const roleChanged = () => { for (const listener of roleListeners) listener(); };
  return { store, views, ask, viewsIn, admins, confidential, withdraw, roleChanged };
}

describe("organization approvals in each admin's Primary Bot (#4451)", () => {
  it("puts one card per waiting approval in every admin's Primary Bot, never twice", () => {
    const { views, ask, viewsIn } = fixture();
    const source = ask();
    views.reconcile();
    views.reconcile();
    for (const home of ["home-ada", "home-lin"]) {
      const shown = viewsIn(home);
      expect(shown).toHaveLength(1);
      expect(shown[0]).toMatchObject({
        kind: "options", from: { botId: "nimbus" }, relayVia: "organization", relayAsk: { by: "Nimbus", botId: "nimbus", for: "Erin" },
        card: { tool: "Bash", subtitle: "cat /etc/hostname", options: ["Allow", "Deny"], adminApproval: true, requestId: `admin:${source.id}`,
          approvalOrigin: { threadId: "member-work", messageId: source.id, requestId: "req-1", admin: true } },
      });
      // the admin answers it: never the member's "waiting for Ada, Lin" line
      expect(shown[0]!.card!.adminNames).toBeUndefined();
    }
  });

  it("closes every admin's card with the original's outcome once anyone answers", () => {
    const { store, views, ask, viewsIn, withdraw } = fixture();
    const source = ask();
    views.reconcile();
    store.patchMessage("member-work", source.id, { card: { ...source.card!, answered: "Allow", answeredBy: { name: "Ada" } } as Message["card"] });
    views.reconcile();
    for (const home of ["home-ada", "home-lin"]) {
      expect(viewsIn(home)[0]!.card).toMatchObject({ answered: "Allow", approvalOrigin: { messageId: source.id, admin: true } });
    }
    expect(withdraw).toHaveBeenCalledTimes(2);
  });

  it("follows an expiry, and dismisses the card of a source that is gone", () => {
    const { store, views, ask, viewsIn } = fixture();
    const first = ask();
    const second = ask({ requestId: "req-2" });
    views.reconcile();
    store.patchMessage("member-work", first.id, { card: { ...first.card!, expired: true } as Message["card"] });
    store.patchMessage("member-work", second.id, { card: undefined });
    views.reconcile();
    const shown = viewsIn("home-ada");
    expect(shown.find((row) => row.card!.approvalOrigin!.messageId === first.id)!.card!.expired).toBe(true);
    expect(shown.find((row) => row.card!.approvalOrigin!.messageId === second.id)!.card!.dismissed).toBe(true);
  });

  it("an admin who lost the role keeps no open card; a new admin gets one", () => {
    const { views, ask, viewsIn, admins } = fixture();
    ask();
    views.reconcile();
    admins.delete("p-lin");
    admins.set("p-max", "home-max");
    views.reconcile();
    expect(viewsIn("home-lin")[0]!.card!.dismissed).toBe(true);
    expect(viewsIn("home-max")).toHaveLength(1);
  });

  it("a person who becomes an admin gets the waiting cards right away, with no change to any approval", () => {
    vi.useFakeTimers();
    try {
      const { views, ask, viewsIn, admins, roleChanged } = fixture();
      ask();
      views.reconcile();
      admins.set("p-max", "home-max");
      roleChanged();
      vi.advanceTimersByTime(100);
      expect(viewsIn("home-max")).toHaveLength(1);
      admins.delete("p-max");
      roleChanged();
      vi.advanceTimersByTime(100);
      expect(viewsIn("home-max")[0]!.card!.dismissed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a member's card is never copied when it is not an admin card, nor out of a confidential thread", () => {
    const { views, ask, viewsIn, confidential } = fixture();
    ask({ adminApproval: undefined });
    views.reconcile();
    expect(viewsIn("home-ada")).toEqual([]);
    confidential.add("member-work");
    ask({ requestId: "req-3" });
    views.reconcile();
    expect(viewsIn("home-ada")).toEqual([]);
  });

  it("an answer on the admin's card resolves to the original card; a closed view never does", () => {
    const { store, views, ask, viewsIn } = fixture();
    const source = ask();
    views.reconcile();
    const relay = createOriginApprovals({ store: store as never, rootFor: () => undefined, mayRelay: () => false, speaker: () => undefined, withdraw: () => {} });
    const view = viewsIn("home-ada")[0]!;
    // the admin check on the original decides who answers (adminApprovalCheck)
    expect(relay.sourceFor("home-ada", view.card!.requestId!)).toEqual({ threadId: "member-work", requestId: "req-1" });
    store.patchMessage("member-work", source.id, { card: { ...source.card!, answered: "Deny" } as Message["card"] });
    expect(relay.sourceFor("home-ada", view.card!.requestId!)).toBe(false);
  });
});
