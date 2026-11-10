// #3423: the person's proactive choices on disk.
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseChoiceChange, parsePersonChoices } from "../../shared/proactive-choices.ts";
import { ProactiveChoices, watchMovedLine, watchPauseLine } from "./proactive-choices.ts";

describe("the person's proactive choices (#3423)", () => {
  it("absent is off: a person with no row has chosen nothing", () => {
    const store = new ProactiveChoices();
    expect(store.get("person-1")).toEqual({ domains: {} });
    expect(store.chosen()).toEqual([]);
  });

  it("a yes names one bot per domain, covers the domain's reads, and records how and by whom", () => {
    const store = new ProactiveChoices(undefined, () => 1_000);
    store.apply("Person-1", { domain: "service", state: "on", botId: "b1", via: "settings" }, "person-1");
    expect(store.get("person-1").domains.service).toEqual({ state: "on", botId: "b1", coversReads: true, at: 1_000, via: "settings", by: "person-1" });
    // the same domain on another bot moves it: never two bots for one domain
    store.apply("person-1", { domain: "service", state: "on", botId: "b2", via: "words" }, "person-1");
    expect(store.chosen()).toEqual([{ person: "person-1", domains: [{ domain: "service", botId: "b2", watchesOff: [] }] }]);
  });

  it("off and never stop the domain; a watch switched off stays off inside a domain that is on", () => {
    const store = new ProactiveChoices();
    store.apply("person-1", { domain: "service", state: "on", botId: "b1", via: "card" }, "person-1");
    store.stopWatch("person-1", "service", "w-open");
    expect(store.chosen()[0]!.domains[0]!.watchesOff).toEqual(["w-open"]);
    store.apply("person-1", { domain: "service", watch: "w-open", on: true, via: "settings" }, "person-1");
    expect(store.chosen()[0]!.domains[0]!.watchesOff).toEqual([]);
    store.apply("person-1", { domain: "service", state: "never", via: "card" }, "person-1");
    expect(store.chosen()).toEqual([]);
    expect(store.get("person-1").domains.service?.state).toBe("never");
  });

  it("is kept on disk, mode 0600, and read back whole", () => {
    const dir = mkdtempSync(join(tmpdir(), "proactive-choices-"));
    try {
      const file = join(dir, "proactive-choices.json");
      const store = new ProactiveChoices(file, () => 5);
      store.apply("person-1", { domain: "backup", state: "on", botId: "b1", via: "settings" }, "person-1");
      store.noteAsk("person-1", { domain: "backup", botId: "b1", at: 5, answer: "yes", answeredAt: 6 });
      expect(statSync(file).mode & 0o777).toBe(0o600);
      const again = new ProactiveChoices(file);
      expect(again.get("person-1")).toEqual(store.get("person-1"));
      expect(again.get("person-1").firstAskedAt).toBe(5);
      expect(JSON.parse(readFileSync(file, "utf8")).people["person-1"].domains.backup.botId).toBe("b1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a deleted carrying bot hands its domains to the person's main bot, else keeps them (they pause)", () => {
    const store = new ProactiveChoices();
    store.apply("person-1", { domain: "service", state: "on", botId: "b1", via: "settings" }, "person-1");
    store.apply("person-2", { domain: "service", state: "on", botId: "b9", via: "settings" }, "person-2");
    expect(store.botGone("b1", (person) => (person === "person-1" ? "main" : undefined))).toEqual([{ person: "person-1", botId: "main", domains: ["service"] }]);
    expect(store.get("person-1").domains.service?.botId).toBe("main");
    expect(store.botGone("b9", () => undefined)).toEqual([]);
    expect(store.get("person-2").domains.service?.botId).toBe("b9");
  });

  it("a stored row that does not match is dropped, never read as a yes", () => {
    expect(parsePersonChoices({ domains: { service: { state: "proactive", botId: "b1", at: 1, via: "settings", by: "x" } } })).toEqual({ domains: {} });
    expect(parsePersonChoices({ domains: { service: { state: "on", botId: "b1" } } })).toEqual({ domains: {} });
  });

  it("the change body: a domain state or one watch", () => {
    expect(parseChoiceChange({ domain: "service", state: "on", botId: "b1" })).toEqual({ ok: true, change: { domain: "service", state: "on", botId: "b1", via: "settings" } });
    expect(parseChoiceChange({ domain: "service", watch: "w-open", on: false, via: "alert" })).toEqual({ ok: true, change: { domain: "service", watch: "w-open", on: false, via: "alert" } });
    expect(parseChoiceChange({ domain: "service", state: "maybe" }).ok).toBe(false);
    expect(parseChoiceChange({ state: "on" }).ok).toBe(false);
    expect(parseChoiceChange({ domain: "service", state: "on", via: "default" }).ok).toBe(false);
  });

  it("the pause and move lines say the cause, in the person's language, without dashes", () => {
    const fr = watchPauseLine("Sauvegardes", "no-watch", "fr");
    expect(fr).toContain("Veille Sauvegardes en pause");
    expect(watchPauseLine("Backups", "bot-gone", "en")).toBe("Watch Backups paused: this bot is gone. It resumes by itself.");
    expect(watchMovedLine(["service"], "fr")).toContain("je la porte maintenant");
    expect(watchPauseLine("backups", "unknown-domain", "en")).toBe("Watch backups paused: the organization has no watch by that name. Ask any of your bots for the domains you can choose.");
    expect(watchPauseLine("backups", "unknown-domain", "fr")).not.toMatch(/[–—]|reprend/);
    for (const line of [fr, watchMovedLine(["service"], "en")]) expect(line).not.toMatch(/[–—]/);
  });
});
