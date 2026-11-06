import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CHAT_EDGE_FADE_PX, ChatEdgeFade } from "./ChatEdgeFade";

// JC 2026-11-06: the transcript fades out under the header pill and above the
// composer in every chat (bot, group, person), on the chat's own ground.
describe("ChatEdgeFade", () => {
  it("fades the chat ground out below the header, never taking a click", () => {
    const html = renderToStaticMarkup(createElement(ChatEdgeFade, { edge: "top" }));
    expect(html).toContain('data-chat-edge-fade="top"');
    expect(html).toContain("pointer-events-none");
    expect(html).toContain("top-full");
    expect(html).toContain("var(--color-app)");
    expect(CHAT_EDGE_FADE_PX.top).toBeGreaterThanOrEqual(48);
    expect(CHAT_EDGE_FADE_PX.top).toBeLessThanOrEqual(64);
  });

  it("fills behind the composer dock and fades out above it", () => {
    const html = renderToStaticMarkup(createElement(ChatEdgeFade, { edge: "bottom" }));
    expect(html).toContain('data-chat-edge-fade="bottom"');
    expect(html).toContain("pointer-events-none");
    expect(html).toContain("-z-10");
    expect(html).toContain("var(--color-app)");
  });

  it("is wired into the bot chat, the group chat and both composer docks", () => {
    const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
    expect(read("./ChatView.tsx-parts/ChatViewHeader.tsx")).toContain('<ChatEdgeFade edge="top" />');
    expect(read("./GroupView.tsx")).toContain('<ChatEdgeFade edge="top" />');
    expect(read("./ChatView.tsx-parts/ChatViewShell.tsx")).toContain('<ChatEdgeFade edge="bottom" />');
    expect(read("./GroupView.tsx-parts/GroupRoomTranscriptPane.tsx")).toContain('<ChatEdgeFade edge="bottom" />');
  });
});
