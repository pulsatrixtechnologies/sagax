// A tool's name in words, never its raw id (2026-11-03, the maintainer: no `__` name is
// ever visible). The step detail's "Tool" row (src/lib/step-label.ts
// stepToolName) and the routine problem lines (server/routines/routines.ts,
// shared/routine-problems.ts) read the same way.
//
// Grok's managed gateway names a connector's tool with `_XX` hex escapes and
// the server's number (`cursor__user-Outlook-get_5fmail_5fmessage___12`,
// shared/grok-cloud-connectors.ts), and some titles drop the gateway part
// (`user-Outlook-get_5fmail_5fmessage___12`). Split on `__` as they were,
// they read "Get 5fmail 5fmessage" and, for the Tool row, a bare "12".
import { readGatewayToolId } from "./approval-describe.ts";

/** A gateway's own server name, only to read a title Grok gave without it. */
const GATEWAY_STAND_IN = "gateway";
/** A gateway tool title without its gateway part: `user-<server>-<tool>___<n>`. */
const BARE_GATEWAY_TOOL = /^(?:user|team|org|workspace)-.+___\d+$/i;

/** The full gateway id of a tool name, the gateway part restored when the
 * title left it out; undefined for any other name. */
export function gatewayToolId(name: string): string | undefined {
  const bare = name.trim();
  if (readGatewayToolId(bare)) return bare;
  if (BARE_GATEWAY_TOOL.test(bare)) {
    const full = `${GATEWAY_STAND_IN}__${bare}`;
    if (readGatewayToolId(full)) return full;
  }
  return undefined;
}

/** `_XX` hex escapes decoded (`get_5fmail` reads `get_mail`), only in a
 * name the gateway escaped (it escapes every `_`, so `_5f` is there). */
function decodeEscapes(part: string | undefined): string {
  if (!part) return "";
  if (!/_5f/i.test(part)) return part;
  return part.replace(/_([0-9a-f]{2})/gi, (match, hex: string) => {
    const code = parseInt(hex, 16);
    // only printable ASCII: `_12` in `step_12` is no escape
    return code >= 0x20 && code < 0x7f && !/[0-9A-Za-z]/.test(String.fromCharCode(code)) ? String.fromCharCode(code) : match;
  });
}

function capitalize(text: string): string {
  return text ? text[0]!.toLocaleUpperCase() + text.slice(1) : text;
}

function words(part: string | undefined): string {
  if (!part) return "";
  return part.replace(/[_.]+/g, " ").replace(/\s+/g, " ").trim();
}

/** The tool and the product it serves, in words: `Get mail message · Outlook`,
 * `Read file`, `Find schedule entries · ConnectWise`. `product` is the one
 * the server declared for the call, when it declared one. */
export function toolDisplayName(name: string | undefined, product?: string): string {
  // Never throw: a label error used to blank the whole chat (2026-11-04).
  try {
    return toolDisplayNameUnsafe(name ?? "", product);
  } catch {
    return (name ?? "").trim() || "Tool";
  }
}

function toolDisplayNameUnsafe(name: string, product?: string): string {
  const raw = name.trim();
  const declared = product?.trim() || undefined;
  const gateway = gatewayToolId(raw);
  const read = gateway ? readGatewayToolId(gateway) : null;
  if (read) {
    const own = capitalize(words(read.parsed.name)) || read.parsed.name;
    const shown = declared ?? read.product;
    return shown ? `${own} · ${shown}` : own;
  }
  // the tool's own part of an MCP id: no server, no number suffix, no escape
  const parts = raw.replace(/___?\d+$/, "").split("__").map((part) => part.trim()).filter(Boolean);
  const own = [...parts].reverse().find((part) => !/^_*\d+$/.test(part));
  const shown = capitalize(words(decodeEscapes(own ?? ""))) || raw;
  return declared ? `${shown} · ${declared}` : shown;
}

/** Every raw tool id in a sentence (`mcp__outlook__get_message failed 2
 * times`) read as its name in words. */
const TOOL_ID_IN_TEXT = /(?<![\w-])(?:[A-Za-z0-9][\w.-]*?__[\w.-]*[A-Za-z0-9]|(?:user|team|org|workspace)-[\w.-]+___\d+)(?![\w-])/g;

/** An engine's answer to a call of a name it does not have. */
const MISSING_TOOL_BEFORE = /(?:tool not found|unknown tool):\s*$/i;

/** The connection part of an MCP id (`mcp__perspicax__flow` reads
 * `perspicax`), or undefined for a name without one. */
function toolConnection(id: string): string | undefined {
  const parts = id.trim().replace(/^mcp__/, "").split("__").filter(Boolean);
  return parts.length > 1 ? parts[0] : undefined;
}

export function humanizeToolIds(text: string | undefined): string {
  if (!text) return "";
  return text.replace(TOOL_ID_IN_TEXT, (id: string, offset: number) => {
    // #4432: in "Tool not found: <id>" the name the bot called is the whole
    // fact. Its own part alone ("Tool not found: Flow") read as a call to a
    // tool named `Flow`; the connection it was called on stays, in words.
    const connection = MISSING_TOOL_BEFORE.test(text.slice(Math.max(0, offset - 40), offset)) && !gatewayToolId(id) ? toolConnection(id) : undefined;
    return connection ? toolDisplayName(id, connection) : toolDisplayName(id);
  });
}
