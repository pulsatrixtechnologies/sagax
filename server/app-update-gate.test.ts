// The app's minimum version (owner 2026-11-26, D-20261126-004): an app older
// than 0.8.173 draws the default owl for a bot whose look uses the new keys
// (material, mood, eyes, depth), so it is asked to update before it goes on.
// An installed app cannot receive new code: the only place that can ask is
// the server, with the words every app already shows for a send it refused.
import { describe, expect, it } from "vitest";

import { APP_VERSION_HEADER, IOS_LAST_BUILD_BELOW_MINIMUM, MINIMUM_APP_VERSION, appUpdateRefusal, compareReleases, requestApp } from "./app-update-gate.ts";

const desktop = (version: string, name = "openmausbot") =>
  `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ${name}/${version} Chrome/142.0.0.0 Electron/39.2.0 Safari/537.36`;
const windows = (version: string) =>
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Sagax/${version} Chrome/142.0.0.0 Electron/39.2.0 Safari/537.36`;
const phone = (build: number) => `Sagax/${build} CFNetwork/3860.100.1 Darwin/25.0.0`;
const send = (headers: Record<string, string>, path = "/api/bots/b1/messages", method = "POST") => appUpdateRefusal({ method, path, headers, baseVersion: () => "0.1.107" });

describe("which app a request comes from", () => {
  it("reads the desktop app's release from its User-Agent, under either name", () => {
    expect(requestApp({ "user-agent": desktop("0.8.172") })).toEqual({ family: "desktop", version: "0.8.172" });
    expect(requestApp({ "user-agent": windows("0.8.173") })).toEqual({ family: "desktop", version: "0.8.173" });
  });

  it("reads the phone's build from its User-Agent, and its release from the header a newer phone sends", () => {
    expect(requestApp({ "user-agent": phone(234) })).toEqual({ family: "ios", build: 234 });
    expect(requestApp({ "user-agent": phone(260), [APP_VERSION_HEADER]: "0.8.174" })).toEqual({ family: "ios", version: "0.8.174", build: 260 });
  });

  it("knows nothing of a browser, a script, a bot's own call or an AI client", () => {
    for (const agent of [undefined, "", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15", "node", "curl/8.7.1", "okhttp/4.12.0"]) {
      expect(requestApp(agent === undefined ? {} : { "user-agent": agent })).toBeNull();
    }
  });

  it("compares releases by their numbers", () => {
    expect(compareReleases("0.8.172", "0.8.173")).toBeLessThan(0);
    expect(compareReleases("0.8.173", "0.8.173")).toBe(0);
    expect(compareReleases("0.9.0", "0.8.173")).toBeGreaterThan(0);
    expect(compareReleases("0.8.1000", "0.8.173")).toBeGreaterThan(0);
  });
});

describe("an app older than the minimum is asked to update before it goes on", () => {
  it("the minimum is 0.8.173; 0.8.172 was the phone's build 234", () => {
    expect(MINIMUM_APP_VERSION).toBe("0.8.173");
    expect(IOS_LAST_BUILD_BELOW_MINIMUM).toBe(234);
  });

  it("refuses a message from an older desktop app, in words the app shows as they are", () => {
    const refusal = send({ "user-agent": desktop("0.8.172") })!;
    expect(refusal.status).toBe(426);
    expect(refusal.body).toMatchObject({ code: "app_update_required", minimumVersion: "0.8.173", appVersion: "0.8.172" });
    expect(refusal.body.error).toBe("Update Sagax to continue: this version (0.8.172) is too old for this server, which needs 0.8.173 or newer. Open your account menu, then Help, then Check for updates.");
    // a sentence, never a status or a code: the app's error line shows it whole
    expect(refusal.body.error).not.toMatch(/426|app_update_required/);
    expect(send({ "user-agent": windows("0.8.90") })?.status).toBe(426);
    expect(send({ "user-agent": desktop("0.8.172") }, "/api/groups/g1/messages")?.status).toBe(426);
  });

  it("answers in the app's language", () => {
    const refusal = send({ "user-agent": desktop("0.8.172"), "x-sagax-locale": "fr" })!;
    expect(refusal.body.error).toBe("Mets Sagax à jour pour continuer : cette version (0.8.172) est trop vieille pour ce serveur, qui demande la 0.8.173 ou plus récente. Ouvre le menu de ton compte, puis Aide, puis Rechercher des mises à jour.");
    expect(send({ "user-agent": phone(234), "accept-language": "fr-CA,fr;q=0.9" })!.body.error).toBe("Mets Sagax à jour pour continuer : cette version est trop vieille pour ce serveur, qui demande la 0.8.173 ou plus récente. Mets-la à jour dans l'App Store ou TestFlight.");
  });

  it("refuses a message from an older phone or iPad, by its build", () => {
    const refusal = send({ "user-agent": phone(234) })!;
    expect(refusal.status).toBe(426);
    expect(refusal.body.error).toBe("Update Sagax to continue: this version is too old for this server, which needs 0.8.173 or newer. Update it in the App Store or TestFlight.");
    expect(send({ "user-agent": phone(120) })?.status).toBe(426);
  });

  it("lets through the minimum and anything newer", () => {
    expect(send({ "user-agent": desktop("0.8.173") })).toBeNull();
    expect(send({ "user-agent": desktop("0.8.174") })).toBeNull();
    expect(send({ "user-agent": desktop("0.9.0") })).toBeNull();
    expect(send({ "user-agent": phone(235) })).toBeNull();
    // a newer phone names its release itself: the build table is not needed
    expect(send({ "user-agent": phone(1), [APP_VERSION_HEADER]: "0.8.174" })).toBeNull();
    expect(send({ "user-agent": phone(900), [APP_VERSION_HEADER]: "0.8.172" })?.status).toBe(426);
  });

  it("never holds what it cannot name: a browser, a script, a bot's own send, a development build", () => {
    expect(send({})).toBeNull();
    expect(send({ "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36" })).toBeNull();
    expect(send({ "user-agent": "node" })).toBeNull();
    // a checkout's desktop app runs at the base version, the server's own
    expect(send({ "user-agent": desktop("0.1.107") })).toBeNull();
    expect(send({ "user-agent": desktop("not.a.version") })).toBeNull();
  });

  it("holds only what the person sends: reading, signing in, settings and stopping go on", () => {
    const old = { "user-agent": desktop("0.8.172") };
    expect(send(old, "/api/bots/b1/messages", "GET")).toBeNull();
    expect(send(old, "/api/bots?messages=80", "GET")).toBeNull();
    expect(send(old, "/api/auth/session", "GET")).toBeNull();
    expect(send(old, "/api/bots/b1/interrupt")).toBeNull();
    expect(send(old, "/api/me/preferences", "PUT")).toBeNull();
    expect(send(old, "/api/bots/b1/messages/guarded")?.status).toBe(426);
  });
});
