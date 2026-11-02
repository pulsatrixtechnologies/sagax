// Settings > Memory: the local cache of the organization memory, for
// Obsidian (Perspicax lot A.4; Perspicax docs/memory.md, "Obsidian and git
// sync").
//
// Perspicax serves every memory tier a person reads as a git repository
// (`<origin>/memory/git/me`, `org`, `team-<id>`). This module keeps one clone
// per tier in a vault folder on this computer and syncs it:
//
//   - the vault lives under Application Support (userData/org-memory/vault),
//     never in iCloud Drive, OneDrive or another cloud-synchronized folder
//     (refused), and macOS Time Machine skips it (the sticky
//     com.apple.metadata:com_apple_backup_excludeItem attribute);
//   - a sync commits local changes, rebases on the server, pushes, then
//     reads the person's review items (`pending` state): the person's own
//     tier is written directly, a shared tier gets inbox items the server
//     shows under `_pending/` in the clone;
//   - generated files (MEMORY.md, .gitignore, _pending/, directory/) are
//     restored before a commit, so an edit there never blocks a push;
//   - the token (a Perspicax memory sync token) is kept encrypted by the
//     operating system (safeStorage), passed to git only as an
//     `Authorization` header through environment variables of the child
//     process: never on a command line, never in .git/config, never logged;
//   - erase() removes the vault, the token and the state: on sign-out (the
//     organization is disconnected), when Perspicax refuses the token (access
//     ended), or from the button;
//   - a recommended `.obsidian` folder turns off the Sync and Publish core
//     plugins and lists no community plugin;
//   - since 2026-10-14 it sets itself up (auto()): on an organization
//     server signed in with Perspicax, the main process asks that server for
//     the person's own memory sync token (POST /api/me/memory-sync-token,
//     the person's session cookie; server/memory/perspicax-memory-sync-token.ts),
//     keeps it as above, mints a new one when fewer than RENEW_BEFORE_MS
//     remain or Perspicax refuses it, and erases the copy (revoking the
//     token) when the person is no longer of the organization. No token is
//     ever typed, shown or answered to the page.
//
// Everything that touches the system (files, git, HTTP, encryption) is
// injected so the tests drive it with a real git and a temporary folder.
import nodeFs from "node:fs";
import path from "node:path";

export const CACHE_FOLDER = "org-memory";
export const VAULT_FOLDER = "vault";
export const STATE_FILE = "state.json";
export const TOKEN_FILE = "token.bin";
export const TIER_NAME = /^(me|org|team-[A-Za-z0-9_-]{1,64})$/;
/** A memory sync token is renewed when fewer than this many ms remain. */
export const RENEW_BEFORE_MS = 7 * 86400_000;
const SYNC_TOKEN = /^pxat1\.[A-Za-z0-9_-]{16,200}$/;
const REVOKE_TIMEOUT_MS = 5_000;
/** A Perspicax answer that never comes fails the sync instead of hanging it. */
const JSON_TIMEOUT_MS = 30_000;
const GENERATED = [/^MEMORY\.md$/, /^\.gitignore$/, /^_pending\//, /^directory\//];

/** Why a folder may not hold the cache, or null. */
export function cloudFolderReason(folder) {
  const parts = String(folder).split(/[\\/]+/);
  for (const name of parts) {
    if (name === "Mobile Documents" || name === "iCloud Drive" || name.startsWith("iCloud~")) return "iCloud Drive";
    if (name.startsWith("OneDrive")) return "OneDrive";
    if (name === "CloudStorage") return "a cloud storage folder";
    if (name === "Dropbox" || name === "Google Drive" || name === "Box") return "a cloud folder";
  }
  return null;
}

export function cacheRoot(userData) {
  return path.join(userData, CACHE_FOLDER);
}

export function vaultPath(userData) {
  return path.join(cacheRoot(userData), VAULT_FOLDER);
}

/** The obsidian:// link that opens (or adds) the vault. */
export function obsidianUrl(vault) {
  return `obsidian://open?path=${encodeURIComponent(vault)}`;
}

/** An https origin, or an http one on this computer (a test server). */
export function normalizeServer(value) {
  let url;
  try {
    url = new URL(String(value ?? "").trim());
  } catch {
    throw new Error("Enter the Perspicax address, like https://pulsatrix.example.com");
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("The Perspicax address must start with https://");
  }
  if (url.username || url.password) throw new Error("The address must not hold a user name or a password");
  return url.origin;
}

/** A generated path of a clone: restored, never pushed. */
export function isGenerated(file) {
  return GENERATED.some((re) => re.test(file));
}

/** The recommended .obsidian folder; false when the vault already has one. */
export function writeObsidianConfig(vault, fs = nodeFs) {
  const dir = path.join(vault, ".obsidian");
  if (fs.existsSync(dir)) return false;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "app.json"), `${JSON.stringify({
    attachmentFolderPath: "_local-attachments",
    newFileLocation: "current",
    promptDelete: true,
    alwaysUpdateLinks: false,
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, "core-plugins.json"), `${JSON.stringify({
    "file-explorer": true,
    "global-search": true,
    switcher: true,
    graph: true,
    backlink: true,
    "outgoing-link": true,
    "tag-pane": true,
    properties: true,
    "page-preview": true,
    outline: true,
    sync: false,
    publish: false,
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, "community-plugins.json"), "[]\n");
  return true;
}

/** Keep a folder out of Time Machine (macOS): the attribute tmutil sets. */
export async function excludeFromBackup(dir, { platform = process.platform, run }) {
  if (platform !== "darwin") return false;
  const out = await run("xattr", ["-w", "com.apple.metadata:com_apple_backup_excludeItem", "com.apple.backupd", dir], {});
  return out.code === 0;
}

/**
 * What POST /api/me/memory-sync-token answered, as an outcome: the token and
 * the Perspicax address, or a code the page shows (never the answer itself).
 * `ended`: the person's access to the organization is over (erase the copy).
 */
export function mintOutcome(status, body) {
  const record = body && typeof body === "object" ? body : {};
  if (status === 200) {
    if (typeof record.token !== "string" || !SYNC_TOKEN.test(record.token) || typeof record.server !== "string") return { ok: false, code: "unreachable" };
    const expiresAt = typeof record.expiresAt === "string" ? Date.parse(record.expiresAt) : NaN;
    return { ok: true, token: record.token, server: record.server, expiresAt: Number.isFinite(expiresAt) ? expiresAt : null };
  }
  if (status === 401) return { ok: false, code: "signed_out", ended: true };
  if (status === 403 && record.code === "not_member") return { ok: false, code: "not_member", ended: true };
  if (status === 403 || status === 503) return { ok: false, code: "no_org" };
  if (status === 404) return { ok: false, code: "unsupported" };
  return { ok: false, code: "unreachable" };
}

function remoteLines(text) {
  return String(text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("remote:") || line.startsWith("! ["))
    .map((line) => line.replace(/^remote:\s*/, ""))
    .filter((line) => line && !/bearer|authorization/i.test(line));
}

const emptyState = () => ({ server: null, mode: null, source: null, person: null, tokenExpiresAt: null, tiers: [], pending: [], pendingCount: 0, lastSyncAt: null, lastError: null, autoError: null });

/**
 * The cache of one desktop.
 *
 * @param {object} deps
 * @param {string} deps.userData   Electron's userData folder
 * @param {(cmd: string, args: string[], opts: { cwd?: string, env?: Record<string, string> }) => Promise<{ code: number, stdout: string, stderr: string }>} deps.run
 * @param {typeof fetch} deps.fetch
 * @param {(text: string) => Buffer} deps.encrypt  safeStorage.encryptString
 * @param {(data: Buffer) => string} deps.decrypt  safeStorage.decryptString
 * @param {(method: "GET" | "POST") => Promise<{ status: number, body: unknown }>} [deps.orgServer]  /api/me/memory-sync-token on the organization server, as the person signed in there (GET: who, POST: their token)
 * @param {() => string | null} [deps.source]  that organization server's origin
 */
export function createOrgMemoryCache({ userData, run, fetch, encrypt, decrypt, orgServer = null, source = () => null, fs = nodeFs, platform = process.platform, now = () => Date.now() }) {
  const root = cacheRoot(userData);
  const vault = vaultPath(userData);
  const stateFile = path.join(root, STATE_FILE);
  const tokenFile = path.join(root, TOKEN_FILE);
  let busy = null;

  const readState = () => {
    try {
      return { ...emptyState(), ...JSON.parse(fs.readFileSync(stateFile, "utf8")) };
    } catch {
      return emptyState();
    }
  };
  const writeState = (state) => {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  };
  const readToken = () => {
    try {
      return decrypt(fs.readFileSync(tokenFile));
    } catch {
      return null;
    }
  };

  const gitEnv = (token) => ({
    GIT_TERMINAL_PROMPT: "0",
    // A stalled transfer ends (under 1 KB/s for a minute) instead of keeping
    // the sync busy for good (Settings > Memory stuck on "Syncing...").
    GIT_HTTP_LOW_SPEED_LIMIT: "1000",
    GIT_HTTP_LOW_SPEED_TIME: "60",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}`,
    GIT_CONFIG_KEY_1: "credential.helper",
    GIT_CONFIG_VALUE_1: "",
    GIT_AUTHOR_NAME: "Sagax memory sync",
    GIT_AUTHOR_EMAIL: "sync@perspicax.invalid",
    GIT_COMMITTER_NAME: "Sagax memory sync",
    GIT_COMMITTER_EMAIL: "sync@perspicax.invalid",
  });

  async function getJson(server, token, route) {
    const response = await fetch(`${server}${route}`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" }, signal: AbortSignal.timeout(JSON_TIMEOUT_MS) });
    if (response.status === 401) {
      const error = new Error("Perspicax refused the memory sync token (expired, revoked, or your access ended)");
      error.accessEnded = true;
      throw error;
    }
    if (!response.ok) throw new Error(`Perspicax answered ${response.status} on ${route}`);
    return response.json();
  }

  async function syncTier(token, tier) {
    const dir = path.join(vault, tier.name);
    const env = gitEnv(token);
    const git = (args, cwd = dir) => run("git", args, { cwd, env });
    if (!fs.existsSync(path.join(dir, ".git"))) {
      const cloned = await git(["clone", "-q", tier.url, dir], vault);
      return cloned.code === 0
        ? { status: "cloned", messages: [] }
        : { status: "error", messages: ["clone failed", ...remoteLines(cloned.stderr)] };
    }
    const messages = [];
    const status = await git(["status", "--porcelain", "-z"]);
    for (const record of status.stdout.split("\0").filter((r) => r.length > 3)) {
      const file = record.slice(3);
      if (!isGenerated(file)) continue;
      const tracked = (await git(["ls-files", "--error-unmatch", file])).code === 0;
      if (tracked) await git(["checkout", "HEAD", "--", file]);
      else fs.rmSync(path.join(dir, file), { force: true, recursive: true });
      messages.push(`${file} is written by the server: restored`);
    }
    if ((await git(["status", "--porcelain"])).stdout.trim()) {
      await git(["add", "-A"]);
      await git(["commit", "-q", "-m", `Sagax memory sync ${new Date(now()).toISOString()}`]);
    }
    const fetched = await git(["fetch", "-q", "origin"]);
    if (fetched.code !== 0) return { status: "error", messages: [...messages, "fetch failed", ...remoteLines(fetched.stderr)] };
    if ((await git(["merge-base", "HEAD", "origin/main"])).code !== 0) {
      // The server rebuilt its mirror: keep the old clone aside, clone again.
      const aside = `${dir}.unrelated-${now()}`;
      fs.renameSync(dir, aside);
      const again = await syncTier(token, tier);
      return { ...again, messages: [...messages, `the server history changed: the old copy is kept in ${path.basename(aside)}`, ...again.messages] };
    }
    if ((await git(["rebase", "-q", "origin/main"])).code !== 0) {
      await git(["rebase", "--abort"]);
      return { status: "conflict", messages: [...messages, "a conflict with the server: nothing was pushed"] };
    }
    const ahead = Number((await git(["rev-list", "--count", "origin/main..HEAD"])).stdout.trim()) || 0;
    if (ahead === 0) return { status: "up-to-date", messages };
    const pushed = await git(["push", "origin", "HEAD:refs/heads/main"]);
    if (pushed.code !== 0) return { status: "refused", messages: [...messages, ...remoteLines(pushed.stderr)] };
    await git(["fetch", "-q", "origin"]);
    await git(["merge", "-q", "--ff-only", "origin/main"]);
    return { status: "pushed", messages: [...messages, ...remoteLines(pushed.stderr)] };
  }

  async function eraseNow(reason = null, autoError = null) {
    fs.rmSync(root, { recursive: true, force: true });
    if (reason || autoError) writeState({ ...emptyState(), lastError: reason, autoError });
  }

  /** Best effort: revoke the kept token at Perspicax (it may revoke itself). */
  async function revokeKept() {
    const state = readState();
    const token = readToken();
    if (!state.server || !token) return;
    try {
      const response = await fetch(`${state.server}/api/v1/memory/sync/token`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
        signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
      });
      await response.body?.cancel?.().catch?.(() => {});
    } catch {
      /* it expires on its own */
    }
  }

  /** A failed automatic setup: an access that ended erases the copy;
   * anything else keeps it and says why. */
  async function autoFailed(outcome) {
    if (outcome.ended) {
      await revokeKept();
      await eraseNow(null, outcome.code);
    } else {
      writeState({ ...readState(), autoError: outcome.code });
    }
    return api.state();
  }

  /** Ask the organization server for the person's token, check it against
   * Perspicax and keep it. A copy from another Perspicax is erased first. */
  async function renew(person = readState().person) {
    if (!orgServer) return { ok: false, code: "no_org" };
    let outcome;
    try {
      const answer = await orgServer("POST");
      outcome = mintOutcome(answer?.status, answer?.body);
    } catch {
      outcome = { ok: false, code: "unreachable" };
    }
    if (!outcome.ok) return outcome;
    let origin;
    try {
      origin = normalizeServer(outcome.server);
    } catch {
      return { ok: false, code: "unreachable" };
    }
    if (cloudFolderReason(vault)) return { ok: false, code: "cloud_folder" };
    let tiers;
    try {
      tiers = await getJson(origin, outcome.token, "/api/v1/memory/sync/tiers");
    } catch {
      return { ok: false, code: "unreachable" };
    }
    if (tiers.enabled === false) return { ok: false, code: "memory_off" };
    const previous = readState();
    if (previous.server && previous.server !== origin) {
      await revokeKept();
      await eraseNow();
    }
    const kept = previous.server === origin ? readState() : emptyState();
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    fs.writeFileSync(tokenFile, encrypt(outcome.token), { mode: 0o600 });
    writeState({ ...kept, server: origin, mode: "auto", source: source(), person, tokenExpiresAt: outcome.expiresAt, lastError: null, autoError: null });
    return { ok: true };
  }

  /** Who is signed in to the organization server: `{ person }`, or a
   * failed outcome. */
  async function whoIsSignedIn() {
    let answer;
    try {
      answer = await orgServer("GET");
    } catch {
      return { ok: false, code: "unreachable" };
    }
    const person = answer?.body && typeof answer.body === "object" ? answer.body.person : undefined;
    if (answer?.status === 200 && typeof person === "string" && person) return { ok: true, person };
    if (answer?.status === 200) return { ok: false, code: "unreachable" };
    return mintOutcome(answer?.status, answer?.body);
  }

  /** Set up (or renew) from the organization server, then sync. */
  async function autoNow() {
    let state = readState();
    const from = source();
    if (!from || !orgServer) {
      // Not on an organization server: nothing to set up; a copy stays as it is.
      return state.server ? syncNow() : autoFailed({ ok: false, code: "no_org" });
    }
    const mine = state.mode === "auto" && state.source === from;
    const who = await whoIsSignedIn();
    if (!who.ok) {
      // Signed out of this server or out of its organization: its copy goes.
      if (who.ended) return mine ? autoFailed(who) : autoFailed({ ...who, ended: false });
      // Offline or an older server: a copy already here keeps syncing.
      if (state.server && readToken() !== null && (who.code === "unreachable" || who.code === "unsupported")) return syncNow();
      return autoFailed(who);
    }
    if (state.mode === "auto" && (state.source !== from || state.person !== who.person)) {
      // Another organization server or another person: the copy leaves first.
      await revokeKept();
      await eraseNow();
      state = readState();
    }
    const usable = state.mode === "auto" && state.server && readToken() !== null &&
      !(state.tokenExpiresAt && state.tokenExpiresAt - now() < RENEW_BEFORE_MS);
    if (!usable) {
      const renewed = await renew(who.person);
      if (!renewed.ok) {
        // An older Perspicax: a connection made by hand keeps working.
        if (renewed.code === "unsupported" && state.server && readToken() !== null) return syncNow();
        return autoFailed(renewed);
      }
    }
    return syncNow();
  }

  async function syncNow(again = false) {
    const state = readState();
    const token = readToken();
    if (!state.server || !token) throw new Error("Connect to Perspicax first");
    const reason = cloudFolderReason(vault);
    if (reason) throw new Error(`The memory folder is in ${reason}; it must stay out of cloud folders`);
    let tiers;
    try {
      tiers = await getJson(state.server, token, "/api/v1/memory/sync/tiers");
    } catch (error) {
      if (error.accessEnded && state.mode === "auto" && !again && source() === state.source) {
        // Rotated elsewhere (another computer of the person) or expired:
        // ask for a new one before deciding the access ended.
        const renewed = await renew();
        if (renewed.ok) return syncNow(true);
        if (renewed.ended) return autoFailed(renewed);
        return autoFailed(renewed.code === "unreachable" || renewed.code === "no_org" ? renewed : { ...renewed, ended: true });
      }
      if (error.accessEnded) {
        await eraseNow(error.message);
        return api.state();
      }
      if (state.mode === "auto") return autoFailed({ ok: false, code: "unreachable" });
      throw error;
    }
    const fresh = !fs.existsSync(vault);
    fs.mkdirSync(vault, { recursive: true, mode: 0o700 });
    if (fresh) await excludeFromBackup(cacheRoot(userData), { platform, run }).catch(() => false);
    const results = [];
    for (const tier of (tiers.tiers ?? []).filter((t) => TIER_NAME.test(t.name))) {
      const outcome = await syncTier(token, tier);
      results.push({ name: tier.name, label: tier.label, push: tier.push, status: outcome.status, messages: outcome.messages });
    }
    // A tier no longer readable leaves this computer.
    const names = new Set(results.map((r) => r.name));
    for (const entry of fs.readdirSync(vault, { withFileTypes: true })) {
      if (entry.isDirectory() && TIER_NAME.test(entry.name) && !names.has(entry.name)) {
        fs.rmSync(path.join(vault, entry.name), { recursive: true, force: true });
      }
    }
    let pending = { pending: 0, items: [] };
    try {
      pending = await getJson(state.server, token, "/api/v1/memory/sync/pending");
    } catch (error) {
      if (error.accessEnded) {
        await eraseNow(error.message);
        return api.state();
      }
    }
    writeState({
      ...state,
      tiers: results,
      pending: (pending.items ?? []).slice(0, 200),
      pendingCount: Number(pending.pending) || 0,
      lastSyncAt: now(),
      lastError: null,
      autoError: null,
    });
    return api.state();
  }

  /** The state a finished run answers: read while it was still running, it
   * said busy, and the page then showed "Syncing..." until the next run. */
  const settled = (state) => ({ ...state, busy: busy !== null });

  const api = {
    root,
    vault,
    /** What Settings > Memory shows; never the token. */
    state() {
      const state = readState();
      return {
        ...state,
        connected: Boolean(state.server && fs.existsSync(tokenFile)),
        vault,
        cloned: fs.existsSync(vault),
        obsidianConfigured: fs.existsSync(path.join(vault, ".obsidian")),
        obsidianUrl: obsidianUrl(vault),
        cloudFolder: cloudFolderReason(vault),
        busy: busy !== null,
      };
    },
    /** Check the address and the token against Perspicax, then keep both. */
    async connect({ server, token }) {
      const origin = normalizeServer(server);
      const value = String(token ?? "").trim();
      if (!/^pxat1\.[A-Za-z0-9_-]{16,200}$/.test(value)) throw new Error("Paste the memory sync token from the Perspicax console (it starts with pxat1.)");
      const reason = cloudFolderReason(vault);
      if (reason) throw new Error(`The memory folder is in ${reason}; it must stay out of cloud folders`);
      const tiers = await getJson(origin, value, "/api/v1/memory/sync/tiers");
      if (tiers.enabled === false) throw new Error("The memory is off on this Perspicax");
      fs.mkdirSync(root, { recursive: true, mode: 0o700 });
      fs.writeFileSync(tokenFile, encrypt(value), { mode: 0o600 });
      writeState({ ...emptyState(), server: origin });
      return api.state();
    },
    /** Set the sync up from the organization server the person is signed
     * in to (or renew its token), then sync. Joins a running sync. */
    async auto() {
      busy ??= autoNow().finally(() => {
        busy = null;
      });
      return settled(await busy);
    },
    /** The person left this organization server (sign-out, forgotten
     * server): an automatic copy from it is revoked and erased. */
    async forgetSource(origin) {
      if (busy) await busy.catch(() => {});
      const state = readState();
      if (state.mode !== "auto" || !state.source || state.source !== origin) return api.state();
      await revokeKept();
      await eraseNow();
      return api.state();
    },
    /** One sync at a time; a second call joins the running one. */
    async sync() {
      busy ??= syncNow().finally(() => {
        busy = null;
      });
      return settled(await busy);
    },
    /** Remove the vault, the token (revoked at Perspicax) and the state. */
    async erase() {
      if (busy) await busy.catch(() => {});
      await revokeKept();
      await eraseNow();
      return api.state();
    },
    /** The recommended .obsidian folder; false when there is one. */
    writeObsidianConfig() {
      fs.mkdirSync(vault, { recursive: true, mode: 0o700 });
      return writeObsidianConfig(vault, fs);
    },
  };
  return api;
}
