// @vitest-environment happy-dom
// The prelude of every HTML page (FRAME_PRELUDE in
// server/pages/published-pages-render.ts), run here in a DOM: WebRTC gone for good,
// and a resource hint or a speculation-rules script neutered synchronously,
// before it is in the document, whichever way a script makes it; no nested
// frame can be created. The cross-browser run (PR #646) checks the real thing.
import { expect, it } from "vitest";

import { FRAME_PRELUDE, neuterPageHtml } from "./published-pages-render.ts";

// The server's TypeScript has no DOM library: the happy-dom globals are read loosely.
const document = (globalThis as any).document;
const window = globalThis as any;

const body = /<script>([\s\S]*)<\/script>$/.exec(FRAME_PRELUDE)![1]!;
window.RTCPeerConnection = class {};
window.webkitRTCPeerConnection = class {};
new Function(body)();

const hints = () => [...document.querySelectorAll("link")].filter((link: any) => /prerender|prefetch|preconnect|preload/i.test(link.getAttribute("rel") ?? ""));

it("starts by turning DNS prefetching off", () => {
  expect(FRAME_PRELUDE.startsWith('<meta http-equiv="x-dns-prefetch-control" content="off">')).toBe(true);
});

it("removes WebRTC for good", () => {
  expect(window.RTCPeerConnection).toBeUndefined();
  expect(window.webkitRTCPeerConnection).toBeUndefined();
  expect(() => { window.RTCPeerConnection = class {}; }).toThrow();
  expect(Object.getOwnPropertyDescriptor(window, "RTCPeerConnection")?.configurable).toBe(false);
});

it("neuters a link hint set by property, attribute or token list, before insertion", () => {
  const a = document.createElement("link");
  a.rel = "prerender";
  expect(a.getAttribute("rel") ?? "").toBe("");
  const b = document.createElement("link");
  b.setAttribute("rel", "PreFetch");
  expect(b.getAttribute("rel")).toBe("");
  const c = document.createElement("link");
  c.relList.add("preconnect");
  expect(c.getAttribute("rel") ?? "").toBe("");
  document.head.append(a, b, c);
  expect(hints()).toHaveLength(0);
});

it("neuters links and speculation rules in HTML strings and in moved nodes", () => {
  document.head.insertAdjacentHTML("beforeend", '<link rel=prefetch href="https://evil.example/a"><link rel=prerender href="https://evil.example/b">');
  document.body.innerHTML = '<div><link rel="dns-prefetch" href="//evil.example"></div><script type="speculationrules">{}</script>';
  expect(hints()).toHaveLength(0);
  expect(document.querySelector("script")?.getAttribute("type")).not.toMatch(/^speculationrules$/i);
  const s = document.createElement("script");
  s.type = "speculationrules";
  expect(s.getAttribute("type")).toBe("text/plain");
  const frag = document.createDocumentFragment();
  const raw = document.createElement("div");
  frag.appendChild(raw);
  expect(hints()).toHaveLength(0);
});

it("creates no nested frame, by element or by HTML", () => {
  expect(document.createElement("iframe").localName).toBe("sagax-removed-iframe");
  document.body.insertAdjacentHTML("beforeend", "<iframe srcdoc='<p>x</p>'></iframe><object></object>");
  expect(document.querySelectorAll("iframe,object")).toHaveLength(0);
});

it("the patched methods and setters cannot be put back", () => {
  const proto = window.Element.prototype;
  expect(Object.getOwnPropertyDescriptor(window.Node.prototype, "appendChild")?.configurable).toBe(false);
  expect(Object.getOwnPropertyDescriptor(proto, "setAttribute")?.writable).toBe(false);
  expect(() => Object.defineProperty(proto, "setAttribute", { value: () => undefined })).toThrow();
  expect(Object.getOwnPropertyDescriptor(window.HTMLLinkElement.prototype, "rel")?.configurable).toBe(false);
});

it("the server neuters the same things in the stored HTML", () => {
  const out = neuterPageHtml('<link rel=prerender href=x><LINK\nrel="preconnect"><iframe src=x></iframe><script type="speculationrules">{}</script><script>var s="<link rel=prefetch>"</script>');
  expect(out).not.toMatch(/<link[\s>]/i);
  expect(out).not.toMatch(/<iframe[\s>]/i);
  expect(out).not.toMatch(/type="speculationrules"/i);
  expect(out).toContain("<sagax-removed-link rel=prerender href=x>");
});
