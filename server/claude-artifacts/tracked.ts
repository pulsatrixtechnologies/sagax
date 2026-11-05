/**
 * The claude.ai artifacts a person's bots published with that person's own
 * account (#2018), and the person's "Commentaires des artefacts" routine.
 * One small JSON file under the data dir.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { writeFileAtomic } from "../atomic.ts";

export interface TrackedArtifact {
  principalId: string;
  botId: string;
  url: string;
  title: string;
  seenAt: string;
}

interface TrackedFile {
  artifacts: TrackedArtifact[];
  /** principal -> routine id */
  routines: Record<string, string>;
}

const MAX_PER_PERSON = 200;

export class TrackedArtifactStore {
  private data: TrackedFile;

  private readonly path: string;
  private readonly now: () => Date;
  constructor(path: string, now: () => Date = () => new Date()) {
    this.path = path;
    this.now = now;
    this.data = this.load();
  }

  private load(): TrackedFile {
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as Partial<TrackedFile>;
      const artifacts = Array.isArray(parsed.artifacts) ? parsed.artifacts.filter((row): row is TrackedArtifact =>
        Boolean(row) && typeof row.principalId === "string" && typeof row.botId === "string" && typeof row.url === "string") : [];
      const routines = parsed.routines && typeof parsed.routines === "object" && !Array.isArray(parsed.routines) ? parsed.routines : {};
      return { artifacts, routines: Object.fromEntries(Object.entries(routines).filter(([, id]) => typeof id === "string")) };
    } catch {
      return { artifacts: [], routines: {} };
    }
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    writeFileAtomic(this.path, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
  }

  /** Records (or refreshes) one artifact. True when it is new for that person. */
  track(row: Omit<TrackedArtifact, "seenAt">): boolean {
    const principalId = row.principalId.trim().toLowerCase();
    const existing = this.data.artifacts.find((item) => item.principalId === principalId && item.url === row.url);
    const seenAt = this.now().toISOString();
    if (existing) {
      existing.botId = row.botId;
      if (row.title) existing.title = row.title;
      existing.seenAt = seenAt;
      this.save();
      return false;
    }
    this.data.artifacts.push({ principalId, botId: row.botId, url: row.url, title: row.title || "Page", seenAt });
    const mine = this.data.artifacts.filter((item) => item.principalId === principalId);
    if (mine.length > MAX_PER_PERSON) {
      const drop = new Set(mine.sort((a, b) => a.seenAt.localeCompare(b.seenAt)).slice(0, mine.length - MAX_PER_PERSON));
      this.data.artifacts = this.data.artifacts.filter((item) => !drop.has(item));
    }
    this.save();
    return true;
  }

  forPrincipal(principalId: string): TrackedArtifact[] {
    const key = principalId.trim().toLowerCase();
    return this.data.artifacts.filter((item) => item.principalId === key);
  }

  routineFor(principalId: string): string | undefined {
    return this.data.routines[principalId.trim().toLowerCase()];
  }

  setRoutine(principalId: string, routineId: string | undefined): void {
    const key = principalId.trim().toLowerCase();
    if (routineId) this.data.routines[key] = routineId;
    else delete this.data.routines[key];
    this.save();
  }
}
