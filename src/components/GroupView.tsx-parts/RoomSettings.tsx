import { ChevronDown, FolderOpen } from "lucide-react";
import { useState } from "react";
import { t } from "@/lib/i18n";
import { api, useStore, type Bot, type ConfigStatus, type Group, type GroupDefaultResponder } from "@/state/store";
import { defaultResponderName, effectiveDefaultResponder, jevRoomRoutingOn } from "@/lib/group-routing";
import { viewerCan } from "@/lib/viewer";
import { viewerIsOrgAdmin } from "@/lib/group-owner";
import { permissionMissingText } from "@/lib/permissions";
import { useDesktopCapabilities } from "../DesktopCapabilities";
import { Switch } from "../SettingsPrimitives";
import { shortPath } from "@/lib/short-path";
import { readableError } from "@/lib/plain-error";

export function DefaultResponderSelect({ group, members, disabled = false }: { group: Group; members: Bot[]; disabled?: boolean }) {
  const { state, dispatch } = useStore();
  const jevOn = jevRoomRoutingOn(state.config);
  const responder = effectiveDefaultResponder(group, members);
  const value = responder.kind === "member" ? `member:${responder.botId}` : responder.kind;
  const lead = responder.kind === "member" ? members.find((member) => member.id === responder.botId) : undefined;
  const title =
    responder.kind === "everyone"
      ? t("room.responder.everyone")
      : responder.kind === "mentions"
        ? t("room.responder.mentions")
        : responder.kind === "auto"
          ? jevOn
            ? t("room.responder.auto")
            : t("room.responder.autoOff", { name: defaultResponderName(group, members) ?? t("room.responder.leadFallback") })
          : t("room.responder.lead", { name: lead?.name ?? t("room.responder.leadFallback") });

  const change = (nextValue: string) => {
    let next: GroupDefaultResponder;
    if (nextValue === "everyone") next = { kind: "everyone" };
    else if (nextValue === "mentions") next = { kind: "mentions" };
    // The lead a room had stays on as Auto's fallback.
    else if (nextValue === "auto") next = responder.kind === "member" ? { kind: "auto", fallbackBotId: responder.botId } : { kind: "auto" };
    else next = { kind: "member", botId: nextValue.slice("member:".length) };
    dispatch({ type: "patchGroup", groupId: group.id, patch: { defaultResponder: next } });
  };

  return (
    <div className="relative rounded-xl bg-card p-3" title={title}>
      <select
        aria-label={t("room.responder.aria")}
        value={value}
        disabled={disabled}
        onChange={(event) => change(event.target.value)}
        className="h-8 w-full appearance-none truncate rounded-lg border border-hairline/40 bg-raised/60 py-1 pl-3 pr-7 text-[12.5px] font-medium text-ink outline-none hover:bg-raised focus:border-accent"
      >
        <optgroup label={t("room.responder.groupLead")}>
          {members.map((member) => (
            <option key={member.id} value={`member:${member.id}`}>
              {t("room.responder.leadOption", { name: member.name })}
            </option>
          ))}
        </optgroup>
        <optgroup label={t("room.responder.groupBehavior")}>
          <option value="auto">{jevOn ? t("room.responder.autoOption") : t("room.responder.autoOptionOff")}</option>
          <option value="everyone">{t("room.responder.everyoneOption")}</option>
          <option value="mentions">{t("room.responder.mentionsOption")}</option>
        </optgroup>
      </select>
      <ChevronDown
        size={13}
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-secondary"
      />
    </div>
  );
}

/** Whether @all notifies every person in the room (server/rooms/room-mentions.ts).
 * A person tagged by name is notified either way. The owner's setting. */
export function RoomMentionAll({ group, disabled = false }: { group: Group; disabled?: boolean }) {
  const { dispatch } = useStore();
  const on = group.mentionAll === true;
  return (
    <div className="flex items-start gap-3 rounded-xl bg-card p-3">
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium text-ink">{t("room.mentionAll.label")}</div>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">{on ? t("room.mentionAll.on") : t("room.mentionAll.off")}</p>
      </div>
      <Switch
        checked={on}
        disabled={disabled}
        aria-label={t("room.mentionAll.label")}
        onClick={() => dispatch({ type: "patchGroup", groupId: group.id, patch: { mentionAll: !on } })}
      />
    </div>
  );
}

/** The room's shared desk: where every member's shell and file tools run,
 * overriding each bot's own folder for room turns. The room pins its own
 * copy on its first turn (the server does the pinning — engines key their
 * sessions to the folder a thread starts in, so a folder must not move
 * under a room that already worked somewhere). The PATCH is made directly
 * rather than through patchGroup: the server validates the path and a
 * rejected folder must not stick in local state. */
/** Who may set a group's working folder (#1098, 2026-10-28): a solo
 * server's group, an admin, or a person holding folders.roomWorkingFolder
 * (every member does); the panel still asks that they own the group. */
export function roomFolderEditable(group: Pick<Group, "ownerId">, config: ConfigStatus | null | undefined): boolean {
  return group.ownerId === undefined || viewerIsOrgAdmin(config) || viewerCan(config, "folders.roomWorkingFolder");
}

export function RoomWorkingFolder({ group, disabled = false, adminOnlyNote = false }: { group: Group; disabled?: boolean; adminOnlyNote?: boolean }) {
  const { capabilities } = useDesktopCapabilities();
  const home = capabilities.host.homeDir;
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canPick = Boolean(window.ogb?.pickFolder);
  const pinned = group.pinnedCwd; // undefined = not yet, null = each bot's own, string = folder
  const locked = pinned !== undefined;
  const shownCwd = locked ? (pinned ?? undefined) : group.cwd;

  const save = async (cwd: string | null) => {
    setSaving(true);
    setError(null);
    try {
      await api(`/api/groups/${group.id}`, { method: "PATCH", body: JSON.stringify({ cwd }) });
      setDraft(null);
    } catch (e) {
      setError(readableError(e));
    } finally {
      setSaving(false);
    }
  };
  const pick = async () => {
    const chosen = await window.ogb?.pickFolder?.(group.cwd);
    if (chosen) void save(chosen);
  };

  return (
    <div className="rounded-xl bg-card p-4">
      <div className="text-[15px] font-medium text-ink">{t("room.folder.title")}</div>
      <div className="mt-0.5 text-[13px] text-ink-secondary">{t("room.folder.detail")}</div>
      {locked || disabled ? (
        <div className="mt-3">
          <div className="truncate rounded-lg border border-hairline/40 bg-inset px-3 py-2 font-mono text-[12.5px] text-ink" title={shownCwd}>
            {shownCwd ? shortPath(shownCwd, home) : <span className="text-ink-secondary">{t("room.folder.own")}</span>}
          </div>
          {!locked && adminOnlyNote && (
            <div className="mt-2 text-[12px] text-ink-secondary">{permissionMissingText("folders.roomWorkingFolder")}</div>
          )}
          {locked && (
            <div className="mt-2 text-[12px] text-ink-secondary">
              {t("room.folder.locked")}
            </div>
          )}
        </div>
      ) : canPick ? (
        <div className="mt-3 flex items-center gap-2">
          <div className="min-w-0 flex-1 truncate rounded-lg border border-hairline/40 bg-inset px-3 py-2 font-mono text-[12.5px] text-ink" title={group.cwd}>
            {group.cwd ? shortPath(group.cwd, home) : <span className="text-ink-secondary">{t("room.folder.own")}</span>}
          </div>
          <button onClick={() => void pick()} disabled={saving} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-raised px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50">
            <FolderOpen size={14} /> {t("room.folder.choose")}
          </button>
          {group.cwd && (
            <button onClick={() => void save(null)} disabled={saving} className="shrink-0 rounded-lg px-2 py-2 text-[13px] text-ink-secondary hover:text-ink disabled:opacity-50">
              {t("keys.clear")}
            </button>
          )}
        </div>
      ) : (
        <form
          className="mt-3 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            // an emptied field clears the folder — the server wants null
            void save((draft ?? group.cwd ?? "").trim() || null);
          }}
        >
          <input
            className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2.5 font-mono text-[12.5px] text-ink placeholder:text-ink-secondary focus:outline-none"
            placeholder={t("room.folder.placeholder")}
            value={draft ?? group.cwd ?? ""}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" disabled={saving || draft === null} className="shrink-0 rounded-lg bg-raised px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50">
            {t("common.save")}
          </button>
        </form>
      )}
      {error && <div className="mt-2 text-[12px] text-danger">{error}</div>}
    </div>
  );
}
