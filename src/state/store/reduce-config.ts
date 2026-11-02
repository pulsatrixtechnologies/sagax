// Domain slice of the client store reduce(config).
// Returns the next state when it handles the action, otherwise undefined.
import type {Action, AppState} from "./model";
import {withMascotMotion} from "./model";
import {neutralNoRoute} from "@/lib/no-route";

export type ReduceFn = (state: AppState, action: Action) => AppState;

export function reduceConfig(state: AppState, action: Action, _reduce: ReduceFn): AppState | undefined {
  switch (action.type) {
    case "instances":
      return { ...state, instances: action.instances };
    case "configStatus":
      return { ...state, config: action.config };
    case "liveCall":
      return { ...state, liveCall: action.call, liveCallVersion: state.liveCallVersion + 1 };
    case "liveCallLookup":
      return action.since === state.liveCallVersion && action.seq > state.liveCallLookupSeq
        ? { ...state, liveCall: action.call, liveCallLookupSeq: action.seq }
        : state;
    case "profileSaved":
      return state.config ? {
        ...state,
        config: { ...state.config, profile: { name: "", email: "", ...state.config.profile, ...action.profile } },
      } : state;
    case "connected":
      if (action.value) {
        return { ...state, connected: true, everConnected: true, disconnectedAt: null };
      }
      return {
        ...state,
        connected: false,
        disconnectedAt: state.connected ? Date.now() : (state.disconnectedAt ?? Date.now()),
      };
    case "error":
      return {
        ...(action.message && state.selectedId
          ? withMascotMotion(state, state.selectedId, "alert")
          : state),
        // The banner's safety net: an older server's "no route" text, from
        // whatever path it came, reads as the neutral line.
        error: action.message ? neutralNoRoute(action.message) : action.message,
      };
    // bot settings, the computer panel, and app settings share the right slot
    case "notice":
      return { ...state, notice: action.notice };
  }
  return undefined;
}
