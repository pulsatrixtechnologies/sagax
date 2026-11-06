import { useState, type Dispatch } from "react";
import type { Action } from "@/state/store";
import { CommandAllowlistDialog } from "../CommandAllowlistDialog";
import { LocalComputerAutoWarning } from "../LocalComputerAutoWarning";

export function ComposerWarningDialogs({
  dispatch,
}: {
  dispatch: Dispatch<Action>;
  perspicaxOrg?: unknown;
  fullAccessAvailable?: boolean;
}) {
  const [approvalWarning, setApprovalWarning] = useState<{
    mode: "auto";
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
