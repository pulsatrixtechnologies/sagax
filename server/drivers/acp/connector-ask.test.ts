import { describe, expect, it } from "vitest";

import { connectorAsk } from "./connector-ask.ts";

const useTool = (tool_name: unknown, tool_input?: unknown, title?: string) => ({
  kind: "other",
  title: title ?? (typeof tool_name === "string" ? tool_name : "use_tool"),
  rawInput: { variant: "UseTool", tool_name, ...(tool_input !== undefined ? { tool_input } : {}) },
  _meta: { "x.ai/tool": { name: "use_tool", kind: "use_tool", read_only: false } },
});
const mounted = new Set(["agents", "sagax-desktop"]);

describe("an engine connector call in an ACP ask (review of #943)", () => {
  it("passes the call's arguments to the card when Grok sends them", () => {
    const ask = connectorAsk(useTool("outlook__send_email", { to: ["ana@example.com"], subject: "Suivi" }), mounted);
    expect(ask).toMatchObject({ target: "outlook__send_email", engineConnector: true, outward: true });
    expect(ask.input).toContain("ana@example.com");
  });

  it("fails closed on a name that is no server__tool, and on no target at all", () => {
    expect(connectorAsk(useTool("Send email via Outlook"), mounted)).toMatchObject({ engineConnector: true, outward: true });
    expect(connectorAsk(useTool(undefined), mounted)).toMatchObject({ engineConnector: true, outward: true });
    expect(connectorAsk(useTool("Send email via Outlook"), mounted).input).toBeUndefined();
  });

  it("lets a plain read of an engine connector stay a read", () => {
    expect(connectorAsk(useTool("outlook__list_messages", {}), mounted)).toMatchObject({ engineConnector: true, outward: false });
    expect(connectorAsk(useTool("search_emails"), mounted)).toMatchObject({ engineConnector: true, outward: false });
  });

  it("a mounted server is not an engine connector; its sends are still outward", () => {
    expect(connectorAsk(useTool("agents__list_bots", {}), mounted)).toMatchObject({ engineConnector: false, outward: false });
    expect(connectorAsk({ kind: "other", title: "agents__send_to_bot", rawInput: { text: "hi" } }, mounted)).toMatchObject({ engineConnector: false, outward: true });
  });

  it("ignores commands and file changes", () => {
    expect(connectorAsk({ kind: "execute", title: "rm -rf /", rawInput: { command: "rm -rf /" } }, mounted)).toEqual({ engineConnector: false, outward: false });
    expect(connectorAsk(null, mounted)).toEqual({ engineConnector: false, outward: false });
  });
});
