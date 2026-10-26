import { describe, expect, it } from "vitest";

import {
  charVk,
  controlMessage,
  grantMessage,
  isForwardedKey,
  keyToVk,
  mouseButton,
  normalizedPoint,
  wheelDelta,
} from "./remote-control-input";

describe("normalizedPoint", () => {
  const rect = { left: 100, top: 50, width: 1000, height: 500 };
  it("maps a point inside the frame to 0..10000", () => {
    expect(normalizedPoint(600, 300, rect)).toEqual({ x: 5000, y: 5000 });
    expect(normalizedPoint(100, 50, rect)).toEqual({ x: 0, y: 0 });
    expect(normalizedPoint(1100, 550, rect)).toEqual({ x: 10000, y: 10000 });
  });
  it("clamps points outside the frame to its edges", () => {
    expect(normalizedPoint(0, 0, rect)).toEqual({ x: 0, y: 0 });
    expect(normalizedPoint(5000, 5000, rect)).toEqual({ x: 10000, y: 10000 });
  });
});

describe("mouseButton", () => {
  it("remaps browser buttons to our left/right/middle order", () => {
    expect(mouseButton(0)).toBe(0);
    expect(mouseButton(2)).toBe(1);
    expect(mouseButton(1)).toBe(2);
    expect(mouseButton(4)).toBeNull();
  });
});

describe("wheelDelta", () => {
  it("turns pixel deltas into a small inverted line count", () => {
    expect(wheelDelta(100)).toBe(-1);
    expect(wheelDelta(-100)).toBe(1);
    expect(wheelDelta(0)).toBe(0);
    expect(wheelDelta(100000)).toBe(-50);
  });
});

describe("keyToVk / isForwardedKey / charVk", () => {
  it("maps named keys to Windows virtual-key codes, Cmd to Ctrl (never Win)", () => {
    expect(keyToVk("Enter")).toBe(0x0d);
    expect(keyToVk("ArrowLeft")).toBe(0x25);
    expect(keyToVk("F5")).toBe(0x74);
    expect(keyToVk("KeyA")).toBeNull();
    expect(keyToVk("MetaLeft")).toBe(0x11);
    expect(keyToVk("MetaRight")).toBe(0x11);
  });
  it("forwards navigation/modifier keys and anything held with Ctrl/Alt/Meta", () => {
    expect(isForwardedKey("ArrowLeft", { ctrl: false, alt: false, meta: false })).toBe(true);
    expect(isForwardedKey("KeyA", { ctrl: false, alt: false, meta: false })).toBe(false);
    expect(isForwardedKey("KeyA", { ctrl: true, alt: false, meta: false })).toBe(true);
  });
  it("gives the VK of a letter or digit for a shortcut", () => {
    expect(charVk("a")).toBe(0x41);
    expect(charVk("Z")).toBe(0x5a);
    expect(charVk("5")).toBe(0x35);
    expect(charVk("é")).toBeNull();
  });
});

describe("wire messages", () => {
  it("frames an event batch and a grant toggle", () => {
    expect(controlMessage([{ t: "m", x: 1, y: 2 }])).toBe("{\"t\":\"ev\",\"e\":[{\"t\":\"m\",\"x\":1,\"y\":2}]}");
    expect(grantMessage(true)).toBe("{\"t\":\"grant\",\"on\":true}");
  });
});
