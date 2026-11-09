// #3196 (QA 0.8.77): a routine run's sagax_settings get of
// security.myToolGrants still answered "no_person" after #3151, because a
// routine never acts on a "Bot act" copy of a live session: it acts through
// loopback on a personal server, or on a one-request "Routine act" session
// while its owner is signed out. Through the real server and the fake
// engine: the run reads its owner's grants; a revoke from the run stays a
// card for the person and the grant is still active.
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlOmb } from "../../scripts/control-omb.ts";
import { removeTempDir } from "../testing/cleanup.ts";

it("a routine run reads its owner's tool grants; revoking one still waits for the person", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "sagax-routine-grants-"));
  const dump = join(scratch, "mcp-dump.json");
  const fixture = await launchVerificationServer({
    ...process.env,
    FAKE_CLAUDE_REPLIES: JSON.stringify(["Grants reviewed."]),
    FAKE_CLAUDE_REPLY_STATE: join(scratch, "reply-index"),
    FAKE_CLAUDE_MCP_CALLS: JSON.stringify([
      { server: "agents", tool: "sagax_settings", when: "GRANTCHECK", arguments: { action: "get", key: "security.myToolGrants" } },
      { server: "agents", tool: "sagax_settings", when: "GRANTWRITE", arguments: { action: "set", key: "security.myToolGrants", value: "GRANT_ID" } },
    ]),
    FAKE_CLAUDE_MCP_DUMP: dump,
  });
  const api = async (method: string, path: string, body?: unknown, status = 200) => {
    const response = await fetch(`${fixture.info.url}${path}`, {
      method, headers: { "content-type": "application/json", origin: fixture.info.url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json() as any;
    expect(response.status, `${method} ${path}: ${JSON.stringify(value)}`).toBe(status);
    return value;
  };
  try {
    const { grant } = await api("POST", "/api/me/tool-grants", { scope: "mail:read" }, 201);
    const { bot } = await runControlOmb(["new-bot", "--name", "Reviewer", "--url", fixture.info.url]) as any;
    const { routine } = await api("POST", "/api/routines", {
      name: "Tool access review", prompt: "GRANTCHECK GRANTWRITE Review my tool access.", botId: bot.id, enabled: false,
      schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 3_600_000 },
    }, 201);
    const started = await api("POST", `/api/routines/${routine.id}/run`, {}, 201);
    const runId = (started.run ?? started).id;
    await expect.poll(async () => (await api("GET", "/api/routines")).runs.find((run: any) => run.id === runId)?.status, { timeout: 30_000 }).toBe("completed");
    await expect.poll(() => existsSync(dump), { timeout: 10_000 }).toBe(true);
    const calls = JSON.parse(readFileSync(dump, "utf8")).calls as Array<{ ok: boolean; text: string }>;
    expect(calls).toHaveLength(2);
    // the read: the owner's own grant, no "no_person"
    expect(calls[0].ok, calls[0].text).toBe(true);
    expect(calls[0].text).not.toContain("no_person");
    expect(calls[0].text).toContain(grant.id);
    expect(calls[0].text).toContain("mail:read");
    // the write: never done by the run on its own
    expect(calls[1].text).not.toMatch(/"ok"\s*:\s*true/);
    const mine = (await api("GET", "/api/me/tool-grants")).grants as any[];
    expect(mine.find((row) => row.id === grant.id)?.state).toBe("active");
  } finally {
    await fixture.close();
    await removeTempDir(scratch);
  }
}, 120_000);
