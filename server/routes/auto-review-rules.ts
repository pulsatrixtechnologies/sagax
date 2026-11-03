// Settings > Bot > Auto-review Rules: every saved command rule ("always allow
// this exact command here"), in one list with a count, and removing one.
//
//   GET    /api/auto-review/rules     -> { rules: [{ id, scope, botId, botName, command, cwd, providerInstanceId }],
//                                          global: [], total }
//   DELETE /api/auto-review/rules/:id -> the same list, without that rule
//
// Rules are kept per bot (server/command-allowlist.ts, also managed at
// /api/bots/:id/command-allowlist). Sagax keeps no server-wide command rule
// today, so `global` is always empty; it is in the answer so a client counts
// right if one is ever added. The same people who manage a bot's rules
// manage them here: the owner at this computer (the paired phone included)
// and admins. Admin scope for sessions.
import type { CommandAllowlistRule } from "../../shared/command-allowlist.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface AutoReviewRule extends CommandAllowlistRule {
  /** `cmd.<botId>.<ruleId>`: stable, and enough to remove it. */
  id: string;
  scope: "bot";
  botId: string;
  botName: string;
}

export interface AutoReviewRuleRouteDeps {
  bots: () => ReadonlyArray<{ id: string; name: string }>;
  rules: (botId: string) => CommandAllowlistRule[];
  remove: (botId: string, ruleId: string) => boolean;
  mayManage: (auth: RequestAuth) => boolean;
}

const ITEM = /^\/api\/auto-review\/rules\/cmd\.([\w-]+)\.([\w-]+)$/;

export function createAutoReviewRuleRoutes(deps: AutoReviewRuleRouteDeps): RouteHandler {
  const list = () => {
    const rules: AutoReviewRule[] = [];
    for (const bot of deps.bots()) {
      for (const rule of deps.rules(bot.id)) rules.push({ ...rule, id: `cmd.${bot.id}.${rule.id}`, scope: "bot", botId: bot.id, botName: bot.name });
    }
    return { rules, global: [] as AutoReviewRule[], total: rules.length };
  };
  return async ({ res, path, method, auth, json }) => {
    if (path !== "/api/auto-review/rules" && !path.startsWith("/api/auto-review/rules/")) return PASS;
    res.setHeader("cache-control", "no-store");
    if (!deps.mayManage(auth)) return json(res, 403, { error: "Only the workspace owner or an admin can manage command permissions." });
    if (path === "/api/auto-review/rules") {
      if (method !== "GET") return json(res, 405, { error: "GET only" });
      return json(res, 200, list());
    }
    if (method !== "DELETE") return json(res, 405, { error: "DELETE only" });
    const m = ITEM.exec(path);
    if (!m) return json(res, 404, { error: "no such rule" });
    const bot = deps.bots().find((candidate) => candidate.id === m[1]);
    if (!bot || !deps.remove(bot.id, m[2]!)) return json(res, 404, { error: "no such rule" });
    return json(res, 200, list());
  };
}
