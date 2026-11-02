// Create, rename or manage bots of a team: right DetailPanel on the team map
// (2026-11-01 lot 6, no modals). Create from the sidebar opens the map with
// this panel. Nested "New bot" stays in the same panel as a view (lot 4).
import { viewerActorId } from "@/lib/viewer";
import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { api, useStore, type Bot } from "@/state/store";
import { teamMapMutationError } from "@/lib/team-map-access";
import { BotPickerList } from "./BotPickerList";
import { NewBotDialog } from "./lazy-new-bot";
import { DetailPanel } from "./DetailPanel";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { FIELD, FieldRow, HelpTip, PILL, PRIMARY_PILL, SettingsGroup, GROUP_CARD } from "./SettingsPrimitives";

/** A team may start empty; choosing bots moves their membership, never copies them. */
export function TeamDialog({ section, rename = false, onClose, onRenamed }: {
  section?: string;
  rename?: boolean;
  onRenamed?: (oldName: string, newName: string) => void;
  onClose: () => void;
}) {
  const { state, dispatch } = useStore();
  const [name, setName] = useState(section ?? "");
  const managing = Boolean(section) && !rename;
  const initialMembers = useRef(new Set(managing ? state.bots.filter(bot => !bot.hidden && (bot.section?.trim() ?? "") === section).map(bot => bot.id) : []));
  const [picked, setPicked] = useState<Set<string>>(() => new Set(initialMembers.current));
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (bodyRef.current?.querySelector<HTMLElement>("input") ?? bodyRef.current?.querySelector<HTMLElement>("button"))?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);
  useEffect(() => {
    if (!creating) (bodyRef.current?.querySelector<HTMLElement>("input") ?? bodyRef.current?.querySelector<HTMLElement>("button"))?.focus();
  }, [creating]);
  const moving = section !== undefined && !rename;
  const title = rename ? t("team.rename") : managing ? t(initialMembers.current.size ? "team.manageBots" : "team.addBots") : moving ? t("team.moveTo", { name: section || t("sidebar.section.general") }) : t("team.create");
  const candidates = state.bots.filter((bot) => !bot.hidden && (managing || !moving || (bot.section?.trim() ?? "") !== section));
  const addBotIds = [...picked].filter(id => !initialMembers.current.has(id));
  const removeBotIds = [...initialMembers.current].filter(id => !picked.has(id));
  const unchanged = managing ? !addBotIds.length && !removeBotIds.length : moving && !picked.size;
  const save = async () => {
    if (saving || (!moving && !name.trim()) || unchanged) return;
    if (section === undefined && [...(state.sections ?? []), ...state.bots.map((bot) => bot.section), ...state.groups.map((group) => group.section)].includes(name.trim())) {
      setError(t("team.duplicate"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result: { sections: string[]; bots?: Bot[] } = await api(
        rename || managing ? `/api/sidebar-sections?section=${encodeURIComponent(section!)}` : "/api/sidebar-sections",
        { method: rename ? "PATCH" : managing ? "PUT" : "POST", body: JSON.stringify(rename ? { name: name.trim() } : managing ? { addBotIds, removeBotIds } : { name: name.trim(), botIds: [...picked] }) },
      );
      dispatch({ type: "sections", sections: result.sections });
      for (const bot of result.bots ?? []) dispatch({ type: "botPatched", bot });
      if (rename && section !== undefined) onRenamed?.(section, name.trim());
      onCloseRef.current();
    } catch (cause) {
      setError(teamMapMutationError(cause));
      setSaving(false);
    }
  };

  if (creating) {
    return (
      <DetailPanel
        label={t("sidebar.newBot")}
        title={t("sidebar.newBot")}
        onClose={() => setCreating(false)}
        closeLabel={t("common.cancel")}
        data-team-dialog="new-bot"
        bare
      >
        <NewBotDialog
          section={section}
          preserveSelection
          presentation="view"
          onClose={() => setCreating(false)}
          onCreated={(bot) => {
            initialMembers.current.add(bot.id);
            setPicked((previous) => new Set([...previous, bot.id]));
            setCreating(false);
          }}
        />
      </DetailPanel>
    );
  }

  return (
    <DetailPanel
      label={title}
      title={title}
      onClose={() => { if (!saving) onClose(); }}
      closeLabel={t("team.closeDialog")}
      data-team-dialog=""
      footer={
        <>
          {managing && (
            <button type="button" disabled={saving || state.botCreationPending} onClick={() => setCreating(true)} className={`${PILL} mr-auto`}>
              <Plus size={14} aria-hidden="true" />{t("sidebar.newBot")}
            </button>
          )}
          <button type="button" disabled={saving} onClick={onClose} className={PILL}>{t("common.cancel")}</button>
          <button type="button" disabled={saving || (!moving && !name.trim()) || unchanged} onClick={() => void save()} className={PRIMARY_PILL}>
            {saving ? t("team.saving") : rename ? t("folder.saveName") : managing ? t("common.save") : moving ? picked.size ? t(picked.size === 1 ? "team.moveOne" : "team.moveMany", { count: picked.size }) : t("team.moveSelected") : t("team.create")}
          </button>
        </>
      }
    >
      <div ref={bodyRef} className="flex flex-col gap-5">
        {(!moving || rename) && (
          <div className={GROUP_CARD}>
            <FieldRow label={t("team.name")}>
              <input
                value={name}
                maxLength={60}
                disabled={saving}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") void save(); }}
                className={FIELD}
              />
            </FieldRow>
          </div>
        )}
        {!rename && (
          <fieldset disabled={saving} className="min-w-0">
            <SettingsGroup
              groupId="team-bots"
              title={t("team.existingBots")}
              accessory={
                <>
                  <HelpTip label={t("settings.moreAbout", { title: t("team.existingBots") })}>
                    {managing ? t("team.manageIntro") : moving ? t("team.moveIntro") : t("team.createIntro")} {t("team.moveWarning")}
                  </HelpTip>
                  {candidates.length > 0 && <span className="ml-auto text-[12.5px] tabular-nums text-ink-secondary">{picked.size}/{candidates.length}</span>}
                </>
              }
            >
              <div className="px-1.5">
                <BotPickerList
                  bots={candidates}
                  viewerId={viewerActorId(state.config)}
                  picked={picked}
                  emptyHint={t("team.noBots")}
                  onToggle={(id) => setPicked((previous) => {
                    const next = new Set(previous);
                    if (next.has(id)) next.delete(id); else next.add(id);
                    return next;
                  })}
                />
              </div>
            </SettingsGroup>
          </fieldset>
        )}
        {error && <p role="alert" className={cn("px-1 text-[12.5px] text-danger")}>{error}</p>}
      </div>
    </DetailPanel>
  );
}
