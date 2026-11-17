// #4525: Claude's ArtifactData write asks the person to read a consent
// disclosure (localDisplayOnly). Sagax shows that text on the existing
// approval card and remembers the agreement per bot. Deletes and access
// changes stay on their own card. Reads are unchanged.
import { ARTIFACT_READ_ACTIONS } from "./claude-chat-blocks.ts";

export const ARTIFACT_DATA_TOOL = "ArtifactData";

/** Database writes the remembered agreement covers. */
export const ARTIFACT_DATA_WRITE_ACTIONS: ReadonlySet<string> = new Set([
  "set", "write", "write_db", "insert", "update", "upsert", "put", "append", "create", "add", "patch",
]);

/** Still asked one at a time: a delete or an access change is not a database write grant. */
const HELD_BACK = new Set(["delete", "remove", "access_change"]);

/** Tool result and routine problem line when nobody has approved the disclosure yet. */
export const ARTIFACT_DATA_CONSENT_UNATTENDED =
  "ArtifactData writes need the person to approve the consent disclosure once in a conversation. This unattended routine cannot show it, so the write did not run.";

/** Card subtitle when Claude sends the ask without the disclosure text. */
export const ARTIFACT_DATA_CONSENT_FALLBACK =
  "ArtifactData wants to write its database. Approving lets this bot write it from now on, including routines that run with nobody watching.";

export function artifactDataAction(input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  const action = (input as { action?: unknown }).action;
  return typeof action === "string" ? action.trim().toLowerCase() : "";
}

export function isArtifactDataTool(name: string | undefined): boolean {
  const tool = (name ?? "").trim();
  return tool === ARTIFACT_DATA_TOOL || tool.endsWith(`__${ARTIFACT_DATA_TOOL}`);
}

/** A database write whose disclosure the person reads once. */
export function isArtifactDataWriteConsent(tool: string | undefined, input: unknown): boolean {
  if (!isArtifactDataTool(tool)) return false;
  const action = artifactDataAction(input);
  if (!action || ARTIFACT_READ_ACTIONS.has(action) || HELD_BACK.has(action)) return false;
  return ARTIFACT_DATA_WRITE_ACTIONS.has(action);
}

/** The routine problem sentence when a tool result is this denial, else null. */
export function artifactDataConsentProblem(output: string | undefined): string | null {
  if (!output?.includes(ARTIFACT_DATA_CONSENT_UNATTENDED)) return null;
  return ARTIFACT_DATA_CONSENT_UNATTENDED;
}
