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
import { chooseStartFromJs, NEW_BOT_ROOT_JS, openNewBotDialog, START_FROM } from "./compose-flow.ts";
import { clickAccessible, openBotMenuJs } from "./ui-click.ts";

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
      // while it is closed. Edit bot sits in the bot's menu, a right click on
      // the panel's mascot or name (UX reference 2.3).
      await expect.poll(() => evaluate(`(() => {
        const pill = document.querySelector("main [data-bot-header-pill]");
        if (!pill) return false;
        if (pill.getAttribute("aria-expanded") !== "true") pill.click();
        return true;
      })()`), { timeout: 10_000 }).toBe(true);
      await expect.poll(() => evaluate(openBotMenuJs()), { timeout: 10_000 }).toBe(true);
      await expect.poll(snapshot, { timeout: 10_000 }).toContain('menuitem "Edit bot"');
      await click("Edit bot");
      await expect.poll(snapshot, { timeout: 10_000 }).toContain(section);
      await click(section);
    };
    // Bot accounts > Add > MCP servers (BotProfilePage.tsx-parts/cards.tsx).
    const addMcpServers = async () => {
      await expect.poll(() => evaluate(`(() => {
        const card = document.querySelector('[data-settings-group="bot-profile-accounts"]');
        const item = [...document.querySelectorAll('[role=menuitem]')].find((el) => (el.textContent || "").trim().startsWith("MCP servers"));
        if (item) { item.click(); return true; }
        card?.querySelector('button[aria-haspopup="menu"]')?.click();
        return false;
      })()`), { timeout: 10_000 }).toBe(true);
    };
    // Plugins' header: "Manage", or "N connected" once something is. Opened
    // from a bot, Manage starts on "This bot", where only plugins install;
    // servers are added for the organization, as the workspace registry the
    // smoke reads (/api/mcp/servers) holds them.
    const openManage = async () => {
      await expect.poll(() => evaluate(`(() => {
        if (document.querySelector('[data-plugins-add]')) return true;
        const scope = [...document.querySelectorAll('[role=radiogroup][aria-label="Install scope"] [role=radio]')].find((el) => (el.textContent || "").trim() === "Organization");
        if (scope) { if (scope.getAttribute("aria-checked") !== "true") scope.click(); return false; }
        const header = [...document.querySelectorAll("button")].find((el) => /^(Manage|\\d+ connected)$/.test((el.textContent || "").trim()));
        header?.click();
        return false;
      })()`), { timeout: 10_000 }).toBe(true);
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
    // #3399: the MCP servers card left the profile; each server is one row of
    // Bot accounts, with its switch. With none, the card's empty row carries
    // Add, whose "MCP servers" opens Plugins on that surface for this bot.
    await expect.poll(snapshot, { timeout: 10_000 }).toContain("This bot has no accounts yet");
    await addMcpServers();
    // Plugins > Manage > + Add > Paste config (#2104: one "+ Add" menu in
    // Manage's title row, PluginsPanelView.tsx).
    await openManage();
    await expect.poll(() => evaluate(`(() => {
      if (document.querySelector('textarea[aria-label="Paste config"]')) return true;
      const paste = document.querySelector('[data-plugins-add-action="paste"]');
      if (paste && !paste.disabled) paste.click();
      else if (!paste) document.querySelector('[data-plugins-add]')?.click();
      return false;
    })()`), { timeout: 10_000 }).toBe(true);
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
    // The new server is a row of Manage's Installed list ("Open Fixture");
    // its detail page holds the workspace switch. Adding a server can close
    // the plugins overlay: re-open it the same way first.
    if (!(await snapshot()).includes("Turn fixture on")) {
      if (!(await snapshot()).includes('button "Open Fixture"')) {
        await openPersona("Access");
        await addMcpServers();
        await openManage();
      }
      await expect.poll(snapshot, { timeout: 10_000 }).toContain('button "Open Fixture"');
      await click("Open Fixture");
    }
    await expect.poll(snapshot, { timeout: 10_000 }).toContain("Turn fixture on");
    await click("Turn fixture on");
    await expect.poll(registry, { timeout: 10_000 }).toMatchObject([{ name: "fixture", enabled: true }]);
    // Plugins' close button is "Close" in its header (PluginsPanelFrame).
    await click("Close");
    await press("Escape");
    await openPersona("Access");
    await expect.poll(() => evaluate("document.querySelector('[aria-label=\"Let this bot use Fixture\"]')?.getAttribute('aria-checked')"), { timeout: 10_000 }).toBe("true");
    await click("Let this bot use Fixture");
    await expect.poll(async () => (await bots()).find((bot) => bot.id === created[0].id)?.mcpServers, { timeout: 10_000 }).toEqual([]);
    await press("Escape");
    await openPersona("Access");
    await expect.poll(() => evaluate("document.querySelector('[aria-label=\"Let this bot use Fixture\"]')?.getAttribute('aria-checked')"), { timeout: 10_000 }).toBe("false");

    await press("Escape");
    // The bot's usage is the profile's Analytics tab since 0.8.52 (#2168;
    // #3401: the usage block first, then the cost breakdown).
    await openPersona("Analytics");
    await expect.poll(snapshot, { timeout: 10_000 }).toContain('tab "Analytics" [selected');
    await expect.poll(() => evaluate("(() => { const panel = document.querySelector('[data-bot-profile-panel=stats]'); const rect = panel?.getBoundingClientRect(); return rect ? Math.max(-rect.top, rect.top - innerHeight) : 9999; })()"), { timeout: 10_000 }).toBeLessThanOrEqual(1);
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
    // The draft stays open for the retry: from a team, New Bot is a view in
    // the team's detail panel (TeamDialog, 0.8.27), not a dialog.
    expect(await evaluate(`Boolean(${NEW_BOT_ROOT_JS}?.querySelector('button[aria-label="${START_FROM}"]'))`)).toBe(true);
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
