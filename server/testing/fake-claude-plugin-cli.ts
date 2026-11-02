#!/usr/bin/env node
// Fake of the Claude Code plugin commands server/org/org-flow-plugins.ts runs,
// for its tests. It behaves like Claude Code 2.1.303 where it matters:
//   - a headless session start (`-p --input-format stream-json`) registers
//     the marketplaces declared in <CLAUDE_CONFIG_DIR>/settings.json
//     (`extraKnownMarketplaces`, a URL source with a `headersHelper`);
//   - every fetch (manifest, archive) carries the headers the helper prints,
//     the helper run as a shell command in this process's environment;
//   - `plugin install|update <id> -y --json` downloads the archive, refuses
//     one whose SHA-256 is not the manifest's, and records the install in
//     plugins/installed_plugins.json; `plugin list --json` reads it back.
// The archive here is JSON ({"files": {"<path>": "<text>"}}), not a zip.
// Every call is appended to FAKE_CLAUDE_PLUGIN_LOG (argv, and whether the
// token variable was set; never its value).
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const config = process.env.CLAUDE_CONFIG_DIR ?? "";
const plugins = join(config, "plugins");
const logFile = process.env.FAKE_CLAUDE_PLUGIN_LOG;
if (logFile) appendFileSync(logFile, `${JSON.stringify({ args, token: Boolean(process.env.SAGAX_FLOW_MARKETPLACE_TOKEN) })}\n`);

type Json = Record<string, any>;
const readJson = (path: string, fallback: Json): Json => {
  try { return JSON.parse(readFileSync(path, "utf8")) as Json; } catch { return fallback; }
};
const writeJson = (path: string, value: unknown) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
};
const out = (value: Json, code = 0) => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
  process.exit(code);
};

async function fetchWith(url: string, helper: string): Promise<Response> {
  const headers = JSON.parse(execSync(helper, { env: process.env, encoding: "utf8" })) as Record<string, string>;
  return fetch(url, { headers });
}

function declared(): Record<string, { url: string; headersHelper: string }> {
  const settings = readJson(join(config, "settings.json"), {});
  const out: Record<string, { url: string; headersHelper: string }> = {};
  for (const [name, entry] of Object.entries((settings.extraKnownMarketplaces ?? {}) as Json)) {
    const source = (entry as Json).source as Json;
    if (source?.source === "url") out[name] = { url: source.url, headersHelper: source.headersHelper };
  }
  return out;
}

async function refresh(name: string): Promise<string | null> {
  const entry = declared()[name];
  if (!entry) return `Marketplace '${name}' not found`;
  const res = await fetchWith(entry.url, entry.headersHelper);
  if (res.status !== 200) return `Request failed with status code ${res.status}`;
  writeJson(join(plugins, "marketplaces", name, "marketplace.json"), await res.json());
  const known = readJson(join(plugins, "known_marketplaces.json"), {});
  known[name] = { source: { source: "url", url: entry.url, headersHelper: entry.headersHelper }, installLocation: join(plugins, "marketplaces", name), lastUpdated: new Date().toISOString() };
  writeJson(join(plugins, "known_marketplaces.json"), known);
  return null;
}

const installedFile = join(plugins, "installed_plugins.json");

async function main() {
  if (args[0] === "-p") {
    for (const name of Object.keys(declared())) await refresh(name).catch(() => null);
    process.stdout.write(`${JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: "sagax-flow" } })}\n`);
    // a session waits for its input to end
    process.stdin.resume();
    process.stdin.on("end", () => process.exit(0));
    return;
  }
  if (args[0] !== "plugin") out({ outcome: "failed", message: `unknown command ${args.join(" ")}` }, 1);
  const [, verb, ...rest] = args;
  if (verb === "marketplace" && rest[0] === "update") {
    const error = await refresh(rest[1]!);
    if (error) out({ command: "marketplace-update", outcome: "failed", message: error }, 1);
    out({ command: "marketplace-update", outcome: "ok", marketplace: rest[1] });
  }
  const installed = readJson(installedFile, { version: 2, plugins: {} });
  if (verb === "list") {
    const list = Object.entries(installed.plugins as Json).map(([id, entries]) => ({ id, version: entries[0].version, installPath: entries[0].installPath, enabled: true }));
    process.stdout.write(JSON.stringify(list));
    process.exit(0);
  }
  if (verb === "uninstall") {
    const id = rest[0]!;
    const entry = installed.plugins[id];
    if (entry) rmSync(entry[0].installPath, { recursive: true, force: true });
    delete installed.plugins[id];
    writeJson(installedFile, installed);
    out({ command: "uninstall", outcome: "ok", plugin: id });
  }
  if (verb === "install" || verb === "update") {
    const id = rest[0]!;
    if (!rest.includes("-y")) out({ command: verb, outcome: "failed", message: "the headersHelper command needs -y" }, 1);
    const [name, market] = id.split("@") as [string, string];
    const manifest = readJson(join(plugins, "marketplaces", market, "marketplace.json"), { plugins: [] });
    const entry = (manifest.plugins as Json[]).find((p) => p.name === name);
    if (!entry) out({ command: verb, outcome: "failed", failureCode: "not_found", message: `Plugin "${name}" not found in marketplace "${market}"` }, 1);
    if (verb === "update" && installed.plugins[id]?.[0]?.version === entry!.version) out({ command: verb, outcome: "ok", updateOutcome: "up_to_date" });
    const helper = declared()[market]!.headersHelper;
    const res = await fetchWith(entry!.source.url, helper);
    if (res.status !== 200) out({ command: verb, outcome: "failed", message: `Request failed with status code ${res.status}` }, 1);
    const bytes = Buffer.from(await res.arrayBuffer());
    const got = createHash("sha256").update(bytes).digest("hex");
    if (got !== entry!.source.sha256) out({ command: verb, outcome: "failed", message: `Plugin archive integrity check failed: expected sha256 ${entry!.source.sha256}, got ${got}` }, 1);
    const files = (JSON.parse(bytes.toString("utf8")) as { files: Record<string, string> }).files;
    const installPath = join(plugins, "cache", market, name, entry!.version);
    rmSync(installPath, { recursive: true, force: true });
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(installPath, rel)), { recursive: true });
      writeFileSync(join(installPath, rel), text);
    }
    installed.plugins[id] = [{ scope: "user", installPath, version: entry!.version }];
    writeJson(installedFile, installed);
    out({ command: verb, outcome: "ok", plugin: id });
  }
  out({ outcome: "failed", message: `unknown command ${args.join(" ")}` }, 1);
}

void main().catch((error: unknown) => out({ outcome: "failed", message: error instanceof Error ? error.message : String(error) }, 1));
