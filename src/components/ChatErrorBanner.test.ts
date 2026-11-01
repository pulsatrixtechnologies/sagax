import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ChatErrorBanner, ChatNotice, ChatReconnectBanner } from "./ChatErrorBanner";

const source = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

describe("ChatReconnectBanner", () => {
  it("shows a calm reconnecting line only during a short post-connect outage", () => {
    expect(renderToStaticMarkup(createElement(ChatReconnectBanner, {
      connected: true, everConnected: true, disconnectedAt: null,
    }))).toBe("");
    expect(renderToStaticMarkup(createElement(ChatReconnectBanner, {
      connected: false, everConnected: false, disconnectedAt: Date.now(),
    }))).toBe("");
    const markup = renderToStaticMarkup(createElement(ChatReconnectBanner, {
      connected: false, everConnected: true, disconnectedAt: Date.now() - 1_000,
    }));
    expect(markup).toContain('role="status"');
    expect(markup).toContain("data-chat-reconnecting");
    expect(markup).toContain("Reconnecting");
    expect(markup).not.toContain("role=\"alert\"");
  });

  it("is mounted in the chat and the room", () => {
    for (const file of ["components/ChatView.tsx", "components/GroupView.tsx"]) {
      expect(source(file)).toContain("<ChatReconnectBanner");
    }
  });
});

describe("ChatErrorBanner", () => {
  it("renders nothing when there is no error", () => {
    expect(renderToStaticMarkup(createElement(ChatErrorBanner, { message: null, onDismiss: () => undefined }))).toBe("");
  });

  it("announces the error and offers a dismiss control", () => {
    const onDismiss = vi.fn();
    const markup = renderToStaticMarkup(createElement(ChatErrorBanner, { message: "Clipboard has no image", onDismiss }));
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Clipboard has no image");
    expect(markup).toContain('aria-label="Dismiss"');
    expect(markup).toContain('type="button"');
    expect(markup).toContain("border-danger/30");
  });

  it("reads a machine's words as one plain line and keeps them under Details", () => {
    const markup = renderToStaticMarkup(createElement(ChatErrorBanner, { message: "502 Bad Gateway", onDismiss: () => undefined }));
    expect(markup).toContain("Something went wrong on the other end. Try again.");
    expect(markup).toContain("<details");
    expect(markup).toContain(">Details</summary>");
    expect(markup).toContain("502 Bad Gateway");
  });

  it("shows a sentence as it is, with nothing to expand", () => {
    const markup = renderToStaticMarkup(createElement(ChatErrorBanner, { message: "Clipboard has no image", onDismiss: () => undefined }));
    expect(markup).not.toContain("<details");
  });

  it("wraps a long message instead of widening the banner", () => {
    const markup = renderToStaticMarkup(createElement(ChatErrorBanner, { message: "Failed to fetch", onDismiss: () => undefined }));
    expect(markup).toContain('class="min-w-0 flex-1 break-words"');
  });

  it("is the banner both the chat and the room render", () => {
    for (const file of ["components/ChatView.tsx", "components/GroupView.tsx"]) {
      const text = source(file);
      expect(text).toContain("<ChatErrorBanner");
      expect(text).toContain('message={state.error}');
      expect(text).toContain('dispatch({ type: "error", message: null })');
    }
    const store = source("state/store.tsx");
    expect(store).toContain("useChatErrorClear(state.error, clearChatError)");
    expect(store).not.toContain('setTimeout(() => rawDispatch({ type: "error", message: null }), 6000)');
  });
});

describe("ChatNotice", () => {
  const markup = (notice: Parameters<typeof ChatNotice>[0]["notice"]) => renderToStaticMarkup(createElement(ChatNotice, { notice }));

  it("says which reference no longer resolves", () => {
    expect(markup(null)).toBe("");
    expect(markup({ kind: "thread-gone", botName: null })).toContain("That thread is no longer here.");
    expect(markup({ kind: "thread-gone", botName: "Ada" })).toContain("That thread is no longer here. Showing Ada instead.");
    expect(markup({ kind: "bot-gone", botName: null })).toContain("That bot is no longer here.");
    expect(markup({ kind: "bot-gone", botName: null })).toContain('role="status"');
  });

  it("shows in the room as well as the chat", () => {
    for (const file of ["components/ChatView.tsx", "components/GroupView.tsx"]) {
      expect(source(file)).toContain("<ChatNotice notice={state.notice} />");
    }
  });
});

// 2026-10-22 (owner): no "Showing saved messages" banner with an X over the chat.
describe("no saved-messages banner", () => {
  it("neither the chat nor a room draws it", async () => {
    const banners = await import("./ChatErrorBanner");
    expect("SavedMessagesNotice" in banners).toBe(false);
    for (const file of ["components/ChatView.tsx", "components/GroupView.tsx", "components/ChatErrorBanner.tsx"]) {
      expect(source(file), file).not.toContain("chat.savedMessages");
    }
  });
});
