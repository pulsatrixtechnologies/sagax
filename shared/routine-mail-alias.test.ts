import { describe, expect, it } from "vitest";

import {
  parseMailAlias,
  planMailDelivery,
  plusTag,
  routineMailAddress,
  routinesForMailTag,
  tagRoutingRows,
} from "./routine-mail-alias.ts";

describe("routine mail alias", () => {
  it("keeps a short tag and refuses anything that could change the address", () => {
    expect(parseMailAlias(" Reports ")).toEqual({ ok: true, alias: "reports" });
    expect(parseMailAlias("")).toEqual({ ok: true });
    expect(parseMailAlias(null)).toEqual({ ok: true });
    expect(parseMailAlias("a+b")).toEqual({ ok: false, error: "A mail tag is 1 to 32 letters or digits." });
    expect(parseMailAlias("has space")).toEqual({ ok: false, error: "A mail tag is 1 to 32 letters or digits." });
    expect(parseMailAlias(3)).toEqual({ ok: false, error: "A mail tag is 1 to 32 letters or digits." });
  });

  it("reads the tag on an inbound address and builds the tagged address", () => {
    expect(plusTag("bot+reports@example.org")).toBe("reports");
    expect(plusTag("Bot+Reports@example.org")).toBe("reports");
    expect(plusTag("bot@example.org")).toBeNull();
    expect(plusTag("bot+a+b@example.org")).toBeNull();
    expect(routineMailAddress("bot@example.org", "reports")).toBe("bot+reports@example.org");
    expect(routineMailAddress("bot+already@example.org", "reports")).toBeNull();
    expect(routineMailAddress("not an address", "reports")).toBeNull();
  });
});

const routines = [
  { id: "r-reports", botId: "bot_a", name: "Reports", enabled: true, mailAlias: "reports" },
  { id: "r-shop", botId: "bot_a", name: "Shop", enabled: true, mailAlias: "shop" },
  { id: "r-off", botId: "bot_a", name: "Off", enabled: false, mailAlias: "reports" },
  { id: "r-paused", botId: "bot_a", name: "Paused", enabled: true, suspended: true, mailAlias: "shop" },
  { id: "r-plain", botId: "bot_a", name: "Daily", enabled: true },
  { id: "r-other", botId: "bot_b", name: "Other bot", enabled: true, mailAlias: "reports" },
];

describe("inbound tag routing", () => {
  it("wakes only enabled routines of this bot bound to the plus tag", () => {
    expect(routinesForMailTag(routines, "bot_a", "reports").map((row) => row.id)).toEqual(["r-reports"]);
    expect(routinesForMailTag(routines, "bot_a", "shop").map((row) => row.id)).toEqual(["r-shop"]);
    expect(routinesForMailTag(routines, "bot_a", "unknown")).toEqual([]);
    expect(routinesForMailTag(routines, "bot_b", "reports").map((row) => row.id)).toEqual(["r-other"]);
  });

  it("plans tagged delivery for name+tag@ and untagged delivery for the plain address", () => {
    expect(planMailDelivery("cryptic+reports@bots.example.org", routines, "bot_a")).toEqual({
      kind: "tagged",
      tag: "reports",
      routineIds: ["r-reports"],
    });
    expect(planMailDelivery("cryptic+unknown@bots.example.org", routines, "bot_a")).toEqual({
      kind: "tagged",
      tag: "unknown",
      routineIds: [],
    });
    expect(planMailDelivery("cryptic@bots.example.org", routines, "bot_a")).toEqual({ kind: "untagged" });
  });

  it("builds the settings rows for tag routing without leaking another bot's routines", () => {
    expect(tagRoutingRows(routines, "bot_a", "cryptic@bots.example.org")).toEqual([
      { tag: "reports", address: "cryptic+reports@bots.example.org", routineId: "r-reports", routineName: "Reports", enabled: true },
      { tag: "shop", address: "cryptic+shop@bots.example.org", routineId: "r-shop", routineName: "Shop", enabled: true },
      { tag: "reports", address: "cryptic+reports@bots.example.org", routineId: "r-off", routineName: "Off", enabled: false },
      { tag: "shop", address: "cryptic+shop@bots.example.org", routineId: "r-paused", routineName: "Paused", enabled: false },
    ]);
    expect(tagRoutingRows(routines, "bot_b", "other@bots.example.org").map((row) => row.routineId)).toEqual(["r-other"]);
  });
});
