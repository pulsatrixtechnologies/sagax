// @vitest-environment happy-dom
// 2026-11-03 (audit N-5): the Memory rail's selection was one key for the
// whole browser: on a shared one, the next person inherited it (an empty
// view). It is now kept per person, All when none is known.
import { beforeEach, expect, it } from "vitest";
import { memoryScopeKey, readMemoryScope, writeMemoryScope } from "./MemoryManagerPanel";

beforeEach(() => localStorage.clear());

it("keeps each person's selection under their own key, and gives the next person All", () => {
  const ada = memoryScopeKey("pr_ada");
  const bob = memoryScopeKey("pr_bob");
  expect(ada).not.toBe(bob);
  writeMemoryScope(ada, "map", { kind: "folder", tier: "me", folder: "clients" } as never);
  expect(readMemoryScope(ada)).toEqual({ view: "map", place: { kind: "folder", tier: "me", folder: "clients" } });
  expect(readMemoryScope(bob)).toEqual({ view: "notes", place: { kind: "all" } });
});

it("a person never reads the selection kept without one (solo) or by someone else", () => {
  writeMemoryScope(memoryScopeKey(null), "tags", { kind: "trash" } as never);
  expect(memoryScopeKey(null)).toBe("sagax.memory.scope");
  expect(memoryScopeKey("  ")).toBe("sagax.memory.scope");
  expect(readMemoryScope(memoryScopeKey(null))).toEqual({ view: "tags", place: { kind: "trash" } });
  expect(readMemoryScope(memoryScopeKey("pr_ada"))).toEqual({ view: "notes", place: { kind: "all" } });
});
