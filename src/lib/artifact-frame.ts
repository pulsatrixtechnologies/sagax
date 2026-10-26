// What an artifact frame says when a visualization does not come up
// (parité chat 35): a script error, or more than 10 seconds with no size.

export const ARTIFACT_ERROR_MESSAGE = "sagax-artifact-error";
export const ARTIFACT_START_LIMIT_MS = 10_000;

export type ArtifactProblem = "slow" | "script";

/** The next notice. A script error wins. A size report clears a slow start.
 * A slow start never hides a script error. */
export function nextArtifactProblem(current: ArtifactProblem | null, event: "ready" | "slow" | "script"): ArtifactProblem | null {
  if (event === "script") return "script";
  if (event === "ready") return current === "slow" ? null : current;
  if (event === "slow") return current ?? "slow";
  return current;
}
