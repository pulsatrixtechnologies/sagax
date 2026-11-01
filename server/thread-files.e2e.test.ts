// The Files tab's server half through a real harness and the fake Claude
// CLI: a Write call in a turn is recorded on its activity message, listed as
// a file of that conversation, and served by id and through the message
// route, while another conversation of the same bot does not list it.
import { mkdirSync, truncateSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { launchVerificationServer, type VerificationServer } from "../scripts/control-omb.ts";

/** A solid-color RGB PNG, width x height. */
function solidPng(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf: Buffer) => { let c = 0xffffffff; for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x7a)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

type Listed = { id: string; messageId: string; source: string; path: string; name: string; size: number | null; available: boolean; mime?: string; localPath?: string };

describe("conversation files through the harness", () => {
  let session: VerificationServer;
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${session.info.url}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json().catch(() => null) as any };
  };

  beforeAll(async () => {
    session = await launchVerificationServer({
      ...process.env,
      FAKE_CLAUDE_TOOL_CALLS: JSON.stringify([
        { name: "Write", input: { file_path: "report.md", content: "# Findings" }, output: "File written" },
        { name: "Write", input: { file_path: "remote-only/never-here.png", content: "" }, output: "File written" },
        { name: "Write", input: { file_path: "chart.png", content: "" }, output: "File written" },
        { name: "Write", input: { file_path: "clip.mp4", content: "" }, output: "File written" },
        { name: "Write", input: { file_path: "refused.md", content: "" }, ok: false, output: "denied" },
      ]),
      FAKE_CLAUDE_REPLIES: JSON.stringify(["Wrote the report."]),
    });
  }, 30_000);

  afterAll(async () => {
    await session?.close();
  });

  it("lists what a turn wrote and serves it only from that conversation", async () => {
    const bot = (await api("POST", "/api/bots", {})).body.bot;
    expect((await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } })).status).toBe(200);
    // A turn works in its conversation's own folder (the workspace is always
    // Auto, #743), and Claude's relative paths are recorded resolved against
    // it (#858): the file the fake turn "wrote" is created there.
    const workspace = join(session.info.dataDir, "task-workspaces", bot.id, bot.threadId);
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, "report.md"), "# Findings");
    const picture = solidPng(640, 480);
    writeFileSync(join(workspace, "chart.png"), picture);
    const videoBytes = 1024 * 1024 * 1024;
    const videoPath = join(workspace, "clip.mp4");
    writeFileSync(videoPath, "video");
    truncateSync(videoPath, videoBytes);

    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "Write the report" })).status).toBe(202);
    let files: Listed[] = [];
    await expect.poll(async () => {
      files = (await api("GET", `/api/threads/${bot.threadId}/files`)).body.files;
      return files.map((file) => file.name).sort();
    }, { timeout: 20_000 }).toEqual(["chart.png", "clip.mp4", "never-here.png", "report.md"]);

    const report = files.find((file) => file.name === "report.md")!;
    expect(report).toMatchObject({ source: "written", size: 10, available: true, mime: "text/markdown; charset=utf-8" });
    expect(report.path).toMatch(/task-workspaces[\\/].+[\\/]report\.md$/);
    expect(report.localPath).toMatch(/task-workspaces[\\/].+[\\/]report\.md$/);
    expect(files.find((file) => file.name === "never-here.png")).toMatchObject({ available: false, size: null });

    // The activity message carries the record, and is the download grant.
    const dump = await api("GET", `/api/threads/${bot.threadId}/export?format=json`);
    const activity = (dump.body.messages as Array<{ id: string; kind: string; tool?: { name: string; files?: string[] } }>)
      .find((message) => message.id === report.messageId)!;
    expect(activity).toMatchObject({ kind: "activity", tool: { name: "Write", files: [report.path] } });

    const byId = await fetch(`${session.info.url}/api/threads/${bot.threadId}/files/${report.id}`);
    expect(byId.status).toBe(200);
    expect(byId.headers.get("content-disposition")).toContain("report.md");
    expect(await byId.text()).toBe("# Findings");
    // Only images stream inline.
    expect((await fetch(`${session.info.url}/api/threads/${bot.threadId}/files/${report.id}?preview=1`)).status).toBe(415);
    expect((await fetch(`${session.info.url}/api/threads/${bot.threadId}/files/${"0".repeat(24)}`)).status).toBe(404);

    // The Library row's thumbnail: a small square PNG, not the picture.
    const chart = files.find((file) => file.name === "chart.png")!;
    const thumb = await fetch(`${session.info.url}/api/threads/${bot.threadId}/files/${chart.id}?thumb=1`);
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get("content-type")).toBe("image/png");
    const thumbBytes = Buffer.from(await thumb.arrayBuffer());
    expect(thumbBytes.readUInt32BE(16)).toBe(96);
    expect(thumbBytes.readUInt32BE(20)).toBe(96);
    expect(thumbBytes.length).toBeLessThan(picture.length);
    // Same grant as the download: no listing entry, no thumbnail; only pictures have one.
    expect((await fetch(`${session.info.url}/api/threads/${bot.threadId}/files/${"0".repeat(24)}?thumb=1`)).status).toBe(404);
    expect((await fetch(`${session.info.url}/api/threads/${bot.threadId}/files/${report.id}?thumb=1`)).status).toBe(415);

    // A sparse 1 GiB clip is listed at its plaintext size and seeked with a
    // bounded range. The server never buffers or sends the preceding bytes.
    const clip = files.find((candidate) => candidate.name === "clip.mp4")!;
    expect(clip).toMatchObject({ size: videoBytes, available: true, mime: "video/mp4" });
    const rangeStart = videoBytes - 16;
    const seek = await fetch(`${session.info.url}/api/threads/${bot.threadId}/files/${clip.id}?preview=1`, {
      headers: { range: `bytes=${rangeStart}-` },
    });
    expect(seek.status).toBe(206);
    expect(seek.headers.get("accept-ranges")).toBe("bytes");
    // Caddy's encode and CDNs leave a no-transform body as stored bytes.
    expect(seek.headers.get("cache-control")).toBe("private, no-store, no-transform");
    expect(seek.headers.get("content-range")).toBe(`bytes ${rangeStart}-${videoBytes - 1}/${videoBytes}`);
    expect(seek.headers.get("content-length")).toBe("16");
    expect(Buffer.from(await seek.arrayBuffer())).toEqual(Buffer.alloc(16));
    const pastEnd = await fetch(`${session.info.url}/api/threads/${bot.threadId}/files/${clip.id}?preview=1`, {
      headers: { range: `bytes=${videoBytes}-` },
    });
    expect(pastEnd.status).toBe(416);
    expect(pastEnd.headers.get("content-range")).toBe(`bytes */${videoBytes}`);

    const viaMessage = await fetch(`${session.info.url}/api/threads/${bot.threadId}/messages/${report.messageId}/file`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: report.path }),
    });
    expect(viaMessage.status).toBe(200);
    expect(await viaMessage.text()).toBe("# Findings");
    const location = await fetch(`${session.info.url}/api/threads/${bot.threadId}/messages/${clip.messageId}/file`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: clip.path, location: true }),
    });
    expect(location.status).toBe(200);
    const opaque = await location.json() as { downloadUrl: string; previewUrl: string; mime: string; bytes: number; name: string };
    expect(opaque).toEqual({
      downloadUrl: `/api/threads/${bot.threadId}/files/${clip.id}`,
      previewUrl: `/api/threads/${bot.threadId}/files/${clip.id}?preview=1`,
      mime: "video/mp4",
      bytes: videoBytes,
      name: "clip.mp4",
    });
    expect(JSON.stringify(opaque)).not.toContain(session.info.dataDir);
    // The activity message grants only the file its tool wrote.
    const other = await fetch(`${session.info.url}/api/threads/${bot.threadId}/messages/${report.messageId}/file`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "../../config.json" }),
    });
    expect(other.status).toBe(403);

    // A second conversation of the same bot has its own, empty, file list,
    // and cannot reach the first one's file by its id.
    const task = await api("POST", `/api/bots/${bot.id}/tasks`, {});
    const secondThread = task.body.task?.threadId ?? task.body.threadId;
    expect(typeof secondThread).toBe("string");
    expect((await api("GET", `/api/threads/${secondThread}/files`)).body.files).toEqual([]);
    expect((await fetch(`${session.info.url}/api/threads/${secondThread}/files/${report.id}`)).status).toBe(404);
    expect((await fetch(`${session.info.url}/api/threads/${secondThread}/files/${clip.id}`, { headers: { range: "bytes=0-0" } })).status).toBe(404);
    expect((await api("GET", "/api/threads/no-such-thread/files")).status).toBe(404);
  }, 40_000);

  it("pins a file of the conversation on the server, and lists it as pinned", async () => {
    const bot = (await api("POST", "/api/bots", {})).body.bot;
    expect((await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } })).status).toBe(200);
    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "Write the report" })).status).toBe(202);
    let files: Array<Listed & { pinned?: boolean }> = [];
    await expect.poll(async () => {
      files = (await api("GET", `/api/threads/${bot.threadId}/files`)).body.files;
      return files.length;
    }, { timeout: 20_000 }).toBeGreaterThan(0);
    const target = files[0]!;
    const pin = (thread: string, id: string, body: unknown) => api("POST", `/api/threads/${thread}/files/${id}/pin`, body);
    const listed = async () => ((await api("GET", `/api/threads/${bot.threadId}/files`)).body.files as Array<Listed & { pinned?: boolean }>).find((file) => file.id === target.id);

    expect((await pin(bot.threadId, target.id, { pinned: "yes" })).status).toBe(400);
    expect((await pin(bot.threadId, "0".repeat(24), { pinned: true })).status).toBe(404);
    expect((await pin("no-such-thread", target.id, { pinned: true })).status).toBe(404);
    expect((await pin(bot.threadId, target.id, { pinned: true })).status).toBe(200);
    expect((await listed())?.pinned).toBe(true);
    expect((await pin(bot.threadId, target.id, { pinned: false })).status).toBe(200);
    expect((await listed())?.pinned).toBeUndefined();
  }, 40_000);
});
