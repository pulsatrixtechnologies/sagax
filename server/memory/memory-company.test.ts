// #1375: company memory is bounded like MEMORY.md, and a turn never reads
// company.md itself: a cache read in the background answers it.
import { describe, expect, it } from "vitest";

import { COMPANY_MAX_BYTES, COMPANY_MAX_LINES, COMPANY_TRUNCATED_NOTE, CompanyMemoryCache, companyTextForBots } from "./memory-company.ts";

const bots = [{ id: "a", ownerKey: "pr_owner" }, { id: "b", ownerKey: "PR_Owner " }, { id: "x", ownerKey: "pr_other" }];

describe("companyTextForBots", () => {
  it("keeps the owner's bots only, without person lines or duplicates", () => {
    const files: Record<string, string> = { a: "- Fiscal year ends in October.\n- Fiscal year ends in October.", b: "- The office opens at 8.", x: "- Other member's note." };
    const text = companyTextForBots({ ownerKey: "pr_owner", bots, read: (id) => files[id] });
    expect(text).toBe("- Fiscal year ends in October.\n- The office opens at 8.");
  });

  it("stops at the line budget and says so", () => {
    const many = Array.from({ length: COMPANY_MAX_LINES + 50 }, (_, i) => `- Fact number ${i}.`).join("\n");
    const text = companyTextForBots({ ownerKey: "pr_owner", bots, read: (id) => (id === "a" ? many : id === "b" ? "- Late fact." : null) });
    const lines = text.split("\n");
    expect(lines).toHaveLength(COMPANY_MAX_LINES + 1);
    expect(lines.at(-1)).toBe(COMPANY_TRUNCATED_NOTE);
    expect(text).not.toContain("Late fact");
  });

  it("stops at the byte budget on a whole line", () => {
    const long = Array.from({ length: 40 }, (_, i) => `- ${String(i).padStart(3, "0")} ${"é".repeat(600)}`).join("\n");
    const text = companyTextForBots({ ownerKey: "pr_owner", bots, read: (id) => (id === "a" ? long : null) });
    const facts = text.split("\n").slice(0, -1).join("\n");
    expect(Buffer.byteLength(facts, "utf8")).toBeLessThanOrEqual(COMPANY_MAX_BYTES);
    expect(text.endsWith(COMPANY_TRUNCATED_NOTE)).toBe(true);
    for (const line of text.split("\n").slice(0, -1)) expect(line.endsWith("é")).toBe(true);
  });
});

describe("CompanyMemoryCache", () => {
  const setup = (files: Record<string, string | null>) => {
    let now = 0;
    const reads: string[] = [];
    const cache = new CompanyMemoryCache({
      read: async (id) => { reads.push(id); return files[id] ?? null; },
      refreshMs: 1_000,
      now: () => now,
    });
    return { cache, reads, files, tick: (ms: number) => { now += ms; } };
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("never reads on get: a cold bot is empty for that turn and is read in the background", async () => {
    const { cache, reads } = setup({ a: "- Fact." });
    expect(cache.get("a")).toBeNull();
    expect(reads).toEqual(["a"]);
    await settle();
    expect(cache.get("a")).toBe("- Fact.");
    expect(reads).toEqual(["a"]);
  });

  it("warms ahead of the first turn", async () => {
    const { cache } = setup({ a: "- A.", b: "- B." });
    await cache.warm(["a", "b"]);
    expect(cache.get("a")).toBe("- A.");
    expect(cache.get("b")).toBe("- B.");
  });

  it("refreshes a server-side write at once, and an outside edit after the refresh delay", async () => {
    const { cache, reads, files, tick } = setup({ a: "- Old." });
    await cache.warm(["a"]);
    files.a = "- New.";
    cache.written("a", "procedures.md");
    await settle();
    expect(cache.get("a")).toBe("- Old.");
    cache.written("a", "company.md");
    await settle();
    expect(cache.get("a")).toBe("- New.");
    files.a = "- Edited by the bot.";
    tick(500);
    expect(cache.get("a")).toBe("- New.");
    tick(600);
    // stale: answered from memory, read again behind
    expect(cache.get("a")).toBe("- New.");
    await settle();
    expect(cache.get("a")).toBe("- Edited by the bot.");
    expect(reads.filter((id) => id === "a").length).toBe(3);
  });

  it("keeps the latest read when a write lands during a slower one", async () => {
    let release: (text: string) => void = () => {};
    let call = 0;
    const cache = new CompanyMemoryCache({
      read: (id) => (++call === 1 ? new Promise((resolve) => { release = resolve; }) : Promise.resolve(`- Written ${id}.`)),
    });
    expect(cache.get("a")).toBeNull();
    cache.written("a", "company.md");
    await settle();
    expect(cache.get("a")).toBe("- Written a.");
    release("- Stale.");
    await settle();
    expect(cache.get("a")).toBe("- Written a.");
  });

  it("shows nothing for a file it cannot read", async () => {
    const cache = new CompanyMemoryCache({ read: async () => { throw new Error("locked"); } });
    await cache.warm(["a"]);
    expect(cache.get("a")).toBeNull();
  });
});
