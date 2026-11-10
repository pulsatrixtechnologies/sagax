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

  it("never lists 0.45.4's batch runners, guide, extension installer or visual parser", () => {
    // `cua-driver list-tools` of the bundled macOS 0.45.4.
    const macos = ["bring_to_front", "browser_click", "browser_dialog", "browser_download", "browser_navigate", "browser_pointer",
      "browser_prepare", "browser_select", "browser_set_input_files", "browser_type", "check_for_update", "check_permissions", "click",
      "clipboard_read", "clipboard_write", "double_click", "drag", "end_session", "escalate_session", "get_accessibility_tree",
      "get_agent_cursor_state", "get_browser_state", "get_config", "get_cursor_position", "get_desktop_state", "get_guide",
      "get_recording_state", "get_screen_size", "get_session", "get_session_state", "get_window_state", "health_report", "hotkey",
      "install_extension", "install_ffmpeg", "invoke_menu", "kill_app", "launch_app", "list_apps", "list_sessions", "list_windows",
      "move_cursor", "page", "parse_visual_regions", "press_key", "replay_trajectory", "right_click", "run_script", "run_steps", "scroll",
      "set_agent_cursor_enabled", "set_agent_cursor_motion", "set_agent_cursor_theme", "set_config", "set_value", "set_window_frame",
      "start_recording", "start_session", "stop_recording", "type_text", "verify_state", "zoom"];
    expect(macos).toHaveLength(62);
    for (const name of ["run_steps", "run_script", "get_guide", "install_extension", "parse_visual_regions"]) {
      expect(listsComputerTool(name, false), name).toBe(false);
      expect(listsComputerTool(name, true), name).toBe(false);
    }
    for (const name of ["click", "get_window_state", "type_text", "press_key", "launch_app", "verify_state", "set_window_frame"]) {
      expect(listsComputerTool(name, true), name).toBe(true);
    }
  });

  it("drops the driver's own browser tools only beside the built-in browser", () => {
    for (const name of ["browser_navigate", "browser_click", "get_browser_state", "page"]) {
      expect(listsComputerTool(name, false)).toBe(true);
      expect(listsComputerTool(name, true)).toBe(false);
    }
  });
});
