// The launch contract of the connector hosts (#3354, connectors across
// engines L11; design docs/design/connectors-across-engines.md, section 6.2).
//
// Each host has one launch profile: its argv and what it sets or removes in
// the environment of the person's own sign-in (and, for Codex, the
// app-server methods it sends). This file snapshots each profile, and every
// flag, variable and method it uses must be known for the CLI version pinned
// in engines.lock.json, from a source named beside it (the pattern of
// CLAUDE_FLAG_FLOORS in server/drivers/claude.ts). The contract also names
// the pin it was checked against: a bump of a pin turns it red until the
// profile is checked again on the new CLI and the shapes are captured again
// (docs/verification/connectors-hub-measures.md, the capture of L0), so a
// change upstream fails here at the bump, not in production.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { CLAUDE_FLAG_FLOORS } from "../drivers/claude.ts";
import { claudeConnectorHostArgs, claudeConnectorHostEnv, claudeConnectorHostSettings } from "./hosts/claude-host.ts";
import { CODEX_CONNECTOR_HOST_METHODS, codexConnectorHostArgs, codexConnectorHostEnv, createCodexConnectorHost } from "./hosts/codex-host.ts";
import { grokConnectorHostArgs, grokConnectorHostEnv } from "./hosts/grok-host.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FAKE_CODEX = join(ROOT, "server", "testing", "fake-codex-app-server.ts");
const FIXTURES = join(ROOT, "server", "testing", "fixtures", "connectors");
const posixOnly = describe.skipIf(process.platform === "win32");

type Version = readonly [number, number, number];
const parse = (text: string): Version => {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  if (!match) throw new Error(`no version in ${text}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};
const atLeast = (version: Version, floor: Version) => {
  for (let i = 0; i < 3; i++) if (version[i] !== floor[i]) return version[i]! > floor[i]!;
  return true;
};

/** Where a flag, a variable or a method is known from, and since when. */
interface Known { since: string; source: string }

interface HostContract {
  /** the engine's id in engines.lock.json */
  engine: string;
  /** the pin this contract was checked against */
  checkedPin: string;
  /** the CLI the connector shapes were measured on (the L0 note) */
  measuredOn: string;
  flags: Record<string, Known>;
  env: Record<string, Known>;
  methods?: Record<string, Known>;
}

const claudeTurn = (since: string, file: string): Known => ({ since, source: `passed on every Claude turn (${file})` });
const floor = (flag: keyof typeof CLAUDE_FLAG_FLOORS): Known => ({ since: CLAUDE_FLAG_FLOORS[flag].join("."), source: "CLAUDE_FLAG_FLOORS (server/drivers/claude.ts)" });
const grokTurn = (file: string): Known => ({ since: "1.0.46", source: `set on every Grok turn or reach probe (${file})` });
const codexSchema = (name: string): Known => ({ since: "0.160.0", source: `${name} in codex-rs/app-server-protocol/schema/json/ClientRequest.json at rust-v0.160.0` });

export const CONNECTOR_HOST_CONTRACTS: Readonly<Record<"claude" | "grok" | "codex", HostContract>> = {
  claude: {
    engine: "claude",
    checkedPin: "2.1.318",
    measuredOn: "2.1.322",
    flags: {
      "-p": claudeTurn("2.1.0", "server/drivers/claude/instance-api.ts"),
      "--model": claudeTurn("2.1.0", "server/drivers/claude/turn-prepare-args.ts"),
      "--output-format": claudeTurn("2.1.0", "server/drivers/claude/turn-prepare-args.ts"),
      "--verbose": claudeTurn("2.1.0", "server/drivers/claude/turn-prepare-args.ts"),
      "--tools": floor("--tools"),
      "--allowedTools": claudeTurn("2.1.0", "server/drivers/claude/turn-prepare-mcp.ts"),
      "--permission-mode": claudeTurn("2.1.0", "server/drivers/claude/turn-prepare-args.ts"),
      "--permission-prompt-tool": claudeTurn("2.1.0", "server/drivers/claude/turn-prepare-mcp.ts"),
      "--mcp-config": claudeTurn("2.1.0", "server/drivers/claude/turn-prepare-mcp.ts"),
      "--settings": claudeTurn("2.1.0", "server/drivers/claude/turn-prepare-mcp.ts"),
      "--system-prompt": claudeTurn("2.1.0", "server/claude-artifacts/runner.ts"),
    },
    env: {
      ENABLE_TOOL_SEARCH: claudeTurn("2.1.0", "server/drivers/claude/turn-prepare-mcp.ts"),
      ENABLE_CLAUDEAI_MCP_SERVERS: claudeTurn("2.1.0", "server/drivers/claude/turn-prepare-mcp.ts"),
      ANTHROPIC_API_KEY: { since: "1.0.0", source: "the API key sign-in, removed so the subscription's connectors load" },
      ANTHROPIC_AUTH_TOKEN: { since: "1.0.0", source: "a gateway token sign-in, removed so the subscription's connectors load" },
      CLAUDE_CODE_OAUTH_TOKEN: { since: "1.0.0", source: "a long-lived token sign-in, removed so the account's own login is used" },
      SAGAX_CLAUDE_CONNECTOR_CALL: { since: "0.0.0", source: "Sagax's own marker, read by no CLI" },
    },
  },
  grok: {
    engine: "grok",
    checkedPin: "1.0.46",
    measuredOn: "1.0.77",
    flags: {
      "--permission-mode": grokTurn("server/drivers/acp/grok.ts"),
      default: grokTurn("server/drivers/acp/grok.ts"),
      agent: grokTurn("server/drivers/acp/grok.ts"),
      "--no-leader": grokTurn("server/drivers/acp/grok.ts"),
      "-m": grokTurn("server/drivers/acp/grok.ts"),
      stdio: grokTurn("server/drivers/acp/grok.ts"),
    },
    env: {
      GROK_AGENT: grokTurn("server/drivers/acp/grok.ts"),
      GROK_MANAGED_MCPS_ENABLED: grokTurn("server/drivers/acp/grok.ts grokCloudConnectorEnv"),
      GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED: grokTurn("server/drivers/acp/grok.ts grokCloudConnectorEnv"),
      XAI_API_KEY: { since: "1.0.0", source: "the API key sign-in, removed so the account's own login and its connectors are used" },
      SAGAX_GROK_CONNECTOR_CALL: { since: "0.0.0", source: "Sagax's own marker, read by no CLI" },
    },
  },
  codex: {
    engine: "codex",
    checkedPin: "0.160.0",
    measuredOn: "0.166.0",
    flags: {
      "app-server": { since: "0.160.0", source: "the app-server the Codex catalog and identity reads start (server/drivers/codex-catalog.ts)" },
    },
    env: {
      OPENAI_API_KEY: { since: "0.1.0", source: "the API key sign-in, removed: a key carries no ChatGPT apps" },
    },
    methods: Object.fromEntries(CODEX_CONNECTOR_HOST_METHODS.map((method) => [method, method === "initialized"
      ? { since: "0.160.0", source: "the notification an app-server client sends after initialize (server/drivers/codex-catalog.ts)" }
      : codexSchema(method)])),
  },
};

const pins = (): Record<string, string> => {
  const lock = JSON.parse(readFileSync(join(ROOT, "engines.lock.json"), "utf8")) as { engines: Array<{ id: string; version: string }> };
  return Object.fromEntries(lock.engines.map((engine) => [engine.id, engine.version]));
};

/** What a profile sets ("=value") or removes ("removed") in a base environment. */
function envChanges(base: Record<string, string | undefined>, launched: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of new Set([...Object.keys(base), ...Object.keys(launched)])) {
    if (base[key] === launched[key]) continue;
    out[key] = launched[key] === undefined ? "removed" : `=${launched[key]}`;
  }
  return out;
}

const BASE = {
  HOME: "/home/person", CLAUDE_CONFIG_DIR: "/home/person/.claude", GROK_HOME: "/home/person/.grok", CODEX_HOME: "/home/person/.codex",
  ANTHROPIC_API_KEY: "key", ANTHROPIC_AUTH_TOKEN: "token", CLAUDE_CODE_OAUTH_TOKEN: "token", ENABLE_CLAUDEAI_MCP_SERVERS: "false",
  XAI_API_KEY: "key", OPENAI_API_KEY: "key", GROK_MANAGED_MCPS_ENABLED: "false", GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED: "false",
};

describe("connector host launch profiles (#3354)", () => {
  it("snapshots the Claude host's argv and environment", () => {
    expect(claudeConnectorHostArgs({ mcpConfig: "<mcp>", settings: "<settings>" })).toEqual([
      "-p", "--model", "haiku",
      "--output-format", "stream-json", "--verbose",
      "--tools", "ToolSearch",
      "--allowedTools", "ToolSearch",
      "--permission-mode", "default",
      "--permission-prompt-tool", "mcp__ogb__approve",
      "--mcp-config", "<mcp>",
      "--settings", "<settings>",
      "--system-prompt", expect.any(String),
    ]);
    expect(envChanges(BASE, claudeConnectorHostEnv({ ...BASE }))).toEqual({
      ENABLE_TOOL_SEARCH: "=true",
      SAGAX_CLAUDE_CONNECTOR_CALL: "=1",
      ENABLE_CLAUDEAI_MCP_SERVERS: "removed",
      ANTHROPIC_API_KEY: "removed",
      ANTHROPIC_AUTH_TOKEN: "removed",
      CLAUDE_CODE_OAUTH_TOKEN: "removed",
    });
    // the connector tool always asks the host, whatever the account allows
    expect(claudeConnectorHostSettings("mcp__claude_ai_Example__read")).toEqual({ permissions: { ask: ["mcp__claude_ai_Example__read"] } });
  });

  it("snapshots the Grok host's argv and environment", () => {
    const empty = mkdtempSync(join(tmpdir(), "sagax-grok-contract-"));
    try {
      const env = { ...BASE, GROK_HOME: empty };
      expect(grokConnectorHostArgs(env)).toEqual(["--permission-mode", "default", "agent", "--no-leader", "stdio"]);
      expect(envChanges(env, grokConnectorHostEnv({ ...env }))).toEqual({
        GROK_AGENT: "=grok-build",
        GROK_MANAGED_MCPS_ENABLED: "=true",
        GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED: "=true",
        SAGAX_GROK_CONNECTOR_CALL: "=1",
        XAI_API_KEY: "removed",
      });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("snapshots the Codex host's argv and environment", () => {
    expect(codexConnectorHostArgs()).toEqual(["app-server"]);
    expect(envChanges(BASE, codexConnectorHostEnv({ ...BASE }))).toEqual({ OPENAI_API_KEY: "removed" });
  });

  it("knows every flag and variable of each profile for the pinned CLI", () => {
    const pinned = pins();
    const empty = mkdtempSync(join(tmpdir(), "sagax-grok-contract-"));
    try {
      const used: Record<keyof typeof CONNECTOR_HOST_CONTRACTS, { flags: string[]; env: string[] }> = {
        claude: {
          flags: claudeConnectorHostArgs({ mcpConfig: "<mcp>", settings: "<settings>" }).filter((arg) => arg.startsWith("-")),
          env: Object.keys(envChanges(BASE, claudeConnectorHostEnv({ ...BASE }))),
        },
        grok: {
          // the subcommands and the mode value are part of the argv too
          flags: grokConnectorHostArgs({ ...BASE, GROK_HOME: empty }),
          env: Object.keys(envChanges({ ...BASE, GROK_HOME: empty }, grokConnectorHostEnv({ ...BASE, GROK_HOME: empty }))),
        },
        codex: {
          flags: codexConnectorHostArgs(),
          env: Object.keys(envChanges(BASE, codexConnectorHostEnv({ ...BASE }))),
        },
      };
      for (const [host, contract] of Object.entries(CONNECTOR_HOST_CONTRACTS) as Array<[keyof typeof CONNECTOR_HOST_CONTRACTS, HostContract]>) {
        const pin = pinned[contract.engine];
        expect(pin, `${contract.engine} is pinned in engines.lock.json`).toBeTruthy();
        // a bump of the pin: check the profile on the new CLI, capture the
        // shapes again (L0), then move checkedPin and measuredOn
        expect(pin, `${host}: the pin moved; check the launch profile on ${pin} and capture the connector shapes again`).toBe(contract.checkedPin);
        for (const flag of used[host].flags) {
          const known = contract.flags[flag];
          expect(known, `${host}: ${flag} has no known floor`).toBeTruthy();
          expect(atLeast(parse(pin!), parse(known!.since)), `${host}: ${flag} is known from ${known!.since}, the pin is ${pin}`).toBe(true);
        }
        for (const name of used[host].env) {
          const known = contract.env[name];
          expect(known, `${host}: ${name} has no known floor`).toBeTruthy();
          expect(atLeast(parse(pin!), parse(known!.since)), `${host}: ${name} is known from ${known!.since}, the pin is ${pin}`).toBe(true);
        }
        // the shapes the fakes replay were captured on a CLI no older than the pin
        expect(atLeast(parse(contract.measuredOn), parse(pin!)), `${host}: the connector shapes were measured on ${contract.measuredOn}, older than the pin ${pin}`).toBe(true);
        // no stale entry
        expect(Object.keys(contract.flags).filter((flag) => !used[host].flags.includes(flag) && flag !== "-m"), host).toEqual([]);
        expect(Object.keys(contract.env).filter((name) => !used[host].env.includes(name)), host).toEqual([]);
      }
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("names the measured CLIs the way the measures note does", () => {
    const note = readFileSync(join(ROOT, "docs", "verification", "connectors-hub-measures.md"), "utf8");
    const line = /CLIs measured: ([^\n]+)/.exec(note)?.[1] ?? "";
    for (const contract of Object.values(CONNECTOR_HOST_CONTRACTS)) expect(line, contract.engine).toContain(contract.measuredOn);
  });
});

posixOnly("Codex host methods (#3354)", () => {
  it("sends only the methods of the contract, each known for the pin, and never turn/start", async () => {
    chmodSync(FAKE_CODEX, 0o755);
    const root = realpathSync(mkdtempSync(join(tmpdir(), "sagax-codex-contract-")));
    let host: ReturnType<typeof createCodexConnectorHost> | undefined;
    try {
      const home = join(root, "codex");
      mkdirSync(home, { recursive: true });
      const log = join(root, "methods.jsonl");
      const launch = { cli: FAKE_CODEX, env: { ...process.env, CODEX_HOME: home, FAKE_CODEX_CONNECTOR_REPLAY: FIXTURES, FAKE_CODEX_METHOD_LOG: log } };
      host = createCodexConnectorHost({ launch: () => launch, gate: (_label, run) => run(), timeoutMs: 15_000, listTimeoutMs: 15_000 });
      const listing = await host.listApps(launch);
      expect(listing?.auth).toBe("subscription");
      const ref = { provider: "chatgpt-apps" as const, driver: "codex" as const, instanceId: "default", slot: "primary" as const };
      const mail = { name: "Example Mail", state: "connected" as const, tools: [{ id: "example_mail.list_messages" }] };
      await host.call({ principalId: "ana", account: { ...ref, key: "chatgpt-apps:default:primary", label: "ChatGPT", auth: "subscription", connectors: [mail], at: 1 }, connector: mail, tool: "example_mail.list_messages", arguments: { folder: "Inbox" }, engine: "claudeAgent" });
      const sent = existsSync(log) ? [...new Set(readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => (JSON.parse(line) as { method: string }).method))] : [];
      expect(sent).toContain("mcpServer/tool/call");
      expect(sent).not.toContain("turn/start");
      const methods = CONNECTOR_HOST_CONTRACTS.codex.methods!;
      const pin = pins().codex!;
      for (const method of sent) {
        expect(methods[method], `${method} is not in the Codex host's contract`).toBeTruthy();
        expect(atLeast(parse(pin), parse(methods[method]!.since)), method).toBe(true);
      }
    } finally {
      // #3357: the warm app-server ends with the host
      await host?.close?.();
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
