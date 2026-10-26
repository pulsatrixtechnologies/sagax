import { describe, expect, it } from "vitest";

import { artifactBridge, buildArtifactDocument, scriptJson } from "./artifact-document";
import { WIDGET_CSP } from "./rich-blocks";

describe("an artifact's document", () => {
  it("keeps the widget sandbox: the CSP first, before the bridge and the widget", () => {
    const doc = buildArtifactDocument("<div id=x></div><script>window.sagax.onData(function(d){x.textContent=d.n})</script>", "dark", "", { value: { n: 3 }, at: 5 });
    const csp = doc.indexOf(WIDGET_CSP);
    const bridge = doc.indexOf("Object.defineProperty(window,\"sagax\"");
    const widget = doc.indexOf("<div id=x>");
    expect(csp).toBeGreaterThan(0);
    expect(csp).toBeLessThan(bridge);
    expect(bridge).toBeLessThan(widget);
    expect(doc).toContain('data:{"n":3},updatedAt:5');
    expect(WIDGET_CSP).toContain("connect-src 'none'");
  });

  it("listens to its parent only, for one message type", () => {
    const bridge = artifactBridge(null, null);
    expect(bridge).toContain("if(event.source!==parent)return;");
    expect(bridge).toContain('m.type!=="sagax-artifact-data"');
    expect(bridge).toContain('parent.postMessage({type:"sagax-artifact-error"}');
    expect(bridge).toContain("data:null,updatedAt:null");
  });

  it("writes data that can never close its script tag", () => {
    const text = scriptJson({ html: "</script><script>alert(1)</script>", line: "a b" });
    expect(text).not.toContain("</script>");
    expect(text).not.toContain(" ");
    expect(JSON.parse(text)).toEqual({ html: "</script><script>alert(1)</script>", line: "a b" });
  });
});
