// Real settings in the disposable browser harness; synthetic Admin responses
// remain in this page. No Slack or Admin service is contacted.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { resolveAgentBrowserBinary } from "../../server/browser/browser-engine.ts";
import { waitForExit } from "../../server/testing/cleanup.ts";
import { runControlOmb } from "../control-omb.ts";
import { UI_TOOLS_DIR } from "./control-omb-ui.ts";
import { clickAccessible } from "./ui-click.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const binary = resolveAgentBrowserBinary({ dataDir: UI_TOOLS_DIR, env: process.env });
const forced = process.env.SAGAX_UI_E2E === "1";
const enabled = forced || Boolean(binary);
const launchTimeout = forced && !binary ? 600_000 : 180_000;
if (!enabled) console.log("skipping Slack settings UI e2e: no agent-browser; set SAGAX_UI_E2E=1 to install the pinned release");

describe("Slack management in agent settings", () => {
  let child: ChildProcess | undefined;
  afterAll(async () => { await waitForExit(child, { signal: "SIGINT", graceMs: 30_000 }); });

  (enabled ? it : it.skip)("shows the Slack row only when Admin can manage it, and never another agent's link", async () => {
    let output = "";
    let errors = "";
    let info: { ui: string; url: string; botId: string; dataDir: string; logPath: string } | undefined;
    child = spawn(process.execPath, ["--experimental-strip-types", join(ROOT, "scripts/control-omb.ts"), "ui", "launch"], {
      cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (chunk: Buffer) => { output += String(chunk); });
    child.stderr!.on("data", (chunk: Buffer) => { errors += String(chunk); });
    child.on("error", (error) => { errors += error.message; });
    await expect.poll(() => {
      if (child!.exitCode !== null || child!.signalCode !== null) throw new Error(`UI launcher exited: ${errors}`);
      try { info = JSON.parse(output); return Boolean(info?.ui); } catch { return false; }
    }, { timeout: launchTimeout, interval: 250 }).toBe(true);
    const fixture = info!;
    const ui = (verb: string, ...args: string[]) => runControlOmb(["ui", verb, "--ui", fixture.ui, ...args]) as Promise<Record<string, any>>;
    const evaluate = async (js: string) => (await ui("eval", "--js", js)).result;
    const snapshot = async () => (await ui("snapshot")).snapshot as string;
    const click = async (name: string) => {
      try { return await ui("click", "--name", name); }
      catch (cause) { throw new Error(`Click ${name}`, { cause }); }
    };
    // #4470: the row's Manage opens the channel's settings in a modal over the
    // page (a portal, not inside the row): the Admin link is that modal's.
    const modalSlack = '[data-bot-page-modal="channel-slack"]';
    const link = () => evaluate(`document.querySelector('${modalSlack} a')?.getAttribute('href') ?? null`);
    const row = () => evaluate("Boolean(document.querySelector('[data-bot-profile-row=slack]'))");
    let currentName = "Pepper";
    const openProfile = async () => {
      await evaluate(`[...document.querySelectorAll('button[aria-label]')].find(button => button.getAttribute('aria-label') === ${JSON.stringify(`Actions for ${currentName}`)}).click(); true`);
      await click("Edit bot");
      await expect.poll(() => evaluate("Boolean(document.querySelector('[data-bot-profile-page]'))")).toBe(true);
    };
    // Availability is read when settings open, so each mode reopens them.
    const reopen = async (mode: string) => {
      await evaluate("document.querySelector('[data-bot-profile-topbar] [data-window-close]').click(); true");
      await evaluate(`window.slackFixture.mode = ${JSON.stringify(mode)}; true`);
      const before = await evaluate("window.slackFixture.requests.length") as number;
      await openProfile();
      await expect.poll(() => evaluate("window.slackFixture.requests.length"), { timeout: 10_000 }).toBeGreaterThan(before);
    };

    // The real API on this local fixture answers { available: false }: no Slack row at all.
    await openProfile();
    const real = await fetch(`${fixture.url}/api/bots/${fixture.botId}/slack-management`);
    expect(real.status).toBe(200);
    expect(await real.json()).toEqual({ available: false });
    expect(await row()).toBe(false);

    await evaluate(`(() => {
      const realFetch = window.fetch.bind(window);
      window.slackFixture = { mode: 'ready', requests: [], pending: [] };
      window.fetch = (input, init) => {
        const path = input instanceof Request ? input.url : String(input);
        const match = path.match(/\\/api\\/bots\\/([^/]+)\\/slack-management$/);
        if (!match) return realFetch(input, init);
        const state = window.slackFixture;
        const botId = match[1];
        state.requests.push(botId);
        const reply = () => Response.json({ available: true, managementUrl: 'https://admin.example.test/slack?workspace=acme&bot=' + botId });
        if (state.mode === 'pending') return new Promise(resolve => state.pending.push(() => resolve(reply())));
        if (state.mode === 'unavailable') return Promise.resolve(Response.json({ available: false }));
        if (state.mode === 'denied') return Promise.resolve(Response.json({ error: 'forbidden' }, { status: 403 }));
        if (state.mode === 'error') return Promise.resolve(Response.json({ error: 'fixture failure' }, { status: 503 }));
        return Promise.resolve(reply());
      };
      return true;
    })()`);
    await reopen("ready");
    await expect.poll(row, { timeout: 10_000 }).toBe(true);
    await evaluate("document.querySelector('[data-bot-profile-action=slack]').click(); true");
    await expect.poll(link, { timeout: 10_000 }).toMatch(/^https:\/\/admin\.example\.test\/slack\?workspace=acme&bot=/);
    expect(await snapshot()).toContain("Give this agent its own Slack app, with its own name and picture, so your team can message it directly.");
    expect(await snapshot()).toContain("Manage in Admin");
    expect(await evaluate(`document.querySelector('${modalSlack} a')?.getAttribute('rel')`)).toBe("noopener noreferrer");
    expect(await evaluate(`document.querySelector('${modalSlack} a')?.getAttribute('target')`)).toBe("_blank");
    // One link in the modal and the row's own Manage: no switches, no confirmations.
    expect(await evaluate(`document.querySelectorAll('${modalSlack} a').length`)).toBe(1);
    expect(await evaluate(`document.querySelectorAll('[data-bot-profile-channel=slack] button, [data-bot-profile-channel=slack] input').length`)).toBe(0);
    expect(await evaluate("document.querySelectorAll('[data-bot-profile-row=slack] button, [data-bot-profile-row=slack] input').length")).toBe(1);

    // Anything but an available answer removes the row, even though Slack was the open section.
    for (const mode of ["unavailable", "denied", "error"]) {
      await reopen(mode);
      expect(await row(), mode).toBe(false);
      expect(await link(), mode).toBeNull();
    }

    // An old response ignores AbortSignal deliberately: it must not surface
    // after these settings close and another agent's open.
    await reopen("pending");
    await expect.poll(() => evaluate("window.slackFixture.pending.length"), { timeout: 10_000 }).toBe(1);
    expect(await row()).toBe(false);
    await evaluate("document.querySelector('[data-bot-profile-topbar] [data-window-close]').click(); true");
    await runControlOmb(["new-bot", "--name", "Slack Juniper", "--url", fixture.url]);
    const saved = await fetch(`${fixture.url}/api/bots?messages=0`).then((response) => response.json()) as { bots: Array<{ id: string; name: string }> };
    const second = saved.bots.find((bot) => bot.name === "Slack Juniper")!;
    expect(second).toBeDefined();
    // Select the known fixture bot through the actual sidebar's accessible row.
    await expect.poll(snapshot, { timeout: 10_000 }).toContain("Slack Juniper");
    const sidebar = await ui("snapshot", "--interactive");
    const sidebarRow = Object.entries(sidebar.refs as Record<string, { role: string; name: string }>)
      .find(([, entry]) => entry.role === "button" && entry.name.includes("Slack Juniper") && !entry.name.startsWith("Open "));
    expect(sidebarRow).toBeDefined();
    await clickAccessible({ click, evaluate }, sidebarRow![1].name);
    await evaluate("window.slackFixture.mode = 'ready'; true");
    currentName = "Slack Juniper";
    await openProfile();
    await expect.poll(row, { timeout: 10_000 }).toBe(true);
    await evaluate("document.querySelector('[data-bot-profile-action=slack]').click(); true");
    const expected = `https://admin.example.test/slack?workspace=acme&bot=${second.id}`;
    await expect.poll(link, { timeout: 10_000 }).toBe(expected);
    await evaluate("window.slackFixture.pending.forEach(resolve => resolve()); true");
    expect(await link()).toBe(expected);
    await ui("screenshot", "--out", `${fixture.logPath}.slack-settings.png`);
    console.info(JSON.stringify({ logPath: fixture.logPath, screenshotPath: `${fixture.logPath}.slack-settings.png`, managementUrl: expected }));
    const renderer = await ui("console");
    expect(renderer.ok).toBe(true);
    expect((renderer.messages as Array<{ type: string }>).filter(message => message.type === "error")).toEqual([]);
    await waitForExit(child, { signal: "SIGINT", graceMs: 30_000 });
    expect(child.exitCode).toBe(0);
    expect(existsSync(fixture.dataDir)).toBe(false);
  }, launchTimeout + 180_000);
});
