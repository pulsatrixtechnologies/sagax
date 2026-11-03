// The artifact store (docs/superpowers/specs/2026-10-16-artifacts-design.md):
// every bot's saved widgets in one JSON file, written whole and atomically
// with mode 0600, like delegations.json. A bot reaches only its own
// artifacts (the tools pass the capability's bot id); the person's routes
// change only favorite and popped, and delete.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

import { artifactDocument, parseVersionList, rememberVersion, snapshotArtifact, type ArtifactVersion } from "./artifact-versions.ts";
import { writeFileAtomic } from "../atomic.ts";
import { redactSecretsInText } from "../redact.ts";
import {
  ARTIFACT_LIMITS, ARTIFACTS_FRAME, isArtifactId, parseArtifactFields,
  type Artifact, type ArtifactFields, type ArtifactsFrame,
} from "../../shared/artifacts.ts";

export type ArtifactResult =
  | { ok: true; artifact: Artifact }
  | { ok: false; status: 400 | 404 | 409; error: string };

export type ArtifactRun =
  | { ok: true; value: unknown }
  | {
    ok: false;
    error: string;
    /** The source needs a person: it never runs alone, and no failure is counted. */
    blocked?: boolean;
    /** It could not run yet (its computer is stopped): no failure is counted. */
    waiting?: boolean;
  };

export interface ArtifactStore {
  list(botId: string): Artifact[];
  all(): Artifact[];
  get(id: string): Artifact | null;
  create(botId: string, threadId: string | undefined, input: unknown, ownerPrincipalId?: string): ArtifactResult;
  /** A bot's change. `botId` must own the artifact. */
  update(botId: string, id: string, input: unknown): ArtifactResult;
  /** The person's change: favorite and popped only. */
  setFlags(id: string, flags: { favorite?: boolean; popped?: boolean }): ArtifactResult;
  remove(id: string, botId?: string): boolean;
  /** Forget every artifact of a bot that is gone. */
  removeBot(botId: string): number;
  /** The refresher's result for one run. */
  recordRun(id: string, run: ArtifactRun): Artifact | null;
  /** Clear a pause so the next tick runs it (Refresh now). */
  resume(id: string): Artifact | null;
  /** Earlier documents, oldest first. Empty until the document changes. */
  versions(id: string): ArtifactVersion[];
  /** Put one earlier document back. The file replace is a single rename. */
  restore(botId: string, id: string, rev: number): ArtifactResult;
}

const NO_SUCH = "No artifact with that id for this bot.";

function newArtifactId(): string {
  return `art_${randomBytes(9).toString("base64url")}`;
}

function oneLine(text: string): string {
  return redactSecretsInText(text.replace(/\s+/g, " ").trim()).slice(0, 300);
}

function isArtifact(value: unknown): value is Artifact {
  if (!value || typeof value !== "object") return false;
  const a = value as Partial<Artifact>;
  return isArtifactId(a.id) && typeof a.botId === "string" && typeof a.title === "string" && typeof a.html === "string"
    && typeof a.createdAt === "number" && typeof a.updatedAt === "number" && Boolean(a.refresh) && typeof a.refresh === "object";
}

/** The JSON a source answered with, or null when it is too large to keep. */
function boundedData(value: unknown): unknown | null {
  try {
    const text = JSON.stringify(value ?? null);
    return text.length <= ARTIFACT_LIMITS.data ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export function createArtifactStore(options: {
  file: string;
  now?: () => number;
  onChange?: (frame: ArtifactsFrame) => void;
}): ArtifactStore {
  const now = options.now ?? Date.now;
  const artifacts = new Map<string, Artifact>();
  const history = new Map<string, ArtifactVersion[]>();
  try {
    const parsed = JSON.parse(readFileSync(options.file, "utf8")) as { artifacts?: unknown; history?: unknown };
    for (const item of Array.isArray(parsed.artifacts) ? parsed.artifacts : []) {
      if (!isArtifact(item)) continue;
      artifacts.set(item.id, {
        ...item,
        favorite: item.favorite === true,
        popped: item.popped === true,
        rev: typeof item.rev === "number" ? item.rev : 1,
        refresh: { ...item.refresh, state: item.refresh.state ?? "idle", failures: Number(item.refresh.failures) || 0 },
      });
    }
    if (parsed.history && typeof parsed.history === "object" && !Array.isArray(parsed.history)) {
      for (const [id, list] of Object.entries(parsed.history as Record<string, unknown>)) {
        if (!isArtifactId(id)) continue;
        const versions = parseVersionList(list);
        if (versions.length) history.set(id, versions);
      }
    }
  } catch {
    // no file yet, or unreadable: start empty
  }

  /** A refresh result is not worth an fsync: losing the last one to a power
   * cut costs one more run. Anything the bot or the person changed is. */
  const save = (durable = true) => {
    const kept = Object.fromEntries([...history].filter(([, list]) => list.length > 0));
    writeFileAtomic(options.file, JSON.stringify({
      version: 1,
      artifacts: Array.from(artifacts.values()),
      ...(Object.keys(kept).length ? { history: kept } : {}),
    }), { mode: 0o600, durable });
  };
  const changed = (artifact: Artifact | null, botId: string, deleted = false, durable = true) => {
    save(durable);
    options.onChange?.({ kind: ARTIFACTS_FRAME, botId, ...(artifact ? { artifactId: artifact.id } : {}), ...(deleted ? { deleted: true } : {}) });
  };

  /** A new source or interval starts over: no failures, nothing blocked. */
  const sourceChanged = (next: Artifact): Artifact => ({ ...next, refresh: { state: "idle", failures: 0 } });

  const apply = (current: Artifact, fields: ArtifactFields, at: number): Artifact => {
    let next: Artifact = { ...current, updatedAt: at, rev: current.rev + 1 };
    if (fields.title !== undefined) next.title = fields.title;
    if (fields.html !== undefined) next.html = fields.html;
    if (fields.favorite !== undefined) next.favorite = fields.favorite;
    if (fields.popped !== undefined) next.popped = fields.popped;
    if (fields.bounds === null) delete next.bounds;
    else if (fields.bounds) next.bounds = fields.bounds;
    let sourceTouched = false;
    if (fields.source === null) {
      delete next.source;
      delete next.intervalSeconds;
      delete next.data;
      sourceTouched = true;
    } else if (fields.source) {
      next.source = fields.source;
      sourceTouched = true;
    }
    if (fields.intervalSeconds === null) {
      delete next.intervalSeconds;
      sourceTouched = true;
    } else if (fields.intervalSeconds !== undefined) {
      next.intervalSeconds = fields.intervalSeconds;
      sourceTouched = true;
    }
    if (sourceTouched) next = sourceChanged(next);
    if (fields.paused === true) next.refresh = { ...next.refresh, state: "paused" };
    else if (fields.paused === false && next.refresh.state === "paused") next.refresh = { ...next.refresh, state: "idle", failures: 0 };
    return next;
  };

  return {
    list(botId) {
      return Array.from(artifacts.values()).filter((artifact) => artifact.botId === botId);
    },
    all() {
      return Array.from(artifacts.values());
    },
    get(id) {
      return artifacts.get(id) ?? null;
    },
    create(botId, threadId, input, ownerPrincipalId) {
      const parsed = parseArtifactFields(input, true);
      if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
      if (this.list(botId).length >= ARTIFACT_LIMITS.perBot) {
        return { ok: false, status: 409, error: `You already keep ${ARTIFACT_LIMITS.perBot} artifacts. Delete one you no longer need first (list_artifacts, delete_artifact).` };
      }
      if (parsed.value.intervalSeconds && !parsed.value.source) {
        return { ok: false, status: 400, error: "interval_seconds needs a source to re-run." };
      }
      const at = now();
      const base: Artifact = {
        id: newArtifactId(),
        botId,
        ...(threadId ? { threadId } : {}),
        ...(ownerPrincipalId ? { ownerPrincipalId } : {}),
        title: parsed.value.title!,
        html: parsed.value.html!,
        favorite: false,
        popped: false,
        createdAt: at,
        updatedAt: at,
        rev: 0,
        refresh: { state: "idle", failures: 0 },
      };
      const artifact = { ...apply(base, parsed.value, at), rev: 1 };
      artifacts.set(artifact.id, artifact);
      changed(artifact, botId);
      return { ok: true, artifact };
    },
    update(botId, id, input) {
      const current = artifacts.get(id);
      if (!current || current.botId !== botId) return { ok: false, status: 404, error: NO_SUCH };
      const parsed = parseArtifactFields(input, false);
      if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
      const next = apply(current, parsed.value, now());
      if (next.intervalSeconds && !next.source) return { ok: false, status: 400, error: "interval_seconds needs a source to re-run." };
      if (artifactDocument(current) !== artifactDocument(next)) {
        history.set(id, rememberVersion(history.get(id) ?? [], snapshotArtifact(current)));
      }
      artifacts.set(id, next);
      changed(next, botId);
      return { ok: true, artifact: next };
    },
    setFlags(id, flags) {
      const current = artifacts.get(id);
      if (!current) return { ok: false, status: 404, error: "no such artifact" };
      const fields: ArtifactFields = {};
      if (typeof flags.favorite === "boolean") fields.favorite = flags.favorite;
      if (typeof flags.popped === "boolean") fields.popped = flags.popped;
      if (fields.favorite === undefined && fields.popped === undefined) return { ok: false, status: 400, error: "send favorite or popped" };
      const next = apply(current, fields, now());
      artifacts.set(id, next);
      changed(next, next.botId);
      return { ok: true, artifact: next };
    },
    remove(id, botId) {
      const current = artifacts.get(id);
      if (!current || (botId !== undefined && current.botId !== botId)) return false;
      artifacts.delete(id);
      history.delete(id);
      changed(current, current.botId, true);
      return true;
    },
    removeBot(botId) {
      let removed = 0;
      for (const artifact of Array.from(artifacts.values())) {
        if (artifact.botId !== botId) continue;
        artifacts.delete(artifact.id);
        history.delete(artifact.id);
        removed += 1;
      }
      if (removed) changed(null, botId);
      return removed;
    },
    recordRun(id, run) {
      const current = artifacts.get(id);
      if (!current) return null;
      const at = now();
      let next: Artifact;
      if (run.ok) {
        const value = boundedData(run.value);
        next = value === null
          ? { ...current, refresh: { state: "error", failures: current.refresh.failures + 1, lastRunAt: at, ...(current.refresh.lastOkAt ? { lastOkAt: current.refresh.lastOkAt } : {}), error: `The answer is larger than ${ARTIFACT_LIMITS.data} characters of JSON.` } }
          : { ...current, data: { at, value }, refresh: { state: "ok", failures: 0, lastRunAt: at, lastOkAt: at } };
      } else if (run.waiting) {
        next = {
          ...current,
          refresh: { ...current.refresh, state: current.refresh.state === "paused" ? "paused" : "error", lastRunAt: at, error: oneLine(run.error) || "Waiting." },
        };
      } else {
        const failures = run.blocked ? current.refresh.failures : current.refresh.failures + 1;
        next = {
          ...current,
          refresh: {
            state: run.blocked ? "blocked" : failures >= ARTIFACT_LIMITS.maxFailures ? "paused" : "error",
            failures,
            lastRunAt: at,
            ...(current.refresh.lastOkAt ? { lastOkAt: current.refresh.lastOkAt } : {}),
            error: oneLine(run.error) || "The source failed.",
          },
        };
      }
      next.rev = current.rev + 1;
      artifacts.set(id, next);
      changed(next, next.botId, false, false);
      return next;
    },
    resume(id) {
      const current = artifacts.get(id);
      if (!current) return null;
      if (current.refresh.state !== "paused" && current.refresh.state !== "blocked" && current.refresh.state !== "error") return current;
      const next: Artifact = { ...current, rev: current.rev + 1, refresh: { ...current.refresh, state: "idle", failures: 0 } };
      artifacts.set(id, next);
      changed(next, next.botId);
      return next;
    },
    versions(id) {
      return (history.get(id) ?? []).map((item) => JSON.parse(JSON.stringify(item)) as ArtifactVersion);
    },
    restore(botId, id, rev) {
      const current = artifacts.get(id);
      if (!current || current.botId !== botId) return { ok: false, status: 404, error: NO_SUCH };
      const found = (history.get(id) ?? []).find((item) => item.rev === rev);
      if (!found) return { ok: false, status: 404, error: "No saved version with that number." };
      if (artifactDocument(current) === artifactDocument(found)) return { ok: true, artifact: current };
      const kept = JSON.parse(JSON.stringify(found)) as ArtifactVersion;
      history.set(id, rememberVersion(history.get(id) ?? [], snapshotArtifact(current)));
      const at = now();
      const next: Artifact = {
        ...current,
        title: kept.title,
        html: kept.html,
        updatedAt: at,
        rev: current.rev + 1,
        refresh: { state: "idle", failures: 0 },
      };
      if (kept.source) next.source = kept.source;
      else delete next.source;
      if (kept.intervalSeconds !== undefined) next.intervalSeconds = kept.intervalSeconds;
      else delete next.intervalSeconds;
      if (kept.data) next.data = kept.data;
      else delete next.data;
      artifacts.set(id, next);
      // One replace: the live document and the list move together.
      changed(next, botId);
      return { ok: true, artifact: next };
    },
  };
}
