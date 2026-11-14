// The reader's bar: what the page may read, the Ask first card and the link
// confirmation (src/page-reader/ReaderCapabilities.tsx).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { readerText, type ReaderBoot } from "../../shared/page-reader";
import type { CapabilityBroker, CapabilityState } from "./capabilities";
import { ReaderCapabilities } from "./ReaderCapabilities";

const BOOT: ReaderBoot = { v: 1, lang: "en", title: "Board", kind: "html", version: 1, pageId: "page_12345678", me: { id: "pr_a", name: "Ada" }, can: { share: false, annotate: true } };
const CAPS = { data: ["team-board" as const], viewer: true, open: true, files: [] };

function brokerOf(state: Partial<CapabilityState>): CapabilityBroker {
  const full: CapabilityState = { loaded: true, caps: null, reads: [], approvals: [], links: [], ...state };
  return { getState: () => full, subscribe: () => () => undefined } as unknown as CapabilityBroker;
}
const render = (state: Partial<CapabilityState>, boot: ReaderBoot = BOOT) => renderToStaticMarkup(createElement(ReaderCapabilities, { boot, broker: brokerOf(state) }));

describe("ReaderCapabilities", () => {
  it("draws nothing for a page that declares nothing: the bar is as it was", () => {
    expect(render({ caps: null })).toBe("");
    expect(render({ caps: { data: [], viewer: false, open: false, files: [] } })).toBe("");
  });

  it("shows a button with an accessible name, closed until it is clicked", () => {
    const html = render({ caps: CAPS, reads: [{ name: "team-board", label: "The work of your coding teams" }] });
    expect(html).toContain("data-reader-caps");
    expect(html).toContain(`aria-label="${readerText("en", "capReads")}"`);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("data-page-caps-panel");
  });

  it("opens by itself on an Ask first card, which has Allow, Always allow and Decline and shows what is read", () => {
    const html = render({ caps: CAPS, reads: [{ name: "team-board", label: "The work of your coding teams" }], approvals: [{ id: 1, name: "team-board", label: "The work of your coding teams", at: 0, by: "org" as const, always: true }] });
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

describe("a file the page hands the reader", () => {
  it("shows one row, in the reader language", () => {
    const caps = { data: [], viewer: false, open: false, files: ["download"] } as NonNullable<CapabilityState["caps"]>;
    const pending = { approvals: [{ id: 1, name: "file", label: "pending", at: 0, by: "org" as const, always: true }] };
    const en = render({ caps, ...pending });
    expect(en.match(/A file it hands you/g)).toEqual(["A file it hands you"]);
    const fr = render({ caps, ...pending }, { ...BOOT, lang: "fr" });
    expect(fr.match(/Un fichier que cette page te remet/g)).toEqual(["Un fichier que cette page te remet"]);
    expect(fr).not.toContain("A file it hands you");
  });
});

describe("what a page keeps, asks and calls (#3413 lots 3 to 7)", () => {
  const ALL = {
    data: [], viewer: false, open: false, files: ["add" as const],
    store: { votes: { write: "signed_in" as const, scope: "shared" as const }, prefs: { write: "signed_in" as const, scope: "reader" as const } },
    model: true as const, propose: true as const, connectors: { GitHub: ["create_issue"] },
  };

  it("lists each of them in the panel, nothing invisible", () => {
    const html = render({ caps: ALL, approvals: [{ id: 1, name: "connector:GitHub__create_issue", label: "GitHub: create_issue (Ada account)", at: 0, by: "page" as const, always: true }] });
    for (const marker of ["data-cap-files-add", "data-cap-store", "data-cap-store-mine", "data-cap-model", "data-cap-propose", "data-cap-connector"]) expect(html).toContain(marker);
    expect(html).toContain("GitHub with your account: create_issue");
  });

  it("words a change the page asks for apart from a read, on the reader's own card", () => {
    const html = render({ caps: ALL, approvals: [{ id: 1, name: "connector:GitHub__create_issue", label: "GitHub: create_issue (Ada account)", at: 0, by: "page" as const, always: true }] });
    expect(html).toContain(readerText("en", "capAct"));
    expect(html).toContain("It wants to use, with your account: GitHub: create_issue (Ada account)");
    expect(html).not.toContain(readerText("en", "capAsk"));
    const french = render({ caps: ALL, approvals: [{ id: 1, name: "model", label: "une question à un modèle", at: 0, by: "org" as const, always: true }] }, { ...BOOT, lang: "fr" });
    expect(french).toContain("Ton organisation te demande d&#x27;abord.");
    expect(french).toContain("Elle veut utiliser, avec ton compte : une question à un modèle");
  });

  it("says who asks: the organization's rule or the reader's own, not the page", () => {
    const card = (by: "org" | "person") => render({ caps: ALL, approvals: [{ id: 1, name: "connector:GitHub__create_issue", label: "GitHub: create_issue (Ada account)", at: 0, by, always: true }] });
    expect(card("org")).toContain(readerText("en", "capAsk"));
    expect(card("org")).not.toContain(readerText("en", "capAct"));
    expect(card("person")).toContain(readerText("en", "capOwnAsk"));
    expect(card("person")).not.toContain(readerText("en", "capAct"));
  });

  it("hides Always allow while the organization turned it off", () => {
    const on = render({ caps: ALL, approvals: [{ id: 1, name: "connector:GitHub__create_issue", label: "x", at: 0, by: "page", always: true }] });
    const off = render({ caps: ALL, approvals: [{ id: 1, name: "connector:GitHub__create_issue", label: "x", at: 0, by: "page", always: false }] });
    expect(on).toContain("data-cap-always");
    expect(off).not.toContain("data-cap-always");
    expect(off).toContain("data-cap-allow");
  });

  it("titles the panel by what the page may do, and keeps the read title for a page that only reads", () => {
    expect(render({ caps: ALL, approvals: [{ id: 1, name: "model", label: "x", at: 0, by: "org", always: true }] })).toContain(`<h2>${readerText("en", "capTitleDo")}</h2>`);
    expect(render({ caps: CAPS, approvals: [{ id: 1, name: "team-board", label: "x", at: 0, by: "org", always: true }] })).toContain(`<h2>${readerText("en", "capTitle")}</h2>`);
    expect(render({ caps: ALL, approvals: [{ id: 1, name: "model", label: "x", at: 0, by: "org", always: true }] })).toContain(readerText("en", "capScopeDo"));
    expect(render({ caps: CAPS, approvals: [{ id: 1, name: "team-board", label: "x", at: 0, by: "org", always: true }] })).toContain(readerText("en", "capScope"));
  });
});
