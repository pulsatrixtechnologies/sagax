// Custom rules (2026-10-16): the person's own approval rules in plain words,
// like Grok Bot's "Règles personnalisées": "Quand <bot> veut :" a short
// phrase, "Il devrait :" Autoriser automatiquement, Demander d'abord or
// Refuser. Refuser wins over Demander d'abord, which wins over Autoriser.
// An allow covers a risky action (a deletion, something irreversible, money,
// an external send) only when the person ticks that kind here.
//
// The server keeps the rules to the person (GET/POST/PATCH/DELETE
// /api/custom-rules, server/routes/custom-rules.ts). The text is compiled on
// both sides by shared/custom-rules.ts: the editor warns when the words name
// nothing the reviewer can test, since such a rule allows nothing.
//
// 2026-10-21 (Grok Bot parity lot 1A): the organization's rules come first,
// marked "Exigé par votre administrateur", with no way to change them; while
// the organization turned Always allow off, allow rules show as paused and
// none can be added. At Full access a note says allow rules change nothing.
// A rule may be saved for a chosen set of the person's bots (one rule per
// bot), and an edit shows what changes in its words.
import { useCallback, useEffect, useRef, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { noteOrgAlwaysAllowOff } from "@/lib/org-approval-policy";
import { api, ApiError, useStore, type Bot } from "@/state/store";
import { compileRule, impliedRiskScope, RISK_CLASSES, type CompiledRule, type CustomRule, type CustomRuleBehavior, type RiskClass } from "../../../shared/custom-rules";
import { OrgRuleBadge, RISK_LABEL, RuleTextDiff, riskList } from "../CustomRuleNotice";
import { PaneEmpty, PaneSection } from "./PaneSection";

export type CustomRuleRow = CustomRule & { compiled?: { recognized: boolean } };

export const CUSTOM_BEHAVIOR_LABEL: Record<CustomRuleBehavior, LocaleKey> = {
  allow: "customRules.behavior.allow",
  ask: "customRules.behavior.ask",
  deny: "customRules.behavior.deny",
};

export interface CustomRuleDraft {
  when: string;
  behavior: CustomRuleBehavior;
  allBots: boolean;
  riskScope: RiskClass[];
  /** "Les bots que je choisis": one rule per bot listed (never empty). */
  botIds?: string[];
}

/** The risk classes an allow rule's words name (envoi externe, paiement,
 * suppression) that its ticked scope does not yet cover. The editor refuses
 * to save an allow rule while this is non-empty: without the tick, the engine
 * (fail-closed) authorizes nothing of that kind, so the rule the person
 * thinks is broad would silently cover nothing. Empty for a non-allow rule or
 * one that names no risky action (reading a folder stays empty, as it should). */
export function missingImpliedRisks(behavior: CustomRuleBehavior, compiled: CompiledRule | null, riskScope: readonly RiskClass[]): RiskClass[] {
  if (behavior !== "allow" || !compiled) return [];
  return impliedRiskScope(compiled).filter((risk) => !riskScope.includes(risk));
}

/** The rules one bot meets, organization's first: theirs win. */
function orgFirst(rules: readonly CustomRuleRow[]): CustomRuleRow[] {
  return [...rules.filter((rule) => rule.org), ...rules.filter((rule) => !rule.org)];
}

/** The rules one bot meets: its own first, then those for all bots. */
export function customRulesForBot(rules: readonly CustomRuleRow[], botId: string): CustomRuleRow[] {
  return orgFirst(rules
    .filter((rule) => rule.botId === botId || rule.botId === null)
    .sort((a, b) => Number(a.botId === null) - Number(b.botId === null) || a.createdAt - b.createdAt));
}

export function customRuleError(failure: unknown): string {
  if (failure instanceof ApiError && failure.body?.code === "org_always_allow_off") {
    noteOrgAlwaysAllowOff();
    return t("customRules.org.alwaysAllowOff");
  }
  if (failure instanceof ApiError && failure.body?.code === "org_rule_locked") return t("customRules.org.locked");
  if (failure instanceof ApiError && failure.body?.code === "rule_not_covering") return t("customRules.notCovering");
  if (failure instanceof ApiError && failure.body?.code === "shell_family_allow") return t("customRules.shellFamily");
  if (failure instanceof ApiError && failure.body?.code === "exact_command_from_card") return t("customRules.exactFromCard");
  if (failure instanceof ApiError && failure.body?.code === "exact_command_no_cwd") return t("customRules.exactNoCwd");
  if (failure instanceof ApiError && failure.body?.code === "exact_command_one_bot") return t("customRules.exactOneBot");
  return t("customRules.error", { error: failure instanceof Error ? failure.message : String(failure) });
}

/** The editor of one rule. `risks` are the kinds the person must tick for
 * the rule to cover a given card (from "Toujours permettre ceci"). */
export function CustomRuleForm({ botName, initial, risks, saveLabel, onCancel, onSave, busy = false, fromCard = false, bots, botId, allowOff = false }: {
  botName: string;
  /** The person's bots a rule may be saved for ("Les bots que je choisis"),
   * and the bot this editor is for (chosen first). */
  bots?: ReadonlyArray<{ id: string; name: string }>;
  botId?: string;
  /** The organization turned Always allow off: no allow rule. */
  allowOff?: boolean;
  initial: CustomRuleDraft;
  risks?: readonly RiskClass[];
  saveLabel?: string;
  onCancel: () => void;
  onSave: (draft: CustomRuleDraft) => void;
  busy?: boolean;
  /** Made from an approval card ("Toujours permettre ceci"): an exact
   * command may be allowed, bound to that card. */
  fromCard?: boolean;
}) {
  const [when, setWhen] = useState(initial.when);
  const [behavior, setBehavior] = useState<CustomRuleBehavior>(allowOff && initial.behavior === "allow" ? "ask" : initial.behavior);
  const [allBots, setAllBots] = useState(initial.allBots);
  const [chosen, setChosen] = useState<string[] | null>(initial.botIds?.length ? initial.botIds : null);
  const [riskScope, setRiskScope] = useState<RiskClass[]>(initial.riskScope);
  const compiled = when.trim() ? compileRule(when) : null;
  const recognized = compiled ? compiled.recognized : true;
  const shellFamily = behavior === "allow" && compiled?.shellFamily === true;
  const exactOutsideCard = behavior === "allow" && !fromCard && (compiled?.commands.length ?? 0) > 0;
  const exact = (compiled?.commands.length ?? 0) > 0;
  // the risk classes the rule's words name: the editor sets them for the
  // person (auto-tick), so a rule for "envoyer un courriel" carries
  // external-send instead of a scope that covers nothing
  const implied = behavior === "allow" && compiled ? impliedRiskScope(compiled) : [];
  // each implied class is offered (ticked) once, the first time the words
  // name it; the person may then untick it, which the save guard catches
  const offered = useRef<Set<RiskClass>>(new Set(initial.riskScope));
  useEffect(() => {
    if (behavior !== "allow") return;
    const fresh = implied.filter((risk) => !offered.current.has(risk));
    if (!fresh.length) return;
    for (const risk of fresh) offered.current.add(risk);
    setRiskScope((current) => [...current, ...fresh.filter((risk) => !current.includes(risk))]);
  }, [behavior, implied.join(",")]);
  // an allow rule that names a risky action but leaves its class unticked
  // would authorize nothing of that kind: the person must tick it
  const missingRisks = missingImpliedRisks(behavior, compiled, riskScope);
  // choosing bots: for a new rule, among two bots or more, never an exact
  // command (bound to the bot that asked it)
  const canChoose = !initial.when && !fromCard && !exact && Boolean(bots && bots.length > 1 && botId);
  const choosing = canChoose && chosen !== null;
  const blocked = shellFamily || exactOutsideCard || (choosing && !chosen!.length) || (allowOff && behavior === "allow") || missingRisks.length > 0;
  const shownRisks = risks?.length || implied.length
    ? RISK_CLASSES.filter((risk) => risks?.includes(risk) || implied.includes(risk) || riskScope.includes(risk))
    : RISK_CLASSES;
  return (
    <form
      className="flex flex-col gap-2 rounded-lg bg-inset px-3 py-2.5"
      data-custom-rule-form
      onSubmit={(event) => {
        event.preventDefault();
        if (!when.trim() || busy || blocked) return;
        onSave({ when: when.trim(), behavior, allBots: choosing ? false : allBots, riskScope: behavior === "allow" ? riskScope : [], ...(choosing ? { botIds: chosen! } : {}) });
      }}
    >
      <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">
        {t("customRules.form.when", { name: botName })}
        <textarea
          value={when}
          maxLength={500}
          rows={2}
          autoFocus
          placeholder={t("customRules.form.placeholder")}
          onChange={(event) => setWhen(event.target.value)}
          className="rounded-md bg-raised px-2 py-1.5 text-[13px] text-ink outline-none focus:ring-1 focus:ring-accent"
        />
      </label>
      {initial.when && <RuleTextDiff before={initial.when} after={when} />}
      {!recognized && <p role="note" className="text-[12px] text-ink-secondary" data-custom-rule-unrecognized>{t("customRules.unrecognized")}</p>}
      {shellFamily && <p role="alert" className="text-[12px] text-danger" data-custom-rule-shell-family>{t("customRules.shellFamily")}</p>}
      {exactOutsideCard && <p role="alert" className="text-[12px] text-danger" data-custom-rule-exact-card>{t("customRules.exactFromCard")}</p>}
      <label className="flex items-center justify-between gap-3 text-[12.5px] text-ink-secondary">
        {t("customRules.form.should")}
        <select
          value={behavior}
          onChange={(event) => setBehavior(event.target.value as CustomRuleBehavior)}
          className="rounded-md bg-raised px-2 py-1 text-[13px] text-ink"
        >
          {(["allow", "ask", "deny"] as const).filter((value) => !allowOff || value !== "allow").map((value) => <option key={value} value={value}>{t(CUSTOM_BEHAVIOR_LABEL[value])}</option>)}
        </select>
      </label>
      <label className="flex items-center justify-between gap-3 text-[12.5px] text-ink-secondary">
        {t("customRules.form.appliesTo")}
        <select
          value={choosing ? "some" : allBots ? "all" : "this"}
          onChange={(event) => {
            const value = event.target.value;
            setAllBots(value === "all");
            setChosen(value === "some" && botId ? [botId] : null);
          }}
          className="rounded-md bg-raised px-2 py-1 text-[13px] text-ink"
        >
          <option value="this">{t("customRules.form.thisBot")}</option>
          <option value="all">{t("customRules.form.allBots")}</option>
          {canChoose && <option value="some">{t("customRules.form.someBots")}</option>}
        </select>
      </label>
      {choosing && bots && (
        <fieldset className="flex flex-col gap-1 text-[12.5px] text-ink-secondary" data-custom-rule-bots>
          <legend className="mb-0.5">{t("customRules.form.chooseBots")}</legend>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {bots.map((each) => (
              <label key={each.id} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={chosen!.includes(each.id)}
                  onChange={(event) => setChosen((current) => {
                    const list = current ?? [];
                    return event.target.checked ? [...list, each.id] : list.filter((id) => id !== each.id);
                  })}
                />
                <span className="text-ink">{each.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {behavior === "allow" && (
        <fieldset className="flex flex-col gap-1 text-[12.5px] text-ink-secondary" data-custom-rule-risks>
          <legend className="mb-0.5">{t("customRules.form.riskTitle")}</legend>
          {shownRisks.map((risk) => (
            <label key={risk} className="flex items-center gap-2" {...(implied.includes(risk) ? { "data-custom-rule-implied": risk } : {})}>
              <input
                type="checkbox"
                checked={riskScope.includes(risk)}
                onChange={(event) => setRiskScope((current) => event.target.checked ? [...current, risk] : current.filter((value) => value !== risk))}
              />
              <span className={cn(riskScope.includes(risk) && "text-warning")}>{t(RISK_LABEL[risk])}</span>
            </label>
          ))}
          {missingRisks.length > 0
            ? <p role="alert" className="text-[11.5px] text-danger" data-custom-rule-risk-missing>{t("customRules.form.riskMissing", { kinds: riskList(missingRisks) })}</p>
            : <p className="text-[11.5px] text-ink-tertiary">{t("customRules.form.riskHint")}</p>}
        </fieldset>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-full px-3 py-1 text-[13px] text-ink-secondary hover:bg-control">
          {t("customRules.form.cancel")}
        </button>
        <button
          type="submit"
          disabled={!when.trim() || busy || blocked}
          className="rounded-full bg-accent px-3 py-1 text-[13px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-40"
        >
          {saveLabel ?? t("customRules.form.save")}
        </button>
      </div>
    </form>
  );
}

export function CustomRulesCard({ bot }: { bot: Pick<Bot, "id" | "name"> & Partial<Pick<Bot, "approvalMode" | "ownerUserId">> }) {
  const { state } = useStore();
  const [rules, setRules] = useState<CustomRuleRow[] | null>(null);
  const [alwaysAllow, setAlwaysAllow] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // the person's bots a new rule may be saved for: this bot's owner's (on
  // a solo server no bot names one); the server keeps each to their own
  const ownBots = state.bots
    .filter((each) => each.id === bot.id || each.ownerUserId === bot.ownerUserId)
    .map((each) => ({ id: each.id, name: each.name }));

  const load = useCallback(() => api<{ rules: CustomRuleRow[]; orgPolicy?: { alwaysAllow?: boolean } }>(`/api/custom-rules?botId=${encodeURIComponent(bot.id)}`)
    .then((body) => {
      setAlwaysAllow(body.orgPolicy?.alwaysAllow !== false);
      setRules(customRulesForBot(body.rules ?? [], bot.id));
    })
    .catch(() => setRules(null)), [bot.id]);

  useEffect(() => {
    setEditing(null);
    void load();
  }, [load]);

  const fail = (failure: unknown) => setError(customRuleError(failure));

  const create = (draft: CustomRuleDraft) => {
    setError(null);
    // one rule per chosen bot (the server keeps a rule to one bot or all)
    const targets: Array<string | null> = draft.botIds?.length ? draft.botIds : [draft.allBots ? null : bot.id];
    void targets.reduce<Promise<unknown>>((chain, botId) => chain.then(() => api(`/api/custom-rules`, {
      method: "POST",
      body: JSON.stringify({ when: draft.when, behavior: draft.behavior, botId, riskScope: draft.riskScope }),
    })), Promise.resolve()).then(() => {
      setEditing(null);
      return load();
    }).catch((failure: unknown) => {
      fail(failure);
      // some bots may have their rule already
      void load();
    });
  };

  const update = (rule: CustomRuleRow, patch: Record<string, unknown>) => {
    setError(null);
    void api(`/api/custom-rules/${rule.id}`, { method: "PATCH", body: JSON.stringify(patch) })
      .then(() => {
        setEditing(null);
        return load();
      })
      .catch(fail);
  };

  const remove = (rule: CustomRuleRow) => {
    setError(null);
    void api(`/api/custom-rules/${rule.id}`, { method: "DELETE" }).then(() => load()).catch(fail);
  };

  // the server answers only a signed-in person: nothing to show otherwise
  if (rules === null) return null;
  const hasAllow = rules.some((rule) => !rule.org && rule.behavior === "allow" && rule.enabled);

  return (
    <PaneSection title={t("customRules.title")} help={t("customRules.help")} data-custom-rules={String(rules.length)}>
      {!alwaysAllow && <p role="note" className="mb-2 rounded-lg bg-inset px-3 py-2 text-[12.5px] text-ink-secondary" data-org-always-allow-off="">{t("customRules.org.alwaysAllowOff")}</p>}
      {alwaysAllow && hasAllow && bot.approvalMode === "full" && <p role="note" className="mb-2 rounded-lg bg-inset px-3 py-2 text-[12.5px] text-ink-secondary" data-custom-rules-level="full">{t("customRules.levelFull")}</p>}
      <p className="mb-2 text-[12px] text-ink-tertiary" data-custom-rules-reviewer="">{t("customRules.reviewerHelp")}</p>
      {rules.length === 0 && editing !== "new" && <PaneEmpty>{t("customRules.empty")}</PaneEmpty>}
      {rules.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-hairline/40">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 border-b border-hairline/40 bg-inset px-3 py-1.5 text-[12px] font-medium text-ink-secondary">
            <span>{t("customRules.form.when", { name: bot.name })}</span>
            <span>{t("customRules.form.should")}</span>
            <span className="sr-only">{t("customRules.edit")}</span>
          </div>
          <div className="divide-y divide-hairline/40">
            {rules.map((rule) => (
              <div key={rule.id} className="px-3 py-2" data-custom-rule-row={rule.behavior} {...(rule.org ? { "data-org-rule-row": "" } : {})}>
                {rule.org ? (
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3" title={t("customRules.org.locked")}>
                    <div className="min-w-0">
                      <span className="break-words text-[13px] text-ink">{rule.when}</span>
                      <div className="mt-0.5 flex flex-wrap gap-1.5 text-[11.5px]">
                        <OrgRuleBadge />
                        {rule.compiled && !rule.compiled.recognized && <span className="text-ink-secondary" data-custom-rule-model="">{t("customRules.unrecognizedShort")}</span>}
                      </div>
                    </div>
                    <span className={cn("whitespace-nowrap text-[12.5px]", rule.behavior === "deny" ? "text-danger" : "text-ink-secondary")}>
                      {t(CUSTOM_BEHAVIOR_LABEL[rule.behavior])}
                    </span>
                  </div>
                ) : editing === rule.id ? (
                  <CustomRuleForm
                    botName={bot.name}
                    initial={{ when: rule.when, behavior: rule.behavior, allBots: rule.botId === null, riskScope: rule.riskScope }}
                    allowOff={!alwaysAllow}
                    onCancel={() => setEditing(null)}
                    onSave={(draft) => update(rule, { when: draft.when, behavior: draft.behavior, botId: draft.allBots ? null : bot.id, riskScope: draft.riskScope })}
                  />
                ) : (
                  <div className={cn("grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-3", (!rule.enabled || (!alwaysAllow && rule.behavior === "allow")) && "opacity-60")}>
                    <div className="min-w-0">
                      <span className="break-words text-[13px] text-ink">{rule.when}</span>
                      <div className="mt-0.5 flex flex-wrap gap-1.5 text-[11.5px] text-ink-tertiary">
                        {rule.botId === null && <span>{t("customRules.form.allBots")}</span>}
                        {!alwaysAllow && rule.behavior === "allow" && <span className="text-warning" data-custom-rule-paused="">{t("customRules.paused")}</span>}
                        {rule.riskScope.length > 0 && <span className="text-warning">{t("customRules.mayCover", { kinds: riskList(rule.riskScope) })}</span>}
                        {rule.compiled && !rule.compiled.recognized && <span className="text-ink-secondary" data-custom-rule-model="">{t("customRules.unrecognizedShort")}</span>}
                      </div>
                    </div>
                    <span className={cn("whitespace-nowrap text-[12.5px]", rule.behavior === "deny" ? "text-danger" : rule.behavior === "allow" ? "text-success" : "text-ink-secondary")}>
                      {t(CUSTOM_BEHAVIOR_LABEL[rule.behavior])}
                    </span>
                    <div className="flex items-center gap-0.5">
                      <label className="flex items-center gap-1 px-1 text-[11.5px] text-ink-secondary" title={t("customRules.toggle")}>
                        <input
                          type="checkbox"
                          aria-label={t("customRules.toggle")}
                          checked={rule.enabled}
                          onChange={(event) => update(rule, { enabled: event.target.checked })}
                        />
                      </label>
                      <button
                        type="button"
                        aria-label={t("customRules.edit")}
                        title={t("customRules.edit")}
                        onClick={() => setEditing(rule.id)}
                        className="rounded-md p-1 text-ink-secondary hover:bg-control hover:text-ink"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label={t("customRules.remove")}
                        title={t("customRules.remove")}
                        onClick={() => remove(rule)}
                        className="rounded-md p-1 text-ink-secondary hover:bg-danger/10 hover:text-danger"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {editing === "new" ? (
        <div className="mt-2">
          <CustomRuleForm
            botName={bot.name}
            initial={{ when: "", behavior: alwaysAllow ? "allow" : "ask", allBots: false, riskScope: [] }}
            bots={ownBots}
            botId={bot.id}
            allowOff={!alwaysAllow}
            onCancel={() => setEditing(null)}
            onSave={create}
          />
        </div>
      ) : (
        <button type="button" onClick={() => setEditing("new")} className="mt-2 rounded-full border border-hairline/50 px-3 py-1 text-[13px] text-ink hover:bg-control" data-custom-rule-add>
          {t("customRules.add")}
        </button>
      )}
      {error && <div role="alert" className="mt-2 text-[12px] text-danger">{error}</div>}
    </PaneSection>
  );
}
