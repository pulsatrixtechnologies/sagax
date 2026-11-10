// Saved environments for the desktop app, pure and testable.
//
// "This computer" (LOCAL_ID) is the server this app spawns from the default
// data dir; a remote environment is a server the user paired with
// ({id, kind:"remote", name, origin}); a named local environment is another
// data directory the same server can be restarted onto
// ({id, kind:"local", name, dataDir}). The app switches by loading that
// environment, so an entry only names a destination. A remote entry also
// carries `org: true` for an organization server (one that signs people in
// with Pulsatrix, probed by org-join.mjs): the desktop draws ITS OWN bundled
// UI on that origin (electron/bundled-ui.cjs) instead of whatever the server
// image serves, and `microphone: true` once the person allowed it a Live
// call. The session credential for a remote is the HttpOnly cookie the /pair
// page set for that origin, held by Chromium's cookie jar, never by this file.
//
// Server mode (the launch screen's "Server"): `serverModeId` names the
// organization server this app opens on. While it is set, nothing switches
// to a named local environment or another saved server, and no local
// environment is registered; this computer's own space (Personal) is a
// switch away, without signing out of the server (`personal: true` once the
// person opened it: the local server then starts with the app). Only leaving
// server mode (Settings > General > Server > Change, or the Server menu)
// clears it, and that signs out of the server.
const LOCAL_ID = "local";
const MAX_NAME = 60;

/** `https://host[:port]` — a bare origin, no path, no credentials. */
function normalizeOrigin(input) {
  if (typeof input !== "string") return null;
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  return url.origin;
}

/** Turn what the server printed — `https://host/pair#code=XXXX-XXXX-XXXX`,
 * or just an origin — into where to go. The code stays in the hash, so the
 * page consumes it and it never reaches a server log. */
function parsePairingLink(input) {
  const origin = normalizeOrigin(input);
  if (!origin) return null;
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  // A code travels in the hash only: a query string reaches server logs.
  if (url.searchParams.has("code")) return null;
  const code = /(?:^|[#&])code=([^&]+)/.exec(url.hash)?.[1] ?? null;
  const isPairPage = url.pathname === "/pair" || url.pathname === "/pair/";
  if (code && !isPairPage) return null; // a code belongs on /pair; anything else is not a pairing link
  try {
    return { origin, code: code ? decodeURIComponent(code) : null, url: code ? `${origin}/pair#code=${code}` : origin };
  } catch {
    return null;
  }
}

/** The desktop connection form accepts a hostname, HTTPS address or pairing
 * link. Keep codes out of queries/history and refuse unrelated URL paths. */
function parseHostedWorkspaceLink(input) {
  if (typeof input !== "string") return null;
  const text = input.trim();
  if (!text || /[\s\\]/.test(text)) return null;
  try {
    const url = new URL(text.includes("://") ? text : `https://${text}`);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null;
    if (url.username || url.password || url.search || !["/", "/pair", "/pair/"].includes(url.pathname)) return null;
    if (!loopback && !url.hostname.includes(".")) return null;
    const parsed = parsePairingLink(url.href);
    if (!parsed || (url.hash && (!parsed.code || !/^[A-Z0-9-]{12,16}$/i.test(parsed.code)))) return null;
    return parsed;
  } catch {
    return null;
  }
}

const SIGN_IN_CREDENTIAL = /^(?:sgx|omb)_pair_[A-Za-z0-9_-]{43}$/;
const SIGN_IN_ERROR = /^[a-z_]{1,40}$/;

/** "Sign in with Pulsatrix" in the system browser comes back as
 * `sagax://auth?origin=<saved server>#code=<pairing credential>` or
 * `#error=<code>`. Returns {origin, code} or {origin, error} for a SAVED
 * server only, else null. The credential travels in the hash only, never
 * the query. */
function parseAuthReturnLink(input, state) {
  if (typeof input !== "string" || input.length > 2048) return null;
  let url;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "sagax:" || url.host !== "auth" || (url.pathname !== "" && url.pathname !== "/")) return null;
  if (url.username || url.password) return null;
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== "origin") return null;
  const origin = normalizeOrigin(url.searchParams.get("origin"));
  if (!origin || origin !== url.searchParams.get("origin")) return null;
  if (!state?.environments?.some((entry) => entry.origin === origin)) return null;
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  const parts = [...fragment.keys()];
  if (parts.length !== 1) return null;
  if (parts[0] === "code") {
    const code = fragment.get("code");
    return code && SIGN_IN_CREDENTIAL.test(code) ? { origin, code } : null;
  }
  if (parts[0] === "error") {
    const error = fragment.get("error");
    return error && SIGN_IN_ERROR.test(error) ? { origin, error } : null;
  }
  return null;
}

/** Remote renderers learn only their current workspace, not the local list.
 * A named local environment stays "this computer": it is another data dir
 * of the same machine, so it reports local:true with its path; `missing`
 * mirrors the flag the main process stamps on the entry at read time. */
function workspaceSummary(state) {
  const active = activeEnvironment(state);
  if (!active) return { local: true, name: "This computer" };
  if (active.kind === "local") return { local: true, name: active.name, localPath: active.dataDir, missing: active.missing === true };
  return { local: false, name: active.name, origin: active.origin, ...(serverModeEnvironment(state) ? { serverMode: true } : {}) };
}

/** The server server mode is locked to, or null when the app is not in
 * server mode. */
function serverModeEnvironment(state) {
  if (!state?.serverModeId) return null;
  return state.environments.find((e) => e.id === state.serverModeId) ?? null;
}

/** The origin whose pages the desktop draws from its own bundle: the active
 * environment when it is an organization server, else null. */
function bundledOrigin(state) {
  const active = activeEnvironment(state);
  return active?.org === true ? active.origin : null;
}

/** Every saved organization server's origin: each keeps its page open in
 * the main window (page-contexts.mjs), drawn from this app's bundle. */
function bundledOrigins(state) {
  return (state?.environments ?? []).filter((e) => e.org === true && typeof e.origin === "string").map((e) => e.origin);
}

/** Native identity must not depend on a hosted renderer's version/title. */
function workspaceWindowTitle(state, companion) {
  if (companion) return `Sagax — Connected to: ${companion.serverName} (${new URL(companion.endpoint).host})`;
  const active = activeEnvironment(state);
  if (active && active.kind !== "local") return `Sagax — Hosted: ${active.name} (${new URL(active.origin).host})`;
  return "Sagax";
}

/** Renderer navigation stays in the selected workspace. Switching is a main
 * process action; a cloud page must not navigate itself onto the local bridge. */
function workspaceNavigationAllowed(url, state, localOrigin) {
  try {
    return new URL(url).origin === (activeEnvironment(state)?.origin ?? localOrigin);
  } catch {
    return false;
  }
}

/** Only the main window's main frame may request this deliberately small
 * shell surface. Being embedded in a saved server grants no host authority. */
function workspaceSenderAllowed(event, contents, state, localOrigin) {
  if (!contents || event?.sender !== contents || event?.senderFrame !== contents.mainFrame) return false;
  try {
    return workspaceNavigationAllowed(event.senderFrame.url, state, localOrigin);
  } catch {
    return false;
  }
}

/** Native menu choices, never renderer-supplied destinations or callbacks.
 * In server mode the only server is the organization's, beside this
 * computer's own space: no other saved server, no Connect; "Change server…"
 * leaves server mode. */
function workspaceMenuTemplate(state, { onSwitch, onConnect, onForget, onLeaveServerMode }) {
  const active = activeEnvironment(state);
  const locked = serverModeEnvironment(state);
  if (locked) {
    return [
      { id: "workspace-local", label: "This computer", type: "radio", checked: state.activeId !== locked.id, click: () => onSwitch(LOCAL_ID) },
      { id: `workspace-${locked.id}`, label: locked.name, sublabel: new URL(locked.origin).host, type: "radio", checked: state.activeId === locked.id, click: () => onSwitch(locked.id) },
      { type: "separator" },
      { id: "workspace-leave-server-mode", label: "Change server…", click: () => onLeaveServerMode?.() },
    ];
  }
  return [
    { id: "workspace-local", label: "This computer", type: "radio", checked: !active, click: () => onSwitch(LOCAL_ID) },
    ...state.environments.map((entry) => ({
      id: `workspace-${entry.id}`, label: entry.name, sublabel: entry.kind === "local" ? entry.dataDir : new URL(entry.origin).host,
      type: "radio", checked: entry.id === state.activeId, click: () => onSwitch(entry.id),
    })),
    { type: "separator" },
    { id: "workspace-connect", label: "Connect to a server…", click: onConnect },
    ...(active ? [{ id: "workspace-forget", label: `Forget “${active.name}”…`, click: () => onForget(active.id) }] : []),
  ];
}

function cleanName(value, fallback) {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, MAX_NAME) : "";
  return name || fallback;
}

function cleanOptionalName(value) {
  return cleanName(value, "");
}

/** The name the person gave a saved server (`label`) and the organization
 * name the server announced (`orgName`). An empty value clears it. Only a
 * remote entry carries them; the shown name is label, then orgName, then
 * `name` (the host). */
function withServerName(state, id, input) {
  const target = state.environments.find((e) => e.id === id && e.kind !== "local");
  if (!target) return state;
  const next = { ...target };
  for (const key of ["label", "orgName"]) {
    if (typeof input?.[key] !== "string") continue;
    const value = cleanOptionalName(input[key]);
    if (value) next[key] = value; else delete next[key];
  }
  return { ...state, environments: state.environments.map((e) => (e === target ? next : e)) };
}

function nameFromOrigin(origin) {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/** An environment directory is absolute or it is nothing: relative paths
 * would silently follow the app's cwd, and `~` is a shell illusion here.
 * Three absolute shapes are recognized by pattern alone — POSIX `/…`,
 * a Windows drive `X:\` or `X:/`, and a UNC `\\server\share` — because a
 * path module would resolve relative to this app's cwd and platform. */
function cleanDataDir(value) {
  if (typeof value !== "string") return null;
  const dir = value.trim();
  return /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(dir) ? dir : null;
}

function dirBasename(dir) {
  const parts = pathKey(dir).replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || dir;
}

/** Comparison key for directory paths. Windows-shaped paths (drive-letter or
 * UNC) compare slash-normalized and case-insensitively — Windows itself is
 * case-insensitive, and the same folder can reach us with either separator.
 * POSIX paths compare as written. */
function pathKey(dir) {
  let d = String(dir).replace(/\\/g, "/");
  if (/^[A-Za-z]:\//.test(d) || d.startsWith("//")) d = d.toLowerCase();
  return d;
}

/** Comparisons run on trailing-`/` paths so `/a/b` never matches `/a/bc`. */
function asDirPrefix(dir) {
  const d = pathKey(dir);
  return d.endsWith("/") ? d : `${d}/`;
}

function cleanId(entry) {
  return typeof entry?.id === "string" && /^[\w-]{1,64}$/.test(entry.id) && entry.id !== LOCAL_ID ? entry.id : null;
}

/** Parse the persisted file (version 1 or 2). Unknown or damaged content
 * yields the empty state rather than an error: losing a saved list costs a
 * re-pair, not the app. Version 1 entries are all remote; a missing version
 * predates the field and reads as version 1. */
function parseEnvironments(raw) {
  let value;
  try {
    value = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return { environments: [], activeId: LOCAL_ID };
  }
  const version = value?.version ?? 1;
  if (version !== 1 && version !== 2) return { environments: [], activeId: LOCAL_ID };
  const list = Array.isArray(value?.environments) ? value.environments : [];
  const seen = new Set();
  const environments = [];
  for (const entry of list) {
    const id = cleanId(entry);
    if (!id || seen.has(id)) continue;
    const dataDir = cleanDataDir(entry?.dataDir);
    if (entry?.kind === "local") {
      // Dedup on the same normalized key withLocalEnvironment uses, so a
      // manual or older write of the same folder (trailing slash, separator
      // style, drive case) never registers two owners of one directory.
      const dirKey = dataDir ? `dir:${asDirPrefix(dataDir)}` : null;
      if (!dataDir || seen.has(dirKey)) continue;
      seen.add(id);
      seen.add(dirKey);
      environments.push({ id, kind: "local", name: cleanName(entry.name, dirBasename(dataDir)), dataDir });
      continue;
    }
    const origin = normalizeOrigin(entry?.origin);
    if (!origin || (entry?.kind !== undefined && entry.kind !== "remote") || seen.has(origin)) continue;
    seen.add(id);
    seen.add(origin);
    // `microphone: true` only once the person allowed this server a Live call.
    environments.push({
      id,
      kind: "remote",
      name: cleanName(entry?.name, nameFromOrigin(origin)),
      origin,
      ...(entry?.org === true ? { org: true } : {}),
      ...(entry?.microphone === true ? { microphone: true } : {}),
      ...(cleanOptionalName(entry?.label) ? { label: cleanOptionalName(entry.label) } : {}),
      ...(cleanOptionalName(entry?.orgName) ? { orgName: cleanOptionalName(entry.orgName) } : {}),
    });
  }
  // Server mode survives a restart only on an organization server it saved.
  // The app opens where the person left it: the server, or Personal once
  // they opened it (`personal`).
  const serverModeId = typeof value?.serverModeId === "string" && environments.some((e) => e.id === value.serverModeId && e.org === true)
    ? value.serverModeId : null;
  if (serverModeId) {
    const personal = value?.personal === true;
    return { environments, activeId: personal && value?.activeId === LOCAL_ID ? LOCAL_ID : serverModeId, serverModeId, ...(personal ? { personal: true } : {}) };
  }
  const activeId = typeof value?.activeId === "string" && environments.some((e) => e.id === value.activeId) ? value.activeId : LOCAL_ID;
  return { environments, activeId };
}

function serializeEnvironments(state) {
  return JSON.stringify({
    version: 2, environments: state.environments, activeId: state.activeId,
    ...(state.serverModeId ? { serverModeId: state.serverModeId } : {}),
    ...(state.serverModeId && state.personal === true ? { personal: true } : {}),
  }, null, 2) + "\n";
}

/** Add or update by origin (re-pairing the same server keeps one entry).
 * `org: true` marks an organization server and is never taken back. */
function withEnvironment(state, input, makeId) {
  const origin = normalizeOrigin(input?.origin);
  if (!origin) return state;
  const org = input?.org === true ? { org: true } : {};
  const existing = state.environments.find((e) => e.origin === origin);
  if (existing) {
    const name = cleanName(input?.name, existing.name);
    const environments = state.environments.map((e) => (e === existing ? { ...e, kind: "remote", name, ...org } : e));
    return { ...state, environments };
  }
  const id = makeId();
  const environments = [...state.environments, { id, kind: "remote", name: cleanName(input?.name, nameFromOrigin(origin)), origin, ...org }];
  return { ...state, environments };
}

/** Register a named local environment — another data directory this app can
 * restart onto. It may not be the default dir (that is "This computer",
 * addressable without an entry) and may not contain or sit inside a
 * registered environment's dir or the default: one environment inside
 * another would put one setup's state files under another's management. */
function withLocalEnvironment(state, input, makeId, defaultDir) {
  // Server mode locks the app to its organization server: no local
  // environment is registered while it is set (docs/code/apps.md "Launch flow").
  if (state?.serverModeId) return { ok: false, error: "server_mode" };
  const name = typeof input?.name === "string" ? input.name.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > MAX_NAME) return { ok: false, error: "name" };
  const dataDir = cleanDataDir(input?.dataDir);
  if (!dataDir) return { ok: false, error: "path" };
  const candidate = asDirPrefix(dataDir);
  const locals = state.environments.filter((e) => e.kind === "local");
  if (locals.some((e) => asDirPrefix(e.dataDir) === candidate)) return { ok: false, error: "duplicate" };
  // Two-way containment for registered local dirs: the candidate inside one,
  // or the candidate swallowing one. The candidate inside the default dir is
  // refused as before.
  const insideKnown = (dir) => candidate.startsWith(asDirPrefix(dir));
  const containsKnown = (dir) => asDirPrefix(dir).startsWith(candidate);
  if (locals.some((e) => insideKnown(e.dataDir) || containsKnown(e.dataDir))) return { ok: false, error: "nested" };
  if (typeof defaultDir === "string" && defaultDir && insideKnown(defaultDir)) return { ok: false, error: "nested" };
  const environments = [...state.environments, { id: makeId(), kind: "local", name, dataDir }];
  return { ok: true, state: { ...state, environments } };
}

/** The data dir the server child must run on, when a named local environment
 * is active; null means the caller's own default dir. `_defaultDir` stays in
 * the signature for its callers' symmetry — "This computer" has no entry. */
function activeLocalDataDir(state, _defaultDir) {
  const active = activeEnvironment(state);
  return active?.kind === "local" && typeof active.dataDir === "string" ? active.dataDir : null;
}

/** The directory a launch (or a recovery restart) owns: the active named
 * local environment's dir, else the caller's default. */
function startupEnvironmentDir(state, defaultDir) {
  return activeLocalDataDir(state, defaultDir) ?? defaultDir;
}

/** The boot decision for a packaged launch. A named local environment whose
 * directory is missing (the `missing` stamp readEnvironments takes right
 * before boot) must NOT be leased or created: mkdir would silently raise an
 * empty setup where the person's data used to be. Boot on the default dir
 * and flag the fallback so the caller can say so. The default dir itself is
 * never refused — a first boot is allowed to create it. */
function bootEnvironmentDir(state, defaultDir) {
  const active = activeEnvironment(state);
  if (active?.kind === "local" && typeof active.dataDir === "string" && active.missing === true) {
    return { dataDir: defaultDir, fellBack: true, missingDir: active.dataDir };
  }
  return { dataDir: startupEnvironmentDir(state, defaultDir), fellBack: false, missingDir: null };
}

function withoutEnvironment(state, id) {
  const environments = state.environments.filter((e) => e.id !== id);
  const next = { environments, activeId: state.activeId === id ? LOCAL_ID : state.activeId };
  return state.serverModeId && state.serverModeId !== id
    ? { ...next, serverModeId: state.serverModeId, ...(state.personal === true ? { personal: true } : {}) }
    : next;
}

/** The person allowed this saved server the microphone (asked on its first
 * Live call); forgetting the server drops the record and the answer with it. */
function withMicrophone(state, id) {
  if (!state.environments.some((e) => e.id === id)) return state;
  return { ...state, environments: state.environments.map((e) => (e.id === id ? { ...e, microphone: true } : e)) };
}

/** In server mode only the server and Personal can be active; opening
 * Personal there is remembered (`personal`), so the app starts this
 * computer's own server too from then on. */
function withActive(state, id) {
  if (id !== LOCAL_ID && !state.environments.some((e) => e.id === id)) return state;
  if (state.serverModeId && id !== state.serverModeId && id !== LOCAL_ID) return state;
  if (state.serverModeId && id === LOCAL_ID) return { ...state, activeId: id, personal: true };
  return { ...state, activeId: id };
}

/** Enter server mode on a saved organization server: it becomes the only
 * active one. Anything else is refused (state unchanged). */
function withServerMode(state, id) {
  const entry = state.environments.find((e) => e.id === id);
  if (!entry || entry.org !== true) return state;
  return { ...state, activeId: id, serverModeId: id };
}

/** A save from before organization servers were marked (`org: true`) and
 * server mode existed: mark the saved servers whose descriptor says they
 * sign people in with Pulsatrix, and when this computer chose Server at
 * launch, lock the app to the active one if it is such a server. Anything
 * else is left as it was (same object when nothing changes). */
function withOrganizationUpgrade(state, { orgOrigins, serverModeChosen }) {
  let changed = false;
  const environments = state.environments.map((entry) => {
    if (entry.org === true || !orgOrigins?.has(entry.origin)) return entry;
    changed = true;
    return { ...entry, org: true };
  });
  let next = changed ? { ...state, environments } : state;
  const active = activeEnvironment(next);
  if (serverModeChosen === true && !next.serverModeId && active?.org === true) next = withServerMode(next, active.id);
  return next;
}

/** Leave server mode: the server is forgotten and Local is active again. */
function withoutServerMode(state) {
  const locked = serverModeEnvironment(state);
  const { serverModeId: _left, personal: _personal, ...rest } = state;
  return locked ? withoutEnvironment(rest, locked.id) : { ...rest, activeId: LOCAL_ID };
}

function activeEnvironment(state) {
  return state.environments.find((e) => e.id === state.activeId) ?? null;
}

/** The active entry when a REMOTE server is shown — null for "This computer"
 * and for a named local environment, which both serve this computer's own
 * renderer. Sites that branch on "a remote server is on screen" must use
 * this, not `activeEnvironment`. */
function activeRemote(state) {
  const active = activeEnvironment(state);
  return active && active.kind !== "local" ? active : null;
}

/** Origins the main window may navigate to: Local plus every saved server. */
function allowedOrigins(state, localOrigin) {
  return new Set([localOrigin, ...state.environments.map((e) => e.origin).filter(Boolean)]);
}

module.exports = {
  LOCAL_ID,
  activeEnvironment,
  activeLocalDataDir,
  activeRemote,
  allowedOrigins,
  bootEnvironmentDir,
  bundledOrigin,
  bundledOrigins,
  serverModeEnvironment,
  withOrganizationUpgrade,
  withServerMode,
  withoutServerMode,
  normalizeOrigin,
  parseEnvironments,
  parseAuthReturnLink,
  parsePairingLink,
  parseHostedWorkspaceLink,
  serializeEnvironments,
  startupEnvironmentDir,
  withActive,
  withEnvironment,
  withLocalEnvironment,
  withMicrophone,
  withServerName,
  withoutEnvironment,
  workspaceMenuTemplate,
  workspaceNavigationAllowed,
  workspaceSenderAllowed,
  workspaceSummary,
  workspaceWindowTitle,
};
