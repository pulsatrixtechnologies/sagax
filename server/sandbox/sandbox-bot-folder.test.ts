import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BOT_FOLDER_RE,
  BotFolderRegistry,
  SANDBOX_ROOT_KEEP,
  TIDY_SCRIPT,
  WorkspaceTidier,
  attributeEntries,
  attributionFragments,
  botFolderNote,
  inBotFolder,
  rewriteMovedPaths,
  slugifyBotName,
  workspaceDiskWarning,
} from "./sandbox-bot-folder.ts";
import type { SandboxExecInput, SandboxExecOutput } from "./sandboxd-core.ts";

const dirs: string[] = [];
const scratch = () => { const dir = mkdtempSync(join(tmpdir(), "bot-folder-")); dirs.push(dir); return dir; };
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("bot folder names", () => {
  it("slugifies a bot's human name, never empty", () => {
    expect(slugifyBotName("Agent Mélanie (CW)")).toBe("agent-melanie-cw");
    expect(slugifyBotName("  PM Fleet  ")).toBe("pm-fleet");
    expect(slugifyBotName("!!!")).toBe("bot");
    expect(slugifyBotName("x".repeat(80))).toHaveLength(40);
  });

  it("keeps a slug across renames and suffixes a collision, never an id", () => {
    const file = join(scratch(), "folders.json");
    const registry = new BotFolderRegistry(file);
    expect(registry.slugFor("bot-a", "Helper")).toBe("helper");
    expect(registry.slugFor("bot-b", "Helper")).toBe("helper-2");
    expect(registry.slugFor("bot-c", "helper")).toBe("helper-3");
    expect(registry.slugFor("bot-a", "Renamed")).toBe("helper");
    const again = new BotFolderRegistry(file);
    expect(again.known("bot-b")).toBe("helper-2");
    expect(again.folderFor("bot-c", "anything")).toBe("/workspace/bots/helper-3");
    expect(BOT_FOLDER_RE.test("/workspace/bots/helper-3")).toBe(true);
    expect(BOT_FOLDER_RE.test("/workspace/bots/../etc")).toBe(false);
  });
});

describe("inBotFolder", () => {
  it("prefixes the argv so the command runs in the folder, created on first use", () => {
    const input: SandboxExecInput = { argv: ["bash", "-lc", "pwd"], timeoutSec: 5 };
    const placed = inBotFolder(input, "/workspace/bots/helper");
    expect(placed.argv.slice(0, 2)).toEqual(["sh", "-c"]);
    expect(placed.argv.slice(3)).toEqual(["sagax-bot-folder", "/workspace/bots/helper", "bash", "-lc", "pwd"]);
    expect(placed.timeoutSec).toBe(5);
    expect(inBotFolder(input, "/etc")).toBe(input);
  });

  it("really runs there with TMPDIR in its tmp/", () => {
    const root = scratch();
    const folder = join(root, "bots", "helper");
    const placed = inBotFolder({ argv: ["sh", "-c", "pwd; echo $TMPDIR"] }, "/workspace/bots/helper");
    // Same script, a real shell, the folder under a scratch root.
    const out = execFileSync(placed.argv[0]!, [placed.argv[1]!, placed.argv[2]!, placed.argv[3]!, folder, ...placed.argv.slice(5)], { encoding: "utf8" });
    expect(out.trim().split("\n")).toEqual([folder, `${folder}/tmp`]);
    expect(existsSync(join(folder, "tmp"))).toBe(true);
  });

  it("tells the bot where its folder is and never to write at the root", () => {
    const note = botFolderNote("/workspace/bots/helper");
    expect(note).toContain("/workspace/bots/helper");
    expect(note).toContain("/workspace/shared");
    expect(note).toContain("Never write loose files at the /workspace root");
    // the tool description keeps no server path
    expect(note).not.toContain("Sagax server");
  });

  // 2026-11-02 (production): the engine's working folder on the server
  // (/data/.openmausbot/workspaces/<bot id>) was taken for the bot's folder
  it("says plainly in the workplace note that the engine's server folder is not the environment", () => {
    const note = botFolderNote("/workspace/bots/nova", "/data/.openmausbot");
    expect(note).toContain("your own folder is /workspace/bots/nova");
    expect(note).toContain("anything under /data/.openmausbot are on that server, not in your server environment");
    expect(note).toContain("Never give such a path to your server environment tools (run_command, read_file, write_file, list_files)");
    expect(note).toContain("your files are in /workspace/bots/nova.");
  });
});

describe("rewriteMovedPaths", () => {
  it("replaces whole paths only", () => {
    const moves = [{ from: "/workspace/a.txt", to: "/workspace/bots/x/a.txt" }];
    expect(rewriteMovedPaths("cat /workspace/a.txt and /workspace/a.txt.bak", moves)).toBe("cat /workspace/bots/x/a.txt and /workspace/a.txt.bak");
    expect(rewriteMovedPaths("nothing here", moves)).toBe("nothing here");
  });
});

describe("workspaceDiskWarning", () => {
  it("warns when almost full or full, says nothing otherwise", () => {
    const GiB = 1024 ** 3;
    expect(workspaceDiskWarning({ freeBytes: 15 * GiB, totalBytes: 20 * GiB })).toBeNull();
    expect(workspaceDiskWarning({ freeBytes: 0.8 * GiB, totalBytes: 20 * GiB })).toContain("disk almost full");
    expect(workspaceDiskWarning({ freeBytes: 11 * 1024 * 1024, totalBytes: 1.9 * GiB }, "/workspace/bots/a")).toContain("disk full");
    expect(workspaceDiskWarning(null)).toBeNull();
  });
});

/** The tidy script against a scratch root, through a fake exec. */
function scriptExec(root: string, mark: string) {
  const calls: SandboxExecInput[] = [];
  const exec = async (_principal: string, input: SandboxExecInput): Promise<SandboxExecOutput> => {
    calls.push(input);
    const [cmd, ...args] = input.argv;
    const stdin = input.stdinBase64 ? Buffer.from(input.stdinBase64, "base64") : undefined;
    try {
      const stdout = execFileSync(cmd!, args, { input: stdin, env: { ...process.env, SAGAX_TIDY_ROOT: root, SAGAX_TIDY_MARK: mark }, encoding: "utf8" });
      return { exitCode: 0, stdout, stderr: "", truncated: false, timedOut: false };
    } catch (error) {
      const failed = error as { status?: number; stdout?: string; stderr?: string };
      return { exitCode: failed.status ?? 1, stdout: failed.stdout ?? "", stderr: failed.stderr ?? "", truncated: false, timedOut: false };
    }
  };
  return { calls, exec };
}

// 2026-11-03 (audit S-6): the attribution ignored the person, so a file of
// A's environment named only in B's bot's threads went to B's bot folder.
describe("attributeEntries", () => {
  const threadOf = (threadId: string) => ({
    "a-thread": { botId: "bot-a", person: "Person-A" },
    "b-thread": { botId: "bot-b", person: "person-b" },
    "a-on-b": { botId: "bot-b", person: "person-a" },
  } as Record<string, { botId: string; person: string }>)[threadId];

  it("counts only the person's own threads: another person's bot never claims a file", () => {
    const names = ["only-b.csv", "shared-name.txt", "mine-and-b.pdf", "a-on-shared-bot.md"];
    const threads = new Map<string, string[]>([
      ["/workspace/only-b.csv", ["b-thread"]],
      ["/workspace/mine-and-b.pdf", ["a-thread", "b-thread"]],
      ["shared-name.txt", ["b-thread", "gone-thread"]],
      ["/workspace/a-on-shared-bot.md", ["a-on-b"]],
    ]);
    const owners = attributeEntries("person-a", names, threads, threadOf);
    expect(owners.has("only-b.csv")).toBe(false);
    expect(owners.has("shared-name.txt")).toBe(false);
    expect(owners.get("mine-and-b.pdf")).toBe("bot-a");
    // A's own private thread with B's shared bot is A's work
    expect(owners.get("a-on-shared-bot.md")).toBe("bot-b");
    expect(attributeEntries("person-b", names, threads, threadOf).get("only-b.csv")).toBe("bot-b");
  });

  it("looks up the absolute path, and the bare name only when distinctive", () => {
    expect(attributionFragments(["report.pdf", "a"])).toEqual(["/workspace/report.pdf", "report.pdf", "/workspace/a"]);
  });
});

describe("WorkspaceTidier", () => {
  it("moves loose root entries to their bot or to _unsorted, writes the manifest, deletes nothing, once per start", async () => {
    const root = scratch();
    const mark = join(root, "..", `mark-${Date.now()}`);
    dirs.push(mark);
    for (const name of ["pm-fleet-chunk-0.txt", "routine24.txt", "novamac-1.jpg"]) writeFileSync(join(root, name), name);
    mkdirSync(join(root, "adhoc-folder"));
    writeFileSync(join(root, "adhoc-folder", "inside.md"), "x");
    for (const keep of ["bots", "shared", "sagax-plugins", "lost+found"]) mkdirSync(join(root, keep), { recursive: true });
    writeFileSync(join(root, ".gitconfig"), "[user]");
    // a file that already exists where one goes
    mkdirSync(join(root, "bots", "fleet"), { recursive: true });
    writeFileSync(join(root, "bots", "fleet", "pm-fleet-chunk-0.txt"), "older");
    // an old and a new tmp file
    mkdirSync(join(root, "bots", "fleet", "tmp"), { recursive: true });
    writeFileSync(join(root, "bots", "fleet", "tmp", "old.bin"), "o");
    writeFileSync(join(root, "bots", "fleet", "tmp", "new.bin"), "n");
    const tenDaysAgo = Date.now() / 1000 - 10 * 86400;
    utimesSync(join(root, "bots", "fleet", "tmp", "old.bin"), tenDaysAgo, tenDaysAgo);

    const { exec, calls } = scriptExec(root, mark);
    const moved: Array<{ from: string; to: string }> = [];
    const tidier = new WorkspaceTidier({
      exec,
      attribute: (_person, names) => new Map(names.filter((name) => name.startsWith("pm-fleet")).map((name) => [name, "bot-fleet"])),
      folderOf: (botId) => botId === "bot-fleet" ? `${root}/bots/fleet` : null,
      moved: (_person, moves) => { moved.push(...moves); },
      now: () => Date.parse("2026-11-02T12:00:00Z"),
      root,
    });
    // folderOf answers a scratch path: the script only accepts dests under
    // its root's bots/ or _unsorted/, which the scratch root satisfies.
    await tidier.ensure("person");
    expect(readFileSync(join(root, "bots", "fleet", "pm-fleet-chunk-0 (2).txt"), "utf8")).toBe("pm-fleet-chunk-0.txt");
    expect(readFileSync(join(root, "bots", "fleet", "pm-fleet-chunk-0.txt"), "utf8")).toBe("older");
    expect(existsSync(join(root, "_unsorted", "2026-11-02", "routine24.txt"))).toBe(true);
    expect(existsSync(join(root, "_unsorted", "2026-11-02", "novamac-1.jpg"))).toBe(true);
    expect(existsSync(join(root, "_unsorted", "2026-11-02", "adhoc-folder", "inside.md"))).toBe(true);
    for (const keep of [".gitconfig", "bots", "shared", "sagax-plugins", "lost+found"]) expect(existsSync(join(root, keep))).toBe(true);
    const manifest = readFileSync(join(root, "_unsorted", "MOVES-2026-11-02.md"), "utf8");
    expect(manifest).toContain(`| ${root}/routine24.txt | ${root}/_unsorted/2026-11-02/routine24.txt | yes |`);
    // the old paths still lead to the files, through hidden links
    expect(readFileSync(join(root, "routine24.txt"), "utf8")).toBe("routine24.txt");
    expect(lstatSync(join(root, "routine24.txt")).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(root, "adhoc-folder", "inside.md"), "utf8")).toBe("x");
    expect(readFileSync(join(root, ".hidden"), "utf8").split("\n")).toEqual(expect.arrayContaining(["routine24.txt", "adhoc-folder", "novamac-1.jpg", "pm-fleet-chunk-0.txt"]));
    expect(JSON.parse(readFileSync(join(root, "_unsorted", "moves.json"), "utf8"))[`${root}/routine24.txt`]).toBe(`${root}/_unsorted/2026-11-02/routine24.txt`);
    expect(moved).toHaveLength(4);
    expect(existsSync(join(root, "bots", "fleet", "tmp", "old.bin"))).toBe(false);
    expect(existsSync(join(root, "bots", "fleet", "tmp", "new.bin"))).toBe(true);
    expect(tidier.disk("person")?.totalBytes).toBeGreaterThan(0);

    // A new start: the links are left in place, a new loose file moves.
    rmSync(mark);
    writeFileSync(join(root, "fresh.txt"), "fresh");
    const next = new WorkspaceTidier({ exec, attribute: () => new Map(), folderOf: () => null, now: () => Date.parse("2026-11-03T12:00:00Z"), root });
    await next.ensure("person");
    expect(lstatSync(join(root, "routine24.txt")).isSymbolicLink()).toBe(true);
    expect(existsSync(join(root, "_unsorted", "2026-11-03", "routine24.txt"))).toBe(false);
    expect(existsSync(join(root, "_unsorted", "2026-11-03", "fresh.txt"))).toBe(true);

    // Same start: the marker stops a second pass, even after the recheck delay.
    writeFileSync(join(root, "late.txt"), "late");
    const later = new WorkspaceTidier({ exec, attribute: () => new Map(), folderOf: () => null });
    await later.ensure("person");
    expect(existsSync(join(root, "late.txt"))).toBe(true);
    expect(calls.filter((call) => call.argv[4] === "apply")).toHaveLength(2);
  });

  // 2026-11-03 (audit S-3): /workspace/tmp, attributed to a bot, became
  // bots/<slug>/tmp, and the same apply deleted its files older than 7 days.
  it("never moves a root tmp folder, never empties a moved folder, never deletes outside a bot's tmp", async () => {
    const root = scratch();
    const outside = scratch();
    const mark = join(root, "..", `mark-s3-${Date.now()}`);
    dirs.push(mark);
    const tenDaysAgo = Date.now() / 1000 - 10 * 86400;
    const old = (path: string) => { writeFileSync(path, "old"); utimesSync(path, tenDaysAgo, tenDaysAgo); };
    // the person's own /workspace/tmp, with an old file, named by a bot
    mkdirSync(join(root, "tmp"));
    old(join(root, "tmp", "keep-me.csv"));
    mkdirSync(join(root, "Downloads"));
    // an environment already tidied by 0.8.31: its moved tmp is in moves.json
    mkdirSync(join(root, "bots", "legacy", "tmp"), { recursive: true });
    old(join(root, "bots", "legacy", "tmp", "moved-in-0831.txt"));
    mkdirSync(join(root, "_unsorted"), { recursive: true });
    writeFileSync(join(root, "_unsorted", "moves.json"), JSON.stringify({ [`${root}/tmp-0831`]: `${root}/bots/legacy/tmp` }));
    // a bot's real tmp: an old file goes, a link to a file outside goes as a
    // link only, a linked folder is never walked
    mkdirSync(join(root, "bots", "fleet", "tmp"), { recursive: true });
    old(join(root, "bots", "fleet", "tmp", "scratch.bin"));
    old(join(outside, "precious.txt"));
    symlinkSync(join(outside, "precious.txt"), join(root, "bots", "fleet", "tmp", "link.txt"));
    symlinkSync(outside, join(root, "bots", "fleet", "tmp", "linked-dir"));
    // a bot folder whose tmp is a link out of /workspace/bots
    mkdirSync(join(root, "bots", "evil"), { recursive: true });
    symlinkSync(outside, join(root, "bots", "evil", "tmp"));

    const { exec } = scriptExec(root, mark);
    const lines: string[] = [];
    const tidier = new WorkspaceTidier({
      exec,
      attribute: (_person, names) => new Map(names.map((name) => [name, "bot-fleet"])),
      folderOf: () => `${root}/bots/fleet`,
      now: () => Date.parse("2026-11-03T12:00:00Z"),
      log: (line) => lines.push(line),
      root,
    });
    await tidier.ensure("person");
    expect(lstatSync(join(root, "tmp")).isDirectory()).toBe(true);
    expect(readFileSync(join(root, "tmp", "keep-me.csv"), "utf8")).toBe("old");
    expect(lstatSync(join(root, "Downloads")).isDirectory()).toBe(true);
    expect(existsSync(join(root, "bots", "fleet", "tmp (2)"))).toBe(false);
    expect(readFileSync(join(root, "bots", "legacy", "tmp", "moved-in-0831.txt"), "utf8")).toBe("old");
    expect(lines.join("\n")).toContain("left 1 moved tmp folder as is");
    expect(existsSync(join(root, "bots", "fleet", "tmp", "scratch.bin"))).toBe(false);
    expect(readFileSync(join(outside, "precious.txt"), "utf8")).toBe("old");
    expect(SANDBOX_ROOT_KEEP).toEqual(expect.arrayContaining(["tmp", "Downloads"]));
  });

  it("a root tmp in a plan aimed at a bot folder is refused by the script itself", () => {
    const root = scratch();
    const mark = join(root, "..", `mark-s3b-${Date.now()}`);
    dirs.push(mark);
    mkdirSync(join(root, "tmp"));
    mkdirSync(join(root, "bots", "fleet"), { recursive: true });
    const plan = Buffer.from(JSON.stringify({ date: "2026-11-03", moves: [{ name: "tmp", dest: `${root}/bots/fleet` }] }));
    // an empty keep list: only the script's own reserved-name rule stands
    const out = execFileSync("python3", ["-I", "-c", TIDY_SCRIPT, "apply", "[]", String(plan.length), "7"], { input: plan, env: { ...process.env, SAGAX_TIDY_ROOT: root, SAGAX_TIDY_MARK: mark }, encoding: "utf8" });
    expect(JSON.parse(out.trim()).moved).toEqual([]);
    expect(lstatSync(join(root, "tmp")).isDirectory()).toBe(true);
  });

  it("keeps the system folders in one list", () => {
    expect(SANDBOX_ROOT_KEEP).toEqual(expect.arrayContaining(["bots", "shared", "skills", "marketplaces", "sagax-plugins", "lost+found", "attachments"]));
    expect(TIDY_SCRIPT).toContain("startswith('.')");
  });

  it("never throws when the environment fails", async () => {
    const tidier = new WorkspaceTidier({
      exec: async () => ({ exitCode: 1, stdout: "", stderr: "boom", truncated: false, timedOut: false }),
      attribute: () => new Map(),
      folderOf: () => null,
    });
    await expect(tidier.ensure("person")).resolves.toBeUndefined();
  });
});
