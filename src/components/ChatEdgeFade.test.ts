import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CHAT_EDGE_FADE_PX, ChatEdgeFade } from "./ChatEdgeFade";

// JC 2026-11-06: the transcript fades out under the header pill and above the
// composer in every chat (bot, group, person), on the chat's own ground.
describe("ChatEdgeFade", () => {
  it("veils the transcript behind the floating header, never an opaque band or a click", () => {
    const html = renderToStaticMarkup(createElement(ChatEdgeFade, { edge: "top" }));
    expect(html).toContain('data-chat-edge-fade="top"');
    expect(html).toContain("pointer-events-none");
    expect(html).toContain("top-0");
    expect(html).toContain("-z-10");
    expect(html).toContain("var(--color-app)");
    expect(html).toContain("transparent");
    expect(CHAT_EDGE_FADE_PX.top).toBeGreaterThanOrEqual(16);
    expect(CHAT_EDGE_FADE_PX.top).toBeLessThanOrEqual(32);
  });

  it("fills behind the composer dock and fades out above it", () => {
    const html = renderToStaticMarkup(createElement(ChatEdgeFade, { edge: "bottom" }));
    expect(html).toContain('data-chat-edge-fade="bottom"');
    expect(html).toContain("pointer-events-none");
    expect(html).toContain("-z-10");
    expect(html).toContain("var(--color-app)");
  });

  it("is wired into the bot chat, the group chat and both composer docks", () => {
    // The header floats over the transcript (Grok Bot): no ground of its
    // own, in the bot chat and the group chat alike (JC 2026-11-06).
    const header = (src: string) => /"@container\/chathead[^"]*"/.exec(src)?.[0] ?? "";
    const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
    // One shared bar (ChatHeaderBar) carries the top fade for every chat view.
    expect(read("./ChatHeaderBar.tsx")).toContain('<ChatEdgeFade edge="top" />');
    expect(read("./ChatHeaderBar.tsx")).toContain('<ChatEdgeFade edge="bottom" />');
    expect(read("./ChatView.tsx-parts/ChatViewHeader.tsx")).toContain("<ChatHeaderBar");
    expect(read("./GroupView.tsx")).toContain("<ChatHeaderBar");
    expect(read("./ChatView.tsx-parts/ChatViewShell.tsx")).toContain('<ChatEdgeFade edge="bottom" />');
    expect(read("./GroupView.tsx-parts/GroupRoomTranscriptPane.tsx")).toContain('<ChatEdgeFade edge="bottom" />');
    const cls = header(read("./ChatHeaderBar.tsx"));
    expect(cls).toContain("absolute");
    expect(cls).not.toMatch(/\bbg-/);
    expect(read("./GroupView.tsx-parts/GroupRoomTranscriptPane.tsx")).toContain('"pt-14"');
  });
});
