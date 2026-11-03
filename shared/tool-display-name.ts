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
function decodeEscapes(part: string): string {
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

function words(part: string): string {
  return part.replace(/[_.]+/g, " ").replace(/\s+/g, " ").trim();
}

/** The tool and the product it serves, in words: `Get mail message · Outlook`,
 * `Read file`, `Find schedule entries · ConnectWise`. `product` is the one
 * the server declared for the call, when it declared one. */
export function toolDisplayName(name: string, product?: string): string {
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
