// Structural guard (lot L2 of docs/design/connectors-across-engines.md, cause
// A): "which connectors does this turn have, and whose" is read in one place,
// server/connectors/turn-plan.ts, and every reader reads the turn's plan.
// Outside server/connectors and the Claude and Grok driver launch files, no
// source names the predicates or the provider switches; both turn paths
// compute the plan with the same function in setup, and their dispatch reads
// it. Runs with the merge gate on every PR (in the style of
// server/approvals/full-access-gate.guard.test.ts).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");

/** The predicates and the provider switches that decide a turn's connectors. */
const NAMES = [
  "claudeAiConnectorsForTurn",
  "grokCloudConnectorsForTurn",
  "GROK_MANAGED_MCPS_ENABLED",
  "ENABLE_CLAUDEAI_MCP_SERVERS",
  "--strict-mcp-config",
] as const;

/** Where they may be named. The plan, and the files that launch an engine
 * process with the flags the plan decided. */
const ALLOWED: ReadonlyArray<{ path: string; why: string }> = [
  { path: "server/connectors/", why: "the plan and the registry" },
  { path: "server/drivers/claude.ts", why: "Claude driver launch: the flag floors and the isolated one-shot call" },
  { path: "server/drivers/claude/", why: "Claude driver launch: the arguments and the environment of a turn" },
  { path: "server/drivers/acp/grok.ts", why: "Grok driver launch: the managed gateway environment of a turn" },
  { path: "server/claude-artifacts/runner.ts", why: "the pinned Claude call, isolated from every connector" },
];

const SKIP = /\.(?:test|e2e)\.ts$|\.d\.ts$/;

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (entry === "node_modules" || entry === "testing" || entry === "self-knowledge") continue;
    if (statSync(path).isDirectory()) { yield* sourceFiles(path); continue; }
    if (!/\.(?:ts|tsx|mts)$/.test(path) || SKIP.test(path)) continue;
    yield path;
  }
}

/** The code of a file, with its comments dropped (a comment may point at
 * the rule, the code may not use it). */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => line.replace(/(^|[^:"'`\\])\/\/.*$/, "$1"))
    .join("\n");
}

function oneSourceHits(root = ROOT): Array<{ file: string; line: number; name: string }> {
  const hits: Array<{ file: string; line: number; name: string }> = [];
  for (const top of ["server", "shared"]) {
    for (const path of sourceFiles(join(root, top))) {
      const file = relative(root, path).split("\\").join("/");
      if (ALLOWED.some((allowed) => allowed.path.endsWith("/") ? file.startsWith(allowed.path) : file === allowed.path)) continue;
      code(readFileSync(path, "utf8")).split("\n").forEach((text, index) => {
        for (const name of NAMES) if (text.includes(name)) hits.push({ file, line: index + 1, name });
      });
    }
  }
  return hits;
}

describe("one source for a turn's connectors (lot L2)", () => {
  it("no file outside the plan and the driver launch files names the predicates or the switches", () => {
    expect(oneSourceHits()).toEqual([]);
  });

  it("every allowed place still exists (a stale entry would hide a new reader)", () => {
    for (const allowed of ALLOWED) {
      expect(() => statSync(join(ROOT, allowed.path)), allowed.path).not.toThrow();
    }
  });

  it("the plan defines the predicates", () => {
    const plan = readFileSync(join(ROOT, "server/connectors/turn-plan.ts"), "utf8");
    expect(plan).toMatch(/export function claudeAiConnectorsForTurn\(/);
    expect(plan).toMatch(/export function grokCloudConnectorsForTurn\(/);
    expect(plan).toMatch(/export function createConnectorPlanForTurn[<(]/);
  });

  it("both turn paths compute the plan once in setup with the same function, and dispatch reads it", () => {
    const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
    const directSetup = read("server/turns/start-turn-setup.ts");
    const roomSetup = read("server/turns/group-member-turn-launch-tools.ts");
    expect(directSetup).toMatch(/state\.connectorPlan = connectorPlanForTurn\(/);
    expect(roomSetup).toMatch(/ctx\.roomConnectorPlan = connectorPlanForTurn\(/);
    const directDispatch = read("server/turns/start-turn-dispatch.ts");
    const roomDispatch = read("server/turns/group-member-turn-launch-dispatch.ts");
    // dispatchedConnectorPlan (L6) is connectorPlanAt, remembered for the thread
    expect(directDispatch).toMatch(/(?:connectorPlanAt|dispatchedConnectorPlan)\((?:state\.threadId, )?state\.connectorPlan/);
    expect(roomDispatch).toMatch(/(?:connectorPlanAt|dispatchedConnectorPlan)\((?:threadId, )?roomConnectorPlan/);
    for (const [path, source] of [["start-turn-dispatch", directDispatch], ["group-member-turn-launch-dispatch", roomDispatch]] as const) {
      expect(source, path).not.toMatch(/accountConnectorInput\(/);
    }
    expect(read("server/turns/start-turn-prompt.ts")).toMatch(/plan: state\.connectorPlan/);
    expect(read("server/turns/group-member-turn-launch-prompt.ts")).toMatch(/plan: ctx\.roomConnectorPlan/);
  });

  it("the readers outside a turn read the plan, never the account facts alone", () => {
    for (const leaf of ["engineConnectorsPromptFor", "turnReachPrompt", "turnConnectorsFor", "botCapabilitiesAs", "connectorSetupContext", "harnessCommandAccount"]) {
      const source = readFileSync(join(ROOT, `server/index-leaves/${leaf}.ts`), "utf8");
      expect(source, leaf).toMatch(/connectorPlanForTurn\(/);
      expect(code(source), leaf).not.toMatch(/accountConnectorInput\(|accountConnectorsForTurn\(/);
    }
  });
});
