// 2026-10-20: a desktop whose session the server refuses no longer asks 12
// to 24 times a minute (Windows 0.5.11 and 0.5.25 in the GOX logs).
import assert from "node:assert/strict";
import test from "node:test";

import { AUTH_BACKOFF_MAX_MS, createAuthBackoff, TRANSIENT_BACKOFF_MAX_MS } from "./auth-backoff.mjs";

test("a refused session backs off to 10 minutes; an unreachable server to a minute; a success starts over", () => {
  const backoff = createAuthBackoff({ baseMs: 5_000, random: () => 0 });
  const refused = { status: 401 };
  const waits = Array.from({ length: 10 }, () => backoff.next(refused));
  assert.deepEqual(waits.slice(0, 4), [5_000, 10_000, 20_000, 40_000]);
  assert.equal(waits.at(-1), AUTH_BACKOFF_MAX_MS);
  // an hour of a signed-out desktop: a handful of requests, not 720 to 1440
  let total = 0;
  let requests = 0;
  const fresh = createAuthBackoff({ baseMs: 5_000, random: () => 0 });
  while (total < 60 * 60_000) { total += fresh.next(refused); requests += 1; }
  assert.ok(requests < 20, `${requests} requests in an hour`);
  backoff.reset();
  assert.equal(backoff.next(refused), 5_000);
  const down = createAuthBackoff({ baseMs: 5_000, random: () => 0 });
  for (let i = 0; i < 10; i++) down.next(new Error("ECONNREFUSED"));
  assert.equal(down.next({ status: 503 }), TRANSIENT_BACKOFF_MAX_MS);
});
