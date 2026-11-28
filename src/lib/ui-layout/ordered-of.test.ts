import { describe, expect, it } from "vitest";

import { fillMissingAtDefault, orderedOf } from "./ordered-of";

const KNOWN = ["settings", "notifications", "channels", "accounts", "more"] as const;

describe("orderedOf", () => {
  it("keeps the saved relative order for ids that are present", () => {
    const zone = {
      order: ["more", "settings", "channels"],
      hidden: [] as string[],
    };
    expect(orderedOf(zone, KNOWN)).toEqual([
      "more",
      "settings",
      "notifications",
      "channels",
      "accounts",
    ]);
  });

  it("puts an id absent from the saved order back at its default place", () => {
    // Saved before notifications existed: only more + settings.
    // notifications must land between settings and channels (default), not at the end.
    const zone = {
      order: ["more", "settings"],
      hidden: [] as string[],
    };
    expect(orderedOf(zone, KNOWN)).toEqual([
      "more",
      "settings",
      "notifications",
      "channels",
      "accounts",
    ]);
  });

  it("inserts a missing leading default id before the saved tail", () => {
    const zone = {
      order: ["more"],
      hidden: [] as string[],
    };
    expect(orderedOf(zone, KNOWN)).toEqual([
      "settings",
      "notifications",
      "channels",
      "accounts",
      "more",
    ]);
  });

  it("skips hidden ids and still places missing visibles at default", () => {
    const zone = {
      order: ["more", "settings"],
      hidden: ["channels"],
    };
    expect(orderedOf(zone, KNOWN)).toEqual([
      "more",
      "settings",
      "notifications",
      "accounts",
    ]);
  });

  it("returns the full default when the saved order is empty", () => {
    const zone = { order: [] as string[], hidden: [] as string[] };
    expect(orderedOf(zone, KNOWN)).toEqual([...KNOWN]);
  });

  it("fillMissingAtDefault keeps dynamic ids while placing missing known ones", () => {
    const filled = fillMissingAtDefault(
      ["more", "section:Work"],
      [],
      KNOWN,
    );
    expect(filled).toEqual([
      "settings",
      "notifications",
      "channels",
      "accounts",
      "more",
      "section:Work",
    ]);
  });
});
