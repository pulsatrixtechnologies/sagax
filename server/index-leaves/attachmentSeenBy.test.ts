// An attachment no conversation uses is its uploader's only, and "no
// conversation yet" is never cached into a later answer.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { AttachmentUploaders } from "../attachments/attachment-uploaders.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import { createAttachmentSeenBy } from "./attachmentSeenBy.ts";
import { createThreadsUsingAttachment } from "./threadsUsingAttachment.ts";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => removeTempDir(dir))); });

function world() {
  const dir = mkdtempSync(join(tmpdir(), "sagax-uploaders-"));
  dirs.push(dir);
  const uses = new Map<string, string[]>();
  const readers = new Map<string, string[]>([["t-ann", ["pr_ann"]], ["t-room", ["pr_ann", "pr_ben"]]]);
  const host: Record<string, any> = {
    attachmentUploaders: new AttachmentUploaders(dir),
    attachmentThreads: new Map(),
    threadsReferencing: (name: string) => uses.get(name) ?? [],
    store: {
      bots: [] as Array<{ avatarUrl?: string }>,
      groupByThread: (threadId: string) => (threadId === "t-room" ? { id: "room" } : undefined),
      botByThread: (threadId: string) => (threadId === "t-ann" ? { id: "bot-ann" } : undefined),
    },
    groupVisible: (_group: unknown, viewer: string) => readers.get("t-room")!.includes(viewer),
    listedBotVisible: () => true,
    botThreadReadable: (_bot: unknown, threadId: string, viewer: string) => readers.get(threadId)?.includes(viewer) ?? false,
  };
  host.threadsUsingAttachment = createThreadsUsingAttachment(() => host);
  const seen = createAttachmentSeenBy(() => host) as (name: string, viewer: string) => boolean;
  return { host, uses, seen };
}

describe("attachmentSeenBy", () => {
  it("a file no conversation uses is its uploader's only, an admin's view included", () => {
    const w = world();
    w.host.attachmentUploaders.record("a1.zip", "PR_Ann");
    expect(w.seen("a1.zip", "pr_ann")).toBe(true);
    expect(w.seen("a1.zip", "pr_ben")).toBe(false);
    expect(w.seen("a1.zip", "pr_admin")).toBe(false);
  });

  it("an older file with no recorded uploader and no conversation is nobody's to read", () => {
    const w = world();
    expect(w.seen("old.zip", "pr_ann")).toBe(false);
    expect(w.seen("old.zip", "pr_ben")).toBe(false);
  });

  it("a read before the send never decides the read after it (no cached \"unused\")", () => {
    const w = world();
    w.host.attachmentUploaders.record("a2.zip", "pr_ann");
    expect(w.seen("a2.zip", "pr_ben")).toBe(false);
    expect(w.seen("a2.zip", "pr_ann")).toBe(true);
    // her own conversation uses it now: still not Ben's
    w.uses.set("a2.zip", ["t-ann"]);
    expect(w.seen("a2.zip", "pr_ben")).toBe(false);
    // a room both read uses it: Ben reads it at once
    w.host.attachmentThreads.clear();
    w.uses.set("a2.zip", ["t-ann", "t-room"]);
    expect(w.seen("a2.zip", "pr_ben")).toBe(true);
    expect(w.seen("a2.zip", "pr_admin")).toBe(false);
  });

  it("the first uploader stays the uploader", () => {
    const w = world();
    w.host.attachmentUploaders.record("a3.zip", "pr_ann");
    w.host.attachmentUploaders.record("a3.zip", "pr_ben");
    expect(w.host.attachmentUploaders.uploaderOf("a3.zip")).toBe("pr_ann");
    expect(w.seen("a3.zip", "pr_ben")).toBe(false);
  });
});
