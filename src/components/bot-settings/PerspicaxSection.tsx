// The Perspicax MCP profiles this bot offers, on a server linked to
// Perspicax (slice 5). Each person who talks to the bot uses their own
// Perspicax access: someone who does not hold a profile does not get its
// tools. An editor adds only the profiles they hold; a profile someone else
// put on the bot stays checked, shown as not held, and may be removed.
// GET and PUT /api/bots/:id/perspicax (server/bots/bot-perspicax.ts).
import { cn } from "@/lib/cn";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { GROUP_CARD, HelpTip, PILL, PRIMARY_PILL } from "../SettingsPrimitives";

import { api, ApiError, type Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";

export interface PerspicaxProfile {
  id: string;
  slug: string;
  name: string;
  description: string;
}

export interface PerspicaxAnswer {
  selected: Array<PerspicaxProfile & { heldByMe: boolean }>;
  available: PerspicaxProfile[];
  canEdit: boolean;
  identities?: { supported: boolean; profiles: Array<{ slug: string; name: string; explicit_only: boolean }> };
  actsAs?: { slug: string; name: string } | null;
  identityUnavailable?: boolean;
}

export interface PerspicaxRow {
  profile: PerspicaxProfile;
  checked: boolean;
  /** Selected, but the viewer does not hold it: checked and disabled. */
  notHeld: boolean;
  disabled: boolean;
}

/** The rows the editor shows: every profile the viewer holds, then the
 * selected ones they do not hold. `draft` is the ids checked now. */
export function perspicaxRows(answer: PerspicaxAnswer, draft: readonly string[]): PerspicaxRow[] {
  const checked = new Set(draft);
  const rows: PerspicaxRow[] = answer.available.map((profile) => ({ profile, checked: checked.has(profile.id), notHeld: false, disabled: !answer.canEdit }));
  const shown = new Set(answer.available.map((profile) => profile.id));
  for (const selected of answer.selected) {
    if (shown.has(selected.id) || selected.heldByMe) continue;
    const { heldByMe: _held, ...profile } = selected;
    rows.push({ profile, checked: checked.has(profile.id), notHeld: true, disabled: true });
  }
  return rows;
}

const ERROR_KEYS: Record<string, LocaleKey> = {
  profile_not_held: "botSettings.perspicax.error.profile_not_held",
  needs_edit: "botSettings.perspicax.error.needs_edit",
  unknown_profile: "botSettings.perspicax.error.unknown_profile",
  params_invalid: "perspicax.identity.params_invalid",
  identity_unavailable: "perspicax.identity.unavailable",
};

/** A disabled row is a profile this person cannot toggle. The name stays;
 * the checkbox does not. */
export function perspicaxShowsCheckbox(row: Pick<PerspicaxRow, "disabled">): boolean {
  return !row.disabled;
}

function perspicaxProfileLabel(row: PerspicaxRow) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-[13px] text-ink">
        {row.profile.name}
        {row.notHeld && <span className="ml-2 text-[11px] text-ink-secondary">{t("botSettings.perspicax.notHeld")}</span>}
      </span>
      {row.profile.description && <span className="text-[12px] text-ink-secondary">{row.profile.description}</span>}
    </span>
  );
}

/** One profile row. A person who cannot change it sees the name only. */
export function PerspicaxProfileControl({
  row,
  saving,
  canRemove,
  onToggle,
  onRemove,
}: {
  row: PerspicaxRow;
  saving: boolean;
  canRemove: boolean;
  onToggle: (on: boolean) => void;
  onRemove: () => void;
}) {
  const label = perspicaxProfileLabel(row);
  return (
    <li className="py-2" data-perspicax-profile={row.profile.id}>
      {perspicaxShowsCheckbox(row) ? (
        <label className="flex min-w-0 cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5 shrink-0"
            checked={row.checked}
            disabled={saving}
            onChange={(event) => onToggle(event.target.checked)}
          />
          {label}
        </label>
      ) : (
        <div className="flex min-w-0 items-start gap-2">{label}</div>
      )}
      {canRemove && row.notHeld && row.checked && (
        <button
          type="button"
          disabled={saving}
          onClick={onRemove}
          className={cn(PILL, "ml-6 mt-1")}
        >
          {t("botSettings.perspicax.remove")}
        </button>
      )}
    </li>
  );
}

/** The message for a refused save. */
export function perspicaxErrorKey(code: unknown): LocaleKey {
  return (typeof code === "string" && ERROR_KEYS[code]) || "botSettings.perspicax.error.failed";
}

export function PerspicaxSection({ bot }: { bot: Pick<Bot, "id"> }) {
  const [answer, setAnswer] = useState<PerspicaxAnswer | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [actsAs, setActsAs] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<LocaleKey | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    setAnswer(null);
    setLoadFailed(false);
    void api<PerspicaxAnswer>(`/api/bots/${bot.id}/perspicax`)
      .then((body) => {
        if (!alive) return;
        setAnswer(body);
        setDraft(body.selected.map((profile) => profile.id));
        setActsAs(body.actsAs?.slug ?? "");
      })
      .catch(() => { if (alive) setLoadFailed(true); });
    return () => { alive = false; };
  }, [bot.id]);

  if (loadFailed) return <p className="text-[13px] text-ink-secondary">{t("botSettings.perspicax.unavailable")}</p>;
  if (!answer) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-ink-secondary">
        <Loader2 size={13} className="animate-spin" aria-hidden="true" />
        {t("botSettings.perspicax.loading")}
      </div>
    );
  }

  const rows = perspicaxRows(answer, draft);
  const current = answer.selected.map((profile) => profile.id);
  const changed = draft.length !== current.length || draft.some((id, index) => id !== current[index]) || actsAs !== (answer.actsAs?.slug ?? "");
  const toggle = (id: string, on: boolean) => {
    setSaved(false);
    setError(null);
    setDraft((before) => (on ? [...before.filter((entry) => entry !== id), id] : before.filter((entry) => entry !== id)));
  };
  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const body = await api<PerspicaxAnswer>(`/api/bots/${bot.id}/perspicax`, { method: "PUT", body: JSON.stringify({ profiles: draft, ...(actsAs !== (answer.actsAs?.slug ?? "") ? { actsAs: actsAs || null } : {}) }) });
      setAnswer(body);
      setDraft(body.selected.map((profile) => profile.id));
      setActsAs(body.actsAs?.slug ?? "");
      setSaved(true);
    } catch (failure) {
      setError(perspicaxErrorKey(failure instanceof ApiError ? failure.body?.code : undefined));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3" data-bot-perspicax>
      {(answer.identities?.supported || answer.actsAs) && <label className="flex flex-col gap-2 text-[13px] text-ink">
        <span>{t("perspicax.identity.label")}</span>
        <select
          className="rounded-lg border border-hairline bg-inset px-3 py-2 text-[13px] text-ink"
          value={actsAs}
          disabled={!answer.canEdit || saving}
          onChange={(event) => { setActsAs(event.target.value); setSaved(false); setError(null); }}
        >
          <option value="">{t("perspicax.identity.default")}</option>
          {answer.actsAs && !answer.identities?.profiles.some((profile) => profile.slug === answer.actsAs?.slug) && <option value={answer.actsAs.slug}>{answer.actsAs.name}</option>}
          {answer.identities?.profiles.map((profile) => <option key={profile.slug} value={profile.slug}>{profile.name}</option>)}
        </select>
        <span className="text-[12px] text-ink-secondary">{t("perspicax.identity.help")}</span>
      </label>}
      {answer.identityUnavailable && <p role="status" className="text-[12px] text-ink-secondary">{t("perspicax.identity.unavailable")}</p>}
      <div className="flex items-center gap-1.5 text-[12.5px] text-ink-secondary">
        <span>{t("botSettings.perspicax.short")}</span>
        <HelpTip label={t("settings.moreAbout", { title: t("botSettings.perspicax.title") })}>
          <span className="block">{t("botSettings.perspicax.help")}</span>
          <span className="mt-2 block">{t("botSettings.perspicax.routines")}</span>
        </HelpTip>
      </div>
      {rows.length === 0 ? (
        <p className="text-[13px] text-ink-secondary">{t("botSettings.perspicax.none")}</p>
      ) : (
        <ul className={cn(GROUP_CARD, "divide-y divide-hairline/40 px-3.5 py-0.5")} aria-label={t("botSettings.perspicax.title")}>
          {rows.map((row) => (
            <PerspicaxProfileControl
              key={row.profile.id}
              row={row}
              saving={saving}
              canRemove={answer.canEdit}
              onToggle={(on) => toggle(row.profile.id, on)}
              onRemove={() => toggle(row.profile.id, false)}
            />
          ))}
        </ul>
      )}
      {answer.canEdit ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {saved && !changed && <span className="mr-auto text-[12px] text-ink-secondary" role="status">{t("botSettings.perspicax.saved")}</span>}
          {error && <span className="mr-auto text-[12px] text-danger" role="alert">{t(error)}</span>}
          <button
            type="button"
            disabled={!changed || saving}
            onClick={() => void save()}
            className={cn(PRIMARY_PILL, "gap-1")}
          >
            {saving && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
            {t("botSettings.perspicax.save")}
          </button>
        </div>
      ) : (
        <p className="text-[12px] text-ink-secondary">{t("botSettings.perspicax.readOnly")}</p>
      )}
    </div>
  );
}
