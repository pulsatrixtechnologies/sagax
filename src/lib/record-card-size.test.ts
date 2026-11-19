// The opened record card's size (#5053): its default, its bounds, the window's
// room and where it sits. Pure numbers: no browser.
import { describe, expect, it } from "vitest";
import {
  RECORD_CARD_DEFAULT, RECORD_CARD_HEIGHT_KEY, RECORD_CARD_MARGIN, RECORD_CARD_MIN, RECORD_CARD_WIDTH, RECORD_CARD_WIDTH_KEY,
  placeRecordCard, recordCardHeightBounds, recordCardRoom, recordCardShown, recordCardStyle, recordCardTop,
} from "./record-card-size";

const laptop = { width: 1440, height: 900 };
const small = { width: 760, height: 520 };

describe("the opened record card's size", () => {
  it("opens 1000 px wide and at 80% of the window's height, 840 px at most", () => {
    expect(RECORD_CARD_WIDTH.fallback).toBe(1000);
    expect(RECORD_CARD_DEFAULT.share).toBe(0.8);
    expect(recordCardHeightBounds(laptop).fallback).toBe(720);
    expect(recordCardHeightBounds({ width: 2560, height: 1440 }).fallback).toBe(840);
    expect(recordCardHeightBounds(small).fallback).toBe(416);
    // a window too small for it: the default is still the readable minimum, and the window bounds what shows
    expect(recordCardHeightBounds({ width: 500, height: 300 }).fallback).toBe(RECORD_CARD_MIN.height);
  });

  it("has a readable minimum and keeps each size under its own key, like the sidebar's width", () => {
    expect(RECORD_CARD_WIDTH.min).toBe(480);
    expect(recordCardHeightBounds(laptop).min).toBe(320);
    expect(RECORD_CARD_WIDTH.key).toBe(RECORD_CARD_WIDTH_KEY);
    expect(recordCardHeightBounds(laptop).key).toBe(RECORD_CARD_HEIGHT_KEY);
    expect(RECORD_CARD_WIDTH_KEY).not.toBe(RECORD_CARD_HEIGHT_KEY);
  });

  it("is bounded by the window: 16 px from its sides and foot, its top a little under the window's", () => {
    expect(RECORD_CARD_MARGIN).toBe(16);
    expect(recordCardTop(laptop)).toBe(72);
    expect(recordCardTop(small)).toBe(42);
    expect(recordCardTop({ width: 400, height: 150 })).toBe(16);
    expect(recordCardRoom(laptop)).toEqual({ width: 1408, height: 812 });
    expect(recordCardRoom(small)).toEqual({ width: 728, height: 462 });
  });

  it("shows the kept size bounded by the window and never changes what is kept", () => {
    const kept = { width: 1200, height: 780 };
    expect(recordCardShown(kept, laptop)).toEqual({ width: 1200, height: 780 });
    expect(recordCardShown(kept, small)).toEqual({ width: 728, height: 462 });
    expect(kept).toEqual({ width: 1200, height: 780 });
  });

  it("hands the kept size to CSS as two variables, which the card's classes bound by the window", () => {
    expect(recordCardStyle({ width: 1200, height: 780 })).toEqual({ "--record-card-w": "1200px", "--record-card-h": "780px" });
  });

  it("sits centred across the window with its top held, whatever its own height", () => {
    expect(placeRecordCard({ width: 1000, height: 720 }, laptop)).toEqual({ left: 220, top: 72, room: 812 });
    // a short card (little content) and a tall one open at the same place
    expect(placeRecordCard({ width: 1000, height: 340 }, laptop)).toEqual({ left: 220, top: 72, room: 812 });
    expect(placeRecordCard({ width: 728, height: 416 }, small)).toEqual({ left: 16, top: 42, room: 462 });
  });
});
