// Internal harness routes for sessions and files (#1388 slice I4):
// agents, threads (+ close), attach-file, vm-exec, rooms, session-search,
// session-read, skills, skills/stage.
//
// Answers only behind the per-turn capability the internal block of
// server/index.ts checks first. Capability gate and refusal checks stay there.
// Factory is a composer (#1383): each route group lives in a sibling file.
// Dispatch order matches the previous monolith.
import type { InternalRouteHandler } from "./internal-route.ts";
import { handleInternalSessionsFiles } from "./internal-sessions-files.ts";
import { handleInternalSessionsRecall } from "./internal-sessions-recall.ts";
import { handleInternalSessionsRoster } from "./internal-sessions-roster.ts";
import { handleInternalSessionsSkills } from "./internal-sessions-skills.ts";
import type { InternalSessionsDeps } from "./internal-sessions-types.ts";
import { PASS } from "./table.ts";

export type {
  InternalSessionsBot,
  InternalSessionsDeps,
  InternalSessionsGroup,
  InternalSessionsTask,
  InternalSessionsVm,
} from "./internal-sessions-types.ts";

const HANDLERS = [
  handleInternalSessionsRoster,
  handleInternalSessionsFiles,
  handleInternalSessionsRecall,
  handleInternalSessionsSkills,
] as const;

export function createInternalSessionsRoutes(deps: InternalSessionsDeps): InternalRouteHandler {
  return async (ctx) => {
    const internalSender = deps.bot(ctx.capability.botId);
    if (!internalSender) return PASS;
    for (const handle of HANDLERS) {
      const out = await handle(deps, ctx, internalSender);
      if (out !== PASS) return;
    }
    return PASS;
  };
}
