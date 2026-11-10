// #3423: the watch loop walks the person's choices (the stopgap constant of
// #3416 is gone). Reads the source of server/index.ts as text: importing it
// would start the whole server.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const INDEX = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");

describe("Pulsatrix watch loop wiring", () => {
  const source = readFileSync(INDEX, "utf8");

  it("has no switch of its own any more: the person's choice is the switch", () => {
    expect(source).not.toMatch(/PULSATRIX_WATCHES_ENABLED/);
  });

  it("walks the people's choices, never the stored mode of every bot", () => {
    const block = source.slice(source.indexOf("const flowWatchLoop = new FlowWatchLoop({"), source.indexOf("const flowWatchLoop = new FlowWatchLoop({") + 600);
    expect(block).toMatch(/choices: \(\) => proactiveChoices\.chosen\(\)/);
    expect(block).not.toMatch(/store\.bots/);
  });

  it("schedules the watch tick once, on an organization server", () => {
    const ticks = [...source.matchAll(/setInterval\(\(\) => void flowWatchLoop\.tick\(\)/g)];
    expect(ticks).toHaveLength(1);
    const before = source.slice(0, ticks[0]!.index).split("\n").slice(-2).join("\n");
    expect(before).toMatch(/^if \(!process\.env\.VITEST && IDENTITY\.kind === "perspicax"\) \{$/m);
  });

  it("the person's choice passes the bot's switch in the watch engine", () => {
    const block = source.slice(source.indexOf("const flowWatchLoop = new FlowWatchLoop({"));
    expect(block.slice(0, block.indexOf("offer: (event) => offerProactive(event)"))).toMatch(/proactiveMode: "proactive" as const/);
  });
});
