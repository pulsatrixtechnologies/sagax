import { useState, type Dispatch } from "react";
import type { Action } from "@/state/store";
import { CommandAllowlistDialog } from "../CommandAllowlistDialog";
import { FullAccessWarning } from "../FullAccessWarning";
import { LocalComputerAutoWarning } from "../LocalComputerAutoWarning";

export function ComposerWarningDialogs({
  dispatch,
  perspicaxOrg,
  fullAccessAvailable,
}: {
  dispatch: Dispatch<Action>;
  perspicaxOrg: unknown;
  fullAccessAvailable: boolean;
}) {
  const [approvalWarning, setApprovalWarning] = useState<{
    mode: "auto" | "full";
    botId: string;
    threadId: string;
  } | null>(null);
  const [commandAllowlistTarget, setCommandAllowlistTarget] = useState<{ botId: string; botName: string; threadId: string } | null>(null);

  return (
    <div className="pointer-events-auto">
    {commandAllowlistTarget && <CommandAllowlistDialog
      key={`${commandAllowlistTarget.botId}:${commandAllowlistTarget.threadId}`}
      {...commandAllowlistTarget}
      presentation="detail"
      onClose={() => setCommandAllowlistTarget(null)}
    />}
    <FullAccessWarning
      open={approvalWarning?.mode === "full"}
      scope={perspicaxOrg ? "organization" : "thread"}
      onCancel={() => setApprovalWarning(null)}
      onConfirm={() => {
        const target = approvalWarning;
        setApprovalWarning(null);
        if (target?.mode !== "full" || !fullAccessAvailable) return;
        dispatch({ type: "updateTask", botId: target.botId, threadId: target.threadId,
          patch: { approvalMode: "full", confirmFullAccess: true, ...(perspicaxOrg ? { organizationFullAccess: true } : {}) } });
      }}
    />
    <LocalComputerAutoWarning
      open={approvalWarning?.mode === "auto"}
      onCancel={() => setApprovalWarning(null)}
      onConfirm={() => {
        if (approvalWarning?.mode === "auto") {
          dispatch({
            type: "updateTask",
            botId: approvalWarning.botId,
            threadId: approvalWarning.threadId,
            patch: { approvalMode: "auto", acknowledgeLocalAuto: true },
          });
        }
        setApprovalWarning(null);
      }}
    />
    </div>
  );
}
