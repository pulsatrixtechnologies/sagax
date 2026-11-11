// #3543: the pinned row over the message box draws the server's own items
// (GET /api/approvals?waiting=1, shared/waiting-items.ts), the list Today and
// the connector read: item for item, in the server's order, whatever the app
// has loaded. Before, it read the server's list only to pick conversations
// and rebuilt its items from their transcripts.
import { describe, expect, it } from "vitest";

import type { Message } from "@/state/store";
import type { InboxApproval } from "../../shared/approvals-inbox";
import { servedWaitingItems, waitingEntriesFrom, type ServedWaitingItem } from "../../shared/waiting-items";
import { createPinnedHold, pinnedHeldIds, pinnedItemsFrom, pinnedJumpTarget } from "./pinned-waiting";

const NOW = 10_000_000;

const row = (over: Partial<InboxApproval> & Pick<InboxApproval, "requestId" | "kind" | "at" | "threadId">): InboxApproval => ({
  key: `${over.threadId}:${over.requestId}`, botId: "b1", botName: "Nimbus", scope: "mine", decidable: true, bulk: false, ...over,
} as InboxApproval);

/** Today's rows with one item of each kind, as the server lists them: an
 * approval, a question card, a "needs you" card, a parked teammate's input
 * request, an offer, a learned-skill proposal, in the conversation on screen
 * and in conversations the app has not loaded. */
function todayRowsOfEveryKind(): InboxApproval[] {
  return [
    row({ threadId: "conv", requestId: "req_perm", messageId: "m-perm", kind: "permission", at: 100, tool: "Bash",
      message: { id: "m-perm", role: "bot", kind: "options", at: 100, card: { title: "Run Bash?", subtitle: "uptime", options: ["Allow", "Deny"], requestId: "req_perm", requestType: "permission", tool: "Bash" } } }),
    row({ threadId: "older-topic", requestId: "req_q", messageId: "m-q", kind: "question", at: 200,
      message: { id: "m-q", role: "bot", kind: "options", at: 200, card: { title: "", subtitle: "", options: [], requestId: "req_q", requestType: "question", questionRequest: { version: 1, questions: [{ question: "Where should I deliver?", options: [{ label: "Here" }, { label: "By mail" }] }] } } } }),
    row({ threadId: "conv", requestId: "attention:m-needs", messageId: "m-needs", kind: "attention", at: 300,
      message: { id: "m-needs", role: "bot", kind: "text", at: 300, attention: { kind: "question", items: [{ text: "Approve the invoice?" }], botId: "b2", botName: "Ada", threadId: "work-a", sourceMessageId: "s1", choices: ["Approve", "Hold"] } } }),
    row({ threadId: "task-b", requestId: "attention:m-input", messageId: "m-input", kind: "attention", at: 400,
      message: { id: "m-input", role: "bot", kind: "activity", at: 400, inputRequest: { botId: "b3", threadId: "work-b", botName: "Kiro", title: "Build", question: "Which build host?" },
        attention: { kind: "question", items: [{ text: "Which build host?" }], botId: "b3", botName: "Kiro", threadId: "work-b", sourceMessageId: "m-input" } } }),
    row({ threadId: "older-topic", requestId: "proactive:x1", messageId: "m-offer", kind: "proposal", proactiveId: "x1", at: 500,
      message: { id: "m-offer", role: "bot", kind: "options", at: 500, card: { title: "Keep the daily brief?", subtitle: "Every day at 8:00.", options: ["Yes", "Not now"], proactiveProposal: { id: "x1" } } } }),
    row({ threadId: "conv", requestId: "skill-s1", messageId: "m-skill", kind: "proposal", at: 600, tool: "stage_skill",
      message: { id: "m-skill", role: "bot", kind: "options", at: 600, card: { title: "Enable skill?", subtitle: "Stop a task cleanly.", options: ["Enable", "Deny"], requestId: "skill-s1", tool: "stage_skill" } } }),
  ];
}

const servedList = (): ServedWaitingItem[] => servedWaitingItems(waitingEntriesFrom(todayRowsOfEveryKind(), NOW));

describe("the pinned row draws the server's items (#3543)", () => {
  it("draws every server item, item for item, in the server's order, each with the card of its kind", () => {
    const served = servedList();
    expect(served.map((item) => item.kind)).toEqual(["approval", "question", "request", "request", "proposal", "proposal"]);
    // nothing of these conversations is loaded in the app
    const pinned = pinnedItemsFrom(served, "conv");
    expect(pinned.map((item) => item.item)).toEqual(served);
    expect(pinned.map((item) => item.kind)).toEqual(["approval", "question", "request", "request", "offer", "approval"]);
    // an item of another conversation is answered and opened there
    expect(pinned.map((item) => item.threadId)).toEqual([undefined, "older-topic", undefined, "task-b", "older-topic", undefined]);
    const question = pinned[1]!;
    expect(question.kind === "question" && question.message.card?.questionRequest?.questions[0]?.question).toBe("Where should I deliver?");
    const input = pinned[3]!;
    expect(input.kind === "request" && input.card).toMatchObject({ botId: "b3", threadId: "work-b", items: [{ text: "Which build host?" }] });
  });

  it("draws an item of a kind this app does not know, and one without its message, with its text", () => {
    const [first] = servedList();
    const unknown = { ...first!, id: "later-kind:1", kind: "checklist" as unknown as ServedWaitingItem["kind"], threadId: "elsewhere", title: "Sign the checklist", text: "Sign the checklist\n\nThree items left." };
    const bare: ServedWaitingItem = { ...first!, id: "req_bare", messageId: "m-bare", message: undefined, title: "Run Bash?", text: "Run Bash?" };
    const pinned = pinnedItemsFrom([unknown, bare], "conv");
    expect(pinned.map((item) => [item.kind, item.item.id, item.threadId])).toEqual([["other", "later-kind:1", "elsewhere"], ["other", "req_bare", undefined]]);
  });

  // #3615: the list is read a moment after a card opens (or could not be
  // read): the approval waiting right now is pinned meanwhile, and once the
  // list carries it the server's item is the one drawn, never twice.
  it("pins a live approval the server's list does not carry yet, and only once when it does", () => {
    const live = { id: "m-live", role: "bot", kind: "options", at: 700, card: { title: "Run a command", subtitle: "ls -la", options: ["Allow", "Deny"], requestId: "req_live", tool: "bash" } } as unknown as Message;
    const pending = { message: live, requestId: "req_live", tool: "bash", detail: "ls -la" };
    const before = pinnedItemsFrom([], "conv", [live], [pending]);
    expect(before.map((item) => [item.kind, item.key, item.threadId])).toEqual([["approval", "conv:req_live", undefined]]);
    const [first] = servedList();
    const listed: ServedWaitingItem = { ...first!, id: "req_live", messageId: "m-live", threadId: "conv", message: live };
    const after = pinnedItemsFrom([listed], "conv", [live], [pending]);
    expect(after.map((item) => [item.kind, item.item])).toEqual([["approval", listed]]);
  });

  it("drops an item the conversation on screen already shows settled, before the list is read again", () => {
    const served = servedList();
    const answered = { id: "m-perm", role: "bot", kind: "options", at: 100, card: { requestId: "req_perm", tool: "Bash", title: "Run Bash?", options: [], answered: "allow" } } as unknown as Message;
    const pinned = pinnedItemsFrom(served, "conv", [answered]);
    expect(pinned.map((item) => item.item.id)).toEqual(served.slice(1).map((item) => item.id));
  });
});

// #3681, the owner (2026-11-11): an ask that waits is drawn once, on the
// pinned card; the conversation reads what it holds from this same list.
describe("what the pinned card holds, the conversation does not draw (#3681)", () => {
  const ask = (id: string, at: number, more: Record<string, unknown> = {}) => ({
    id, role: "bot", kind: "options", at, text: "",
    card: { title: "", subtitle: "", options: [], requestId: `req-${id}`, requestType: "question", questionRequest: { version: 1, questions: [{ question: "Which one?", options: [{ label: "A" }, { label: "B" }] }] }, ...more },
  }) as unknown as Message;

  it("holds the message of every item it draws with the conversation's card, never one of a kind it only names", () => {
    const served = servedList();
    const [first] = served;
    const unknown = { ...first!, id: "later-kind:1", kind: "checklist" as unknown as ServedWaitingItem["kind"], messageId: "m-later", title: "Sign", text: "Sign" };
    const held = pinnedHeldIds(pinnedItemsFrom([...served, unknown], "conv"));
    expect([...held].sort()).toEqual(["m-input", "m-needs", "m-offer", "m-perm", "m-q", "m-skill"]);
    expect(held.has("m-later")).toBe(false);
  });

  it("pins a question of this conversation the list does not carry yet, once, and lets it go once settled", () => {
    const open = ask("q-live", 700);
    const before = pinnedItemsFrom([], "conv", [open]);
    expect(before.map((item) => [item.kind, item.key])).toEqual([["question", "conv:req-q-live"]]);
    expect(pinnedHeldIds(before).has("q-live")).toBe(true);
    const [first] = servedList();
    const listed: ServedWaitingItem = { ...first!, id: "req-q-live", kind: "question", messageId: "q-live", threadId: "conv", message: open };
    expect(pinnedItemsFrom([listed], "conv", [open]).map((item) => item.item)).toEqual([listed]);
    expect(pinnedItemsFrom([], "conv", [ask("q-live", 700, { answered: "answer", answeredText: "A" })])).toEqual([]);
  });

  it("lands See in the conversation on the words before the ask, past cards it also holds", () => {
    const words = { id: "w", role: "bot", kind: "text", at: 1, text: "Two things first." } as Message;
    const step = { id: "s", role: "bot", kind: "activity", at: 2, tool: { name: "Read", ok: true } } as Message;
    const first = ask("q1", 3);
    const second = ask("q2", 4);
    const messages = [words, step, first, second];
    expect(pinnedJumpTarget(messages, "q2", new Set(["q1", "q2"]))).toBe("w");
    expect(pinnedJumpTarget(messages, "q1", new Set(["q1"]))).toBe("w");
    // nothing drawn before it: the ask itself
    expect(pinnedJumpTarget([first], "q1", new Set(["q1"]))).toBe("q1");
  });

  it("tells the conversation only when what it holds changes", () => {
    const hold = createPinnedHold();
    let told = 0;
    hold.subscribe(() => { told += 1; });
    hold.set(new Set(["a"]));
    hold.set(new Set(["a"]));
    expect(told).toBe(1);
    expect(hold.get().has("a")).toBe(true);
    hold.set(new Set());
    expect(told).toBe(2);
    expect(hold.get().size).toBe(0);
  });
});
