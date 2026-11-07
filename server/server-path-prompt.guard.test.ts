// 2026-11-02 (production): every builder of a turn's system prompt runs
// the server-path net when the engine has no file tools on the server.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(import.meta.dirname, path), "utf8");

describe("server paths never reach a prompt without server file tools", () => {
  it.each([
    ["turns/start-turn-prompt.ts", "serverFiles"],
    ["turns/group-member-turn-launch-prompt.ts", "roomServerFiles"],
  ])("%s gives the locations without server paths and runs the net", (file, flag) => {
    const source = read(file);
    expect(source).toContain(`const ${flag} = !withholdHostToolsFor(`);
    expect(source).toContain("hideServerPathsInSections(");
    expect(source).toMatch(new RegExp(`serverFiles(: ${flag})?, environmentFolder`));
    expect(source).toMatch(/workspaceCwdPrompt\(/);
    expect(source).toMatch(new RegExp(`&& ${flag} \\? workspaceCwdPrompt`));
  });

  it("the system prompt preview runs the same net", () => {
    // previewSystemPrompt moved to index-leaves/ (#1388): its host calls carry `host.`
    expect(read("index-leaves/previewSystemPrompt.ts")).toContain("host.withholdHostToolsFor(instance) ? hideServerPathsInSections(previewParts, host.serverPathView(bot.id))");
  });
});
