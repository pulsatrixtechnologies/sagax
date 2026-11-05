// Visible roles (2026-11-05): the owner's "Toujours ainsi pour ce bot" rules,
// in plain words, on the bot's Permissions page. Saved from an "Agit comme"
// card; removed here. They are the owner's: a bot delegated to another
// person starts from the default, so only the owner sees and keeps them.
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { t } from "@/lib/i18n";
import { api } from "@/state/store";
import { readableError } from "@/lib/plain-error";
import { DescribedRow, SettingsGroup } from "../SettingsPrimitives";
import { roleLabel } from "../RoleChip";
import type { BotRoleRule } from "../../../shared/perspicax-roles";

/** One rule in words: "Quand Service Desk est refusé en lecture sur
 * schedule/holidayLists, lire au nom de Moi." */
export function roleRuleText(rule: BotRoleRule): string {
  const from = roleLabel(rule.from);
  const to = roleLabel(rule.to);
  return rule.path ? t("roles.rules.fallbackOn", { from, to, path: rule.path }) : t("roles.rules.switch", { from, to });
}

export function RoleRulesCard({ botId }: { botId: string }) {
  const [rules, setRules] = useState<BotRoleRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void api<{ rules: BotRoleRule[] }>(`/api/bots/${encodeURIComponent(botId)}/roles/rules`)
      .then((body) => { if (alive) setRules(Array.isArray(body.rules) ? body.rules : []); })
      .catch(() => { if (alive) setRules([]); });
    return () => { alive = false; };
  }, [botId]);
  if (!rules || rules.length === 0) return null;
  const remove = (id: string) => {
    setError(null);
    const before = rules;
    setRules(rules.filter((rule) => rule.id !== id));
    void api(`/api/bots/${encodeURIComponent(botId)}/roles/rules`, { method: "DELETE", body: JSON.stringify({ id }) })
      .catch((cause: unknown) => { setRules(before); setError(readableError(cause)); });
  };
  return (
    <SettingsGroup title={t("roles.rules.title")} groupId="role-rules">
      {rules.map((rule) => (
        <DescribedRow key={rule.id} label={roleRuleText(rule)} description={t("roles.rules.hint")} rowId={`role-rule-${rule.id}`}>
          <button type="button" data-role-rule-remove={rule.id} onClick={() => remove(rule.id)} aria-label={t("roles.rules.remove")} title={t("roles.rules.remove")}
            className="flex size-8 items-center justify-center rounded-full text-ink-tertiary hover:bg-hover hover:text-danger focus-visible:outline-2 focus-visible:outline-accent">
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </DescribedRow>
      ))}
      {error && <p role="alert" className="px-4 pb-2 text-[12px] text-danger">{error}</p>}
    </SettingsGroup>
  );
}
