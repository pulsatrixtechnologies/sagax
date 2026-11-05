// Shared helpers for bot mutate routes (#1383). Never imports server/index.ts.
import type { ApprovalMode } from "../../shared/approval-mode.ts";
import type { ModelSelection } from "../../shared/model-selection.ts";
import type { RouteContext } from "./table.ts";

/** Injected closures from index.ts. Pure move; host locals stay loosely typed. */
export type BotsMutateRouteDeps = Record<string, any>;

/** One request: route deps plus the authenticated RouteContext fields. */
export type BotsMutateEnv = BotsMutateRouteDeps & RouteContext;

/** Mutable bag for one PATCH /api/bots/:id. Phases write only the fields they own. */
export type BotPatchState = {
  m: RegExpMatchArray;
  body: any;
  patchStepUp: any;
  existingBot: any;
  selectedTask: any;
  beforeProfile: any;
  beforeVisibility: any;
  beforeBrowserProfile: any;
  beforeBrowserEnabled: any;
  normalizedSelection: ModelSelection | undefined;
  profile: any;
  patch: Record<string, unknown>;
  section: string | null | undefined;
  computerSpecified: boolean;
  requestedComputer: any;
  requestedMcpServers: any;
  requestedApprovalMode: ApprovalMode | undefined;
  currentApprovalMode: ApprovalMode | undefined;
};

export function createBotPatchState(m: RegExpMatchArray): BotPatchState {
  return {
    m,
    body: undefined,
    patchStepUp: undefined,
    existingBot: undefined,
    selectedTask: undefined,
    beforeProfile: undefined,
    beforeVisibility: undefined,
    beforeBrowserProfile: undefined,
    beforeBrowserEnabled: undefined,
    normalizedSelection: undefined,
    profile: undefined,
    patch: {},
    section: undefined,
    computerSpecified: false,
    requestedComputer: undefined,
    requestedMcpServers: undefined,
    requestedApprovalMode: undefined,
    currentApprovalMode: undefined,
  };
}

export function bindBotsMutateEnv(deps: BotsMutateRouteDeps, ctx: RouteContext): BotsMutateEnv {
  return { ...deps, ...ctx };
}

/** Several conversations and no thread id: the change has to name one (#1674). */
export function requirePinnedClientThread(env: BotsMutateEnv, botId: string, threadId: unknown): void {
  const owner = env.store.bot(botId);
  if (threadId === undefined &&
    (env.auth.kind === "session" || env.req.headers["x-openmausbot-companion"] === "1") &&
    // Organization server: only the caller's own threads count, never an
    // outside agent's conversation with the bot (shared/agent-conversation.ts).
    (owner ? env.threadsShownTo(owner, env.store.tasks(botId), env.scopedThreadViewer()) : env.store.tasks(botId)).filter((task: any) => !env.isAgentConversation(task)).length > 1) {
    // #1674: the request did not say which conversation it is for. An up
    // to date app names it (Edit bot, Edit N bots, sagax_settings); the
    // words never blame the app's version, which may well be current.
    throw Object.assign(new Error("This bot has several conversations and the change did not say which one. Open the conversation to change, then try again."), { status: 409, code: "thread_required" });
  }
}
