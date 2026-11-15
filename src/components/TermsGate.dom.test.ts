// @vitest-environment happy-dom
// #4360: the first-run terms say nothing about reports, blocking or admins to
// a person alone on a server with no organization; an organization server
// keeps its wording.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({ org: null as unknown }));

vi.mock("@/lib/moderation", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/moderation")>(),
  fetchTerms: async () => ({ accepted: false, current: "1", url: "https://example.test/terms" }),
  acceptTerms: vi.fn(),
}));
vi.mock("@/lib/perspicax-org", () => ({ loadPerspicaxOrg: async () => fixture.org }));
vi.mock("@/lib/app-links", () => ({ openExternalLink: vi.fn() }));
vi.mock("@/state/store-selector", () => ({
  useStoreSelector: (select: (state: { config: unknown }) => unknown) => select({ config: { viewer: { principalId: "p1", email: "a@example.test" } } }),
}));

import { TermsGate } from "./TermsGate";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  fixture.org = null;
  setLocale("en");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  setLocale("en");
});

async function mount() {
  await act(async () => { root.render(createElement(TermsGate)); });
  await act(async () => { await Promise.resolve(); });
  return document.body.textContent ?? "";
}

describe("TermsGate (#4360)", () => {
  it("names no reports, blocking or admins for a person alone", async () => {
    const text = await mount();
    expect(text).toContain("Terms of use");
    expect(text).toContain("There is zero tolerance for objectionable or abusive content.");
    expect(text).not.toContain("report");
    expect(text).not.toContain("block a person");
    expect(text).not.toContain("admins");
  });

  it("keeps the organization wording on an organization server", async () => {
    fixture.org = { org: { identity: { kind: "perspicax" } } };
    const text = await mount();
    expect(text).toContain("Anyone can report a message or block a person, and the admins review every report.");
  });

  it("speaks French to a person alone", async () => {
    setLocale("fr");
    const text = await mount();
    expect(text).toContain("Il y a une tolérance zéro pour le contenu répréhensible ou abusif.");
    expect(text).not.toContain("administrateurs");
  });
});
