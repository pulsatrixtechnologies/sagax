// #3510: before the engine started, a turn waited on compaction and context
// selection, then on the MCP sign-in refresh, then on the remote servers'
// probe, one after the other. The two MCP steps need only the bot, so they
// start beside compaction and are awaited where the mounts are read.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "start-turn-setup.ts"), "utf8");

it("starts the MCP sign-in refresh and probe before compaction and awaits them at the mounts (#3510)", () => {
  const refresh = source.indexOf("await refreshMcpOAuth(state.bot)");
  const prepare = source.indexOf("await prepareMcpServers(state.bot)");
  const compaction = source.indexOf("await compactConversation(");
  const awaited = source.indexOf("await customMcpPrepared;");
  const mounts = source.indexOf("mcpServersAsPerson(");
  expect(refresh).toBeGreaterThan(-1);
  expect(compaction).toBeGreaterThan(-1);
  expect(refresh).toBeLessThan(compaction);
  expect(prepare).toBeLessThan(compaction);
  expect(awaited).toBeGreaterThan(compaction);
  expect(awaited).toBeLessThan(mounts);
  // each runs once per turn
  expect(source.split("refreshMcpOAuth(state.bot)").length - 1).toBe(1);
  expect(source.split("prepareMcpServers(state.bot)").length - 1).toBe(1);
});
