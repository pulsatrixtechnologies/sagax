// Who can see this bot, on a workspace served to several people: everyone
// who can sign in (the default), admins only, or the listed addresses (and
// @domain entries) plus admins. Shown to admins and to the bot's own owner
// (#1098; the server keeps the owner in the audience), and not in the
// desktop app, where nobody else signs in. Saving is the change: the server narrows
// every member's lists, conversations, files and live updates at once
// (server/bots/bot-visibility.ts). No confirmation step: it is a setting.
import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { DescribedRow, GROUP_CARD, PILL, PillSelect, PLAIN_FIELD, PRIMARY_PILL, SettingsGroup, useSettingsSurface } from "../SettingsPrimitives";

import { api, useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { BotVisibility } from "../../../shared/wire";
import { readableError } from "@/lib/plain-error";

export type VisibilityMode = "everyone" | "admins" | "people";

export function formFromVisibility(visibility: BotVisibility | undefined): { mode: VisibilityMode; people: string } {
  if (!visibility || visibility === "everyone") return { mode: "everyone", people: "" };
  if (visibility === "admins") return { mode: "admins", people: "" };
  return { mode: "people", people: visibility.people.join("\n") };
}

/** The PATCH value for the form; the server validates each address again. */
export function visibilityFromForm(mode: VisibilityMode, people: string): { ok: true; visibility: BotVisibility } | { ok: false } {
  if (mode !== "people") return { ok: true, visibility: mode };
  const entries = [...new Set(people.split(/[\s,;]+/).map((entry) => entry.trim().toLowerCase()).filter(Boolean))];
  return entries.length ? { ok: true, visibility: { people: entries } } : { ok: false };
}

/** One audience, however it was written: absent is everyone, lists compare as sets. */
export function audienceKey(visibility: BotVisibility | undefined): string {
  if (!visibility || visibility === "everyone" || visibility === "admins") return visibility ?? "everyone";
  return JSON.stringify([...new Set(visibility.people.map((entry) => entry.trim().toLowerCase()))].sort());
}

/** Rooms visible to fewer people than this bot: another bot in them has a
 * different audience, or the room kept a narrower one from before (a room's
 * floor never widens on its own; see server/bots/bot-visibility.ts). */
export function mixedRooms(
  bot: Pick<Bot, "id" | "visibility">,
  groups: ReadonlyArray<{ id: string; name: string; memberIds: string[]; dm?: boolean; audienceFloor?: BotVisibility }>,
  bots: ReadonlyArray<Pick<Bot, "id" | "visibility">>,
): Array<{ id: string; name: string }> {
  const mine = audienceKey(bot.visibility);
  return groups
    .filter((group) => !group.dm && group.memberIds.includes(bot.id) && (
      (group.audienceFloor !== undefined && audienceKey(group.audienceFloor) !== mine) ||
      group.memberIds.some((id) => {
        const other = bots.find((candidate) => candidate.id === id);
        return other !== undefined && other.id !== bot.id && audienceKey(other.visibility) !== mine;
      })))
    .map((group) => ({ id: group.id, name: group.name }));
}

const OPTIONS: Array<{ mode: VisibilityMode; key: "botSettings.visibility.everyone" | "botSettings.visibility.admins" | "botSettings.visibility.people" }> = [
  { mode: "everyone", key: "botSettings.visibility.everyone" },
  { mode: "admins", key: "botSettings.visibility.admins" },
  { mode: "people", key: "botSettings.visibility.people" },
];

export function VisibilitySection({ bot }: { bot: Bot }) {
  const { state } = useStore();
  const mixed = mixedRooms(bot, state.groups, state.bots);
  const saved = formFromVisibility(bot.visibility);
  const [mode, setMode] = useState<VisibilityMode>(saved.mode);
  const [people, setPeople] = useState(saved.people);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"saved" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dirty = mode !== saved.mode || (mode === "people" && people.trim() !== saved.people.trim());
  const plain = useSettingsSurface() === "plain";

  // The stored value changed (another admin, or this save echoed back by the
  // live stream): the form follows it.
  const storedKey = JSON.stringify(bot.visibility ?? "everyone");
  useEffect(() => {
    const next = formFromVisibility(JSON.parse(storedKey) as BotVisibility);
    setMode(next.mode);
    setPeople(next.people);
  }, [bot.id, storedKey]);

  /** The admin's explicit choice to widen a room to what its bots allow. */
  const resetRoom = async (groupId: string) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/groups/${groupId}`, { method: "PATCH", body: JSON.stringify({ resetAudience: true }) });
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const value = visibilityFromForm(mode, people);
    if (!value.ok) {
      setError(t("botSettings.visibility.needPeople"));
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await api(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ visibility: value.visibility }) });
      setStatus("saved");
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  };

  const peopleField = (
    <label className={plain ? "mt-2.5 flex flex-col gap-1.5 text-[12px] leading-4 text-ink-secondary" : "mt-2.5 flex flex-col gap-1.5 text-[12px] text-ink-secondary"}>
      {t("botSettings.visibility.peopleLabel")}
      <textarea
        value={people}
        onChange={(e) => { setPeople(e.target.value); setStatus(null); }}
        placeholder={t("botSettings.visibility.peoplePlaceholder")}
        rows={4}
        disabled={busy}
        className={plain ? cn(PLAIN_FIELD, "font-mono") : "rounded-lg border-[0.5px] border-border bg-inset px-3 py-2 font-mono text-[12.5px] text-ink placeholder:text-ink-secondary focus:border-focus focus:outline-none"}
      />
    </label>
  );
  const audience = (
    <PillSelect
      value={mode}
      ariaLabel={t("botSettings.visibility.title")}
      disabled={busy}
      onChange={(next) => { setMode(next); setStatus(null); setError(null); }}
      options={OPTIONS.map((option) => ({ value: option.mode, label: t(option.key) }))}
    />
  );
  const roomButtons = mixed.map((room) => (
    <button
      key={room.id}
      type="button"
      disabled={busy}
      onClick={() => void resetRoom(room.id)}
      className={PILL}
    >
      {t("botSettings.visibility.resetRoom", { room: JSON.stringify(room.name) })}
    </button>
  ));
  const saveButton = (
    <button
      type="button"
      onClick={() => void save()}
      disabled={busy || !dirty}
      className={cn(plain ? PILL : PRIMARY_PILL, "gap-1.5", "disabled:opacity-50")}
    >
      {busy && <Loader2 size={13} className="animate-spin" />}
      {busy ? t("botSettings.visibility.saving") : t("botSettings.visibility.save")}
    </button>
  );
  const savedNote = status === "saved" && !dirty && (
    <span role="status" className="flex items-center gap-1 text-[12px] text-success"><Check size={13} />{t("botSettings.visibility.saved")}</span>
  );

  // The bot's profile page (#2313): the reference look. The grey label is
  // the rail's ("Who can see it"); one plain card holds the audience row,
  // the people field, the rooms note as a subtitle with its pills, and
  // Save as a plain pill at the card's foot.
  if (plain) {
    return (
      <div data-bot-visibility>
        <SettingsGroup title={t("botSettings.visibility.title")} groupId="botVisibility">
          <DescribedRow
            label={t("botSettings.visibility.audience")}
            description={t("botSettings.visibility.subtitle")}
            help={t("botSettings.visibility.rooms")}
            rowId="visibility"
            below={mode === "people" && peopleField}
          >
            {audience}
          </DescribedRow>
          {mixed.length > 0 && (
            <div className="flex flex-col gap-2 px-4 py-2.5 text-[12px] leading-4 text-ink-secondary" data-visibility-mixed-rooms>
              <p>{t("botSettings.visibility.mixedRooms", { rooms: mixed.map((room) => JSON.stringify(room.name)).join(", ") })}</p>
              <div className="flex flex-wrap gap-2">{roomButtons}</div>
            </div>
          )}
          <div className="flex items-center justify-end gap-3 px-4 py-2">
            {savedNote}
            {saveButton}
          </div>
          {error && <p role="alert" className="px-4 pb-2 text-[12px] text-danger">{error}</p>}
        </SettingsGroup>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-bot-visibility>
      {/* 2026-10-16: drawn like Settings: one card row with the
          audience in a pill menu, the list of people under it. */}
      <div className={GROUP_CARD}>
        <DescribedRow
          label={t("botSettings.visibility.title")}
          description={t("botSettings.visibility.subtitle")}
          help={t("botSettings.visibility.rooms")}
          rowId="visibility"
          below={mode === "people" && peopleField}
        >
          {audience}
        </DescribedRow>
      </div>
      {mixed.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-accent/25 bg-accent/10 px-3 py-2 text-[12px] leading-relaxed text-ink-secondary" data-visibility-mixed-rooms>
          <p>{t("botSettings.visibility.mixedRooms", { rooms: mixed.map((room) => JSON.stringify(room.name)).join(", ") })}</p>
          <div className="flex flex-wrap gap-2">{roomButtons}</div>
        </div>
      )}
      <div className="flex items-center justify-end gap-3">
        {saveButton}
        {savedNote}
      </div>
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
    </div>
  );
}
