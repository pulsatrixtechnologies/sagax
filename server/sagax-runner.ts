#!/usr/bin/env node
// Entry point of the `sagax-run` image (deploy/run/Dockerfile): the runner of
// one cloud agent run, started as the Pod's only process by the provisioner
// (server/sandbox/sandboxd-runs-spec.ts). It sits at the server root so the drivers'
// spawned helpers resolve beside it once bundled (server/proxy-paths.ts).
//
// Environment, set by the provisioner:
//   PX_RUN_ID, PX_ENV_ID, PX_CONTROL_URL, PX_RUN_TOKEN_FILE, HOME=/workspace
// Optional:
//   PX_SECRETS_DIR      memory-backed directory for secrets (/dev/shm/px-secrets)
//   SAGAX_RUNNER_STATE  writable state of the engines (<HOME>/.sagax-runner)
//   PX_AGENT_EMAIL      e-mail of the "Pulsatrix Agent" commits
// Exit codes: 0 stopped, expired, terminated (SIGTERM) or token revoked
// (401); 1 failed.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { ControlClient, controlBase } from "./runner/protocol.ts";
import { runRunner } from "./runner/runner.ts";
import { DEFAULT_SECRETS_DIR } from "./runner/secrets.ts";

const TOKEN_RE = /^[A-Za-z0-9_-]{32,512}$/;

async function main(): Promise<number> {
  const base = controlBase(process.env.PX_CONTROL_URL);
  const tokenFile = process.env.PX_RUN_TOKEN_FILE?.trim();
  if (!tokenFile) throw new Error("PX_RUN_TOKEN_FILE is required");
  const token = readFileSync(tokenFile, "utf8").trim();
  if (!TOKEN_RE.test(token)) throw new Error("the run token file does not hold a run token");
  const workspace = process.env.HOME?.trim() || homedir();
  const stateDir = process.env.SAGAX_RUNNER_STATE?.trim() || join(workspace, ".sagax-runner");
  // The drivers read SAGAX_DATA_DIR when their modules load: set it before
  // the dynamic import below, inside the writable volume.
  process.env.SAGAX_DATA_DIR ??= join(stateDir, "data");
  const { ensureDirs } = await import("./config.ts");
  ensureDirs();
  const { realEngineFactory } = await import("./runner/engine-drivers.ts");
  // The token's file path leaves the runner's environment, so the engines
  // and setup do not inherit it. (The engines still get the token itself
  // as their model proxy key, by contract.)
  delete process.env.PX_RUN_TOKEN_FILE;
  const env: Record<string, string | undefined> = { ...process.env };
  const terminate = new AbortController();
  process.once("SIGTERM", () => terminate.abort());
  const result = await runRunner({
    signal: terminate.signal,
    runId: process.env.PX_RUN_ID?.trim() || undefined,
    client: new ControlClient({ base, token }),
    token,
    engineFactory: realEngineFactory(),
    workspace,
    secretsDir: process.env.PX_SECRETS_DIR?.trim() || DEFAULT_SECRETS_DIR,
    stateDir,
    env,
    agentEmail: process.env.PX_AGENT_EMAIL?.trim() || undefined,
  });
  process.stderr.write(`sagax-runner: ${result.exit}${result.error ? `: ${result.error}` : ""}\n`);
  return result.exit === "failed" ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    // Never the token: the messages above name files and variables only.
    process.stderr.write(`sagax-runner: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
