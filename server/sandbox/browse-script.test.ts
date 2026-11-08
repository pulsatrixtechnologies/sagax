// QA 0.8.67 G4: BROWSE_SCRIPT run in a real shell, with a stub `chromium`
// (and `base64`) first on PATH. Checks what string tests cannot: the per-call
// profile is made by mktemp, given to Chromium, removed on exit (also on a
// failure and on TERM), and a TERM ends the script with 124 (a timeout).
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BROWSE_SCRIPT } from "./user-sandbox-tools.ts";

const STUB_CHROMIUM = `#!/bin/sh
for a in "$@"; do
  case "$a" in
    --user-data-dir=*) echo "\${a#--user-data-dir=}" > "$STUB_LOG" ;;
    --screenshot=*) shot="\${a#--screenshot=}" ;;
  esac
done
[ -n "$STUB_SLEEP" ] && sleep "$STUB_SLEEP"
[ -n "$STUB_FAIL" ] && exit 3
if [ -n "$shot" ]; then printf 'PNG' > "$shot"; exit 0; fi
echo "<html>dom of the page</html>"
`;
const STUB_BASE64 = `#!/bin/sh
for a in "$@"; do f="$a"; done
printf 'b64:'; cat "$f"
`;

let bin: string;
let log: string;

beforeEach(() => {
  bin = mkdtempSync(join(tmpdir(), "browse-script-test-"));
  log = join(bin, "profile.txt");
  for (const [name, body] of [["chromium", STUB_CHROMIUM], ["base64", STUB_BASE64]] as const) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
});
afterEach(() => rmSync(bin, { recursive: true, force: true }));

const env = (extra: Record<string, string> = {}) => ({ ...process.env, PATH: `${bin}:${process.env.PATH}`, STUB_LOG: log, ...extra });
const run = (url: string, mode: "dom" | "shot", extra: Record<string, string> = {}) =>
  spawnSync("sh", ["-c", BROWSE_SCRIPT, "sh", url, mode], { env: env(extra), encoding: "utf8" });
const profile = () => readFileSync(log, "utf8").trim();

describe("BROWSE_SCRIPT in a real shell (QA 0.8.67 G4)", () => {
  it("dumps the DOM from a fresh profile and removes it on exit", () => {
    const result = run("https://example.com/", "dom");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("<html>dom of");
    expect(profile()).toMatch(/^\/tmp\/sagax-chromium\.[A-Za-z0-9]{6}$/);
    expect(existsSync(profile())).toBe(false);
  });

  it("gives two calls two profiles", () => {
    run("https://example.com/", "dom");
    const first = profile();
    run("https://example.com/", "dom");
    expect(profile()).not.toBe(first);
  });

  it("returns the screenshot from the call's own folder, then removes it", () => {
    const result = run("https://example.com/", "shot");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("b64:PNG");
    expect(existsSync(profile())).toBe(false);
  });

  it("fails a screenshot that was not written, and still removes the profile", () => {
    const result = run("https://example.com/", "shot", { STUB_FAIL: "1" });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(existsSync(profile())).toBe(false);
  });

  it("keeps a hostile URL out of the script text", () => {
    const marker = join(bin, "pwned");
    const result = run(`https://example.com/?a=$(touch ${marker})`, "dom");
    expect(result.status).toBe(0);
    expect(existsSync(marker)).toBe(false);
  });

  it("ends with 124 on TERM (a time limit) and removes the profile", async () => {
    const child = spawn("sh", ["-c", BROWSE_SCRIPT, "sh", "https://example.com/", "dom"], { env: env({ STUB_SLEEP: "1" }), stdio: "ignore" });
    // wait until the stub has started (it writes the profile path first)
    for (let i = 0; i < 50 && !existsSync(log); i++) await new Promise((resolve) => setTimeout(resolve, 20));
    child.kill("SIGTERM");
    const code = await new Promise<number | null>((resolve) => child.on("exit", (status) => resolve(status)));
    expect(code).toBe(124);
    expect(existsSync(profile())).toBe(false);
  });
});
