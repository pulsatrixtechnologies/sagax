import { describe, expect, it } from "vitest";

import { desktopOwnedRefusal } from "./cli-pairing.ts";

describe("desktopOwnedRefusal", () => {
  it("tells the person to pair from the desktop app when that app owns the server", () => {
    const message = desktopOwnedRefusal(403, { error: "forbidden: this change must come from the desktop app or a paired device" });
    expect(message).toMatch(/Sagax desktop app/);
    expect(message).toMatch(/Remote access/);
    expect(desktopOwnedRefusal(403, { error: "Sign in through the workspace portal" })).toBeNull();
    expect(desktopOwnedRefusal(401, { error: "must come from the desktop app" })).toBeNull();
  });
});
