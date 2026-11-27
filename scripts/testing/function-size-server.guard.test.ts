// #1383: no production function in server/ (except index.ts and testing/)
// or shared/ may exceed 400 lines (babel loc end - start + 1).
// Uses the same @babel/parser the fnlen measurement script uses.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hostTimeout } from "../../server/testing/host-timeout.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const require = createRequire(path.join(ROOT, "package.json"));
// Resolve via @babel/core so a pnpm version bump cannot break CI with a
// hardcoded .pnpm/@babel+parser@X path, and so a non-hoisted nested parser
// still loads (#5431).
const parser = require(require.resolve("@babel/parser", {
  paths: [path.dirname(require.resolve("@babel/core/package.json"))],
}));

const MAX_LINES = 400;
const FN_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ClassMethod",
  "ObjectMethod",
]);

// Base debt still over 400. Tracked so the guard stays a ratchet: new
// oversizers fail, these named leftovers do not. Refresh after the #5431
// babel resolve fix made the guard load again on every host.
const ALLOWED_OVERSIZED = new Set([
  "server/agent-api.ts::createAgentApiHandlers",
  "server/capabilities/capabilities.ts::resolveBotCapabilities",
  "server/desktop-trusted-approval.ts::createHandleDesktopTrustedApprovalMessage",
  "server/desktop-trusted-approval.ts::handleDesktopTrustedApprovalMessage",
  "server/drivers/chat-mcp-tools.ts::mountChatTools",
  "server/drivers/claude/create-instance.ts::createClaudeInstance",
  "server/drivers/claude/turn-prepare-mcp.ts::prepareClaudeTurnMcp",
  "server/drivers/codex/stream.ts::attachCodexStream",
  "server/drivers/muse-code.ts::create",
  "server/drivers/openai-chat-completion.ts::createChatCompletions",
  "server/drivers/openai-chat-turn.ts::executeOpenAIChatTurn",
  "server/memory/memory-upkeep.ts::createMemoryUpkeep",
  "server/org/org-member-routes.ts::memberRoutesWrite",
  "server/remote-support/host-computer-router.ts::createHostComputerRouter",
  "server/routes/bots-mutate-patch-build-access.ts::buildBotPatchAccess",
  "server/routes/internal-integrations.ts::(anon)",
  "server/routes/internal-integrations.ts::createInternalIntegrationsRoutes",
  "server/routines/routines.ts::tick",
  "server/runtime-events/request-opened-present.ts::presentRequestOpened",
  "server/settings-actions.ts::createSettingsActions",
  "server/turns/start-turn-prepare-admit.ts::createPrepareAdmitStartTurn",
  "server/turns/start-turn-prepare-validate.ts::createPrepareValidateStartTurn",
  "server/turns/start-turn-setup.ts::createSetupStartTurn",
  "server/turns/start-turn-setup.ts::setupStartTurn",
  "server/usage/limit-failover-host.ts::createLimitFailoverHost",
]);

type Oversized = { lines: number; file: string; line: number; name: string };

function listProductionFiles(): string[] {
  const out = execSync(
    "git ls-files 'server/*.ts' 'server/**/*.ts' 'shared/*.ts' 'shared/**/*.ts'",
    { cwd: ROOT, encoding: "utf8" },
  );
  return out
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean)
    .filter((f) => !/\.test\.|\.spec\.|\.d\.ts$/.test(f))
    .filter((f) => f !== "server/index.ts" && !f.startsWith("server/testing/"));
}

function oversizedFunctions(file: string): Oversized[] {
  const abs = path.join(ROOT, file);
  let source: string;
  try {
    source = fs.readFileSync(abs, "utf8");
  } catch {
    return [];
  }
  let ast: { program: unknown };
  try {
    ast = parser.parse(source, {
      sourceType: "module",
      plugins: ["typescript", ...(file.endsWith("x") ? ["jsx"] : [])],
      errorRecovery: true,
    });
  } catch {
    return [];
  }
  const found: Oversized[] = [];
  const stack: any[] = [ast.program];
  while (stack.length) {
    const n = stack.pop();
    if (!n || typeof n.type !== "string") continue;
    if (FN_TYPES.has(n.type) && n.loc) {
      const lines = n.loc.end.line - n.loc.start.line + 1;
      if (lines > MAX_LINES) {
        const name =
          (n.id && n.id.name) ||
          (n.key && n.key.name) ||
          n._nm ||
          "(anon)";
        found.push({ lines, file, line: n.loc.start.line, name: String(name) });
      }
    }
    for (const key of Object.keys(n)) {
      if (key === "loc") continue;
      const v = n[key];
      if (Array.isArray(v)) {
        for (const child of v) {
          if (child && typeof child.type === "string") {
            if (n.type === "VariableDeclarator") child._nm = n.id && n.id.name;
            stack.push(child);
          }
        }
      } else if (v && typeof v.type === "string") {
        if (n.type === "VariableDeclarator" && key === "init") v._nm = n.id && n.id.name;
        if ((n.type === "ObjectProperty" || n.type === "ClassProperty") && key === "value") {
          v._nm = n.key && n.key.name;
        }
        if (n.type === "CallExpression") v._nm = n._nm;
        stack.push(v);
      }
    }
  }
  return found;
}

describe("function size server/shared (#1383)", () => {
  it(
    `no production function exceeds ${MAX_LINES} lines`,
    { timeout: hostTimeout(120_000) },
    () => {
      const bad: Oversized[] = [];
      for (const file of listProductionFiles()) {
        bad.push(...oversizedFunctions(file));
      }
      const unexpected = bad.filter((b) => !ALLOWED_OVERSIZED.has(`${b.file}::${b.name}`));
      unexpected.sort((a, b) => b.lines - a.lines);
      const report = unexpected
        .slice(0, 40)
        .map((b) => `${b.lines}  ${b.file}:${b.line}  ${b.name}`)
        .join("\n");
      expect(unexpected, report || "none").toEqual([]);
    },
  );
});
