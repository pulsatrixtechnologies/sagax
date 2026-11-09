import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CHAT_EDGE_FADE_PX, ChatEdgeFade } from "./ChatEdgeFade";

// the owner 2026-11-06: the transcript fades out under the header pill and above the
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
    // The header floats over the transcript (the reference app): no ground of its
    // own, in the bot chat and the group chat alike (the owner 2026-11-06).
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

  it("stays off the flat navy header band of Pulsatrix Light (#3039)", () => {
    // There the header is a band with its own ground, not a pill floating over
    // the transcript: the fade would smear the light chat ground over it.
    const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    expect(css).toMatch(/\[data-skin="pulsatrix-light"\] \.content-topbar > \[data-chat-edge-fade="top"\] \{\s*display: none;/);
    // The phone drawer button over that band takes the band's ink.
    expect(css).toMatch(/\[data-skin="pulsatrix-light"\] \.app-shell-row:has\(\.content-topbar\) > \[data-drawer-button\] \{\s*color: var\(--color-sidebar-ink-secondary\);/);
  });
});
