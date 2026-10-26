import {
  cloudAgentKeyProvider,
  cloudAgentStatusActive,
  normalizeCloudAgentStatus,
  type CloudAgentFollowUpInput,
  type CloudAgentLaunchInput,
  type CloudAgentRecord,
  type CloudAgentProviderId,
} from "../../shared/cloud-agents.ts";
import type { CloudAgentCredentialStore } from "./credentials.ts";
import type { CloudAgentStore } from "./store.ts";
import type { CloudAgentProviderAdapter, ProviderRunSnapshot } from "./providers/types.ts";
import { ProviderHttpError } from "./providers/http.ts";

export interface CloudAgentCompletionEvent {
  record: CloudAgentRecord;
  summary: string;
}

export interface CloudAgentManagerDeps {
  store: CloudAgentStore;
  credentials: CloudAgentCredentialStore;
  providers: Map<CloudAgentProviderId, CloudAgentProviderAdapter>;
  now?: () => number;
  onComplete?: (event: CloudAgentCompletionEvent) => void;
  onChange?: (record: CloudAgentRecord) => void;
  /** The person's sign-in access token for a provider without a pasted key
   * (`perspicax`); null when there is none (a solo server, no live sign-in). */
  accessToken?: (principalId: string, provider: CloudAgentProviderId) => Promise<string | null>;
}

const TERMINAL = new Set(["finished", "failed", "cancelled", "expired", "archived"]);

export class CloudAgentManager {
  private readonly now: () => number;
  private readonly deps: CloudAgentManagerDeps;
  constructor(deps: CloudAgentManagerDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  private provider(id: CloudAgentProviderId): CloudAgentProviderAdapter {
    const adapter = this.deps.providers.get(id);
    if (!adapter) throw new Error(`unknown provider ${id}`);
    return adapter;
  }

  private async token(principalId: string, provider: CloudAgentProviderId): Promise<string> {
    if (!cloudAgentKeyProvider(provider)) {
      const value = await this.deps.accessToken?.(principalId, provider) ?? null;
      if (!value) throw new ProviderHttpError(401, "not_signed_in", "Perspicax runs need a live Perspicax sign-in (Sagax Business).");
      return value;
    }
    const value = this.deps.credentials.token(principalId, provider);
    if (!value) throw new ProviderHttpError(401, "not_configured", `No API key configured for ${provider}.`);
    return value;
  }

  list(botId: string): CloudAgentRecord[] {
    return this.deps.store.listForBot(botId).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): CloudAgentRecord | null {
    return this.deps.store.get(id);
  }

  /** The local record of a provider's job (a run launched from a thread). */
  byExternal(provider: CloudAgentProviderId, externalId: string): CloudAgentRecord | null {
    return this.deps.store.findByExternal(provider, externalId);
  }

  /** Every local record of one provider, for one person. */
  listFor(principalId: string, provider: CloudAgentProviderId): CloudAgentRecord[] {
    return this.deps.store.listAll().filter((record) => record.provider === provider && record.principalId === principalId);
  }

  async launch(input: {
    botId: string;
    threadId: string;
    principalId: string;
    launch: CloudAgentLaunchInput;
  }): Promise<CloudAgentRecord> {
    const adapter = this.provider(input.launch.provider);
    const token = await this.token(input.principalId, input.launch.provider);
    const launched = await adapter.launch(token, { ...input.launch, principalId: input.principalId });
    const record = this.deps.store.create({
      botId: input.botId,
      threadId: input.threadId,
      principalId: input.principalId,
      provider: input.launch.provider,
      externalId: launched.externalId,
      name: launched.name,
      repos: input.launch.repos ?? [],
      model: input.launch.model,
      url: launched.url,
      latestRunId: launched.latestRunId,
      status: normalizeCloudAgentStatus(launched.status),
      envId: launched.envId,
      origin: launched.origin,
    });
    this.deps.onChange?.(record);
    void this.syncOne(record.id).catch(() => null);
    return record;
  }

  async followUp(id: string, principalId: string, body: CloudAgentFollowUpInput): Promise<CloudAgentRecord> {
    const record = this.deps.store.get(id);
    if (!record || record.principalId !== principalId) throw new ProviderHttpError(404, "not_found", "No such cloud agent.");
    if (body.mode === "queue" && cloudAgentStatusActive(record.status) && record.status !== "idle") {
      const queued = this.deps.store.patch(id, { pendingFollowUp: { text: body.text, at: this.now() }, status: "running" });
      if (!queued) throw new ProviderHttpError(404, "not_found", "No such cloud agent.");
      this.deps.onChange?.(queued);
      return queued;
    }
    const adapter = this.provider(record.provider);
    const snap = await adapter.followUp(await this.token(principalId, record.provider), record, body);
    const next = this.applySnapshot(record.id, snap, { clearPending: true });
    if (!next) throw new ProviderHttpError(404, "not_found", "No such cloud agent.");
    this.deps.onChange?.(next);
    return next;
  }

  async cancel(id: string, principalId: string): Promise<CloudAgentRecord> {
    const record = this.deps.store.get(id);
    if (!record || record.principalId !== principalId) throw new ProviderHttpError(404, "not_found", "No such cloud agent.");
    await this.provider(record.provider).cancel(await this.token(principalId, record.provider), record);
    const next = this.deps.store.patch(id, { status: "cancelled", endedAt: this.now() });
    if (!next) throw new ProviderHttpError(404, "not_found", "No such cloud agent.");
    this.deps.onChange?.(next);
    this.maybeComplete(next);
    return next;
  }

  async archive(id: string, principalId: string): Promise<CloudAgentRecord> {
    const record = this.deps.store.get(id);
    if (!record || record.principalId !== principalId) throw new ProviderHttpError(404, "not_found", "No such cloud agent.");
    await this.provider(record.provider).archive(await this.token(principalId, record.provider), record);
    const next = this.deps.store.patch(id, { status: "archived", archived: true, endedAt: this.now() });
    if (!next) throw new ProviderHttpError(404, "not_found", "No such cloud agent.");
    this.deps.onChange?.(next);
    return next;
  }

  async refresh(id: string): Promise<CloudAgentRecord | null> {
    return this.syncOne(id);
  }

  async syncBot(botId: string): Promise<void> {
    for (const record of this.deps.store.listForBot(botId)) {
      if (!record.archived && (cloudAgentStatusActive(record.status) || record.pendingFollowUp)) {
        await this.syncOne(record.id).catch(() => null);
      }
    }
  }

  /** Poll every active cloud agent (all bots). One provider failing (a
   * network error, a 5xx) never stops the others nor rejects the timer. */
  async syncActive(): Promise<void> {
    for (const record of this.deps.store.listAll()) {
      if (!record.archived && (cloudAgentStatusActive(record.status) || record.pendingFollowUp)) {
        await this.syncOne(record.id).catch(() => null);
      }
    }
  }

  async testCredential(principalId: string, provider: CloudAgentProviderId, token?: string): Promise<void> {
    // A provider without a pasted key (perspicax) is tested with the person's
    // own sign-in only: a token in the request would ride on this server's
    // link token for someone else.
    const value = (cloudAgentKeyProvider(provider) ? token?.trim() : "") || await this.token(principalId, provider);
    await this.provider(provider).testToken(value);
  }

  private applySnapshot(id: string, snap: ProviderRunSnapshot, extra?: { clearPending?: boolean }) {
    const status = normalizeCloudAgentStatus(snap.status);
    const ended = TERMINAL.has(status);
    // A Perspicax run that works again after a turn end (a follow-up) will
    // wake its bot again at the next one.
    const before = this.deps.store.get(id);
    const working = status === "queued" || status === "creating" || status === "running" || status === "waiting_for_approval";
    const rearm = Boolean(before && before.provider === "perspicax" && before.completionNotified && working && before.status !== status);
    return this.deps.store.patch(id, {
      ...(rearm ? { completionNotified: false } : {}),
      status,
      ...(snap.latestRunId ? { latestRunId: snap.latestRunId } : {}),
      ...(snap.result ? { lastResult: snap.result } : {}),
      ...(snap.error ? { error: snap.error } : {}),
      ...(snap.gitBranches ? { gitBranches: snap.gitBranches } : {}),
      ...(snap.stats ? { stats: snap.stats } : {}),
      ...(snap.pr ? { pr: snap.pr } : {}),
      ...(snap.url ? { url: snap.url } : {}),
      ...(snap.unread !== undefined ? { unread: snap.unread } : {}),
      ...(ended ? { endedAt: this.now() } : {}),
      ...(extra?.clearPending ? { pendingFollowUp: undefined } : {}),
    });
  }

  private async syncOne(id: string): Promise<CloudAgentRecord | null> {
    const record = this.deps.store.get(id);
    if (!record || record.archived) return record;
    try {
      const snap = await this.provider(record.provider).refresh(await this.token(record.principalId, record.provider), record);
      let next = this.applySnapshot(id, snap);
      if (!next) return null;
      if (next.pendingFollowUp && (next.status === "idle" || next.status === "finished")) {
        const text = next.pendingFollowUp.text;
        next = await this.followUp(id, next.principalId, { text, mode: "queue" });
      }
      this.deps.onChange?.(next);
      this.maybeComplete(next);
      return next;
    } catch (e) {
      // No live sign-in to borrow a token from: the run goes on in
      // Perspicax, so the record waits for the next sync instead of failing.
      if (e instanceof ProviderHttpError && e.code === "not_signed_in") return record;
      // A borrowed sign-in token that expired mid-call says nothing about the
      // run itself: keep the record, the next sync borrows a fresh one.
      if (e instanceof ProviderHttpError && e.status === 401 && !cloudAgentKeyProvider(record.provider)) return record;
      if (e instanceof ProviderHttpError && e.status === 401) {
        const failed = this.deps.store.patch(id, { status: "failed", error: "Provider credentials refused.", endedAt: this.now() });
        if (failed) this.maybeComplete(failed);
        return failed;
      }
      throw e;
    }
  }

  private maybeComplete(record: CloudAgentRecord): void {
    // A Perspicax run ends its turn `idle` (its Pod waits for a follow-up
    // until it expires): that turn end wakes the bot, as a finish would.
    const turnEnd = TERMINAL.has(record.status) || (record.provider === "perspicax" && record.status === "idle");
    if (record.completionNotified || !turnEnd) return;
    const summary = record.lastResult?.trim()
      || record.error?.trim()
      || `Cloud agent ${record.name} finished (${record.status}).`;
    const marked = this.deps.store.patch(record.id, { completionNotified: true });
    if (marked) this.deps.onComplete?.({ record: marked, summary });
  }

  async artifacts(id: string, principalId: string) {
    const record = this.deps.store.get(id);
    if (!record || record.principalId !== principalId) throw new ProviderHttpError(404, "not_found", "No such cloud agent.");
    return this.provider(record.provider).listArtifacts(await this.token(principalId, record.provider), record);
  }

  async transcript(id: string, principalId: string) {
    const record = this.deps.store.get(id);
    if (!record || record.principalId !== principalId) throw new ProviderHttpError(404, "not_found", "No such cloud agent.");
    return this.provider(record.provider).transcript(await this.token(principalId, record.provider), record);
  }

  async findByPr(principalId: string, provider: CloudAgentProviderId, prUrl: string) {
    const local = this.deps.store.findByPrUrl(prUrl);
    if (local) return local;
    const hit = await this.provider(provider).findByPr(await this.token(principalId, provider), prUrl);
    if (!hit) return null;
    return this.deps.store.findByExternal(provider, hit.externalId);
  }
}
