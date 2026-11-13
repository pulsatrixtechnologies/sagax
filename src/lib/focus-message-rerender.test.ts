// @vitest-environment happy-dom
// Opening a search result: the matched word stays highlighted when the
// message re-renders right after the focus (its text nodes are replaced).
import type { EffectCallback } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ effect: null as EffectCallback | null, dispatch: vi.fn() }));
vi.mock("react", () => ({ useEffect: (effect: EffectCallback) => { fixture.effect = effect; } }));
vi.mock("@/state/store", () => ({ api: vi.fn() }));
vi.mock("@/state/store-selector", () => {
  const state = { focusMessage: { threadId: "thread", messageId: "message", matchText: "zebra", nonce: 1, consumed: false } };
  return {
    useStoreSelector: (select: (current: typeof state) => unknown) => select(state),
    useStoreDispatch: () => fixture.dispatch,
  };
});

import { useFocusMessage } from "./focus-message";

let cleanup: (() => void) | undefined;
let highlights: Map<string, { range: Range }>;

function renderMessage(text: string) {
  document.body.innerHTML = `<div class="overflow-y-auto"><div data-mid="message"><div data-chat-bubble><div class="chat-md"><p>${text}</p></div></div></div></div>`;
}

function highlighted(): string | null {
  const range = highlights.get("search-result-text")?.range;
  if (!range || !range.startContainer.isConnected || !range.endContainer.isConnected) return null;
  return range.toString();
}

beforeEach(() => {
  highlights = new Map();
  vi.stubGlobal("CSS", { escape: (value: string) => value, highlights });
  vi.stubGlobal("Highlight", class { constructor(readonly range: Range) {} });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup?.(); cleanup = undefined; vi.unstubAllGlobals(); document.body.innerHTML = ""; });

describe("search result highlight after a re-render", () => {
  it("rebuilds the highlight on the message's new text nodes", async () => {
    renderMessage("a striped zebra crossed");
    useFocusMessage("thread", true);
    cleanup = fixture.effect!() as () => void;
    expect(highlighted()).toBe("zebra");

    // the message re-renders right after the focus: same text, new nodes
    renderMessage("a striped zebra crossed");
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(highlighted()).toBe("zebra");
  });

  it("stops following the message once the focus ends", async () => {
    renderMessage("a striped zebra crossed");
    useFocusMessage("thread", true);
    cleanup = fixture.effect!() as () => void;
    cleanup();
    cleanup = undefined;
    renderMessage("a striped zebra crossed");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(highlights.has("search-result-text")).toBe(false);
  });
});
