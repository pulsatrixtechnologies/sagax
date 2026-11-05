// "Reconnect the account" on a claude.ai card opens Settings > Providers on
// the Claude engine row (#2018).
import { describe, expect, it, vi } from "vitest";

import { openClaudeEngineSettings } from "./settings-link";
import { requestProviderRow, takeProviderRow } from "./provider-row-request";
import * as rowRequest from "./provider-row-request";

describe("openClaudeEngineSettings", () => {
  it("opens Providers and asks for the Claude row", () => {
    const spy = vi.spyOn(rowRequest, "requestProviderRow");
    const dispatch = vi.fn();
    openClaudeEngineSettings(dispatch);
    expect(dispatch).toHaveBeenCalledWith({ type: "toggleAppSettings", open: true, section: "providers" });
    expect(spy).toHaveBeenCalledWith("claude");
    takeProviderRow();
  });

  it("a request waits until taken", () => {
    requestProviderRow("claude");
    takeProviderRow();
    // taking twice is harmless
    expect(() => takeProviderRow()).not.toThrow();
  });
});
