// Uploads belong to their keyed draft, so navigating to another bot does
// not discard progress, cancel controls or the File needed for a retry.
import {
  fileAttachmentFromFile, imageAttachmentFromFile, optimisticFileAttachment,
  optimisticImageAttachment, handoffAttachmentImagePreview, releaseAttachmentImagePreview,
  type AttachmentUploadSession, type FileAttachment, type ImageAttachment,
} from "./composer-attachments.ts";
import { appendDraftAttachments, changeDraftAttachmentPending, currentDraftAttachments, isNetworkOffline, replaceDraftAttachment } from "./drafts.ts";

interface UploadTask {
  draftId: string;
  file?: File;
  attachment: ImageAttachment | FileAttachment;
  controller: AbortController;
  running: boolean;
  completed: boolean;
  /** A dropped connection: the same task resumes when the network returns. */
  interrupted: boolean;
  session?: AttachmentUploadSession;
  /** A file of a type the app does not know, sent as a plain download. */
  anyType?: boolean;
}
const tasks = new Map<string, UploadTask>();
let listeningForOnline = false;

function uploadInterrupted(error: unknown): boolean {
  if (isNetworkOffline()) return true;
  if (typeof error === "object" && error !== null && "name" in error && (error as { name?: string }).name === "AbortError") return false;
  if (error instanceof TypeError) return true;
  const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status?: number }).status) : NaN;
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function listenForUploadResume(): void {
  if (listeningForOnline) return;
  listeningForOnline = true;
  const target = globalThis as unknown as Partial<Pick<EventTarget, "addEventListener">>;
  target.addEventListener?.("online", () => { resumeInterruptedAttachmentUploads(); });
}

/** Continues an interrupted upload on the same task, file and upload id. */
export function resumeInterruptedAttachmentUploads(): void {
  if (isNetworkOffline()) return;
  for (const task of tasks.values()) {
    if (!task.interrupted || task.running || task.completed || !task.file) continue;
    task.interrupted = false;
    void run(task);
  }
}

async function run(task: UploadTask): Promise<void> {
  const file = task.file;
  if (!file) return;
  task.interrupted = false;
  task.attachment = { ...task.attachment, uploading: true, uploadError: undefined };
  const { attachment, draftId } = task;
  task.running = true;
  task.controller = new AbortController();
  replaceDraftAttachment(draftId, attachment.id, { ...attachment, uploading: true, uploadError: undefined });
  changeDraftAttachmentPending(draftId, true);
  try {
    const options = {
      signal: task.controller.signal,
      onProgress: (uploaded: number, total: number) => {
        task.attachment = { ...task.attachment, uploadProgress: Math.round(uploaded / total * 100) };
        replaceDraftAttachment(draftId, attachment.id, task.attachment);
      },
      onSession: (session: AttachmentUploadSession) => { task.session = session; },
      ...(task.anyType ? { anyType: true } : {}),
    };
    const completed = attachment.kind === "image"
      ? await imageAttachmentFromFile(file, attachment, options)
      : await fileAttachmentFromFile(file, options);
    if (completed) {
      const replacement = { ...completed, id: attachment.id };
      task.attachment = replacement;
      if (replacement.kind === "image") handoffAttachmentImagePreview(replacement.path, replacement.previewUrl);
      if (!replaceDraftAttachment(draftId, attachment.id, replacement) && replacement.kind === "image") releaseAttachmentImagePreview(replacement);
    } else replaceDraftAttachment(draftId, attachment.id, null);
    task.file = undefined;
    task.completed = true;
    // A resumable result keeps only its small cancellation handle until the
    // chip is sent or removed. A one-request upload has no server session.
    if (!task.session) tasks.delete(attachment.id);
  } catch (error) {
    if (!task.controller.signal.aborted && tasks.has(attachment.id)) {
      task.interrupted = uploadInterrupted(error);
      if (task.interrupted) listenForUploadResume();
      task.attachment = { ...task.attachment, uploading: false, uploadError: error instanceof Error ? error.message : "Upload failed" };
      replaceDraftAttachment(draftId, attachment.id, task.attachment);
    }
  } finally {
    task.running = false;
    changeDraftAttachmentPending(draftId, false);
  }
}

export async function startAttachmentUpload(draftId: string, file: File, image: boolean, anyType = false): Promise<boolean> {
  // The draft already holds the optimistic chips of files picked together,
  // so a multi-file pick is measured in order against one message budget.
  const attachment = image ? optimisticImageAttachment(file, currentDraftAttachments(draftId)) : optimisticFileAttachment(file, anyType);
  if (!attachment) return false;
  const task: UploadTask = { draftId, file, attachment, controller: new AbortController(), running: false, completed: false, interrupted: false, ...(anyType && !image ? { anyType: true } : {}) };
  tasks.set(attachment.id, task);
  appendDraftAttachments(draftId, [attachment]);
  await run(task);
  return true;
}

export function cancelAttachmentUpload(id: string): void {
  const task = tasks.get(id);
  if (!task) return;
  tasks.delete(id);
  task.controller.abort();
  task.file = undefined;
  void task.session?.cancel().catch(() => undefined);
  if (task.attachment.kind === "image") releaseAttachmentImagePreview(task.attachment);
}

/** The message receipt now owns these files. Forget draft-only cancellation
 * handles without touching the committed attachments named in its transcript. */
export function forgetAttachmentUploads(ids: readonly string[]): void {
  for (const id of ids) {
    const task = tasks.get(id);
    if (!task || task.running) continue;
    task.file = undefined;
    tasks.delete(id);
  }
}

export function cancelAttachmentUploads(ids: readonly string[]): void {
  for (const id of ids) cancelAttachmentUpload(id);
}

export function retryAttachmentUpload(id: string): void {
  const task = tasks.get(id);
  if (task?.file && !task.running && !task.completed) void run(task);
}

/** Test seam: proves a completed large upload no longer retains its File. */
export function attachmentUploadStateForTests(id: string): { running: boolean; completed: boolean; hasFile: boolean; cancellable: boolean } | undefined {
  const task = tasks.get(id);
  return task ? { running: task.running, completed: task.completed, hasFile: Boolean(task.file), cancellable: Boolean(task.session) } : undefined;
}
