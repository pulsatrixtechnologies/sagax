// Which engines can run a local model (a `host::model` inject row), and why
// not when they cannot. One list for the picker (src/components/ModelPicker.tsx)
// and the turn guard (server/desktop/desktop-local-models.ts).
//
// Two kinds of local row:
// - "loopback": a server on the same machine as the Sagax server (solo, or
//   the organization server's own machine). The engine talks to it directly.
// - "desktop": a model on the signed-in person's own computer, reached
//   through the desktop bridge (server/desktop/desktop-local-models.ts). The bridge
//   carries /v1/models and /v1/chat/completions, and /v1/messages only to a
//   loopback server the desktop probed as speaking the Anthropic protocol.

export type LocalModelKind = "loopback" | "desktop";

/** Harnesses that take an OpenAI-compatible base URL and a model id from
 * Sagax for a turn (server/drivers/local-inject.ts: applyOpenAIInject,
 * codexLocalProviderArgs, the pi provider file, the Grok [model.x] block,
 * the Kimi, Qwen, Droid, Hermes and OpenCode configs). */
const OPENAI_BASE_URL_ENGINES = new Set([
  "piAgent",
  "codex",
  "grokAgent",
  "kimiAgent",
  "qwenAgent",
  "droidAgent",
  "hermesAgent",
  "opencodeGo",
]);

export type LocalModelUnavailable =
  /** Claude Code speaks the Anthropic protocol; this local server does not answer /v1/messages. */
  | "anthropic"
  /** The engine keeps its own endpoint and does not take a local base URL. */
  | "engine";

/** Null when this engine can run that kind of local row. */
export function localModelUnavailable(
  driverKind: string | undefined,
  kind: LocalModelKind,
  /** Desktop rows: the desktop's probe saw /v1/messages answer. */
  speaksAnthropic?: boolean,
): LocalModelUnavailable | null {
  if (OPENAI_BASE_URL_ENGINES.has(driverKind ?? "")) return null;
  // Claude Code sets ANTHROPIC_BASE_URL. A loopback server that answers
  // /v1/messages (DwarfStar, Ollama, LM Studio, llama-server) works. A
  // desktop row works when the desktop probed that server for /v1/messages
  // (the bridge then forwards it); a server that does not answer keeps it greyed.
  if (driverKind === "claudeAgent") return kind === "loopback" || speaksAnthropic === true ? null : "anthropic";
  return "engine";
}

/** A desktop bridge inject id: a desk host, then ::, then the model. */
export function isDesktopModelId(id: string | null | undefined): boolean {
  if (!id) return false;
  const sep = id.indexOf("::");
  return sep > 0 && /^desk[a-z0-9]{3,24}$/.test(id.slice(0, sep));
}

export interface LocalModelFacts {
  id: string;
  /** The server's display name (DwarfStar's `name`), when it has one. */
  name?: string;
}

/** Picker names for one local server's models: "Qwen3.8 Flash Next", the
 * model alone, never "Server: name" nor ":8000: name" (2026-10-26). Several
 * ids under one name stay apart by what tells them apart, not by the whole
 * id (2026-10-13: three rows read "DwarfStar: Qwen3.8 Flash Next (qwen3.8-f..."
 * once truncated). DwarfStar serves one model as `qwen3.8-flash-next`,
 * `-chat` and `-reasoner`: the shortest id keeps the name, the others add
 * their own end ("Chat", "Reasoner"). Ids that do not share a stem keep the
 * id in parentheses. The server is a separate hint, only when two servers of
 * one computer expose the same name (`withServerHints`). */
export function localModelLabels(rows: readonly LocalModelFacts[]): Map<string, string> {
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const name = row.name?.trim() || row.id;
    groups.set(name, [...(groups.get(name) ?? []), row.id]);
  }
  const out = new Map<string, string>();
  for (const row of rows) {
    const name = row.name?.trim() || row.id;
    const ids = groups.get(name) ?? [row.id];
    out.set(row.id, ids.length > 1 && name !== row.id ? `${name}${sharedNameSuffix(row.id, ids)}` : name);
  }
  return out;
}

/** Two servers of the same computer exposing the same model name: only then
 * does a row carry its server (the label given in Local models, else the
 * host) as a quiet sub-line. Rows whose name is unique carry none. */
export function withServerHints<T extends { label: string }>(rows: readonly (T & { serverLabel: string })[]): T[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.label, (counts.get(row.label) ?? 0) + 1);
  return rows.map(({ serverLabel, ...row }) => {
    const hint = serverLabel.trim();
    return ((counts.get(row.label) ?? 0) > 1 && hint ? { ...row, server: hint } : row) as unknown as T;
  });
}

/** What follows a shared name for one id of its group: nothing for the stem
 * every other id extends, " Chat" for `<stem>-chat`, else " (<id>)". */
function sharedNameSuffix(id: string, ids: readonly string[]): string {
  const stem = [...ids].sort((left, right) => left.length - right.length)[0]!;
  const extendsStem = (candidate: string) => candidate === stem || /^[-_.:/]/.test(candidate.slice(stem.length)) && candidate.startsWith(stem);
  if (!ids.every(extendsStem) || ids.filter((candidate) => candidate === stem).length > 1) return ` (${id})`;
  if (id === stem) return "";
  const words = id.slice(stem.length).split(/[-_.:/]+/).filter(Boolean);
  return ` ${words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")}`;
}
