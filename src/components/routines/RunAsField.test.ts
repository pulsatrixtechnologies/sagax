// "Runs as" in the routine modal (owner, 2026-10-08): a dropdown for an admin
// or a team manager, the line alone for anyone else, nothing on a solo
// server.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import { RUN_AS_SEARCH_AFTER, RunAsField, runAsOptionLabel, runAsRows, type RunAsOptions } from "./RunAsField";

const ALICE = { principalId: "pr_alice", name: "Alice", selectable: true };
const BOB = { principalId: "pr_bob", name: "Bob", selectable: true, avatarUrl: "/api/people/pr_bob/avatar" };
const ERIN = { principalId: "pr_erin", name: "Erin", selectable: true, pending: true as const };
const FRANK = { principalId: "pr_frank", name: "Frank", selectable: false, reason: "no_right" as const };
const render = (options: RunAsOptions | null, value?: string) => renderToStaticMarkup(createElement(RunAsField, { options, value, onChange: () => {} }));

describe("the Runs as field", () => {
  const admin: RunAsOptions = { canChoose: true, people: [ALICE, BOB, ERIN, FRANK], current: { principalId: "pr_alice", name: "Alice" } };

  it("an admin gets a select of people, the current one chosen, someone without rights left out (#3294)", () => {
    const markup = render(admin);
    expect(markup).toContain("<select");
    expect(markup).toContain("Runs as</label>");
    expect(markup).toMatch(/<option value="pr_alice" selected="">Alice<\/option>/);
    expect(markup).not.toContain('value="pr_frank"');
    expect(markup).not.toContain('disabled=""');
    // already chosen, the row stays with its reason
    expect(render(admin, "pr_frank")).toContain("Frank (cannot run this bot&#x27;s routines)");
    expect(markup).not.toContain('type="search"');
    expect(markup).not.toContain("data-run-as-pending");
  });

  it("shows the chosen person's avatar", () => {
    expect(render(admin, "pr_bob")).toContain('src="/api/people/pr_bob/avatar"');
  });

  it("says when the chosen person has not signed in yet", () => {
    expect(render(admin, "pr_erin")).toContain("Will run once Erin signs in");
  });

  it("gets a search field when the list is long", () => {
    const many = Array.from({ length: RUN_AS_SEARCH_AFTER + 1 }, (_, index) => ({ principalId: `pr_${index}`, name: `Person ${index}`, selectable: true }));
    expect(render({ canChoose: true, people: many, current: { principalId: "pr_0", name: "Person 0" } })).toContain('type="search"');
  });

  it("a regular person sees the line only; a solo server nothing", () => {
    const markup = render({ canChoose: false, people: [], current: { principalId: "pr_bob", name: "Bob" } });
    expect(markup).toContain("Runs as Bob");
    expect(markup).not.toContain("<select");
    expect(render({ canChoose: false, people: [] })).toBe("");
    expect(render(null)).toBe("");
  });

  it("filters by name and keeps the chosen person, and a current person outside the list first", () => {
    expect(runAsRows(admin, "pr_bob", "fra").map((row) => row.principalId)).toEqual(["pr_bob"]);
    expect(runAsRows(admin, "pr_frank", "").map((row) => row.principalId)).toContain("pr_frank");
    const manager: RunAsOptions = { canChoose: true, people: [ALICE], current: { principalId: "pr_bob", name: "Bob", pending: true } };
    expect(runAsRows(manager, "pr_bob", "")).toEqual([{ principalId: "pr_bob", name: "Bob", selectable: true, pending: true }, ALICE]);
  });

  it("speaks French", () => {
    setLocale("fr");
    try {
      expect(runAsOptionLabel(FRANK)).toBe("Frank (ne peut pas exécuter les routines de ce bot)");
      expect(render(admin, "pr_erin")).toContain("S&#x27;exécutera quand Erin se connectera");
    } finally {
      setLocale("en");
    }
  });
});
