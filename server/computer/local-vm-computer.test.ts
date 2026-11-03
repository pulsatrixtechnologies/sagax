// The server and the desktop app each keep the Local VM screen allow-list,
// because neither build can import the other. One list of calls must agree.
import { describe, expect, it } from "vitest";

import { localVmComputerCall as desktopCall, localVmComputerCatalog as desktopCatalog } from "../../electron/local-vm-computer.mjs";
import { localVmComputerCall as serverCall, localVmComputerCatalog as serverCatalog } from "./local-vm-computer.ts";

const cases: [unknown, unknown][] = [
  ["screenshot", undefined],
  ["screenshot", {}],
  ["screenshot", { screenshot_out_file: "/tmp/x" }],
  ["get_desktop_state", {}],
  ["get_desktop_state", { session: "abc" }],
  ["get_screen_size", {}],
  ["list_apps", {}],
  ["click", { x: 12, y: 34, button: "left", count: 2 }],
  ["click", { x: 12, y: 34, debug_image_out: "/tmp/x" }],
  ["click", { x: 1 }],
  ["click", { x: -1, y: 2 }],
  ["click", { x: 1, y: 2, button: "side" }],
  ["click", null],
  ["click", []],
  ["move_cursor", { x: 3, y: 4 }],
  ["drag", { from_x: 1, from_y: 2, to_x: 8, to_y: 9, button: "left" }],
  ["type_text", { text: "hello; rm -rf /" }],
  ["type_text", { text: "hi", delay_ms: 10 }],
  ["press_key", { key: "Return", modifiers: ["control", "shift"] }],
  ["press_key", { key: "a", modifiers: ["rm"] }],
  ["press_key", { key: "/bin/sh" }],
  ["scroll", { direction: "down", amount: 3 }],
  ["scroll", { x: 1, y: 2 }],
  ["bash", { command: "id" }],
  ["launch_app", { name: "xterm" }],
  ["computer_use", {}],
  ["", {}],
  [null, {}],
  ["click", JSON.parse('{"x":1,"y":2,"__proto__":{"admin":true}}')],
];

describe("the Local VM screen allow-list", () => {
  it("is the same list on the server and on the desktop", () => {
    expect(JSON.stringify(serverCatalog())).toBe(JSON.stringify(desktopCatalog()));
    const catalog = JSON.stringify(serverCatalog());
    expect(catalog).toContain("screenshot");
    expect(catalog).toContain("click");
    expect(catalog).not.toContain("debug_image_out");
    expect(catalog).not.toContain("screenshot_out_file");
    expect(catalog).not.toContain("launch_app");
    expect(catalog).not.toContain("browser_");
  });

  it("accepts and refuses the same calls on both sides", () => {
    for (const [name, args] of cases) {
      expect(JSON.stringify(serverCall(name, args)), JSON.stringify([name, args])).toBe(JSON.stringify(desktopCall(name, args)));
    }
    const click = serverCall("click", { x: 12, y: 34, button: "left" });
    expect(click).toEqual({ tool: "click", arguments: { x: 12, y: 34, button: "left" }, image: false });
    const shot = serverCall("screenshot", {});
    expect(shot).toEqual({ tool: "get_desktop_state", arguments: {}, image: true });
    const refused = (name: unknown, args: unknown) => {
      const result = serverCall(name, args);
      return "error" in result ? result.error : "";
    };
    expect(refused("bash", {})).toMatch(/not part of the Local VM screen/);
    expect(refused("click", { x: 1, y: 2, debug_image_out: "/tmp/x" })).toMatch(/not allowed/);
    expect(refused("get_desktop_state", { screenshot_out_file: "/etc/passwd" })).toMatch(/not allowed/);
    expect("error" in serverCall("click", { x: 1, y: 2, button: "left" })).toBe(false);
  });
});
