// server/index.ts may not gain request-path guards; new routes go in server/routes (see its README).
// Counted per occurrence. Each count must equal its number here, so a PR that moves a route out lowers it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const INDEX = readFileSync(new URL("../../server/index.ts", import.meta.url), "utf8");

const EXACT: Record<string, number> = {
  // Internal harness routes have no server/routes module yet; moving them out is the follow-up that lowers this.
  // Counted on Sagax's server/index.ts, which keeps its own routes (organization, Perspicax, MCP sign-in, read receipts #166) there,
  // plus the fork routes merged on main after the 2026-10-08 sync branch was cut (the PRs after #176, Auto model #153 among them).
  // 190: DELETE /api/routine-runs ("Clear logs", #238), then the routes of the PRs merged on 2026-10-09 that kept
  // them in index.ts (people threads, reactions and Seen by, bot zip #271, persona Rules and Files, plugin updates #272).
  // 192 after #931 (Messages on the bot's Mac): POST /api/internal/messages/mcp, one guard in the route chain and one in the handler
  // (covered by the /api/internal/ policy row). 188 after the 2026-10-11 upstream sync, which moved two routes out of index.ts.
  // +1 each from the 0.5.0 integration (2026-10-12) of PRs that kept a guard in index.ts:
  // GET /healthz (#372), /api/threads/:id/cw-actions (#364), /api/instances/:id/api-key (#383)
  // and the terminal session WebSocket upgrade (#353). Moving them to server/routes lowers these.
  // 186 and 93: connector routes left index.ts with the connected-apps client.
  // 184: the organization library routes moved to server/routes/org-library.ts (#1388).
  // The file already had 188 of these guards (two over the previous pin of 186) before that move.
  // 185: +1 POST /api/internal/run-with-engine (#1477), kept in index.ts.
  // 186: +1 POST /api/internal/page-comments (#1553), an internal route on the turn's capability, kept in index.ts.
  // 183: the three legacy TTS routes now use the unified voice module.
  // 186: +3 the resumable upload phases (POST /api/attachments and /api/files with ?phase=, one guard
  // and two uses of the path in the handler), kept in index.ts beside the single-request routes they
  // share finalization with. Moving them to server/routes lowers this.
  // 185: wave 0a removed the dead CLOUD_HOME email-sign-in refusal guard (#1388).
  // 167: wave 1 I2 moved memory/context internal routes to server/routes/internal-memory.ts (#1388).
  // 159: wave 1 I3 moved routines / request / team-setup / bot-deletion internal routes (#1388).
  // 150: wave 1 I4 moved sessions/files internal routes to server/routes/internal-sessions.ts (#1388).
  // 130: wave 1 I5 moved ask-bot / delegate-bot / rooms / create-* internal routes (#1388).
  // 89: wave 1 I5 moved delegations path.match to server/routes/internal-bot-chat.ts (#1388).
  // 144: wave 1 I6 moved mcp-servers / github-connect / request-credential / voice-note / perspicax/mcp (#1388).
  // 132: wave 1 I1 moved environments internal routes to server/routes/internal-environments.ts (#1388).
  // 118: I1 + I5 combined on feat/next-integration (#1388).
  // 104: wave 2 P1 alone moved team-map / teams export-scout-import / team-library / sidebar-sections /
  // team-memory / section-context / team-computers to server/routes (#1388).
  // On feat/next-integration without P1: 108 P2 routines/calendar-calls/webhooks, 102 P3
  // attachments/files/search, 100 P4 groups list/create, 94 P6 local-computer/computers.
  // 80: P1 + P2 + P3 + P4 + P6 combined on refactor/1388-w2-p1 after merging feat/next-integration (#1388).
  // 98: wave 2 P5 alone moved instances/config/health/browser-engine/plan-usage/keys/decisions/admin-activity/cli/mcp (#1388).
  // 60: P1+P2+P3+P4+P5+P6 combined after merging feat/next-integration into refactor/1388-w2-p5 (#1388).
  // 55: wave 3 B1 moved /api/bots list+create and /api/bot-defaults* (#1388).
  // 54: wave 3 T1 moved post-gate /api/events (#1388).
  // 34: wave 4 pre-auth moved healthz/environment/mcp-oauth/email/pair/session/
  // logout/pairing/custom-domain/shared-computers (#1388).
  // 23: leftover me/engines, org/bots, people avatar, routine-delegation stub,
  // adminAuditPlan and externalRuntimeMayCall moved out of index (#1388).
  // 18: originGates (hosted health, join, pair) moved to request-pipeline (#1388).
  // 0: #1388 index-35k moved remaining path === guards into routes / pipeline / leaves.
  'path === "/': 0,
  // 90: the package preview path moved with the organization library routes.
  // 91: the thread file pin and the bot history routes moved to server/routes (#1099), after the
  // library pin (#1112) and the history owner rule (#1107) had taken it over 93.
  // GET /api/bots/:id/send-state (#1259) lives in server/routes/bot-send-state.ts, so the count stays at 91.
  // 91: +1 POST /api/groups/:id/leave (#1480, PR #1571), kept in index.ts with the group routes.
  // 90: wave 1 I4 moved threads/:id/close path.match to server/routes/internal-sessions.ts (#1388).
  // 89: wave 1 I5 moved delegations/:id path.match to server/routes/internal-bot-chat.ts (#1388).
  // 86: wave 2 P1 alone moved team-library/teams, team-memory/:id and team-computers path.match (#1388).
  // On feat/next-integration without P1: 82 P2, 80 P3, 70 P4, 59 P6.
  // 56: P1 + P2 + P3 + P4 + P6 combined on refactor/1388-w2-p1 after merging feat/next-integration (#1388).
  // 89: wave 2 P5 alone had path.match unchanged; combined after merge.
  // 42: wave 3 B1 moved profile/primary/soul/system-prompt/overview/cards/active-branch/projects/tasks (#1388).
  // On this base before B2 the live count was 46 (B1 pin was stale after later merges).
  // 36: wave 3 B2 moved bot skills / skills-library path.match to server/routes/bots-content.ts (#1388).
  // 27: wave 3 B3 moved messages/queue/edit/respond/interrupt path.match (#1388) on a B2-less base (46→37→27);
  // with B2 already at 36, B3 then T1 land at 17 after merge into feat/next-integration.
  // 17: wave 3 T1 moved cw-actions/read/messages/files/export/reactions/events path.match (#1388).
  // 15: wave 4 moved pairing/:id and sessions/:id path.match (#1388).
  // Remaining avatar, activity/outbound and credential routes moved to modules (#1388).
  // 2: bot model/read/Auto/allowlist/always-allow/PATCH/DELETE/request routes moved to bots-mutate.ts (#1388).
  // 0: #1388 index-35k moved remaining path.match guards into routes / pipeline / leaves.
  "path.match(": 0,
  // 13: wave 2 P5 moved hostedModels path.startsWith(/api/instances/) (#1388).
  // 12: wave 4 moved shared-computers path.startsWith (#1388).
  // 13: live count on origin/main 0.8.27 (c4c248539); pin matched after #1909.
  // 12: #1911 moved the backup exclusion into isWorkspaceBackupRoute.
  // 9: me-engines path.startsWith and adminAuditPlan internal/testing startsWith (#1388).
  // 8: originGates hosted/static startsWith moved (#1388).
  // 0: #1388 index-35k moved remaining path.startsWith guards into routes / pipeline / leaves.
  "path.startsWith(": 0,
  // 14: wave 2 P5 moved instances/mcp .exec(path) guards (#1388).
  // 13: wave 3 B2 moved the bot-skills gate .exec(path) (#1388).
  // 12: wave 3 B3 moved bot browser live/action .exec(path) (#1388).
  // 10: wave 4 moved domain-check and shared-computers .exec(path) (#1388).
  // Fleet proxy moved to server/routes/fleet.ts (#1388).
  // 1: me-engines login .exec and adminAuditPlan .exec moved (#1388).
  // 0: #1388 index-35k moved remaining .exec(path) guards into routes / pipeline / leaves.
  ".exec(path)": 0,
  // 7: externalRuntimeMayCall .test moved (#1388).
  // 5: originGates PUBLIC_INVITE_PATH.test moved with the module (#1388).
  // 0: #1388 index-35k moved the terminal session WebSocket .test(path) into isTerminalSessionWsPath leaf.
  ".test(path)": 0,
  // 3: wave 4 moved ENVIRONMENT_PATHS.includes(path) (#1388).
  // 1: originGates auth-path includes moved (#1388).
  // 0: #1388 index-35k moved remaining .includes(path) guards into routes / pipeline / leaves.
  ".includes(path)": 0,
};

const count = (needle: string) => INDEX.split(needle).length - 1;

describe("server/index.ts gains no route handlers", () => {
  it("matches request paths exactly as often as written here", () => {
    const changed = Object.entries(EXACT).flatMap(([needle, written]) => {
      const n = count(needle);
      if (n > written) return [`${needle} appears ${n} times, more than ${written}: put the new route in server/routes`];
      if (n < written) return [`${needle} appears ${n} times: lower its number here to ${n}`];
      return [];
    });
    expect(changed, "See server/routes/README.md").toEqual([]);
  });
});
