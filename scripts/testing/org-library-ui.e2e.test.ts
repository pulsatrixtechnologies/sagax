import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { resolveAgentBrowserBinary } from "../../server/browser/browser-engine.ts";
import { waitForExit } from "../../server/testing/cleanup.ts";
import { canonicalJson, parsePackageDocument } from "../../shared/package-format.ts";
import { runControlOmb } from "../control-omb.ts";
import { request } from "../mcp-server.ts";
import { UI_TOOLS_DIR } from "./control-omb-ui.ts";
import { openTemplatesCatalog } from "./compose-flow.ts";
import { clickAccessible, openPanelAria } from "./ui-click.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FIXTURES = join(ROOT, "shared", "package-fixtures");
const binary = resolveAgentBrowserBinary({ dataDir: UI_TOOLS_DIR, env: process.env });
const forced = process.env.SAGAX_UI_E2E === "1";
const enabled = forced || Boolean(binary);
const launchTimeout = forced && !binary ? 600_000 : 180_000;
if (!enabled) console.log("skipping org-library UI e2e: set SAGAX_UI_E2E=1 to install the pinned browser");

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const ORG = "11111111-1111-4111-8111-111111111111";
const TEAM_ID = "22222222-2222-4222-8222-222222222222";
const LIBRARY_ID = "44444444-4444-4444-8444-444444444444";

/** A release as Admin serves it: parsed as a file, stamped, canonical bytes. */
function release(name: string) {
  const document: any = parsePackageDocument(JSON.parse(readFileSync(join(FIXTURES, name), "utf8")), { trust: "file" });
  document.package.publisher = { organization: "acme", name: "Acme Partners" };
  const bytes = canonicalJson(document);
  const pkg = document.package;
  return {
    bytes,
    sha256: sha(bytes),
    entry: (packageId: string) => ({
      packageId, ref: `acme/${pkg.id}`, name: pkg.name, tagline: pkg.tagline, kind: pkg.agents.length ? "team" : "library",
      publisher: { organizationId: "33333333-3333-4333-8333-333333333333", name: "Acme Partners", self: false },
      mode: pkg.agents.length ? "required" : "available", offAction: "keep",
      release: { version: pkg.release, sha256: sha(bytes), sizeBytes: Buffer.byteLength(bytes), formatVersion: 2, publishedAt: 1_700_000_000_000, notes: "" },
      withdrawnReleases: [],
      contents: { bots: pkg.agents.length, skills: pkg.skills?.entries.length ?? 0, presets: pkg.presets?.length ?? 0, rooms: pkg.rooms?.length ?? 0,
        routines: pkg.routines?.length ?? 0, connections: pkg.connections?.length ?? 0, botNames: pkg.agents.map((agent: any) => agent.name) },
      scanFindings: 0,
    }),
  };
}

describe("the organization library in the real renderer", () => {
  let child: ChildProcess | undefined;
  afterAll(async () => { await waitForExit(child, { signal: "SIGINT", graceMs: 30_000 }); });

  (enabled ? it : it.skip)("has no shelf without an organization, then adds a team and a skill with one click each", async () => {
    const key = randomBytes(32).toString("hex");
    let stdout = "";
    let stderr = "";
    let info: { ui: string; url: string; botId: string; dataDir: string; logPath: string };
    child = spawn(process.execPath, ["--experimental-strip-types", join(ROOT, "scripts/control-omb.ts"), "ui", "launch"], {
      cwd: ROOT, env: { ...process.env, SAGAX_TEST_ORG_LIBRARY_KEY: key }, stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (chunk: Buffer) => { stdout += String(chunk); });
    child.stderr!.on("data", (chunk: Buffer) => { stderr += String(chunk); });
    child.on("error", (error) => { stderr += error.message; });
    await expect.poll(() => {
      if (child!.exitCode !== null || child!.signalCode !== null) throw new Error(`UI launcher exited: ${stderr}`);
      try { info = JSON.parse(stdout); return Boolean(info.ui); } catch { return false; }
    }, { timeout: launchTimeout, interval: 250 }).toBe(true);
    const ui = (verb: string, ...args: string[]) => runControlOmb(["ui", verb, "--ui", info.ui, ...args]) as Promise<Record<string, any>>;
    const evaluate = async (js: string) => (await ui("eval", "--js", js)).result;
    const rawClick = (name: string) => ui("click", "--name", name);
    const click = (name: string) => clickAccessible({ click: rawClick, evaluate }, name);
    const press = (keys: string) => ui("press", "--keys", keys);
    const snapshot = async () => (await ui("snapshot")).snapshot as string;
    const api = (path: string, method = "GET", body?: unknown) => request(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, info.url);
    const evidence = (name: string) => ui("screenshot", "--out", join(ROOT, ".omb-scratch", "verify-evidence", name));
    const clickExact = async (label: string) => {
      const ok = await evaluate(`(() => {
        const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === ${JSON.stringify(label)});
        if (!btn) return false;
        btn.click();
        return true;
      })()`);
      if (!ok) throw new Error(`button ${JSON.stringify(label)} is missing`);
    };
    const catalogFlow = { click, flag: (assignment: string) => ui("flag", "--set", assignment), snapshot };

    // No organization: Templates has no organization shelf.
    await openTemplatesCatalog(catalogFlow);
    await expect.poll(snapshot, { timeout: 10_000 }).toContain("Templates");
    expect(await snapshot()).not.toContain("From Customer Co");
    await press("Escape");

    // Relay a catalog the way Electron does, with the files where it keeps them.
    const team = release("full-team.v2.json");
    const skills = release("library-only.v2.json");
    const blobs = join(info!.dataDir, "org-library", "blobs");
    mkdirSync(blobs, { recursive: true });
    for (const rel of [team, skills]) writeFileSync(join(blobs, `${rel.sha256}.json`), rel.bytes, { mode: 0o600 });
    const catalog = JSON.stringify({ format: "openmaus.org-library", version: 1, libraryVersion: 1, organization: { id: ORG, name: "Customer Co" },
      packages: [team.entry(TEAM_ID), skills.entry(LIBRARY_ID)] });
    const relayed = await fetch(`${info!.url}/api/testing/org-library`, {
      method: "POST", headers: { "content-type": "application/json", "x-openmausbot-test-org-library": key },
      body: JSON.stringify({ library: { adminOrigin: "https://admin.example.com", organizationId: ORG, organizationName: "Customer Co", digest: sha(catalog), catalog } }),
    });
    expect(relayed.status).toBe(200);

    // Org packages sit on Templates, first in the list.
    await openTemplatesCatalog(catalogFlow);
    await expect.poll(snapshot, { timeout: 10_000 }).toContain("Sales desk");
    let shelf = await snapshot();
    for (const line of ["Sales desk", "Sales skills", "by Acme Partners"]) expect(shelf).toContain(line);
    await evidence("org-library-shelf.png");

    // Details is the existing preview: skills arrive switched on here.
    // Mode badges ("Recommended by …") live on the detail notes, not the shelf.
    await click("Show Sales desk");
    await expect.poll(snapshot, { timeout: 10_000 }).toContain("Included skills (switched on)");
    const detail = await snapshot();
    expect(detail).toContain("Skills arrive switched on and routines paused");
    expect(detail).toContain("Recommended by Acme Partners");
    await evidence("org-library-preview.png");
    await click("Back");

    // Use this template adds the team: no confirmation. Click the exact
    // label so a card's short "Use" is not taken instead.
    await click("Show Sales desk");
    await clickExact("Use this template");
    await expect.poll(async () => (await api("/api/bots")).bots.filter((bot: { section?: string }) => bot.section === "Sales desk").length, { timeout: 20_000 }).toBe(3);
    // The sidebar lists the new team as its own section group.
    await expect.poll(snapshot, { timeout: 20_000 }).toContain('group "Sales desk"');
    const bots = (await api("/api/bots")).bots.filter((bot: { section?: string }) => bot.section === "Sales desk");
    expect(bots).toHaveLength(3);
    for (const bot of bots) {
      const listed = (await api(`/api/bots/${bot.id}/skills`)).skills as Array<{ enabled: boolean }>;
      expect(listed.every((skill) => skill.enabled)).toBe(true);
    }
    expect((await api("/api/routines")).routines.every((routine: { enabled: boolean }) => !routine.enabled)).toBe(true);

    // The shelf now says Added; the skills-only package adds in place.
    await openTemplatesCatalog(catalogFlow);
    await expect.poll(snapshot, { timeout: 10_000 }).toContain("Sales desk");
    shelf = await snapshot();
    expect(shelf).toContain("Added");
    await click("Show Sales skills");
    await clickExact("Use this template");
    await expect.poll(snapshot, { timeout: 10_000 }).toContain("Sales skills is added. Its skills are offered under each bot's Skills.");
    await evidence("org-library-added.png");
    await press("Escape");

    // Provenance lives on the bot panel Details tab. Select a Sales desk
    // bot first: after the catalog closes the header may still be on another bot.
    const deskBot = bots[0] as { id: string; name: string };
    await evaluate(`document.querySelector(${JSON.stringify(`[data-sidebar-bot-row="${deskBot.id}"]`)})?.click(); true`);
    await expect.poll(snapshot, { timeout: 10_000 }).toContain(openPanelAria(deskBot.name));
    await click(openPanelAria(deskBot.name));
    await expect.poll(snapshot, { timeout: 10_000 }).toContain("From Sales desk 1.3.0 · Acme Partners");
    // Edit bot sits in the panel's Bot menu.
    await click("Bot menu");
    await expect.poll(snapshot, { timeout: 10_000 }).toContain('menuitem "Edit bot"');
    await click("Edit bot");
    await expect.poll(snapshot, { timeout: 10_000 }).toContain("Skills");
    await click("Skills");
    // The shared skills card: its hint now sits behind the heading's help tip.
    await expect.poll(snapshot, { timeout: 10_000 }).toContain('heading "From Customer Co"');
    await evidence("org-library-bot-skills.png");
    await click("Add follow-up to this bot");
    await expect.poll(async () => ((await api(`/api/bots/${deskBot.id}/skills`)).skills as Array<{ name: string; enabled: boolean }>)
      .find((skill) => skill.name === "follow-up")?.enabled, { timeout: 10_000 }).toBe(true);
    process.stdout.write(`${JSON.stringify({ fixture: info!, addedSection: "Sales desk", offeredSkill: "follow-up" })}\n`);
  }, launchTimeout + 120_000);
});
