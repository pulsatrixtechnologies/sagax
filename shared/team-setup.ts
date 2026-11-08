import type { ModelSelection } from "./model-selection.ts";

export interface TeamSetupFields {
  name?: string;
  title?: string;
  description?: string;
  soul?: string;
  /** Create only: the folder the new bot's tools work in. "" = private workspace. */
  cwd?: string;
  section?: string;
  modelSelection?: ModelSelection;
  chiefOfStaff?: boolean;
}

export interface TeamSetupOperation {
  action: "create" | "update";
  botId: string;
  threadId?: string;
  fields: TeamSetupFields;
  expectedRevision?: string;
}

export interface TeamSetupResult {
  state: "applied" | "denied" | "cancelled" | "failed";
  bots: Array<{ id: string; name: string; action: "created" | "updated" | "deleted"; section?: string; modelSelection?: ModelSelection; chiefOfStaff?: boolean }>;
  newTeams: string[];
  error?: string;
}

/** The complete, reviewed operation. It never accepts executable permissions. */
export interface TeamSetupRequest {
  version: 1;
  requestId: string;
  botId: string;
  threadId: string;
  reason: string;
  createdAt: number;
  requesterRevision: string;
  operations: TeamSetupOperation[];
  newTeams: string[];
  deletion?: { botId: string; name: string; expectedRevision: string };
  /** #2669: import a marketplace plugin as a new team (import_plugin_team).
   * `bots` is the preview the card shows: each agent and its model. */
  pluginImport?: { marketplace: string; plugin: string; team: string; bots: Array<{ name: string; model?: string; tools?: string[] }>; skipped?: string[] };
  /** The Chief suggested this bot without being asked. It always waits on
   * the card, and a "Not now" answer is remembered in its conversation. */
  suggestion?: true;
  result?: TeamSetupResult;
  resumed?: boolean;
}

/** 2026-10-26 (#1058): why "Apply setup" was refused, read by the app in
 * its own language (src/lib/team-setup-error-text.ts). */
export const TEAM_SETUP_ADMIN_REQUIRED = "team_setup_admin_required";
export const TEAM_SETUP_DESKTOP_ONLY = "team_setup_desktop_only";
