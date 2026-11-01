import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, truncateSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const root = mkdtempSync(join(tmpdir(), "sagax-resume-"));
process.env.SAGAX_DATA_DIR = join(root, "data");
let attachments: typeof import("./attachments.ts");
const id = "11111111-1111-4111-8111-111111111111";
const base = { owner: "alice", uploadId: id, name: "notes.txt", mime: "text/plain", image: false, total: 6 };
async function* bytes(value: string) { yield Buffer.from(value); }
beforeEach(async () => {
  rmSync(join(root, "data"), { recursive: true, force: true });
  vi.resetModules();
  attachments = await import("./attachments.ts");
  (await import("./media-proxy.ts")).initMediaProxy(join(root, "data"));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("durable bounded attachment uploads", () => {
  it("replays a lost response without duplicating bytes or the committed file", async () => {
    const upload = attachments.resumableAttachmentUpload;
    await expect(upload({ ...base, phase: "chunk", offset: 0, chunks: bytes("abc") })).resolves.toEqual({ offset: 3, total: 6 });
    await expect(upload({ ...base, phase: "chunk", offset: 0, chunks: bytes("abc") })).rejects.toMatchObject({ status: 409, offset: 3 });
    await expect(upload({ ...base, phase: "status" })).resolves.toEqual({ offset: 3, total: 6 });
    await upload({ ...base, phase: "chunk", offset: 3, chunks: bytes("def") });
    const result = await upload({ ...base, phase: "commit" });
    expect(readFileSync(result.saved!.path, "utf8")).toBe("abcdef");
    await expect(upload({ ...base, phase: "commit" })).resolves.toEqual(result);
    expect(readdirSync(attachments.ATTACHMENTS_DIR).filter((name) => !name.startsWith("."))).toHaveLength(1);
  });

  it("rolls back an interrupted chunk to the last acknowledged offset", async () => {
    const upload = attachments.resumableAttachmentUpload;
    await upload({ ...base, phase: "chunk", offset: 0, chunks: bytes("abc") });
    async function* interrupted() { yield Buffer.from("de"); throw new Error("disconnected"); }
    await expect(upload({ ...base, phase: "chunk", offset: 3, chunks: interrupted() })).rejects.toThrow("disconnected");
    await expect(upload({ ...base, phase: "status" })).resolves.toMatchObject({ offset: 3 });
    await upload({ ...base, phase: "chunk", offset: 3, chunks: bytes("def") });
    const done = await upload({ ...base, phase: "commit" });
    expect(readFileSync(done.saved!.path, "utf8")).toBe("abcdef");
  });

  it("resumes after module restart and discards bytes not durably acknowledged", async () => {
    await attachments.resumableAttachmentUpload({ ...base, phase: "chunk", offset: 0, chunks: bytes("abc") });
    const partial = readdirSync(attachments.ATTACHMENTS_DIR).find((name) => name.startsWith(".openmaus-upload-"))!;
    appendFileSync(join(attachments.ATTACHMENTS_DIR, partial), "unacknowledged");
    vi.resetModules();
    attachments = await import("./attachments.ts");
    (await import("./media-proxy.ts")).initMediaProxy(join(root, "data"));
    await expect(attachments.resumableAttachmentUpload({ ...base, phase: "status" })).resolves.toMatchObject({ offset: 3 });
    expect(readFileSync(join(attachments.ATTACHMENTS_DIR, partial), "utf8")).toBe("abc");
    await attachments.resumableAttachmentUpload({ ...base, phase: "chunk", offset: 3, chunks: bytes("def") });
    const done = await attachments.resumableAttachmentUpload({ ...base, phase: "commit" });
    expect(readFileSync(done.saved!.path, "utf8")).toBe("abcdef");
  });

  it("isolates identical upload ids between people", async () => {
    const upload = attachments.resumableAttachmentUpload;
    await upload({ ...base, phase: "chunk", offset: 0, chunks: bytes("alice!") });
    await expect(upload({ ...base, owner: "bob", phase: "status" })).rejects.toMatchObject({ status: 404 });
    await upload({ ...base, owner: "bob", phase: "chunk", offset: 0, chunks: bytes("bob!!!") });
    const alice = await upload({ ...base, phase: "commit" });
    const bob = await upload({ ...base, owner: "bob", phase: "commit" });
    expect(alice.saved!.path).not.toBe(bob.saved!.path);
    expect(readFileSync(alice.saved!.path, "utf8")).toBe("alice!");
    expect(readFileSync(bob.saved!.path, "utf8")).toBe("bob!!!");
  });

  it("serializes concurrent chunks, refuses metadata changes and incomplete commits", async () => {
    const upload = attachments.resumableAttachmentUpload;
    const attempts = await Promise.allSettled([0, 1].map(() => upload({ ...base, phase: "chunk", offset: 0, chunks: bytes("abc") })));
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    await expect(upload({ ...base, name: "different.txt", phase: "status" })).rejects.toMatchObject({ status: 409 });
    await expect(upload({ ...base, phase: "commit" })).rejects.toMatchObject({ status: 409, offset: 3 });
  });

  it("cancels partial storage and expires abandoned sessions without deleting completed files", async () => {
    const upload = attachments.resumableAttachmentUpload;
    await upload({ ...base, phase: "chunk", offset: 0, chunks: bytes("abc") });
    await upload({ ...base, phase: "cancel" });
    expect(readdirSync(attachments.ATTACHMENTS_DIR)).toEqual([]);
    await upload({ ...base, phase: "chunk", offset: 0, chunks: bytes("abcdef") });
    const done = await upload({ ...base, phase: "commit" });
    expect(attachments.cleanupResumableUploads(Date.now() + attachments.ATTACHMENT_PARTIAL_MAX_AGE_MS + 1)).toBe(1);
    expect(readFileSync(done.saved!.path, "utf8")).toBe("abcdef");
  });

  it("caps each request independently of the accepted 1 GB video", async () => {
    expect(attachments.maxBytesForFileMime("video/mp4")).toBe(1024 ** 3);
    async function* oversized() { yield Buffer.alloc(attachments.ATTACHMENT_UPLOAD_CHUNK_BYTES + 1); }
    await expect(attachments.resumableAttachmentUpload({ ...base, name: "clip.mp4", mime: "video/mp4", total: 1024 ** 3, phase: "chunk", offset: 0, chunks: oversized() })).rejects.toMatchObject({ status: 413 });
  });

  it("reserves only received bytes for 1 GB sessions near the aggregate ceiling", async () => {
    const existing = attachments.saveImage(Buffer.from("x"), "image/png");
    // Keep room for the two small durable receipt files as well as their two
    // bytes of content. Reserving either declared 1 GB total would still fail.
    truncateSync(existing.path, attachments.ATTACHMENTS_MAX_BYTES - 64 * 1024);
    attachments.__resetAttachmentAccountingForTests();
    const video = { ...base, name: "clip.mp4", mime: "video/mp4", total: attachments.VIDEO_MAX_BYTES };
    const secondId = "22222222-2222-4222-8222-222222222222";

    await expect(attachments.resumableAttachmentUpload({ ...video, phase: "chunk", offset: 0, chunks: bytes("a") }))
      .resolves.toMatchObject({ offset: 1, total: attachments.VIDEO_MAX_BYTES });
    await expect(attachments.resumableAttachmentUpload({ ...video, uploadId: secondId, phase: "chunk", offset: 0, chunks: bytes("b") }))
      .resolves.toMatchObject({ offset: 1, total: attachments.VIDEO_MAX_BYTES });
  });

  it("opens a sealed committed file before crash recovery finalizers read it", async () => {
    process.env.SAGAX_MCP_OAUTH_KEY = "cd".repeat(32);
    const atRest = await import("./content-at-rest.ts");
    const messageDb = await import("./message-db.ts");
    atRest.resetAtRestState();
    atRest.setAtRestGrace(0);
    messageDb.configureContentEncryption({ mode: "on", autoMigrate: false });
    const archiveTools = await import("./attachment-archives.ts");
    const archive = { ...base, name: "bundle.zip", mime: "application/zip" };
    let staleExtraction = "";
    let committedPath = "";
    try {
      await attachments.resumableAttachmentUpload({ ...archive, phase: "chunk", offset: 0, chunks: bytes("PKdata") });
      await expect(attachments.resumableAttachmentUpload({
        ...archive,
        phase: "commit",
        finalize: async (saved) => {
          committedPath = saved.path;
          await atRest.runAtRestMigration({ sliceMs: Infinity });
          expect(atRest.atRestInfoSync(saved.path)?.sealed).toBe(false);
          staleExtraction = `${archiveTools.localExtractedPath(saved.path)}.partial-33333333-3333-4333-8333-333333333333`;
          mkdirSync(staleExtraction, { recursive: true });
          throw new Error("stopped during finalize");
        },
      })).rejects.toThrow("stopped during finalize");
      expect(readdirSync(attachments.ATTACHMENTS_DIR).some((entry) => entry.startsWith(".openmaus-upload-"))).toBe(false);
      await atRest.runAtRestMigration({ sliceMs: Infinity });
      expect(atRest.atRestInfoSync(committedPath)?.sealed).toBe(true);
      // Even after the old receipt and partial are swept, a same-id replay
      // finds the sealed deterministic commit and recovers its finalizer.
      attachments.cleanupResumableUploads(Date.now() + attachments.ATTACHMENT_PARTIAL_MAX_AGE_MS + 1);
      await attachments.resumableAttachmentUpload({ ...archive, phase: "chunk", offset: 0, chunks: bytes("PKdata") });
      let recovered = false;
      const result = await attachments.resumableAttachmentUpload({
        ...archive,
        phase: "commit",
        recover: (path) => {
          archiveTools.recoverArchiveUpload(path);
          recovered = true;
          expect(readFileSync(path, "utf8")).toBe("PKdata");
        },
        finalize: async (saved) => {
          expect(readFileSync(saved.path, "utf8")).toBe("PKdata");
          return saved;
        },
      });
      expect(recovered).toBe(true);
      expect(existsSync(staleExtraction)).toBe(false);
      expect(result.saved?.bytes).toBe(6);
    } finally {
      atRest.resetAtRestState();
      messageDb.closeMessageDb();
      delete process.env.SAGAX_MCP_OAUTH_KEY;
    }
  });

  it("accepts the same bytes after its receipt expires and rejects changed bytes", async () => {
    const upload = attachments.resumableAttachmentUpload;
    await upload({ ...base, phase: "chunk", offset: 0, chunks: bytes("abcdef") });
    const first = await upload({ ...base, phase: "commit" });
    attachments.cleanupResumableUploads(Date.now() + attachments.ATTACHMENT_PARTIAL_MAX_AGE_MS + 1);
    await upload({ ...base, phase: "chunk", offset: 0, chunks: bytes("abcdef") });
    expect(await upload({ ...base, phase: "commit" })).toEqual(first);
    attachments.cleanupResumableUploads(Date.now() + attachments.ATTACHMENT_PARTIAL_MAX_AGE_MS + 1);
    await upload({ ...base, phase: "chunk", offset: 0, chunks: bytes("changed".slice(0, 6)) });
    await expect(upload({ ...base, phase: "commit" })).rejects.toMatchObject({ status: 409 });
    expect(readFileSync(first.saved!.path, "utf8")).toBe("abcdef");
  });

  it("cancels an unused committed file after its receipt expires", async () => {
    const upload = attachments.resumableAttachmentUpload;
    await upload({ ...base, phase: "chunk", offset: 0, chunks: bytes("abcdef") });
    const done = await upload({ ...base, phase: "commit" });
    attachments.cleanupResumableUploads(Date.now() + attachments.ATTACHMENT_PARTIAL_MAX_AGE_MS + 1);
    attachments.setAttachmentStillShown(() => false);
    await upload({ ...base, phase: "cancel" });
    expect(existsSync(done.saved!.path)).toBe(false);
  });

  it("runs idle crash-artifact recovery before a resumable receipt expires", async () => {
    const archive = { ...base, name: "bundle.zip", mime: "application/zip" };
    await attachments.resumableAttachmentUpload({ ...archive, phase: "chunk", offset: 0, chunks: bytes("PKdata") });
    await expect(attachments.resumableAttachmentUpload({
      ...archive,
      phase: "commit",
      finalize: async () => { throw new Error("stopped during finalize"); },
    })).rejects.toThrow("stopped during finalize");
    const paths: string[] = [];
    expect(attachments.cleanupResumableUploads(Date.now(), (path) => paths.push(path))).toBe(0);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatch(/\.zip$/);
  });

  it("cleans a canceled commit only when no transcript uses its result", async () => {
    const upload = attachments.resumableAttachmentUpload;
    await upload({ ...base, phase: "chunk", offset: 0, chunks: bytes("abcdef") });
    const first = await upload({ ...base, phase: "commit" });
    attachments.setAttachmentStillShown(() => false);
    await upload({ ...base, phase: "cancel" });
    expect(readdirSync(attachments.ATTACHMENTS_DIR)).toEqual([]);
    await upload({ ...base, phase: "chunk", offset: 0, chunks: bytes("abcdef") });
    await upload({ ...base, phase: "commit" });
    attachments.setAttachmentStillShown(() => true);
    await upload({ ...base, phase: "cancel" });
    expect(readFileSync(first.saved!.path, "utf8")).toBe("abcdef");
  });
});
