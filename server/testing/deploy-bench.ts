// The "full deploy" bench (2026-10-20, JC: zero sign-out from a deploy).
// Several people, each with several sessions (web, desktop, phone), on a
// real organization server and a fake Perspicax that rotates refresh tokens
// with its 30 s reuse grace. Then, one after the other:
//
//   1. Sagax redeployed cleanly (SIGTERM, a new process on the same data);
//   2. Sagax killed (SIGKILL) while refreshes are in flight, their answers
//      lost with it;
//   3. Perspicax redeployed: down while sessions refresh, up again, and one
//      refresh answer cut on the way (the rotation happened, the answer was
//      lost);
//   4. the desktop app updated: a new client with only the cookie jar.
//
// After each step every session must still be served: a 401 is a sign-out
// and fails the bench; a 503 (Sagax confirming sign-ins after a restart) is
// retried like a client would.
import type { FakeOidcUser } from "./fake-oidc-provider.ts";
import { startOrgServer, type Auth, type OrgServer } from "./org-server-harness.ts";

export interface DeployBenchResult {
  people: number;
  sessions: number;
  checks: number;
  logouts: Array<{ step: string; who: string; code: string }>;
  retried503: number;
  refreshes: number;
  steps: Array<{ step: string; ms: number }>;
  /** The server's sign-in lines (idp:, auth:, sessions:), when a sign-out happened. */
  serverLines?: string[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runDeployBench(options: { people?: number; sessionsPerPerson?: number; log?: (line: string) => void } = {}): Promise<DeployBenchResult> {
  const peopleCount = options.people ?? 4;
  const perPerson = options.sessionsPerPerson ?? 3;
  const log = options.log ?? (() => {});
  const people: FakeOidcUser[] = Array.from({ length: peopleCount }, (_, i) => ({
    sub: `01JBENCH${String(i).padStart(18, "0")}`,
    email: `p${i}@example.test`, name: `Person ${i}`, preferred_username: `p${i}`, role: i === 0 ? "admin" : "employee",
  }));
  // Perspicax's own ceiling (60 token calls a minute): with a refresh due
  // every second the bench makes far more calls than a real day would.
  const org: OrgServer = await startOrgServer({ user: people[0]!, refreshAfterSeconds: 1, prefix: "sagax-deploy-bench-", env: { SAGAX_PERSPICAX_TOKEN_BUDGET: "60" } });
  org.idp.reuseGraceMs = 30_000;
  const result: DeployBenchResult = { people: peopleCount, sessions: 0, checks: 0, logouts: [], retried503: 0, refreshes: 0, steps: [] };
  try {
    const sessions: Array<{ who: string; auth: Auth }> = [];
    for (const user of people) {
      for (let n = 0; n < perPerson; n++) sessions.push({ who: `${user.preferred_username}#${n}`, auth: await org.signIn(user) });
    }
    result.sessions = sessions.length;
    const checkAll = async (step: string) => {
      for (const { who, auth } of sessions) {
        for (let attempt = 0; ; attempt++) {
          const answer = await org.api("GET", "/api/auth/session", auth);
          result.checks += 1;
          if (answer.status === 200) break;
          // a 503 is "retry" (a restart confirming sign-ins, the token
          // budget paced): the clients wait it out, up to two minutes here
          if (answer.status === 503 && attempt < 120) {
            result.retried503 += 1;
            await sleep(1_000);
            continue;
          }
          result.logouts.push({ step, who, code: String(answer.body?.code ?? answer.status) });
          break;
        }
      }
    };
    const step = async (name: string, run: () => Promise<void>) => {
      const started = Date.now();
      await run();
      await checkAll(name);
      result.steps.push({ step: name, ms: Date.now() - started });
      log(`${name}: ${result.logouts.length} sign-out(s) so far`);
    };

    await step("baseline", async () => { await sleep(1_200); });
    await step("sagax-clean-restart", async () => {
      await org.restart("SIGTERM");
    });
    await step("sagax-crash-mid-refresh", async () => {
      await sleep(1_200);
      org.idp.delayNextRefreshAnswer(4_000);
      // every session is due: their refreshes start, one answer is held
      const inFlight = sessions.map(({ auth }) => org.api("GET", "/api/auth/session", auth).catch(() => null));
      await sleep(600);
      await org.kill("SIGKILL");
      await Promise.all(inFlight);
      await org.start();
    });
    await step("perspicax-redeploy", async () => {
      await sleep(1_200);
      await org.idp.stop();
      // sessions keep being used while Perspicax is down
      for (const { auth } of sessions) {
        const answer = await org.api("GET", "/api/auth/session", auth);
        result.checks += 1;
        if (answer.status === 401) result.logouts.push({ step: "perspicax-down", who: "?", code: String(answer.body?.code ?? 401) });
      }
      await sleep(1_000);
      await org.idp.start();
      // one answer lost on the way: rotated at Perspicax, never received
      org.idp.dropNextRefreshAnswer();
      await sleep(1_200);
      for (const { auth } of sessions) await org.api("GET", "/api/auth/session", auth);
      // the quick retries (5 s, then 15 s) run inside the reuse grace
      await sleep(17_000);
    });
    await step("app-update", async () => {
      // a new desktop build: empty HTTP cache, the same cookie jar, after a
      // server deploy that outran its grace
      await org.restart("SIGKILL");
    });
    await step("after", async () => { await sleep(1_200); });
    result.refreshes = org.idp.refreshCount;
    if (result.logouts.length) result.serverLines = org.log().split("\n").filter((line) => /\b(idp|auth|sessions):/.test(line)).slice(-80);
    return result;
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${org.log().slice(-3000)}`);
  } finally {
    await org.close();
  }
}
