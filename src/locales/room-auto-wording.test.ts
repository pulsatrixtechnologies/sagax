import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const english = JSON.parse(readFileSync(new URL("./en.json", import.meta.url), "utf8")) as Record<string, string>;

const ROUTING = [
  "composer.hint.auto",
  "decider.jobs.roomRoutingDetail",
  "room.responder.auto",
  "room.responder.autoOff",
  "room.responder.autoOption",
  "room.responder.jevOffHint",
  "room.responder.jevOffOpen",
  "room.hint.auto",
] as const;

describe("Auto room routing copy", () => {
  it("names the decision model, not a provider, in the shared routing lines", () => {
    for (const key of ROUTING) {
      expect(english[key], key).toBeTruthy();
      expect(english[key], key).not.toMatch(/Jev/);
      expect(english[key], key).toMatch(/decision model|^Auto$/);
    }
  });
});
