// Full deploy bench (2026-10-20): N people with several sessions each, Sagax
// redeployed cleanly and killed mid-refresh, Perspicax redeployed with a
// rotation whose answer is lost, the desktop app updated. Fails on any
// sign-out. Isolated: a temp home, a fake Perspicax, free ports.
//
//   node --experimental-strip-types scripts/bench-deploy-no-logout.ts [people] [sessions-per-person]
import { runDeployBench } from "../server/testing/deploy-bench.ts";

const people = Number(process.argv[2] ?? 4) || 4;
const perPerson = Number(process.argv[3] ?? 3) || 3;
const started = Date.now();
const result = await runDeployBench({ people, sessionsPerPerson: perPerson, log: (line) => console.log(line) });
console.log(JSON.stringify({ ...result, totalMs: Date.now() - started }, null, 2));
if (result.logouts.length) {
  console.error(`FAIL: ${result.logouts.length} sign-out(s) during the deploy`);
  process.exit(1);
}
console.log(`OK: ${result.sessions} sessions of ${result.people} people, ${result.checks} checks, 0 sign-out`);
