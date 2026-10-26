// One log line for every 401 a presented session credential gets and every
// session the server ends (2026-10-20): until now a person signed out left
// no trace, so a logout after a deploy could not be told from a revoke. The
// line carries the reason code, the route (path only: a stream ticket rides
// in the query), how the credential came, the client family from its
// User-Agent and the first characters of the session id when the server
// knows it. Never the token, its hash, a cookie or a query string.
//
// A signed-out desktop that polls would write the same line many times a
// minute: an identical line is written once per minute, then counted, and
// the count rides on the next one written.

/** Coarse client family from a User-Agent: enough to tell the desktop app,
 * the phone apps and a browser apart, nothing that identifies a device. */
export function clientFamily(userAgent: string | undefined): string {
  const ua = userAgent ?? "";
  if (!ua) return "none";
  if (/\bElectron\//.test(ua) || /\b(?:Sagax|OpenMausBot)\/[\d.]+.*\bElectron\b/i.test(ua)) {
    return /Windows/.test(ua) ? "desktop-windows" : /Mac OS X|Macintosh/.test(ua) ? "desktop-mac" : /Linux/.test(ua) ? "desktop-linux" : "desktop";
  }
  if (/CFNetwork|Darwin\//.test(ua) && !/Mozilla/.test(ua)) return "ios-app";
  if (/^(?:Sagax|OpenMausBot|Pulsatrix)[^/]*\/[\d.]+.*(?:iOS|iPhone|iPad)/i.test(ua)) return "ios-app";
  if (/okhttp|Dalvik/i.test(ua)) return "android-app";
  if (/^node|undici|node-fetch/i.test(ua)) return "node";
  if (/Mozilla\//.test(ua)) {
    const os = /iPhone|iPad/.test(ua) ? "ios" : /Android/.test(ua) ? "android" : /Windows/.test(ua) ? "windows" : /Mac OS X/.test(ua) ? "mac" : /Linux/.test(ua) ? "linux" : "other";
    return `browser-${os}`;
  }
  if (/curl|wget|python|go-http/i.test(ua)) return "script";
  return "other";
}

/** The first eight characters of a session id, or "-". */
export function sessionIdPrefix(id: string | undefined): string {
  return id && /^[\w-]+$/.test(id) ? id.slice(0, 8) : "-";
}

/** A path safe to log: no query, ids kept (they name routes, not people),
 * bounded. */
export function loggablePath(path: string): string {
  const bare = path.split("?")[0] ?? "";
  return bare.replace(/[^\w./:@-]/g, "_").slice(0, 120);
}

export interface AuthRefusalEvent {
  /** "refused" (a 401 for a presented credential) or "ended" (the server ended the session now). */
  event: "refused" | "ended";
  status: number;
  code: string;
  method: string;
  path: string;
  via?: string;
  userAgent?: string;
  sessionId?: string;
  /** For "ended": why, in a few words (never a secret). */
  detail?: string;
}

export interface AuthRefusalLogger {
  record(event: AuthRefusalEvent): void;
}

export const AUTH_REFUSAL_REPEAT_MS = 60_000;
/** At most this many refusal lines a minute (ended sessions always go). */
export const AUTH_REFUSAL_LINES_PER_MINUTE = 100;

export function createAuthRefusalLogger(options: { log?: (line: string) => void; now?: () => number; repeatMs?: number } = {}): AuthRefusalLogger {
  const log = options.log ?? ((line: string) => console.warn(line));
  const now = options.now ?? Date.now;
  const repeatMs = options.repeatMs ?? AUTH_REFUSAL_REPEAT_MS;
  const seen = new Map<string, { at: number; suppressed: number }>();
  let windowStart = now();
  let written = 0;
  let dropped = 0;
  return {
    record(event) {
      const fields = [
        `auth: session ${event.event}`,
        `status=${event.status}`,
        `code=${event.code.replace(/[^\w-]/g, "_").slice(0, 40)}`,
        `route=${event.method.toUpperCase().slice(0, 8)} ${loggablePath(event.path)}`,
        `via=${event.via ?? "-"}`,
        `client=${clientFamily(event.userAgent)}`,
        `session=${sessionIdPrefix(event.sessionId)}`,
      ];
      if (event.detail) fields.push(`detail="${event.detail.replace(/["\n\r]/g, " ").slice(0, 160)}"`);
      // An unknown token names no session: grouped without its route, so a
      // stranger trying many paths gets one line, not one per path.
      const key = event.code === "session_unknown" && !event.sessionId
        ? fields.filter((field) => !field.startsWith("route=")).join(" ")
        : fields.join(" ");
      const at = now();
      if (at - windowStart >= repeatMs) {
        if (dropped) log(`auth: ${dropped} more session refusal line(s) held back in the last minute`);
        windowStart = at;
        written = 0;
        dropped = 0;
      }
      const last = seen.get(key);
      if (event.event === "refused" && last && at - last.at < repeatMs) {
        last.suppressed += 1;
        return;
      }
      if (seen.size > 5_000) {
        for (const [k, v] of seen) if (at - v.at >= repeatMs) seen.delete(k);
        if (seen.size > 5_000) seen.clear();
      }
      if (event.event === "refused" && written >= AUTH_REFUSAL_LINES_PER_MINUTE) {
        dropped += 1;
        return;
      }
      const repeated = last?.suppressed ? ` repeated=${last.suppressed}` : "";
      seen.set(key, { at, suppressed: 0 });
      written += 1;
      log(`${key}${repeated}`);
    },
  };
}
