// #3513: notifications.proactiveChoices read whole by a bot: the choices and
// the asks first, then the domains a page at a time, never cut mid-domain.
import { describe, expect, it } from "vitest";

import { pageProactiveChoices, PROACTIVE_ASKS_SHOWN } from "./proactive-choices-page.ts";
import { settingSpec } from "./settings-actions.ts";

const AT = Date.UTC(2026, 10, 10, 15, 0);

/** A listing like the organization server's: 14 domains, up to 11 watches each. */
function answer() {
  const available = Array.from({ length: 14 }, (_, d) => ({
    domain: `domain-${d}`, label: { fr: `Domaine ${d}`, en: `Domain ${d}` }, audience: { en: "people who follow it" }, eligible: false,
    watches: Array.from({ length: 1 + (d % 11) }, (_, w) => ({
      id: `d${d}-w${w}`, summary: `Watch ${w} of domain ${d}: something the person may want to hear about, said in one plain sentence.`, cadence: "15m",
      products: ["connectwise"], runs: false, missing: "skill", lacking: [`skill-${d}`], tools: ["cw_psa_service_query", "cw_psa_service_tickets_write", "api_search"],
    })),
  }));
  return {
    domains: { "domain-1": { state: "never", at: AT, via: "card", by: "person-1" } },
    asks: [{ domain: "domain-1", botId: "main", at: AT, proposalId: "p1", answer: "never", answeredAt: AT + 60_000 }],
    firstAskedAt: AT, asked: { main: AT },
    available, botId: "main",
  };
}

describe("notifications.proactiveChoices, read whole (#3513)", () => {
  it("the first page carries the choices and what was asked, and when, before the domains", () => {
    const page = pageProactiveChoices(answer(), undefined) as Record<string, unknown>;
    expect(Object.keys(page).slice(0, 4)).toEqual(["choices", "firstQuestionAt", "firstQuestionByBot", "asks"]);
    expect(page).toMatchObject({
      choices: { "domain-1": { state: "never" } },
      firstQuestionAt: "2026-11-10T15:00:00.000Z",
      firstQuestionByBot: { main: "2026-11-10T15:00:00.000Z" },
      asks: [{ domain: "domain-1", botId: "main", at: "2026-11-10T15:00:00.000Z", answer: "never", answeredAt: "2026-11-10T15:01:00.000Z" }],
      total: 14, offset: 0,
    });
  });

  it("every page is whole JSON under the read's limit, and the pages together hold every domain and watch", () => {
    const whole = answer();
    const limit = settingSpec("notifications.proactiveChoices")!.read!({}).maxChars!;
    const seen: string[] = [];
    let offset: number | null = 0;
    let pages = 0;
    while (offset !== null) {
      const page = pageProactiveChoices(whole, { offset }) as { available: Array<{ domain: string; watches: Array<{ id: string; tools?: unknown }> }>; nextOffset: number | null; next?: string };
      const text = JSON.stringify(page);
      expect(text.length).toBeLessThan(limit);
      expect(JSON.parse(text)).toEqual(page);
      for (const row of page.available) {
        seen.push(row.domain);
        expect(row.watches).toHaveLength(whole.available.find((domain) => domain.domain === row.domain)!.watches.length);
        expect(row.watches[0]).not.toHaveProperty("tools");
      }
      if (page.nextOffset !== null) expect(page.next).toContain(`{"offset": ${page.nextOffset}}`);
      offset = page.nextOffset;
      pages += 1;
    }
    expect(pages).toBeGreaterThan(1);
    expect(seen).toEqual(whole.available.map((row) => row.domain));
  });

  it("the settings read shapes the answer as a page, the offset taken from the get's value", () => {
    const read = settingSpec("notifications.proactiveChoices")!.read!({}, { offset: 3 });
    const page = read.shape!(answer(), { offset: 3 }) as { offset: number; choices?: unknown; available: Array<{ domain: string }> };
    expect(page.offset).toBe(3);
    expect(page.choices).toBeUndefined();
    expect(page.available[0]?.domain).toBe("domain-3");
  });

  it("a long ledger shows its last asks and says how many there are", () => {
    const whole = { ...answer(), asks: Array.from({ length: 30 }, (_, i) => ({ domain: `domain-${i % 14}`, botId: "main", at: AT + i })) };
    const page = pageProactiveChoices(whole, 0) as { asks: Array<{ answer: string }>; asksTotal: number };
    expect(page.asks).toHaveLength(PROACTIVE_ASKS_SHOWN);
    expect(page.asks[0]?.answer).toBe("waiting");
    expect(page.asksTotal).toBe(30);
  });
});
