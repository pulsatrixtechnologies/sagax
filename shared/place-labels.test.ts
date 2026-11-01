import { describe, expect, it } from "vitest";

import {
  normalizePlaceLabel,
  parsePlaceLabels,
  placeDisplayName,
  PLACE_LABEL_MAX,
  serializePlaceLabels,
  setPlaceLabel,
} from "./place-labels.ts";

describe("place labels", () => {
  it("normalizes, rejects control characters and overlong text", () => {
    expect(normalizePlaceLabel("  MacBook de JC ")).toEqual({ ok: true, label: "MacBook de JC" });
    expect(normalizePlaceLabel("   ")).toEqual({ ok: true, label: null });
    expect(normalizePlaceLabel("A\nB")).toEqual({ ok: false, code: "label_one_line" });
    expect(normalizePlaceLabel("x".repeat(PLACE_LABEL_MAX + 1))).toEqual({ ok: false, code: "label_too_long" });
  });

  it("parses and serializes a map, dropping bad entries", () => {
    const raw = JSON.stringify({ "desktop:d1": "MacBook de JC", bad: 12, "host:h": "  " });
    expect(parsePlaceLabels(raw)).toEqual({ "desktop:d1": "MacBook de JC" });
    expect(parsePlaceLabels("nope")).toEqual({});
    expect(serializePlaceLabels({ "desktop:d1": "Mac", "x": "" })).toBe(JSON.stringify({ "desktop:d1": "Mac" }));
  });

  it("sets, clears and displays with isolation of keys", () => {
    let labels = setPlaceLabel({}, "desktop:d1", "MacBook de JC");
    expect(placeDisplayName("desktop:d1", "JeanChrophesMBP.localdomain", labels)).toBe("MacBook de JC");
    expect(placeDisplayName("server", "Cloud", labels)).toBe("Cloud");
    labels = setPlaceLabel(labels, "desktop:d1", null);
    expect(placeDisplayName("desktop:d1", "JeanChrophesMBP.localdomain", labels)).toBe("JeanChrophesMBP.localdomain");
  });
});
