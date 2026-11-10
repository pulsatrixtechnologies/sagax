// A page with no capabilities block gets exactly today's frame document
// (#3413): the hashes below were taken on origin/main before the bridge
// existed. A page that declares capabilities gets them on window.sagax, and
// still only talks to its parent.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { pageCapabilitiesOf } from "../../shared/page-capabilities.ts";
import { capabilityBridgeSource, pageDocument, STATE_BRIDGE_SOURCE, stateBridgeSource } from "./published-pages-render.ts";

const HTML = `<!doctype html><html><head><title>t</title></head><body><h1>Board</h1><script>document.body.dataset.x="1"</script></body></html>`;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

describe("page capabilities in the frame", () => {
  it("leaves a page with no block byte identical, reading frame and preview", () => {
    const caps = pageCapabilitiesOf(HTML);
    expect(caps).toBeNull();
    const reading = pageDocument({ kind: "html", title: "T", content: HTML, lang: "en" }, { nonce: "n0nce", reportSize: true, font: "", capabilities: caps });
    const preview = pageDocument({ kind: "html", title: "T", content: HTML, lang: "en" }, { nonce: "n0nce", font: "", capabilities: caps });
    expect(sha(reading)).toBe("3626be6a38b7ced2609ae097f64541cbe505df9274588710e3227f6ea268aa61");
    expect(sha(preview)).toBe("d4d986cf109715594313d65e476e273ebb95b2a37da818ee4415d99a3770bee5");
    expect(stateBridgeSource(null)).toBe(STATE_BRIDGE_SOURCE);
  });

  it("puts the declared capabilities beside the state, posting to the parent only", () => {
    const html = HTML.replace("<body>", `<body><script type="application/sagax-capabilities+json">{ "data": ["team-board", "other"], "viewer": true }</script>`);
    const caps = pageCapabilitiesOf(html)!;
    expect(caps).toEqual({ data: ["team-board"], viewer: true, open: false });
    const bridge = stateBridgeSource(caps);
    expect(bridge).not.toBe(STATE_BRIDGE_SOURCE);
    expect(bridge).toContain(`var C={"data":["team-board"],"viewer":true,"open":false}`);
    expect(bridge).toContain("Object.assign({page:Object.freeze(page)},caps)");
    expect(bridge).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket|window\.top/);
    const reading = pageDocument({ kind: "html", title: "T", content: html, lang: "en" }, { nonce: "n0nce", reportSize: true, font: "", capabilities: caps });
    expect(reading).toContain(bridge);
    const preview = pageDocument({ kind: "html", title: "T", content: html, lang: "en" }, { nonce: "n0nce", font: "", capabilities: caps });
    expect(preview).toContain(capabilityBridgeSource(caps));
  });

  it("ignores a wildcard or an unknown name", () => {
    expect(pageCapabilitiesOf(`<script type="application/sagax-capabilities+json">{"data":["*","team-*"]}</script>`)).toEqual({ data: [], viewer: false, open: false });
  });
});
