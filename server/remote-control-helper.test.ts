import { describe, expect, it } from "vitest";

import { controlHelperCommand, controlSupported, windowsControlScript } from "./remote-control-helper.ts";
import { decodeWindowsScript } from "./remote-session-probe.ts";

const OPTS = { fps: 6, quality: 60, maxSeconds: 3600, sessionId: "0123456789ab", technician: "Jean, GOX" };

describe("controlSupported", () => {
  it("is Windows only for now", () => {
    expect(controlSupported("windows")).toBe(true);
    expect(controlSupported("macos")).toBe(false);
    expect(controlSupported("linux")).toBe(false);
  });
});

describe("controlHelperCommand", () => {
  it("builds a tiny bootstrap and delivers the program on stdin", () => {
    const built = controlHelperCommand("windows", OPTS);
    expect(built).not.toBeNull();
    // the tunnel command stays small (no cmd.exe length limit) and reads the program from stdin
    expect(built!.command.length).toBeLessThan(800);
    // encoded: the session shell on Windows is PowerShell, and a $variable in
    // a double-quoted -Command would be expanded by it first (8F2NZU)
    expect(built!.command).not.toContain("$");
    const bootstrap = decodeWindowsScript(built!.command) ?? "";
    expect(bootstrap).toContain("[Console]::In.ReadLine()");
    expect(bootstrap).toContain("Invoke-Expression");
    // the program rides the first stdin line as base64 and decodes to the script
    const b64 = built!.preamble.trim();
    expect(Buffer.from(b64, "base64").toString("utf8")).toBe(built!.script);
    expect(controlHelperCommand("macos", OPTS)).toBeNull();
    expect(controlHelperCommand("linux", OPTS)).toBeNull();
  });
});

describe("windowsControlScript", () => {
  it("compiles the input loop in C# (no scriptblock-thread runspace) and injects with SendInput", () => {
    const script = windowsControlScript(OPTS);
    expect(script).toContain("public static void PumpInput()");
    expect(script).toContain("SendInput");
    // the input thread runs a C# method, not a PowerShell scriptblock
    expect(script).toContain("[System.Threading.ThreadStart]{ [PxInput]::PumpInput() }");
    expect(script).toContain("Unicode");
    expect(script).toContain("WHEEL");
    // wheel delta never overflows uint32 (negative scroll)
    expect(script).toContain("unchecked((uint)(d * 120))");
    // DPI awareness so capture and coordinates are full resolution
    expect(script).toContain("SetProcessDpiAwarenessContext");
  });

  it("captures the screen as JPEG frames, skipping identical ones", () => {
    const script = windowsControlScript(OPTS);
    expect(script).toContain("CopyFromScreen");
    expect(script).toContain("image/jpeg");
    expect(script).toContain("Write-Frame 0x4D");
    expect(script).toContain("Write-Frame 0x46");
    expect(script).toContain("$lastHash");
  });

  it("stays standard rights, shows a visible notice, and stops on deadline, EOF and stop file", () => {
    const script = windowsControlScript(OPTS);
    expect(script).not.toContain("RunAs");
    expect(script).not.toContain("New-Service");
    expect(script).not.toContain("schtasks");
    expect(script).toContain("TopMost = $true");
    expect(script).toContain("Contrôle à distance en cours : Jean, GOX");
    expect(script).toContain("AddSeconds(3600)");
    expect(script).toContain("px-assist-0123456789ab\\stop");
    expect(script).toContain("[PxInput]::Stop");
  });

  it("clamps fps, quality and the deadline, and a bad session id falls back", () => {
    const script = windowsControlScript({ fps: 999, quality: 999, maxSeconds: 9_999_999, sessionId: "nope" });
    expect(script).toContain("AddSeconds(93600)");
    expect(script).toContain("[long]90");
    expect(script).toContain("Start-Sleep -Milliseconds 67");
    expect(script).toContain("px-assist-000000000000\\stop");
    // no technician given: the generic notice
    expect(script).toContain("Text = 'Contrôle à distance en cours'");
  });
});
