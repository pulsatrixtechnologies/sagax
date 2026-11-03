// The gate's own tool search (#1276): a compact prompt for a local model.
//
// A local model reads every tool definition of every turn before its first
// token, and a server with a big catalog (a Perspicax profile lists about 150
// tools, 40,000 tokens) makes a new conversation wait minutes. With
// SAGAX_GATE_SEARCH the gate stands in for such a catalog with the three
// directory tools (mcp-directory.ts: search_tools, describe_tool,
// call_tool) plus the tools this bot actually uses, listed whole and called
// by their own names as before. A small catalog is listed as it is.
//
// Pure helpers only; the gate (mcp-gate.ts) runs them.
import { searchesCatalog, type CatalogTool } from "./mcp-directory.ts";

export interface GateSearch {
  /** Tools listed whole: the bot's own most used ones. */
  pinned: string[];
  /** Search a catalog with more tools than this... */
  maxTools: number;
  /** ...or longer definitions than this (JSON characters). */
  maxChars: number;
}

/** A catalog is searched past a dozen tools or about 4,000 tokens of
 * definitions: below that, the three directory tools would save little. */
export const SEARCH_MAX_TOOLS = 12;
export const SEARCH_MAX_CHARS = 14_000;
const PINNED_MAX = 64;

export function gateSearchEnv(search: { pinned?: readonly string[]; maxTools?: number; maxChars?: number }): string {
  const pinned = [...new Set(search.pinned ?? [])].filter((name) => typeof name === "string" && name.length > 0 && name.length <= 200).sort().slice(0, PINNED_MAX);
  return JSON.stringify({
    pinned,
    ...(search.maxTools !== undefined ? { maxTools: search.maxTools } : {}),
    ...(search.maxChars !== undefined ? { maxChars: search.maxChars } : {}),
  });
}

/** The gate's setting, or undefined when the gate lists as before. A setting
 * present but unreadable stops the gate (fail): it never widens silently. */
export function parseGateSearch(raw: string | undefined, fail: (message: string) => never): GateSearch | undefined {
  if (raw === undefined || raw === "") return undefined;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return fail("invalid tool search setting"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("invalid tool search setting");
  const record = value as Record<string, unknown>;
  const pinned = record.pinned;
  if (pinned !== undefined && (!Array.isArray(pinned) || pinned.length > PINNED_MAX || !pinned.every((name) => typeof name === "string" && name.length > 0 && name.length <= 200))) {
    return fail("invalid pinned tool list");
  }
  const number = (key: string, fallback: number) => {
    const raw = record[key];
    if (raw === undefined) return fallback;
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) return fail(`invalid ${key}`);
    return raw;
  };
  return {
    pinned: [...new Set((pinned ?? []) as string[])].sort(),
    maxTools: number("maxTools", SEARCH_MAX_TOOLS),
    maxChars: number("maxChars", SEARCH_MAX_CHARS),
  };
}

/** Whether this catalog is searched under `search`'s own thresholds (lower
 * than the remote proxy's, which serves engines that list 40 tools fine). A
 * catalog that uses a directory tool's name is always searched. */
export function searchedCatalog(tools: readonly CatalogTool[], search: GateSearch): boolean {
  if (searchesCatalog(tools)) return true;
  if (tools.length > search.maxTools) return true;
  let chars = 0;
  for (const tool of tools) {
    chars += JSON.stringify(tool).length + 1;
    if (chars > search.maxChars) return true;
  }
  return false;
}
