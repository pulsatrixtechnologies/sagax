// Loopback base URLs for models that run on the signed-in person's own
// computer. The organization server stores these only so that desktop can
// probe them. The server never fetches them. A matching copy lives in
// electron/local-models.mjs because the desktop process cannot import this
// TypeScript module. Keep the two checks in step.

export const DESKTOP_HOST_ID = /^desk[a-z0-9]{3,24}$/;

export interface LoopbackEndpoint {
  id: string;
  label: string;
  baseUrl: string;
}

/** Outcome of the desktop's last probe of one loopback server, for the
 * Settings panel so the owner can tell "listed", "running but empty",
 * "reachable but needs an API key" and "not responding" apart instead of a
 * single blank "nothing answered". It never gates the picker: only a server
 * that answered /v1/models with usable models becomes a selectable row. */
export type LoopbackProbeStatus = "answered" | "empty" | "needs_key" | "offline";

export interface LoopbackProbe {
  id: string;
  status: LoopbackProbeStatus;
}

export const LOOPBACK_PROBE_STATUSES: readonly LoopbackProbeStatus[] = ["answered", "empty", "needs_key", "offline"];

/** Suggested loopback servers. A host is published only after /v1/models answers. */
export const SEED_ENDPOINTS: readonly LoopbackEndpoint[] = [
  { id: "desk8002", label: "DwarfStar", baseUrl: "http://127.0.0.1:8002/v1" },
  { id: "desk9337", label: "llama-server", baseUrl: "http://127.0.0.1:9337/v1" },
  { id: "desk9338", label: "Bonsai", baseUrl: "http://127.0.0.1:9338/v1" },
  { id: "desk8000", label: "oMLX", baseUrl: "http://127.0.0.1:8000/v1" },
  { id: "desk11434", label: "Ollama", baseUrl: "http://127.0.0.1:11434/v1" },
  { id: "desk52415", label: "EXO", baseUrl: "http://127.0.0.1:52415/v1" },
  { id: "desk1234", label: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1" },
  { id: "desk8888", label: "Unsloth", baseUrl: "http://127.0.0.1:8888/v1" },
];

/** http://127.0.0.1 or http://localhost, explicit port, path exactly /v1. */
export function normalizeLoopbackBase(input: unknown): string | null {
  if (typeof input !== "string" || input.length === 0 || input.length > 200) return null;
  let url: URL;
  try { url = new URL(input); } catch { return null; }
  if (url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost") return null;
  if (url.username || url.password || url.search || url.hash) return null;
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path !== "/v1") return null;
  if (!url.port || !/^[0-9]+$/.test(url.port)) return null;
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return `http://${host}:${port}/v1`;
}

export function isDesktopHostId(id: string): boolean {
  return DESKTOP_HOST_ID.test(id);
}
