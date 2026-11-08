// VPS Computer and Boat Computer are experimental (Settings > Developer > Experimental
// features), off by default: off hides their pickers and the Cloud place.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { boatComputerEnabled, vpsComputerEnabled } from "@/lib/feature-flags";
import { cloudComputersOffered, placeOffered } from "@/lib/place";
import { CloudBackendPicker } from "../CloudBackendPicker";

const picker = (boat: boolean, vps: boolean) => renderToStaticMarkup(createElement(CloudBackendPicker, { value: "box", vpsSupported: true, boat, vps, onChange: () => {} }));

describe("VPS Computer and Boat Computer flags", () => {
  it("are off by default and on only when switched on", () => {
    for (const config of [null, undefined, {}, { features: {} }]) {
      expect(vpsComputerEnabled(config)).toBe(false);
      expect(boatComputerEnabled(config)).toBe(false);
      expect(cloudComputersOffered(config)).toBe(false);
      expect(placeOffered("cloud", config)).toBe(false);
    }
    expect(vpsComputerEnabled({ features: { vpsComputer: true } })).toBe(true);
    expect(boatComputerEnabled({ features: { boatComputer: true } })).toBe(true);
    expect(placeOffered("cloud", {})).toBe(false);
    // On an organization server Cloud is the server environment: the flags
    // never hide it, nor the local places.
    for (const config of [null, {}, { features: { vpsComputer: true } }, { features: { boatComputer: true } }]) {
      for (const place of ["cloud", "vm", "local", "browser"] as const) expect(placeOffered(place, config, true)).toBe(true);
    }
  });

  it("offer only the switched-on backends in the Cloud picker", () => {
    expect(picker(false, false)).toBe("");
    expect(picker(true, false)).toContain(">Boat<");
    expect(picker(true, false)).not.toContain("Self-hosted VPS<");
    expect(picker(false, true)).toContain("Self-hosted VPS<");
    expect(picker(false, true)).not.toContain(">Boat<");
    expect(picker(true, true)).toContain(">Boat<");
    expect(picker(true, true)).toContain("Self-hosted VPS<");
  });
});
