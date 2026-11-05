// MCP servers Codex loads from its own configuration that Sagax did not
// mount (#2013). With a tool selection, nothing outside the selection may
// reach the model, so the driver used to refuse the turn and ask the person
// to disable the account's native MCP entries by hand ("Codex has an MCP
// server outside the selected configuration ... No prompt was sent.").
//
// Sagax does it itself now. The names in the account's config.toml are
// already disabled at launch (prepare-launch.ts). Any other server the
// effective configuration still shows (a project's .codex/config.toml, an
// inline table, a profile) is remembered here by the Codex home and folder
// it came from, and the app-server is launched once more with
// `mcp_servers.<name>.enabled=false` for it. Only a name Codex itself just
// reported is ever disabled this way: an override for a server no layer
// declares is an invalid configuration, so a name that stops being declared
// is forgotten again on that error (forgetAmbientMcp).
//
// When even that does not take (a managed layer wins over `-c`), the turn is
// refused as before, and fixAmbientMcp is the composer's one-click Fix: it
// writes `enabled = false` into each named table of the account's own
// config.toml, where the person's native entries live.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** The Codex home a launch reads its config.toml from. */
export function codexHomeOf(env: Record<string, string | undefined>): string {
  return env.CODEX_HOME || join(env.HOME || env.USERPROFILE || homedir(), ".codex");
}

const learned = new Map<string, Set<string>>();
const keyOf = (codexHome: string, cwd: string) => `${codexHome}\u0000${cwd}`;

/** Ambient servers already seen for this account and folder: each is
 * disabled at the next launch. */
export function learnedAmbientMcp(codexHome: string, cwd: string): ReadonlySet<string> {
  return learned.get(keyOf(codexHome, cwd)) ?? new Set();
}

/** Remember servers Codex reported outside the selection. Returns true when
 * at least one is new, so a relaunch can disable it. */
export function learnAmbientMcp(codexHome: string, cwd: string, names: Iterable<string>): boolean {
  const key = keyOf(codexHome, cwd);
  const known = learned.get(key) ?? new Set<string>();
  let added = false;
  for (const name of names) {
    if (!SAFE_NAME.test(name) || known.has(name)) continue;
    known.add(name);
    added = true;
  }
  if (known.size) learned.set(key, known);
  return added;
}

/** Drop what was learned for this account and folder (Codex called the
 * configuration invalid: a remembered server is no longer declared). */
export function forgetAmbientMcp(codexHome: string, cwd: string): boolean {
  return learned.delete(keyOf(codexHome, cwd));
}

/** Tests only. */
export function resetAmbientMcpForTests(): void {
  learned.clear();
  refusals.clear();
}

/** A bare TOML key: the only names written into an override or a file. */
const SAFE_NAME = /^[A-Za-z0-9_-]{1,128}$/;

export interface AmbientRefusal {
  codexHome: string;
  cwd: string;
  names: string[];
  at: number;
}

/** The last refusal per conversation, for the composer's Fix. */
const refusals = new Map<string, AmbientRefusal>();

export function noteAmbientRefusal(threadId: string, refusal: AmbientRefusal): void {
  refusals.set(threadId, refusal);
}

export function ambientRefusalFor(threadId: string): AmbientRefusal | null {
  return refusals.get(threadId) ?? null;
}

export function clearAmbientRefusal(threadId: string): void {
  refusals.delete(threadId);
}

const HEADER = /^[ \t]*\[[ \t]*mcp_servers[ \t]*\.[ \t]*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([A-Za-z0-9_-]+))[ \t]*\][ \t]*(?:#.*)?$/;
const ANY_TABLE = /^[ \t]*\[/;
const ENABLED = /^[ \t]*enabled[ \t]*=/;

/** Write `enabled = false` into each `[mcp_servers.<name>]` table of this
 * TOML text that the names list. Comments, order and every other key stay.
 * Returns the new text and the names it disabled. */
export function disableMcpTables(toml: string, names: ReadonlySet<string>): { text: string; disabled: string[] } {
  const lines = toml.split(/\r?\n/);
  const eol = toml.includes("\r\n") ? "\r\n" : "\n";
  const out: string[] = [];
  const disabled: string[] = [];
  let current: string | null = null;
  let wrote = false;
  const close = () => {
    if (current && !wrote) { out.push("enabled = false"); disabled.push(current); }
    current = null;
    wrote = false;
  };
  for (const line of lines) {
    if (ANY_TABLE.test(line)) {
      close();
      const match = HEADER.exec(line);
      const name = match ? (match[1] !== undefined ? match[1].replace(/\\(.)/g, "$1") : match[2] ?? match[3]) : undefined;
      out.push(line);
      if (name && names.has(name)) current = name;
      continue;
    }
    if (current && ENABLED.test(line)) {
      out.push("enabled = false");
      disabled.push(current);
      wrote = true;
      continue;
    }
    out.push(line);
  }
  // A table at the end of the file closes with it (before trailing blank lines).
  if (current && !wrote) {
    let at = out.length;
    while (at > 0 && out[at - 1]!.trim() === "") at--;
    out.splice(at, 0, "enabled = false");
    disabled.push(current);
  }
  return { text: out.join(eol), disabled: [...new Set(disabled)] };
}

/** The composer's Fix: disable the refused servers in the account's own
 * config.toml. Names it could not find there stay listed in `missing`. */
export function fixAmbientMcp(refusal: AmbientRefusal): { disabled: string[]; missing: string[] } {
  const file = join(refusal.codexHome, "config.toml");
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return { disabled: [], missing: refusal.names };
  }
  const wanted = new Set(refusal.names.filter((name) => SAFE_NAME.test(name)));
  const next = disableMcpTables(text, wanted);
  if (next.disabled.length) {
    const tmp = `${file}.sagax-${process.pid}.tmp`;
    writeFileSync(tmp, next.text, { mode: 0o600 });
    renameSync(tmp, file);
  }
  // What Sagax disabled natively needs no launch override any more.
  forgetAmbientMcp(refusal.codexHome, refusal.cwd);
  return { disabled: next.disabled, missing: refusal.names.filter((name) => !next.disabled.includes(name)) };
}
