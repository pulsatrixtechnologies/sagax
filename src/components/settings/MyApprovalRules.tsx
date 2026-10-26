// Every Always allow and Always deny the person saved, on any bot, in one
// list they can revoke (2026-10-19, JC: members' "Always allow" on their own
// destinations, their cloud computer and their Local VM). Rules are the
// person's own: GET /api/approval-rules lists them, DELETE removes one. A
// rule saved on a bot someone shared with them shows that bot's name; the
// bot's owner never sees it.
import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { botLabel } from "@/lib/human-label";
import { t } from "@/lib/i18n";
import { api, useStoreOptional } from "@/state/store";
import { ConfirmDialog } from "../ConfirmDialog";
import { HelpTip, SettingsGroup } from "../SettingsPrimitives";
import type { OwnerRuleRow } from "../bot-settings/OwnerPermissionsCard";

/** The rules in the order the list shows them: by bot name, then by what
 * they allow; a rule for every bot last. */
export function myRulesInOrder(rules: readonly OwnerRuleRow[], botName: (id: string) => string): OwnerRuleRow[] {
  return [...rules].sort((a, b) =>
    Number(a.botId === null) - Number(b.botId === null)
    || (a.botId && b.botId ? botName(a.botId).localeCompare(botName(b.botId)) : 0)
    || a.description.localeCompare(b.description));
}

export function MyApprovalRules() {
  const bots = useStoreOptional()?.state.bots ?? [];
  const [rules, setRules] = useState<OwnerRuleRow[] | null>(null);
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
      .catch((failure: unknown) => setError(t("botPanel.rules.error", { error: failure instanceof Error ? failure.message : String(failure) })));
  };

  if (rules === null) return null;
  const shown = myRulesInOrder(rules, botName);
  return (
    <>
      <SettingsGroup title={t("myRules.title")} groupId="myApprovalRules"
        accessory={<HelpTip label={t("settings.moreAbout", { title: t("myRules.title") })}>{t("myRules.help")}</HelpTip>}>
        <div data-my-rules={String(shown.length)}>
          {shown.length === 0 ? (
            <p className="px-3.5 py-2.5 text-[12.5px] leading-[18px] text-ink-secondary">{t("botPanel.rules.empty")}</p>
          ) : (
            <div className="divide-y divide-hairline/40">
              {shown.map((rule) => (
                <div key={rule.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-3 px-3.5 py-2" data-my-rule-row={rule.behavior}>
                  <div className="min-w-0">
                    <div className="break-words text-[13px] leading-[18px] text-ink">{rule.description}</div>
                    <div className="mt-0.5 text-[11.5px] text-ink-tertiary">
                      {rule.botId === null ? t("botPanel.rules.allBots") : botName(rule.botId)}
                      {rule.from && <span data-my-rule-from={rule.from}>{" · "}{t(rule.from === "admin" ? "myRules.from.admin" : rule.from === "hold" ? "myRules.from.hold" : "myRules.from.origin")}</span>}
                    </div>
                  </div>
                  <span className={cn("whitespace-nowrap text-[12.5px]", rule.behavior === "deny" ? "text-danger" : rule.behavior === "allow" ? "text-success" : "text-ink-secondary")}>
                    {t(rule.behavior === "allow" ? "botPanel.rules.allow" : rule.behavior === "deny" ? "botPanel.rules.deny" : "botPanel.rules.ask")}
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
    </>
  );
}
