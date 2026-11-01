import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { launchVerificationServer, verificationServerArgs, verificationServerEnvironment } from "../scripts/control-omb.ts";
import { waitForExit } from "./testing/cleanup.ts";

it("resumes a real HTTP upload after the fixture server restarts and serves the committed bytes", async () => {
  const fixture = await launchVerificationServer({ ...process.env, SAGAX_CONTENT_ENCRYPTION: "off" });
  let restarted: ChildProcess | undefined;
  const uploadId = "11111111-1111-4111-8111-111111111111";
  const prefix = `${fixture.info.url}/api/files?name=notes.txt&uploadId=${uploadId}&total=6`;
  const request = (phase: string, offset = 0, body?: string) => fetch(`${prefix}&phase=${phase}&offset=${offset}`, {
    method: "POST", headers: { "content-type": "text/plain" }, body,
  });
  try {
    const first = await request("chunk", 0, "abc");
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ offset: 3 });
    fixture.child.kill("SIGTERM");
    await waitForExit(fixture.child);
    const env = verificationServerEnvironment({ ...process.env, SAGAX_CONTENT_ENCRYPTION: "off" }, fixture.info.dataDir, Number(new URL(fixture.info.url).port));
    restarted = spawn(process.execPath, verificationServerArgs(env), { cwd: process.cwd(), env, stdio: "ignore" });
    await expect.poll(async () => {
      try { return (await fetch(`${fixture.info.url}/api/config`)).status; } catch { return 0; }
    }, { timeout: 30_000 }).toBe(200);
    const status = await request("status");
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ offset: 3 });
    expect((await request("chunk", 3, "def")).status).toBe(200);
    const committed = await request("commit");
    expect(committed.status).toBe(200);
    const result = await committed.json() as { saved: { path: string; bytes: number } };
    expect(result.saved.bytes).toBe(6);
    expect(readFileSync(result.saved.path, "utf8")).toBe("abcdef");
    const replay = await request("commit");
    expect(await replay.json()).toEqual({ offset: 6, total: 6, saved: result.saved });
    const created = await fetch(`${fixture.info.url}/api/bots`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const { bot } = await created.json() as { bot: { id: string; threadId: string } };
    const sent = await fetch(`${fixture.info.url}/api/bots/${bot.id}/messages`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: `Read this\n\n<attached-file path="${result.saved.path}" name="notes.txt" />` }),
    });
    expect(sent.status).toBe(202);
    const listing = await fetch(`${fixture.info.url}/api/threads/${bot.threadId}/files`);
    const { files } = await listing.json() as { files: { id: string; name: string }[] };
    const file = await fetch(`${fixture.info.url}/api/threads/${bot.threadId}/files/${files.find((entry) => entry.name === "notes.txt")!.id}`);
    expect(file.status).toBe(200);
    expect(await file.text()).toBe("abcdef");
  } finally {
    if (restarted && restarted.exitCode === null) { restarted.kill("SIGTERM"); await waitForExit(restarted); }
    await fixture.close();
  }
}, 60_000);
