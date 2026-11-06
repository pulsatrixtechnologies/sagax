// Full-app regression through the existing disposable browser harness. No
// real provider, OAuth account, MCP package, or user data is used.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { resolveAgentBrowserBinary } from "../../server/browser/browser-engine.ts";
import { waitForExit } from "../../server/testing/cleanup.ts";
import { BOT_ROLES } from "../../src/lib/bot-roles.ts";
import { runControlOmb } from "../control-omb.ts";
import { UI_TOOLS_DIR } from "./control-omb-ui.ts";
import { chooseStartFromJs, openNewBotDialog, START_FROM } from "./compose-flow.ts";
import { clickAccessible } from "./ui-click.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const binary = resolveAgentBrowserBinary({ dataDir: UI_TOOLS_DIR, env: process.env });
const forced = process.env.SAGAX_UI_E2E === "1";
const enabled = forced || Boolean(binary);
if (!enabled) console.log("skipping bot tools UI e2e: no agent-browser; set SAGAX_UI_E2E=1 to install the pinned release");
const LAUNCH_TIMEOUT_MS = forced && !binary ? 600_000 : 180_000;

interface FixtureInfo { ui: string; url: string; dataDir: string; logPath: string }
interface SavedBot { id: string; name: string; soul?: string; mcpServers?: string[]; computer?: string; browser?: boolean }

describe("bot setup and tools in the real renderer", () => {
  let child: ChildProcess | undefined;
  let info: FixtureInfo;
  afterAll(async () => {
    if (child?.connected) child.send("stop");
    await waitForExit(child, { graceMs: 30_000 });
  });

  (enabled ? it : it.skip)("creates roles, configures per-bot MCP access, and recovers a rejected preset", async () => {
    let stdout = "";
    let stderr = "";
    // Windows kill("SIGINT") terminates immediately instead of delivering a
    // catchable signal. Ask the disposable launcher to run its normal cleanup.
    const launcher = new URL("./control-omb-ui.ts", import.meta.url).href;
    const bootstrap = `import { launchUi } from ${JSON.stringify(launcher)};
      process.on('message', message => { if (message === 'stop') process.emit('SIGINT'); });
      try { await launchUi([]); } finally { process.disconnect(); }`;
    child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", bootstrap], {
      cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    child.stdout!.on("data", (chunk: Buffer) => { stdout += String(chunk); });
    child.stderr!.on("data", (chunk: Buffer) => { stderr += String(chunk); });
    child.on("error", (error) => { stderr += error.message; });
    await expect.poll(() => {
      if (child!.exitCode !== null || child!.signalCode !== null) throw new Error(`UI launcher exited: ${stderr}`);
      try { info = JSON.parse(stdout); return Boolean(info.ui); } catch { return false; }
    }, { timeout: LAUNCH_TIMEOUT_MS + 120_000, interval: 250 }).toBe(true);
    const ui = (verb: string, ...args: string[]) => runControlOmb(["ui", verb, "--ui", info.ui, ...args]) as Promise<Record<string, any>>;
    const evaluate = async (js: string) => (await ui("eval", "--js", js)).result;
    const rawClick = (name: string) => ui("click", "--name", name);
    const click = (name: string) => clickAccessible({ click: rawClick, evaluate }, name);
    const press = (keys: string) => ui("press", "--keys", keys);
    const bots = async (): Promise<SavedBot[]> => (await fetch(`${info.url}/api/bots`).then((response) => response.json())).bots;
    const snapshot = async () => (await ui("snapshot")).snapshot as string;
    const openPersona = async (section: string) => {
      await press("Escape");
      // The chat header's bot pill toggles the panel. Escape does not always
      // close it, so a later visit reads "Close <name>'s panel". Click only
      // while it is closed; Edit bot sits in the panel's Bot menu.
      await expect.poll(() => evaluate(`(() => {
        const pill = document.querySelector("main [data-bot-header-pill]");
        if (!pill) return false;
        if (pill.getAttribute("aria-expanded") !== "true") pill.click();
        return true;
      })()`), { timeout: 10_000 }).toBe(true);
      await expect.poll(snapshot, { timeout: 10_000 }).toContain('button "Bot menu"');
      await click("Bot menu");
      await expect.poll(snapshot, { timeout: 10_000 }).toContain('menuitem "Edit bot"');
      await click("Edit bot");
      await expect.poll(snapshot, { timeout: 10_000 }).toContain(section);
      await click(section);
    };
    const chooseRole = async (title: string) => {
      await expect.poll(() => evaluate(chooseStartFromJs(title)), { timeout: 10_000 }).toBe(true);
    };
    const dialogCount = () => evaluate("document.querySelectorAll('[role=dialog]').length");
    const original = await bots();

    // Compose Create new Bot is instant create. Hold POST to show pending:
    // the picker closes, Create new Bot stays disabled until the server replies.
    await evaluate(`(() => {
      const fetch = window.fetch.bind(window);
      window.botCreateRequests = 0;
      window.fetch = (input, init) => {
        if (String(input) === '/api/bots' && init?.method === 'POST') {
          window.botCreateRequests++;
          return new Promise(resolve => {
            window.releaseBotCreation = () => { window.fetch = fetch; resolve(fetch(input, init)); };
          });
        }
        return fetch(input, init);
      };
      return true;
    })()`);
    await press("Control+n");
    await expect.poll(snapshot, { timeout: 10_000 }).toContain("Create new Bot");
    expect(await evaluate("window.botCreateRequests")).toBe(0);
    await click("Create new Bot");
    await expect.poll(() => evaluate("window.botCreateRequests"), { timeout: 10_000 }).toBe(1);
    await expect.poll(dialogCount, { timeout: 10_000 }).toBe(0);
    await press("Control+n");
    await expect.poll(snapshot, { timeout: 10_000 }).toContain("Create new Bot");
    expect(await evaluate("document.querySelector('[data-compose-action=\"create-bot\"]')?.disabled")).toBe(true);
    await press("Escape");
    expect(await dialogCount()).toBe(0);
    await evaluate("window.releaseBotCreation(); true");
    await expect.poll(async () => (await bots()).length, { timeout: 10_000 }).toBe(original.length + 1);
    const created = (await bots()).filter((bot) => !original.some((old) => old.id === bot.id));
    expect(created).toHaveLength(1);
    expect(created[0].computer).toBe(original[0].computer);
    expect(created[0].browser).toBe(original[0].browser);

    // Give the selected disposable bot real usage so Usage has turns.
    await runControlOmb(["send", "--bot", created[0].id, "--text", "Reply briefly for the sidebar test.", "--url", info.url]);
    expect((await runControlOmb(["wait", "--bot", created[0].id, "--timeout", "20", "--url", info.url]) as { status: string }).status).toBe("settled");
    await evaluate(`document.querySelector(${JSON.stringify(`[data-sidebar-bot-row="${created[0].id}"]`)})?.click(); true`);

    await openPersona("Access");
    await expect.poll(snapshot, { timeout: 10_000 }).toContain("No MCP servers added yet.");
    await click("Manage in Capabilities");
    await expect.poll(() => evaluate("Boolean(document.querySelector('[data-plugins-tab=\"installed\"]'))"), { timeout: 10_000 }).toBe(true);
    await evaluate("document.querySelector('[data-plugins-tab=\"installed\"]')?.click(); true");
    await expect.poll(() => evaluate("Boolean(document.querySelector('[data-plugins-advanced]'))"), { timeout: 10_000 }).toBe(true);
    await evaluate("(() => { const details = document.querySelector('[data-plugins-advanced]'); if (details instanceof HTMLDetailsElement) details.open = true; return true; })()");
    await expect.poll(() => evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Paste config')?.disabled"), { timeout: 10_000 }).toBe(false);
    await click("Paste config");
    await expect.poll(() => evaluate("Boolean(document.querySelector('textarea[aria-label=\"Paste config\"]'))"), { timeout: 10_000 }).toBe(true);
    const pasted = await ui("snapshot", "--interactive");
    const textarea = Object.entries(pasted.refs as Record<string, { role: string; name: string }>)
      .find(([, entry]) => entry.role === "textbox" && entry.name === "Paste config");
    expect(textarea).toBeDefined();
    await ui("type", "--ref", `@${textarea![0]}`, "--text", JSON.stringify({ mcpServers: {
      fixture: { command: process.execPath, args: ["-e", "process.exit(0)"] },
    } }));
    await click("Add servers");
    const registry = async () => (await fetch(`${info.url}/api/mcp/servers`).then((response) => response.json())).servers;
    await expect.poll(registry, { timeout: 10_000 }).toMatchObject([{ name: "fixture", enabled: false }]);
    // Adding a server can close the plugins overlay. Re-open it and open
    // the fixture row so the workspace toggle is in the snapshot.
    if (!(await snapshot()).includes("Turn fixture on")) {
      await openPersona("Access");
      await click("Manage in Capabilities");
      await expect.poll(() => evaluate("Boolean(document.querySelector('[data-plugins-tab=\"installed\"]'))"), { timeout: 10_000 }).toBe(true);
      await evaluate("document.querySelector('[data-plugins-tab=\"installed\"]')?.click(); true");
      await expect.poll(snapshot, { timeout: 10_000 }).toContain("fixture");
      await evaluate(`(() => {
        const row = [...document.querySelectorAll("button, [role=button]")].find((el) => (el.textContent || "").includes("fixture"));
        row?.click();
        return Boolean(row);
      })()`);
    }
    await expect.poll(snapshot, { timeout: 10_000 }).toContain("Turn fixture on");
    await click("Turn fixture on");
    await expect.poll(registry, { timeout: 10_000 }).toMatchObject([{ name: "fixture", enabled: true }]);
    await click("Close plugins");
    await press("Escape");
    await openPersona("Access");
    await expect.poll(() => evaluate("document.querySelector('[aria-label=\"Let this bot use Fixture\"]')?.getAttribute('aria-checked')"), { timeout: 10_000 }).toBe("true");
    await click("Let this bot use Fixture");
    await expect.poll(async () => (await bots()).find((bot) => bot.id === created[0].id)?.mcpServers, { timeout: 10_000 }).toEqual([]);
    await press("Escape");
    await openPersona("Access");
    await expect.poll(() => evaluate("document.querySelector('[aria-label=\"Let this bot use Fixture\"]')?.getAttribute('aria-checked')"), { timeout: 10_000 }).toBe("false");

    await press("Escape");
    await openPersona("Usage");
    await expect.poll(snapshot, { timeout: 10_000 }).toContain("All bots");
    await expect.poll(() => evaluate("(() => { const row = document.querySelector('[data-persona-current=usage]'); const rect = row?.getBoundingClientRect(); return rect ? Math.max(-rect.top, rect.bottom - innerHeight) : 9999; })()"), { timeout: 10_000 }).toBeLessThanOrEqual(1);
    // The editor lost its category search in #518: the left nav is the way in.
    await ui("screenshot", "--out", `${info.logPath}.settings.png`);

    // A failed profile step must roll back the incomplete bot and leave the
    // editable draft available for a single successful retry. NewBotDialog
    // (Team map → named team → New Bot) PATCHes soul; compose instant-create does not.
    await press("Escape");
    const beforeFailure = await bots();
    await evaluate(`(() => {
      const fetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const path = input instanceof Request ? input.url : String(input);
        if (init?.method === 'PATCH' && /\\/api\\/bots\\/[^/]+$/.test(path) && typeof init.body === 'string' && JSON.parse(init.body).soul) {
          window.fetch = fetch;
          return Promise.resolve(new Response(JSON.stringify({error:'Fixture preset rejected'}), {status:409, headers:{'content-type':'application/json'}}));
        }
        return fetch(input, init);
      };
      return true;
    })()`);
    const ops = BOT_ROLES.find((role) => role.id === "ops")!;
    await openNewBotDialog({ click, evaluate, snapshot });
    await chooseRole(ops.title);
    await click("Create bot");
    await expect.poll(snapshot, { timeout: 10_000 }).toContain("Fixture preset rejected");
    expect((await bots()).map(bot => bot.id)).toEqual(beforeFailure.map(bot => bot.id));
    expect(await dialogCount()).toBe(1);
    await click("Create bot");
    await expect.poll(async () => (await bots()).length, { timeout: 10_000 }).toBe(beforeFailure.length + 1);
    await expect.poll(async () => !(await snapshot()).includes(START_FROM), { timeout: 10_000 }).toBe(true);
    await press("Escape");
    await expect.poll(dialogCount, { timeout: 10_000 }).toBe(0);
    expect((await bots()).filter(bot => !beforeFailure.some(old => old.id === bot.id))).toMatchObject([{ name: ops.name, soul: ops.soul }]);
    const logs = await ui("console");
    expect((logs.messages as Array<{ type: string; text: string }>).filter((entry) => entry.type === "error")).toEqual([]);
    if (child?.connected) child.send("stop");
    await waitForExit(child, { graceMs: 30_000 });
    expect(child.exitCode).toBe(0);
    expect(existsSync(info.dataDir)).toBe(false);
    expect(existsSync(info.logPath)).toBe(true);
  }, LAUNCH_TIMEOUT_MS + 300_000);
});
