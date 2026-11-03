// Who owns this computer, as their organization knows them (desktop side).
//
// The personal server on this computer has no Perspicax link. When this app
// is signed in to an organization server (a saved server marked `org`), main
// reads, with the app's own organization cookie (Electron's cookie store, the
// one every call to that server already uses; nothing new is stored):
//
//   GET <org>/api/auth/session                       who is signed in there
//   GET <org><avatarUrl>   (/api/people/<id>/avatar?v=<version>)
//
// and hands the person's name, address, avatar version and bytes to the
// local server over the private utility-parent port
// (`openmausbot:owner-identity`, server/people/owner-identity.ts). The cookie and
// Perspicax never reach the local server or the phone. Signed out (401, or no
// organization server saved) sends `identity: null`; an unreachable server
// changes nothing, so the last identity stays. Refreshed when the local
// server starts, after a sign-in, when the saved servers change, and on a
// timer, so a new photo in Perspicax (a new version) arrives on its own.
export const OWNER_IDENTITY_MESSAGE = "openmausbot:owner-identity";
export const OWNER_IDENTITY_REFRESH_MS = 15 * 60_000;
const AVATAR_MAX_BYTES = 256 * 1024;
const AVATAR_PATH = /^\/api\/people\/([\w-]{1,80})\/avatar\?v=([0-9A-Za-z_-]{1,64})$/;

const imageType = (bytes) => {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
};

/** The organization servers to ask, the one in use first. */
export function organizationOrigins(state) {
  const list = Array.isArray(state?.environments) ? state.environments.filter((entry) => entry?.org === true && typeof entry.origin === "string") : [];
  const active = list.find((entry) => entry.id === state?.serverModeId || entry.id === state?.activeId);
  return [...new Set([...(active ? [active.origin] : []), ...list.map((entry) => entry.origin)])];
}

/**
 * Read the identity from one organization server.
 * Resolves `{ identity }` (null when signed out there) or `{ unreachable: true }`.
 * `previous` lets an unchanged avatar version skip the image download.
 */
export async function readOwnerIdentity(origin, { fetch, previous = null, timeoutMs = 8_000 }) {
  let response;
  try {
    response = await fetch(`${origin}/api/auth/session`, { credentials: "include", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return { unreachable: true };
  }
  if (response.status === 401 || response.status === 403) return { identity: null };
  if (!response.ok) return { unreachable: true };
  let session;
  try { session = await response.json(); } catch { return { unreachable: true }; }
  if (session?.kind !== "session" || session?.identity !== "perspicax" || typeof session.principalId !== "string" || !/^[\w-]{1,80}$/.test(session.principalId)) {
    return { identity: null };
  }
  const identity = {
    origin,
    principalId: session.principalId,
    ...(typeof session.name === "string" && session.name.trim() ? { name: session.name.trim().slice(0, 200) } : {}),
    ...(typeof session.email === "string" && session.email.includes("@") ? { email: session.email.trim().slice(0, 320) } : {}),
  };
  const match = typeof session.avatarUrl === "string" ? AVATAR_PATH.exec(session.avatarUrl) : null;
  if (!match) return { identity };
  const version = match[2];
  if (previous?.origin === origin && previous.avatar?.version === version) return { identity: { ...identity, avatar: previous.avatar } };
  try {
    const image = await fetch(`${origin}${session.avatarUrl}`, { credentials: "include", redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
    if (!image.ok) return { identity: previous?.origin === origin && previous.avatar ? { ...identity, avatar: previous.avatar } : identity };
    const bytes = Buffer.from(await image.arrayBuffer());
    if (bytes.length > AVATAR_MAX_BYTES || !imageType(bytes)) return { identity };
    return { identity: { ...identity, avatar: { version, data: bytes.toString("base64") } } };
  } catch {
    // the session answered, the image did not: keep the last one if any
    return { identity: previous?.origin === origin && previous.avatar ? { ...identity, avatar: previous.avatar } : identity };
  }
}

/**
 * Keep the local server's owner identity current.
 * `environments()` is the saved servers (environments.cjs state), `fetch`
 * carries the app's cookies, `post(message)` reaches the local server (false
 * when it is not running), `log(line)` never receives the identity itself.
 */
export function createOwnerIdentitySync({ environments, fetch, post, log = () => {}, intervalMs = OWNER_IDENTITY_REFRESH_MS, setInterval: every = setInterval, clearInterval: stopEvery = clearInterval }) {
  let current = null;
  let known = false;
  let sentKey = null;
  let running = null;
  let timer = null;

  const keyOf = (identity) => (identity ? JSON.stringify([identity.origin, identity.principalId, identity.name, identity.email, identity.avatar?.version ?? null]) : "null");

  const send = (force) => {
    if (!known) return;
    const key = keyOf(current);
    if (!force && key === sentKey) return;
    if (post({ type: OWNER_IDENTITY_MESSAGE, identity: current }) !== false) sentKey = key;
  };

  const run = async () => {
    const origins = organizationOrigins(environments());
    if (!origins.length) {
      current = null;
      known = true;
      send(false);
      return;
    }
    let signedOutEverywhere = true;
    for (const origin of origins) {
      const result = await readOwnerIdentity(origin, { fetch, previous: current });
      if (result.unreachable) {
        signedOutEverywhere = false;
        continue;
      }
      if (result.identity) {
        current = result.identity;
        known = true;
        send(false);
        return;
      }
    }
    // Every server answered "not signed in": the owner is no one there. An
    // unreachable one keeps what was known.
    if (signedOutEverywhere) {
      current = null;
      known = true;
      send(false);
    } else {
      log("owner identity: an organization server did not answer; keeping the last identity");
    }
  };

  const refresh = (reason = "refresh") => {
    if (running) return running;
    running = run().catch((error) => log(`owner identity: ${reason} failed (${error?.message ?? error})`)).finally(() => { running = null; });
    return running;
  };

  return {
    refresh,
    /** The local server (re)started: it gets what is known at once, then a fresh read. */
    serverReady() {
      send(true);
      return refresh("server ready");
    },
    start() {
      if (timer) return;
      timer = every(() => void refresh("timer"), intervalMs);
      timer?.unref?.();
    },
    stop() {
      if (timer) stopEvery(timer);
      timer = null;
    },
    /** For tests: what would be sent now. */
    get current() { return current; },
  };
}
