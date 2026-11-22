// @vitest-environment happy-dom
// The wide sidebar lists the account rows above the name (#5016). Absent
// means on: the rows are there without opening the menu. "off" keeps them
// behind the name.
import { afterEach, describe, expect, it } from "vitest";

import { accountMenuAbove } from "./account-menu-above";

afterEach(() => {
  localStorage.clear();
});

describe("account menu above the name", () => {
  it("is on when the person has not chosen, so the rows are visible (#5016)", () => {
    localStorage.removeItem(accountMenuAbove.key);
    expect(accountMenuAbove.get()).toBe("on");
  });

  it("stays off once the person turns it off", () => {
    accountMenuAbove.set("off");
    expect(accountMenuAbove.get()).toBe("off");
  });
});
