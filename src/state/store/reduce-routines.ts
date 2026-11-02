// Domain slice of the client store reduce(routines).
// Returns the next state when it handles the action, otherwise undefined.
import type {Action, AppState} from "./model";
import {trimRoutineRuns} from "./model";

export type ReduceFn = (state: AppState, action: Action) => AppState;

export function reduceRoutines(state: AppState, action: Action, _reduce: ReduceFn): AppState | undefined {
  switch (action.type) {
    case "routinesHydrated":
      return { ...state, routines: action.routines, routineRuns: trimRoutineRuns(action.runs), routinesLoadState: "ready", ...(action.folders ? { routineFolders: action.folders } : {}) };
    case "routineFoldersPatched":
      return { ...state, routineFolders: { ...state.routineFolders, [action.botId]: action.folders } };
    case "routinesLoadFailed":
      return { ...state, routinesLoadState: "error" };
    case "routinePatched": {
      const exists = state.routines.some((routine) => routine.id === action.routine.id);
      return {
        ...state,
        routines: exists
          ? state.routines.map((routine) => (routine.id === action.routine.id ? action.routine : routine))
          : [action.routine, ...state.routines],
      };
    }
    case "routineDeleted":
      return { ...state, routines: state.routines.filter((routine) => routine.id !== action.routineId) };
    case "routineRunsRemoved": {
      const gone = new Set(action.ids);
      return { ...state, routineRuns: state.routineRuns.filter((run) => !gone.has(run.id)) };
    }
    case "routineRunPatched": {
      const exists = state.routineRuns.some((run) => run.id === action.run.id);
      const runs = exists
        ? state.routineRuns.map((run) => (run.id === action.run.id ? action.run : run))
        : [action.run, ...state.routineRuns];
      return {
        ...state,
        routineRuns: trimRoutineRuns(runs),
      };
    }
    case "webhooksHydrated":
      return { ...state, webhooks: action.webhooks, webhookAttempts: action.attempts, webhookIngress: action.ingress, webhookGraphConnectors: action.graphConnectors ?? [] };
    case "webhookPatched": {
      const exists = state.webhooks.some((webhook) => webhook.id === action.webhook.id);
      return {
        ...state,
        webhooks: exists
          ? state.webhooks.map((webhook) => (webhook.id === action.webhook.id ? action.webhook : webhook))
          : [action.webhook, ...state.webhooks],
      };
    }
    case "webhookDeleted":
      return {
        ...state,
        webhooks: state.webhooks.filter((webhook) => webhook.id !== action.webhookId),
        webhookAttempts: state.webhookAttempts.filter((attempt) => attempt.webhookId !== action.webhookId),
      };
    case "webhookAttempted": {
      const attempts = state.webhookAttempts.some((attempt) => attempt.id === action.attempt.id)
        ? state.webhookAttempts.map((attempt) => attempt.id === action.attempt.id ? action.attempt : attempt)
        : [...state.webhookAttempts, action.attempt];
      return { ...state, webhookAttempts: attempts.slice(-2_000) };
    }
  }
  return undefined;
}
