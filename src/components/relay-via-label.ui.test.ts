// #2901 (2026-11-08, « rien d'invisible »): a line or card the server copied
// into the bot's chat from a routine or a proactive wake shows a discreet
// provenance label, and its source card never joins the approval box a
// second time. #3581: a request from a teammate or an AI client is the
// names line, never its quoted words; a trace is said on the label's line.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/state/store", () => ({ api: vi.fn() }));

import type { Message } from "@/state/store";
import { RelayProvenance, RelayViaLabel } from "./RelayViaLabel";
import { withoutMirrored } from "./parallel-approvals";

describe("RelayViaLabel (#2901)", () => {
  it.each(["routine", "proactive"] as const)("labels a %s relay", (via) => {
    const html = renderToStaticMarkup(createElement(RelayViaLabel, { message: { relayVia: via } }));
    expect(html).toContain(`data-relay-via="${via}"`);
    expect(html).toContain("text-ink-secondary");
    expect(html).not.toContain("chat.relayVia");
  });

  it("never quotes the request (#3581)", () => {
    const html = renderToStaticMarkup(createElement(RelayViaLabel, { message: { relayVia: "routine", relayAsk: { text: "Close the duplicate tickets", by: "Reviewer" } } }));
    expect(html).toContain("Reviewer");
    expect(html).not.toContain("Close the duplicate tickets");
    expect(html).not.toContain("“");
  });

  it.each(["failed", "stopped", "silent"] as const)("says a %s turn on the label's own line (#2915)", (trace) => {
    const html = renderToStaticMarkup(createElement(RelayViaLabel, { message: { relayVia: "routine", relayTrace: trace } }));
    expect(html).toContain(`data-relay-trace="${trace}"`);
    expect(html.match(/<div/g)).toHaveLength(1);
    expect(html).not.toContain("chat.askLine");
  });

  it("renders nothing for the person's own conversation", () => {
    expect(renderToStaticMarkup(createElement(RelayViaLabel, { message: {} }))).toBe("");
  });

  it.each([["teammate", { botId: "b", by: "Bot B" }, "Bot B"], ["mcp", { by: "Client" }, "Client"]] as const)("draws a %s request above its waiting card as Asked by, no quote (#3581)", (via, by, name) => {
    const message = { id: "c", role: "bot", kind: "options", at: 1, relayVia: via, relayAsk: { text: "List the duplicates", ...by } } as Message;
    const html = renderToStaticMarkup(createElement(RelayProvenance, { message, bots: [] }));
    expect(html).toContain('data-testid="incoming-line"');
    expect(html.replace(/<[^>]+>/g, " ")).toMatch(new RegExp(`Asked by\\s+${name}`));
    expect(html).not.toContain("List the duplicates");
    expect(html).not.toContain("“");
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
