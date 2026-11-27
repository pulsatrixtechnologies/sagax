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
  // who sees each bot (its owner and those it is shared with), each room, each routine
  const botViewers = new Map<string, string[]>([["bot-ann", ["pr_ann"]], ["bot-shared", ["pr_ann", "pr_ben"]], ["bot-roomed", ["pr_ann"]], ["bot-listed", ["pr_ann"]]]);
  const routineViewers = new Map<string, string[]>([["r-ann", ["pr_ann"]], ["r-team", ["pr_ann", "pr_ben"]]]);
  const host: Record<string, any> = {
    attachmentUploaders: new AttachmentUploaders(dir),
    attachmentThreads: new Map(),
    threadsReferencing: (name: string) => uses.get(name) ?? [],
    threadsReferencingAsync: async (names: readonly string[]) => {
      const out = new Map<string, string[]>();
      for (const name of names) out.set(name, uses.get(name) ?? []);
      return out;
    },
    cfg: {} as { newBotDefaults?: { profile: { avatarUrl?: string } } },
    routines: { listRoutines: () => routines },
    store: {
      bots: [] as Array<{ id: string; avatarUrl?: string; catalog?: { published: boolean }; archived?: boolean }>,
      groups: [{ id: "room", memberIds: ["bot-roomed"] }],
      groupByThread: (threadId: string) => (threadId === "t-room" ? { id: "room" } : undefined),
      botByThread: (threadId: string) => (threadId === "t-ann" ? { id: "bot-ann" } : undefined),
    },
    groupVisible: (_group: unknown, viewer: string) => readers.get("t-room")!.includes(viewer),
    listedBotVisible: (bot: { id: string }, viewer: string) => botViewers.get(bot.id)?.includes(viewer) ?? false,
    botThreadReadable: (_bot: unknown, threadId: string, viewer: string) => readers.get(threadId)?.includes(viewer) ?? false,
    routineSeenBy: (routine: { id: string }, viewer: string) => routineViewers.get(routine.id)?.includes(viewer) ?? false,
  };
  const routines: Array<{ id: string; attachments?: Array<{ path: string }> }> = [];
  host.threadsUsingAttachment = createThreadsUsingAttachment(() => host);
  const seen = createAttachmentSeenBy(() => host) as (name: string, viewer: string) => boolean;
  return { host, uses, seen, routines };
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

  // #5343: authenticate primes the cache off-thread before subjectSeesChannel.
  it("prime fills the cache without a sync scan on the next read", async () => {
    const w = world();
    w.uses.set("primed.zip", ["t-room"]);
    let sync = 0;
    w.host.threadsReferencing = (name: string) => {
      sync++;
      return w.uses.get(name) ?? [];
    };
    await w.host.threadsUsingAttachment.prime("primed.zip");
    expect(w.host.threadsUsingAttachment("primed.zip")).toEqual(["t-room"]);
    expect(sync).toBe(0);
  });

  it("the first uploader stays the uploader", () => {
    const w = world();
    w.host.attachmentUploaders.record("a3.zip", "pr_ann");
    w.host.attachmentUploaders.record("a3.zip", "pr_ben");
    expect(w.host.attachmentUploaders.uploaderOf("a3.zip")).toBe("pr_ann");
    expect(w.seen("a3.zip", "pr_ben")).toBe(false);
  });

  // an image that belongs to an object is read by whoever sees that object, nobody else
  const picture = (name: string) => `/api/attachments/${name}`;

  it("a bot's picture: its owner and the people it is shared with, never someone who cannot see it", () => {
    const w = world();
    w.host.store.bots.push({ id: "bot-ann", avatarUrl: picture("ann.png") }, { id: "bot-shared", avatarUrl: picture("shared.png") });
    expect(w.seen("ann.png", "pr_ann")).toBe(true);
    expect(w.seen("ann.png", "pr_ben")).toBe(false);
    expect(w.seen("ann.png", "pr_admin")).toBe(false);
    expect(w.seen("shared.png", "pr_ben")).toBe(true);
    expect(w.seen("shared.png", "pr_cy")).toBe(false);
  });

  it("a bot's picture: the members of a room it is in", () => {
    const w = world();
    w.host.store.bots.push({ id: "bot-roomed", avatarUrl: picture("roomed.png") });
    expect(w.seen("roomed.png", "pr_ben")).toBe(true);
    expect(w.seen("roomed.png", "pr_cy")).toBe(false);
  });

  it("a bot's picture: the organization once the bot is in its catalogue, never while archived", () => {
    const w = world();
    w.host.store.bots.push({ id: "bot-listed", avatarUrl: picture("listed.png"), catalog: { published: true } });
    expect(w.seen("listed.png", "pr_cy")).toBe(true);
    w.host.store.bots[0]!.archived = true;
    expect(w.seen("listed.png", "pr_cy")).toBe(false);
  });

  it("the new-bot template's picture: every member", () => {
    const w = world();
    w.host.cfg.newBotDefaults = { profile: { avatarUrl: picture("template.png") } };
    expect(w.seen("template.png", "pr_cy")).toBe(true);
    expect(w.seen("other.png", "pr_cy")).toBe(false);
  });

  it("a routine's attached file: whoever sees the routine whole, never someone who cannot", () => {
    const w = world();
    w.routines.push({ id: "r-ann", attachments: [{ path: "/data/attachments/brief.png" }] }, { id: "r-team", attachments: [{ path: "/data/attachments/team.pdf" }] });
    expect(w.seen("brief.png", "pr_ann")).toBe(true);
    expect(w.seen("brief.png", "pr_ben")).toBe(false);
    expect(w.seen("team.pdf", "pr_ben")).toBe(true);
    expect(w.seen("team.pdf", "pr_cy")).toBe(false);
  });
});
