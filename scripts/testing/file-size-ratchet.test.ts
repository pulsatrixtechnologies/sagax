// Every source file over 1,000 lines is listed here with its line count, and
// a count may only go down: a PR that grows one of these files, or adds a new
// file over 1,000 lines, fails here. Lower a number when you shrink the file;
// remove the line when it drops under 1,000. The split program
// (server/host/README.md) moves server/index.ts into modules of under 1,500
// lines; nothing new may exceed HARD_CAP, and the files listed above the cap
// are the ones that program takes apart. Tests, fixtures, goldens and
// vendored code are not counted.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../../", import.meta.url);
const HARD_CAP = 2000;
const LISTED_FROM = 1000;

const LINES: Record<string, number> = {
  "server/index.ts": 44739,
  "src/state/store.tsx": 5760,
  "electron/main.mjs": 5141,
  "server/store.ts": 3726,
  "src/components/Sidebar.tsx": 3624,
  "server/drivers/claude.ts": 3321,
  "server/drivers/acp/core.ts": 3065,
  "server/routines.ts": 2639,
  "src/components/ChatView.tsx": 2427,
  "server/config.ts": 2406,
  "server/drivers/codex.ts": 2403,
  "src/components/RoutineCalendarPage.tsx": 2078,
  "src/components/LocalComputerSection.tsx": 1896,
  "src/components/GroupView.tsx": 1848,
  "src/components/ModelPicker.tsx": 1775,
  "server/routine-requests.ts": 1766,
  "src/components/ComputerPanel.tsx": 1708,
  "src/components/ChatMarkdown.tsx": 1675,
  "src/lib/voice-mode/call.ts": 1669,
  "server/drivers/agents-catalog.ts": 1635,
  "src/components/CursorAvatar.tsx": 1598,
  "server/skills.ts": 1593,
  "src/components/Composer.tsx": 1592,
  "server/composio.ts": 1572,
  "server/vps-computer.ts": 1571,
  "server/drivers/agents-call.ts": 1553,
  "scripts/mcp-server.ts": 1494,
  "server/drivers/pi.ts": 1494,
  "server/boat.ts": 1478,
  "server/container-computer.ts": 1477,
  "electron/floating-bot-window.mjs": 1392,
  "server/workspace-backup.ts": 1387,
  "src/components/PluginsPanel.tsx": 1363,
  "server/org-member-routes.ts": 1346,
  "server/cli.ts": 1332,
  "shared/wire.ts": 1327,
  "server/perspicax-link.ts": 1307,
  "src/components/PhoneSetupFlow.tsx": 1306,
  "server/webhooks.ts": 1289,
  "src/components/AttachmentPreview.tsx": 1196,
  "server/mcp-oauth.ts": 1195,
  "server/browser-runtime.ts": 1167,
  "src/components/McpServersPanel.tsx": 1164,
  "server/plan-usage.ts": 1159,
  "server/org-library.ts": 1155,
  "server/bot-zip.ts": 1141,
  "server/drivers/openai-chat.ts": 1141,
  "server/flow-tools.ts": 1128,
  "src/components/retro-assistant/RetroAssistant.tsx": 1124,
  "server/oidc-rp.ts": 1092,
  "server/data/tools.ts": 1090,
  "src/components/ogre-moves.ts": 1086,
  "server/request-auth.ts": 1068,
  "shared/custom-rules.ts": 1032,
  "server/drivers/acp/grok.ts": 1013,
  "shared/package-format.ts": 1011,
  "src/components/floating-bots/FloatingBotView.tsx": 1001,
};

function sourceFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "server", "shared", "src", "scripts", "evals", "electron", "companion"], { cwd: ROOT, encoding: "utf8" });
  return out.split("\n").filter((file) => /\.(ts|tsx|mjs|cjs)$/.test(file))
    .filter((file) => !file.includes(".test.") && !file.includes("/testing/") && !file.includes("goldens") && !file.startsWith("electron/vendor/"));
}

const count = (file: string) => readFileSync(new URL(file, ROOT), "utf8").split("\n").length - 1;

describe("source files stay a readable size", () => {
  it("no listed file grows, and no file over 1,000 lines goes unlisted", () => {
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const file of sourceFiles()) {
      const lines = count(file);
      const pinned = LINES[file];
      if (pinned !== undefined) {
        seen.add(file);
        if (lines > pinned) problems.push(`${file} grew to ${lines} lines (listed at ${pinned}): move code out, do not add here`);
        if (lines < LISTED_FROM) problems.push(`${file} is ${lines} lines: remove its line from LINES`);
        else if (lines < pinned) problems.push(`${file} is ${lines} lines: lower its number to ${lines}`);
      } else if (lines > LISTED_FROM) {
        problems.push(lines > HARD_CAP
          ? `${file} is ${lines} lines, over the ${HARD_CAP}-line cap: split it`
          : `${file} is ${lines} lines: a new file over ${LISTED_FROM} lines needs a line here and a reason in the PR`);
      }
    }
    for (const file of Object.keys(LINES)) if (!seen.has(file)) problems.push(`${file} is gone: remove its line from LINES`);
    expect(problems, "See server/host/README.md").toEqual([]);
  });
});
