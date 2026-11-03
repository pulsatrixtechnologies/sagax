import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { validateBotCwd } from "./bot-cwd.ts";

const dir = mkdtempSync(join(tmpdir(), "omb-cwd-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("validateBotCwd", () => {
  it("accepts an existing absolute directory", () => {
    expect(validateBotCwd(dir)).toEqual({ ok: true, cwd: dir });
  });

  it("treats null and empty as clearing the folder", () => {
    expect(validateBotCwd(null)).toEqual({ ok: true, cwd: null });
    expect(validateBotCwd("")).toEqual({ ok: true, cwd: null });
    expect(validateBotCwd("   ")).toEqual({ ok: true, cwd: null });
  });

  it("expands a leading ~ to the home folder", () => {
    // compare against homedir() itself: a Windows home like C:\Users\RUNNER~1
    // legitimately contains "~", so "no ~ in the output" is not a valid check
    expect(validateBotCwd("~")).toEqual({ ok: true, cwd: resolve(homedir()) });
  });

  it("rejects relative paths, files, and missing folders with a reason", () => {
    expect(validateBotCwd("relative/path")).toEqual({ ok: false, error: expect.stringMatching(/absolute/) });
    const file = join(dir, "a-file.txt");
    writeFileSync(file, "x");
    expect(validateBotCwd(file)).toEqual({ ok: false, error: expect.stringMatching(/not a folder/) });
    expect(validateBotCwd(join(dir, "nope"))).toEqual({ ok: false, error: expect.stringMatching(/doesn't exist/) });
    expect(validateBotCwd(42)).toEqual({ ok: false, error: expect.stringMatching(/path/) });
  });
});

describe("validateBotCwdFor (the bot's remote computer)", () => {
  type Row = { id: string; os: "windows" | "macos" | "linux"; state: string };
  const make = (rows: Row[], answer: (path: string) => unknown) => {
    const asked: string[] = [];
    return {
      asked,
      deps: {
        principalId: "owner@x",
        botId: "bot",
        sessions: {
          list: () => rows,
          listDir: async (_p: string, _b: string, _id: string, path: unknown) => { asked.push(String(path)); return answer(String(path)) as never; },
        },
      },
    };
  };
  const ok = (path: string) => ({ listing: { path, parent: null, roots: [], entries: [], truncated: false } });

  it("accepts a Windows path on a Windows computer without touching this disk", async () => {
    const { deps, asked } = make([{ id: "s", os: "windows", state: "connected" }], ok);
    const { validateBotCwdFor } = await import("./bot-cwd.ts");
    expect(await validateBotCwdFor("c:/Users/zseilam/Downloads", deps)).toEqual({ ok: true, cwd: "C:\\Users\\zseilam\\Downloads", remote: true });
    expect(asked).toEqual(["C:\\Users\\zseilam\\Downloads"]);
  });
  it("accepts a POSIX path on a POSIX computer, and rejects a relative or wrong-OS one", async () => {
    const { deps } = make([{ id: "s", os: "linux", state: "connected" }], ok);
    const { validateBotCwdFor } = await import("./bot-cwd.ts");
    expect(await validateBotCwdFor("/srv/app", deps)).toEqual({ ok: true, cwd: "/srv/app", remote: true });
    expect(await validateBotCwdFor("relative/dir", deps)).toEqual({ ok: false, error: "working folder must be an absolute path" });
    expect(await validateBotCwdFor("C:\\Users", deps)).toEqual({ ok: false, error: "working folder must be an absolute path" });
  });
  it("rejects a folder that does not exist on the remote computer", async () => {
    const { deps } = make([{ id: "s", os: "linux", state: "connected" }], () => ({ status: 404, error: "x" }));
    const { validateBotCwdFor } = await import("./bot-cwd.ts");
    expect(await validateBotCwdFor("/nope", deps)).toEqual({ ok: false, error: "that folder doesn't exist on the bot's computer" });
  });
  it("fails closed with the offline message when the computer does not answer", async () => {
    const { deps } = make([{ id: "s", os: "linux", state: "connected" }], () => ({ status: 409, error: "The remote computer did not answer. Try again in a moment." }));
    const { validateBotCwdFor } = await import("./bot-cwd.ts");
    expect(await validateBotCwdFor("/srv", deps)).toEqual({ ok: false, error: "The remote computer did not answer. Try again in a moment." });
  });
  it("falls back to this server only when the bot has no connected computer", async () => {
    const { deps, asked } = make([{ id: "s", os: "linux", state: "ended" }], ok);
    const { validateBotCwdFor } = await import("./bot-cwd.ts");
    expect(await validateBotCwdFor(dir, deps)).toEqual({ ok: true, cwd: dir });
    expect(asked).toEqual([]);
  });
});
