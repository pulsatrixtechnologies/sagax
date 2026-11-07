// "Tester cette règle" (2026-10-26): a rule, saved or a draft not saved yet,
// replayed on the last 7 days of the person's Journal by the server's real
// matcher (POST /api/approvals/journal/test). Nothing is saved: the result
// says what the rule would have allowed, held or refused, and which actions
// it would change. Used in the Journal tab and in the rule editor.
import { FlaskConical, Loader2 } from "lucide-react";
import { useState } from "react";

import { RULE_TEST_DAYS, type RuleTestDraft, type RuleTestResult } from "../../../shared/action-journal";
import type { CustomRuleBehavior } from "../../../shared/custom-rules";
import { EFFECT_LABEL, journalTitle, OUTCOME_LABEL, testRule } from "@/lib/action-journal";
import { withoutIds } from "@/lib/approvals-inbox";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { readableErrorMessage } from "@/lib/readable-error";
import type { LocaleKey } from "@/locales";
import { PILL } from "../SettingsPrimitives";

// the rule editor's own words (CustomRulesCard CUSTOM_BEHAVIOR_LABEL), kept
// here so the editor can import this file without a cycle
const CUSTOM_BEHAVIOR_LABEL: Record<CustomRuleBehavior, LocaleKey> = {
  allow: "customRules.behavior.allow",
  ask: "customRules.behavior.ask",
  deny: "customRules.behavior.deny",
};

/** `plain`: inside a bot profile card (#2313), the hits on the card's own
 * fill, no outline and no bold. */
export function RuleTestResults({ result, plain = false }: { result: RuleTestResult; plain?: boolean }) {
  if (result.unreadable) return <p role="note" className="text-[12px] text-ink-secondary" data-rule-test-unreadable="">{t("approvals.journal.test.unreadable")}</p>;
  return (
    <div className="flex flex-col gap-2" data-rule-test-result="">
      <p className="text-[12.5px] text-ink">
        {result.matched === 0
          ? t("approvals.journal.test.none", { scanned: result.scanned, days: result.days })
          : t("approvals.journal.test.summary", { matched: result.matched, scanned: result.scanned, days: result.days, changed: result.counts.changed })}
      </p>
      {result.matched > 0 && (
        <div className="flex flex-wrap gap-1.5 text-[11.5px]">
          {result.counts.allowed > 0 && <span className="rounded-full bg-success/12 px-2 py-0.5 text-success">{t("approvals.journal.test.count.allowed", { n: result.counts.allowed })}</span>}
          {result.counts.asked > 0 && <span className="rounded-full bg-warning/12 px-2 py-0.5 text-warning">{t("approvals.journal.test.count.asked", { n: result.counts.asked })}</span>}
          {result.counts.denied > 0 && <span className="rounded-full bg-danger/12 px-2 py-0.5 text-danger">{t("approvals.journal.test.count.denied", { n: result.counts.denied })}</span>}
          {result.counts.cardStays > 0 && <span className="rounded-full bg-control px-2 py-0.5 text-ink-secondary">{t("approvals.journal.test.count.cardStays", { n: result.counts.cardStays })}</span>}
        </div>
      )}
      {result.hits.length > 0 && (
        <ol className={plain ? "flex flex-col overflow-hidden rounded-lg bg-inset" : "divide-y divide-hairline/30 overflow-hidden rounded-xl border border-hairline/40 bg-card"}>
          {result.hits.map((hit) => {
            const at = new Date(hit.at);
            return (
              <li key={hit.key} className="flex items-start gap-3 px-3 py-2" data-rule-test-hit={hit.would} {...(hit.changed ? { "data-rule-test-changed": "" } : {})}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-ink">{journalTitle(hit)}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-ink-secondary">
                    <span className={plain ? "text-ink" : "font-medium"}>{withoutIds(hit.botName)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{t("approvals.journal.test.actual", { outcome: t(OUTCOME_LABEL[hit.actual]) })}</span>
                    {hit.approximate && <span className="text-ink-tertiary" title={t("approvals.journal.test.approximateHint")}>{t("approvals.journal.test.approximate")}</span>}
                  </div>
                  {hit.summary && <div className="mt-0.5 truncate font-mono text-[11px] text-ink-tertiary">{withoutIds(hit.summary)}</div>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px]", !plain && "font-medium",
                    hit.would === "allowed" ? "bg-success/12 text-success" : hit.would === "denied" ? "bg-danger/12 text-danger" : hit.would === "asked" ? "bg-warning/12 text-warning" : "bg-control text-ink-secondary")}>
                    {t(EFFECT_LABEL[hit.would])}
                  </span>
                  {hit.changed && <span className={cn("text-[11px] text-accent", !plain && "font-medium")}>{t("approvals.journal.test.changed")}</span>}
                  <time dateTime={at.toISOString()} className="text-[11px] tabular-nums text-ink-tertiary">
                    {at.toLocaleDateString(activeLocale(), { day: "numeric", month: "short" })} {at.toLocaleTimeString(activeLocale(), { hour: "2-digit", minute: "2-digit" })}
                  </time>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/** The button and its result, for a draft the caller builds. */
export function RuleTestButton({ draft, disabled = false, plain = false }: { draft: () => RuleTestDraft | null; disabled?: boolean; /** A bot profile card: a pill, no outline. */ plain?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RuleTestResult | null>(null);
  const [error, setError] = useState("");
  const run = async () => {
    const rule = draft();
    if (!rule || busy) return;
    setBusy(true);
    setError("");
    try {
      setResult(await testRule(rule));
    } catch (cause) {
      setResult(null);
      setError(readableErrorMessage(cause, t("approvals.journal.error")));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2" data-rule-test="">
      <div>
        <button type="button" onClick={() => void run()} disabled={disabled || busy} className={plain ? PILL : "inline-flex items-center gap-1.5 rounded-full border border-hairline/50 px-3 py-1 text-[12.5px] text-ink hover:bg-control disabled:opacity-40"} data-rule-test-run="">
          {busy ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <FlaskConical size={13} aria-hidden="true" />}
          {t("approvals.journal.test.run", { days: RULE_TEST_DAYS })}
        </button>
      </div>
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      {result && <RuleTestResults result={result} plain={plain} />}
    </div>
  );
}

/** The Journal's own rule test: a phrase, a behavior, a bot or all of them. */
export function RuleTestPanel({ bots, initialResult }: { bots: ReadonlyArray<{ id: string; name: string }>; initialResult?: RuleTestResult }) {
  const [when, setWhen] = useState("");
  const [behavior, setBehavior] = useState<CustomRuleBehavior>("deny");
  const [botId, setBotId] = useState<string>("");
  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-hairline/40 bg-card px-4 py-3" data-rule-test-panel="" aria-label={t("approvals.journal.test.title")}>
      <div className="text-[13.5px] font-medium text-ink">{t("approvals.journal.test.title")}</div>
      <p className="text-[12px] text-ink-secondary">{t("approvals.journal.test.help", { days: RULE_TEST_DAYS })}</p>
      <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">
        {t("approvals.journal.test.when")}
        <textarea
          value={when}
          maxLength={500}
          rows={2}
          placeholder={t("customRules.form.placeholder")}
          onChange={(event) => setWhen(event.target.value)}
          className="rounded-md bg-inset px-2 py-1.5 text-[13px] text-ink outline-none focus:ring-1 focus:ring-accent"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-ink-secondary">
        <label className="flex items-center gap-2">
          {t("customRules.form.should")}
          <select value={behavior} onChange={(event) => setBehavior(event.target.value as CustomRuleBehavior)} className="rounded-md bg-inset px-2 py-1 text-[13px] text-ink">
            {(["allow", "ask", "deny"] as const).map((value) => <option key={value} value={value}>{t(CUSTOM_BEHAVIOR_LABEL[value])}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">
          {t("customRules.form.appliesTo")}
          <select value={botId} onChange={(event) => setBotId(event.target.value)} className="rounded-md bg-inset px-2 py-1 text-[13px] text-ink">
            <option value="">{t("customRules.form.allBots")}</option>
            {bots.map((bot) => <option key={bot.id} value={bot.id}>{withoutIds(bot.name)}</option>)}
          </select>
        </label>
      </div>
      <RuleTestButton disabled={!when.trim()} draft={() => (when.trim() ? { when: when.trim(), behavior, botId: botId || null, riskScope: [] } : null)} />
      {initialResult && <RuleTestResults result={initialResult} />}
    </section>
  );
}
