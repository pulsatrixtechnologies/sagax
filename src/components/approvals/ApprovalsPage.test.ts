// @vitest-environment happy-dom
// The Approvals screen in a DOM: the list and its filters (combined, kept in
// the address), the keys (J / K, Y / N, X, Escape), a single answer through
// the conversation's own decideRequest, the bulk answer (once, never
// remembered, with what it leaves), the calm empty state, the History, and
// never an id on screen.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InboxApproval, InboxPayload } from "../../../shared/approvals-inbox";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const UUID = "3f2b8c1e-9a4d-4e6b-8f1a-2c3d4e5f6a7b";
const fixture = vi.hoisted(() => ({
  payload: { pending: [], history: [], scopes: { org: false, team: false } } as unknown as InboxPayload,
  calls: [] as Array<{ path: string; body?: unknown }>,
  dispatch: [] as unknown[],
}));

vi.mock("@/lib/org-approval-policy", () => ({ useOrgApprovalPolicy: () => ({ alwaysAllow: true, orgRules: 0 }), noteOrgAlwaysAllowOff: () => {} }));
vi.mock("../DesktopCapabilities", () => ({ WindowDragStrip: () => null }));
vi.mock("@/components/Avatar", () => ({ BotAvatar: ({ bot }: { bot: { name: string } }) => createElement("span", { "data-avatar": bot.name }) }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({
      state: { ...original.initialState, bots: [{ id: "b1", name: "Nova", color: "green", tasks: [] }, { id: "b2", name: "Pixel", color: "orange", tasks: [] }], groups: [] },
      dispatch: (action: unknown) => { fixture.dispatch.push(action); },
    }),
    api: async (path: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      fixture.calls.push({ path, body });
      if (path.startsWith("/api/approvals/bulk")) {
        const items = (body as { items: Array<{ threadId: string; requestId: string }> }).items;
        const keys = new Set(items.map((item) => `${item.threadId}:${item.requestId}`));
        fixture.payload = { ...fixture.payload, pending: fixture.payload.pending.filter((entry) => !keys.has(entry.key)) };
        return { decision: body.decision, answered: keys.size, results: [...keys].map((key) => ({ key, ok: true })) };
      }
      if (path.startsWith("/api/approvals")) return fixture.payload;
      throw new Error(`unexpected ${path}`);
    },
  };
});

const { ApprovalsPage } = await import("./ApprovalsPage");
const { setLocale } = await import("@/lib/i18n");

function permission(id: string, botId: string, botName: string, ageMin: number, command: string, patch: Partial<InboxApproval> = {}): InboxApproval {
  return {
    key: `t-${id}:req-${id}`, threadId: `t-${id}`, requestId: `req-${id}`, botId, botName, scope: "mine", kind: "permission",
    at: Date.now() - ageMin * 60_000, decidable: true, bulk: true, risk: "execute", destination: "computer", tool: "Bash",
    message: {
      id: `m-${id}`, role: "bot", kind: "options", at: Date.now() - ageMin * 60_000,
      card: { title: "Approval needed", subtitle: command, toolInput: JSON.stringify({ command }), options: ["Allow", "Deny"], requestId: `req-${id}`, tool: "Bash" },
    },
    ...patch,
  };
}

function question(id: string): InboxApproval {
  return {
    key: `t-${id}:req-${id}`, threadId: `t-${id}`, requestId: `req-${id}`, botId: "b2", botName: "Pixel", scope: "mine", kind: "question",
    at: Date.now() - 90 * 60_000, decidable: true, bulk: "question",
    message: {
      id: `m-${id}`, role: "bot", kind: "options", at: Date.now(),
      card: { title: "Question", subtitle: "", options: [], requestId: `req-${id}`, tool: "AskUserQuestion", requestType: "question", questionRequest: { version: 1, questions: [{ question: "Which environment first?", options: [{ label: "Staging" }, { label: "Production" }] }] } },
    },
  };
}

let host: HTMLDivElement;
let root: Root;

async function render() {
  await act(async () => { root.render(createElement(ApprovalsPage)); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
async function key(k: string, target: EventTarget = window) {
  await act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); });
}
async function click(element: Element | null | undefined) {
  if (!element) throw new Error("no element");
  await act(async () => { (element as HTMLElement).click(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
const rows = () => [...host.querySelectorAll("[data-approval-row]")];
const selectedRow = () => host.querySelector("[data-approval-row][data-selected]");

beforeEach(() => {
  setLocale("en");
  history.replaceState(null, "", "/#approvals");
  fixture.calls = [];
  fixture.dispatch = [];
  fixture.payload = {
    pending: [
      permission("a", "b1", "Nova", 3, `rm -rf build/${UUID}`),
      question("q"),
      permission("c", "b2", "Pixel", 30 * 60, "kubectl delete pod web-1", { risk: "destructive", needsKey: true, bulk: "needs-key" }),
      permission("d", "b1", "Nova", 10, "git status", { risk: "read" }),
    ],
    history: [],
    scopes: { org: false, team: false },
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("ApprovalsPage", () => {
  it("lists every card oldest first, with bot, type and a colored age, and never an id", async () => {
    await render();
    expect(rows()).toHaveLength(4);
    expect(rows()[0]!.textContent).toContain("Pixel");
    expect(rows()[0]!.querySelector("[data-age]")?.getAttribute("data-age")).toBe("stale");
    expect(host.querySelector("[data-key='t-a:req-a'] [data-age]")?.getAttribute("data-age")).toBe("fresh");
    expect(host.querySelector("[data-key='t-q:req-q'] [data-age]")?.getAttribute("data-age")).toBe("aging");
    expect(host.textContent).not.toContain(UUID);
    expect(host.textContent).not.toContain("req-");
    expect(host.textContent).not.toContain("t-a");
  });

  it("combines filters and keeps them in the address", async () => {
    await render();
    await click(host.querySelector("[data-chip=risky]"));
    // runs a command or deletes: two of the four
    expect(rows()).toHaveLength(2);
    await click(host.querySelector("[data-chip=permission]"));
    expect(rows()).toHaveLength(2);
    expect(location.hash).toBe("#approvals?kind=permission&risky=1");
    await click(host.querySelector("[data-chip=question]"));
    // question AND risky: none
    expect(rows()).toHaveLength(0);
    expect(host.querySelector("[data-approvals-empty=filtered]")).not.toBeNull();
  });

  it("opens with the filters an address carries", async () => {
    history.replaceState(null, "", "/#approvals?kind=question");
    await render();
    expect(rows()).toHaveLength(1);
    expect(host.querySelector("[data-approval-detail=question]")).not.toBeNull();
  });

  it("moves with J and K, answers with Y through the conversation's own decision, and says what follows", async () => {
    await render();
    expect(selectedRow()?.textContent).toContain("Pixel");
    await key("j");
    expect(selectedRow()?.textContent).toContain("Which environment first?");
    await key("j");
    await key("k");
    await key("j");
    expect(selectedRow()?.textContent).toContain("git status");
    await key("y");
    expect(fixture.dispatch).toContainEqual(expect.objectContaining({ type: "decideRequest", threadId: "t-d", requestId: "req-d", behavior: "allow" }));
    const decided = fixture.dispatch.find((action) => (action as { type: string }).type === "decideRequest") as Record<string, unknown>;
    expect(decided.always).toBeUndefined();
    expect(decided.rememberCommand).toBeUndefined();
    expect(host.querySelector("[data-outcome=allow]")?.textContent).toContain("Nova picks up where it left off.");
  });

  it("answers N with a decline", async () => {
    await render();
    await key("n");
    expect(fixture.dispatch).toContainEqual(expect.objectContaining({ type: "decideRequest", requestId: "req-c", behavior: "deny" }));
    expect(host.querySelector("[data-outcome=deny]")).not.toBeNull();
  });

  it("shows Yes and No as large buttons and the question's own choices", async () => {
    await render();
    expect(host.querySelector("[data-approval-actions=inbox] [data-decision=allow]")?.textContent).toContain("Yes");
    expect(host.querySelector("[data-approval-actions=inbox] [data-decision=deny]")?.textContent).toContain("No");
    expect(host.querySelector("[data-destination=computer]")).not.toBeNull();
    await key("j");
    const choices = [...host.querySelectorAll("[data-inbox-question] [data-ask-choice]")].map((node) => node.textContent);
    expect(choices).toEqual(["AStaging", "BProduction", "COther"]);
    // Y on a question does nothing: its letters are its own
    await key("y");
    expect(fixture.dispatch.some((action) => (action as { type: string }).type === "decideRequest")).toBe(false);
  });

  it("answers several at once, once only, and names what it leaves", async () => {
    await render();
    await key("x"); // Pixel's card: needs a key for an Allow
    await key("j");
    await key("j");
    await key("x");
    await key("j");
    await key("x");
    expect(host.querySelector("[data-bulk-bar]")?.textContent).toContain("Selected: 3");
    await key("y");
    const dialog = host.querySelector("[data-bulk-confirm=allow]");
    expect(dialog?.querySelectorAll("[data-bulk-list=answered] li")).toHaveLength(2);
    expect(dialog?.querySelector("[data-bulk-list=skipped]")?.textContent).toContain("needs your security key");
    expect(dialog?.textContent).toContain("Nothing is remembered");
    await click([...dialog!.querySelectorAll("button")].find((button) => button.textContent?.includes("Allow once (2)")));
    const bulk = fixture.calls.find((call) => call.path === "/api/approvals/bulk");
    expect(bulk?.body).toEqual({ decision: "allow", items: [{ threadId: "t-d", requestId: "req-d" }, { threadId: "t-a", requestId: "req-a" }] });
    expect(Object.keys(bulk!.body as object).sort()).toEqual(["decision", "items"]);
    expect(host.querySelector("[data-bulk-confirm]")).toBeNull();
  });

  it("clears the ticks with Escape", async () => {
    await render();
    await key("x");
    expect(host.querySelector("[data-bulk-bar]")).not.toBeNull();
    await key("Escape");
    expect(host.querySelector("[data-bulk-bar]")).toBeNull();
  });

  it("says nothing waits, calmly, when nothing does", async () => {
    fixture.payload = { pending: [], history: [], scopes: { org: false, team: false } };
    await render();
    const empty = host.querySelector("[data-approvals-empty=calm]");
    expect(empty?.textContent).toContain("Nothing is waiting.");
    expect(host.querySelector("[data-approval-detail]")).toBeNull();
  });

  it("shows the organization and team chips only where they mean something", async () => {
    await render();
    expect(host.querySelector("[data-chip=org]")).toBeNull();
    expect(host.querySelector("[data-chip=team]")).toBeNull();
    act(() => root.unmount());
    root = createRoot(host);
    fixture.payload = { ...fixture.payload, scopes: { org: true, team: true } };
    await render();
    expect(host.querySelector("[data-chip=org]")).not.toBeNull();
    expect(host.querySelector("[data-chip=team]")).not.toBeNull();
  });

  it("reads the History only on its tab, and searches it", async () => {
    fixture.payload = {
      ...fixture.payload,
      history: [
        { at: new Date().toISOString(), decision: "user-approved", who: "Ada", botName: "Nova", tool: "Bash", summary: "pnpm test", threadId: "h1" },
        { at: new Date(Date.now() - 60_000).toISOString(), decision: "user-denied", who: "Bob", botName: "Pixel", tool: "Bash", summary: "rm -rf /", threadId: "h2" },
      ],
    };
    await render();
    expect(fixture.calls.every((call) => call.path === "/api/approvals")).toBe(true);
    await click([...host.querySelectorAll("[role=tab]")].find((tab) => tab.textContent === "History"));
    expect(fixture.calls.some((call) => call.path === "/api/approvals?history=1")).toBe(true);
    const items = () => [...host.querySelectorAll("[data-approvals-history] li")];
    expect(items()).toHaveLength(2);
    expect(items()[0]!.textContent).toContain("by Ada");
    expect(items()[1]!.getAttribute("data-history-decision")).toBe("user-denied");
    const search = host.querySelector<HTMLInputElement>("[data-approvals-history] input")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(search, "bob");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(items()).toHaveLength(1);
    expect(location.hash).toBe("#approvals?tab=history&q=bob");
  });
});
