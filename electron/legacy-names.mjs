// The names this app used before it was called Sagax, and how they are still
// honored (docs/code/repository.md, "Legacy names kept for compatibility", says which stay
// on purpose). One module for Electron main, the server and the CLI (the
// server imports it from here, like data-dir-lease.mjs).
//
// The code reads the new names (SAGAX_*). The old ones are still accepted
// from outside (a person's shell, a compose file, an older deployment) and
// moved onto the new names once, at the start of every entry point.
import nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";

import { dataDirLeaseIsActive } from "./data-dir-lease.mjs";

// ── environment ──────────────────────────────────────────────────────────
//
// SAGAX_<NAME> is read first, then the old name for the same setting. Most
// old names are OMB_<NAME>; a few came with an OPENMAUSBOT_ or OPENMAUS_
// prefix (listed below so that SAGAX_URL maps to OPENMAUSBOT_URL, say).

export const ENV_PREFIX = "SAGAX_";
export const LEGACY_ENV_PREFIX = "OMB_";
/** Longest first: OPENMAUSBOT_ must win over OPENMAUS_. */
export const LEGACY_ENV_PREFIXES = Object.freeze(["OPENMAUSBOT_", "OPENMAUS_", "OMB_"]);

/** Settings whose old name was OPENMAUSBOT_<NAME> (exact, or a prefix ending in _). */
const OPENMAUSBOT_NAMES = Object.freeze([
  "CHATGPT_TOKEN", "COMPANY_API_KEY", "CUA_ARCHES", "CUA_ARCHES_PARTIAL", "CUA_ARCHIVE_PATH",
  "CUA_EMBEDDED", "CUA_OFFLINE", "CUA_SDK_LIBRARY", "MCP_TIMEOUT_MS", "POSTINSTALL_TEST_ROOT",
  "PROBE_LOCAL_INJECT", "TOKEN", "URL", "LOCAL_", "QWEN_",
]);
/** Settings whose old name was OPENMAUS_<NAME>. */
const OPENMAUS_NAMES = Object.freeze(["ACP_", "OPENAI_COMPAT_IDLE_TIMEOUT_MS", "STATUS_CACHE_PATH"]);

/** Process-internal capabilities, not settings a person sets. */
const INTERNAL_ENV = /^(?:OMB|OPENMAUSBOT|OPENMAUS|SAGAX)_INTERNAL_/;
/** Set once a process has bridged, so a child it spawns does not warn about
 * the old names its parent set for it. */
export const ENV_BRIDGED_MARKER = "SAGAX_INTERNAL_ENV_BRIDGED";

const matches = (list, name) => list.some((entry) => (entry.endsWith("_") ? name.startsWith(entry) : name === entry));

/** The old variable name for a setting: `legacyEnvName("DATA_DIR")` is OMB_DATA_DIR. */
export function legacyEnvName(name) {
  if (matches(OPENMAUSBOT_NAMES, name)) return `OPENMAUSBOT_${name}`;
  if (matches(OPENMAUS_NAMES, name)) return `OPENMAUS_${name}`;
  return `${LEGACY_ENV_PREFIX}${name}`;
}

/** The setting an old variable carries (OMB_DATA_DIR is DATA_DIR), or null. */
export function settingOfLegacyEnv(variable) {
  const prefix = LEGACY_ENV_PREFIXES.find((candidate) => variable.startsWith(candidate));
  if (!prefix) return null;
  const name = variable.slice(prefix.length);
  return name && legacyEnvName(name) === variable ? name : null;
}

/** One setting: SAGAX_<NAME> first, then its old name. Undefined when neither is set. */
export function readEnv(name, env = process.env) {
  const current = env[`${ENV_PREFIX}${name}`];
  return current !== undefined ? current : env[legacyEnvName(name)];
}

/** The name the code reads for a variable name that may be an old one
 * (a provider's `apiKeyEnv` saved before the rename): OMB_X becomes SAGAX_X,
 * anything else is returned as is. */
export function currentEnvName(name) {
  if (typeof name !== "string" || INTERNAL_ENV.test(name)) return name;
  const setting = settingOfLegacyEnv(name);
  return setting === null ? name : `${ENV_PREFIX}${setting}`;
}

/** The value of a variable named by data (saved configs, an instance's own
 * environment), whichever of its new or old name holds it; the given name first. */
export function readEnvName(name, env = process.env) {
  if (typeof name !== "string" || !name) return undefined;
  if (env[name] !== undefined) return env[name];
  const current = currentEnvName(name);
  if (current !== name) return env[current];
  if (name.startsWith(ENV_PREFIX) && !INTERNAL_ENV.test(name)) return env[legacyEnvName(name.slice(ENV_PREFIX.length))];
  return undefined;
}

/**
 * Make the old names reach the code, which reads SAGAX_*.
 * Called once, first thing, by every entry point (legacy-env-boot.mjs).
 *
 * For each old variable (OMB_<NAME>, or its OPENMAUSBOT_/OPENMAUS_ twin) the
 * value moves to SAGAX_<NAME> unless that is already set (the new name wins),
 * and the old variable is removed. Removing it keeps one name authoritative
 * in children: a child bridges again, and an old name left behind would come
 * back over a SAGAX_<NAME> its parent removed or changed on purpose.
 * Internal capabilities (the data folder lease) keep their names.
 *
 * Warns once, listing the old names a person set without a SAGAX_ value.
 * Returns those names.
 */
export function bridgeLegacyEnv(env = process.env, { warn = (line) => console.warn(line) } = {}) {
  const inherited = env[ENV_BRIDGED_MARKER] === "1";
  const legacyUsed = [];
  for (const key of Object.keys(env)) {
    if (INTERNAL_ENV.test(key)) continue;
    const name = settingOfLegacyEnv(key);
    if (name === null) continue;
    const current = `${ENV_PREFIX}${name}`;
    if (env[current] === undefined) {
      legacyUsed.push(key);
      env[current] = env[key];
    }
    delete env[key];
  }
  env[ENV_BRIDGED_MARKER] = "1";
  legacyUsed.sort();
  if (legacyUsed.length > 0 && !inherited) {
    warn(`[sagax] deprecated environment variables: ${legacyUsed.join(", ")}. Rename them to SAGAX_<NAME> (OMB_DATA_DIR becomes SAGAX_DATA_DIR); the old names are read for one more release only.`);
  }
  return legacyUsed;
}

// ── data folders ─────────────────────────────────────────────────────────
//
// ~/.sagax replaces ~/.openmausbot. The first start without ~/.sagax moves
// the old folder over (one rename, same volume) and leaves the old path as a
// link to the new one (paths saved inside the data keep resolving, and an
// older copy of the app opened afterwards finds its data) plus a breadcrumb
// file inside the new folder. When the move cannot happen (an older copy is
// running, or the rename fails) the old folder stays and is used as is:
// nothing is copied, nothing is deleted, and no empty ~/.sagax is created
// that would hide the data. The lease file inside keeps its old name
// (openmausbot-server.lease) so old and new copies still see each other.

export const DATA_FOLDER = ".sagax";
export const LEGACY_DATA_FOLDER = ".openmausbot";
/** Written inside the new folder after a move: where it came from, and when. */
export const MIGRATION_BREADCRUMB = "MOVED_FROM_OPENMAUSBOT.json";

const LOCK_STALE_MS = 10 * 60_000;
const WAIT_SLICE_MS = 50;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function lstatOrNull(fs, file) {
  try {
    return fs.lstatSync(file);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

/** A real folder (not a link left by an earlier move). */
function isRealDir(fs, file) {
  const stat = lstatOrNull(fs, file);
  return Boolean(stat && stat.isDirectory() && !stat.isSymbolicLink());
}

function lockIsStale(fs, lock, now) {
  try {
    const stat = fs.statSync(lock);
    if (now() - stat.mtimeMs > LOCK_STALE_MS) return true;
    const pid = Number.parseInt(fs.readFileSync(lock, "utf8"), 10);
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      return error?.code === "ESRCH";
    }
  } catch (error) {
    return error?.code === "ENOENT";
  }
}

/** Hold an exclusive lock file beside `target` while `fn` runs. */
function withMigrationLock({ target, fs, now, timeoutMs }, fn) {
  const lock = `${target}.migrating.lock`;
  const deadline = now() + timeoutMs;
  let fd = null;
  while (fd === null) {
    try {
      fd = fs.openSync(lock, "wx", 0o600);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (lockIsStale(fs, lock, now)) {
        try { fs.unlinkSync(lock); } catch { /* another process took it */ }
        continue;
      }
      if (now() > deadline) throw new Error(`timed out waiting for another process to move ${target} into place`);
      sleepSync(WAIT_SLICE_MS);
    }
  }
  try {
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    fd = null;
    return fn();
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* closed */ } }
    try { fs.unlinkSync(lock); } catch { /* already gone */ }
  }
}

/**
 * Move `legacy` to `target` once, when `target` does not exist yet.
 *
 * Serialized across processes by a lock file beside `target`; a second
 * process waits, then finds `target` in place. `isBusy(legacy)` says an
 * older copy of the app is using the folder: then nothing moves. Returns
 * "exists" (target already there), "none" (no old folder), "busy", "moved"
 * or "failed" (the rename failed; the old folder is untouched).
 */
export function migrateLegacyDir({
  target,
  legacy,
  isBusy = () => false,
  fs = nodeFs,
  log = () => {},
  now = Date.now,
  timeoutMs = 120_000,
  breadcrumb = MIGRATION_BREADCRUMB,
}) {
  if (lstatOrNull(fs, target)) return "exists";
  if (!isRealDir(fs, legacy)) return "none";
  if (isBusy(legacy)) return "busy";
  fs.mkdirSync(path.dirname(target), { recursive: true });
  return withMigrationLock({ target, fs, now, timeoutMs }, () => {
    // the process that held the lock before us may have done the job
    if (lstatOrNull(fs, target)) return "exists";
    if (!isRealDir(fs, legacy)) return "none";
    if (isBusy(legacy)) return "busy";
    try {
      fs.renameSync(legacy, target);
    } catch (error) {
      log(`data folder: could not move ${legacy} to ${target} (${error?.code ?? error}); still using ${legacy}`);
      return "failed";
    }
    try {
      fs.writeFileSync(path.join(target, breadcrumb), `${JSON.stringify({ from: legacy, to: target, movedAt: new Date(now()).toISOString() }, null, 2)}\n`, { mode: 0o600 });
    } catch (error) {
      log(`data folder: could not write the breadcrumb in ${target} (${error?.code ?? error})`);
    }
    try {
      fs.symlinkSync(target, legacy, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      log(`data folder: could not leave a link at ${legacy} (${error?.code ?? error})`);
    }
    log(`data folder: moved ${legacy} to ${target}`);
    return "moved";
  });
}

/**
 * The default data folder (~/.sagax), carrying ~/.openmausbot over first
 * when `migrate` is true. Without `migrate` (a CLI that only reads, a path
 * check) it answers the folder in use: ~/.sagax when it exists, else an old
 * ~/.openmausbot. An explicit SAGAX_DATA_DIR / OMB_DATA_DIR is the caller's
 * business (readEnv("DATA_DIR")) and is never moved.
 */
export function defaultDataDir({
  home = os.homedir(),
  fs = nodeFs,
  log = (line) => console.warn(line),
  migrate = true,
  isBusy = dataDirLeaseIsActive,
} = {}) {
  const target = path.join(home, DATA_FOLDER);
  const legacy = path.join(home, LEGACY_DATA_FOLDER);
  if (lstatOrNull(fs, target)) return target;
  if (!isRealDir(fs, legacy)) return target;
  if (!migrate) return legacy;
  let outcome;
  try {
    outcome = migrateLegacyDir({ target, legacy, isBusy, fs, log });
  } catch (error) {
    log(`data folder: could not move ${legacy} (${error?.message ?? error}); still using it`);
    return legacy;
  }
  if (outcome === "busy") log(`data folder: ${legacy} is in use by a running copy of the app; not moved this time`);
  return outcome === "busy" || outcome === "failed" ? legacy : target;
}

// ── well-known descriptor ────────────────────────────────────────────────

export const ENVIRONMENT_PATH = "/.well-known/sagax/environment";
export const LEGACY_ENVIRONMENT_PATH = "/.well-known/openmausbot/environment";
export const ENVIRONMENT_PATHS = Object.freeze([ENVIRONMENT_PATH, LEGACY_ENVIRONMENT_PATH]);

/** Fetch a server's environment descriptor: the new path first, then the old
 * one for a server that predates it (on a 404 only). Returns the Response. */
export async function fetchEnvironmentDescriptor(origin, init = {}, fetchImpl = globalThis.fetch) {
  const base = String(origin).replace(/\/+$/, "");
  const response = await fetchImpl(`${base}${ENVIRONMENT_PATH}`, init);
  if (response.status !== 404) return response;
  return fetchImpl(`${base}${LEGACY_ENVIRONMENT_PATH}`, init);
}

// ── URL scheme ───────────────────────────────────────────────────────────
//
// sagax:// is the only scheme: the desktop, the iOS app and the Android app
// register it, and every link the app makes (chat links, pair invites, the
// sign-in returns) uses it.

export const URL_SCHEME = "sagax";

/** Whether `protocol` (a URL's, with its colon) is this app's scheme. */
export function isAppProtocol(protocol) {
  return typeof protocol === "string" && protocol.replace(/:$/, "").toLowerCase() === URL_SCHEME;
}

/** Whether `url` is `sagax://<host>`. */
export function isAppLink(url, host) {
  if (typeof url !== "string") return false;
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${URL_SCHEME}://${escaped}(?:[/?#]|$)`, "i").test(url);
}

/** A link to this app: `appLink("cloud")` is sagax://cloud. */
export function appLink(host) {
  return `${URL_SCHEME}://${host}`;
}

// ── tokens ───────────────────────────────────────────────────────────────
//
// Tokens this app issues start sgx_; omb_ ones issued before keep working
// until they expire. Pairing credentials stay omb_pair_ when issued, on
// purpose (the released phone apps check that prefix), but sgx_pair_ is
// accepted everywhere. omb_install_ and omb_workspace_ belong to a hosted
// service this project does not run and are not renamed.

export const TOKEN_PREFIX = "sgx_";
export const LEGACY_TOKEN_PREFIX = "omb_";

/** Whether `value` starts with `sgx_<kind>_` or `omb_<kind>_`. */
export function hasTokenPrefix(value, kind) {
  return typeof value === "string" && (value.startsWith(`${TOKEN_PREFIX}${kind}_`) || value.startsWith(`${LEGACY_TOKEN_PREFIX}${kind}_`));
}

// ── health ───────────────────────────────────────────────────────────────
//
// /api/health keeps `app: "openmausbot"` on purpose (docs/code/repository.md, "Legacy
// names kept for compatibility"): deployed health checks grep the body for
// that word and older clients compare it exactly. `product: "sagax"` is the
// new name.

export const HEALTH_APP = "openmausbot";
export const HEALTH_PRODUCT = "sagax";
export const HEALTH_IDENTITY = Object.freeze({ app: HEALTH_APP, product: HEALTH_PRODUCT });

/** Whether a /api/health body is this app's (either name). */
export function isOwnHealth(body) {
  return Boolean(body) && typeof body === "object" && (body.app === HEALTH_APP || body.app === HEALTH_PRODUCT || body.product === HEALTH_PRODUCT);
}
