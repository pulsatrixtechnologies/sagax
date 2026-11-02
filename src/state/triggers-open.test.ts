import { describe, expect, it } from "vitest";

import { initialState, reducer } from "./store";

describe("Triggers open Automations > Webhooks", () => {
  it("toggleTriggers opens the webhooks section and never a pop-up", () => {
    const withApps = reducer(initialState, { type: "togglePlugins", open: true });
    const triggers = reducer(withApps, { type: "toggleTriggers", open: true });
    expect(triggers.triggersOpen).toBe(false);
    expect(triggers.pluginsOpen).toBe(false);
    expect(triggers.activeView).toBe("routines");
    expect(triggers.routinesFocus.section).toBe("webhooks");
    expect(triggers.routinesFocus.nonce).toBe(1);

    expect(reducer(triggers, { type: "toggleTriggers", open: false }).triggersOpen).toBe(false);
    expect(initialState.triggersOpen).toBe(false);
  });

  it("toggling Triggers again refreshes the webhooks focus nonce", () => {
    const once = reducer(initialState, { type: "toggleTriggers", open: true });
    const twice = reducer(once, { type: "toggleTriggers" });
    expect(twice.activeView).toBe("routines");
    expect(twice.routinesFocus.section).toBe("webhooks");
    expect(twice.routinesFocus.nonce).toBe(once.routinesFocus.nonce + 1);
  });
});
