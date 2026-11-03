// The durable revocation queue (slice 6, fix 2) on a fake clock: pacing,
// Retry-After, back-off, restart, sealing and logs without tokens.
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { IDP_REVOCATIONS_FILE, REVOCATION_BACKOFF_MS, REVOCATION_CAP, REVOCATION_MAX_AGE_MS, RevocationQueue } from "./idp-revocations.ts";
import { TokenCallPacer } from "./idp-token-pacer.ts";
import type { RevokeAttempt } from "./oidc-rp.ts";

const KEY = "c".repeat(64);
let dir: string;
let clock: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omb-revocations-"));
  clock = 1_800_000_000_000;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function setup(options: { answers?: Array<RevokeAttempt>; budget?: number; key?: "ok" | "unavailable" } = {}) {
  const pacer = new TokenCallPacer({ budget: options.budget ?? 45, now: () => clock });
  const sent: Array<{ token: string; at: number }> = [];
  const logs: string[] = [];
  const answers = options.answers ?? [];
  const make = () => new RevocationQueue({
    dataDir: dir,
    keySource: () => (options.key === "unavailable" ? { kind: "unavailable", reason: "no key on this launch" } : { kind: "key", key: Buffer.from(KEY, "hex") }),
    pacer,
    send: async (token) => { sent.push({ token, at: clock }); return answers.shift() ?? { kind: "done" }; },
    now: () => clock,
    log: (line) => logs.push(line),
    schedule: () => () => {},
  });
  return { pacer, sent, logs, answers, make, queue: make() };
}

describe("RevocationQueue", () => {
  it("logs the queued revocation, the rate limit and the wait, never the token (e2e S6-14c)", async () => {
    const { queue, logs } = setup({ answers: [{ kind: "rate_limited", retryAfterMs: 60_000 }] });
    queue.enqueue("pxlr1.secret-a", "refresh_token", "session ended");
    queue.enqueue("pxlr1.secret-b", "refresh_token", "session ended");
    await queue.pump();
    await queue.pump();
    expect(logs.some((line) => /a revocation \(session ended\) is queued; 2 pending/.test(line))).toBe(true);
    expect(logs.some((line) => /Perspicax rate limited a revocation \(session ended\); it is retried in 60 s/.test(line))).toBe(true);
    expect(logs.filter((line) => /pending revocation\(s\) wait 60 s for Perspicax's rate limit pause/.test(line))).toHaveLength(1);
    expect(logs.join("\n")).not.toContain("secret");
  });

  it("waits a 429's Retry-After before the next attempt", async () => {
    const { queue, sent, pacer } = setup({ answers: [{ kind: "rate_limited", retryAfterMs: 60_000 }] });
    queue.enqueue("pxlr1.limited", "refresh_token", "session ended");
    await queue.pump();
    expect(sent).toHaveLength(1);
    expect(pacer.pauseRemaining()).toBe(60_000);
    clock += 59_000;
    await queue.pump();
    expect(sent).toHaveLength(1);
    clock += 1_000;
    await queue.pump();
    expect(sent).toHaveLength(2);
    expect(sent[1]!.at - sent[0]!.at).toBe(60_000);
    expect(queue.size()).toBe(0);
  });

  it("drops an entry on a definitive 400, and backs off 30 s doubling on a failure", async () => {
    const { queue, sent } = setup({ answers: [{ kind: "drop", why: "the provider answered 400 (invalid_request)" }, { kind: "retry", why: "the provider answered 503" }, { kind: "retry", why: "timeout" }] });
    queue.enqueue("pxlr1.a", "refresh_token", "discarded");
    await queue.pump();
    expect(queue.size()).toBe(0);
    queue.enqueue("pxlr1.b", "refresh_token", "orphan");
    await queue.pump();
    expect(sent).toHaveLength(2);
    clock += REVOCATION_BACKOFF_MS - 1;
    await queue.pump();
    expect(sent).toHaveLength(2);
    clock += 1;
    await queue.pump();
    expect(sent).toHaveLength(3);
    clock += REVOCATION_BACKOFF_MS;
    await queue.pump();
    expect(sent).toHaveLength(3);
    clock += REVOCATION_BACKOFF_MS;
    await queue.pump();
    expect(sent).toHaveLength(4);
    expect(queue.size()).toBe(0);
  });

  it("sends after a restart what was pending", async () => {
    const first = setup({ answers: [{ kind: "retry", why: "the provider could not be reached" }] });
    first.queue.enqueue("pxlr1.pending", "refresh_token", "session ended");
    await first.queue.pump();
    expect(first.queue.size()).toBe(1);
    first.queue.stop();
    clock += REVOCATION_BACKOFF_MS;
    const second = setup();
    expect(second.queue.size()).toBe(1);
    await second.queue.pump();
    expect(second.sent.map((call) => call.token)).toEqual(["pxlr1.pending"]);
    expect(second.queue.size()).toBe(0);
    expect(existsSync(join(dir, IDP_REVOCATIONS_FILE))).toBe(false);
  });

  it("seals the file 0600 and never holds a token in clear, in the file or the log", async () => {
    const { queue, logs } = setup({ answers: [{ kind: "retry", why: "the provider answered 503" }, { kind: "rate_limited", retryAfterMs: 1_000 }] });
    queue.enqueue("pxlr1.SECRET-token-value", "refresh_token", "session ended");
    await queue.pump();
    const file = join(dir, IDP_REVOCATIONS_FILE);
    const raw = readFileSync(file, "utf8");
    expect(raw).not.toContain("pxlr1.SECRET-token-value");
    expect(raw).not.toContain("SECRET");
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    clock += REVOCATION_BACKOFF_MS;
    await queue.pump();
    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) expect(line).not.toContain("SECRET");
  });

  it("makes one attempt at once when the store cannot seal, and says the entry was not kept", async () => {
    const { queue, sent, logs } = setup({ key: "unavailable", answers: [{ kind: "retry", why: "down" }] });
    queue.enqueue("pxlr1.SECRET-unkept", "refresh_token", "replaced");
    await new Promise((resolve) => setImmediate(resolve));
    expect(sent.map((call) => call.token)).toEqual(["pxlr1.SECRET-unkept"]);
    expect(queue.size()).toBe(0);
    expect(logs.join("\n")).toMatch(/could not be kept/);
    for (const line of logs) expect(line).not.toContain("SECRET");
  });

  it("drops entries older than 30 days, and the oldest past the cap, logging only counts", async () => {
    const { queue, logs, sent } = setup({ answers: [{ kind: "retry", why: "down" }] });
    queue.enqueue("pxlr1.old", "refresh_token", "session ended");
    await queue.pump();
    clock += REVOCATION_MAX_AGE_MS;
    await queue.pump();
    expect(queue.size()).toBe(0);
    expect(sent).toHaveLength(1);
    expect(logs.some((line) => /1 revocation\(s\) older than 30 days dropped/.test(line))).toBe(true);
    const capped = setup({ budget: 1 });
    for (let i = 0; i <= REVOCATION_CAP; i += 1) {
      clock += 1;
      capped.queue.enqueue(`pxlr1.n${i}`, "refresh_token", "orphan");
    }
    expect(capped.queue.size()).toBe(REVOCATION_CAP);
    expect(capped.logs.some((line) => /1 revocation\(s\) dropped past the cap of 5000/.test(line))).toBe(true);
    await capped.queue.pump();
    // the oldest went: the first one sent is the second enqueued
    expect(capped.sent[0]?.token).toBe("pxlr1.n1");
  }, 60_000);

  it("keeps one call in flight at a time", async () => {
    let inFlight = 0;
    let most = 0;
    const pacer = new TokenCallPacer({ budget: 45, now: () => clock });
    const queue = new RevocationQueue({
      dataDir: dir,
      keySource: () => ({ kind: "key", key: Buffer.from(KEY, "hex") }),
      pacer,
      send: async () => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise((resolve) => setImmediate(resolve));
        inFlight -= 1;
        return { kind: "done" };
      },
      now: () => clock,
      log: () => {},
      schedule: () => () => {},
    });
    for (let i = 0; i < 5; i += 1) queue.enqueue(`pxlr1.${i}`, "refresh_token", "orphan");
    await Promise.all([queue.pump(), queue.pump(), queue.pump()]);
    expect(most).toBe(1);
    expect(queue.size()).toBe(0);
  });
});
