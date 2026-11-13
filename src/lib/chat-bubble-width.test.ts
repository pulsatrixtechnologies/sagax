import { describe, expect, it } from "vitest";
import {
  CHAT_BUBBLE_WIDTH_CLASS,
  CHAT_COLUMN_CLASS,
  chatBubbleWidth,
  chatBubbleWidthClasses,
  chatColumnClass,
  chatColumnMaxPx,
  chatComposerShellClass,
  chatRoomFitClass,
} from "./chat-bubble-width";
import { CHAT_WIDTHS, parseChatWidth } from "./chat-width-preference";

describe("chatBubbleWidth", () => {
  it("picks the column for a live terminal, else wide or fit", () => {
    expect(chatBubbleWidth({ terminal: true, wide: false })).toBe("column");
    expect(chatBubbleWidth({ terminal: true, wide: true })).toBe("column");
    expect(chatBubbleWidth({ terminal: false, wide: true })).toBe("wide");
    expect(chatBubbleWidth({ terminal: false, wide: false })).toBe("fit");
  });

  it("keeps the column class free of a fixed pixel cap", () => {
    expect(CHAT_BUBBLE_WIDTH_CLASS.column).toContain("w-full");
    expect(CHAT_BUBBLE_WIDTH_CLASS.column).not.toMatch(/\d+px,/);
  });
});

describe("chat width mapping (#2004)", () => {
  it("defaults unknown values to reading", () => {
    expect(parseChatWidth(null)).toBe("reading");
    expect(parseChatWidth("nope")).toBe("reading");
    expect(CHAT_WIDTHS).toEqual(["reading", "wide", "full"]);
  });

  it("maps reading / wide / full to column, composer and bubble caps", () => {
    expect(chatColumnMaxPx("reading")).toBe(960);
    expect(chatColumnMaxPx("wide")).toBe(1280);
    expect(chatColumnMaxPx("full")).toBeNull();

    expect(chatColumnClass("reading")).toContain("max-w-[960px]");
    expect(chatColumnClass("wide")).toContain("max-w-[1280px]");
    expect(chatColumnClass("full")).toContain("max-w-none");
    expect(CHAT_COLUMN_CLASS).toBe(chatColumnClass("reading"));

    expect(chatComposerShellClass("reading")).toContain("100%-960px");
    expect(chatComposerShellClass("wide")).toContain("100%-1280px");
    expect(chatComposerShellClass("full")).toContain("px-4");
    // the dock's gutter is the transcript pane's (px-4, 16px, #4093): a pinned card and
    // the cards of the chat share one width on a narrow screen (#3581)
    expect(chatComposerShellClass("reading")).toContain("max(16px,");
    expect(chatComposerShellClass("wide")).toContain("max(16px,");
    expect(chatComposerShellClass("full")).not.toContain("960px");

    const reading = chatBubbleWidthClasses("reading");
    const wide = chatBubbleWidthClasses("wide");
    const full = chatBubbleWidthClasses("full");
    expect(reading.fit).toContain("560px");
    expect(reading.wide).toContain("780px");
    expect(wide.fit).toContain("747px");
    expect(wide.wide).toContain("1040px");
    expect(full.fit).toContain("960px");
    expect(full.wide).toMatch(/min\(94%,calc\(100%-82px\)\)/);
    expect(full.wide).not.toMatch(/\d+px,/);
    expect(CHAT_BUBBLE_WIDTH_CLASS).toEqual(reading);

    expect(chatRoomFitClass("reading")).toContain("780px");
    expect(chatRoomFitClass("wide")).toContain("1040px");
    expect(chatRoomFitClass("full")).not.toMatch(/\d+px,/);
  });

  it("widens bubble caps when the column widens", () => {
    const readingFit = 560;
    const readingWide = 780;
    const wideFit = 747;
    const wideWide = 1040;
    expect(wideFit / readingFit).toBeCloseTo(1280 / 960, 2);
    expect(wideWide / readingWide).toBeCloseTo(1280 / 960, 2);
  });
});
