// The /pair page's hash: a typed pairing code, and the credential the
// desktop app hands back from "Sign in with Pulsatrix" (#code=<c>&auto=1).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { parsePairingHash, takePairingFromLocation } from "@/lib/session";
import { markSignInCredentialSpent } from "@/lib/session";
import { BrowserSignInWaiting, PairPage, browserSignInErrorText, finishReturnedSignIn, pairVersionText, returnedCredentialRefused, signInErrorText } from "./PairPage";
import type { EnvironmentDescriptor } from "@/lib/session";

const CREDENTIAL = `omb_pair_${"A1b2_C3d4-".repeat(4)}xyz`;

afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

describe("sign-in errors (slice 6, fix 2)", () => {
  it("says Sagax Business is busy on a rate limit, in English and Quebec French", () => {
    expect(signInErrorText("rate_limited")).toBe("Sagax Business is busy right now. Wait a minute and try again.");
    setLocale("fr");
    expect(signInErrorText("rate_limited")).toBe("Sagax Business est occupé en ce moment. Attends une minute et réessaye.");
  });
});

describe("the desktop app's browser sign-in", () => {
  it("waits with Cancel and Reopen the browser, in English and Quebec French", () => {
    const html = renderToStaticMarkup(createElement(BrowserSignInWaiting, { onCancel: () => {}, onReopen: () => {} }));
    expect(html).toContain("Finish signing in in your browser.");
    expect(html).toContain(">Cancel<");
    expect(html).toContain(">Reopen the browser<");
    setLocale("fr");
    const fr = renderToStaticMarkup(createElement(BrowserSignInWaiting, { onCancel: () => {}, onReopen: () => {} }));
    expect(fr).toContain(">Annuler<");
    expect(fr).toContain(">Rouvrir le navigateur<");
  });

  it("says why it stopped", () => {
    expect(browserSignInErrorText("timeout")).toMatch(/took too long/);
    expect(browserSignInErrorText("unsupported")).toMatch(/update the server/);
    expect(browserSignInErrorText("browser")).toMatch(/browser could not be opened/);
    expect(browserSignInErrorText("unreachable")).toMatch(/could not be reached/);
    expect(browserSignInErrorText("other")).toBe("Sign-in did not finish. Try again.");
    expect(signInErrorText("return")).toMatch(/cannot come back to the app/);
  });
});

describe("the pairing hash", () => {
  it("reads a typed code, and never auto-submits it", () => {
    expect(parsePairingHash("#code=ABCD-EFGH-JKLM")).toEqual({ code: "ABCD-EFGH-JKLM", auto: false });
    expect(parsePairingHash("#code=ABCD-EFGH-JKLM&auto=1")).toEqual({ code: "ABCD-EFGH-JKLM", auto: false });
    expect(parsePairingHash("")).toEqual({ code: null, auto: false });
  });

  it("keeps a sign-in credential verbatim and auto-submits it only with auto=1", () => {
    expect(CREDENTIAL).toMatch(/^omb_pair_[A-Za-z0-9_-]{43}$/);
    expect(parsePairingHash(`#code=${CREDENTIAL}&auto=1`)).toEqual({ code: CREDENTIAL, auto: true });
    expect(parsePairingHash(`#code=${CREDENTIAL}`)).toEqual({ code: CREDENTIAL, auto: false });
    expect(parsePairingHash(`#code=${CREDENTIAL}&auto=10`)).toEqual({ code: CREDENTIAL, auto: false });
    expect(parsePairingHash(`#code=${CREDENTIAL}x&auto=1`).auto).toBe(false);
    expect(parsePairingHash("#code=%E0%A4%A&auto=1")).toEqual({ code: null, auto: false });
  });

  it("drops the code from the address bar once read", () => {
    const replaceState = vi.fn();
    const got = takePairingFromLocation({ hash: `#code=${CREDENTIAL}&auto=1`, pathname: "/pair", search: "" }, { replaceState });
    expect(got).toEqual({ code: CREDENTIAL, auto: true });
    expect(replaceState).toHaveBeenCalledWith(null, "", "/pair");
  });

  it("shows the finishing state while a returned credential is redeemed in the desktop app", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    vi.stubGlobal("location", { hash: "", pathname: "/pair", search: "" });
    vi.stubGlobal("navigator", { userAgent: "test" });
    vi.stubGlobal("window", { ogb: { platform: "darwin", takeSignInReturn: async () => true } });
    const html = renderToStaticMarkup(createElement(PairPage, { initialCode: CREDENTIAL, autoSubmit: true }));
    expect(html).toContain("data-testid=\"connection-sign-in\"");
    expect(html).toContain("Sagax Business");
    expect(html).not.toContain("pair-code");
    const form = renderToStaticMarkup(createElement(PairPage, { initialCode: "ABCD-EFGH-JKLM" }));
    expect(form).toContain("pair-code");
    expect(form).not.toContain("Finishing sign-in...");
  });

  it("a plain browser opening #code=<credential>&auto=1 shows the form and never redeems it on its own", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    vi.stubGlobal("location", { hash: "", pathname: "/pair", search: "" });
    vi.stubGlobal("navigator", { userAgent: "test" });
    vi.stubGlobal("window", {});
    const html = renderToStaticMarkup(createElement(PairPage, { initialCode: CREDENTIAL, autoSubmit: true }));
    expect(html).not.toContain("Finishing sign-in...");
    expect(html).toContain("pair-code");
    const pair = vi.fn(async () => ({ ok: true as const }));
    expect(await finishReturnedSignIn({ code: CREDENTIAL, bridge: undefined, pair })).toBe("ask");
    expect(pair).not.toHaveBeenCalled();
    // a remote page's bridge without the handoff (an older app) asks too
    expect(await finishReturnedSignIn({ code: CREDENTIAL, bridge: {}, pair })).toBe("ask");
    expect(pair).not.toHaveBeenCalled();
  });

  it("the desktop app redeems a returned credential only when its main process handed that exact one over", async () => {
    const pair = vi.fn(async () => ({ ok: true as const }));
    const refused = vi.fn(async () => false);
    expect(await finishReturnedSignIn({ code: CREDENTIAL, bridge: { takeSignInReturn: refused }, pair })).toBe("ask");
    expect(refused).toHaveBeenCalledWith(CREDENTIAL);
    expect(pair).not.toHaveBeenCalled();
    const broken = vi.fn(async () => { throw new Error("no handler"); });
    expect(await finishReturnedSignIn({ code: CREDENTIAL, bridge: { takeSignInReturn: broken }, pair })).toBe("ask");
    expect(pair).not.toHaveBeenCalled();
    const handed = vi.fn(async () => true);
    expect(await finishReturnedSignIn({ code: CREDENTIAL, bridge: { takeSignInReturn: handed }, pair })).toEqual({ ok: true });
    expect(pair).toHaveBeenCalledTimes(1);
  });
});

describe("the sign-in page speaks one language (S7 minor)", () => {
  it("draws the code form in Quebec French with no English left", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    vi.stubGlobal("location", { hash: "", pathname: "/pair", search: "" });
    vi.stubGlobal("navigator", { userAgent: "test" });
    vi.stubGlobal("window", {});
    setLocale("fr");
    const html = renderToStaticMarkup(createElement(PairPage, { initialCode: "ABCD-EFGH-JKLM" }));
    expect(html).toContain("Connecter à ce Sagax");
    expect(html).toContain("Code de jumelage");
    expect(html).toContain("Cet appareil");
    for (const english of ["Connect to", "Pairing code", "This device", "Enter the pairing code"]) expect(html).not.toContain(english);
  });
});

describe("a returned credential the server refused (2026-10-13, older server spent it)", () => {
  it("counts only a 401 on a sign-in credential as spent", () => {
    expect(returnedCredentialRefused(CREDENTIAL, { ok: false, status: 401 })).toBe(true);
    expect(returnedCredentialRefused(CREDENTIAL, { ok: false, status: 429 })).toBe(false);
    expect(returnedCredentialRefused(CREDENTIAL, { ok: false })).toBe(false);
    expect(returnedCredentialRefused(CREDENTIAL, { ok: true })).toBe(false);
    expect(returnedCredentialRefused("ABCD-EFGH-JKLM", { ok: false, status: 401 })).toBe(false);
  });

  it("a reload with a spent credential neither redeems nor prefills it, and says to sign in again", () => {
    const stored = new Map<string, string>();
    vi.stubGlobal("sessionStorage", { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v) });
    markSignInCredentialSpent(CREDENTIAL);
    const fetchSpy = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("location", { hash: "", pathname: "/pair", search: "" });
    vi.stubGlobal("navigator", { userAgent: "test" });
    const take = vi.fn(async () => true);
    vi.stubGlobal("window", { ogb: { platform: "darwin", takeSignInReturn: take } });
    const html = renderToStaticMarkup(createElement(PairPage, { initialCode: CREDENTIAL, autoSubmit: true }));
    expect(html).not.toContain("data-testid=\"connection-sign-in\"");
    expect(html).not.toContain(CREDENTIAL);
    expect(html).toContain("This sign-in was already used or has expired. Sign in again with Sagax Business.");
    expect(take).not.toHaveBeenCalled();
    setLocale("fr");
    const fr = renderToStaticMarkup(createElement(PairPage, { initialCode: CREDENTIAL, autoSubmit: true }));
    expect(fr).toContain("Cette connexion a déjà servi ou a expiré. Reconnecte-toi avec Sagax Business.");
  });
});

describe("the version on the sign-in page (#3260)", () => {
  const base: EnvironmentDescriptor = { environmentId: "env", label: "Example", platform: "linux", version: "0.1.107", capabilities: { remoteSessions: true, selfUpdate: "operator" } };

  it("shows the Sagax release, not the base version, in English and Quebec French", () => {
    const environment = { ...base, release: "0.8.81" };
    expect(pairVersionText(environment)).toBe("Version 0.8.81 on linux.");
    setLocale("fr");
    expect(pairVersionText(environment)).toBe("Version 0.8.81 sur linux.");
  });

  it("falls back on the version of a server that sends no release", () => {
    expect(pairVersionText(base)).toBe("Version 0.1.107 on linux.");
    expect(pairVersionText({ ...base, release: "  " })).toBe("Version 0.1.107 on linux.");
  });
});
