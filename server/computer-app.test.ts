import { describe, expect, it } from "vitest";

import { execFileSync } from "node:child_process";

import { appBundleOf } from "../shared/computer-app.ts";
import { ComputerAppReader, FOCUS_SCRIPT, focusAllowsTyping, signatureOf, type RunFile } from "./computer-app.ts";

const SAFARI = "/Applications/Safari.app/Contents/MacOS/Safari";
const SIGNED_SAFARI = "Executable=x\nIdentifier=com.apple.Safari\nAuthority=Software Signing\nTeamIdentifier=not set\n";
const SIGNED_CHROME = "Identifier=com.google.Chrome\nTeamIdentifier=EQHXZ8M8AV\n";

/** A fake of the four programs the reader runs: lsof, codesign (verify and
 * show), osascript (window owner, focused element). */
function fakeRun(over: { paths?: Record<number, string>; signatures?: Record<string, string | null>; window?: string; focus?: string } = {}) {
  const calls: string[][] = [];
  const paths = over.paths ?? { 812: SAFARI, 900: "/bin/zsh", 901: "/Users/ada/Downloads/Safari.app/Contents/MacOS/Safari", 902: "/Applications/Sagax.app/Contents/MacOS/Sagax", 903: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", 904: "/Applications/Terminal Clone.app/Contents/MacOS/x" };
  const signatures: Record<string, string | null> = over.signatures ?? {
    "/Applications/Safari.app": SIGNED_SAFARI,
    "/Applications/Google Chrome.app": SIGNED_CHROME,
    "/Applications/Terminal Clone.app": "Identifier=com.apple.Terminal\nAuthority=Software Signing\n",
  };
  const run: RunFile = async (command, args) => {
    calls.push([command, ...args]);
    if (command.endsWith("lsof")) {
      const path = paths[Number(args[2])];
      return path ? { stdout: `p${args[2]}\nftxt\nn${path}\n`, stderr: "" } : null;
    }
    if (command.endsWith("codesign")) {
      // codesign checks the running process: its pid, never a path
      const pid = Number(args[args.length - 1]);
      const bundle = appBundleOf(paths[pid]) ?? "";
      const text = Number.isInteger(pid) ? signatures[bundle] : undefined;
      if (!text) return null;
      return args[0] === "--verify" ? { stdout: "", stderr: "" } : { stdout: "", stderr: text };
    }
    if (command.endsWith("osascript")) {
      const script = args[3] ?? "";
      return { stdout: script.includes("AXFocusedUIElement") ? (over.focus ?? "role=AXTextField;sub=") : (over.window ?? "true"), stderr: "" };
    }
    return null;
  };
  return { run, calls };
}

const reader = (run: RunFile) => new ComputerAppReader({ run, platform: "darwin", roots: ["/Applications/"], ownExecutable: "/Applications/Sagax.app/Contents/MacOS/Sagax" });
const click = (args: Record<string, unknown>) => ["mcp__computer__click", JSON.stringify(args)] as const;

describe("ComputerAppReader (async, review of #954)", () => {
  it("reads the app's signed identity from its pid, never the model's words", async () => {
    const { run } = fakeRun();
    const apps = reader(run);
    expect(await apps.identify(...click({ pid: 812, app: "Notes" }))).toBeNull(); // an unknown argument keeps the card
    expect(await apps.identify(...click({ pid: 812, element_index: 3 }))).toEqual({ label: "Safari", bundleId: "com.apple.Safari", team: "apple" });
    expect(await apps.identify(...click({ pid: 903 }))).toEqual({ label: "Google Chrome", bundleId: "com.google.Chrome", team: "EQHXZ8M8AV" });
  });

  it("names no app for a shell, an app copied elsewhere, Sagax, an unsigned or a denied bundle", async () => {
    const { run } = fakeRun();
    const apps = reader(run);
    for (const pid of [900, 901, 902, 904, 4242]) expect(await apps.identify(...click({ pid }))).toBeNull();
    const unsigned = reader(fakeRun({ signatures: {} }).run);
    expect(await unsigned.identify(...click({ pid: 812 }))).toBeNull();
  });

  it("needs a window that belongs to the pid", async () => {
    expect(await reader(fakeRun({ window: "true" }).run).identify(...click({ pid: 812, window_id: 77 }))).not.toBeNull();
    expect(await reader(fakeRun({ window: "false" }).run).identify(...click({ pid: 812, window_id: 77 }))).toBeNull();
    expect(await reader(fakeRun({ window: "absent" }).run).identify(...click({ pid: 812, window_id: 77 }))).toBeNull();
  });

  it("types only into a focused element that is not a password field", async () => {
    const type = ["mcp__computer__type_text", JSON.stringify({ pid: 812, text: "bonjour" })] as const;
    expect(await reader(fakeRun({ focus: "role=AXTextField;sub=" }).run).identify(...type)).not.toBeNull();
    expect(await reader(fakeRun({ focus: "role=AXTextField;sub=AXSecureTextField" }).run).identify(...type)).toBeNull();
    expect(await reader(fakeRun({ focus: "untrusted" }).run).identify(...type)).toBeNull();
    // typing into an element picked by index is never covered
    expect(await reader(fakeRun().run).identify("mcp__computer__type_text", JSON.stringify({ pid: 812, element_index: 4, text: "x" }))).toBeNull();
  });

  it("reads the focus of the named window when a typing call names one", async () => {
    const { run, calls } = fakeRun({ focus: "role=AXTextField;sub=" });
    await reader(run).identify("mcp__computer__type_text", JSON.stringify({ pid: 812, window_id: 77, text: "x" }));
    const focus = calls.find((call) => call[0]!.endsWith("osascript") && (call[4] ?? "").includes("AXFocusedUIElement"));
    expect(focus?.slice(-2)).toEqual(["812", "77"]);
    expect(await reader(fakeRun({ focus: "other-window" }).run).identify("mcp__computer__type_text", JSON.stringify({ pid: 812, window_id: 77, text: "x" }))).toBeNull();
  });

  it("never covers the foreground, a hotkey, a modifier or a file written", async () => {
    const apps = reader(fakeRun().run);
    expect(await apps.identify(...click({ pid: 812, delivery_mode: "foreground" }))).toBeNull();
    expect(await apps.identify(...click({ pid: 812, delivery_mode: "background" }))).not.toBeNull();
    expect(await apps.identify("mcp__computer__hotkey", JSON.stringify({ pid: 812, keys: ["cmd", "space"] }))).toBeNull();
    expect(await apps.identify("mcp__computer__press_key", JSON.stringify({ pid: 812, key: "space", modifiers: ["cmd"] }))).toBeNull();
    expect(await apps.identify("mcp__computer__press_key", JSON.stringify({ pid: 812, key: "return" }))).not.toBeNull();
    expect(await apps.identify(...click({ pid: 812, debug_image_out: "/tmp/x.png" }))).toBeNull();
    expect(await apps.identify("mcp__computer__get_window_state", JSON.stringify({ pid: 812, screenshot_out_file: "/tmp/x.png" }))).toBeNull();
  });

  it("checks the running process's signature by pid, cached a few seconds, and reads nothing off macOS", async () => {
    const { run, calls } = fakeRun();
    const apps = reader(run);
    await apps.identify(...click({ pid: 812 }));
    await apps.identify(...click({ pid: 812 }));
    const codesign = calls.filter((call) => call[0]!.endsWith("codesign"));
    expect(codesign.length).toBe(2);
    expect(codesign.map((call) => call[call.length - 1])).toEqual(["812", "812"]);
    const off = new ComputerAppReader({ run, platform: "linux" });
    expect(await off.identify(...click({ pid: 812 }))).toBeNull();
  });
});

describe("signatureOf / focusAllowsTyping", () => {
  it("reads a team or Apple's own signing, never an ad hoc signature", () => {
    expect(signatureOf(SIGNED_CHROME)).toEqual({ bundleId: "com.google.Chrome", team: "EQHXZ8M8AV" });
    expect(signatureOf("Identifier=com.apple.Safari\nAuthority=macOS Software Signing\nTeamIdentifier=not set")).toEqual({ bundleId: "com.apple.Safari", team: "apple" });
    expect(signatureOf("Identifier=a.b\nSignature=adhoc\nTeamIdentifier=not set")).toBeNull();
  });

  it("refuses an unknown or secure focus", () => {
    expect(focusAllowsTyping("role=AXTextArea;sub=")).toBe(true);
    expect(focusAllowsTyping("role=AXTextField;sub=AXSecureTextField")).toBe(false);
    expect(focusAllowsTyping("unknown")).toBe(false);
    expect(focusAllowsTyping(null)).toBe(false);
  });
});

describe("FOCUS_SCRIPT (review of #954)", () => {
  it("passes Accessibility attribute names as NSStrings and casts each CF value back", () => {
    for (const name of ["AXFocusedUIElement", "AXRole", "AXSubrole"]) {
      expect(FOCUS_SCRIPT).toContain(`$('${name}')`);
      expect(FOCUS_SCRIPT).not.toMatch(new RegExp(`, '${name}',`));
    }
    expect(FOCUS_SCRIPT).toContain("ObjC.castRefToObject(focused[0])");
  });

  // Runs the real script on this Mac against Finder, when there is one.
  // Headless: it only reads; it answers a known shape, never a script error.
  const finder = (() => {
    if (process.platform !== "darwin" || process.env.CI) return null;
    try { return execFileSync("/usr/bin/pgrep", ["-x", "Finder"], { encoding: "utf8" }).trim().split("\n")[0] || null; } catch { return null; }
  })();
  it.skipIf(!finder)("answers a role, unknown or untrusted on a real app (smoke)", () => {
    const out = execFileSync("/usr/bin/osascript", ["-l", "JavaScript", "-e", FOCUS_SCRIPT, finder!], { encoding: "utf8", timeout: 5_000 }).trim();
    expect(out).toMatch(/^(role=.*;sub=.*|unknown|untrusted)$/);
  });
});
