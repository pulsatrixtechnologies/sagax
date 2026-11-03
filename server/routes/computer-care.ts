// Settings > Computer: scheduled update and disk saver of the bot's computer
// (server/computer/computer-care.ts), for the same computer /api/computer/status
// manages: the signed-in person's own server environment on an
// organization server, this computer's Local VM on a personal one (its
// owner only).
//
//   GET  /api/computer/maintenance -> { schedule, nextWindowAt, lastResult?, running }
//   PUT  /api/computer/maintenance  { enabled, days, hour, windowHours, timeZone } -> the same
//   GET  /api/computer/disk-saver   -> { computerRunning, items: [{ id, bytes, userFiles }], totalBytes }
//                                      Measures only; deletes nothing.
//   POST /api/computer/disk-saver   { categories: [...], confirmUserFiles? }
//                                   -> { freedBytes, preview }
//        A category that holds the person's own files (the trash) without
//        confirmUserFiles: 409 confirm_user_files, nothing is deleted.
import { z } from "zod";

import {
  DEFAULT_SCHEDULE,
  DISK_SAVER_CATEGORIES,
  DiskSaverRefusal,
  maintenanceScheduleSchema,
  nextWindowStart,
  previewDiskSaver,
  runDiskSaver,
  validTimeZone,
  type DiskSaverCategory,
  type DiskSaverTarget,
  type MaintenanceScheduler,
  type MaintenanceStore,
} from "../computer/computer-care.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface ComputerCareRouteDeps {
  organization(): boolean;
  /** An organization server with server environments. */
  sandboxConfigured(): boolean;
  /** The owner of this computer (as /api/computer/status decides). */
  mayManageLocal(auth: RequestAuth): boolean;
  store: MaintenanceStore;
  scheduler: Pick<MaintenanceScheduler, "isRunning">;
  /** Where the disk saver measures and cleans for this computer key. */
  diskTarget(key: string): DiskSaverTarget | null;
  /** One audit row per cleaning or schedule change (no paths, no secrets). */
  audit?(auth: RequestAuth, action: "computer.maintenance.schedule" | "computer.disk-saver.clean", detail: Record<string, unknown>): void;
  now?: () => number;
}

const PATHS = new Set(["/api/computer/maintenance", "/api/computer/disk-saver"]);

const cleanBody = z.object({
  categories: z.array(z.enum(DISK_SAVER_CATEGORIES as unknown as [DiskSaverCategory, ...DiskSaverCategory[]])).min(1).max(DISK_SAVER_CATEGORIES.length),
  confirmUserFiles: z.boolean().optional(),
}).strict();

/** "person:<principalId>" on an organization server, "local" on a personal
 * one; a refusal otherwise. */
export function computerCareKey(
  deps: Pick<ComputerCareRouteDeps, "organization" | "sandboxConfigured" | "mayManageLocal">,
  auth: RequestAuth,
): { key: string } | { status: number; error: string; code: string } {
  if (deps.organization()) {
    const principalId = auth.kind === "session" ? auth.session.principalId?.trim() : undefined;
    if (!principalId) return { status: 403, error: "Sign in with Pulsatrix to use a server environment.", code: "identity_perspicax" };
    if (!deps.sandboxConfigured()) return { status: 409, error: "This server has no server environments.", code: "not_configured" };
    return { key: `person:${principalId}` };
  }
  if (!deps.mayManageLocal(auth)) return { status: 403, error: "forbidden: only this computer's owner can manage its computer", code: "forbidden" };
  return { key: "local" };
}

export function createComputerCareRoutes(deps: ComputerCareRouteDeps): RouteHandler {
  const now = deps.now ?? Date.now;
  const maintenanceView = (key: string) => {
    const entry = deps.store.get(key);
    const schedule = entry?.schedule ?? DEFAULT_SCHEDULE;
    return {
      schedule,
      nextWindowAt: nextWindowStart(schedule, now()),
      ...(entry?.lastResult ? { lastResult: entry.lastResult } : {}),
      running: deps.scheduler.isRunning(key),
    };
  };

  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (!PATHS.has(path)) return PASS;
    res.setHeader("cache-control", "no-store");
    const maintenance = path === "/api/computer/maintenance";
    const allowed = maintenance ? ["GET", "PUT"] : ["GET", "POST"];
    if (!allowed.includes(method)) return json(res, 405, { error: `${allowed.join(" or ")} only` });
    if (method !== "GET" && !/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
      return json(res, 415, { error: "content-type must be application/json" });
    }
    const resolved = computerCareKey(deps, auth);
    if (!("key" in resolved)) return json(res, resolved.status, { error: resolved.error, code: resolved.code });
    const { key } = resolved;

    if (maintenance) {
      if (method === "GET") return json(res, 200, maintenanceView(key));
      const parsed = maintenanceScheduleSchema.safeParse(await readBody(req));
      if (!parsed.success || !validTimeZone(parsed.data.timeZone)) {
        return json(res, 400, { error: "send { enabled, days: [0-6], hour: 0-23, windowHours: 1-6, timeZone }" });
      }
      const schedule = { ...parsed.data, days: [...new Set(parsed.data.days)].sort((a, b) => a - b) };
      deps.store.setSchedule(key, schedule, now());
      deps.audit?.(auth, "computer.maintenance.schedule", { enabled: schedule.enabled, days: schedule.days, hour: schedule.hour, windowHours: schedule.windowHours });
      return json(res, 200, maintenanceView(key));
    }

    const target = deps.diskTarget(key);
    if (!target) return json(res, 409, { error: "This computer cannot be measured here.", code: "not_configured" });
    try {
      if (method === "GET") return json(res, 200, await previewDiskSaver(target));
      const parsed = cleanBody.safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: `send { categories: [${DISK_SAVER_CATEGORIES.join(", ")}], confirmUserFiles? }` });
      const result = await runDiskSaver(target, parsed.data.categories, parsed.data.confirmUserFiles === true);
      deps.audit?.(auth, "computer.disk-saver.clean", { categories: parsed.data.categories, freedBytes: result.freedBytes });
      return json(res, 200, { freedBytes: result.freedBytes, preview: result.after });
    } catch (error) {
      if (error instanceof DiskSaverRefusal) return json(res, 409, { error: error.message, code: error.code });
      const status = (error as { status?: unknown })?.status;
      if (typeof status === "number" && status >= 400 && status < 500) {
        return json(res, status, { error: error instanceof Error ? error.message : String(error) });
      }
      return json(res, 502, { error: "The bot's computer could not be measured or cleaned.", code: "unavailable" });
    }
  };
}
