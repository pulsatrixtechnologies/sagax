// Engine profiles. `fake` is the default: the repository's deterministic fake
// CLIs, safe in CI. `real` runs the same corpus against the person's own
// engine with the person's own keys; it is never started by tests, never run
// by an agent, and never reads a key (see docs/plans/grok-convergence-qualification/README.md).
import { isAbsolute } from "node:path";

import type { EngineKind } from "./model.ts";
import { FAKE_CLAUDE_CLI, type ServerPaths } from "./harness.ts";

export interface EngineProfile {
  kind: Extract<EngineKind, "fake" | "real">;
  label: string;
  claudeCli: string;
  /** The model the bots are given. */
  model: { instanceId: string; model: string };
  /** Environment variable NAMES (never values) the person lets through to a real engine; used for reporting. */
  passEnv: string[];
  /** FAKE_* knobs and log paths written into the engine instance. Empty for a real engine. */
  engineEnv(paths: ServerPaths): Record<string, string>;
}

export function fakeProfile(): EngineProfile {
  return {
    kind: "fake",
    label: "fake claude CLI (repository fixture)",
    claudeCli: FAKE_CLAUDE_CLI,
    model: { instanceId: "claude", model: "claude-fake" },
    passEnv: [],
    engineEnv: (paths) => ({
      FAKE_CLAUDE_PROMPTS: paths.prompts,
      FAKE_CLAUDE_LAUNCH_LOG: paths.launchLog,
    }),
  };
}

export interface RealOptions {
  /** QUALIFY_REAL_ENGINE=1 and --confirm-real-spend must both be present. */
  confirmed: boolean;
  /** Absolute path to the person's own engine CLI (a Claude Code compatible binary). */
  cli: string;
  model: string;
  /** Names of environment variables that carry the person's own key. */
  passEnv: string[];
  label?: string;
}

const ENV_NAME = /^[A-Z][A-Z0-9_]{1,63}$/;

/** Validate the opt-in and build the profile. Throws on anything short of an explicit, complete opt-in. */
export function realProfile(options: RealOptions, env: NodeJS.ProcessEnv = process.env): EngineProfile {
  if (env.QUALIFY_REAL_ENGINE !== "1" || !options.confirmed) {
    throw new Error("real engines are opt-in: set QUALIFY_REAL_ENGINE=1 and pass --confirm-real-spend (provider charges may apply to your own account)");
  }
  if (!isAbsolute(options.cli)) throw new Error("--real-cli must be an absolute path to your own engine CLI");
  if (!options.model.trim()) throw new Error("--real-model is required");
  if (!options.passEnv.length) throw new Error("--real-pass-env needs at least one variable name that carries your key (names only, never values)");
  for (const name of options.passEnv) {
    if (!ENV_NAME.test(name)) throw new Error(`--real-pass-env takes variable names, not values: ${JSON.stringify(name.slice(0, 3))}...`);
  }
  return {
    kind: "real",
    label: options.label ?? "real engine, the person's own keys",
    claudeCli: options.cli,
    model: { instanceId: "claude", model: options.model.trim() },
    passEnv: options.passEnv,
    // The values are copied from this process into the temporary, 0600
    // server config of this run (the Claude driver drops an inherited
    // ANTHROPIC_API_KEY, so the instance must carry it). Never logged.
    engineEnv: () => Object.fromEntries(options.passEnv.flatMap((name) => (env[name] === undefined ? [] : [[name, env[name]!]]))),
  };
}
