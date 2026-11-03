// The phones that get pushes (server/push/, docs/ios-push.md):
//
//   POST   /api/push/devices  { token, platform: "ios", environment?, appVersion?,
//                              deviceName?, settings? }  register or refresh
//                              this phone for the signed-in person
//                              { token, platform: "android", appVersion?,
//                              deviceName? }  the same for an Android phone
//                              (an FCM registration token, 2026-10-26)
//   DELETE /api/push/devices  { token }  this person's phone stops getting pushes
//                              (sign-out)
//   GET    /api/push/devices  this person's phones, tokens masked
//
// A person only ever reads or changes their own devices. The token is never
// echoed back in full and never logged.
import { z } from "zod";

import { apnsEnvironment, maskSecret, type ApnsEnvironment } from "../push/config.ts";
import { DEVICE_TOKEN, registrationSchema, type PushDevice, type PushDeviceStore } from "../push/devices.ts";
import { androidRegistrationSchema, FCM_TOKEN, type AndroidPushDevice, type AndroidPushDeviceStore } from "../push/fcm-devices.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const PUSH_DEVICES_PATH = "/api/push/devices";

export interface PushDeviceRouteDeps {
  /** The person behind the request; none for a caller who is not a person. */
  person(auth: RequestAuth): string | undefined;
  store: PushDeviceStore;
  /** Android phones (FCM). Absent: an Android registration is refused. */
  android?: { store: AndroidPushDeviceStore; configured(): boolean };
  /** Whether this server can send (APNs configured and the key loaded). */
  configured(): boolean;
  /** SAGAX_APNS_ENVIRONMENT, for a phone that did not say its own. */
  defaultEnvironment(): ApnsEnvironment;
}

const removeBody = z.object({ token: z.string().trim().toLowerCase().regex(DEVICE_TOKEN) }).strict();
const removeAndroidBody = z.object({ token: z.string().trim().regex(FCM_TOKEN) }).strict();

const publicDevice = (device: PushDevice) => ({
  token: maskSecret(device.token),
  platform: device.platform,
  environment: device.environment,
  appVersion: device.appVersion,
  deviceName: device.deviceName,
  settings: device.settings,
  updatedAt: device.updatedAt,
});

const publicAndroidDevice = (device: AndroidPushDevice) => ({
  token: maskSecret(device.token),
  platform: device.platform,
  appVersion: device.appVersion,
  deviceName: device.deviceName,
  updatedAt: device.updatedAt,
});

export function createPushDeviceRoutes(deps: PushDeviceRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== PUSH_DEVICES_PATH) return PASS;
    res.setHeader("cache-control", "no-store");
    const person = deps.person(auth);
    if (!person) return json(res, 403, { error: "Only a signed-in person registers a phone for notifications.", code: "session_required" });
    if (method === "GET") {
      const android = deps.android ? deps.android.store.list(person).map(publicAndroidDevice) : [];
      return json(res, 200, { configured: deps.configured(), ...(deps.android ? { androidConfigured: deps.android.configured() } : {}), devices: [...deps.store.list(person).map(publicDevice), ...android] });
    }
    if (method === "POST") {
      const body = await readBody(req);
      if (body && typeof body === "object" && (body as { platform?: unknown }).platform === "android") {
        if (!deps.android) return json(res, 400, { error: "Android notifications are not available on this server." });
        const parsed = androidRegistrationSchema.safeParse(body);
        if (!parsed.success) return json(res, 400, { error: "send { token (FCM registration token), platform: \"android\", appVersion?, deviceName? }" });
        const device = deps.android.store.register(person, parsed.data);
        return json(res, 200, { ok: true, configured: deps.android.configured(), device: publicAndroidDevice(device) });
      }
      const parsed = registrationSchema.safeParse(body);
      if (!parsed.success) return json(res, 400, { error: "send { token (hex), platform: \"ios\", environment?: \"sandbox\" | \"production\", appVersion?, deviceName?, settings? }" });
      const environment = parsed.data.environment ?? apnsEnvironment(undefined, deps.defaultEnvironment());
      const device = deps.store.register(person, { ...parsed.data, environment });
      return json(res, 200, { ok: true, configured: deps.configured(), device: publicDevice(device) });
    }
    if (method === "DELETE") {
      const body = await readBody(req);
      const parsed = removeBody.safeParse(body);
      if (parsed.success) return json(res, 200, { ok: true, removed: deps.store.remove(person, parsed.data.token) || Boolean(deps.android?.store.remove(person, parsed.data.token)) });
      const android = removeAndroidBody.safeParse(body);
      if (android.success && deps.android) return json(res, 200, { ok: true, removed: deps.android.store.remove(person, android.data.token) });
      if (!android.success) return json(res, 400, { error: "send { token }" });
      return json(res, 200, { ok: true, removed: false });
    }
    return json(res, 405, { error: "GET, POST or DELETE" });
  };
}
