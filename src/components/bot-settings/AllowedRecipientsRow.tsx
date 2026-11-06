// Allowed recipients (parité avec la référence X3, 2026-10-21): the people and bots
// this bot writes to without a card. An email address, a phone number
// (Messages, texts) or another of the person's bots. Anyone else keeps the
// card. Saved on the bot (`allowedRecipients`, shared/allowed-recipients.ts);
// an addition is a standing grant, so the server asks the person's security
// key when they protect "always-grant" (the api helper runs that ceremony).
import { useState } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useOrgApprovalPolicy } from "@/lib/org-approval-policy";
import { api, useStore, type Bot } from "@/state/store";
import { parseRecipientEntry, recipientEntryKey } from "../../../shared/allowed-recipients";
import { DescribedRow, PILL, PillSelect, PLAIN_FIELD, useSettingsSurface } from "../SettingsPrimitives";
import { readableError } from "@/lib/plain-error";

/** How one entry reads: an address or a number as it is; a bot by its name,
 * never its id (AGENTS.md), a deleted one by a plain word, the id kept for
 * the tooltip. */
export function recipientLabel(key: string, bots: ReadonlyArray<{ id: string; name: string }>): { text: string; title?: string } {
  const entry = parseRecipientEntry(key);
  if (!entry) return { text: t("botPanel.recipients.deletedBot"), title: key };
  if (entry.kind !== "bot") return { text: entry.value };
  const named = bots.find((candidate) => candidate.id === entry.value);
  return { text: named ? named.name : t("botPanel.recipients.deletedBot"), title: entry.value };
}

export function AllowedRecipientsRow({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const list = bot.allowedRecipients ?? [];
  // the organization turned standing grants off: the list waits, unused
  const grantsOff = !useOrgApprovalPolicy().alwaysAllow;
  const otherBots = state.bots.filter((candidate) => candidate.id !== bot.id && !candidate.hidden && !list.includes(`bot:${candidate.id}`));

  const save = (next: string[]) => {
    setSaving(true);
    setError(null);
    void api<{ bot: Bot }>(`/api/bots/${encodeURIComponent(bot.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ allowedRecipients: next }),
    })
      .then((response) => {
        dispatch({ type: "botPatched", bot: response.bot });
        setDraft("");
      })
      .catch((cause: unknown) => {
        const text = readableError(cause);
        setError(/allowedRecipients must be|invalid_recipients/.test(text) ? t("botPanel.recipients.invalid") : text);
      })
      .finally(() => setSaving(false));
  };

  const add = (raw: string) => {
    const entry = parseRecipientEntry(raw);
    if (!entry || entry.kind === "bot") {
      setError(t("botPanel.recipients.invalid"));
      return;
    }
    const key = recipientEntryKey(entry);
    if (list.includes(key)) {
      setDraft("");
      return;
    }
    save([...list, key]);
  };

  const label = (key: string) => recipientLabel(key, state.bots);
  // The bot's profile page (#2313): filled chips and a filled field, no
  // outline inside the card.
  const plain = useSettingsSurface() === "plain";

  return (
    <DescribedRow
      label={t("botPanel.recipients.title")}
      description={t("botPanel.recipients.description")}
      help={bot.approvePeerComms ? t("botPanel.recipients.help") : t("botPanel.recipients.helpBotsAskOff")}
      rowId="allowedRecipients"
      below={
        <div className="mt-2 flex flex-col gap-2" data-testid="allowed-recipients">
          {list.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label={t("botPanel.recipients.title")}>
              {list.map((key) => {
                const shown = label(key);
                return (
                  <li key={key} className={plain ? "flex items-center gap-1 rounded-full bg-control py-0.5 pl-2.5 pr-1 text-[12px] text-ink" : "flex items-center gap-1 rounded-full border-[0.5px] border-border bg-inset py-0.5 pl-2.5 pr-1 text-[12px] text-ink"} title={shown.title}>
                    <span className="max-w-[240px] truncate">{shown.text}</span>
                    <button
                      type="button"
                      className="flex size-5 items-center justify-center rounded-full text-ink-tertiary hover:bg-hover hover:text-ink disabled:opacity-50"
                      aria-label={t("botPanel.recipients.remove", { name: shown.text })}
                      disabled={saving}
                      onClick={() => save(list.filter((candidate) => candidate !== key))}
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {list.length === 0 && <div className={plain ? "text-[12px] leading-4 text-ink-secondary" : "text-[12px] text-ink-tertiary"}>{t("botPanel.recipients.empty")}</div>}
          {grantsOff && <div className="text-[12px] text-ink-secondary">{t("botPanel.recipients.orgOff")}</div>}
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (draft.trim()) add(draft);
            }}
          >
            <input
              type="text"
              value={draft}
              onChange={(event) => { setDraft(event.target.value); setError(null); }}
              placeholder={t("botPanel.recipients.placeholder")}
              aria-label={t("botPanel.recipients.placeholder")}
              autoComplete="off"
              spellCheck={false}
              className={plain ? cn(PLAIN_FIELD, "w-auto flex-1 basis-[200px]") : "min-w-0 flex-1 basis-[200px] rounded-lg border-[0.5px] border-border bg-inset px-3 py-1.5 text-[13px] text-ink placeholder:text-ink-secondary focus:border-focus focus:outline-none"}
            />
            <button type="submit" className={PILL} disabled={saving || grantsOff || !draft.trim()}>{t("botPanel.recipients.add")}</button>
            {otherBots.length > 0 && (
              <PillSelect
                ariaLabel={t("botPanel.recipients.addBot")}
                value=""
                disabled={saving || grantsOff}
                onChange={(next) => { if (next) save([...list, `bot:${next}`]); }}
                options={[{ value: "", label: t("botPanel.recipients.addBot") }, ...otherBots.map((candidate) => ({ value: candidate.id, label: candidate.name }))]}
              />
            )}
          </form>
          {error && <div role="alert" className="text-[12px] text-danger">{error}</div>}
        </div>
      }
    />
  );
}
