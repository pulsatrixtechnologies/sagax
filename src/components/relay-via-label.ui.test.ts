// #2901 (2026-11-08, « rien d'invisible »): a line or card the server copied
// into the bot's chat from a background conversation (MCP, routine,
// proactive wake, teammate) shows a discreet provenance label, and its
// source card never joins the approval box a second time.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/state/store", () => ({ api: vi.fn() }));

import { RelayTraceLine, RelayViaLabel } from "./RelayViaLabel";
import { withoutMirrored } from "./parallel-approvals";

describe("RelayViaLabel (#2901)", () => {
  it.each(["mcp", "routine", "proactive", "teammate"] as const)("labels a %s relay", (via) => {
    const html = renderToStaticMarkup(createElement(RelayViaLabel, { message: { relayVia: via } }));
    expect(html).toContain(`data-relay-via="${via}"`);
    expect(html).toContain("text-ink-secondary");
    expect(html).not.toContain("chat.relayVia");
  });

  it("names who asked and what, the full ask in its tooltip (#2915)", () => {
    const html = renderToStaticMarkup(createElement(RelayViaLabel, { message: { relayVia: "mcp", relayAsk: { text: "Close the duplicate tickets", by: "Claude Code" } } }));
    expect(html).toContain("Claude Code");
    expect(html).toContain('title="Close the duplicate tickets"');
    expect(html).toContain("data-relay-ask");
  });

  it.each(["failed", "stopped", "silent"] as const)("draws one trace line for a %s turn (#2915)", (trace) => {
    const html = renderToStaticMarkup(createElement(RelayTraceLine, { message: { relayTrace: trace, text: "" } }));
    expect(html).toContain(`data-relay-trace="${trace}"`);
    expect(html).not.toContain("chat.relayVia");
  });

  it("renders nothing for the person's own conversation", () => {
    expect(renderToStaticMarkup(createElement(RelayViaLabel, { message: {} }))).toBe("");
  });
});

describe("withoutMirrored (#2901)", () => {
  const pending = (card: Record<string, unknown>) => ({ message: { id: "m", role: "bot", kind: "options", card }, requestId: "r", tool: "ask" }) as never;
  it("drops a source card whose copy sits in the bot's chat", () => {
    const kept = pending({ requestId: "a", tool: "ask", options: ["A", "B"] });
    const mirrored = pending({ requestId: "b", tool: "ask", options: ["A", "B"], approvalDestination: { threadId: "main", messageId: "x" } });
    expect(withoutMirrored([kept, mirrored], ["main"])).toEqual([kept]);
  });

  it("keeps a source card whose copy sits in another conversation (#2915)", () => {
    const mirrored = pending({ requestId: "b", tool: "ask", options: ["A", "B"], approvalDestination: { threadId: "other", messageId: "x" } });
    expect(withoutMirrored([mirrored], ["main", undefined])).toEqual([mirrored]);
  });
});
