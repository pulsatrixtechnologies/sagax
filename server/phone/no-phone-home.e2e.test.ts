// Starting the server and running a chat turn must not even try to reach the
// original OpenMausBot services, PostHog or the upstream author's GitHub. The
// fixture logs every outbound socket, lookup and refused request
// (server/testing/network-audit.mjs); any blocked host there fails the test.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { isBlockedHost } from "../../electron/upstream-hosts.mjs";
import { launchVerificationServer, runControlOmb } from "../../scripts/control-omb.ts";

it("starts and runs a chat turn without contacting a blocked host", async () => {
  const auditDir = mkdtempSync(join(tmpdir(), "sagax-network-audit-"));
  const auditFile = join(auditDir, "audit.jsonl");
  const fixture = await launchVerificationServer({ ...process.env, SAGAX_TEST_NETWORK_AUDIT: auditFile });
  try {
    const control = (args: string[]) => runControlOmb([...args, "--url", fixture.info.url]) as Promise<any>;
    const bots = await (await fetch(`${fixture.info.url}/api/bots`, { headers: { origin: fixture.info.url } })).json() as { bots: Array<{ id: string; threadId: string }> };
    const bot = bots.bots[0]!;
    await control(["send", "--bot", bot.id, "--task", bot.threadId, "--text", "What is 2 + 2? Answer with the number."]);
    expect((await control(["wait", "--bot", bot.id, "--task", bot.threadId, "--timeout", "30"])).status).toBe("settled");
    // Let start-up timers that fire after the first turn run too.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  } finally {
    await fixture.close();
  }
  expect(existsSync(auditFile)).toBe(true);
  const entries = readFileSync(auditFile, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { kind: string; host?: string });
  rmSync(auditDir, { recursive: true, force: true });
  expect(entries.some((entry) => entry.kind === "armed")).toBe(true);
  expect(entries.filter((entry) => entry.kind === "refused")).toEqual([]);
  expect(entries.filter((entry) => entry.host && isBlockedHost(entry.host))).toEqual([]);
}, 90_000);
