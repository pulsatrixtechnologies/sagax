import type { Dispatch } from "react";
import { CodingChat } from "../coding/CodingChat";
import type { Action, Bot } from "@/state/store";
import type { SideChat } from "./sideChat";

/** Coding chat overlay owned by the main chat. */
export function ChatViewSheets({
  side,
  state,
  dispatch,
}: {
  side?: SideChat;
  state: {
    codingChat: { botId: string; itemId: string } | null | undefined;
  };
  sheetRun?: unknown;
  sheetRoutine?: unknown;
  storeBots?: readonly Bot[];
  dispatch: Dispatch<Action>;
}) {
  return (
    <>
      {!side && state.codingChat && (
        <CodingChat
          key={`${state.codingChat.botId}:${state.codingChat.itemId}`}
          target={state.codingChat}
          onClose={() => dispatch({ type: "closeCodingChat" })}
        />
      )}
    </>
  );
}
