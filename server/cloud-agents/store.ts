// Per-bot cloud agent job records (local mirror of provider state).
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { writeFileAtomic } from "../atomic.ts";
import { CLOUD_AGENT_PROVIDERS, type CloudAgentRecord, type CloudAgentRepoRef, type CloudAgentProviderId, type CloudAgentStatus } from "../../shared/cloud-agents.ts";

const repoSchema = z.object({
  url: z.string().min(1).max(2_048),
  ref: z.string().max(256).optional(),
  prUrl: z.string().max(2_048).optional(),
}).strict();

const gitBranchSchema = z.object({
  repoUrl: z.string().max(2_048).optional(),
  branch: z.string().max(256).optional(),
  prUrl: z.string().max(2_048).optional(),
}).strict();

const statsSchema = z.object({
  files: z.number().int().min(0),
  added: z.number().int().min(0),
  removed: z.number().int().min(0),
  commits: z.number().int().min(0),
}).strict();

const prSchema = z.object({
  number: z.number().int().min(1),
  url: z.string().max(2_048),
  state: z.enum(["draft", "open", "merged", "closed"]),
}).strict();

const recordSchema = z.object({
  id: z.string().regex(/^ca_[0-9a-f-]{36}$/),
  botId: z.string().min(1).max(80).optional(),
  threadId: z.string().min(1).max(80).optional(),
  principalId: z.string().min(1).max(120),
  provider: z.enum(CLOUD_AGENT_PROVIDERS),
  externalId: z.string().min(1).max(200),
  name: z.string().max(200),
  status: z.enum(["queued", "creating", "running", "waiting_for_approval", "idle", "finished", "failed", "cancelled", "expired", "archived"]),
  createdAt: z.number(),
  updatedAt: z.number(),
  startedAt: z.number(),
  endedAt: z.number().optional(),
  latestRunId: z.string().max(200).optional(),
  url: z.string().max(2_048).optional(),
  model: z.string().max(200).optional(),
  repos: z.array(repoSchema),
  gitBranches: z.array(gitBranchSchema),
  lastResult: z.string().max(100_000).optional(),
  error: z.string().max(4_000).optional(),
  archived: z.boolean(),
  completionNotified: z.boolean(),
  pendingFollowUp: z.object({ text: z.string().max(50_000), at: z.number() }).strict().optional(),
  stats: statsSchema.optional(),
  pr: prSchema.optional(),
  unread: z.boolean().optional(),
  envId: z.string().max(80).optional(),
  origin: z.enum(["console", "sagax", "mcp", "automation"]).optional(),
}).strict();

const fileSchema = z.object({
  version: z.literal(1),
  agents: z.array(recordSchema),
}).strict();

// The records of providers an older Sagax knows (cursor, claude, codex) stay
// in records.json with the shape it parses; Perspicax runs (and any field or
// status added with them) live in perspicax-records.json. An older build
// rolled back over this data dir then reads its own file untouched instead of
// failing its strict parse and starting empty. A row that does not parse is
// skipped, never the whole file, and the file is copied to `.bak` once before
// it is rewritten.
type Doc = z.infer<typeof fileSchema>;
const LEGACY_PROVIDERS = new Set(["cursor", "claude", "codex"]);

const LEGACY_STATUS: Partial<Record<CloudAgentStatus, CloudAgentStatus>> = { queued: "creating", waiting_for_approval: "running", expired: "failed" };

function legacyStatus(record: CloudAgentRecord): CloudAgentRecord {
  const older = LEGACY_STATUS[record.status];
  return older ? { ...record, status: older } : record;
}

export class CloudAgentStore {
  private readonly file: string;
  private readonly perspicaxFile: string;
  private doc: Doc | null = null;
  private readonly damaged = new Set<string>();

  constructor(dataDir: string) {
    mkdirSync(join(dataDir, "cloud-agents"), { recursive: true });
    this.file = join(dataDir, "cloud-agents", "records.json");
    this.perspicaxFile = join(dataDir, "cloud-agents", "perspicax-records.json");
  }

  private read(file: string): CloudAgentRecord[] {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.damaged.add(file);
      return [];
    }
    const rows = raw && typeof raw === "object" && Array.isArray((raw as { agents?: unknown }).agents) ? (raw as { agents: unknown[] }).agents : null;
    if (!rows) { this.damaged.add(file); return []; }
    const out: CloudAgentRecord[] = [];
    for (const row of rows) {
      const parsed = recordSchema.safeParse(row);
      if (parsed.success) out.push(parsed.data);
      else this.damaged.add(file);
    }
    return out;
  }

  private load(): Doc {
    if (this.doc) return this.doc;
    this.doc = { version: 1, agents: [...this.read(this.file), ...this.read(this.perspicaxFile)] };
    return this.doc;
  }

  private write(file: string, agents: CloudAgentRecord[]): void {
    if (this.damaged.has(file)) {
      try { copyFileSync(file, `${file}.bak`); } catch {}
      this.damaged.delete(file);
    }
    writeFileAtomic(file, JSON.stringify(fileSchema.parse({ version: 1, agents }), null, 0), { mode: 0o600 });
  }

  private save(): void {
    const doc = this.load();
    // An older build parses records.json strictly: it gets only the statuses
    // it knows (the new ones are written as their nearest old one).
    this.write(this.file, doc.agents.filter((a) => LEGACY_PROVIDERS.has(a.provider)).map(legacyStatus));
    const perspicax = doc.agents.filter((a) => !LEGACY_PROVIDERS.has(a.provider));
    if (perspicax.length || existsSync(this.perspicaxFile)) this.write(this.perspicaxFile, perspicax);
  }

  listForBot(botId: string): CloudAgentRecord[] {
    return this.load().agents.filter((a) => a.botId === botId);
  }

  listAll(): CloudAgentRecord[] {
    return this.load().agents;
  }

  get(id: string): CloudAgentRecord | null {
    return this.load().agents.find((a) => a.id === id) ?? null;
  }

  findByExternal(provider: CloudAgentProviderId, externalId: string): CloudAgentRecord | null {
    return this.load().agents.find((a) => a.provider === provider && a.externalId === externalId) ?? null;
  }

  findByPrUrl(prUrl: string): CloudAgentRecord | null {
    const needle = prUrl.trim().toLowerCase();
    return this.load().agents.find((a) =>
      a.gitBranches.some((b) => b.prUrl?.toLowerCase() === needle) ||
      a.repos.some((r) => r.prUrl?.toLowerCase() === needle),
    ) ?? null;
  }

  create(input: {
    botId: string;
    threadId: string;
    principalId: string;
    provider: CloudAgentProviderId;
    externalId: string;
    name: string;
    repos: CloudAgentRepoRef[];
    model?: string;
    url?: string;
    latestRunId?: string;
    status?: CloudAgentStatus;
    envId?: string;
    origin?: CloudAgentRecord["origin"];
  }): CloudAgentRecord {
    const now = Date.now();
    const record: CloudAgentRecord = {
      id: `ca_${randomUUID()}`,
      botId: input.botId,
      threadId: input.threadId,
      principalId: input.principalId,
      provider: input.provider,
      externalId: input.externalId,
      name: input.name.slice(0, 200),
      status: input.status ?? "creating",
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      repos: input.repos,
      gitBranches: [],
      archived: false,
      completionNotified: false,
      ...(input.model ? { model: input.model } : {}),
      ...(input.url ? { url: input.url } : {}),
      ...(input.latestRunId ? { latestRunId: input.latestRunId } : {}),
      ...(input.envId ? { envId: input.envId } : {}),
      ...(input.origin ? { origin: input.origin } : {}),
    };
    const doc = this.load();
    doc.agents.push(record);
    this.save();
    return record;
  }

  patch(id: string, patch: Partial<CloudAgentRecord>): CloudAgentRecord | null {
    const doc = this.load();
    const index = doc.agents.findIndex((a) => a.id === id);
    if (index < 0) return null;
    const next = { ...doc.agents[index]!, ...patch, updatedAt: Date.now() };
    doc.agents[index] = recordSchema.parse(next);
    this.save();
    return doc.agents[index]!;
  }
}
