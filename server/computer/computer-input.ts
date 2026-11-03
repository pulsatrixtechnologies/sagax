// Remote input for a bot's computer from the phone's native viewer (iOS
// parity, screens 13 and 11): pointer moves, buttons, scroll, keys, text and
// the clipboard. Every backend Sagax drives a desktop on (the cloud Boat, a
// team's Boat, a bring-your-own VPS container and the Local VM) is an X11
// desktop the bot itself drives with xdotool and xclip
// (server/drivers/chat-boat-tools.ts), so a phone event becomes the same
// kind of shell line, run through that backend's existing command path.
//
// Nothing a caller sends reaches a shell unquoted: numbers are integers
// checked by the schema, keys resolve to an X keysym from a fixed pattern,
// and text travels base64 encoded inside single quotes.
import { z } from "zod";

const int = (min: number, max: number) => z.number().int().min(min).max(max);
const unit = z.number().finite().min(0).max(1);

export const MODIFIERS = ["shift", "ctrl", "alt", "meta"] as const;
export type Modifier = (typeof MODIFIERS)[number];

export const computerInputEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("move"), dx: int(-10_000, 10_000), dy: int(-10_000, 10_000) }).strict(),
  z.object({ type: z.literal("moveTo"), x: unit, y: unit }).strict(),
  z.object({
    type: z.literal("button"),
    button: z.enum(["left", "right", "middle"]),
    action: z.enum(["click", "down", "up"]),
    count: int(1, 3).optional(),
  }).strict(),
  z.object({ type: z.literal("scroll"), dx: int(-50, 50), dy: int(-50, 50) }).strict(),
  z.object({ type: z.literal("key"), key: z.string().min(1).max(32), modifiers: z.array(z.enum(MODIFIERS)).max(4).optional() }).strict(),
  z.object({ type: z.literal("text"), text: z.string().min(1).max(1_000) }).strict(),
]);
export type ComputerInputEvent = z.infer<typeof computerInputEventSchema>;

export const MAX_INPUT_EVENTS = 64;
export const computerInputBodySchema = z.object({
  events: z.array(computerInputEventSchema).min(1).max(MAX_INPUT_EVENTS),
  /** The lease the phone took control with, when it used one. */
  controlLeaseId: z.string().min(1).max(200).optional(),
}).strict();

/** A clipboard round trip carries text only, bounded. */
export const MAX_CLIPBOARD_BYTES = 16 * 1024;
export const clipboardBodySchema = z.object({
  text: z.string().refine((value) => Buffer.byteLength(value, "utf8") <= MAX_CLIPBOARD_BYTES, { error: `text must be at most ${MAX_CLIPBOARD_BYTES} bytes` }),
  controlLeaseId: z.string().min(1).max(200).optional(),
}).strict();

const KEY_ALIASES: Record<string, string> = {
  enter: "Return", return: "Return", backspace: "BackSpace", tab: "Tab", escape: "Escape", esc: "Escape",
  space: "space", " ": "space", delete: "Delete", del: "Delete", insert: "Insert",
  arrowup: "Up", up: "Up", arrowdown: "Down", down: "Down", arrowleft: "Left", left: "Left", arrowright: "Right", right: "Right",
  home: "Home", end: "End", pageup: "Prior", pagedown: "Next",
  "-": "minus", "=": "equal", "[": "bracketleft", "]": "bracketright", "\\": "backslash", ";": "semicolon", "'": "apostrophe",
  ",": "comma", ".": "period", "/": "slash", "`": "grave", "!": "exclam", "@": "at", "#": "numbersign", "$": "dollar",
  "%": "percent", "^": "asciicircum", "&": "ampersand", "*": "asterisk", "(": "parenleft", ")": "parenright", "_": "underscore",
  "+": "plus", "{": "braceleft", "}": "braceright", "|": "bar", ":": "colon", "\"": "quotedbl", "<": "less", ">": "greater",
  "?": "question", "~": "asciitilde",
};
const MODIFIER_KEYSYM: Record<Modifier, string> = { shift: "shift", ctrl: "ctrl", alt: "alt", meta: "super" };

/** The X keysym for a key the phone names: a web-style name (Enter,
 * ArrowUp, PageDown), one printable character, a function key, or an X
 * keysym itself (BackSpace, Return). Null for anything else. */
export function keysymFor(key: string): string | null {
  const alias = KEY_ALIASES[key.toLowerCase()] ?? KEY_ALIASES[key];
  if (alias) return alias;
  if (/^[A-Za-z0-9]$/.test(key)) return key;
  if (/^f(?:[1-9]|1[0-9]|2[0-4])$/i.test(key)) return key.toUpperCase();
  if (/^[A-Za-z][A-Za-z0-9_]{1,31}$/.test(key)) return key;
  return null;
}

const BUTTON: Record<"left" | "middle" | "right", number> = { left: 1, middle: 2, right: 3 };
/** Fractions of the screen travel as integers out of this. */
const SCALE = 100_000;

const quoteBase64 = (text: string) => `'${Buffer.from(text, "utf8").toString("base64")}'`;

/** One shell line per event, or an error naming the event that cannot be sent. */
export function inputCommands(events: readonly ComputerInputEvent[]): { ok: true; commands: string[] } | { ok: false; error: string } {
  const commands: string[] = [];
  for (const [index, event] of events.entries()) {
    switch (event.type) {
      case "move":
        // No --sync: xdotool then waits for the pointer to change, which never
        // happens for a move to where it already is or past a screen edge,
        // and the whole batch hangs until the backend's timeout.
        if (event.dx || event.dy) commands.push(`xdotool mousemove_relative -- ${event.dx} ${event.dy}`);
        break;
      case "moveTo": {
        const x = Math.min(SCALE - 1, Math.round(event.x * SCALE));
        const y = Math.min(SCALE - 1, Math.round(event.y * SCALE));
        commands.push(`eval "$(xdotool getdisplaygeometry --shell)" && xdotool mousemove $((WIDTH*${x}/${SCALE})) $((HEIGHT*${y}/${SCALE}))`);
        break;
      }
      case "button": {
        const button = BUTTON[event.button];
        if (event.action === "click") commands.push(`xdotool click --repeat ${event.count ?? 1} --delay 80 ${button}`);
        else commands.push(`xdotool ${event.action === "down" ? "mousedown" : "mouseup"} ${button}`);
        break;
      }
      case "scroll": {
        // X11 wheel buttons: 4 up, 5 down, 6 left, 7 right.
        if (event.dy) commands.push(`xdotool click --repeat ${Math.abs(event.dy)} --delay 30 ${event.dy > 0 ? 5 : 4}`);
        if (event.dx) commands.push(`xdotool click --repeat ${Math.abs(event.dx)} --delay 30 ${event.dx > 0 ? 7 : 6}`);
        break;
      }
      case "key": {
        const keysym = keysymFor(event.key);
        if (!keysym || !/^[A-Za-z0-9_]+$/.test(keysym)) return { ok: false, error: `events[${index}].key is not a key Sagax can send` };
        const chord = [...new Set(event.modifiers ?? [])].map((modifier) => MODIFIER_KEYSYM[modifier]);
        commands.push(`xdotool key --clearmodifiers ${[...chord, keysym].join("+")}`);
        break;
      }
      case "text":
        commands.push(`xdotool type --clearmodifiers --delay 8 -- "$(printf %s ${quoteBase64(event.text)} | base64 -d)"`);
        break;
    }
  }
  return { ok: true, commands };
}

/** Group lines into scripts no longer than `maxLength` each (the Boat's
 * command API takes 4,000 characters), run in order. */
export function batchCommands(commands: readonly string[], maxLength = 3_500): string[] {
  const batches: string[] = [];
  let current = "";
  for (const command of commands) {
    const next = current ? `${current} && ${command}` : command;
    if (current && next.length > maxLength) {
      batches.push(current);
      current = command;
    } else current = next;
  }
  if (current) batches.push(current);
  return batches;
}

const CLIP_FILE = "/tmp/.sagax-clipboard.b64";

/** Read the clipboard as base64 on one line (empty when there is none). */
export const CLIPBOARD_READ_COMMAND = `(xclip -selection clipboard -o 2>/dev/null || true) | head -c ${MAX_CLIPBOARD_BYTES} | base64 | tr -d '\\n'`;

/** Scripts that put `text` on the clipboard: the text arrives in base64
 * chunks appended to a private file, then xclip serves it (detached, so the
 * command returns while xclip keeps owning the selection). */
export function clipboardWriteCommands(text: string, chunk = 3_000): string[] {
  const encoded = Buffer.from(text, "utf8").toString("base64");
  const commands = [`umask 077 && : > ${CLIP_FILE}`];
  for (let at = 0; at < encoded.length; at += chunk) commands.push(`printf %s '${encoded.slice(at, at + chunk)}' >> ${CLIP_FILE}`);
  commands.push(`base64 -d ${CLIP_FILE} | xclip -selection clipboard -i >/dev/null 2>&1; status=$?; rm -f ${CLIP_FILE}; exit $status`);
  return commands;
}

/** Decode what CLIPBOARD_READ_COMMAND printed. */
export function decodeClipboard(stdout: string): string {
  const encoded = stdout.trim();
  if (!encoded) return "";
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw Object.assign(new Error("The computer returned an unreadable clipboard."), { status: 502 });
  return Buffer.from(encoded, "base64").toString("utf8");
}

/** What the audit keeps of one batch: counts by type, never typed text. */
export function inputSummary(events: readonly ComputerInputEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) counts[event.type] = (counts[event.type] ?? 0) + 1;
  return counts;
}
