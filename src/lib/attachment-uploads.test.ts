import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachmentUploadStateForTests,
  cancelAttachmentUpload,
  forgetAttachmentUploads,
  retryAttachmentUpload,
  startAttachmentUpload,
} from "./attachment-uploads.ts";
import { appendDraftAttachments, getDraftAttachments, isDraftAttachmentPending, replaceDraftAttachment, setDraft } from "./drafts.ts";

let store: Pick<Storage, "getItem" | "setItem">;
let sequence = 0;
let draft: string;
beforeEach(() => {
  const values = new Map<string, string>();
  store = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
  vi.stubGlobal("localStorage", store);
  draft = `upload-fixture-${sequence++}`;
});
afterEach(() => {
  for (const attachment of getDraftAttachments(store, draft)) cancelAttachmentUpload(attachment.id);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const saved = () => new Response(JSON.stringify({ path: "/attachments/notes.txt", name: "notes.txt", mime: "text/plain", bytes: 5 }));
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const uploadChunkBytes = 4 * 1024 * 1024;

describe("uploads tied to a draft", () => {
  it("refuses a picture past the message's 200 MB image budget before uploading it", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    appendDraftAttachments(draft, [{ kind: "image", id: "held", path: "/attachments/held.png", name: "held.png", size: 200 * 1024 * 1024, mime: "image/png" }]);
    const extra = new File(["x"], "extra.png", { type: "image/png" });
    await expect(startAttachmentUpload(draft, extra, true)).rejects.toMatchObject({ status: 413, message: expect.stringMatching(/200 MB/) });
    expect(fetch).not.toHaveBeenCalled();
    expect(getDraftAttachments(store, draft).map((attachment) => attachment.id)).toEqual(["held"]);
  });

  it("finishes in its original draft after navigating to another draft", async () => {
    let finish!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const operation = startAttachmentUpload(draft, new File(["notes"], "notes.txt", { type: "text/plain" }), false);
    expect(getDraftAttachments(store, draft)).toMatchObject([{ uploading: true, path: "" }]);
    expect(isDraftAttachmentPending(draft)).toBe(true);
    const other = `${draft}-other`;
    setDraft(store, other, "Keep this newer text");
    finish(saved());
    await operation;
    expect(getDraftAttachments(store, draft)).toMatchObject([{ path: "/attachments/notes.txt" }]);
    expect(getDraftAttachments(store, other)).toEqual([]);
    expect(isDraftAttachmentPending(draft)).toBe(false);
  });

  it("retains one failed chip and retries the same File and upload id", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    await startAttachmentUpload(draft, new File(["notes"], "notes.txt", { type: "text/plain" }), false);
    const [failed] = getDraftAttachments(store, draft);
    expect(failed).toMatchObject({ uploading: false, uploadError: "offline" });
    const firstUrl = String(fetcher.mock.calls[0]![0]);
    fetcher.mockResolvedValue(saved());
    retryAttachmentUpload(failed!.id);
    await expect.poll(() => getDraftAttachments(store, draft)).toMatchObject([{ path: "/attachments/notes.txt" }]);
    expect(getDraftAttachments(store, draft)).toHaveLength(1);
    expect(String(fetcher.mock.calls.at(-1)![0])).toBe(firstUrl);
  });

  it("aborts a removed chip and cannot restore it from a late response", async () => {
    let signal: AbortSignal | null | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      signal = init?.signal;
      signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const operation = startAttachmentUpload(draft, new File(["notes"], "notes.txt", { type: "text/plain" }), false);
    const [pending] = getDraftAttachments(store, draft);
    cancelAttachmentUpload(pending!.id);
    replaceDraftAttachment(draft, pending!.id, null);
    await operation;
    expect(signal!.aborted).toBe(true);
    expect(getDraftAttachments(store, draft)).toEqual([]);
    expect(isDraftAttachmentPending(draft)).toBe(false);
  });

  it("cancels the durable session when a failed chip is removed", async () => {
    const file = new File([new Uint8Array(uploadChunkBytes + 1)], "notes.txt", { type: "text/plain" });
    let offset = 0;
    let canceled = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(String(input), "http://fixture");
      const phase = url.searchParams.get("phase");
      if (phase === "status") return offset ? response({ offset, total: file.size }) : response({ error: "missing" }, 404);
      if (phase === "cancel") { canceled = true; return response({ offset: 0, total: file.size }); }
      if (phase === "chunk" && Number(url.searchParams.get("offset")) === 0) {
        offset = (init!.body as Blob).size;
        return response({ offset, total: file.size });
      }
      return response({ error: "offline" }, 503);
    });
    await startAttachmentUpload(draft, file, false);
    const [failed] = getDraftAttachments(store, draft);
    expect(failed).toMatchObject({ uploading: false, uploadError: "offline" });
    cancelAttachmentUpload(failed!.id);
    replaceDraftAttachment(draft, failed!.id, null);
    await expect.poll(() => canceled).toBe(true);
    expect(attachmentUploadStateForTests(failed!.id)).toBeUndefined();
  });

  it("keeps only a cancel handle after success, then cancels an unsent removal", async () => {
    const file = new File([new Uint8Array(uploadChunkBytes + 1)], "notes.txt", { type: "text/plain" });
    let offset = 0;
    let canceled = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(String(input), "http://fixture");
      const phase = url.searchParams.get("phase");
      if (phase === "status") return response({ error: "missing" }, 404);
      if (phase === "chunk") {
        offset += (init!.body as Blob).size;
        return response({ offset, total: file.size });
      }
      if (phase === "commit") return response({ offset, total: file.size, saved: { path: "/attachments/notes.txt", name: file.name, bytes: file.size } });
      if (phase === "cancel") { canceled = true; return response({ offset: 0, total: file.size }); }
      throw new Error(`unexpected ${phase}`);
    });
    await startAttachmentUpload(draft, file, false);
    const [completed] = getDraftAttachments(store, draft);
    expect(attachmentUploadStateForTests(completed!.id)).toEqual({ running: false, completed: true, hasFile: false, cancellable: true });
    cancelAttachmentUpload(completed!.id);
    replaceDraftAttachment(draft, completed!.id, null);
    await expect.poll(() => canceled).toBe(true);
  });

  it("forgets a completed cancel handle once the message owns the file", async () => {
    const file = new File([new Uint8Array(uploadChunkBytes + 1)], "notes.txt", { type: "text/plain" });
    let offset = 0;
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(String(input), "http://fixture");
      const phase = url.searchParams.get("phase");
      if (phase === "status") return response({ error: "missing" }, 404);
      if (phase === "chunk") { offset += (init!.body as Blob).size; return response({ offset, total: file.size }); }
      return response({ offset, total: file.size, saved: { path: "/attachments/notes.txt", name: file.name, bytes: file.size } });
    });
    await startAttachmentUpload(draft, file, false);
    const [completed] = getDraftAttachments(store, draft);
    forgetAttachmentUploads([completed!.id]);
    expect(attachmentUploadStateForTests(completed!.id)).toBeUndefined();
    const calls = fetcher.mock.calls.length;
    cancelAttachmentUpload(completed!.id);
    expect(fetcher).toHaveBeenCalledTimes(calls);
  });
});
