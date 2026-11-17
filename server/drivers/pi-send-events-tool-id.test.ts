// #4527: a Pi call reads as the id of the tool it runs, as on every engine.
import { describe, expect, it } from "vitest";

import { piExtensionToolId } from "./pi-send-events.ts";

const servers = ["agents", "pulsatrix-psa", "crm"];
const searched = new Set(["crm"]);

describe("piExtensionToolId", () => {
  it("reads pi-mcp-extension's `<server>_<tool>` on the longest mounted server", () => {
    expect(piExtensionToolId("agents_ask_bot", {}, servers, searched)).toBe("agents/ask_bot");
    expect(piExtensionToolId("pulsatrix_psa_cw_psa_query", {}, servers, searched)).toBe("pulsatrix-psa/cw_psa_query");
    expect(piExtensionToolId("crm_get_ticket", {}, servers, searched)).toBe("crm/get_ticket");
  });

  it("reads a searched server's call_tool as the tool it names, and finds nothing in a search", () => {
    expect(piExtensionToolId("crm_call_tool", { name: "close_ticket", arguments: { id: 1 } }, servers, searched)).toBe("crm/close_ticket");
    expect(piExtensionToolId("crm_call_tool", {}, servers, searched)).toBeNull();
    expect(piExtensionToolId("crm_search_tools", { query: "x" }, servers, searched)).toBeNull();
  });

  it("leaves pi's own tools alone", () => {
    expect(piExtensionToolId("bash", { command: "ls" }, servers, searched)).toBeNull();
    expect(piExtensionToolId("read", {}, servers, searched)).toBeNull();
    expect(piExtensionToolId(undefined, {}, servers, searched)).toBeNull();
  });
});
