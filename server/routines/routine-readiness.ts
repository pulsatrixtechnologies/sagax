import type { RoutineRequirements, RoutineReadinessCheck, RoutineReadinessKind, RoutineReadinessResult } from "../../shared/routine-readiness.ts";
import { activeEngineRefusal, clearEngineRefusal } from "../engines/engine-refusals.ts";
import { redactSecretsInText } from "../redact.ts";
import type { FlowPluginsDeclaration } from "../perspicax/perspicax-link.ts";
import type { OrgFlowPluginsStatus } from "../org/org-flow-plugins.ts";

export const ROUTINE_READINESS_TIMEOUT_MS = 4_900;
export const ROUTINE_READINESS_PROBE_TIMEOUT_MS = ROUTINE_READINESS_TIMEOUT_MS - 400;
export const ROUTINE_READINESS_CACHE_MS = 60_000;
export interface ReadinessRoutine { botId: string; prompt: string; requires?: RoutineRequirements; runAs?: string; runOn?: string }
export interface ReadinessRun { botId: string; prompt?: string; runAs?: string; runOn?: string; threadId?: string }
export interface ReadinessEngine {
  engine: string; name: string; account?: string; signedIn?: boolean; signedInAt?: number; detail?: string;
  /** Resolved routing facts, not credentials. Absent means unknown. */
  driver?: string; accessVia?: string; keyBacked?: boolean;
}
export interface ReadinessMcp { known: string[]; enabled: string[]; profileServer?: string; toolPrefixes?: Record<string, string> }
export interface ReadinessComputer { name: string; online?: boolean; needed?: boolean }
interface ReadinessFlowSkills { hasProfile: boolean; installation: string }
/** A held local install does not disable the pack's remote product documents (#1945). */
export function routineFlowSkills(organization: boolean, declaration: FlowPluginsDeclaration | undefined, profiles: readonly string[], status: OrgFlowPluginsStatus): ReadinessFlowSkills | undefined {
  if (!organization || !declaration) return undefined;
  const states = status.plugins.map(plugin => plugin.state).join(", ");
  return { hasProfile: profiles.length > 0,
    installation: status.reason ? `${status.mode}/${status.reason}` : status.error ?? (states ? `${status.mode}/${states}` : status.mode) };
}
export type RoutineReadinessMode = "run" | "check";
export interface RoutineReadinessDeps {
  now?(): number;
  /** Include the current selection, account and configuration revision. No credentials. */
  cacheKey?(routine: ReadinessRoutine, run: ReadinessRun): string;
  engine(routine: ReadinessRoutine, run: ReadinessRun, signal: AbortSignal): ReadinessEngine | undefined | Promise<ReadinessEngine | undefined>;
  skills(routine: ReadinessRoutine, run: ReadinessRun, signal: AbortSignal): string[] | undefined | Promise<string[] | undefined>;
  /** Organization declaration present: the active pack serves product skills remotely. */
  flowSkills?(routine: ReadinessRoutine, run: ReadinessRun): ReadinessFlowSkills | undefined;
  mcp(routine: ReadinessRoutine, run: ReadinessRun, signal: AbortSignal): ReadinessMcp | undefined | Promise<ReadinessMcp | undefined>;
  perspicax?(routine: ReadinessRoutine, run: ReadinessRun, signal: AbortSignal): Promise<{ refused?: boolean; profile?: string; detail?: string } | undefined>;
  computers?(routine: ReadinessRoutine, run: ReadinessRun, signal: AbortSignal): Promise<ReadinessComputer[] | undefined> | ReadinessComputer[] | undefined;
}
interface Probe { value?: unknown; error?: string }
const cache = new WeakMap<RoutineReadinessDeps, Map<string, { at: number; result: Promise<Probe> }>>();
const kinds: RoutineReadinessKind[] = ["engine", "skills", "mcp", "perspicax", "computer"];
const flow = /\b(?:px_flow|flow_run|[a-z-]*px-flow[a-z-]*)\b|Pulsatrix[ -]Flow|routine Flow/i;
export const isFlowRoutine = (prompt: string): boolean => flow.test(prompt);
export function routineNeededSkills(prompt: string, requires?: RoutineRequirements): string[] {
  const names = new Set(requires?.skills ?? []);
  if (isFlowRoutine(prompt)) { names.add("using-px-flow"); names.add("running-px-flow"); }
  for (const match of prompt.matchAll(/`([a-z][a-z0-9]*(?:-[a-z0-9]+)+)`/g)) {
    const context = prompt.slice(Math.max(0, match.index! - 65), match.index! + match[0].length + 65);
    if (/\bskills?\b/i.test(context)) names.add(match[1]!);
  }
  return [...names].slice(0, 40);
}
const clean = (value: unknown) => redactSecretsInText(value instanceof Error ? value.message : String(value)).slice(0, 500);
const ready = (kind: RoutineReadinessKind, detail?: string): RoutineReadinessCheck => ({ kind, ok: true, code: "ready", params: { kind }, line: `The ${kind} check has no known blocker. Run the routine when ready.`, ...(detail ? { detail } : {}) });
function boundedProbe(work: (signal: AbortSignal) => unknown): Promise<Probe> {
  return new Promise((resolve) => {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); resolve({ error: "Readiness probe timed out. Try checking again." }); }, ROUTINE_READINESS_PROBE_TIMEOUT_MS);
    Promise.resolve().then(() => work(controller.signal)).then(value => resolve({ value }), error => resolve({ error: clean(error) })).finally(() => clearTimeout(timer));
  });
}
/** Bound checks at persistence boundaries as well as at probe creation. */
export function loadRoutineReadiness(value: unknown): RoutineReadinessCheck[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const codes = new Set(["engine_credits", "engine_limit", "engine_signed_out", "engine_artifacts", "skill_missing", "flow_profile", "mcp_missing", "perspicax_profile", "computer_offline", "ready", "probe_error"]);
  return value.slice(0, 100).filter((check): check is RoutineReadinessCheck => Boolean(check && kinds.includes(check.kind) && codes.has(check.code) && typeof check.ok === "boolean" && typeof check.line === "string")).map(check => ({
    kind: check.kind, ok: check.ok, code: check.code, line: clean(check.line),
    ...(typeof check.detail === "string" ? { detail: clean(check.detail) } : {}),
    ...(check.params && typeof check.params === "object" ? { params: Object.fromEntries(Object.entries(check.params).slice(0, 10).filter(([, value]) => typeof value === "string").map(([key, value]) => [key.slice(0, 100), clean(value).slice(0, 100)])) } : {}),
  }));
}

/** Independent probes run together. Cache probe facts, never prompt inference or refusal decisions. */
export async function checkRoutineReadiness(routine: ReadinessRoutine, run: ReadinessRun, deps: RoutineReadinessDeps, mode: RoutineReadinessMode = "run"): Promise<RoutineReadinessResult> {
  try {
    const now = deps.now?.() ?? Date.now();
    let memo = cache.get(deps);
    if (!memo) { memo = new Map(); cache.set(deps, memo); }
    const context = JSON.stringify([routine.botId, run.runAs ?? routine.runAs, run.runOn ?? routine.runOn, routine.requires?.computer, deps.cacheKey?.(routine, run)]);
    const works = [deps.engine, deps.skills, deps.mcp, deps.perspicax, deps.computers] as const;
    const probes = await Promise.all(works.map((work, i) => {
      if (!work) return Promise.resolve({} as Probe);
      const key = `${context}:${kinds[i]}`;
      const old = memo!.get(key);
      if (old && now - old.at < ROUTINE_READINESS_CACHE_MS) return old.result;
      const result = boundedProbe(signal => work(routine, run, signal));
      memo!.set(key, { at: now, result });
      if (memo!.size > 2_000) memo!.delete(memo!.keys().next().value!);
      return result;
    }));
    const checks: RoutineReadinessCheck[] = [];
    for (let i = 0; i < kinds.length; i++) {
      const kind = kinds[i]!;
      const probe = probes[i]!;
      const needsFlow = isFlowRoutine(run.prompt ?? routine.prompt) || routine.requires?.skills?.some(skill => isFlowRoutine(skill));
      const pack = kind === "skills" && needsFlow ? deps.flowSkills?.(routine, run) : undefined;
      if (pack) {
        // A Flow routine reads all its product skills from the active pack,
        // including skills absent from the local discovery inventory (#1945).
        checks.push(pack.hasProfile
          ? ready(kind, `Flow skills are served by the active Flow pack through Perspicax (organization install: ${clean(pack.installation)})`)
          : { kind, ok: false, code: "flow_profile", line: "This Flow routine needs a Perspicax profile on its bot to reach the Flow skills. Choose one in the bot's Connect apps." });
        continue;
      }
      if (probe.error) { checks.push({ kind, ok: mode === "run", code: "probe_error", params: { kind }, line: `The ${kind} check could not finish. Check the routine again.`, detail: probe.error }); continue; }
      const start = checks.length;
      if (kind === "engine") {
        const engine = probe.value as ReadinessEngine | undefined;
        if (engine) {
          const artifactTool = (run.prompt ?? routine.prompt).match(/\b(ArtifactData|ArtifactComments|Artifact)\b/)?.[1];
          const cannotOfferArtifacts = (engine.driver !== undefined && engine.driver !== "claudeAgent") ||
            (engine.accessVia !== undefined && engine.accessVia !== "subscription" && engine.accessVia !== "server") ||
            (engine.accessVia !== "subscription" && engine.keyBacked === true);
          if (artifactTool && cannotOfferArtifacts) checks.push({ kind, ok: false, code: "engine_artifacts", params: { engine: engine.name, tool: artifactTool },
            line: `This routine needs ${artifactTool}, which ${engine.name} cannot offer with this account. Choose Claude with a claude.ai subscription sign-in for this bot; API keys and other engines do not provide claude.ai artifact tools.` });
          const recorded = activeEngineRefusal(engine.engine, engine.account, now);
          if (engine.signedIn === true && (engine.signedInAt === undefined || engine.signedInAt > (recorded?.at ?? -Infinity))) clearEngineRefusal(engine.engine, engine.account, now, true);
          const refusal = activeEngineRefusal(engine.engine, engine.account, now);
          if (engine.signedIn === false || refusal?.cause === "signed_out") {
            checks.push({ kind, ok: false, code: "engine_signed_out", params: { engine: engine.name }, line: `${engine.name} is signed out for this bot. Reconnect it in Settings > Model providers.`, ...(engine.detail ? { detail: clean(engine.detail) } : {}) });
          } else if (refusal) {
            const at = new Date(refusal.at).toISOString();
            const until = new Date(refusal.resetsAt ?? refusal.at + 30 * 60_000).toISOString();
            const human = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
            checks.push(refusal.cause === "credits"
              ? { kind, ok: false, code: "engine_credits", params: { engine: engine.name, at }, line: `${engine.name}'s account is out of credit (the provider refused at ${human(at)}). Add credit with the provider, or choose another engine for this bot.` }
              : { kind, ok: false, code: "engine_limit", params: { engine: engine.name, until }, line: `${engine.name} reached its usage limit until ${human(until)}. Wait for the reset, or choose another engine for this bot.` });
          }
        }
      } else if (kind === "skills") {
        const available = probe.value as string[] | undefined;
        if (available) for (const skill of routineNeededSkills(run.prompt ?? routine.prompt, routine.requires)) {
          if (!available.includes(skill)) checks.push({ kind, ok: false, code: "skill_missing", params: { skill }, line: `Skill \`${skill}\` is not among this bot's skills. Install its plugin for this bot (Connect apps > Sources) or assign the skill to it.` });
        }
      } else if (kind === "mcp") {
        const servers = probe.value as ReadinessMcp | undefined;
        if (servers) {
          const prompt = run.prompt ?? routine.prompt;
          const needed = new Set(routine.requires?.mcpServers ?? []);
          const prefixes = { ...Object.fromEntries(servers.known.map(name => [name, name])), ...servers.toolPrefixes };
          for (const [prefix, server] of Object.entries(prefixes)) {
            if (prompt.match(/[a-zA-Z][a-zA-Z0-9_-]*/g)?.some(word => word.startsWith(`${prefix}_`))) needed.add(server);
          }
          if (isFlowRoutine(prompt) && servers.profileServer) needed.add(servers.profileServer);
          for (const server of [...needed].slice(0, 40)) if (!servers.enabled.includes(server)) checks.push({ kind, ok: false, code: "mcp_missing", params: { server }, line: `MCP server \`${server}\` is not connected for this bot. Connect it in the bot's Connect apps.` });
        }
      } else if (kind === "perspicax") {
        const profile = probe.value as { refused?: boolean; profile?: string; detail?: string } | undefined;
        if (profile?.refused) checks.push({ kind, ok: false, code: "perspicax_profile", params: { profile: profile.profile ?? "Perspicax" }, line: "Perspicax refused this person's profile (401/403 invalid_token). Choose the profile again in Settings > Perspicax.", ...(profile.detail ? { detail: clean(profile.detail) } : {}) });
        else if (profile?.detail) checks.push(ready(kind, clean(profile.detail)));
      } else {
        const computers = probe.value as ReadinessComputer[] | undefined;
        const prompt = (run.prompt ?? routine.prompt).toLowerCase();
        const anyOnline = computers?.some(computer => computer.online === true);
        const explicitlySelected = computers?.some(computer => computer.needed);
        for (const computer of computers ?? []) if (computer.online === false && (computer.needed || prompt.includes(computer.name.toLowerCase()) || (routine.requires?.computer && !anyOnline && !explicitlySelected))) {
          checks.push({ kind, ok: false, code: "computer_offline", params: { computer: computer.name }, line: `This bot's computer \`${computer.name}\` is offline. Turn it on, or let the routine run without it.` });
        }
      }
      if (checks.length === start) checks.push(ready(kind));
    }
    const bounded = checks.sort((a, b) => Number(a.ok) - Number(b.ok)).slice(0, 100).map(check => ({ ...check,
      line: clean(check.line), ...(check.params ? { params: Object.fromEntries(Object.entries(check.params).map(([key, value]) => [key, clean(value).slice(0, 100)])) } : {}),
    }));
    return { ok: bounded.every(check => check.ok), checks: bounded };
  } catch (error) {
    return { ok: mode === "run", checks: [{ kind: "engine", ok: mode === "run", code: "probe_error", params: { kind: "engine" }, line: "The readiness check could not finish. Check the routine again.", detail: clean(error) }] };
  }
}
