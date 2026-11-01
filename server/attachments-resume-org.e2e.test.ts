import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { startOrgServer } from "./testing/org-server-harness.ts";
import type { FakeOidcUser } from "./testing/fake-oidc-provider.ts";

const alice: FakeOidcUser = { sub: "upload-alice", email: "alice@example.test", name: "Alice", preferred_username: "alice", role: "admin" };
const bob: FakeOidcUser = { sub: "upload-bob", email: "bob@example.test", name: "Bob", preferred_username: "bob", role: "employee" };
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

it("keeps resumed media private and streams encrypted ranges only to its conversation owner", async () => {
  const org = await startOrgServer({
    user: alice,
    env: { SAGAX_CONTENT_ENCRYPTION: "on", SAGAX_CONTENT_AT_REST_GRACE_MS: "0" },
  });
  try {
    const a = await org.signIn(alice);
    const b = await org.signIn(bob);
    const id = "11111111-1111-4111-8111-111111111111";
    const upload = (cookie: string, phase: string, body?: Buffer) => fetch(`${org.base}/api/attachments?uploadId=${id}&total=${png.length}&phase=${phase}&offset=0`, {
      method: "POST", headers: { cookie, origin: org.base, "content-type": "image/png" }, body,
    });
    expect((await upload(a.cookie, "chunk", png)).status).toBe(200);
    const committed = await upload(a.cookie, "commit");
    expect(committed.status).toBe(200);
    const { saved } = await committed.json() as { saved: { path: string } };
    expect((await upload(b.cookie, "status")).status).toBe(404);
    expect((await upload(b.cookie, "cancel")).status).toBe(200);
    const cfg = await org.api("GET", "/api/config", a);
    const principal = cfg.body.viewer.principalId as string;
    expect(principal).toBeTypeOf("string");
    const digest = createHash("sha256").update(JSON.stringify([principal, id])).digest("hex");
    const guess = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}.png`;
    expect(saved.path.endsWith(guess)).toBe(false);
    expect((await fetch(`${org.base}/api/attachments/${guess}`, { headers: { cookie: b.cookie } })).status).toBe(404);
    expect((await fetch(`${org.base}/api/attachments/${id}.png`, { headers: { cookie: b.cookie } })).status).toBe(404);
    const own = await fetch(`${org.base}/api/attachments/${saved.path.split(/[\\/]/).at(-1)}`, { headers: { cookie: a.cookie } });
    expect(own.status).toBe(200);
    expect(Buffer.from(await own.arrayBuffer())).toEqual(png);

    // A deterministic video crosses at-rest chunk boundaries. Its opaque
    // conversation URL reveals no host path and rechecks the signed-in person.
    const videoId = "22222222-2222-4222-8222-222222222222";
    const video = Buffer.alloc(192 * 1024);
    video.writeUInt32BE(24, 0);
    video.write("ftypisom", 4, "ascii");
    for (let index = 12; index < video.length; index += 1) video[index] = index % 251;
    const fileBase = `${org.base}/api/files?name=clip.mp4&uploadId=${videoId}&total=${video.length}`;
    const fileUpload = (phase: string, offset = 0, body?: Buffer) => fetch(`${fileBase}&phase=${phase}&offset=${offset}`, {
      method: "POST",
      headers: { cookie: a.cookie, origin: org.base, "content-type": "video/mp4" },
      body,
    });
    expect((await fileUpload("chunk", 0, video)).status).toBe(200);
    const fileCommit = await fileUpload("commit");
    expect(fileCommit.status).toBe(200);
    const fileResult = await fileCommit.json() as { saved: { path: string; name: string; bytes: number } };
    expect(fileResult.saved.bytes).toBe(video.length);
    await expect.poll(() => readFileSync(fileResult.saved.path).subarray(0, 4).toString("ascii"), { timeout: 15_000 }).toBe("SGXF");

    const created = await org.api("POST", "/api/bots", a, {});
    expect(created.status).toBe(201);
    const bot = created.body.bot as { id: string; threadId: string };
    const sent = await org.api("POST", `/api/bots/${bot.id}/messages`, a, {
      text: `Review this clip\n\n<attached-file path="${fileResult.saved.path}" name="clip.mp4" />`,
    });
    expect(sent.status).toBe(202);
    let listed: Array<{ id: string; name: string; size: number; mime: string }> = [];
    await expect.poll(async () => {
      listed = (await org.api("GET", `/api/threads/${bot.threadId}/files`, a)).body.files ?? [];
      return listed.some((entry) => entry.name === "clip.mp4");
    }, { timeout: 15_000 }).toBe(true);
    const clip = listed.find((entry) => entry.name === "clip.mp4")!;
    expect(clip).toMatchObject({ size: video.length, mime: "video/mp4" });
    const start = 65_520;
    const end = 65_620;
    const aliceRange = await fetch(`${org.base}/api/threads/${bot.threadId}/files/${clip.id}?preview=1`, {
      headers: { cookie: a.cookie, range: `bytes=${start}-${end}` },
    });
    expect(aliceRange.status).toBe(206);
    expect(aliceRange.headers.get("accept-ranges")).toBe("bytes");
    expect(aliceRange.headers.get("content-range")).toBe(`bytes ${start}-${end}/${video.length}`);
    expect(Buffer.from(await aliceRange.arrayBuffer())).toEqual(video.subarray(start, end + 1));
    const bobRange = await fetch(`${org.base}/api/threads/${bot.threadId}/files/${clip.id}?preview=1`, {
      headers: { cookie: b.cookie, range: `bytes=${start}-${end}` },
    });
    expect(bobRange.status).toBe(404);
    expect(JSON.stringify(await bobRange.json().catch(() => ({})))).not.toContain(fileResult.saved.path);
  } finally { await org.close(); }
}, 60_000);
