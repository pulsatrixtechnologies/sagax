import { describe, expect, it } from "vitest";

import { withoutIds } from "@/lib/approvals-inbox";
import { inboxKeyAction, moveSelection, selectionAfterRemoval } from "./inbox-keys";

const at = (selector: string | null) => ({ closest: (wanted: string) => (selector && wanted.split(", ").includes(selector) ? {} : null) });

describe("inboxKeyAction", () => {
  it("maps Y, N, J, K, the arrows, Enter, Escape and X", () => {
    expect(["y", "Y", "n", "j", "ArrowDown", "k", "ArrowUp", "Enter", "Escape", "x"].map((key) => inboxKeyAction({ key }))).toEqual(
      ["allow", "allow", "deny", "next", "next", "previous", "previous", "open", "close", "toggle"],
    );
    expect(inboxKeyAction({ key: "a" })).toBeNull();
  });

  it("leaves a key to a field, a question's choices, a dialog or a menu, and to shortcuts with a modifier", () => {
    for (const selector of ["input", "textarea", "[data-ask-choice]", "[role='dialog']", "[role='menu']"]) {
      expect(inboxKeyAction({ key: "y", target: at(selector) as unknown as EventTarget })).toBeNull();
    }
    expect(inboxKeyAction({ key: "y", target: at(null) as unknown as EventTarget })).toBe("allow");
    expect(inboxKeyAction({ key: "y", metaKey: true })).toBeNull();
    expect(inboxKeyAction({ key: "n", ctrlKey: true })).toBeNull();
    expect(inboxKeyAction({ key: "y", isComposing: true })).toBeNull();
    expect(inboxKeyAction({ key: "y", defaultPrevented: true })).toBeNull();
    expect(inboxKeyAction({ key: "Enter", shiftKey: true })).toBeNull();
    // Enter on a focused button, link or tab presses it, never opens the card
    for (const selector of ["button", "a", "[role='button']", "[role='tab']"]) {
      expect(inboxKeyAction({ key: "Enter", target: at(selector) as unknown as EventTarget })).toBeNull();
    }
    expect(inboxKeyAction({ key: "Enter", target: at(null) as unknown as EventTarget })).toBe("open");
  });
});

describe("selection", () => {
  it("moves within the list and stops at its ends", () => {
    expect(moveSelection(["a", "b", "c"], "a", 1)).toBe("b");
    expect(moveSelection(["a", "b", "c"], "c", 1)).toBe("c");
    expect(moveSelection(["a", "b", "c"], "a", -1)).toBe("a");
    expect(moveSelection(["a", "b"], null, 1)).toBe("a");
    expect(moveSelection(["a", "b"], null, -1)).toBe("b");
    expect(moveSelection([], "a", 1)).toBeNull();
  });

  it("lands on the card that took the answered one's place", () => {
    expect(selectionAfterRemoval(["a", "b", "c"], "b")).toBe("c");
    expect(selectionAfterRemoval(["a", "b", "c"], "c")).toBe("b");
    expect(selectionAfterRemoval(["a"], "a")).toBeNull();
  });
});

describe("withoutIds", () => {
  it("takes every raw identifier out of a line", () => {
    expect(withoutIds("open 3f2b8c1e-9a4d-4e6b-8f1a-2c3d4e5f6a7b now")).toBe("open … now");
    expect(withoutIds("commit 0123456789abcdef0123 done")).toBe("commit … done");
    expect(withoutIds("person pr_ab12cd34ef56 asked")).toBe("person … asked");
    expect(withoutIds("git  push\n origin main")).toBe("git push origin main");
  });
});
