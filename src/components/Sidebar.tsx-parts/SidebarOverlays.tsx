import { editSectionParents, removeFromSectionTree } from "@/lib/section-tree";
import type { SidebarState } from "./types";
import { createPortal } from "react-dom";
import type { ReactNode, RefObject } from "react";
import { Archive, Trash2 } from "lucide-react";
import { api, type Bot, type Group } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { PrimaryBotPicker } from "../PrimaryBotPicker";
import { ConfirmDialog } from "../ConfirmDialog";
import { BulkEditBotsDialog } from "../lazy-screens";
import { LeaveGroupDialog } from "../LeaveGroupDialog";
import { ShareTeamDialog } from "../ShareTeamDialog";
import { TeamDialog } from "../TeamDialog";
import { TeamSettingsDialog } from "../TeamSettingsDialog";
import { OrgSectionMenuItems, orgSectionMenuItems, type OrgSectionMenuActions } from "../OrgSectionMenu";
import { navigateThreadMenu } from "../BotProjects";
import {
  deletePersonalSection,
  personalSectionNames,
  writePersonalSections,
} from "@/lib/personal-sections";
import { saveCollapsedSections } from "@/lib/sidebar-preferences";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { viewerActorId } from "@/lib/viewer";
import { SectionPicker } from "./SectionPicker";
import { TeamMenuItems } from "./TeamMenuItems";
import { roomDeleteCopy } from "./helpers";

export function SidebarOverlays(props: {
  state: SidebarState;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dispatch: (action: any) => void;
  sidebarRef: RefObject<HTMLElement | null>;
  remoteClient: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  actions: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sections: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  multi: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dnd: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  roster: any;
  roomMenuSlot: ReactNode;
}) {
  const { state, dispatch, sidebarRef, remoteClient, actions, sections, multi, dnd, roster, roomMenuSlot } = props;
  const {
    archiveBot, primaryPicker, setPrimaryPicker, makePrimaryBot,
    sectionPicker, setSectionPicker, roomSectionPicker, setRoomSectionPicker,
    deletingRoomId, setDeletingRoomId, leavingRoomId, setLeavingRoomId,
    setTeamFeedback,
  } = actions;
  const {
    personal, layoutBots, layoutGroups, collapsedSections, setCollapsedSections,
    assignSection, teamMotion, closeTeamMenu, teamMenuReturn, shareTeamAnchor,
    orgMenu, closeOrgMenu, setSectionEdit, deletingTeam, setDeletingTeam,
    teamDeletePending, setTeamDeletePending, teamDeleteRunning, moveToTeam, setMoveToTeam,
    renameTeam, setRenameTeam, shareTeam, setShareTeam, teamSettings, setTeamSettings, renamedTeam,
  } = sections;
  const teamSettingsAllowed = useOwnerOrAdmin();
  const {
    selectedBotIds, batchEdit, setBatchEdit, batchSectionPicker, setBatchSectionPicker,
    batchArchiveConfirm, setBatchArchiveConfirm, clearSelection, archivableByViewer,
  } = multi;
  const { layoutInteractive, moveSidebarSection } = dnd;
  const { sidebarBots, sectionIds, generalOnTop } = roster;


  const deletingRoom = deletingRoomId ? state.groups.find((g) => g.id === deletingRoomId) : undefined;

  return (
    <>
      <PrimaryBotPicker
        open={primaryPicker !== null}
        bots={sidebarBots}
        viewerId={viewerActorId(state.config)}
        currentId={primaryPicker?.currentId ?? null}
        pending={primaryPicker?.pending}
        error={primaryPicker?.error}
        onCancel={() => setPrimaryPicker(null)}
        onConfirm={(botId) => void makePrimaryBot(botId, true)}
      />
      {renameTeam && <TeamDialog section={renameTeam} rename onRenamed={renamedTeam} onClose={() => setRenameTeam(null)} />}
      {orgMenu && createPortal(<div className="fixed inset-0 z-40" onMouseDown={closeOrgMenu} onContextMenu={(event) => { event.preventDefault(); closeOrgMenu(); }}>
        <div role="menu" aria-label={orgMenu.name ?? t("teamLibrary.general")} style={{ left: orgMenu.x, top: orgMenu.y }} data-org-section-menu
          className="absolute w-[220px] min-w-[200px] rounded-xl border-[0.5px] border-border bg-elevated p-1.5 flex flex-col gap-0.5 text-[13px] leading-[18px] text-ink"
          onMouseDown={event => event.stopPropagation()} onKeyDown={event => {
            if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); event.stopPropagation(); closeOrgMenu(); return; }
            navigateThreadMenu(event);
          }}>
          {(() => {
            const position = orgMenu.id ? sectionIds.indexOf(orgMenu.id) : -1;
            const anyExpanded = sectionIds.some((sid: string) => !collapsedSections.includes(sid));
            const actions: OrgSectionMenuActions = {
              onRename: () => { closeOrgMenu(); if (orgMenu.name) setSectionEdit({ mode: "rename", name: orgMenu.name }); },
              onMoveUp: () => { closeOrgMenu(); if (orgMenu.id) moveSidebarSection(orgMenu.id, -1); },
              onMoveDown: () => { closeOrgMenu(); if (orgMenu.id) moveSidebarSection(orgMenu.id, 1); },
              onCollapseAll: () => { closeOrgMenu(); setCollapsedSections([...sectionIds]); saveCollapsedSections([...sectionIds]); },
              onExpandAll: () => { closeOrgMenu(); setCollapsedSections([]); saveCollapsedSections([]); },
              onDelete: () => { closeOrgMenu(); if (orgMenu.name) setDeletingTeam(orgMenu.name); },
            };
            const items = orgSectionMenuItems({
              named: Boolean(orgMenu.name),
              canMoveUp: position > (generalOnTop ? 1 : 0) && layoutInteractive,
              canMoveDown: position >= (generalOnTop ? 1 : 0) && position < sectionIds.length - 1 && layoutInteractive,
              anyExpanded,
            });
            return <OrgSectionMenuItems items={items} actions={actions} />;
          })()}
        </div>
      </div>, document.body)}
      {teamMotion.shown && teamMotion.value && createPortal(<div className={cn("fixed inset-0 z-40", teamMotion.closing && "pointer-events-none")} onMouseDown={closeTeamMenu}>
        <div role="menu" aria-label={teamMotion.value.name} style={{ left: teamMotion.value.x, top: teamMotion.value.y }}
          className={cn("absolute w-[220px] min-w-[200px] rounded-xl border-[0.5px] border-border bg-elevated p-1.5 flex flex-col gap-0.5 text-[13px] leading-[18px] text-ink", teamMotion.className)} {...teamMotion.exitProps}
          onMouseDown={event => event.stopPropagation()} onKeyDown={event => {
            if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); event.stopPropagation(); closeTeamMenu(); return; }
            navigateThreadMenu(event);
          }}>
          <TeamMenuItems
            onAddBots={() => { closeTeamMenu(); setMoveToTeam(teamMotion.value!.name); }}
            onRename={() => { closeTeamMenu(); setRenameTeam(teamMotion.value!.name); }}
            onShare={() => {
              shareTeamAnchor.current = teamMenuReturn.current;
              closeTeamMenu();
              setShareTeam(teamMotion.value!.name);
            }}
            onDelete={() => { closeTeamMenu(); setDeletingTeam(teamMotion.value!.name); }}
            onSetForAll={teamSettingsAllowed === true ? () => { closeTeamMenu(); setTeamSettings(teamMotion.value!.name); } : undefined}
          />
        </div>
      </div>, document.body)}
      <ConfirmDialog open={deletingTeam !== null} title={t("team.deleteTitle", { name: deletingTeam ?? "" })}
        body={t("team.deleteKeepBotsDescription")} confirmLabel={t("team.delete")} returnFocusRef={sidebarRef}
        pending={teamDeletePending}
        onCancel={() => { if (!teamDeleteRunning.current) setDeletingTeam(null); }} onConfirm={() => {
          const name = deletingTeam;
          if (!name || teamDeleteRunning.current) return;
          // Organization: the viewer's own section goes, its bots, groups and
          // conversations go back to Unassigned; nothing else changes.
          if (personal) {
            writePersonalSections(deletePersonalSection(personal, name));
            editSectionParents((tree) => removeFromSectionTree(tree, name));
            setDeletingTeam(null);
            return;
          }
          teamDeleteRunning.current = true;
          setTeamDeletePending(true);
          void api<{ sections: string[] }>(`/api/sidebar-sections?section=${encodeURIComponent(name)}`, { method: "DELETE" })
            .then(({ sections }) => { dispatch({ type: "sectionDeleted", section: name, sections }); editSectionParents((tree) => removeFromSectionTree(tree, name)); setDeletingTeam(null); })
            .catch(cause => setTeamFeedback({ error: true, text: readableError(cause) }))
            .finally(() => { teamDeleteRunning.current = false; setTeamDeletePending(false); });
        }} />
      {moveToTeam && <TeamDialog section={moveToTeam} onClose={() => setMoveToTeam(null)} />}
      <ShareTeamDialog
        key={shareTeam === null ? "share-team-closed" : `share-team:${shareTeam}`}
        open={shareTeam !== null}
        team={shareTeam ?? ""}
        anchorRef={shareTeamAnchor}
        onClose={() => setShareTeam(null)}
      />
      {teamSettings !== null && <TeamSettingsDialog team={teamSettings} onClose={() => setTeamSettings(null)} />}
      {batchEdit && (
        <BulkEditBotsDialog
          botIds={selectedBotIds}
          onClose={() => setBatchEdit(false)}
        />
      )}
      <SectionPicker
          current={undefined}
          names={personal ? personalSectionNames(personal) : undefined}
          anchor={batchSectionPicker}
          onClose={() => setBatchSectionPicker(null)}
          onAssign={(section) => {
            const ids = selectedBotIds.filter((id: string) => state.bots.some((bot) => bot.id === id));
            if (!personal && remoteClient) {
              // one request for the whole selection
              void api("/api/sidebar-sections", { method: "POST", body: JSON.stringify({ name: section, botIds: ids }) })
                .then(({ bots }) => bots.forEach((bot: Bot) => dispatch({ type: "botPatched", bot })))
                .catch((cause) => dispatch({ type: "error", message: readableError(cause) }));
            } else {
              for (const id of ids) assignSection("bot", id, section);
            }
            clearSelection();
          }}
        />
      <ConfirmDialog
        open={batchArchiveConfirm}
        title={t("sidebar.select.archiveTitle", { count: selectedBotIds.filter((id: string) => archivableByViewer(id)).length })}
        body={t("sidebar.select.archiveBody")}
        confirmLabel={t("sidebar.bot.archive")}
        icon={<Archive size={18} />}
        onCancel={() => setBatchArchiveConfirm(false)}
        returnFocusRef={sidebarRef}
        onConfirm={() => {
          setBatchArchiveConfirm(false);
          // never the last active bot: the guard reads one snapshot, so cap here
          const keep = state.bots.filter((bot) => !bot.hidden).length - 1;
          const ids = selectedBotIds.filter((id: string) => archivableByViewer(id)).slice(0, Math.max(0, keep));
          clearSelection();
          void (async () => { for (const id of ids) await archiveBot({ id }); })();
        }}
      />
      <SectionPicker
          current={sectionPicker ? layoutBots.find((b: Bot) => b.id === sectionPicker.botId)?.section : undefined}
          names={personal ? personalSectionNames(personal) : undefined}
          anchor={sectionPicker}
          onClose={() => setSectionPicker(null)}
          onAssign={(section) => {
            if (sectionPicker) assignSection("bot", sectionPicker.botId, section);
          }}
        />
      {roomMenuSlot}
      <LeaveGroupDialog groupId={leavingRoomId} onClose={() => setLeavingRoomId(null)} returnFocusRef={sidebarRef} />
      <ConfirmDialog
        open={deletingRoom !== undefined}
        {...roomDeleteCopy(deletingRoom ?? { name: "" })}
        icon={<Trash2 size={18} />}
        returnFocusRef={sidebarRef}
        onCancel={() => setDeletingRoomId(null)}
        onConfirm={() => {
          // Read the room from live state: it may have been removed elsewhere
          // while the dialog was open.
          const groupId = deletingRoom?.id;
          setDeletingRoomId(null);
          if (groupId) dispatch({ type: "deleteGroup", groupId });
        }}
      />
      <SectionPicker
          current={roomSectionPicker ? layoutGroups.find((g: Group) => g.id === roomSectionPicker.groupId)?.section : undefined}
          names={personal ? personalSectionNames(personal) : undefined}
          anchor={roomSectionPicker}
          onClose={() => setRoomSectionPicker(null)}
          onAssign={(section) => {
            if (roomSectionPicker) assignSection("group", roomSectionPicker.groupId, section);
          }}
        />
    </>
  );
}
