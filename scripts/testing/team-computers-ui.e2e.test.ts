import { openAccountMenu } from "./ui-click.ts";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { resolveAgentBrowserBinary } from "../../server/browser/browser-engine.ts";
import { waitForExit } from "../../server/testing/cleanup.ts";
import { runControlOmb } from "../control-omb.ts";
import { UI_TOOLS_DIR } from "./control-omb-ui.ts";
import { fixtureApi } from "./preview-fixture.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const binary = resolveAgentBrowserBinary({ dataDir: UI_TOOLS_DIR, env: process.env });
const enabled = process.env.SAGAX_UI_E2E === "1" || Boolean(binary);
if (!enabled) console.info("skipping team computers UI e2e: set SAGAX_UI_E2E=1 to install the pinned browser");

type Info = { ui: string; url: string; botId: string; dataDir: string; logPath: string; boatFixtureApi: string };
type Computer = { id: string; name: string; section: string | null; state: string; problem?: string; held?: boolean };

(enabled ? it : it.skip)("opens the current computer wizard without creating a paid cloud computer", async () => {
  let child: ChildProcess | undefined;
  let info: Info | undefined;
  const evidence: Record<string, unknown> = { input: "accessible clicks and keys; DOM click on the wizard Next control" };
  try {
    let stdout = "", stderr = "";
    child = spawn(process.execPath, ["--experimental-strip-types", join(ROOT, "scripts/testing/team-computers-preview.ts")], {
      cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (chunk: Buffer) => { stdout += String(chunk); });
    child.stderr!.on("data", (chunk: Buffer) => { stderr += String(chunk); });
    child.on("error", error => { stderr += error.message; });
    await expect.poll(() => {
      if (child!.exitCode !== null || child!.signalCode !== null) throw new Error(`Computer UI fixture exited: ${stderr}`);
      try { info = JSON.parse(stdout); return Boolean(info?.ui); } catch { return false; }
    }, { timeout: binary ? 180_000 : 600_000, interval: 250 }).toBe(true);
    const fixture = info!;
    const api = fixtureApi(fixture.url);
    const provider = fixtureApi(fixture.boatFixtureApi);
    const ui = (verb: string, ...args: string[]) => runControlOmb(["ui", verb, "--ui", fixture.ui, ...args]) as Promise<Record<string, any>>;
    const evaluate = async (js: string) => (await ui("eval", "--js", js)).result;
    const snapshot = async () => (await ui("snapshot")).snapshot as string;
    const ref = async (name: string, role?: string) => {
      let match: [string, unknown] | undefined;
      await expect.poll(async () => {
        const refs = (await ui("snapshot")).refs as Record<string, { name: string; role: string }>;
        const matches = Object.entries(refs).filter(([, entry]) => entry.name === name && (role ? entry.role === role : ["button", "menuitem"].includes(entry.role)));
        match = matches[0]; return matches.length;
      }, { timeout: 10_000, message: `${role} ${name}` }).toBe(1);
      return `@${match![0]}`;
    };
    const click = async (name: string, role?: string) => ui("click", "--ref", await ref(name, role));
    const computers = async (): Promise<Computer[]> => (await api("GET", "/api/team-computers")).computers;
    const receipts = () => provider("GET", "/__fixture");
    const openMap = async () => { await openAccountMenu({ click, snapshot }); await click("Tools"); await click("Team map"); await expect.poll(snapshot).toContain('region "Team canvas"'); };
    await api("PATCH", `/api/bots/${fixture.botId}`, { name: "Ada", section: "Engineering" });
    await api("POST", "/api/sidebar-sections", { name: "Research" });
    await api("POST", "/api/bots", { name: "Ben", section: "Research", modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } });
    const before = (await api("GET", "/api/bots?messages=10")).bots;
    await evaluate("location.reload(); true");
    await expect.poll(snapshot, { timeout: 15_000 }).toContain("Actions for Ada");
    await openMap();
    await click("Computers");
    await expect.poll(() => evaluate("document.querySelector('[data-add-computer-os]') !== null")).toBe(true);
    expect(await snapshot()).toContain('Add computer');
    expect((await receipts()).calls.every((call: { method: string }) => call.method === "GET")).toBe(true);
    expect(await computers()).toHaveLength(0);
    // #3098 deliberately removed cloud creation and computer drag/drop from
    // the Team map. It opens the same host-enrollment wizard as Remote
    // sessions; enrolled hosts are assigned through that page's Team action.
    await click("Windows", "radio");
    await evaluate("document.querySelector('[data-add-computer-next]').click(); true");
    await expect.poll(() => evaluate("document.querySelector('[data-add-computer-mode]') !== null")).toBe(true);
    await click("Close");
    await expect.poll(() => evaluate("document.querySelector('[data-add-computer-mode]') !== null")).toBe(false);
    expect(await computers()).toHaveLength(0);
    expect((await api("GET", "/api/bots?messages=10")).bots).toEqual(before);
    const providerResult = await receipts();
    expect(providerResult.calls.every((call: { method: string }) => call.method === "GET")).toBe(true);
    expect(providerResult.boats).toHaveLength(0);
    Object.assign(evidence, { computers: await computers(), provider: providerResult, finalSnapshot: await snapshot() });
    await ui("screenshot", "--out", `${fixture.logPath}.team-computers.png`);
    const logs = await ui("console");
    expect(logs.ok).toBe(true);
    expect((logs.messages as Array<{ type: string }>).filter(message => message.type === "error")).toEqual([]);
  } finally {
    try {
      if (info) {
        try { evidence.finalUi = await runControlOmb(["ui", "snapshot", "--ui", info.ui]); } catch { /* keep original failure */ }
        const path = `${info.logPath}.team-computers.json`;
        writeFileSync(path, JSON.stringify({ fixture: info, ...evidence }, null, 2), { mode: 0o600 });
        console.info(JSON.stringify({ evidence: path }));
      }
    } finally {
      await waitForExit(child, { signal: "SIGINT", graceMs: 30_000 });
      if (info) expect(existsSync(info.dataDir)).toBe(false);
    }
  }
}, binary ? 300_000 : 720_000);
