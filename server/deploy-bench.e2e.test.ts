// "banc de déploiement" (2026-10-20): the full deploy of
// server/testing/deploy-bench.ts, small, in the e2e group. The bench script
// (scripts/bench-deploy-no-logout.ts) runs the same with more people.
import { describe, expect, it } from "vitest";

import { runDeployBench } from "./testing/deploy-bench.ts";

describe.skipIf(process.platform === "win32")("banc de déploiement", () => {
  it("redéploiement complet (Sagax propre et brutal, Perspicax avec rotation perdue, mise à jour de l'app) : 0 déconnexion", async () => {
    const result = await runDeployBench({ people: 3, sessionsPerPerson: 2 });
    expect(result.logouts).toEqual([]);
    expect(result.sessions).toBe(6);
    expect(result.steps.map((step) => step.step)).toEqual(["baseline", "sagax-clean-restart", "sagax-crash-mid-refresh", "perspicax-redeploy", "app-update", "after"]);
  }, 420_000);
});
