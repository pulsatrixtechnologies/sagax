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
  // 188 after the 2026-10-11 upstream sync, which moved two routes out of index.ts.
  // +1 each from the 0.5.0 integration (2026-10-12) of PRs that kept a guard in index.ts:
  // GET /healthz (#372), /api/threads/:id/cw-actions (#364), /api/instances/:id/api-key (#383)
  // and the terminal session WebSocket upgrade (#353). Moving them to server/routes lowers these.
  // 2026-10-19 upstream sync: + /api/internal/request-sign-in (#2707) and /api/internal/assignment-status,
  // minus the one-release alias routes (ask-bot, delegate-bot, delegations/:id) the runtime move removed;
  // upstream's /api/internal/fill-login (saved logins) was not taken.
  'path === "/': 186,
  "path.match(": 98,
  "path.startsWith(": 14,
  ".exec(path)": 24,
  ".test(path)": 8,
  ".includes(path)": 3,
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
