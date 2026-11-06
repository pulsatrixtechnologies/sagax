import { describe, expect, it } from "vitest";

import {
  antArtifactToMarkdown,
  claudeArtifactCopyPrompt,
  claudeArtifactOtherAccountGuidance,
  claudeArtifactUrl,
  formatArtifactConsentFence,
  formatArtifactFence,
  isArtifactConsentRefusal,
  isArtifactTool,
  isSafeHttpUrl,
  liftClaudeChatBlocks,
  parseArtifactConsent,
  parseArtifactPage,
  parseArtifactPublish,
} from "./claude-chat-blocks.ts";
import { isArtifactRead, permissionRoute } from "./searched-tool-call.ts";

describe("#2018 artifact helpers", () => {
  it("reads the structured tool_use_result of a real publish", () => {
    expect(parseArtifactPublish({
      url: "https://claude.ai/artifact/HBXTc3TAqqC5odi1H6Bgu9", path: "/tmp/p.html", artifact_id: "x",
      title: "Sagax probe", updated: false, owned: true, icon: "code",
    })).toEqual({ title: "Sagax probe", url: "https://claude.ai/artifact/HBXTc3TAqqC5odi1H6Bgu9", icon: "code", path: "/tmp/p.html", owned: true });
  });

  it("keeps only canonical claude.ai artifact links", () => {
    expect(claudeArtifactUrl("https://claude.ai/artifact/HBXTc3TAqqC5odi1H6Bgu9?x=1")).toBe("https://claude.ai/artifact/HBXTc3TAqqC5odi1H6Bgu9");
    expect(claudeArtifactUrl("https://www.claude.ai/code/artifact/abcdef12-3456")).toBe("https://claude.ai/code/artifact/abcdef12-3456");
    expect(claudeArtifactUrl("https://evil.example/artifact/HBXTc3TAqqC5odi1H6Bgu9")).toBeNull();
    expect(claudeArtifactUrl("https://claude.ai/chat/HBXTc3TAqqC5odi1H6Bgu9")).toBeNull();
  });

  it("Lot 1 republish prompts: copy chat and other_account tool guidance", () => {
    const url = "https://claude.ai/artifact/HBXTc3TAqqC5odi1H6Bgu9";
    const copy = claudeArtifactCopyPrompt(url);
    expect(copy).toContain(url);
    expect(copy).toContain("claude_artifact");
    expect(copy).toContain("fichier HTML");
    expect(copy).toContain("nouvelle URL");
    expect(copy).not.toMatch(/[\u2013\u2014]/);
    const guidance = claudeArtifactOtherAccountGuidance("bot@example.com");
    expect(guidance).toContain("bot@example.com");
    expect(guidance).toContain("cannot Artifact-read");
    expect(guidance).toContain("HTML file");
    expect(guidance).toContain("new URL");
    expect(guidance).not.toMatch(/[\u2013\u2014]/);
    expect(claudeArtifactOtherAccountGuidance()).not.toContain("Claude account is");
  });

  it("recognises the consent refusal and round-trips its fence", () => {
    expect(isArtifactConsentRefusal("Error: Claude couldn't check who made this artifact. Let Claude read it?")).toBe(true);
    expect(isArtifactConsentRefusal("Published page")).toBe(false);
    const fence = formatArtifactConsentFence({ url: "https://claude.ai/artifact/FWS66o6mXuVcnsNca5cYmB", account: "bot@example.com" });
    const body = fence.split("\n")[1]!;
    expect(parseArtifactConsent(body)).toEqual({ url: "https://claude.ai/artifact/FWS66o6mXuVcnsNca5cYmB", account: "bot@example.com" });
    expect(parseArtifactPage(body)).toBeNull();
    expect(parseArtifactConsent(JSON.stringify({ blocked: "other_account", url: "https://evil.example/x" }))).toBeNull();
  });

  it("auto-allows Artifact reads only when the turn says so", () => {
    expect(isArtifactRead("ArtifactData", { action: "query" })).toBe(true);
    expect(isArtifactRead("Artifact", { action: "publish" })).toBe(false);
    expect(isArtifactRead("Read", { action: "read" })).toBe(false);
    const none = new Set<string>();
    expect(permissionRoute("ArtifactComments", { action: "list" }, none, [], true)).toEqual({ kind: "allow" });
    expect(permissionRoute("ArtifactComments", { action: "list" }, none, [], false).kind).toBe("ask");
    expect(permissionRoute("ArtifactData", { action: "set" }, none, [], true).kind).toBe("ask");
  });
});

describe("isArtifactTool", () => {
  it("matches the Agent SDK tool name exactly", () => {
    expect(isArtifactTool("Artifact")).toBe(true);
    expect(isArtifactTool(" Artifact ")).toBe(true);
    expect(isArtifactTool("Write")).toBe(false);
    expect(isArtifactTool("artifact")).toBe(false);
  });
});

describe("isSafeHttpUrl", () => {
  it("keeps https URLs and loopback http, and drops the rest", () => {
    expect(isSafeHttpUrl("https://claude.ai/code/artifact/abc")).toBe(true);
    expect(isSafeHttpUrl("http://localhost:7788/page")).toBe(true);
    expect(isSafeHttpUrl("http://example.com/x")).toBe(false);
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("https://user:pass@evil.test/")).toBe(false);
    expect(isSafeHttpUrl("not a url")).toBe(false);
    expect(isSafeHttpUrl("file:///tmp/x.html")).toBe(false);
  });
});

describe("parseArtifactPublish", () => {
  it("reads a publish result with a real URL", () => {
    expect(parseArtifactPublish(JSON.stringify({
      url: "https://claude.ai/code/artifact/abc",
      path: "/tmp/page.html",
      title: "Report",
      icon: "chart",
    }))).toEqual({
      title: "Report",
      url: "https://claude.ai/code/artifact/abc",
      icon: "chart",
      path: "/tmp/page.html",
    });
  });

  it("reads text blocks the CLI wraps around the JSON", () => {
    const page = parseArtifactPublish([{ type: "text", text: '{"url":"https://claude.ai/x","title":"A"}' }]);
    expect(page).toEqual({ title: "A", url: "https://claude.ai/x" });
  });

  it("drops list results, invented URLs and non-JSON", () => {
    expect(parseArtifactPublish(JSON.stringify({ artifacts: [{ title: "A", url: "https://claude.ai/x" }] }))).toBeNull();
    expect(parseArtifactPublish(JSON.stringify({ url: "javascript:alert(1)", title: "X" }))).toBeNull();
    expect(parseArtifactPublish("published")).toBeNull();
    expect(parseArtifactPublish(JSON.stringify({ title: "No url" }))).toBeNull();
  });
});

describe("parseArtifactPage", () => {
  it("reads a title and a real URL from an artifact fence", () => {
    expect(parseArtifactPage('{"title":"Deck","url":"https://claude.ai/code/artifact/1"}')).toEqual({
      title: "Deck",
      url: "https://claude.ai/code/artifact/1",
    });
  });

  it("accepts a title-only card and refuses HTML, charts and fake URLs", () => {
    expect(parseArtifactPage('{"title":"Local preview"}')).toEqual({ title: "Local preview" });
    expect(parseArtifactPage("<!DOCTYPE html><p>Hi</p>")).toBeNull();
    expect(parseArtifactPage('{"type":"bar","title":"Tickets","labels":["Mon"],"series":[{"name":"A","data":[1]}]}')).toBeNull();
    expect(parseArtifactPage('{"title":"X","url":"javascript:alert(1)"}')).toEqual({ title: "X" });
  });
});

describe("formatArtifactFence", () => {
  it("writes a JSON artifact fence and an optional widget sibling, never the host path", () => {
    expect(formatArtifactFence({
      title: "Report",
      url: "https://claude.ai/code/artifact/abc",
      path: "/secret/page.html",
      html: "<p>Hi</p>",
    })).toBe("```artifact\n{\"title\":\"Report\",\"url\":\"https://claude.ai/code/artifact/abc\"}\n```\n\n```widget\n<p>Hi</p>\n```");
  });
});

describe("antArtifactToMarkdown", () => {
  it("routes HTML and SVG to a widget, mermaid to mermaid, markdown through, React to a code fence", () => {
    expect(antArtifactToMarkdown('type="application/vnd.sagax.cw+json"', '{"family":"ticket"}')).toBe("```cw\n{\"family\":\"ticket\"}\n```");
    expect(antArtifactToMarkdown('type="text/html" title="Hi"', "<p>x</p>")).toBe("```widget\n<p>x</p>\n```");
    expect(antArtifactToMarkdown('type="image/svg+xml"', "<svg></svg>")).toBe("```widget\n<svg></svg>\n```");
    expect(antArtifactToMarkdown('type="application/vnd.ant.mermaid"', "graph TD; A-->B")).toBe("```mermaid\ngraph TD; A-->B\n```");
    expect(antArtifactToMarkdown('type="text/markdown"', "# Hello")).toBe("# Hello");
    expect(antArtifactToMarkdown('type="application/vnd.ant.react" language="jsx"', "export default function A(){return <p/>}")).toBe("```jsx\nexport default function A(){return <p/>}\n```");
    expect(antArtifactToMarkdown('type="application/vnd.ant.chart"', '{"type":"bar","labels":["A"],"series":[{"name":"N","data":[1]}]}')).toMatch(/^```chart\n/);
  });
});

describe("liftClaudeChatBlocks", () => {
  it("rewrites a complete tag and hides an unclosed one", () => {
    expect(liftClaudeChatBlocks('See:\n<antArtifact type="text/html" title="Box"><p>Hi</p></antArtifact>\nDone')).toContain("```widget\n<p>Hi</p>\n```");
    expect(liftClaudeChatBlocks('See:\n<antArtifact type="text/html"><p>partial')).toBe("See:\n");
  });

  it("leaves the tag inside a fenced code block", () => {
    const text = "```html\n<antArtifact type=\"text/html\"><p>x</p></antArtifact>\n```";
    expect(liftClaudeChatBlocks(text)).toBe(text);
  });
});
