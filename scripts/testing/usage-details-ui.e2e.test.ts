import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { resolveAgentBrowserBinary } from "../../server/browser/browser-engine.ts";
import { waitForExit } from "../../server/testing/cleanup.ts";
import { runControlOmb } from "../control-omb.ts";
import { UI_TOOLS_DIR } from "./control-omb-ui.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const enabled = process.env.SAGAX_UI_E2E === "1" || Boolean(resolveAgentBrowserBinary({ dataDir: UI_TOOLS_DIR, env: process.env }));
if (!enabled) console.log("skipping usage details UI: set SAGAX_UI_E2E=1 to install the pinned browser");

(enabled ? it : it.skip)("renders separate cached input, uncached input and output after a real fixture turn", async () => {
  let child: ChildProcess | undefined;
  let info: { ui: string; url: string; botId: string; logPath: string } | undefined;
  try {
    let stdout = "", stderr = "";
    child = spawn(process.execPath, ["--experimental-strip-types", join(ROOT, "scripts/control-omb.ts"), "ui", "launch"], {
      cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", chunk => { stdout += String(chunk); });
    child.stderr!.on("data", chunk => { stderr += String(chunk); });
    await expect.poll(() => {
      if (child!.exitCode !== null || child!.signalCode !== null) throw new Error(`UI launcher exited: ${stderr}`);
      try { info = JSON.parse(stdout); return Boolean(info?.ui); } catch { return false; }
    }, { timeout: 600_000, interval: 250 }).toBe(true);
    const handle = info!;
    const ui = (verb: string, ...args: string[]) => runControlOmb(["ui", verb, "--ui", handle.ui, ...args]) as Promise<Record<string, any>>;
    await ui("type", "--name", "Message Pepper", "--text", "Check the fixture usage");
    await ui("press", "--keys", "Enter");
    const settled = await ui("wait-settle", "--timeout", "60");
    // the breakdown lives in the pill's hover card, which focus also opens
    const read = () => ui("eval", "--js", `(() => {
      const chip = document.querySelector('[data-testid="usage-chip"]');
      chip?.focus();
      const card = document.querySelector('[data-testid="usage-card"]');
      return { label: chip?.getAttribute('aria-label'), text: chip?.textContent, card: card?.textContent?.replace(/\\s*·\\s*/g, " · ") };
    })()`);
    await expect.poll(async () => (await read()).result?.card, { timeout: 15_000 }).toContain("10 uncached input · 2 cached input · 5 output");
    const chip = (await read()).result;
    expect(chip.text).toContain("$0.01");
    expect(chip.card).toContain("Last message");
    expect(chip.card).not.toContain("17 read");
    expect(chip.card).not.toContain("15 new");
    const consoleResult = await ui("console");
    expect((consoleResult.messages ?? []).filter((row: { type?: string }) => row.type === "error")).toEqual([]);
    const evidence = handle.logPath + ".usage-details.json";
    writeFileSync(evidence, JSON.stringify({ url: handle.url, botId: handle.botId, settled, chip, consoleResult }, null, 2));
    console.log(`Usage details renderer evidence: ${evidence}`);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) await waitForExit(child, { signal: "SIGINT", graceMs: 30_000 });
  }
}, 660_000);
