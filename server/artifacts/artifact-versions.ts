// Earlier documents of one artifact. The live artifact stays in artifacts.json.
// Each kept document is the title, html, source and last data from before a
// real change. Favorite, window position and a refresh result are not versions.
//
// A restore writes the live artifact and this list in the same file replace
// (writeFileAtomic), so a crash leaves the previous pair or the new pair.

import { parseArtifactSource, type Artifact, type ArtifactSource } from "../../shared/artifacts.ts";

export const ARTIFACT_VERSION_CAP = 30;

export interface ArtifactVersion {
  rev: number;
  at: number;
  title: string;
  html: string;
  source?: ArtifactSource;
  intervalSeconds?: number;
  data?: { at: number; value: unknown };
}

/** The document a version restores. Flags and refresh state are not part of it. */
export function artifactDocument(artifact: Pick<Artifact, "title" | "html" | "source" | "intervalSeconds" | "data">): string {
  return JSON.stringify({
    title: artifact.title,
    html: artifact.html,
    source: artifact.source ?? null,
    intervalSeconds: artifact.intervalSeconds ?? null,
    data: artifact.data ?? null,
  });
}

export function snapshotArtifact(artifact: Artifact): ArtifactVersion {
  const snap: ArtifactVersion = {
    rev: artifact.rev,
    at: artifact.updatedAt,
    title: artifact.title,
    html: artifact.html,
    ...(artifact.source ? { source: artifact.source } : {}),
    ...(artifact.intervalSeconds !== undefined ? { intervalSeconds: artifact.intervalSeconds } : {}),
    ...(artifact.data ? { data: artifact.data } : {}),
  };
  return JSON.parse(JSON.stringify(snap)) as ArtifactVersion;
}

/** Keep the newest documents, and do not store the same rev twice. */
export function rememberVersion(versions: readonly ArtifactVersion[], snapshot: ArtifactVersion): ArtifactVersion[] {
  const next = versions.some((item) => item.rev === snapshot.rev) ? [...versions] : [...versions, snapshot];
  return next.slice(-ARTIFACT_VERSION_CAP);
}

function readData(value: unknown): ArtifactVersion["data"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as { at?: unknown; value?: unknown };
  if (typeof row.at !== "number" || !Number.isFinite(row.at)) return undefined;
  return { at: row.at, value: row.value };
}

/** Drop a row the file cannot restore. Never throws. */
export function parseVersionList(value: unknown): ArtifactVersion[] {
  if (!Array.isArray(value)) return [];
  const out: ArtifactVersion[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Partial<ArtifactVersion>;
    if (!Number.isInteger(row.rev) || typeof row.at !== "number" || typeof row.title !== "string" || typeof row.html !== "string") continue;
    const source = row.source === undefined ? undefined : parseArtifactSource(row.source);
    const data = readData(row.data);
    out.push({
      rev: row.rev as number,
      at: row.at,
      title: row.title,
      html: row.html,
      ...(source?.ok ? { source: source.value } : {}),
      ...(typeof row.intervalSeconds === "number" ? { intervalSeconds: row.intervalSeconds } : {}),
      ...(data ? { data } : {}),
    });
  }
  return out.slice(-ARTIFACT_VERSION_CAP);
}
