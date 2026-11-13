// #4151 (measured on the reference, docs/design/ux-reference-grokbot-cursor.md
// 2.3): the bot panel's head is a 64px mascot drawn as large as its box, 8px
// under the top bar, "Name · Title" on one line 16px under it (17/24), then the
// Activity / Library switch 16px under the name and 10px over the content.
// Before #4151 the box was 92 (a ~60px form in a padded box), the title sat on a
// second line and the switch was 40px down.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { BOT_PANEL_AVATAR_SIZE } from "./BotSettingsDialog";

const here = dirname(fileURLToPath(import.meta.url));
const panelSource = readFileSync(join(here, "BotSettingsDialog.tsx"), "utf8");
const cardSource = readFileSync(join(here, "BotProfileAvatarCard.tsx"), "utf8");
const headingSource = readFileSync(join(here, "bot-settings", "BotNameTitleStack.tsx"), "utf8");

describe("bot panel head at the reference's measures (#4151)", () => {
  it("draws a 64px mascot that fills its box", () => {
    expect(BOT_PANEL_AVATAR_SIZE).toBe(64);
    expect(panelSource).toMatch(/size=\{BOT_PANEL_AVATAR_SIZE\}\s+fillBox/);
    expect(cardSource).toMatch(/fillBox=\{fillBox\}/);
  });

  it("keeps the mascot 8px under the top bar (the card's 12px jump room, -mt-1)", () => {
    expect(cardSource).toMatch(/size >= 80 \? "pt-5" : "pt-3"/);
    expect(BOT_PANEL_AVATAR_SIZE).toBeLessThan(80);
    expect(panelSource).toMatch(/data-bot-panel-head="" className="-mt-1 flex/);
  });

  it("puts the name line 16px under the mascot and the switch 16px under the name", () => {
    expect(panelSource).toMatch(/<BotNameTitleStack\s+oneLine\s+className="mt-\[9px\]"/);
    expect(headingSource).toMatch(/text-\[17px\] font-medium leading-6/);
    expect(panelSource).toMatch(/data-bot-panel-tabs="" className=\{cn\("flex justify-center px-4 pb-2\.5 pt-4"/);
  });
});
