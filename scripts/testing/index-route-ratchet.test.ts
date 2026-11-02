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
  'path === "/': 167,
  // 90: the package preview path moved with the organization library routes.
  // 91: the thread file pin and the bot history routes moved to server/routes (#1099), after the
  // library pin (#1112) and the history owner rule (#1107) had taken it over 93.
  // GET /api/bots/:id/send-state (#1259) lives in server/routes/bot-send-state.ts, so the count stays at 91.
  // 91: +1 POST /api/groups/:id/leave (#1480, PR #1571), kept in index.ts with the group routes.
  "path.match(": 91,
  "path.startsWith(": 14,
  ".exec(path)": 24,
  ".test(path)": 9,
  ".includes(path)": 4,
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
