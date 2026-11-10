// #3457 (lot 6 of #3408, design 3.8): the two exits on every alert a chosen
// Pulsatrix watch sends, under its run card in the chat. « Arrêter cette
// veille » switches off the watches this alert reported; « Arrêter ce
// domaine » turns their domain off. Both act at once, with no confirmation,
// and write the person's choice through PUT /api/me/proactive (via
// "alert"), so the watch loop stops reading too. One quiet line then says
// what stopped, by its label (never an id).
import { useState } from "react";
import { activeLocale, t } from "@/lib/i18n";
import { api } from "@/state/store";
import { PROACTIVE_CHOICES_PATH, type ChoiceChange } from "../../shared/proactive-choices";
import type { RoutineRunCardData } from "../../shared/routine-run";

export type WatchAlertExit = "watch" | "domain";
type AlertWatch = NonNullable<RoutineRunCardData["watches"]>[number];

/** The watches an alert run reported, when it is a watch alert. */
export function watchAlertOf(run: Pick<RoutineRunCardData, "wakeTopic" | "watches"> | undefined): readonly AlertWatch[] | undefined {
  return run?.wakeTopic === "watch" && run.watches?.length ? run.watches : undefined;
}

/** The bodies of PUT /api/me/proactive one exit sends: each reported watch
 * off, or each of their domains off (once). */
export function watchAlertChanges(watches: readonly AlertWatch[], exit: WatchAlertExit): ChoiceChange[] {
  if (exit === "watch") {
    return watches.map((watch) => ({ domain: watch.domain, watch: watch.id, on: false, via: "alert" as const }));
  }
  return [...new Set(watches.map((watch) => watch.domain))].map((domain) => ({ domain, state: "off" as const, via: "alert" as const }));
}

interface ListedDomain {
  domain: string;
  label?: { fr?: string; en?: string };
  watches?: Array<{ id: string; summary?: string }>;
}

/** What stopped, in words: the watches' own lines or the domains' labels,
 * from the person's listing; "" when the listing does not name them. */
export function watchAlertStoppedLabel(watches: readonly AlertWatch[], exit: WatchAlertExit, listed: readonly ListedDomain[], language: string): string {
  const fr = language.toLowerCase().startsWith("fr");
  const named = exit === "watch"
    ? watches.map((watch) => listed.find((row) => row.domain === watch.domain)?.watches?.find((entry) => entry.id === watch.id)?.summary?.trim())
    : [...new Set(watches.map((watch) => watch.domain))].map((domain) => {
      const label = listed.find((row) => row.domain === domain)?.label;
      return (fr ? label?.fr ?? label?.en : label?.en ?? label?.fr)?.trim();
    });
  return named.every(Boolean) ? [...new Set(named as string[])].join(", ") : "";
}

function stoppedLine(exit: WatchAlertExit, label: string): string {
  if (exit === "watch") return label ? t("watchAlert.stopped.watch", { label }) : t("watchAlert.stopped.watchUnnamed");
  return label ? t("watchAlert.stopped.domain", { label }) : t("watchAlert.stopped.domainUnnamed");
}

export function WatchAlertExits({ watches }: { watches: readonly AlertWatch[] }) {
  const [stopped, setStopped] = useState<{ exit: WatchAlertExit; line: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!watches.length) return null;

  const stop = async (exit: WatchAlertExit) => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      for (const change of watchAlertChanges(watches, exit)) {
        await api(PROACTIVE_CHOICES_PATH, { method: "PUT", body: JSON.stringify(change) });
      }
    } catch {
      setFailed(true);
      setBusy(false);
      return;
    }
    // the words only: a listing that cannot be read leaves a plain line
    const listed = await api<{ available?: ListedDomain[] }>(PROACTIVE_CHOICES_PATH)
      .then((answer) => (Array.isArray(answer?.available) ? answer.available : []))
      .catch(() => []);
    setStopped({ exit, line: stoppedLine(exit, watchAlertStoppedLabel(watches, exit, listed, activeLocale())) });
    setBusy(false);
  };

  if (stopped) {
    return (
      <p role="status" data-watch-alert-stopped={stopped.exit} className="px-1 text-[12px] leading-4 text-ink-tertiary">
        {stopped.line}
      </p>
    );
  }
  const quiet = "rounded px-1.5 py-0.5 text-[12px] leading-4 text-ink-tertiary hover:bg-raised hover:text-ink disabled:opacity-55";
  return (
    <div data-watch-alert-exits="" className="flex flex-col gap-0.5">
      <div role="group" aria-label={t("watchAlert.label")} className="flex flex-wrap items-center gap-0.5">
        <button type="button" disabled={busy} onClick={() => void stop("watch")} className={quiet}>
          {t("watchAlert.stopWatch")}
        </button>
        <button type="button" disabled={busy} onClick={() => void stop("domain")} className={quiet}>
          {t("watchAlert.stopDomain")}
        </button>
      </div>
      {failed && <p role="alert" className="px-1 text-[12px] leading-4 text-danger">{t("suggestionFeedback.failed")}</p>}
    </div>
  );
}
