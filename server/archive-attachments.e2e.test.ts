// Attaching a zip in solo mode, end to end through the harness and the fake
// Claude CLI: the upload is unpacked next to it on this machine, the bot's
// message carries the manifest and the folder, in a chat and in a group, and
// the Files tab lists the archive.
import { existsSync, readFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { launchVerificationServer, type VerificationServer } from "../scripts/control-omb.ts";
import { tarArchive, zipArchive } from "./testing/archive-fixtures.mjs";

describe("archives attached in solo mode", () => {
  let session: VerificationServer;
  let prompts: string;
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${session.info.url}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json().catch(() => null) as any };
  };
  const upload = async (name: string, type: string, body: Buffer) => {
    const response = await fetch(`${session.info.url}/api/files?name=${encodeURIComponent(name)}`, { method: "POST", headers: { "content-type": type }, body });
    return { status: response.status, body: await response.json() as any };
  };
  const promptsSeen = () => existsSync(prompts) ? readFileSync(prompts, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.stringify(JSON.parse(line))) : [];

  beforeAll(async () => {
    prompts = join(tmpdir(), `sagax-archive-prompts-${process.pid}-${Date.now()}.jsonl`);
    session = await launchVerificationServer({
      ...process.env,
      FAKE_CLAUDE_PROMPTS: prompts,
      FAKE_CLAUDE_REPLIES: JSON.stringify(["Looked inside."]),
    });
  }, 30_000);

  afterAll(async () => {
    await session?.close();
  });

  it("unpacks a zip next to the upload and tells the bot what is inside, in a chat and in a group", async () => {
    const zip = zipArchive([
      { name: "project/README.md", data: "# Project" },
      { name: "project/src/main.ts", data: "export const x = 1;" },
      { name: "../escape.txt", data: "no" },
    ]);
    const saved = await upload("project.zip", "application/zip", zip);
    expect(saved.status).toBe(201);
    expect(saved.body).toMatchObject({ name: "project.zip", archive: { status: "ok", files: 2, extracted: true, skippedCount: 1 } });
    const folder = saved.body.path.replace(/\.zip$/, "");
    expect(readFileSync(join(folder, "project", "src", "main.ts"), "utf8")).toBe("export const x = 1;");
    expect(existsSync(join(folder, "..", "escape.txt"))).toBe(false);
    const listing = await api("GET", `/api/attachments/${saved.body.path.split(/[\\/]/).at(-1)}/manifest`);
    expect(listing.body.entries.map((entry: { path: string }) => entry.path)).toEqual(["project/README.md", "project/src/main.ts"]);

    const bot = (await api("POST", "/api/bots", {})).body.bot;
    expect((await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } })).status).toBe(200);
    const tag = `<attached-file path="${saved.body.path}" name="project.zip" />`;
    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: `What is in this?\n\n${tag}` })).status).toBe(202);
    await expect.poll(() => promptsSeen().some((prompt) => prompt.includes("attached-archive")), { timeout: 20_000 }).toBe(true);
    const direct = promptsSeen().find((prompt) => prompt.includes("attached-archive"))!;
    expect(direct).toContain(JSON.stringify(`extracted-path="${folder}"`).slice(1, -1));
    expect(direct).toContain("project/src/main.ts (19 B)");
    expect(direct).toContain("Left out of the unpacked folder: 1 entries (paths leaving the folder)");

    // the Files tab lists it (archives fold into Other there)
    await expect.poll(async () => ((await api("GET", `/api/threads/${bot.threadId}/files`)).body.files as Array<{ name: string }>).map((file) => file.name), { timeout: 20_000 })
      .toContain("project.zip");

    // a group chat: the same manifest reaches the bot answering there
    const tgz = await upload("src.tar.gz", "application/gzip", tarArchive([{ name: "src/a.txt", data: "alpha" }], { gzip: true }));
    expect(tgz.body).toMatchObject({ name: "src.tar.gz", archive: { status: "ok", files: 1, extracted: true } });
    const { body: { group } } = await api("POST", "/api/groups", { name: "Archive room", memberIds: [bot.id], setup: { bulletin: "", defaultResponder: { kind: "member", botId: bot.id } } });
    const before = promptsSeen().length;
    expect((await api("POST", `/api/groups/${group.id}/messages`, { text: `Unpack this\n\n<attached-file path="${tgz.body.path}" name="src.tar.gz" />` })).status).toBeLessThan(300);
    await expect.poll(() => promptsSeen().slice(before).some((prompt) => prompt.includes('attached-archive name=\\"src.tar.gz\\"')), { timeout: 30_000 }).toBe(true);
  }, 90_000);

  it("refuses an archive over 250 MB before reading it, and other binaries outright", async () => {
    // the declared length alone is refused; the body is never read
    const status = await new Promise<number>((resolve, reject) => {
      const url = new URL(`${session.info.url}/api/files?name=big.zip`);
      const req = request({ host: url.hostname, port: url.port, path: `${url.pathname}${url.search}`, method: "POST",
        headers: { "content-type": "application/zip", "content-length": String(251 * 1024 * 1024) } }, (res) => {
        resolve(res.statusCode ?? 0);
        res.resume();
        req.destroy();
      });
      req.on("error", (error) => { if (!req.destroyed) reject(error); });
      req.write(Buffer.alloc(16));
    });
    expect(status).toBe(413);
    expect((await upload("tool.exe", "application/x-msdownload", Buffer.from("MZ"))).status).toBe(400);
  });
});
