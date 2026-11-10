// The owner's own rules for a bot (2026-10-14): a two-column Action /
// Behavior table like the reference design's, each row a plain-language
// rule with edit and delete. Spec:
// docs/superpowers/specs/2026-10-14-bot-owner-permissions.md.
//
// 2026-10-26 (one approval level): the bot's separate permission mode
// (Approval, Automatic approval, Bypass) is gone. The approval level, drawn
// first in the same Approvals group (`leading`), is the only setting; these
// rules apply first, whatever the level.
//
// Only the bot's owner sees it: the server keeps the rules to them
// (/api/approval-rules).
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Pencil, Trash2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { api, type Bot } from "@/state/store";
import { ConfirmDialog } from "../ConfirmDialog";
import { FoldRow, HelpTip, PILL, PillSelect, PLAIN_FIELD, PRIMARY_PILL, SettingsGroup, useSettingsSurface } from "../SettingsPrimitives";
import { readableError } from "@/lib/plain-error";

export type RuleBehavior = "allow" | "ask" | "deny";

export interface OwnerRuleRow {
  id: string;
  botId: string | null;
  tool: string;
  scope: Record<string, string>;
  destructive?: "delete" | "bulk" | "external-message";
  behavior: RuleBehavior;
  description: string;
  legacy?: true;
  /** 2026-10-19: the situation the rule also answers (an admin's card, a
   * held card, a turn that is not the person's own) and the bot's name. */
  from?: "admin" | "hold" | "origin";
  botName?: string;
  /** 2026-10-21: an Always allow someone else saved on an admin's card
   * of this bot (an admin, or its owner holding host.commands): shown to
   * the owner and an admin, removed but never edited here. */
  byOther?: true;
  /** That person's name, never an id. */
  savedBy?: string;
}

export const BEHAVIOR_LABEL: Record<RuleBehavior, LocaleKey> = {
  allow: "botPanel.rules.allow",
  ask: "botPanel.rules.ask",
  deny: "botPanel.rules.deny",
};

const KIND_LABEL: Record<NonNullable<OwnerRuleRow["destructive"]>, LocaleKey> = {
  delete: "botPanel.rules.kind.delete",
  bulk: "botPanel.rules.kind.bulk",
  "external-message": "botPanel.rules.kind.externalMessage",
};

/** Rules this bot meets: its own first, then the ones for all my bots. */
export function rulesForBot(rules: readonly OwnerRuleRow[], botId: string): OwnerRuleRow[] {
  return rules
    .filter((rule) => rule.botId === botId || rule.botId === null)
    .sort((a, b) => Number(a.botId === null) - Number(b.botId === null) || a.description.localeCompare(b.description));
}

/** 2026-10-21: who saved a rule someone else kept on an admin's card of
 * this bot, by name (never an id), or null for the person's own rule. */
export function savedByLabel(rule: Pick<OwnerRuleRow, "byOther" | "savedBy">): string | null {
  if (!rule.byOther) return null;
  const name = rule.savedBy?.trim();
  return name ? t("botPanel.rules.savedBy", { name }) : t("botPanel.rules.savedBySomeone");
}

const LONG_TEXT = 110;
/** Rules shown open; a longer list folds under its count. */
const RULES_SHOWN = 5;

function RuleText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const plain = useSettingsSurface() === "plain";
  const long = text.length > LONG_TEXT;
  return (
    <div className="min-w-0">
      <span className={cn("break-words text-ink", plain ? "text-[14px] leading-5" : "text-[13px]", !open && long && "line-clamp-2")}>{text}</span>
      {long && (
        <button type="button" onClick={() => setOpen((value) => !value)} className={plain ? "block text-[12px] leading-4 text-ink-secondary transition-colors hover:text-ink" : "block text-[12px] text-accent hover:underline"}>
          {open ? t("botPanel.rules.showLess") : t("botPanel.rules.showMore")}
        </button>
      )}
    </div>
  );
}

function RuleEditor({ rule, botId, onCancel, onSave }: {
  rule: OwnerRuleRow;
  botId: string;
  onCancel: () => void;
  onSave: (patch: { behavior: RuleBehavior; description: string; botId: string | null; anyTarget: boolean }) => void;
}) {
  const [behavior, setBehavior] = useState<RuleBehavior>(rule.behavior);
  const [description, setDescription] = useState(rule.description);
  const [allBots, setAllBots] = useState(rule.botId === null);
  const [anyTarget, setAnyTarget] = useState(false);
  const scoped = Object.keys(rule.scope).length > 0;
  // The bot's profile page (#2313): the editor opens in the row, without a
  // box of its own; a filled field and plain pills.
  const plain = useSettingsSurface() === "plain";
  return (
    <div className={plain ? "flex flex-col gap-2 py-1" : "flex flex-col gap-2 rounded-lg bg-inset px-3 py-2.5"} data-rule-editor={rule.id}>
      <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">
        {t("botPanel.rules.description")}
        <textarea
          value={description}
          maxLength={500}
          rows={2}
          onChange={(event) => setDescription(event.target.value)}
          className={plain ? PLAIN_FIELD : "rounded-md bg-raised px-2 py-1.5 text-[13px] text-ink outline-none focus:ring-1 focus:ring-accent"}
        />
      </label>
      <div className="flex items-center justify-between gap-3 text-[12px] text-ink-secondary">
        {t("botPanel.rules.behavior")}
        <PillSelect<RuleBehavior>
          value={behavior}
          ariaLabel={t("botPanel.rules.behavior")}
          onChange={setBehavior}
          options={(["allow", "ask", "deny"] as const).map((value) => ({ value, label: t(BEHAVIOR_LABEL[value]) }))}
        />
      </div>
      <div className="flex items-center justify-between gap-3 text-[12px] text-ink-secondary">
        {t("botPanel.rules.appliesTo")}
        <PillSelect<"this" | "all">
          value={allBots ? "all" : "this"}
          ariaLabel={t("botPanel.rules.appliesTo")}
          onChange={(next) => setAllBots(next === "all")}
          options={[
            { value: "this", label: t("botPanel.rules.thisBot") },
            { value: "all", label: t("botPanel.rules.allBots") },
          ]}
        />
      </div>
      {scoped && !rule.legacy && (
        <label className="flex items-center gap-2 text-[12px] text-ink-secondary">
          <input type="checkbox" checked={anyTarget} onChange={(event) => setAnyTarget(event.target.checked)} />
          {t("botPanel.rules.anyTarget")}
        </label>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={PILL}>
          {t("botPanel.rules.cancel")}
        </button>
        <button
          type="button"
          onClick={() => onSave({ behavior, description, botId: allBots ? null : botId, anyTarget })}
          className={plain ? PILL : PRIMARY_PILL}
        >
          {t("botPanel.rules.save")}
        </button>
      </div>
    </div>
  );
}

/** `leading`: the Permissions page's approval rows (the approval level,
 * contacting other bots), drawn in the Approvals group above the rules. */
export function OwnerPermissionsCard({ bot, leading }: { bot: Pick<Bot, "id" | "name">; leading?: ReactNode }) {
  const [rules, setRules] = useState<OwnerRuleRow[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<OwnerRuleRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadRules = useCallback(() => api<{ rules: OwnerRuleRow[] }>(`/api/approval-rules?botId=${encodeURIComponent(bot.id)}`)
    .then((body) => setRules(rulesForBot(body.rules ?? [], bot.id)))
    .catch(() => setRules([])), [bot.id]);

  useEffect(() => {
    setEditing(null);
    void loadRules();
  }, [bot.id, loadRules]);

  const saveRule = (rule: OwnerRuleRow, patch: { behavior: RuleBehavior; description: string; botId: string | null; anyTarget: boolean }) => {
    setError(null);
    void api(`/api/approval-rules/${rule.id}`, {
      method: "PATCH",
      body: JSON.stringify({ behavior: patch.behavior, description: patch.description, botId: patch.botId, ...(patch.anyTarget ? { anyTarget: true } : {}) }),
    })
      .then(() => {
        setEditing(null);
        return loadRules();
      })
      .catch((failure: unknown) => setError(t("botPanel.rules.error", { error: readableError(failure) })));
  };

  const removeRule = (rule: OwnerRuleRow) => {
    setError(null);
    void api(`/api/approval-rules/${rule.id}`, { method: "DELETE" })
      .then(() => loadRules())
      .catch((failure: unknown) => setError(t("botPanel.rules.error", { error: readableError(failure) })));
  };

  const groupTitle = t("botPanel.permissions.approvals");
  const plain = useSettingsSurface() === "plain";
  const padX = plain ? "px-4" : "px-3.5";

  return (
    <>
      {leading && <SettingsGroup title={groupTitle} groupId="approvals">{leading}</SettingsGroup>}

      <SettingsGroup title={t("botPanel.rules.title")} groupId="ownerRules"
        accessory={<HelpTip label={t("settings.moreAbout", { title: t("botPanel.rules.title") })}>{t("botPanel.rules.help")}</HelpTip>}>
        <div data-owner-rules={String(rules.length)}>
          {rules.length === 0 ? (
            <p className={cn(padX, "py-2.5 text-ink-secondary", plain ? "text-[12px] leading-4" : "text-[12px] leading-[18px]")}>{t("botPanel.rules.empty")}</p>
          ) : (
            <FoldRow
              cardId="bot.permissions.rules"
              defaultOpen={rules.length <= RULES_SHOWN}
              label={t("botPanel.rules.title")}
              count={rules.length}
            >
              <div className={plain ? "-mx-4" : "-mx-3.5 divide-y divide-hairline/40 border-t border-hairline/40"}>
                {rules.map((rule) => (
                  <div key={rule.id} className={cn(padX, "py-2")} data-owner-rule-row={rule.behavior}>
                    {editing === rule.id ? (
                      <RuleEditor rule={rule} botId={bot.id} onCancel={() => setEditing(null)} onSave={(patch) => saveRule(rule, patch)} />
                    ) : (
                      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-3">
                        <div className="min-w-0">
                          <RuleText text={rule.description} />
                          <div className={cn("mt-0.5 flex flex-wrap gap-1.5", plain ? "text-[12px] leading-4 text-ink-secondary" : "text-[12px] text-ink-tertiary")}>
                            {rule.botId === null && <span>{t("botPanel.rules.allBots")}</span>}
                            {rule.destructive && <span className="text-warning">{t(KIND_LABEL[rule.destructive])}</span>}
                            {rule.legacy && <span>{t("botPanel.rules.migrated")}</span>}
                            {rule.byOther && <span data-rule-saved-by="">{savedByLabel(rule)}</span>}
                          </div>
                        </div>
                        <span className={cn("whitespace-nowrap text-[12px]", rule.behavior === "deny" ? "text-danger" : rule.behavior === "allow" ? "text-success" : "text-ink-secondary")}>
                          {t(BEHAVIOR_LABEL[rule.behavior])}
                        </span>
                        <div className="flex items-center gap-0.5">
                          {!rule.byOther && <button
                            type="button"
                            aria-label={t("botPanel.rules.edit")}
                            title={t("botPanel.rules.edit")}
                            onClick={() => setEditing(rule.id)}
                            className="ui-icon-button"
                          >
                            <Pencil size={14} aria-hidden="true" />
                          </button>}
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
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </FoldRow>
          )}
          {error && <div role="alert" className={cn(padX, "pb-2 text-[12px] text-danger")}>{error}</div>}
        </div>
      </SettingsGroup>

      {/* Removing a rule asks first, in a red pill (2026-10-16). */}
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
          if (rule) removeRule(rule);
        }}
      />

    </>
  );
}
