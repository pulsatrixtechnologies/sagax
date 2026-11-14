import { describe, expect, it } from "vitest";
import { CLIENT_ALLOW } from "../auth/client-allow.ts";
import { NOTIFY_CHANNELS_KEY } from "../../shared/attention-policy.ts";
import { QUIET_HOURS_KEY, readSignalPrefs, SIGNAL_BUDGET_KEY } from "../../shared/signal-levels.ts";
import { createSignalSettingsRoutes, SIGNAL_SETTINGS_PATH } from "./signal-settings.ts";
import { PASS } from "./table.ts";

function call(route: ReturnType<typeof createSignalSettingsRoutes>, input: { method: string; body?: unknown; path?: string }) {
  let answer: { status: number; body: unknown } | null = null;
  return route({
    req: { headers: { "content-type": "application/json" } } as never,
    res: {} as never, url: new URL(`http://x${input.path ?? SIGNAL_SETTINGS_PATH}`), path: input.path ?? SIGNAL_SETTINGS_PATH, method: input.method,
    auth: { kind: "loopback", scopes: ["admin"] } as never,
    json: ((_res: unknown, status: number, body: unknown) => { answer = { status, body }; }) as never,
    readBody: (async () => input.body) as never,
  }).then((out) => (out === PASS ? "PASS" : answer));
}

describe("GET and PUT /api/me/signals (#2695)", () => {
  it("keeps the budget and quiet hours on a personal computer", async () => {
    let prefs: Record<string, string> = {};
    const store = {
      get: () => prefs,
      merge: (set: Record<string, string>, remove: string[]) => {
        prefs = { ...prefs, ...set };
        for (const key of remove) delete prefs[key];
      },
    };
    const solo = createSignalSettingsRoutes({ store, organization: () => false });
    const org = createSignalSettingsRoutes({ store, organization: () => true });
    expect(await call(solo, { method: "GET", path: "/api/me/other" })).toBe("PASS");
    expect(await call(org, { method: "GET" })).toMatchObject({ status: 404 });
    expect(await call(solo, { method: "GET" })).toEqual({ status: 200, body: { budget: null, quiet: null, channels: null } });
    const night = JSON.stringify({ start: "22:00", end: "07:00", timeZone: "UTC" });
    expect(await call(solo, { method: "PUT", body: { budget: "10", quiet: night } })).toEqual({ status: 200, body: { budget: "10", quiet: night, channels: null } });
    expect(prefs).toEqual({ [SIGNAL_BUDGET_KEY]: "10", [QUIET_HOURS_KEY]: night });
    expect(await call(solo, { method: "PUT", body: { quiet: null } })).toEqual({ status: 200, body: { budget: "10", quiet: null, channels: null } });
    expect(await call(solo, { method: "PUT", body: { budget: 3 } })).toMatchObject({ status: 400 });
    expect(await call(solo, { method: "DELETE" })).toMatchObject({ status: 405 });
  });

  it("#4250 (S2): keeps the channels each level may use, on the same record the gate reads", async () => {
    let prefs: Record<string, string> = {};
    const store = { get: () => prefs, merge: (set: Record<string, string>, remove: string[]) => { prefs = { ...prefs, ...set }; for (const key of remove) delete prefs[key]; } };
    const solo = createSignalSettingsRoutes({ store, organization: () => false });
    const channels = JSON.stringify({ card: ["push"], urgent: ["push", "sms"] });
    expect(await call(solo, { method: "PUT", body: { channels } })).toEqual({ status: 200, body: { budget: null, quiet: null, channels } });
    expect(prefs).toEqual({ [NOTIFY_CHANNELS_KEY]: channels });
    expect(readSignalPrefs(prefs, undefined).channels).toEqual({ card: ["push"], urgent: ["push", "sms"] });
  });

  it("is the person's own route (client scope)", () => {
    expect(CLIENT_ALLOW.find((entry) => entry.path.test(SIGNAL_SETTINGS_PATH))?.methods).toEqual(["GET", "PUT"]);
  });
});
