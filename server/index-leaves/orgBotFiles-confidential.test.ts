// #4921 (liberty audit 2026-11-19 G3): #4627 reused the admin rule for the
// member files API, so a person's own confidential conversation never showed
// in their own Library. #4625 asked only for "the conversations the person
// may read". Their own confidential conversation is theirs to see; an admin
// (no viewer) and any other person still see nothing of it.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createOrgBotAttachments } from "./orgBotAttachments.ts";
import { createOrgBotFileRoots } from "./orgBotFileRoots.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const TASKS = [
  { threadId: "t-bob" },
  { threadId: "t-bob-secret", confidential: true },
  { threadId: "t-ann-secret", confidential: true },
];
const OWNER: Record<string, string> = { "t-bob-secret": "pr_bob", "t-ann-secret": "pr_ann" };

function host() {
  const home = mkdtempSync(join(tmpdir(), "sagax-own-confidential-"));
  dirs.push(home);
  mkdirSync(join(home, "tasks", "b1"), { recursive: true });
  mkdirSync(join(home, "workspaces", "b1"), { recursive: true });
  return {
    ATTACHMENTS_DIR: join(home, "attachments"),
    TASK_WORKSPACES_DIR: join(home, "tasks"),
    workspaceDir: (id: string) => join(home, "workspaces", id),
    insideDataDir: () => true,
    store: { tasks: () => TASKS, messagesFor: (threadId: string) => [{ threadId }] },
    // the private threads rule: each person reads their own conversations
    botThreadReadable: (_bot: unknown, threadId: string, viewerId: string) => threadId === "t-main" || threadId.startsWith(viewerId === "pr_bob" ? "t-bob" : "t-ann"),
    confidentialThreadOwner: (threadId: string) => OWNER[threadId] ?? null,
    threadFileRefs: (rows: Array<{ threadId: string }>) => [{ source: "upload", path: `${rows[0]!.threadId}.pdf` }],
    threadFileRefsFor: (threadId: string) => [{ source: "upload", path: `${threadId}.pdf` }],
    threadFileRoots: () => [],
    statMessageFile: () => ({}),
    listThreadFiles: async (refs: Array<{ path: string }>) => refs.map((ref) => ({ id: ref.path, name: ref.path, at: 1, available: true, localPath: `/x/${ref.path}` })),
  };
}

const BOT = { id: "b1", threadId: "t-main" };

describe("a person's own confidential conversations in their Library (#4921)", () => {
  it("the conversation folders: the person sees their own confidential one, never another's; an admin sees none", () => {
    const h = host();
    const roots = createOrgBotFileRoots(() => h);
    const tasksOf = (viewer?: string) => roots(BOT, viewer).find((root: { id: string }) => root.id === "tasks");
    const bob = tasksOf("pr_bob");
    expect([...bob.shown].sort()).toEqual(["t-bob", "t-bob-secret", "t-main"]);
    expect(bob.hidden?.has("t-bob-secret") ?? false).toBe(false);
    expect(bob.hidden?.has("t-ann-secret")).toBe(true);
    const ann = tasksOf("pr_ann");
    expect([...ann.shown]).toContain("t-ann-secret");
    expect([...ann.shown]).not.toContain("t-bob-secret");
    // the admin console (no viewer): no confidential conversation at all
    const admin = tasksOf(undefined);
    expect([...admin.hidden].sort()).toEqual(["t-ann-secret", "t-bob-secret"]);
  });

  it("the attachments: the person's own confidential uploads are listed, another's and the admin's view never", async () => {
    const h = host();
    const attachments = createOrgBotAttachments(() => h);
    const ids = async (viewer?: string) => (await attachments(BOT, viewer)).map((file: { id: string }) => file.id).sort();
    expect(await ids("pr_bob")).toEqual(["t-bob-secret.pdf", "t-bob.pdf", "t-main.pdf"]);
    expect(await ids("pr_ann")).toEqual(["t-ann-secret.pdf", "t-main.pdf"]);
    expect(await ids(undefined)).toEqual(["t-bob.pdf", "t-main.pdf"]);
  });
});
