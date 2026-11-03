// 2026-11-02 (GOX, Melonie): a sandbox tool given the bot's own folder on
// the Sagax server answers where its folder in the environment is.
import { describe, expect, it } from "vitest";
import { serverPathAnswer, serverPathInCommand, serverPathLine } from "./sandbox-server-path.ts";

const BOT = "e456bd60-1017-4b4b-b790-724d406c35a6";
const where = {
  roots: [`/data/.openmausbot/workspaces/${BOT}`, `/data/.openmausbot/task-workspaces/${BOT}`],
  folder: "/workspace/bots/melonie",
};
const LINE = "That path is on the Sagax server, not in your environment. Your folder is /workspace/bots/melonie/.";

describe("a Sagax server path given to a server environment tool", () => {
  it("answers one short line for the bot's own server folders", () => {
    expect(serverPathAnswer(`/data/.openmausbot/workspaces/${BOT}`, where)).toBe(LINE);
    expect(serverPathAnswer(`/data/.openmausbot/workspaces/${BOT}/`, where)).toBe(LINE);
    expect(serverPathAnswer(`/data/.openmausbot/workspaces/${BOT}/memory/notes.md`, where)).toBe(LINE);
    expect(serverPathAnswer(`/data/.openmausbot/task-workspaces/${BOT}/t1`, where)).toBe(LINE);
    expect(serverPathAnswer(`/data/.openmausbot/workspaces/${BOT}/./docs/../memory`, where)).toBe(LINE);
  });

  it("leaves every other path to the guard: another bot, a climb out, a platform file, the environment", () => {
    expect(serverPathAnswer("/data/.openmausbot/workspaces/b2", where)).toBeNull();
    expect(serverPathAnswer(`/data/.openmausbot/workspaces/${BOT}0`, where)).toBeNull();
    expect(serverPathAnswer(`/data/.openmausbot/workspaces/${BOT}/../b2`, where)).toBeNull();
    expect(serverPathAnswer("/data/.openmausbot/bots.json", where)).toBeNull();
    expect(serverPathAnswer("/workspace/bots/melonie", where)).toBeNull();
    expect(serverPathAnswer("notes.md", where)).toBeNull();
    expect(serverPathAnswer(`/data/.openmausbot/workspaces/${BOT}`, { roots: ["/", "/data"], folder: null })).toBeNull();
  });

  it("answers a command that names the folder as a whole path, not one that climbs out", () => {
    expect(serverPathInCommand(`ls -la /data/.openmausbot/workspaces/${BOT}`, where)).toBe(LINE);
    expect(serverPathInCommand(`cat "/data/.openmausbot/workspaces/${BOT}/MEMORY.md"`, where)).toBe(LINE);
    expect(serverPathInCommand(`cd /data/.openmausbot/workspaces/${BOT}; ls`, where)).toBe(LINE);
    expect(serverPathInCommand(`ls /data/.openmausbot/workspaces/${BOT}0`, where)).toBeNull();
    expect(serverPathInCommand(`cat /data/.openmausbot/workspaces/${BOT}/../../bots.json`, where)).toBeNull();
    expect(serverPathInCommand("ls /workspace/bots/melonie", where)).toBeNull();
  });

  it("names /workspace when the bot has no folder yet", () => {
    expect(serverPathLine(null)).toBe("That path is on the Sagax server, not in your environment. Your files are in /workspace.");
  });
});
