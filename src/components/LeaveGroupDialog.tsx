// The confirmation before leaving a group chat (#1480): the sidebar's menu,
// the conversation's « … » and the group panel open the same one.
import type { RefObject } from "react";
import { LogOut } from "lucide-react";

import { t } from "@/lib/i18n";
import { leaveOutcome } from "@/lib/group-leave";
import type { Group } from "@/state/store";
import { useStoreDispatch, useStoreSelector } from "@/state/store-selector";
import { ConfirmDialog } from "./ConfirmDialog";

export function leaveGroupCopy(group: Pick<Group, "name" | "ownerId" | "humanIds" | "dm" | "peopleDm">, outcome: ReturnType<typeof leaveOutcome>) {
  return {
    title: t("room.leave.title", { name: group.name }),
    body: [
      t("room.leave.body"),
      // #2119: sole-member leave is refused in the menu; keep the last copy
      // for a defensive dialog if somehow opened.
      outcome === "owner" ? t("room.leave.owner") : outcome === "last" ? t("room.leave.last") : "",
    ].filter(Boolean).join(" "),
    confirmLabel: t("groupPanel.leave"),
    tone: "danger" as const,
  };
}

export function LeaveGroupDialog({ groupId, onClose, returnFocusRef }: { groupId: string | null; onClose: () => void; returnFocusRef?: RefObject<HTMLElement | null> }) {
  // closed, it reads nothing that changes: a bot's frame renders nothing here (#3624)
  const dispatch = useStoreDispatch();
  const group = useStoreSelector((current) => (groupId ? current.groups.find((candidate) => candidate.id === groupId) : undefined));
  const config = useStoreSelector((current) => (group ? current.config : null));
  return (
    <ConfirmDialog
      open={Boolean(group)}
      {...leaveGroupCopy(group ?? { name: "" }, group ? leaveOutcome(group, config) : "member")}
      icon={<LogOut size={18} />}
      {...(returnFocusRef ? { returnFocusRef } : {})}
      onCancel={onClose}
      onConfirm={() => {
        // read the group from live state: it may be gone already
        const id = group?.id;
        onClose();
        if (id) dispatch({ type: "leaveGroup", groupId: id });
      }}
    />
  );
}
