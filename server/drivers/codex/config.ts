/** Codex driver kind and config decoding. */

export const DRIVER_KIND = "codex";

export interface CodexConfig {
  cli: string;
  fullAuto: boolean;
  authMode?: "chatgpt-plan";
  /** Ephemeral Company routing, supplied by the trusted desktop parent. */
  managed?: { url: string; models: string[] };
}

export function decodeConfig(raw: unknown): CodexConfig {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (o.authMode !== undefined && o.authMode !== "chatgpt-plan") throw new Error("Unknown Codex sign-in mode.");
  if (o.authMode && o.managed) throw new Error("ChatGPT plan and Company billing cannot be combined.");
  return {
    cli: typeof o.cli === "string" ? o.cli : "codex",
    fullAuto: o.fullAuto === true,
    ...(o.authMode === "chatgpt-plan" ? { authMode: "chatgpt-plan" as const } : {}),
    ...(o.managed && typeof o.managed === "object" ? { managed: decodeManagedCodex(o.managed) } : {}),
  };
}

export function decodeManagedCodex(raw: object): NonNullable<CodexConfig["managed"]> {
  const value = raw as { url?: unknown; models?: unknown };
  if (typeof value.url !== "string" || !Array.isArray(value.models) || !value.models.length || value.models.some(model => typeof model !== "string" || !/^[\w][\w./+-]*$/.test(model))) {
    throw new Error("Invalid Company Codex configuration.");
  }
  const url = new URL(value.url);
  // Plain HTTP leaks the Company API key; allow it only on loopback hosts,
  // where a local proxy terminates TLS on the trusted machine instead.
  const loopback = url.hostname === "localhost" || url.hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) throw new Error("Invalid Company Codex endpoint.");
  return { url: url.href.replace(/\/$/, ""), models: value.models as string[] };
}
