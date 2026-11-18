// Popovers read from their own surface tokens, in every skin and wherever
// they open. Owner, 2026-10-08: on Pulsatrix Light the thread picker opened
// from the navy chat header drew its rows in the header's light ink on its
// own white card (1.11:1), because `.content-topbar` re-points `ink` for
// its subtree and the popover is part of that subtree.
//
// Two halves keep that from coming back:
//   - `pnpm check:contrast` measures every skin in every context that
//     re-declares tokens (the navy band, the inverted bubbles) with a
//     `.popover-surface` inside it, and fails below 4.5:1 for text, 3:1 for
//     glyphs and field borders. It runs here, so `pnpm test:unit` gates it.
//   - TaskPicker paints its popover from the popover tokens only.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = join(root, "scripts", "check-skin-contrast.mjs");
const css = readFileSync(join(root, "src", "styles.css"), "utf8");

function runCheck(cssPath?: string): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [script, ...(cssPath ? ["--css", cssPath] : [])], { encoding: "utf8" });
    return { code: 0, out };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string };
    return { code: failed.status ?? 1, out: failed.stdout ?? "" };
  }
}

function withCss<T>(text: string, run: (path: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "sagax-contrast-"));
  try {
    const path = join(dir, "styles.css");
    writeFileSync(path, text);
    return run(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("skin contrast", () => {
  it("every skin clears its targets in every context", () => {
    const { code, out } = runCheck();
    expect(out).toContain("all skins clear their targets in every context");
    expect(code).toBe(0);
  });

  // Gate flake (2026-11-17): on the busy Linux build host a new pipe holds one
  // page, and process.exit() dropped the report's tail before the reader took
  // it ("all skins clear" missing, exit code 0). The report must arrive whole
  // through a one-page pipe whose reader starts late.
  it.runIf(process.platform === "linux" && spawnSync("python3", ["-c", "import fcntl"]).status === 0)("prints its whole report through a one-page pipe read late", () => {
    const relay = [
      "import fcntl, os, subprocess, sys, time",
      "r, w = os.pipe()",
      "fcntl.fcntl(w, 1031, 4096)", // F_SETPIPE_SZ
      "child = subprocess.Popen([sys.argv[1], sys.argv[2]], stdout=w)",
      "os.close(w)",
      "time.sleep(1)",
      "data = b''",
      "while True:",
      "    chunk = os.read(r, 65536)",
      "    if not chunk: break",
      "    data += chunk",
      "sys.stdout.buffer.write(data)",
      "sys.exit(child.wait())",
    ].join("\n");
    const run = spawnSync("python3", ["-c", relay, process.execPath, script], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    expect(run.stdout).toContain("all skins clear their targets in every context");
    expect(run.stdout).toBe(runCheck().out);
    expect(run.status).toBe(0);
  });

  it("measures popovers inside the Pulsatrix Light navy header", () => {
    const { out } = runCheck();
    // the context exists and is measured, not skipped
    expect(css).toMatch(/\[data-skin="pulsatrix-light"\] \.content-topbar \{/);
    expect(out).not.toContain("undefined or unmeasurable");
    const verbose = execFileSync(process.execPath, [script, "--verbose"], { encoding: "utf8" });
    expect(verbose).toMatch(/✓ pulsatrix-light \.content-topbar popover: \d+ pairs/);
  });

  it("fails the thread picker bug: a popover without the popover tokens in the navy header", () => {
    const withoutSurface = css.replace(/\n\s*\.popover-surface\s*\{[^}]*\}/, "\n");
    expect(withoutSurface).not.toBe(css);
    const { code, out } = withCss(withoutSurface, runCheck);
    expect(code).toBe(1);
    expect(out).toMatch(/pulsatrix-light \.content-topbar popover\n(?:.*\n)*?\s+--color-ink on --color-card: 1\.1\d:1/);
  });

  it("fails a skin whose secondary ink drops below 4.5:1 on a popover", () => {
    const faded = css.replace(/(\n\[data-skin="atelier"\]\s*\{[^}]*?--color-ink-secondary:\s*)#[0-9a-f]{6}/i, "$1#b0aaa0");
    expect(faded).not.toBe(css);
    const { code, out } = withCss(faded, runCheck);
    expect(code).toBe(1);
    expect(out).toMatch(/atelier popover/);
  });
});

describe("TaskPicker popover tokens", () => {
  const source = readFileSync(join(root, "src", "components", "TaskPicker.tsx"), "utf8");
  // The popover body: everything from the open popover to its New thread
  // footer. A row's actions are the shared ThreadMenu, opened popover-toned.
  const popover = source.slice(source.indexOf("{motion.shown && ("), source.indexOf('{t("task.newShort")}'));

  it("finds the popover region", () => {
    expect(popover.length).toBeGreaterThan(500);
  });

  it("opens each row's actions as a popover-toned ThreadMenu", () => {
    expect(source).toMatch(/<ThreadMenu tone="popover"/);
  });

  it("wears popover-surface on the popover itself", () => {
    expect(popover).toMatch(/className=\{cn\("[^"]*\bpopover-surface\b[^"]*\bbg-popover\b/);
  });

  it("uses popover tokens only for text, fills and borders", () => {
    const classes = [...popover.matchAll(/(?:^|[\s"'`])((?:[a-z-]+:)*(?:text|bg|border|placeholder:text)-([a-z][\w-]*)(?:\/\d+)?)(?=[\s"'`])/g)]
      .map((match) => match[1]);
    const colourTokens = classes.filter((cls) => /-(ink|accent|card|menu|inset|raised|panel|hairline|app|elevated|control|composer|popover)/.test(cls));
    const offenders = colourTokens.filter((cls) => !/(?:^|:)(?:text|bg|border)-popover\b/.test(cls) && !/(?:^|:)text-popover-/.test(cls));
    expect(offenders).toEqual([]);
    expect(colourTokens.length).toBeGreaterThan(15);
  });
});
