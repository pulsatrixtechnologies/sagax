// #2196: the bot panel mascot must stay the reference app sized (~60px visible form).
// A shape paints at ~65% of its box; BOT_PANEL_AVATAR_SIZE 92 locks that, and
// BotProfileAvatarCard must keep the jump pad (pt-5) at that size.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { BOT_PANEL_AVATAR_SIZE } from "./BotSettingsDialog";

const here = dirname(fileURLToPath(import.meta.url));
const panelSource = readFileSync(join(here, "BotSettingsDialog.tsx"), "utf8");
const cardSource = readFileSync(join(here, "BotProfileAvatarCard.tsx"), "utf8");
const headingSource = readFileSync(join(here, "bot-settings", "BotNameTitleStack.tsx"), "utf8");

describe("bot panel mascot size (#2196)", () => {
  it("keeps the panel avatar box at 92 (visible hexagon ~60px)", () => {
    expect(BOT_PANEL_AVATAR_SIZE).toBe(92);
    expect(panelSource).toMatch(/size=\{BOT_PANEL_AVATAR_SIZE\}/);
    expect(panelSource).not.toMatch(/size=\{46\}/);
  });

  it("keeps jump room above the panel mascot (pt-5 from size 80)", () => {
    expect(cardSource).toMatch(/size >= 80 \? "pt-5" : "pt-3"/);
    expect(BOT_PANEL_AVATAR_SIZE).toBeGreaterThanOrEqual(80);
  });

  it("keeps the reference app header spacing under the mascot", () => {
    // the name 20px under the mascot, 17px medium; the title stacked under it
    expect(panelSource).toMatch(/<BotNameTitleStack/);
    expect(headingSource).toMatch(/mt-5 flex w-full min-w-0 max-w-full flex-col items-center/);
    expect(headingSource).toMatch(/text-\[17px\] font-medium/);
    expect(panelSource).toMatch(/data-bot-panel-tabs="" className=\{cn\("flex justify-center px-4 pb-4 pt-10"/);
  });
});
