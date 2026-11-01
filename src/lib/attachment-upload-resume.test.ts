import { afterEach, describe, expect, it, vi } from "vitest";
import { fileAttachmentFromFile, intakeFiles } from "./composer-attachments.ts";

afterEach(() => vi.restoreAllMocks());
const chunk = 4 * 1024 * 1024;
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("resumable composer uploads", () => {
  it("recovers a lost chunk reply using server progress and never resends the file", async () => {
    const file = new File([new Uint8Array(chunk * 2 + 7)], "clip.mp4", { type: "video/mp4" });
    let offset = 0;
    let lost = false;
    const accepted: number[] = [];
    const ids = new Set<string>();
    const progress: number[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(String(input), "http://fixture");
      ids.add(url.searchParams.get("uploadId")!);
      switch (url.searchParams.get("phase")) {
        case "status": return offset ? response({ offset, total: file.size }) : response({ error: "no such upload" }, 404);
        case "chunk": {
          if (Number(url.searchParams.get("offset")) !== offset) return response({ error: "offset changed" }, 409);
          const body = init!.body as Blob;
          expect(body.size).toBeLessThanOrEqual(chunk);
          accepted.push(body.size);
          offset += body.size;
          if (!lost) { lost = true; throw new TypeError("reply lost"); }
          return response({ offset, total: file.size });
        }
        case "commit": return response({ offset, total: file.size, saved: { path: "/attachments/video.mp4", name: file.name, mime: file.type, bytes: offset } });
        default: throw new Error("unexpected request");
      }
    });
    await expect(fileAttachmentFromFile(file, { onProgress: (bytes) => progress.push(bytes) })).resolves.toMatchObject({ kind: "file", name: "clip.mp4", size: file.size });
    expect(accepted).toEqual([chunk, chunk, 7]);
    expect(progress).toEqual([chunk, chunk * 2, file.size]);
    expect(ids.size).toBe(1);
  });

  it("cancels the server session with an independent signal", async () => {
    const file = new File([new Uint8Array(chunk + 1)], "notes.txt", { type: "text/plain" });
    const controller = new AbortController();
    let canceled = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const phase = new URL(String(input), "http://fixture").searchParams.get("phase");
      if (phase === "status") return response({ error: "no upload" }, 404);
      if (phase === "cancel") { canceled = true; expect(init!.signal?.aborted).toBe(false); return response({ offset: 0, total: file.size }); }
      return response({ offset: chunk, total: file.size });
    });
    await expect(fileAttachmentFromFile(file, { signal: controller.signal, onProgress: () => controller.abort() })).rejects.toMatchObject({ name: "AbortError" });
    expect(canceled).toBe(true);
  });

  it("manual retry reuses the same upload id and the already acknowledged bytes", async () => {
    const file = new File([new Uint8Array(chunk + 3)], "notes.txt", { type: "text/plain" });
    let offset = chunk;
    let offline = true;
    const ids = new Set<string>();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input), "http://fixture");
      ids.add(url.searchParams.get("uploadId")!);
      if (offline) throw new TypeError("offline");
      if (url.searchParams.get("phase") === "status") return response({ offset, total: file.size });
      if (url.searchParams.get("phase") === "chunk") { expect(Number(url.searchParams.get("offset"))).toBe(chunk); offset = file.size; return response({ offset, total: file.size }); }
      return response({ offset, total: file.size, saved: { path: "/attachments/notes.txt", name: file.name, bytes: file.size } });
    });
    await expect(fileAttachmentFromFile(file)).rejects.toThrow("offline");
    offline = false;
    await expect(fileAttachmentFromFile(file)).resolves.toMatchObject({ name: "notes.txt", size: file.size });
    expect(ids.size).toBe(1);
  });

  it("does not append a second file when the draft owns its optimistic chip", async () => {
    const file = new File(["notes"], "notes.txt", { type: "text/plain" });
    const result = await intakeFiles([file], { allowImages: true, getPath: () => "/local/notes.txt", uploadImage: async () => null, uploadFile: async () => "handled" });
    expect(result).toEqual({ attachments: [], notice: null });
  });
});
