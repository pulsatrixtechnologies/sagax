// 2026-11-02 (GOX, Melonie): no path of the Sagax server in the prompt of an
// engine that has no file tools there.
import { describe, expect, it } from "vitest";
import { SERVER_KEPT, hideServerPaths, hideServerPathsInSections, namesServerPath } from "./server-path-prompt.ts";

const BOT = "e456bd60-1017-4b4b-b790-724d406c35a6";
const view = { dataDirs: ["/data/.openmausbot", "/mnt/real/openmausbot"], botWorkspaces: [`/data/.openmausbot/workspaces/${BOT}`, `/mnt/real/openmausbot/workspaces/${BOT}`] };

describe("server paths in a prompt without server file tools", () => {
  it("turns a file of the bot's workspace into the relative path workspace_read reads", () => {
    expect(hideServerPaths(`Read "/data/.openmausbot/workspaces/${BOT}/skills/.revisions/abc/SKILL.md".`, view)).toBe('Read "skills/.revisions/abc/SKILL.md".');
    expect(hideServerPaths(`memory file is \\"/data/.openmausbot/workspaces/${BOT}/MEMORY.md\\"`, view)).toBe('memory file is \\"MEMORY.md\\"');
    expect(hideServerPaths(`/mnt/real/openmausbot/workspaces/${BOT}/docs/a.md`, view)).toBe("docs/a.md");
  });

  it("says the server keeps anything else: the workspace itself, a climb out, another bot, a conversation folder", () => {
    for (const path of [
      `/data/.openmausbot/workspaces/${BOT}`,
      `/data/.openmausbot/workspaces/${BOT}/`,
      `/data/.openmausbot/workspaces/${BOT}/../b2/MEMORY.md`,
      "/data/.openmausbot/workspaces/b2/MEMORY.md",
      `/data/.openmausbot/task-workspaces/${BOT}/t1`,
      "/data/.openmausbot",
    ]) {
      const out = hideServerPaths(`folder: "${path}".`, view);
      expect(out, path).toBe(`folder: "${SERVER_KEPT}".`);
      expect(namesServerPath(out, view)).toBe(false);
    }
  });

  it("leaves other paths and lookalikes alone", () => {
    for (const text of ["/workspace/bots/melonie", "/data/.openmausbot2/x", "/data/other", "see docs/a.md"]) {
      expect(hideServerPaths(text, view)).toBe(text);
    }
  });

  it("rewrites every section and names the ones that still spelled a server path", () => {
    const sections = [
      { id: "files", label: "File locations", text: `{"sharedBotFolder":"/data/.openmausbot/workspaces/${BOT}"}` },
      { id: "soul", label: "Soul", text: "Be kind." },
    ];
    const { sections: out, leaked } = hideServerPathsInSections(sections, view);
    expect(leaked).toEqual(["files"]);
    expect(out[0]!.text).toBe(`{"sharedBotFolder":"${SERVER_KEPT}"}`);
    expect(out[1]).toBe(sections[1]);
  });
});
