// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/state/store";
import { XHeldDraft, heldXDraftOf } from "./XHeldDraft";

const dispatch = vi.fn();
const api = vi.fn(async () => ({}));
vi.mock("@/state/store", async (original) => ({ ...(await original<typeof import("@/state/store")>()), useStore: () => ({ dispatch }), api: (...args: unknown[]) => (api as (...a: unknown[]) => unknown)(...args) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const held = (tool: string, input: unknown, extra: Record<string, unknown> = {}) => ({
  id: "m1", role: "bot", kind: "options", from: { botId: "b1", name: "Bot" },
  card: { title: "Approval needed", options: ["Allow", "Deny"], requestId: "req-1", tool, toolInput: JSON.stringify(input), ...extra },
}) as unknown as Message;

describe("held X post call as the draft card (#4638)", () => {
  it("is the draft only for an X post call the person answers", () => {
    expect(heldXDraftOf(held("mcp__x__create_post", { text: "Hi" }))).toEqual({ text: "Hi" });
    expect(heldXDraftOf(held("mcp__x__get_posts", { text: "Hi" }))).toBeNull();
    expect(heldXDraftOf(held("mcp__x__create_post", { text: "Hi" }, { adminApproval: true }))).toBeNull();
    expect(heldXDraftOf(undefined)).toBeNull();
  });

  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  it("renders the same card in the pinned card and the inbox, with Post and Discard", () => {
    const decided = vi.fn();
    act(() => root.render(createElement(XHeldDraft, {
      message: held("mcp__x__create_post", { text: "A sample post" }), threadId: "t1", requestId: "req-1", onDecided: decided,
    })));
    expect(host.querySelector("[data-x-draft]")).not.toBeNull();
    expect(host.querySelector("[data-x-editor]")).not.toBeNull();
    expect(host.querySelector("[data-x-discard]")).not.toBeNull();
    expect(host.querySelector("[data-x-post-button]")).not.toBeNull();
    expect(host.textContent).not.toContain("Allow once");
  });

  const show = (decided = vi.fn(), failed = vi.fn()) => {
    act(() => root.render(createElement(XHeldDraft, { message: held("mcp__x__create_post", { text: "A sample post" }), threadId: "t1", requestId: "req-1", onDecided: decided, onDecideFailed: failed })));
    return decided;
  };

  it("Post allows that very call, Discard refuses it", () => {
    dispatch.mockClear();
    const decided = show();
    act(() => (host.querySelector("[data-x-post-button]") as HTMLButtonElement).click());
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "decideRequest", threadId: "t1", requestId: "req-1", behavior: "allow" }));
    expect(decided).toHaveBeenCalledWith("allow");
    dispatch.mockClear();
    act(() => (host.querySelector("[data-x-discard]") as HTMLButtonElement).click());
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ behavior: "deny" }));
  });

  it("an edited Post refuses the held call and posts the new text through the draft route", () => {
    dispatch.mockClear();
    api.mockClear();
    show();
    const editor = host.querySelector("[data-x-editor]") as HTMLTextAreaElement;
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      set.call(editor, "A changed post");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => (host.querySelector("[data-x-post-button]") as HTMLButtonElement).click());
    expect(api).toHaveBeenCalledWith(expect.stringContaining("/x-posts/post"), expect.objectContaining({ method: "POST", body: expect.stringContaining("A changed post") }));
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ behavior: "deny" }));
  });
});
