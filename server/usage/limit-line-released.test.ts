// #3577: a server is rolled before people update their apps. Every usage-limit
// line the server may write must be a kind the oldest supported app draws
// (shared/fixtures/limit-line-released-kinds.json), else that app shows an
// empty row. The plain words every row carries are only read by apps built
// after #3577.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { limitFailoverText, type LimitFailoverLine } from "../../shared/limit-failover.ts";

const released = JSON.parse(readFileSync(new URL("../../shared/fixtures/limit-line-released-kinds.json", import.meta.url), "utf8")) as { releases: Record<string, string[]> };

/** One line of each kind the type allows. A kind added to the type and not
 * here fails the typecheck; once here, the test below checks it against the
 * released apps. */
const SAMPLES: { [K in LimitFailoverLine["kind"]]: Extract<LimitFailoverLine, { kind: K }> } = {
  switched: { kind: "switched", from: "Claude", to: "Codex", resetsAt: 0 },
  back: { kind: "back", engine: "Claude" },
  waiting: { kind: "waiting", from: "Claude", resetsAt: 0 },
  waitingRoutine: { kind: "waitingRoutine", from: "Claude", resetsAt: 0 },
  exhausted: { kind: "exhausted", tried: ["Claude"], cause: "credits" },
  signedOut: { kind: "signedOut", from: "Claude", to: "Codex" },
  signedOutNotice: { kind: "signedOutNotice", from: "Claude", to: "Codex" },
};

describe("the usage-limit lines released apps can draw (#3577)", () => {
  it.each(Object.entries(released.releases))("every kind the server may write is drawn by the %s apps", (release, kinds) => {
    const unknown = Object.keys(SAMPLES).filter((kind) => !kinds.includes(kind));
    expect(unknown, `The ${release} apps draw an empty row for these kinds. Write the case as a kind they know with an optional field (as the credit case is an "exhausted" line with cause "credits"), or keep the kind off the wire until no supported app lacks it.`).toEqual([]);
  });

  it.each(Object.values(SAMPLES))("$kind carries plain words for the apps that do not know it", (line) => {
    expect(limitFailoverText(line, () => "2:05 PM").trim()).not.toBe("");
  });
});
