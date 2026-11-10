// The reader's bar: what the page may read, the Ask first card and the link
// confirmation (src/page-reader/ReaderCapabilities.tsx).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { readerText, type ReaderBoot } from "../../shared/page-reader";
import type { CapabilityBroker, CapabilityState } from "./capabilities";
import { ReaderCapabilities } from "./ReaderCapabilities";

const BOOT: ReaderBoot = { v: 1, lang: "en", title: "Board", kind: "html", version: 1, pageId: "page_12345678", me: { id: "pr_a", name: "Ada" }, can: { share: false, annotate: true } };
const CAPS = { data: ["team-board" as const], viewer: true, open: true };

function brokerOf(state: Partial<CapabilityState>): CapabilityBroker {
  const full: CapabilityState = { loaded: true, caps: null, reads: [], approvals: [], links: [], ...state };
  return { getState: () => full, subscribe: () => () => undefined } as unknown as CapabilityBroker;
}
const render = (state: Partial<CapabilityState>, boot: ReaderBoot = BOOT) => renderToStaticMarkup(createElement(ReaderCapabilities, { boot, broker: brokerOf(state) }));

describe("ReaderCapabilities", () => {
  it("draws nothing for a page that declares nothing: the bar is as it was", () => {
    expect(render({ caps: null })).toBe("");
    expect(render({ caps: { data: [], viewer: false, open: false } })).toBe("");
  });

  it("shows a button with an accessible name, closed until it is clicked", () => {
    const html = render({ caps: CAPS, reads: [{ name: "team-board", label: "The work of your coding teams" }] });
    expect(html).toContain("data-reader-caps");
    expect(html).toContain(`aria-label="${readerText("en", "capReads")}"`);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("data-page-caps-panel");
  });

  it("opens by itself on an Ask first card, which has Allow, Always allow and Decline and shows what is read", () => {
    const html = render({ caps: CAPS, reads: [{ name: "team-board", label: "The work of your coding teams" }], approvals: [{ id: 1, name: "team-board", label: "The work of your coding teams", at: 0 }] });
    expect(html).toContain("data-page-caps-panel");
    expect(html).toContain("The work of your coding teams");
    expect(html).toContain("data-cap-viewer");
    expect(html).toContain("data-cap-open");
    for (const marker of ["data-cap-allow", "data-cap-always", "data-cap-decline"]) expect(html).toContain(marker);
    // the card cannot be waved away while it is pending
    expect(html).not.toContain(`aria-label="${readerText("en", "close")}"`);
  });

  it("shows the whole address of a link, host first, query and fragment visible, and offers Always allow this site", () => {
    const url = "https://evil.example/path?d=secret-board#frag";
    const html = render({ caps: CAPS, links: [{ id: 2, url, host: "evil.example", rest: "/path?d=secret-board#frag", always: true, at: 0 }] });
    expect(html).toMatch(/<strong[^>]*data-cap-host[^>]*>evil\.example<\/strong>/);
    expect(html).toContain("/path?d=secret-board#frag");
    for (const marker of ["data-cap-link-open", "data-cap-link-cancel", "data-cap-link-always"]) expect(html).toContain(marker);
    expect(html).toContain("any address of this site");
    expect(html).not.toContain("data-cap-more");
  });

  it("cuts a long address in the middle with a way to see it all, and shows no Always allow when it is not offered", () => {
    const url = `https://evil.example/?d=${"x".repeat(400)}END`;
    const html = render({ caps: CAPS, links: [{ id: 2, url, host: "evil.example", rest: url.slice(19), always: false, at: 0 }] });
    expect(html).toContain("data-cap-more");
    expect(html).toContain("…");
    expect(/<code[^>]*data-cap-rest[^>]*>([^<]*)<\/code>/.exec(html)![1]!.length).toBeLessThan(130);
    expect(html).not.toContain("data-cap-link-always");
  });
});
