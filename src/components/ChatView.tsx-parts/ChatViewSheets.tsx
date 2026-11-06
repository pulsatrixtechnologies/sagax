import type { Dispatch } from "react";
import { CodingChat } from "../coding/CodingChat";
import { RoutineRunWindow, type RoutineRunWindowTarget } from "../routines/RoutineRunWindow";
import type { Action, Bot } from "@/state/store";
import type { SideChat } from "./sideChat";

/** What opens over the main chat column: a routine run's window (#2272,
 * shaped like a bot-to-bot exchange) or a coding task's chat. */
export function ChatViewSheets({
  side,
  state,
  storeBots = [],
  dispatch,
}: {
  side?: SideChat;
  state: {
    codingChat: { botId: string; itemId: string } | null | undefined;
    routineRunWindow?: RoutineRunWindowTarget | null;
  };
  storeBots?: readonly Bot[];
  dispatch: Dispatch<Action>;
}) {
  return (
    <>
      {!side && state.routineRunWindow && (
        <RoutineRunWindow
          key={state.routineRunWindow.runId}
          target={state.routineRunWindow}
          bots={storeBots}
          onClose={() => dispatch({ type: "closeRoutineRunWindow" })}
          onStop={(runId) => dispatch({ type: "cancelRoutineRun", runId })}
        />
      )}
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
