import { afterEach, describe, expect, it, vi } from "vitest";

import { webAudioAllowed } from "./audio-gate";

describe("webAudioAllowed (#3043)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("waits for the person's first gesture in a plain browser", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { userActivation: { hasBeenActive: false } });
    expect(webAudioAllowed()).toBe(false);
    vi.stubGlobal("navigator", { userActivation: { hasBeenActive: true } });
    expect(webAudioAllowed()).toBe(true);
  });

  it("always plays in the desktop shell, and where the browser does not say", () => {
    vi.stubGlobal("navigator", { userActivation: { hasBeenActive: false } });
    vi.stubGlobal("window", { ogb: {} });
    expect(webAudioAllowed()).toBe(true);
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", {});
    expect(webAudioAllowed()).toBe(true);
  });
});
