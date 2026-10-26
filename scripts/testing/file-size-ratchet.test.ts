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
  "server/index.ts": 48956,
  "src/state/store.tsx": 5885,
  "electron/main.mjs": 5367,
  "src/components/Sidebar.tsx": 3869,
  "server/store.ts": 3696,
  "server/drivers/claude.ts": 3609,
  "server/routines.ts": 3342,
  "server/drivers/acp/core.ts": 3175,
  "src/components/ChatView.tsx": 2498,
  "server/config.ts": 2460,
  "server/drivers/codex.ts": 2426,
  "src/components/RoutineCalendarPage.tsx": 2146,
  "server/webhooks.ts": 1994,
  "server/routine-requests.ts": 1904,
  "src/components/LocalComputerSection.tsx": 1896,
  "src/components/GroupView.tsx": 1882,
  "server/drivers/agents-catalog.ts": 1853,
  "src/components/ModelPicker.tsx": 1802,
  "server/drivers/agents-call.ts": 1757,
  "src/components/ComputerPanel.tsx": 1712,
  "src/lib/voice-mode/call.ts": 1707,
  "src/components/ChatMarkdown.tsx": 1678,
  "server/workspace-backup.ts": 1658,
  "src/components/CursorAvatar.tsx": 1598,
  "src/components/Composer.tsx": 1596,
  "server/skills.ts": 1593,
  "server/browser-runtime.ts": 1589,
  "server/vps-computer.ts": 1571,
  "server/drivers/pi.ts": 1530,
  "scripts/mcp-server.ts": 1494,
  "shared/wire.ts": 1493,
  "server/boat.ts": 1478,
  "server/container-computer.ts": 1477,
  "server/perspicax-link.ts": 1419,
  "electron/floating-bot-window.mjs": 1392,
  "server/org-member-routes.ts": 1365,
  "src/components/PhoneSetupFlow.tsx": 1306,
  "server/cli.ts": 1281,
  "server/request-auth.ts": 1261,
  "shared/custom-rules.ts": 1261,
  "server/plan-usage.ts": 1210,
  "server/drivers/openai-chat.ts": 1198,
  "src/components/AttachmentPreview.tsx": 1196,
  "server/mcp-oauth.ts": 1195,
  "src/components/PluginsPanel.tsx": 1185,
  "src/components/McpServersPanel.tsx": 1164,
  "server/bot-zip.ts": 1163,
  "server/org-library.ts": 1155,
  "server/credential-vault.ts": 1153,
  "server/bot-plugins.ts": 1136,
  "server/flow-tools.ts": 1128,
  "server/oidc-rp.ts": 1126,
  "src/components/retro-assistant/RetroAssistant.tsx": 1124,
  "server/drivers/acp/grok.ts": 1107,
  "server/data/tools.ts": 1090,
  "src/components/ogre-moves.ts": 1086,
  "server/idp-session.ts": 1074,
  "server/sessions.ts": 1027,
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
