// The problem log (2026-10-08, the Perspicax console's Overview and Logs):
// one row per failed, stalled or unstartable run, failed routine, and
// refused turn (no engine access), month by month under <data>/problems/,
// so "what went wrong today, and why" is answerable after a restart.
//
// Rows carry the bot, the thread, a reason code and the cause the person
// already reads in the thread (redacted by the caller, at most 300
// characters); never a message text, an instruction or a credential.
// Same discipline as the usage ledger: 0600 files, serialized appends,
// fire-and-forget, a torn line is skipped.
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";

import { pruneMonthFiles } from "../decision-log.ts";
import { monthKey } from "../usage/usage-ledger.ts";
import type { ConsoleLocale } from "./org-admin-console.ts";

export type ProblemKind = "failed" | "stalled" | "could-not-start" | "routine-failed" | "refused";
export const PROBLEM_KINDS: readonly ProblemKind[] = ["failed", "stalled", "could-not-start", "routine-failed", "refused"];
/** The kinds the console's Incidents tab lists (a refusal is not one). */
export const INCIDENT_KINDS: readonly ProblemKind[] = ["failed", "stalled", "could-not-start", "routine-failed"];

export interface ProblemRow {
  id: string;
  at: number;
  kind: ProblemKind;
  /** A reason code (problemReason): what the label says. */
  reason: string;
  botId: string;
  botName: string;
  ownerPrincipalId: string | null;
  threadId: string | null;
  title: string | null;
  /** The engine instance, when the run named one. */
  engine: string | null;
  /** The routine of a routine failure, and whom it ran as. */
  routineId?: string;
  runAsPrincipalId?: string;
  /** The cause the person reads in the thread, redacted, at most 300. */
  detail: string;
}

const DIR = "problems";
const MONTH_FILE = /^(\d{4})-(\d{2})\.ndjson$/;
export const PROBLEM_DETAIL_MAX = 300;
export const PROBLEM_RETENTION_DAYS = 180;
const writeQueues = new Map<string, Promise<void>>();

/** The reason codes and their readable words, English and French. */
const LABELS: Record<string, { en: string; fr: string }> = {
  no_access: { en: "No engine access for this person (no subscription, no key, no organization key)", fr: "Aucun accès au moteur pour cette personne (ni abonnement, ni clé, ni clé de l'organisation)" },
  payer_disabled: { en: "The account that pays for this engine is disabled", fr: "Le compte qui paie ce moteur est désactivé" },
  server_engine_not_allowed: { en: "The organization has not given this person this engine on its account", fr: "L'organisation n'a pas donné ce moteur à cette personne sur son compte" },
  routine_delegation: { en: "The routine is paused: its person is out or lacks the run right", fr: "La routine est en pause : sa personne est partie ou n'a pas le droit d'exécution" },
  key_refused: { en: "The provider refused the key", fr: "Le fournisseur a refusé la clé" },
  engine_missing: { en: "The engine is not installed on this server", fr: "Le moteur n'est pas installé sur ce serveur" },
  auth: { en: "The engine is not signed in, or its sign-in expired", fr: "Le moteur n'est pas connecté, ou sa connexion a expiré" },
  rate_limited: { en: "The provider is rate limiting", fr: "Le fournisseur limite le débit" },
  quota: { en: "The provider's quota or credit ran out", fr: "Le quota ou le crédit du fournisseur est épuisé" },
  provider_unavailable: { en: "The provider is overloaded or unavailable", fr: "Le fournisseur est surchargé ou indisponible" },
  timeout: { en: "The engine timed out", fr: "Le moteur a dépassé le délai" },
  network: { en: "A network error reached the provider", fr: "Une erreur réseau vers le fournisseur" },
  context_too_long: { en: "The conversation is too long for the model", fr: "La conversation est trop longue pour le modèle" },
  interrupted: { en: "The run was interrupted", fr: "L'exécution a été interrompue" },
  stalled: { en: "The run showed no activity and was stopped", fr: "L'exécution ne montrait plus d'activité et a été arrêtée" },
  could_not_start: { en: "The run could not start", fr: "L'exécution n'a pas pu démarrer" },
  routine_failed: { en: "The routine run failed", fr: "L'exécution de la routine a échoué" },
  failed: { en: "The run ended without a result", fr: "L'exécution s'est terminée sans résultat" },
};

/** The readable words of a reason code, in the console's language. */
export function reasonLabel(reason: string, locale: ConsoleLocale = "en"): string {
  const entry = LABELS[reason] ?? LABELS.failed!;
  return entry[locale];
}

/** A reason code from the kind and the cause text. A refusal passes its own
 * reason (engine-access.ts) as `refusal`. */
export function problemReason(kind: ProblemKind, detail: string, refusal?: string): string {
  if (kind === "refused") return refusal && LABELS[refusal] ? refusal : "no_access";
  if (kind === "stalled") return "stalled";
  const text = detail.toLowerCase();
  if (/rate.?limit|\b429\b|too many requests/.test(text)) return "rate_limited";
  if (/quota|insufficient.?(credit|balance|funds)|credit balance|billing/.test(text)) return "quota";
  if (/unauthori[sz]ed|\b401\b|invalid.{0,12}(api )?key|authenticat|not (logged|signed) in|log ?in again|sign ?in again|expired token|token expired/.test(text)) return "auth";
  if (/overloaded|\b529\b|\b503\b|service unavailable|temporarily unavailable/.test(text)) return "provider_unavailable";
  if (/not installed|enoent|command not found|not on this server's path|no such file/.test(text)) return "engine_missing";
  if (/timed? ?out|timeout|deadline exceeded/.test(text)) return "timeout";
  if (/econn|enotfound|eai_again|socket hang up|fetch failed|network/.test(text)) return "network";
  if (/context (length|window)|too long|maximum context|prompt is too long/.test(text)) return "context_too_long";
  if (/interrupted|cancell?ed|aborted/.test(text)) return "interrupted";
  if (kind === "could-not-start") return "could_not_start";
  if (kind === "routine-failed") return "routine_failed";
  return "failed";
}

export function problemFileFor(dataDir: string, at: Date): string {
  return join(dataDir, DIR, `${monthKey(at)}.ndjson`);
}

/** Append one problem. Never throws; the promise says whether it landed. */
export function appendProblem(dataDir: string, input: Omit<ProblemRow, "id" | "at" | "reason" | "detail"> & { at?: number; detail: string; reason?: string }): Promise<boolean> {
  const detail = input.detail.replace(/\s+/g, " ").trim();
  const row: ProblemRow = {
    ...input,
    id: randomUUID(),
    at: input.at ?? Date.now(),
    reason: input.reason ?? problemReason(input.kind, detail),
    detail: detail.length > PROBLEM_DETAIL_MAX ? `${detail.slice(0, PROBLEM_DETAIL_MAX - 3)}...` : detail,
  };
  const previous = writeQueues.get(dataDir) ?? Promise.resolve();
  const attempt = previous.then(async () => {
    await mkdir(join(dataDir, DIR), { recursive: true, mode: 0o700 });
    await appendFile(problemFileFor(dataDir, new Date(row.at)), JSON.stringify(row) + "\n", { mode: 0o600 });
  });
  const queued = attempt.then(() => undefined, () => undefined);
  writeQueues.set(dataDir, queued);
  void queued.finally(() => {
    if (writeQueues.get(dataDir) === queued) writeQueues.delete(dataDir);
  });
  return attempt.then(() => true, () => false);
}

export async function flushProblemLog(dataDir: string): Promise<void> {
  await writeQueues.get(dataDir);
}

export function pruneProblemLog(dataDir: string, days = PROBLEM_RETENTION_DAYS, now = new Date()): Promise<string[]> {
  return pruneMonthFiles(join(dataDir, DIR), days, now);
}

const isRow = (value: unknown): value is ProblemRow => {
  const row = value as ProblemRow;
  return typeof value === "object" && value !== null && typeof row.id === "string" && typeof row.at === "number"
    && (PROBLEM_KINDS as readonly string[]).includes(row.kind) && typeof row.botId === "string" && typeof row.reason === "string";
};

/** Rows at or after `from` (ms), newest first, at most `max`. */
export function readProblems(dataDir: string, input: { from?: number; max?: number } = {}): ProblemRow[] {
  const from = input.from ?? Number.NEGATIVE_INFINITY;
  const max = input.max ?? 50_000;
  let months: string[];
  try {
    months = readdirSync(join(dataDir, DIR)).filter((name) => MONTH_FILE.test(name)).map((name) => basename(name, ".ndjson")).sort().reverse();
  } catch {
    return [];
  }
  const fromMonth = Number.isFinite(from) ? monthKey(new Date(from)) : "";
  const rows: ProblemRow[] = [];
  for (const month of months) {
    if (month < fromMonth) break;
    let text: string;
    try {
      text = readFileSync(join(dataDir, DIR, `${month}.ndjson`), "utf8");
    } catch {
      continue;
    }
    const lines = text.split("\n");
    for (let index = lines.length - 1; index >= 0; index--) {
      const line = lines[index];
      if (!line) continue;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isRow(value) || value.at < from) continue;
      rows.push(value);
      if (rows.length >= max) return rows.sort((a, b) => b.at - a.at);
    }
  }
  return rows.sort((a, b) => b.at - a.at);
}
