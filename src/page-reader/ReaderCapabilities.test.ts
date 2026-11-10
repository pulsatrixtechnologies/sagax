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
    const html = render({ caps: CAPS, reads: [{ name: "team-board", label: "The work of your coding teams" }], approvals: [{ id: 1, name: "team-board", label: "The work of your coding teams" }] });
    expect(html).toContain("data-page-caps-panel");
    expect(html).toContain("The work of your coding teams");
    expect(html).toContain("data-cap-viewer");
    expect(html).toContain("data-cap-open");
    for (const marker of ["data-cap-allow", "data-cap-always", "data-cap-decline"]) expect(html).toContain(marker);
    // the card cannot be waved away while it is pending
    expect(html).not.toContain(`aria-label="${readerText("en", "close")}"`);
  });

  it("shows the destination of a link and waits for a click, never an id", () => {
    const html = render({ caps: CAPS, links: [{ id: 2, url: "https://evil.example/?q=1", host: "evil.example" }] });
    expect(html).toContain("evil.example");
    expect(html).toContain("data-cap-link-open");
    expect(html).toContain("data-cap-link-cancel");
  });
});
