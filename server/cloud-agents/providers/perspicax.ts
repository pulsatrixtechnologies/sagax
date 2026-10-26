// Perspicax runs as a cloud agent provider (2026-10-18, lot P1.7). The run
// lives in Perspicax (its own Pod, branch `px/...`, a draft PR); this adapter
// only lets a bot launch, follow and stop one from a conversation through
// the existing cloud agent tools. The token is the person's sign-in access
// token (CloudAgentManager asks `accessToken` for it), never a pasted key.
import {
  normalizeCloudAgentStatus,
  RUN_ENGINES,
  runOrigin,
  runPr,
  runStats,
  type CloudAgentLaunchInput,
  type CloudAgentRecord,
  type CloudAgentTranscriptLine,
  type PerspicaxEnvironment,
  type PerspicaxRun,
} from "../../../shared/cloud-agents.ts";
import { PerspicaxAgentsClient, type PerspicaxAccess } from "../perspicax-client.ts";
import { ProviderHttpError } from "./http.ts";
import type { CloudAgentProviderAdapter, HttpFetch, ProviderRunSnapshot } from "./types.ts";

/** `owner/name` from a repository URL or an `owner/name` string. */
export function repoSlug(value: string): string | null {
  const trimmed = value.trim().replace(/\.git$/i, "").replace(/\/+$/, "");
  const fromUrl = /^(?:https?:\/\/|git@)[^/:]+[/:]([^/]+)\/([^/]+)$/i.exec(trimmed);
  if (fromUrl) return `${fromUrl[1]}/${fromUrl[2]}`.toLowerCase();
  const bare = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(trimmed);
  return bare ? `${bare[1]}/${bare[2]}`.toLowerCase() : null;
}

/** The environment a launch starts from: the one named, else the one whose
 * repositories hold the repo, else the only one. Several matches is a
 * question for the person (spec 9.5), returned as the refusal's text. */
export function pickEnvironment(envs: PerspicaxEnvironment[], input: { envId?: string; repo?: string }): PerspicaxEnvironment {
  if (input.envId) {
    const named = envs.find((env) => env.id === input.envId);
    if (!named) throw new ProviderHttpError(404, "no_environment", `No Perspicax environment ${input.envId} is open to this person. List them again and use one of theirs; to the person, name an environment by its name, never by its env_id.`);
    return named;
  }
  // The person reads environments by name (JC 2026-10-19: no GUID on
  // screen); the env_id is for the relaunch call only.
  const list = (rows: PerspicaxEnvironment[]) => rows.map((env) => `- ${env.name} (env_id ${env.id})`).join("\n");
  const ask = "Ask the person which one by its name (never show an env_id to them), then launch again with its env_id";
  const slug = input.repo ? repoSlug(input.repo) : null;
  if (slug) {
    const matches = envs.filter((env) => env.repos.some((repo) => `${repo.owner}/${repo.name}`.toLowerCase() === slug));
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) {
      throw new ProviderHttpError(409, "ambiguous_environment", `Several Perspicax environments hold ${slug}. ${ask}:\n${list(matches)}`);
    }
    throw new ProviderHttpError(404, "no_environment", `No Perspicax environment holds ${slug}. The person creates one in the Perspicax console (Cloud agents).`);
  }
  if (envs.length === 1) return envs[0]!;
  if (envs.length === 0) throw new ProviderHttpError(404, "no_environment", "No Perspicax environment is open to this person. They create one in the Perspicax console (Cloud agents).");
  throw new ProviderHttpError(409, "ambiguous_environment", `Which repository? ${ask}:\n${list(envs)}`);
}

function lastMessage(events: { kind: string; payload: Record<string, unknown> }[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    if (event.kind === "message" && event.payload.role !== "user" && typeof event.payload.text === "string") return event.payload.text;
  }
  return undefined;
}

export function runSnapshot(run: PerspicaxRun, result?: string): ProviderRunSnapshot {
  const pr = runPr(run);
  const stats = runStats(run);
  const repoUrl = run.repo ? `https://github.com/${run.repo}` : undefined;
  return {
    status: run.state,
    ...(run.error ? { error: run.error } : {}),
    ...(result ? { result } : {}),
    gitBranches: run.branch ? [{ ...(repoUrl ? { repoUrl } : {}), branch: run.branch, ...(pr ? { prUrl: pr.url } : {}) }] : [],
    ...(stats ? { stats } : {}),
    ...(pr ? { pr, url: pr.url } : {}),
    unread: run.unread === true,
  };
}

/** A personal run's subscription (subscription-depositor.ts): the check
 * before a launch, and the close watch after it. */
export interface PersonalSubscriptions {
  ready(principalId: string, engine: string): { ok: true } | { ok: false; message: string };
  watch(principalId: string, runId: string): void;
}

/** Whether a run from this environment uses the person's own subscription:
 * `personnel`, or `au_choix` (Sagax never picks, so Perspicax's default,
 * personal, applies). */
export function personalEnvironment(env: Pick<PerspicaxEnvironment, "token_source">): boolean {
  return env.token_source === "personnel" || env.token_source === "au_choix";
}

/** This server's link token (PerspicaxDirectory.linkBearer). */
export type LinkBearer = (reread?: boolean) => string | null;

export function createPerspicaxProvider(fetchImpl: HttpFetch, baseUrl: () => string | null, personal?: () => PersonalSubscriptions | null, link: LinkBearer = () => null): CloudAgentProviderAdapter {
  const client = new PerspicaxAgentsClient(fetchImpl);
  const access = (token: string): PerspicaxAccess => {
    const base = baseUrl();
    if (!base) throw new ProviderHttpError(501, "not_available", "Perspicax runs need Sagax Business (an organization server signed in with Perspicax).");
    // `token` is the acting person's sign-in (the record's principal: who
    // speaks, or the bot's owner for a routine); the link token says which server.
    return { baseUrl: base, token, link: () => link(), relink: () => link(true) };
  };
  return {
    id: "perspicax",
    label: "Perspicax",

    async testToken(token) {
      await client.environments(access(token));
    },

    async launch(token, input: CloudAgentLaunchInput) {
      const where = access(token);
      const env = pickEnvironment(await client.environments(where), { envId: input.envId, repo: input.repos?.[0]?.url });
      const engine = input.engine && (RUN_ENGINES as readonly string[]).includes(input.engine) ? input.engine : undefined;
      // A personal run needs the person's own sign-in for its engine: refused
      // here, with the reason, before Perspicax queues a run that cannot work.
      const subscriptions = personal?.() ?? null;
      if (subscriptions && input.principalId && personalEnvironment(env)) {
        const ready = subscriptions.ready(input.principalId, engine ?? env.engine_default);
        if (!ready.ok) throw new ProviderHttpError(409, "no_subscription", ready.message);
      }
      const repo = input.repos?.[0]?.url ? repoSlug(input.repos[0].url) ?? undefined : undefined;
      const run = await client.create(where, {
        env_id: env.id,
        prompt: input.prompt,
        origin: "sagax",
        ...(repo ? { repo } : {}),
        ...(input.repos?.[0]?.ref ? { base_branch: input.repos[0].ref } : {}),
        ...(input.name ? { title: input.name } : {}),
        ...(engine ? { engine } : {}),
        ...(input.model ? { model: input.model } : {}),
      });
      if (subscriptions && input.principalId && run.token_source === "personnel") subscriptions.watch(input.principalId, run.id);
      return {
        externalId: run.id,
        name: run.title || input.name || run.prompt.slice(0, 80),
        status: run.state,
        envId: run.env_id,
        ...(runOrigin(run.origin) ? { origin: runOrigin(run.origin) } : {}),
      };
    },

    async refresh(token, record: CloudAgentRecord) {
      const where = access(token);
      const run = await client.run(where, record.externalId);
      const ended = run.state === "idle" || run.state === "finished" || run.state === "failed" || run.state === "stopped" || run.state === "expired";
      // The log is read once per turn end (the state changed, or no result
      // yet), never on every sync of a run that waits `idle`.
      const changed = normalizeCloudAgentStatus(run.state) !== record.status || !record.lastResult;
      const result = ended && changed ? lastMessage(await client.allEvents(where, run.id).catch(() => [])) : undefined;
      return runSnapshot(run, result);
    },

    async followUp(token, record, input) {
      return runSnapshot(await client.followUp(access(token), record.externalId, input.text, input.mode));
    },

    async cancel(token, record) {
      await client.stop(access(token), record.externalId);
    },

    async archive(token, record) {
      await client.archive(access(token), record.externalId);
    },

    async listArtifacts(token, record) {
      const files = await client.files(access(token), record.externalId);
      return files.items.filter((entry) => entry.kind === "file").map((entry) => ({ path: entry.path, ...(entry.size !== undefined ? { size: entry.size } : {}) }));
    },

    async transcript(token, record) {
      const events = await client.allEvents(access(token), record.externalId);
      return events.flatMap((event): CloudAgentTranscriptLine[] => {
        const at = Date.parse(event.at) || 0;
        if (event.kind === "requested" && typeof event.payload.prompt === "string") return [{ at, role: "user" as const, text: event.payload.prompt }];
        if (event.kind === "followup" && typeof event.payload.text === "string") return [{ at, role: "user" as const, text: event.payload.text }];
        if (event.kind === "message" && typeof event.payload.text === "string") return [{ at, role: event.payload.role === "user" ? "user" as const : "assistant" as const, text: event.payload.text }];
        if (event.kind === "state" && typeof event.payload.state === "string") return [{ at, role: "system" as const, text: `state ${event.payload.state}` }];
        return [];
      });
    },

    async findByPr(token, prUrl) {
      const needle = prUrl.trim().toLowerCase();
      const runs = await client.runs(access(token), { mine: true });
      const hit = runs.find((run) => runPr(run)?.url.toLowerCase() === needle);
      return hit ? { externalId: hit.id, name: hit.title } : null;
    },
  };
}
