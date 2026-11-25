// Real renderer, disposable fake engine and browser profile only.
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { resolveAgentBrowserBinary } from "../../server/browser/browser-engine.ts";
import { waitForExit } from "../../server/testing/cleanup.ts";
import { runControlOmb } from "../control-omb.ts";
import { UI_TOOLS_DIR } from "./control-omb-ui.ts";
import { openAccountMenu, clickAccessible, openBotMenuJs } from "./ui-click.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const enabled = process.env.SAGAX_UI_E2E === "1" || Boolean(resolveAgentBrowserBinary({ dataDir: UI_TOOLS_DIR, env: process.env }));
interface FixtureInfo { ui: string; url: string; logPath: string }
interface SavedBot { id: string; name: string; modelSelection: { instanceId: string; model: string }; outbound?: unknown; fallback?: unknown }

describe("trust controls in the real renderer", () => {
  let child: ChildProcess | undefined;
  afterAll(async () => {
    if (child?.connected) child.send("stop");
    await waitForExit(child, { graceMs: 30_000 });
  });

  (enabled ? it : it.skip)("refreshes tool receipts, saves outbound limits and serializes memory edits", async () => {
    let output = "", errors = "";
    let info!: FixtureInfo;
    const launcher = new URL("./control-omb-ui.ts", import.meta.url).href;
    const bootstrap = `import { launchUi } from ${JSON.stringify(launcher)};
      process.on('message', message => { if (message === 'stop') process.emit('SIGINT'); });
      try { await launchUi(['--tool-calls', '[{"name":"Bash","input":{"command":"echo fixture"},"ok":true}]']); } finally { process.disconnect(); }`;
    child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", bootstrap], {
      cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    child.stdout!.on("data", (chunk: Buffer) => { output += String(chunk); });
    child.stderr!.on("data", (chunk: Buffer) => { errors += String(chunk); });
    child.on("error", error => { errors += error.message; });
    await expect.poll(() => {
      if (child!.exitCode !== null || child!.signalCode !== null) throw new Error(`UI launcher exited: ${errors}`);
      try { info = JSON.parse(output); return Boolean(info.ui); } catch { return false; }
    }, { timeout: 300_000, interval: 250 }).toBe(true);

    const ui = (verb: string, ...args: string[]) => runControlOmb(["ui", verb, "--ui", info.ui, ...args]) as Promise<Record<string, any>>;
    const evaluate = async (js: string) => (await ui("eval", "--js", js)).result;
    const click = (name: string) => ui("click", "--name", name);
    const type = async (name: string, text: string) => {
      // The mapped browser "type" appends and refocuses the field. Clear
      // through the native input setter first, including React's input event.
      await click(name);
      await evaluate(`(() => {
        const input = document.activeElement;
        if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) throw new Error('No input to clear: ' + ${JSON.stringify(name)});
        Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(input, '');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`);
      await ui("type", "--name", name, "--text", text);
    };
    const snapshot = async () => (await ui("snapshot")).snapshot as string;
    const bots = async (): Promise<SavedBot[]> => (await fetch(`${info.url}/api/bots`).then(response => response.json())).bots;
    const bot = (await bots()).find(candidate => candidate.name === "Pepper")!;
    expect(bot).toBeDefined();
    const saved = async () => (await bots()).find(candidate => candidate.id === bot.id)!;
    const memory = async () => (await fetch(`${info.url}/api/team-memory?section=`).then(response => response.json())).entries as Array<{ id: string; name: string; detail: string }>;

    await ui("flag", "--set", "features.showToolCalls=true");
    await runControlOmb(["send", "--bot", bot.id, "--text", "Run the harmless fixture tool.", "--url", info.url]);
    await runControlOmb(["wait", "--bot", bot.id, "--timeout", "20", "--url", info.url]);
    await expect.poll(snapshot, { timeout: 10_000 }).toContain("Worked, 1 tool, press to see the detail");
    await clickAccessible({ click, evaluate }, "Worked, 1 tool, press to see the detail");
    await expect.poll(snapshot, { timeout: 10_000 }).toContain("Ran a command");
    await ui("screenshot", "--out", `${info.logPath}.activity.png`);

    await evaluate("document.querySelector('.achievement-toast-close')?.click(); true");
    const interactive = await ui("snapshot", "--interactive");
    const profile = Object.entries(interactive.refs as Record<string, { role: string; name: string }>)
      .find(([, entry]) => entry.role === "button" && entry.name === "Open Pepper's panel");
    expect(profile).toBeDefined();
    await clickAccessible({ click, evaluate }, profile![1].name);
    await expect.poll(() => evaluate(openBotMenuJs())).toBe(true);
    await click("Edit bot");
    await expect.poll(() => evaluate("Boolean(document.querySelector('[data-bot-profile-subpage-open=advanced]'))")).toBe(true);
    await evaluate("document.querySelector('[data-bot-profile-subpage-open=advanced]').click(); true");
    await evaluate("document.querySelectorAll('details[data-advanced-fold]').forEach(node => { node.open = true; }); true");
    const policy = async (name: string) => {
      await evaluate("document.querySelector('button[aria-label=\"Sending on your behalf\"]').click(); true");
      await expect.poll(() => evaluate(`[...document.querySelectorAll('[role=option]')].some(option => option.textContent.trim() === ${JSON.stringify(name)})`)).toBe(true);
      await evaluate(`[...document.querySelectorAll('[role=option]')].find(option => option.textContent.trim() === ${JSON.stringify(name)}).click(); true`);
    };
    await policy("Allow a daily amount");
    await type("Daily outbound limit", "7");
    await ui("press", "--keys", "Tab");
    await expect.poll(async () => (await saved()).outbound, { timeout: 10_000 }).toEqual({ policy: "allow", dailyCap: 7 });
    await policy("Ask every time");
    await expect.poll(async () => (await saved()).outbound, { timeout: 10_000 }).toEqual({ policy: "ask", dailyCap: 7 });

    // Composio and its per-app scopes were removed in #1014
    // (a35880dfbb). That retired control no longer belongs in this smoke.
    // Seed a saved chain without any real account/auth or execution. The
    // actual Model control must remove it via the existing bot patch queue.
    const seeded = await fetch(`${info.url}/api/bots/${bot.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ fallback: [{ instanceId: bot.modelSelection.instanceId, model: bot.modelSelection.model }] }),
    });
    expect(seeded.ok).toBe(true);
    // A sub-page opens in its own window over the profile: close it, then open Model from General.
    await evaluate("document.querySelector('[data-bot-page-modal] > [data-dialog-close]').click(); true");
    await expect.poll(() => evaluate("!document.querySelector('[data-bot-page-modal]') && Boolean(document.querySelector('[data-bot-profile-subpage-open=model]'))")).toBe(true);
    await evaluate("document.querySelector('[data-bot-profile-subpage-open=model]').click(); true");
    expect(await snapshot()).toContain("when the provider proves the request never started");
    await expect.poll(() => evaluate("Boolean(document.querySelector('button[aria-label$=\"from the fallback list\"]'))"), { timeout: 10_000 }).toBe(true);
    await evaluate("document.querySelector('button[aria-label$=\"from the fallback list\"]').click(); true");
    await expect.poll(async () => (await saved()).fallback, { timeout: 10_000 }).toEqual([]);
    expect((await saved()).modelSelection).toEqual(bot.modelSelection);
    await evaluate("document.querySelector('[data-bot-profile-topbar] [data-window-close]').click(); true");

    await evaluate(`(() => { localStorage.setItem('sagax.interfaceMode.v1','advanced'); window.dispatchEvent(new StorageEvent('storage', {key:'sagax.interfaceMode.v1'})); return true; })()`);
    await openAccountMenu({ click, snapshot });
    await click("Tools");
    await click("Team map");
    const openMemory = async () => {
      await evaluate(`(() => { const menu = document.querySelector('[data-team-key=""] details'); if (!menu) throw new Error('No General team menu'); if (!menu.open) menu.querySelector('summary').click(); return true; })()`);
      await click("Unassigned team memory");
    };
    await openMemory();
    await expect.poll(snapshot, { timeout: 10_000 }).toContain("Nothing shared yet.");
    await click("Add an entry");
    await type("Name", "MCHQ");
    await type("Detail", "Mission Control HQ");
    await click("Add");
    await expect.poll(memory, { timeout: 10_000 }).toMatchObject([{ name: "MCHQ", detail: "Mission Control HQ" }]);
    await expect.poll(snapshot, { timeout: 10_000 }).toContain("MCHQ detail");
    await evaluate(`(() => {
      const original = window.fetch.bind(window);
      window.memoryEditRequests = 0;
      window.fetch = (input, init) => {
        if (String(input).startsWith('/api/team-memory/') && init?.method === 'PATCH') {
          window.memoryEditRequests++;
          return new Promise(resolve => { window.releaseMemoryEdit = () => { window.fetch = original; resolve(original(input, init)); }; });
        }
        return original(input, init);
      };
      return true;
    })()`);
    await type("MCHQ detail", "Reviewed HQ");
    await ui("press", "--keys", "Tab");
    await expect.poll(() => evaluate("window.memoryEditRequests"), { timeout: 10_000 }).toBe(1);
    expect(await evaluate("document.querySelector('[aria-label=\"Remove MCHQ\"]')?.disabled")).toBe(true);
    await evaluate("document.querySelector('[aria-label=\"Remove MCHQ\"]').click(); true");
    expect(await memory()).toHaveLength(1);
    await click("Close team memory");
    await openMemory();
    await expect.poll(snapshot, { timeout: 10_000 }).toContain("MCHQ detail");
    await evaluate("window.releaseMemoryEdit(); true");
    await expect.poll(memory, { timeout: 10_000 }).toMatchObject([{ name: "MCHQ", detail: "Reviewed HQ" }]);
    // An old dialog's completion must not write its response into the new
    // dialog; reopen reads the current persisted value.
    await click("Close team memory");
    await openMemory();
    await expect.poll(() => evaluate("document.querySelector('[aria-label=\"MCHQ detail\"]')?.value"), { timeout: 10_000 }).toBe("Reviewed HQ");
    await ui("screenshot", "--out", `${info.logPath}.team-memory.png`);
    await click("Remove MCHQ");
    await click("Confirm removal");
    await expect.poll(memory, { timeout: 10_000 }).toEqual([]);
    const renderer = await ui("console");
    expect(renderer.ok).toBe(true);
    expect((renderer.messages as Array<{ type: string }>).filter(message => message.type === "error")).toEqual([]);
  }, 420_000);
});
