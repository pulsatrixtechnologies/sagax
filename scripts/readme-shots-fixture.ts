// The README screenshots' fixture: the verification server (fake engines,
// a disposable home, never ~/.sagax) seeded with a small team of invented
// bots, a conversation that uses tools and waits on an approval, a group,
// and routines; then the full app on a Vite dev server whose /api reaches
// only that fixture. Every name, message and file in it is made up.
// Prints {appUrl, ...} as JSON and serves until killed.
//
// Shots: a 1440x900 window at 2x, the app's skin set in localStorage
// ("omb-skin": "pulsatrix" or "pulsatrix-light"), achievement toasts hidden.
// Open Pixel (approval), Launch room (group), the profile menu's Automations
// (next week), Connect apps, and Settings > Models and voice. The fake Codex
// instance is named "Verification Codex" by the fixture; the README shot
// shows it as "Codex", the name a real install shows.
//
//   node --experimental-strip-types scripts/readme-shots-fixture.ts
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "vite";

import { launchVerificationServer } from "./control-omb.ts";
import { fixtureApi, parkUntilSignal } from "./testing/preview-fixture.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_EXIT_AFTER_TURN: "1" }, undefined, undefined, undefined, undefined, undefined, ["codex"]);
const { url, dataDir } = fixture.info;
const api = fixtureApi(url, { headers: { origin: url } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// One wrapper CLI that reads the scene for the next turn from a file: each
// turn is a fresh process (FAKE_CLAUDE_EXIT_AFTER_TURN), so each turn plays
// the scene written just before it.
const scenePath = join(dataDir, "scene.json");
const wrapper = join(dataDir, "scene-claude.mjs");
writeFileSync(wrapper, [
  "#!/usr/bin/env node",
  'import { readFileSync } from "node:fs";',
  `const scene = JSON.parse(readFileSync(${JSON.stringify(scenePath)}, "utf8"));`,
  "process.env.FAKE_CLAUDE_REPLIES = JSON.stringify([scene.reply ?? 'Done.']);",
  "process.env.FAKE_CLAUDE_TOOL_CALLS = JSON.stringify(scene.tools ?? []);",
  "if (scene.mode) process.env.FAKE_CLAUDE_MODE = scene.mode;",
  `await import(${JSON.stringify(pathToFileURL(join(root, "server/testing/fake-claude-cli.ts")).href)});`,
].join("\n"), { mode: 0o700 });
writeFileSync(scenePath, JSON.stringify({ reply: "Hi! Ready when you are." }));
await api("PATCH", "/api/instances/claude", { cli: wrapper, displayName: "Claude Code" }).catch((e) => console.error("[fixture] instance", String(e)));
await api("PATCH", "/api/config", { features: { showToolCalls: true }, language: "en", profile: { name: "Alex Morgan", email: "alex@example.com" } }).catch((e) => console.error("[fixture] config", String(e)));

const BOTS = [
  { key: "atlas", name: "Atlas", title: "Team lead", color: "blue", look: { character: "owl" }, pinned: true },
  { key: "pixel", name: "Pixel", title: "Frontend engineer", color: "red", look: { character: "owl" } },
  { key: "scout", name: "Scout", title: "QA and release", color: "orange", look: { character: "shape", shape: "hexagon" } },
  { key: "quill", name: "Quill", title: "Docs writer", color: "teal", look: { character: "owl" } },
  { key: "ledger", name: "Ledger", title: "Finance analyst", color: "purple", look: { character: "shape", shape: "squircle" } },
  { key: "nova", name: "Nova", title: "Research", color: "green", look: { character: "shape", shape: "cloud" } },
] as const;

const before = (await api("GET", "/api/bots?messages=0")).bots ?? [];
const ids: Record<string, { id: string; threadId: string }> = {};
for (const spec of BOTS) {
  const created = (await api("POST", "/api/bots", { name: spec.name, title: spec.title })).bot;
  ids[spec.key] = { id: created.id, threadId: created.threadId };
  await api("PATCH", `/api/bots/${created.id}`, { color: spec.color, mascotLook: spec.look, ...("pinned" in spec ? { pinned: true } : {}) }).catch((e) => console.error("[fixture] patch", spec.name, String(e)));
}
for (const extra of before) await api("DELETE", `/api/bots/${extra.id}`).catch(() => {});

const messagesOf = async (threadId: string) => (await api("GET", `/api/threads/${threadId}/messages?limit=200`)).messages as Array<{ role: string; card?: { requestId?: string } }>;
const turn = async (key: string, text: string, scene: Record<string, unknown>, threadId = ids[key]!.threadId) => {
  writeFileSync(scenePath, JSON.stringify(scene));
  const count = (await messagesOf(threadId)).filter((m) => m.role === "bot").length;
  await api("POST", `/api/bots/${ids[key]!.id}/messages`, { threadId, text });
  for (let i = 0; i < 300; i++) {
    await sleep(200);
    const bots = (await messagesOf(threadId)).filter((m) => m.role === "bot").length;
    if (bots > count) { await sleep(800); return; }
  }
  console.error(`[fixture] no reply from ${key}`);
};

await turn("ledger", "How did cloud spend move this month?", { reply: "Cloud spend is **$2,140** this month, up 9% from last month. Most of it is the new staging environment. I can draft a cheaper plan if you want." });
await turn("quill", "Refresh the getting started guide with the new screenshots.", { reply: "Updated: new screenshots, a shorter install section and a fixed link to the FAQ." });
await turn("nova", "Find three recent articles on passkeys for our blog roundup.", { reply: "Here are three solid picks, each with a one line summary. I left the links in the roundup draft." });
await turn("scout", "Run the full test pass on the preview build.", { reply: "Test pass finished: **118 passed, 0 failed**. Lighthouse is 97 on mobile." });
await turn("atlas", "Plan the week for the website launch.", { reply: "Plan is ready: Pixel ships the signup fix today, Scout tests Thursday, release Friday 10 AM." });

// Pixel: a real task with tools, then a push that waits for the owner.
await api("PATCH", `/api/bots/${ids.pixel!.id}/tasks/${ids.pixel!.threadId}`, { approvalMode: "ask" }).catch((e) => console.error("[fixture] approval mode", String(e)));
await turn("pixel", "The signup button overlaps the footer on small screens. Can you fix it?", {
  tools: [
    { name: "Grep", input: { pattern: "SignupButton", path: "src" }, output: "src/components/SignupForm.tsx:42", ok: true },
    { name: "Read", input: { file_path: "src/components/SignupForm.tsx" }, output: "export function SignupForm() { ... }", ok: true },
    { name: "Edit", input: { file_path: "src/components/SignupForm.tsx", old_string: "position: fixed", new_string: "position: sticky" }, output: "Edited 1 line", ok: true },
    { name: "Bash", input: { command: "pnpm test signup" }, output: "12 passed", ok: true },
  ],
  reply: [
    "Fixed. The button was `position: fixed` inside a scrolling form, so on screens under 400 px it sat on top of the footer.",
    "",
    "- **Change:** `SignupForm.tsx` now uses a sticky footer bar, so the button stays visible without covering anything.",
    "- **Tests:** the 12 signup tests pass, and I added one for a 360 px wide screen.",
    "- **Preview:** the branch `fix/signup-mobile` is ready to push.",
    "",
    "Want me to push it and open the pull request?",
  ].join("\n"),
});
writeFileSync(scenePath, JSON.stringify({ mode: "hang" }));
const dump = join(dataDir, "fake-claude-dump.json");
rmSync(dump, { force: true });
await api("POST", `/api/bots/${ids.pixel!.id}/messages`, { threadId: ids.pixel!.threadId, text: "Yes, push it and open the PR." });
for (let i = 0; i < 150 && !existsSync(dump); i++) await sleep(200);
let socket: ReturnType<typeof connect> | undefined;
try {
  const socketPath = JSON.parse(readFileSync(dump, "utf8")).mcpConfig.mcpServers.ogb.args.at(-1) as string;
  socket = connect(socketPath);
  await new Promise<void>((resolve, reject) => { socket!.once("connect", resolve); socket!.once("error", reject); });
  socket.write(JSON.stringify({ t: "ask", id: "readme-push", tool: "Bash", input: { command: "git push origin fix/signup-mobile && gh pr create --fill" } }) + "\n");
} catch (error) { console.error("[fixture] approval", String(error)); }

// A group and routines.
const group = await api("POST", "/api/groups", { name: "Launch room", memberIds: [ids.atlas!.id, ids.pixel!.id, ids.scout!.id] }).catch((e) => { console.error("[fixture] group", String(e)); return null; });
const routine = (botKey: string, name: string, prompt: string, schedule: unknown) =>
  api("POST", "/api/routines", { name, prompt, botId: ids[botKey]!.id, runOn: "maus", schedule, durationMinutes: 30 }).catch((e) => console.error("[fixture] routine", name, String(e)));
await routine("atlas", "Morning briefing", "Summarize what moved overnight and what blocks today.", { type: "daily", time: "09:30", weekdays: [1, 2, 3, 4, 5] });
await routine("pixel", "Dependency updates", "Update dependencies and open one pull request.", { type: "daily", time: "13:00", weekdays: [2] });
await routine("scout", "Release checklist", "Walk the release checklist and flag anything missing.", { type: "daily", time: "15:00", weekdays: [4] });
await routine("ledger", "Invoice reminders", "List unpaid invoices and draft reminders.", { type: "daily", time: "11:00", weekdays: [1] });
await routine("nova", "Competitor watch", "Summarize what competitors shipped this week.", { type: "daily", time: "14:00", weekdays: [3] });
await routine("quill", "Changelog draft", "Draft the changelog from merged pull requests.", { type: "daily", time: "11:30", weekdays: [5] });
await routine("ledger", "Weekly spend report", "Report cloud and tool spend for the week.", { type: "daily", time: "16:00", weekdays: [5] });
await routine("scout", "Nightly test pass", "Run the full test pass on main and post the result.", { type: "daily", time: "02:00", weekdays: [0, 1, 2, 3, 4, 5, 6] });
await routine("quill", "Docs link check", "Check every link in the docs and fix the broken ones.", { type: "daily", time: "10:00", weekdays: [1, 3] });
await routine("nova", "Industry digest", "Read the week's news on AI agents and write a short digest.", { type: "daily", time: "09:00", weekdays: [4] });

// The group's two exchanges: a mention makes that bot answer.
const groupId = group?.group?.id ?? group?.id;
const groupThread = group?.group?.threadId ?? group?.threadId;
const groupTurn = async (text: string, reply: string) => {
  writeFileSync(scenePath, JSON.stringify({ reply, tools: [] }));
  const count = (await messagesOf(groupThread)).filter((m) => m.role === "bot").length;
  await api("POST", `/api/groups/${groupId}/messages`, { text, threadId: groupThread });
  for (let i = 0; i < 300 && (await messagesOf(groupThread)).filter((m) => m.role === "bot").length <= count; i++) await sleep(300);
  await sleep(1500);
};
if (groupId && groupThread) {
  await groupTurn("@Atlas where are we on the 2.0 website launch for Friday?", "Here is the status:\n\n- **Pricing page**: done and reviewed.\n- **Signup flow**: Pixel fixed the mobile layout bug, the push is waiting for approval.\n- **Release notes**: Scout drafts them once the build is green.\n\nOne open question: do we keep the old blog URLs, or redirect them?");
  await groupTurn("Redirect them. @Scout run the full test pass on the preview and tell us if anything blocks Friday.", "Test pass finished: **118 passed, 0 failed**. Lighthouse is 97 on mobile. Nothing blocks Friday. I will post the release notes draft here in a few minutes.");
}
await api("PATCH", "/api/config", { onboarding: { completedAt: new Date().toISOString(), version: 999, reelSeen: true } }).catch((e) => console.error("[fixture] onboarding", String(e)));

const port = Number(new URL(url).port);
const ui = await createServer({
  root,
  logLevel: "warn",
  // SAGAX_README_UI_PORT pins the UI to one port (an agent's 5176-5206 range); unset, any free port
  server: { host: "127.0.0.1", port: Number(process.env.SAGAX_README_UI_PORT) || 0, strictPort: Boolean(process.env.SAGAX_README_UI_PORT), proxy: {
    "/api": { ws: true, target: url },
    "/.well-known/openmausbot/environment": { target: url },
  } },
});
await ui.listen();
console.log(JSON.stringify({ appUrl: ui.resolvedUrls?.local[0], url, port, dataDir, ids, groupId: group?.group?.id ?? group?.id ?? null }));
await parkUntilSignal();
socket?.destroy();
await ui.close();
await fixture.close();
