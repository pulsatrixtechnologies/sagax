// Headless captures of Import an agent (the reference app, Claude Code) against a
// disposable fake-engine server: both sources, each preview, and the import
// itself (the bot exists afterwards, its routine paused). Nothing opens a window.
//   node --experimental-strip-types scripts/testing/capture-agent-import.ts <outDir> [skin] [lang]
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { launchVerificationServer } from "../control-omb.ts";
import { mountPreview, type MountedPreview } from "./preview-fixture.ts";

const outDir = resolve(process.argv[2] ?? ".omb-scratch/agent-import");
const skin = process.argv[3] ?? "pulsatrix";
const lang = process.argv[4] ?? "fr";
mkdirSync(outDir, { recursive: true });

// A small Claude Code project, with a secret the import must never open.
const sample = mkdtempSync(join(tmpdir(), "sagax-agent-import-"));
const project = join(sample, "release-helper");
for (const dir of [".claude/skills/release-notes", ".claude/commands", ".claude/agents"]) mkdirSync(join(project, dir), { recursive: true });
writeFileSync(join(project, "CLAUDE.md"), "@AGENTS.md\n\nAnswer in the language of the question.\n");
writeFileSync(join(project, "AGENTS.md"), "# Release helper\n\nRun the tests before every release. Never push to main.\n");
writeFileSync(join(project, ".claude/skills/release-notes/SKILL.md"), "---\nname: release-notes\ndescription: Write the release notes from merged pull requests\n---\n\nList every merged pull request.\n");
writeFileSync(join(project, ".claude/commands/review.md"), "---\ndescription: Review the current diff\n---\n\nReview the diff for bugs.\n");
writeFileSync(join(project, ".claude/agents/test-runner.md"), "---\nname: test-runner\ndescription: Runs the tests and fixes failures\nskills: release-notes\n---\n\nYou run the tests and fix what fails.\n");
writeFileSync(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { tracker: { type: "http", url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer ${TRACKER_TOKEN}" } }, files: { command: "npx", args: ["-y", "files-server"], env: { FILES_TOKEN: "x" } } } }));
writeFileSync(join(project, ".env"), "TRACKER_TOKEN=never-read\n");

const grokReply = JSON.stringify({
  format: "openmaus.grok/1", source: "Grok Bot", name: "Scout", description: "Finds new leads and drafts the first email.",
  instructions: "Find five new leads every weekday. Draft, never send.",
  skills: [{ name: "lead-research", description: "Research a company before outreach", body: "Read the company's site and recent news." }],
  routines: [
    { name: "Morning leads", schedule: "Weekdays at 9am", cron: "0 9 * * 1-5", timeZone: "America/Toronto", prompt: "Find five new leads." },
    { name: "On reply", schedule: "When a lead replies by email", cron: "", timeZone: "", prompt: "Summarise the reply." },
  ],
  plugins: ["Gmail", "Google Calendar"], memories: [],
}, null, 2);

const browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_CAPTURE_CHROME ? { executablePath: process.env.SAGAX_CAPTURE_CHROME } : {}) });
const fixture = await launchVerificationServer();
let ui: MountedPreview | undefined;
try {
  ui = await mountPreview(fixture, { entry: "/src/testing/agent-import.tsx", route: "/__agent-import.html", title: "Import an agent", logLevel: "error" });
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 }, deviceScaleFactor: 2 });
  await page.goto(`${ui.previewUrl}?skin=${encodeURIComponent(skin)}&lang=${encodeURIComponent(lang)}`, { waitUntil: "load" });
  const shot = async (name: string) => {
    await page.waitForTimeout(400);
    const file = `${outDir}/${name}-${skin}-${lang}.png`;
    await page.locator("[data-agent-import-card]").screenshot({ path: file });
    console.log(`wrote ${file}`);
  };

  await page.waitForSelector("[data-agent-import]");
  await shot("01-grok");
  await page.fill("#grok-import-reply", grokReply);
  await page.click("[data-grok-preview]");
  await page.waitForSelector("[data-agent-import-summary]");
  await shot("02-grok-preview");
  await page.click("[data-bot-zip-cancel]");

  await page.click("[data-agent-import-tab=claude]");
  await shot("03-claude");
  await page.setInputFiles("[data-agent-import-folder]", project);
  await page.waitForSelector("[data-agent-import-summary]");
  await shot("04-claude-preview");
  await page.click("[data-bot-zip-confirm]");
  await page.waitForFunction(() => Boolean(document.body.dataset.imported), undefined, { timeout: 15_000 });

  // The the reference app one too, imported for real.
  await page.goto(`${ui.previewUrl}?skin=${encodeURIComponent(skin)}&lang=${encodeURIComponent(lang)}`, { waitUntil: "load" });
  await page.waitForSelector("[data-agent-import]");
  await page.fill("#grok-import-reply", grokReply);
  await page.click("[data-grok-preview]");
  await page.waitForSelector("[data-agent-import-summary]");
  await page.click("[data-bot-zip-confirm]");
  await page.waitForFunction(() => Boolean(document.body.dataset.imported), undefined, { timeout: 15_000 });

  // The import is real: the bots exist, inert.
  const { bots } = await fetch(`${fixture.info.url}/api/bots`).then((r) => r.json()) as { bots: Array<{ name: string }> };
  console.log(`bots after import: ${bots.map((bot) => bot.name).join(", ")}`);
  const routines = await fetch(`${fixture.info.url}/api/routines`).then((r) => r.json()).catch(() => null) as { routines?: Array<{ name: string; enabled: boolean }> } | null;
  console.log(`routines: ${JSON.stringify(routines?.routines?.map((routine) => ({ name: routine.name, enabled: routine.enabled })) ?? [])}`);
} finally {
  await browser.close();
  await ui?.close();
  await fixture.close();
  rmSync(sample, { recursive: true, force: true });
}
