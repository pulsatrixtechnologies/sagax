// Every Always allow and Always deny the person saved, on any bot, in one
// list they can revoke. #2080 L2: one summary row that unfolds into search,
// FilterChips (Allow / Deny / Ask) and a scrolling list (Show more past 50).
// Behaviour is grey text, never coloured.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";

import { botLabel } from "@/lib/human-label";
import { t } from "@/lib/i18n";
import { api, useStoreOptional } from "@/state/store";
import { ConfirmDialog } from "../ConfirmDialog";
import { DescribedRow, FilterChips, HelpTip, SettingsGroup } from "../SettingsPrimitives";
import { DisclosurePill } from "./AppearanceSettings";
import type { OwnerRuleRow } from "../bot-settings/OwnerPermissionsCard";
import { readableError } from "@/lib/plain-error";

const INITIAL_SHOW = 50;

type BehaviorFilter = "all" | "allow" | "deny" | "ask";

/** The rules in the order the list shows them: by bot name, then by what
 * they allow; a rule for every bot last. */
export function myRulesInOrder(rules: readonly OwnerRuleRow[], botName: (id: string) => string): OwnerRuleRow[] {
  return [...rules].sort((a, b) =>
    Number(a.botId === null) - Number(b.botId === null)
    || (a.botId && b.botId ? botName(a.botId).localeCompare(botName(b.botId)) : 0)
    || a.description.localeCompare(b.description));
}

/** Kept for older tests that page the list. */
export function rulesPage<T>(rules: readonly T[], offset: number, pageSize: number): T[] {
  return rules.slice(offset, offset + pageSize);
}

function behaviorLabel(behavior: OwnerRuleRow["behavior"]): string {
  return t(behavior === "allow" ? "botPanel.rules.allow" : behavior === "deny" ? "botPanel.rules.deny" : "botPanel.rules.ask");
}

export function MyApprovalRules() {
  const bots = useStoreOptional()?.state.bots ?? [];
  const [rules, setRules] = useState<OwnerRuleRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<BehaviorFilter>("all");
  const [limit, setLimit] = useState(INITIAL_SHOW);
  const [removing, setRemoving] = useState<OwnerRuleRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const botName = useCallback((id: string) => botLabel(bots.find((bot) => bot.id === id)?.name ?? rules?.find((rule) => rule.botId === id)?.botName), [bots, rules]);
  const load = useCallback(() => api<{ rules: OwnerRuleRow[] }>("/api/approval-rules")
    .then((body) => setRules(body.rules ?? []))
    .catch(() => setRules([])), []);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = (rule: OwnerRuleRow) => {
    setError(null);
    void api(`/api/approval-rules/${rule.id}`, { method: "DELETE" })
      .then(() => load())
      .catch((failure: unknown) => setError(t("botPanel.rules.error", { error: readableError(failure) })));
  };

  const ordered = useMemo(() => (rules ? myRulesInOrder(rules, botName) : []), [rules, botName]);
  const counts = useMemo(() => ({
    allow: ordered.filter((rule) => rule.behavior === "allow").length,
    deny: ordered.filter((rule) => rule.behavior === "deny").length,
    ask: ordered.filter((rule) => rule.behavior === "ask").length,
  }), [ordered]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return ordered.filter((rule) => {
      if (filter !== "all" && rule.behavior !== filter) return false;
      if (!needle) return true;
      const hay = `${rule.description} ${rule.botId ? botName(rule.botId) : t("botPanel.rules.allBots")}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [ordered, filter, query, botName]);

  const shown = filtered.slice(0, limit);

  if (rules === null) return null;

  const summary = ordered.length === 0
    ? t("botPanel.rules.empty")
    : t("approvalRules.summary", {
      count: ordered.length,
      allow: counts.allow,
      deny: counts.deny,
      ask: counts.ask,
    });

  return (
    <div data-settings-card="myApprovalRules">
      <SettingsGroup title={t("myRules.title")} groupId="myApprovalRules"
        accessory={<HelpTip label={t("settings.moreAbout", { title: t("myRules.title") })}>{t("myRules.help")}</HelpTip>}>
        <div data-my-rules={String(ordered.length)}>
          <DescribedRow
            label={t("myRules.title")}
            description={summary}
            rowId="myApprovalRulesSummary"
            below={open ? (
              <div className="mt-2 flex flex-col gap-2" data-my-rules-list="">
                <div className="flex flex-wrap items-center gap-2 px-0.5">
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => { setQuery(event.target.value); setLimit(INITIAL_SHOW); }}
                    placeholder={t("approvalRules.search")}
                    aria-label={t("approvalRules.search")}
                    className="h-7 min-w-[160px] flex-1 rounded-lg border-[0.5px] border-border bg-inset px-2.5 text-[13px] text-ink placeholder:text-ink-secondary focus:border-focus focus:outline-none"
                  />
                  <FilterChips<BehaviorFilter>
                    label={t("approvalRules.filter.label")}
                    value={filter}
                    onChange={(next) => { setFilter(next); setLimit(INITIAL_SHOW); }}
                    chips={[
                      { id: "all", label: t("approvalRules.filter.all"), count: ordered.length },
                      { id: "allow", label: t("approvalRules.filter.allow"), count: counts.allow },
                      { id: "deny", label: t("approvalRules.filter.deny"), count: counts.deny },
                      { id: "ask", label: t("approvalRules.filter.ask"), count: counts.ask },
                    ]}
                  />
                </div>
                {shown.length === 0 ? (
                  <p className="px-0.5 py-2 text-[12.5px] leading-[18px] text-ink-secondary">{t("approvalRules.noneMatch")}</p>
                ) : (
                  <div className="max-h-[360px] overflow-y-auto divide-y divide-hairline/40">
                    {shown.map((rule) => (
                      <div key={rule.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-3 px-0.5 py-2" data-my-rule-row={rule.behavior}>
                        <div className="min-w-0">
                          <div className="break-words text-[13px] leading-[18px] text-ink">{rule.description}</div>
                          <div className="mt-0.5 text-[11.5px] text-ink-tertiary">
                            {rule.botId === null ? t("botPanel.rules.allBots") : botName(rule.botId)}
                            {rule.from && <span data-my-rule-from={rule.from}>{" · "}{t(rule.from === "admin" ? "myRules.from.admin" : rule.from === "hold" ? "myRules.from.hold" : "myRules.from.origin")}</span>}
                          </div>
                        </div>
                        <span className="whitespace-nowrap text-[12.5px] text-ink-secondary">
                          {behaviorLabel(rule.behavior)}
                        </span>
                        <button
                          type="button"
                          aria-label={t("botPanel.rules.remove")}
                          title={t("botPanel.rules.remove")}
                          onClick={() => setRemoving(rule)}
                          className="ui-icon-button hover:text-danger"
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {filtered.length > shown.length && (
                  <button
                    type="button"
                    className="self-start rounded-full px-2.5 py-1 text-[13px] text-ink-secondary hover:bg-hover hover:text-ink"
                    onClick={() => setLimit((value) => value + INITIAL_SHOW)}
                  >
                    {t("approvalRules.showMore")}
                  </button>
                )}
              </div>
            ) : undefined}
          >
            <DisclosurePill open={open} onToggle={() => setOpen((value) => !value)} label={t("myRules.title")}>
              {open ? t("settings.appearance.hide") : t("approvalRules.view")}
            </DisclosurePill>
          </DescribedRow>
          {error && <div role="alert" className="px-3.5 pb-2 text-[12px] text-danger">{error}</div>}
        </div>
      </SettingsGroup>
      <ConfirmDialog
        open={removing !== null}
        title={t("botPanel.rules.removeTitle")}
        body={removing?.description ?? ""}
        confirmLabel={t("botPanel.rules.remove")}
        tone="danger"
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const rule = removing;
          setRemoving(null);
          if (rule) remove(rule);
        }}
      />
    </div>
  );
}
