import { describe, expect, it } from "vitest";

import { listsComputerTool } from "./computer-tool-list.ts";

describe("listsComputerTool", () => {
  it("keeps screen and input tools", () => {
    for (const name of ["screenshot", "left_click", "type_text", "key", "scroll", "wait"]) {
      expect(listsComputerTool(name, false)).toBe(true);
      expect(listsComputerTool(name, true)).toBe(true);
    }
  });

  it("drops the driver's upkeep on every turn", () => {
    for (const name of ["get_config", "set_config", "start_recording", "check_for_update", "health_report", "get_session", "list_sessions"]) {
      expect(listsComputerTool(name, false)).toBe(false);
      expect(listsComputerTool(name, true)).toBe(false);
    }
  });

  it("drops the driver's own browser tools only beside the built-in browser", () => {
    for (const name of ["browser_navigate", "browser_click", "get_browser_state", "page"]) {
      expect(listsComputerTool(name, false)).toBe(true);
      expect(listsComputerTool(name, true)).toBe(false);
    }
  });
});
