// #3599: an organization server started on a busy data folder
// (server/testing/busy-org-fixture.ts) still loads everything it loaded:
// right after the first health answer, a person's routines carry their
// health and every one of their runs, the settled history the start leaves
// for later included, and the call a stop cut closes once the start's
// sliced sweep reaches it.
import { describe, expect, it } from "vitest";

import { BUSY_ORG, busyOrgPeople, seedBusyOrg } from "../testing/busy-org-fixture.ts";
import { startOrgServer } from "../testing/org-server-harness.ts";

describe.skipIf(process.platform === "win32")("a start on a busy organization server", () => {
  it("lists a person's routines with their health and their whole run history right after the start", async () => {
    const people = busyOrgPeople();
    const org = await startOrgServer({ user: people[0]!, prefix: "sagax-busy-org-" });
    try {
      const { bots, cut } = await seedBusyOrg(org);
      await org.start();
      const auth = await org.signIn(people[0]!);
      const answer = await org.api("GET", "/api/routines", auth);
      expect(answer.status).toBe(200);
      const mine = new Set(bots.filter((bot) => bot.owner === 0).map((bot) => bot.id));
      const ownRoutines = Array.from({ length: BUSY_ORG.routines }, (_, index) => index).filter((index) => mine.has(bots[index % bots.length]!.id));
      const routines = answer.body.routines as Array<{ id: string; weekRuns?: { total: number }; failureStreak?: number }>;
      expect(routines.map((routine) => routine.id).sort()).toEqual(ownRoutines.map((index) => `routine-${index}`).sort());
      expect(routines.every((routine) => (routine.weekRuns?.total ?? 0) > 0)).toBe(true);
      // the newest settled run of routine 0 failed (every seventh run fails)
      const lastOfRoutine0 = Math.max(...Array.from({ length: BUSY_ORG.runs }, (_, index) => index).filter((index) => index % BUSY_ORG.routines === 0));
      expect(routines.find((routine) => routine.id === "routine-0")?.failureStreak).toBe(lastOfRoutine0 % 7 === 0 ? 1 : undefined);
      const settled = Array.from({ length: BUSY_ORG.runs }, (_, index) => index).filter((index) => ownRoutines.includes(index % BUSY_ORG.routines));
      const runIds = new Set((answer.body.runs as Array<{ id: string }>).map((run) => run.id));
      expect(settled.filter((index) => !runIds.has(`old-${index}`))).toEqual([]);
      // the call an earlier run left open closes after the start, in slices
      // that give the loop back (#3599), and the conversation reads whole
      const owner = await org.signIn(people[bots.find((bot) => bot.id === cut.botId)!.owner]!);
      await expect.poll(async () => {
        const read = await org.api("GET", `/api/threads/${cut.threadId}/messages?limit=200`, owner);
        const rows = (read.body.messages ?? []) as Array<{ id: string; tool?: { ok?: boolean } }>;
        return { rows: rows.length, cut: rows.find((row) => row.id === cut.messageId)?.tool?.ok };
      }, { timeout: 20_000 }).toEqual({ rows: BUSY_ORG.rowsPerTopic + 1, cut: false });
    } finally {
      await org.close();
    }
  }, 180_000);
});
