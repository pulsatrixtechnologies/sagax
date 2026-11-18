// A PowerShell line that only reads the local computer (#4575), judged by a
// POSITIVE grammar: a line counts as a read only when it is built entirely
// from the pieces below. Anything else, known or not, keeps its card.
//
// The interpreter: the Tailcat session shell on Windows is PowerShell itself.
// The server sends the line as ONE argument that the remote PowerShell parses
// once (server/remote-support/remote-session-probe.ts: tailcatSshArgv,
// windowsScriptCommand), with no outer shell. So the grammar follows
// PowerShell's own parsing, and it is the narrow common core of Windows
// PowerShell 5.1 and PowerShell 7:
// - a command is a pipeline: ONE reader cmdlet (or program), then only
//   output filters (Select-Object, Sort-Object, ...), joined by `|`;
// - the cmdlet name is the full name, never an alias or an abbreviation;
// - a parameter is its FULL name from the cmdlet's own table below. PowerShell
//   accepts any unambiguous prefix (-Na), `-Name:value`, and the common
//   parameters (-ErrorAction, -OutVariable, ...): none of those is in a table,
//   so none is a read here. A parameter token is `-` and letters, nothing more;
// - a value is a typed literal: an integer, a plain name, a property name, a
//   counter path or a WQL SELECT, bare or in single quotes (a literal in
//   PowerShell: no expansion). No variable, subexpression, script block,
//   hashtable, array operator, redirect, call operator, second statement,
//   path or drive;
// - positional values bind only to the one parameter documented at Position 0
//   in both PowerShell versions.
// Layered on the shared line checks (read-only-command.ts): control and
// lookalike characters, UNC paths, credential locations and provider drives
// still refuse first.
import { lineFitsReadClassifier } from "./read-only-command.ts";

type Kind = "switch" | "int" | "names" | "props" | "counters" | "wql" | "wherecond";

interface Spec {
  /** Full parameter names, lower case, with the kind of value each takes. */
  params: Record<string, Kind>;
  /** The parameter a first bare value binds to (Position 0), if any. */
  positional?: string;
  /** No parameter and no value at all. */
  bare?: boolean;
}

const NAME = /^[A-Za-z0-9_.*][A-Za-z0-9 _.*/-]{0,127}$/;
const PROP = /^(\*|[A-Za-z_][A-Za-z0-9_.]{0,63})$/;
const COUNTER = /^\\[A-Za-z0-9 _.%()*#/\\-]{1,200}$/;
// SELECT <fields> FROM <class> [WHERE <plain comparison>]; WQL has no write.
const WQL = /^SELECT [A-Za-z0-9_*, ]{1,200} FROM [A-Za-z][A-Za-z0-9_]{0,63}( WHERE [A-Za-z0-9_ =<>%."-]{1,200})?$/i;
const WHERE = /^[A-Za-z0-9_ =<>%."-]{1,200}$/;

/** The readers: each reads the computer it runs on. */
const READERS: Record<string, Spec> = {
  "get-process": { params: { name: "names", id: "int" }, positional: "name" },
  "get-service": { params: { name: "names", displayname: "names" }, positional: "name" },
  "get-winevent": { params: { logname: "names", providername: "names", maxevents: "int", oldest: "switch" }, positional: "logname" },
  "get-counter": { params: { counter: "counters", sampleinterval: "int", maxsamples: "int" }, positional: "counter" },
  "get-ciminstance": { params: { classname: "names", query: "wql", filter: "wherecond", property: "props" }, positional: "classname" },
  "get-computerinfo": { params: {}, bare: true },
  "get-date": { params: {}, bare: true },
  hostname: { params: {}, bare: true },
  whoami: { params: {}, bare: true },
  quser: { params: {}, bare: true },
};
/** Filters of the previous command's output: they reorder or trim it. */
const FILTERS: Record<string, Spec> = {
  "select-object": { params: { property: "props", first: "int", last: "int", skip: "int", expandproperty: "props" }, positional: "property" },
  "sort-object": { params: { property: "props", descending: "switch" }, positional: "property" },
  "format-table": { params: { property: "props", autosize: "switch" }, positional: "property" },
  "format-list": { params: { property: "props" }, positional: "property" },
  "measure-object": { params: { property: "props", sum: "switch", average: "switch", maximum: "switch", minimum: "switch" }, positional: "property" },
  "out-string": { params: {}, bare: true },
};
/** `query user|session|process`, with nothing after the word. */
const QUERY_KINDS = new Set(["user", "session", "process"]);

interface Item { text: string; quoted: boolean }
type Token = { param: string } | { items: Item[] };

/** One pipeline segment into tokens; null on anything outside the grammar. */
function tokens(segment: string): Token[] | null {
  const out: Token[] = [];
  let i = 0;
  const n = segment.length;
  while (i < n) {
    if (segment[i] === " " || segment[i] === "\t") { i += 1; continue; }
    if (segment[i] === "-") {
      const match = /^-[A-Za-z]+(?=[ \t]|$)/.exec(segment.slice(i));
      if (!match) return null;
      out.push({ param: match[0].slice(1).toLowerCase() });
      i += match[0].length;
      continue;
    }
    // a value: item(,item)*, each a single-quoted literal or a bare word
    const items: Item[] = [];
    for (;;) {
      if (segment[i] === "'") {
        const end = segment.indexOf("'", i + 1);
        if (end < 0) return null;
        items.push({ text: segment.slice(i + 1, end), quoted: true });
        i = end + 1;
      } else {
        const match = /^[A-Za-z0-9_.*][A-Za-z0-9_.*-]*/.exec(segment.slice(i));
        if (!match) return null;
        items.push({ text: match[0], quoted: false });
        i += match[0].length;
      }
      if (segment[i] === ",") { i += 1; continue; }
      if (i < n && segment[i] !== " " && segment[i] !== "\t") return null;
      break;
    }
    out.push({ items });
  }
  return out;
}

function valueFits(kind: Kind, items: Item[]): boolean {
  if (kind === "int") return items.length === 1 && !items[0]!.quoted && /^\d{1,6}$/.test(items[0]!.text);
  if (kind === "names") return items.length <= 16 && items.every((item) => NAME.test(item.text));
  if (kind === "props") return items.length <= 16 && items.every((item) => PROP.test(item.text));
  if (kind === "counters") return items.length <= 16 && items.every((item) => item.quoted && COUNTER.test(item.text));
  if (kind === "wql") return items.length === 1 && items[0]!.quoted && WQL.test(items[0]!.text);
  if (kind === "wherecond") return items.length === 1 && items[0]!.quoted && WHERE.test(items[0]!.text);
  return false;
}

/** The words after the cmdlet name, against that cmdlet's table. */
function argumentsFit(spec: Spec, list: Token[]): boolean {
  if (spec.bare) return list.length === 0;
  const bound = new Set<string>();
  const bind = (name: string) => { if (bound.has(name)) return false; bound.add(name); return true; };
  for (let at = 0; at < list.length; at += 1) {
    const token = list[at]!;
    if ("param" in token) {
      const kind = Object.hasOwn(spec.params, token.param) ? spec.params[token.param] : undefined;
      if (!kind || !bind(token.param)) return false;
      if (kind === "switch") continue;
      const value = list[at + 1];
      if (!value || !("items" in value) || !valueFits(kind, value.items)) return false;
      at += 1;
      continue;
    }
    const target = spec.positional;
    const kind = target && Object.hasOwn(spec.params, target) ? spec.params[target] : undefined;
    if (!target || !kind || !bind(target) || !valueFits(kind, token.items)) return false;
  }
  return true;
}

/** Split on `|`, none of which may sit inside a quote. */
function segments(line: string): string[] | null {
  const out: string[] = [];
  let current = "";
  let quote = false;
  for (const c of line) {
    if (c === "'") quote = !quote;
    if (c === "|" && !quote) { out.push(current); current = ""; continue; }
    current += c;
  }
  if (quote) return null;
  out.push(current);
  return out.every((part) => part.trim()) ? out.map((part) => part.trim()) : null;
}

/** Whether a PowerShell command line only reads the computer it runs on. */
export function isReadOnlyPowerShell(command: string | undefined): boolean {
  if (typeof command !== "string") return false;
  const line = command.trim();
  if (!lineFitsReadClassifier(line)) return false;
  // plain printable ASCII, tab and space only: no other character is ever judged
  if (!/^[\x20-\x7e\t]+$/.test(line)) return false;
  const parts = segments(line);
  if (!parts) return false;
  return parts.every((part, index) => {
    const head = /^[A-Za-z][A-Za-z0-9-]*/.exec(part);
    if (!head) return false;
    const name = head[0].toLowerCase();
    const rest = part.slice(head[0].length);
    if (rest && !/^[ \t]/.test(rest)) return false;
    if (index === 0 && name === "query") {
      const words = rest.trim().split(/[ \t]+/);
      return words.length === 1 && QUERY_KINDS.has(words[0]!.toLowerCase());
    }
    const spec = (index === 0 ? READERS : FILTERS)[name];
    if (!spec || !Object.hasOwn(index === 0 ? READERS : FILTERS, name)) return false;
    const list = tokens(rest);
    return Boolean(list) && argumentsFit(spec, list!);
  });
}
