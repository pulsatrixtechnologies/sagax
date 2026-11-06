import type { Action, Message } from "./model";
import type { Routine } from "@/lib/routines";
import { dataSheetFromResponse, dataTablesFromResponse, PERSON_THREADS_HEADER } from "./model";
import { MESSAGE_PAGE_SIZE, api } from "./api";
import { readableError } from "@/lib/plain-error";
import { createAnswerErrorMessage, recoverCreatedRoutineAfterLostAnswer } from "@/lib/routine-save-recovery";
import { DATA_ROUTES, withDataThread } from "../../../shared/data-surface";
import { ROUTINE_CONVERSATION_HEADER } from "../../../shared/wire";
import { t } from "@/lib/i18n";
import type { DispatchEnv } from "./dispatch-types";

export function dispatchRoutinesEffects(action: Action, env: DispatchEnv): void {
  const {
    rawDispatch, stateRef, showError, olderPagesInFlight, waitForExecutionSettings,
    executionBotsBeforeAction,
  } = env;
  switch (action.type) {
        case "loadOlderMessages": {
          // The reducer's flag is for the UI; this set is the guard, because
          // `stateRef` still holds the state from before this dispatch.
          if (olderPagesInFlight.has(action.threadId)) break;
          olderPagesInFlight.add(action.threadId);
          const current = stateRef.current;
          const owner = [...current.bots, ...current.groups].find((candidate) => candidate.threadId === action.threadId);
          const before = owner?.messages[0]?.id;
          // The transcript this page is being asked about. `loadOlderMessages`
          // does not move it, so the value here is the one the reducer will
          // compare against when the answer lands.
          const generation = current.transcriptGeneration[action.threadId] ?? 0;
          // Nothing to page back from: the reducer's loading flag would never
          // be cleared by a response that is not coming.
          if (!before) {
            olderPagesInFlight.delete(action.threadId);
            rawDispatch({ type: "olderMessages", threadId: action.threadId, generation, messages: [], hasMore: false });
            break;
          }
          api<{ messages: Message[]; hasMore?: boolean }>(
            `/api/threads/${action.threadId}/messages?limit=${MESSAGE_PAGE_SIZE}&before=${encodeURIComponent(before)}`,
          )
            .finally(() => olderPagesInFlight.delete(action.threadId))
            .then((page) => rawDispatch({
              type: "olderMessages",
              threadId: action.threadId,
              generation,
              messages: page.messages ?? [],
              hasMore: Boolean(page.hasMore),
            }))
            .catch((error) => {
              // Clear the flag on the way out, or the pill stays disabled for
              // the rest of the session after one failed page.
              rawDispatch({ type: "olderMessages", threadId: action.threadId, generation, messages: [], hasMore: true });
              showError(error);
            });
          break;
        }
        case "notice":
          if (action.notice) setTimeout(() => rawDispatch({ type: "notice", notice: null }), 6000);
          break;
        case "createRoutine": {
          // #1753: /loop and other createRoutine callers share the #1522
          // lost-answer guard so a proxy cut never shows a raw status or
          // invites a duplicate create.
          const knownRoutineIds = new Set(stateRef.current.routines.map((routine) => routine.id));
          const wanted = { name: action.input.name, botId: action.input.botId, target: action.input.target };
          void api("/api/routines", { method: "POST", body: JSON.stringify(action.input) })
            .catch(async (error) => {
              const created = await recoverCreatedRoutineAfterLostAnswer(
                error,
                knownRoutineIds,
                wanted,
                () => api("/api/routines") as Promise<{ routines?: Routine[] }>,
              );
              if (created) {
                rawDispatch({ type: "routinePatched", routine: created });
                return;
              }
              showError(createAnswerErrorMessage(error, t("routineCalendar.saveAnswerLost")));
            });
          break;
        }
        case "updateRoutine": {
          // Switched on or off while its bot's conversation is open: that
          // conversation gets the "Disabled · 1 routine" line (the server
          // checks the routine is that bot's and the thread the person's).
          const open = stateRef.current.bots.find((candidate) => candidate.id === stateRef.current.selectedId);
          const conversation = action.patch.enabled !== undefined && open?.threadId ? open.threadId : null;
          // The switch moves at once; a refused request puts it back (#2320).
          const before = action.patch.enabled !== undefined ? stateRef.current.routines.find((routine) => routine.id === action.routineId) : undefined;
          if (before && action.patch.enabled !== undefined) rawDispatch({ type: "routinePatched", routine: { ...before, enabled: action.patch.enabled } });
          api(`/api/routines/${action.routineId}`, {
            method: "PATCH",
            body: JSON.stringify(action.patch),
            ...(conversation ? { headers: { "content-type": "application/json", [PERSON_THREADS_HEADER]: "1", [ROUTINE_CONVERSATION_HEADER]: conversation } } : {}),
          }).catch((error) => {
            if (before) rawDispatch({ type: "routinePatched", routine: before });
            showError(error);
          });
          break;
        }
        case "deleteRoutine":
          api(`/api/routines/${action.routineId}`, { method: "DELETE" }).catch(showError);
          break;
        case "runRoutine":
          void waitForExecutionSettings(executionBotsBeforeAction)
            .then(() => api(`/api/routines/${action.routineId}/run`, { method: "POST" }))
            .then(({ run }) => action.onStarted?.(run))
            .catch((error) => {
              if (action.onError) action.onError(error);
              else showError(error);
            })
            .finally(() => action.onSettled?.());
          break;
        case "cancelRoutineRun":
          api(`/api/routine-runs/${action.runId}/cancel`, { method: "POST" }).catch(showError);
          break;
        // The Data tab's sheet. The panel runs and cancels SQL itself (it
        // owns the request to abort); those answer through the server's
        // `data` frame (the whole sheet), so every window sees the same
        // cards. A panel-local onError keeps a server without the surface
        // from raising the app-wide error line.
        case "loadDataSheet":
          api(withDataThread(DATA_ROUTES.sheet(action.botId), action.threadId))
            .then((body) => rawDispatch({ type: "dataSheet", sheet: dataSheetFromResponse(body, action.botId), tables: dataTablesFromResponse(body), ...(action.threadId ? { threadId: action.threadId } : {}) }))
            .catch((error) => (action.onError ?? showError)(readableError(error)));
          break;
        case "markRoutineRunSeen":
          api(`/api/routine-runs/${action.runId}/seen`, { method: "POST" }).catch(showError);
          break;
        case "markAllRoutineRunsSeen":
          api("/api/routine-runs/seen-all", { method: "POST" }).catch(showError);
          break;
        case "clearRoutineRuns":
          api("/api/routine-runs", { method: "DELETE" })
            .then(({ removed }) => rawDispatch({ type: "routineRunsRemoved", ids: Array.isArray(removed) ? removed : [] }))
            .catch(showError);
          break;
        case "cancelQueued":
          void api(`/api/bots/${action.botId}/queue/${action.queueId}`, { method: "DELETE", body: JSON.stringify({ threadId: action.threadId }) })
            .then(() => {
              rawDispatch(action);
              action.onCancelled?.();
            })
            .catch(showError);
          break;
        case "steerQueued":
          void api(`/api/bots/${action.botId}/queue/${action.queueId}/steer`, { method: "POST", body: JSON.stringify({ threadId: action.threadId }) })
            .then((body) => {
              if (body?.steered === true && Array.isArray(body.messages) && typeof body.threadId === "string") {
                for (const message of body.messages) {
                  rawDispatch({ type: "messageAdded", threadId: body.threadId, message });
                }
                for (const queueId of body.queueIds ?? []) {
                  rawDispatch({ type: "consumePendingQueued", threadId: body.threadId, queueId });
                }
              } else if (body?.queued === true && body.blockedBy === "images") {
                // Pressed Steer, but the engine cannot take pictures mid-turn:
                // say why the message is still queued instead of nothing.
                rawDispatch({ type: "notice", notice: { kind: "steer-images", botName: null } });
              }
              action.onSettled?.();
            })
            .catch((error) => {
              showError(error);
              action.onError?.();
            });
          break;
        case "cancelGroupQueued":
          void api(`/api/groups/${action.groupId}/queue/${action.queueId}`, { method: "DELETE" })
            .then(() => {
              rawDispatch(action);
              action.onCancelled?.();
            })
            .catch(showError);
          break;
        case "steerGroupQueued":
          void api(`/api/groups/${action.groupId}/queue/${action.queueId}/steer`, {
            method: "POST",
            body: JSON.stringify({ threadId: action.threadId }),
          })
            .then((body) => {
              if (body?.steered === true && Array.isArray(body.messages) && typeof body.threadId === "string") {
                for (const message of body.messages) {
                  rawDispatch({ type: "messageAdded", threadId: body.threadId, message });
                }
                for (const queueId of body.queueIds ?? []) {
                  rawDispatch({ type: "consumePendingQueued", threadId: body.threadId, queueId });
                }
              } else if (body?.queued === true && body.blockedBy === "images") {
                // Pressed Steer, but the engine cannot take pictures mid-turn:
                // say why the message is still queued instead of nothing.
                rawDispatch({ type: "notice", notice: { kind: "steer-images", botName: null } });
              }
              action.onSettled?.();
            })
            .catch((error) => {
              showError(error);
              action.onError?.();
            });
          break;
  }
}
