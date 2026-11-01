// @vitest-environment happy-dom
// Per-person Computer place labels: persistence in localStorage and key isolation.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PLACE_LABELS_PREFERENCE } from "../../shared/place-labels";
import {
  getPlaceLabels,
  placeLabel,
  resetPlaceLabelsForTests,
  savePlaceLabel,
} from "./place-labels";

beforeEach(() => {
  localStorage.clear();
  resetPlaceLabelsForTests();
});
afterEach(() => {
  localStorage.clear();
  resetPlaceLabelsForTests();
});

describe("place labels client store", () => {
  it("persists a rename and shows it everywhere for that place key", () => {
    expect(placeLabel("desktop:d1", "JeanChrophesMBP.localdomain")).toBe("JeanChrophesMBP.localdomain");
    savePlaceLabel("desktop:d1", "MacBook de JC");
    expect(placeLabel("desktop:d1", "JeanChrophesMBP.localdomain")).toBe("MacBook de JC");
    expect(localStorage.getItem(PLACE_LABELS_PREFERENCE)).toContain("MacBook de JC");
    expect(getPlaceLabels()).toEqual({ "desktop:d1": "MacBook de JC" });
  });

  it("isolates places: renaming one leaves others on their technical name", () => {
    savePlaceLabel("desktop:d1", "MacBook de JC");
    savePlaceLabel("host:h_ab", "PC du lab");
    expect(placeLabel("desktop:d1", "JeanChrophesMBP.localdomain")).toBe("MacBook de JC");
    expect(placeLabel("host:h_ab", "PC-A.local")).toBe("PC du lab");
    expect(placeLabel("server", "Cloud")).toBe("Cloud");
    expect(placeLabel("browser", "Browser")).toBe("Browser");
    expect(placeLabel("desktop:d2", "Other-Mac")).toBe("Other-Mac");
  });

  it("clears a label back to the technical name", () => {
    savePlaceLabel("desktop:d1", "MacBook de JC");
    savePlaceLabel("desktop:d1", null);
    expect(placeLabel("desktop:d1", "JeanChrophesMBP.localdomain")).toBe("JeanChrophesMBP.localdomain");
    expect(getPlaceLabels()).toEqual({});
  });
});
