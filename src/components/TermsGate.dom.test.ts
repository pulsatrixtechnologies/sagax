// @vitest-environment happy-dom
// #4360: the first-run terms say nothing about reports, blocking or admins to
// a person alone on their server (src/lib/server-alone.ts); a server with
// other people, organization or not, keeps its wording.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({ alone: true, accepted: false, asked: [] as boolean[] }));

vi.mock("@/lib/moderation", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/moderation")>(),
  fetchTerms: async () => ({ accepted: fixture.accepted, current: "1", url: "https://example.test/terms" }),
  acceptTerms: vi.fn(),
}));
vi.mock("@/lib/server-alone", () => ({ loadServerAlone: async (admin: boolean) => { fixture.asked.push(admin); return fixture.alone; } }));
vi.mock("@/lib/app-links", () => ({ openExternalLink: vi.fn() }));
vi.mock("@/state/store-selector", () => ({
  useStoreSelector: (select: (state: { config: unknown }) => unknown) => select({ config: { viewer: { principalId: "p1", email: "a@example.test", role: "owner" } } }),
}));

import { TermsGate } from "./TermsGate";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  fixture.alone = true;
  fixture.accepted = false;
  fixture.asked = [];
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
    expect(fixture.asked).toEqual([true]);
  });

  it("keeps the report wording on a server with other people (organization or not)", async () => {
    fixture.alone = false;
    const text = await mount();
    expect(text).toContain("Anyone can report a message or block a person, and the admins review every report.");
  });

  it("asks the server nothing more once the terms are accepted (no request on every launch)", async () => {
    fixture.accepted = true;
    const text = await mount();
    expect(text).not.toContain("Terms of use");
    expect(fixture.asked).toEqual([]);
  });

  it("speaks French to a person alone", async () => {
    setLocale("fr");
    const text = await mount();
    expect(text).toContain("Il y a une tolérance zéro pour le contenu répréhensible ou abusif.");
    expect(text).not.toContain("administrateurs");
  });
});
