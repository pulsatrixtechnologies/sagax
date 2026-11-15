// @vitest-environment happy-dom
// #4360: an export refused for want of a recent sign-in says what to do, by
// mode: a linked server offers "Sign in again"; a server without an
// organization has nothing to sign in to, so it says to export from the
// desktop app, on the computer that runs it.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale, t } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({
  org: null as null | { name: string },
  againPath: null as string | null,
}));
vi.mock("@/lib/credential-vault", async (original) => ({
  ...(await original<typeof import("@/lib/credential-vault")>()),
  exportCredentials: async () => { throw Object.assign(new Error("Sign in again, then export your vault."), { body: { code: "reauth_required" } }); },
}));
vi.mock("@/lib/sign-in-again", () => ({ signInAgainPath: async () => fixture.againPath }));
vi.mock("@/lib/perspicax-org", () => ({ loadPerspicaxOrg: async () => fixture.org }));
vi.mock("@/lib/settings-return", () => ({ rememberSettingsReturn: () => {} }));

import { ExportPanel } from "./CredentialsTransfer";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  fixture.org = null;
  fixture.againPath = null;
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

async function refusedExport(): Promise<string> {
  await act(async () => { root.render(createElement(ExportPanel, { onCancel: () => {} })); });
  const scope = document.body;
  const toggle = scope.querySelector<HTMLElement>('[role="switch"], input[type="checkbox"]')!;
  await act(async () => { toggle.click(); });
  const input = scope.querySelector<HTMLInputElement>('input:not([type="checkbox"])')!;
  await act(async () => {
    const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    native.call(input, t("vault.transfer.exportWord"));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const run = scope.querySelector<HTMLButtonElement>("[data-credential-export-run]")!;
  expect(run.disabled).toBe(false);
  await act(async () => { run.click(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  return scope.querySelector("[data-credential-export-reauth]")?.textContent ?? "";
}

describe("ExportPanel refused for a recent sign-in (#4360)", () => {
  it.each(["en", "fr"])("on a solo server, says to export from the desktop app, with no sign-in (%s)", async (locale) => {
    setLocale(locale);
    const text = await refusedExport();
    expect(text).toContain(locale === "fr" ? "sur l’ordinateur qui la fait rouler" : "on the computer that runs it");
    expect(text).not.toMatch(/Pulsatrix|sign-in|connexion/i);
    expect(document.body.querySelector("[data-credential-export-sign-in]")).toBeNull();
  });
  it("on a linked server, keeps Sign in again unchanged", async () => {
    fixture.org = { name: "Org" };
    fixture.againPath = "/auth/login?fresh=1";
    const text = await refusedExport();
    expect(text).toBe("Sign in again with Pulsatrix, then export. An email code does not count.");
    expect(document.body.querySelector("[data-credential-export-sign-in]")).not.toBeNull();
  });
  it("on a linked server with no Pulsatrix sign-in, keeps its words", async () => {
    fixture.org = { name: "Org" };
    const text = await refusedExport();
    expect(text).toContain("Export from the Sagax desktop app.");
    expect(text).toContain("Pulsatrix sign-in");
  });
});
