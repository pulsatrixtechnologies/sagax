import { t } from "@/lib/i18n";
import type { Bot, Group } from "@/state/store";
import { ChannelMembers } from "../ChannelMembers";
import { GroupPeoplePicker } from "../GroupPeoplePicker";
import { GroupBotPicker } from "../GroupBotPicker";
import { PanelSection } from "../GroupPanel";
import { botPublicProfile } from "../../../shared/bot-public-profile";
import { botLabel } from "@/lib/human-label";
import { groupLeadBotId, leadResponder } from "@/lib/group-panel";
import type { useGroupRoomModel } from "./useGroupRoomModel";

type Model = ReturnType<typeof useGroupRoomModel>;

/** People + bots roster sections for the group panel. */
export function GroupRoomRoster({
  group,
  members,
  model,
}: {
  group: Group;
  members: Bot[];
  model: Model;
}) {
  const {
    dispatch, perspicaxOrg, orgDirectory, viewerId, ownsRoom, remoteClient,
    channelHumans, roster, ownBotIds, addableBots, canAddRosterBot,
    peoplePickerOpen, botsPickerOpen, rosterPick, setRosterPick,
    toggleRoster, addHuman, addRoomBot,
  } = model;

  return (
    <>
      <PanelSection title={t("groupPanel.people")}>
        <ChannelMembers
          part="humans"
          humans={channelHumans}
          bots={[]}
          onOpenHuman={perspicaxOrg ? (id) => dispatch({ type: "openPersonPanel", personId: id.replace(/^user:/, "") }) : undefined}
          {...roster}
          onAddHuman={() => toggleRoster("people")}
          onRemoveHuman={(id) => {
            dispatch({
              type: "patchGroup",
              groupId: group.id,
              patch: { humanIds: (group.humanIds ?? []).filter((humanId) => humanId.trim().toLowerCase() !== id.trim().toLowerCase()) },
            });
          }}
        />
        {peoplePickerOpen && roster.canAddHuman && (
          <GroupPeoplePicker
            directory={orgDirectory}
            taken={[viewerId, ...(group.humanIds ?? [])]}
            organization={perspicaxOrg !== null}
            showDone={rosterPick !== "both"}
            autoFocus={rosterPick === "people" || rosterPick === "both"}
            onAdd={addHuman}
            onDone={() => setRosterPick(null)}
          />
        )}
      </PanelSection>
      <PanelSection title={t("sidebar.section.bots")}>
        <ChannelMembers
          part="bots"
          humans={[]}
          bots={group.memberIds.map((id) => {
            const bot = members.find((item) => item.id === id);
            // The owner removes any bot; anyone else only their own.
            const removable = ownsRoom || ownBotIds.has(id);
            return bot ? { ...botPublicProfile(bot), name: botLabel(bot.name, id), removable } : { id, name: botLabel(null, id), removable };
          })}
          {...roster}
          addBotLabel={ownsRoom ? undefined : t("channelMembers.addMyBot")}
          leadBotId={groupLeadBotId(group, members)}
          {...(ownsRoom && !remoteClient ? { onSetLead: (id: string) => dispatch({ type: "patchGroup", groupId: group.id, patch: { defaultResponder: leadResponder(group, members, id) } }) } : {})}
          onRemoveBot={(id) => {
            dispatch({ type: "patchGroup", groupId: group.id, patch: { memberIds: group.memberIds.filter((memberId) => memberId !== id) } });
          }}
          canAddBot={canAddRosterBot}
          onAddBot={() => toggleRoster("bots")}
        />
        {botsPickerOpen && (
          <GroupBotPicker
            bots={addableBots}
            emptyHint={t(ownsRoom ? "manageMembers.empty" : "manageMembers.emptyOwn")}
            showDone={rosterPick !== "both"}
            autoFocus={rosterPick === "bots"}
            onAdd={addRoomBot}
            onDone={() => setRosterPick(null)}
          />
        )}
        {botsPickerOpen && !ownsRoom && <p className="px-1 text-[12px] text-ink-secondary">{t("manageMembers.ownOnly")}</p>}
        {rosterPick === "both" && (
          <button type="button" data-roster-done="" onClick={() => setRosterPick(null)} className="self-end rounded-md px-2 py-1 text-[12px] text-ink-secondary hover:bg-control hover:text-ink">
            {t("room.people.done")}
          </button>
        )}
      </PanelSection>
    </>
  );
}
