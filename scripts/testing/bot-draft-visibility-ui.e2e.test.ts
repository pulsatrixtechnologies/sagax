import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { resolveAgentBrowserBinary } from "../../server/browser/browser-engine.ts";
import { waitForExit } from "../../server/testing/cleanup.ts";
import { runControlOmb } from "../control-omb.ts";
import { UI_TOOLS_DIR } from "./control-omb-ui.ts";
import { openNewBotDialog, NEW_BOT_ROOT_JS } from "./compose-flow.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const binary = resolveAgentBrowserBinary({ dataDir: UI_TOOLS_DIR, env: process.env });
const enabled = Boolean(binary) || process.env.SAGAX_UI_E2E === "1";
if (!enabled) console.log("skipping draft visibility UI: set SAGAX_UI_E2E=1 to install the pinned browser");

(enabled ? it : it.skip)("creates a restricted bot from the full draft dialog without widening its audience", async () => {
  let child: ChildProcess | undefined;
  try {
    let stdout = "", stderr = "";
    let info: { ui: string; url: string };
    child = spawn(process.execPath, ["--experimental-strip-types", join(ROOT, "scripts/control-omb.ts"), "ui", "launch"], {
      cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", chunk => { stdout += String(chunk); });
    child.stderr!.on("data", chunk => { stderr += String(chunk); });
    await expect.poll(() => {
      if (child!.exitCode !== null) throw new Error(stderr);
      try { info = JSON.parse(stdout); return Boolean(info.ui); } catch { return false; }
    }, { timeout: binary ? 180_000 : 600_000, interval: 250 }).toBe(true);
    const ui = (verb: string, ...args: string[]) => runControlOmb(["ui", verb, "--ui", info.ui, ...args]) as Promise<Record<string, any>>;
    const snapshot = async () => (await ui("snapshot")).snapshot as string;
    const bots = async () => (await fetch(`${info.url}/api/bots?messages=0`).then(response => response.json())).bots as Array<{ id: string; visibility?: string }>;
    const before = await bots();
    await openNewBotDialog({ click: (name) => ui("click", "--name", name), evaluate: async (js) => (await ui("eval", "--js", js)).result, snapshot });
    await expect.poll(snapshot).toContain("Who can see it");
    // The dialog appears before its defaults request completes. Never click
    // the disabled Create button while the fixture is still loading its draft.
    await expect.poll(async () => (await ui("eval", "--js", `[...${NEW_BOT_ROOT_JS}.querySelectorAll('button')].find(button => button.textContent.trim() === 'Create bot')?.disabled`)).result).toBe(false);
    await ui("click", "--name", "Who can see it");
    await expect.poll(snapshot).toContain('option "Admins only"');
    const choices = await ui("snapshot");
    const audience = Object.entries(choices.refs as Record<string, { name: string; role: string }>).find(([, item]) => item.role === "option" && item.name === "Admins only");
    expect(audience).toBeDefined();
    await ui("click", "--ref", `@${audience![0]}`);
    await expect.poll(async () => (await ui("eval", "--js", "document.querySelector('[data-new-bot-visibility] button')?.textContent")).result).toContain("Admins only");
    await ui("click", "--name", "Create bot");
    await expect.poll(async () => (await bots()).length, { timeout: 15_000 }).toBe(before.length + 1);
    const created = (await bots()).find(bot => !before.some(old => old.id === bot.id));
    expect(created?.visibility).toBe("admins");
    await expect.poll(snapshot).not.toContain('dialog "New bot"');
    const logs = await ui("console");
    expect(logs.ok).toBe(true);
    expect((logs.messages as Array<{ type: string }>).filter(message => message.type === "error")).toEqual([]);
  } finally { await waitForExit(child, { signal: "SIGINT", graceMs: 30_000 }); }
}, 720_000);
