import { useEffect, useMemo, useState } from "react";
import { t } from "@/lib/i18n";
import { api, type Group } from "@/state/store";
import { useStore } from "@/state/store";
import { viewerActorId } from "@/lib/viewer";
import { viewerOwnsGroup } from "@/lib/group-owner";
import { channelRosterActions } from "../ChannelMembers";
import { useOrgDirectory } from "../GroupPeoplePicker";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { groupHumanLabel } from "@/lib/private-threads";
import { addableRosterBots } from "@/lib/room-members";
import { groupMemberBots } from "@/lib/group-members";
import { botPublicProfile } from "../../../shared/bot-public-profile";
import { personAvatarSrc } from "@/lib/profile-management";
import { botLabel } from "@/lib/human-label";
import { channelHumanRow, ORG_PROBE_INIT, useOrgPeople } from "@/lib/perspicax-org";
import { useRemoteClient } from "@/lib/render-reads";
import { roomFolderEditable } from "./RoomSettings";
import { canLeaveGroup } from "@/lib/group-leave";

/** Who the remote client is signed in as, and their role in the organization;
 * no one when either request fails. */
async function loadRemoteActor(): Promise<{ id: string; role: "owner" | "admin" | "member" | null }> {
  try {
    const session = await api<{ email?: string }>("/api/auth/session");
    const org = await api<{ people?: { id: string; role: "owner" | "admin" | "member" }[] }>("/api/org", ORG_PROBE_INIT);
    const id = typeof session.email === "string" ? session.email.trim().toLowerCase() : "";
    const role = org.people?.find((person) => person.id.trim().toLowerCase() === id)?.role ?? null;
    return { id, role };
  } catch {
    return { id: "", role: null };
  }
}

export function useGroupRoomModel(group: Group) {
  const { state, dispatch } = useStore();
  const remoteClient = useRemoteClient();
  const [remoteActor, setRemoteActor] = useState<{ id: string; role: "owner" | "admin" | "member" | null }>({ id: "", role: null });
  useEffect(() => {
    if (!remoteClient) return;
    let cancelled = false;
    void loadRemoteActor().then((actor) => { if (!cancelled) setRemoteActor(actor); });
    return () => { cancelled = true; };
  }, [remoteClient]);

  const [rosterPick, setRosterPick] = useState<null | "people" | "bots" | "both">(null);
  const perspicaxOrg = usePerspicaxOrg();
  const orgDirectory = useOrgDirectory(perspicaxOrg !== null && !group.dm);
  const orgPeople = useOrgPeople();
  const viewerId = viewerActorId(state.config);
  const viewerEmail = state.config?.profile?.email?.trim().toLowerCase() || "";
  const viewerName = state.config?.profile?.name?.trim() || viewerEmail || "Vous";
  const viewer = state.config?.viewer;
  const ownsRoom = viewerOwnsGroup(group, state.config);
  const editable = !remoteClient && ownsRoom;
  const folderEditable = roomFolderEditable(group, state.config);
  const mayLeave = canLeaveGroup(group, state.config, remoteClient);

  const members = useMemo(() => groupMemberBots(group, state.bots), [group, state.bots]);
  const viewerAvatar = personAvatarSrc(state.config?.profile?.avatarUrl);
  const channelHumans = [
    { id: viewerId, label: viewerName, detail: viewerEmail && viewerName !== viewerEmail ? viewerEmail : undefined, ...(viewerAvatar ? { avatarUrl: viewerAvatar } : {}), removable: false as boolean },
    ...(group.humanIds ?? [])
      .map((id) => id.trim().toLowerCase())
      .filter((id) => id && id !== viewerId && id !== viewerEmail)
      .map((id) => {
        const row = channelHumanRow(id.replace(/^user:/, ""), orgPeople);
        const known = row.label !== row.id;
        return { ...row, id, label: known ? row.label : groupHumanLabel(id, orgDirectory), removable: ownsRoom };
      }),
  ];
  const actorId = viewer ? viewerId : remoteClient ? remoteActor.id : viewerId;
  const roster = channelRosterActions({
    actorRole: viewer ? viewer.role : remoteClient ? remoteActor.role : "owner",
    actorId,
    bots: state.bots,
    ownsRoom,
    memberIds: group.memberIds,
  });
  const ownBotIds = new Set(state.bots.filter((bot) => actorId !== "" && (bot.ownerUserId ?? "").trim().toLowerCase() === actorId).map((bot) => bot.id));
  const addableBots = useMemo(
    () => addableRosterBots(state.bots, { memberIds: group.memberIds, ownsRoom, actorId }).map((bot) => ({
      ...botPublicProfile(bot),
      name: botLabel(bot.name, bot.id),
    })),
    [state.bots, group.memberIds, ownsRoom, actorId],
  );
  const canAddRosterBot = addableBots.length > 0;
  const canManageRoster = ownsRoom || roster.canAddHuman || ownBotIds.size > 0;
  const toggleRoster = (next: "people" | "bots" | "both") => {
    setRosterPick((current) => (current === next ? null : next));
  };
  useEffect(() => setRosterPick(null), [group.id]);

  const manageMembersButton = (
    <button
      type="button"
      data-manage-members-open=""
      onClick={() => toggleRoster(roster.canAddHuman ? "both" : "bots")}
      className="self-start rounded-lg bg-raised px-3 py-2 text-[13px] text-ink hover:bg-raised-hover"
    >
      {t(roster.canAddHuman ? "room.members.manage" : "room.members.manageBots")}
    </button>
  );
  const addHuman = (principalId: string) => {
    const id = principalId.trim().toLowerCase();
    if (!id) return;
    const humanIds = [...new Set([...(group.humanIds ?? []).map((entry) => entry.trim().toLowerCase()), id])];
    dispatch({ type: "patchGroup", groupId: group.id, patch: { humanIds } });
  };
  const addRoomBot = (id: string) => {
    if (!id || group.memberIds.includes(id)) return;
    dispatch({ type: "patchGroup", groupId: group.id, patch: { memberIds: [...group.memberIds, id] } });
  };
  const peoplePickerOpen = rosterPick === "people" || rosterPick === "both";
  const botsPickerOpen = rosterPick === "bots" || rosterPick === "both";

  return {
    state,
    dispatch,
    remoteClient,
    perspicaxOrg,
    orgDirectory,
    orgPeople,
    viewerId,
    members,
    ownsRoom,
    editable,
    folderEditable,
    mayLeave,
    channelHumans,
    roster,
    ownBotIds,
    addableBots,
    canAddRosterBot,
    canManageRoster,
    manageMembersButton,
    addHuman,
    addRoomBot,
    peoplePickerOpen,
    botsPickerOpen,
    rosterPick,
    setRosterPick,
    toggleRoster,
  };
}
