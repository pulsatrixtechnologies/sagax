import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_LEVEL_CHANNELS, readLevelChannels, levelChannelsValue } from "../../../shared/attention-policy";
import { readQuietHours } from "../../../shared/signal-levels";
import { quietPresetOf, quietValueOf, SignalSettings, toggleLevelChannel } from "./SignalSettings";

describe("quiet hours setting (#2695)", () => {
  it("stores a preset with the time zone the server reads", () => {
    const value = quietValueOf("22-07", "America/Toronto");
    expect(readQuietHours(value)).toEqual({ start: "22:00", end: "07:00", timeZone: "America/Toronto" });
    expect(quietPresetOf(value)).toBe("22-07");
    expect(quietValueOf("off")).toBeNull();
    expect(quietPresetOf("off")).toBe("off");
    expect(quietPresetOf(null)).toBe("off");
  });
});

describe("channels per level (#4250 S2: one page for the one attention policy)", () => {
  it("turns a channel on or off for one level, in the channels' own order", () => {
    const off = toggleLevelChannel(DEFAULT_LEVEL_CHANNELS, "card", "sms", false);
    expect(off.card).toEqual(["push", "teams", "telegram", "whatsapp"]);
    expect(off.urgent).toEqual(DEFAULT_LEVEL_CHANNELS.urgent);
    const back = toggleLevelChannel({ card: ["telegram"], urgent: ["push"] }, "card", "push", true);
    expect(back.card).toEqual(["push", "telegram"]);
    // what the page stores is what the server's gate reads
    expect(readLevelChannels(levelChannelsValue(back))).toEqual(back);
  });

  it("shows quiet hours, the day budget and the channels of urgent and other signals on one page", () => {
    const html = renderToStaticMarkup(createElement(SignalSettings, { organization: true }));
    expect(html).toContain('data-settings-row="quietHours"');
    expect(html).toContain('data-settings-row="signalBudget"');
    expect(html).toContain('data-signal-channels="urgent"');
    expect(html).toContain('data-signal-channels="card"');
    expect((html.match(/data-signal-channel="/g) ?? []).length).toBe(10);
    expect(html).toContain("Urgent, reach me by");
  });

  it("puts each level's chips on the row's full-width line, where they wrap inside the card at phone width", () => {
    const html = renderToStaticMarkup(createElement(SignalSettings, { organization: true }));
    for (const level of ["urgent", "card"]) {
      // the control slot never shrinks; the line under the description does
      expect(html).toMatch(new RegExp(`data-settings-below=""><div role="group"[^>]*data-signal-channels="${level}"`));
      const group = html.match(new RegExp(`<div role="group"[^>]*data-signal-channels="${level}"[^>]*>`))?.[0] ?? "";
      expect(group).toContain("flex-wrap");
      expect(group).toContain("min-w-0");
    }
  });
});
