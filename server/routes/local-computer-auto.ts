// The Local VM's automatic care, asked by the app (server/computer/local-vm-auto.ts).
//
// POST /api/local-computer/ensure: "bot" when a bot's Computer tab needs the
// VM, "person" for the person's own Start or Retry. Answers at once; the
// work goes on in the background, and the snapshot tells the app where it
// is.
//
// POST /api/local-computer/reset: delete this computer's Local VMs (the
// shared one and each bot's) and let the automatic start create the shared
// one again. The workspace folders on this computer are kept.
import { PASS, type RouteHandler } from "./table.ts";

import type { LocalVmTarget } from "../computer/container-computer.ts";
import type { LocalVmAutoStarter } from "../computer/local-vm-auto.ts";
import type { RequestAuth } from "../auth/request-auth.ts";

export interface LocalComputerAutoRouteDeps {
  /** Null where no automatic start runs (organization server, cloud, self-hosted). */
  localVmAuto: LocalVmAutoStarter | null;
  /** Why this computer may not host a desktop at all, or undefined when it may. */
  hostRefusal: () => string | undefined;
  /** True while any Local VM setup action is still running. */
  setupBusy: () => boolean;
  /** True while a bot is running a turn on a Local VM. */
  botUsesLocalVm: () => boolean;
  /** True while a bot holds the lease on one of the targets. */
  botHoldsLease: (targets: LocalVmTarget[]) => boolean;
  /** Every Local VM target on this computer: the shared one plus each bot's. */
  listTargets: () => Promise<LocalVmTarget[]>;
  /** Runs the reset with the lifecycle-busy marks held, come what may. */
  withLifecycleBusy: (targets: LocalVmTarget[], run: () => Promise<void>) => Promise<void>;
  /** Removes one VM container; one this app did not create is left alone. */
  removeVm: (target: LocalVmTarget) => Promise<void>;
  /** The shared VM's full payload, for the answer. */
  sharedPayload: (auth: RequestAuth) => Promise<unknown>;
}

export function createLocalComputerAutoRoutes(deps: LocalComputerAutoRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/local-computer/ensure" && path !== "/api/local-computer/reset") return PASS;
    if (method !== "POST") return json(res, 405, { error: "POST only" });
    if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
      return json(res, 415, { error: "content-type must be application/json" });
    }
    const body = await readBody(req, 1_000) as { reason?: unknown; confirm?: unknown } | null;

    if (path === "/api/local-computer/ensure") {
      const reason = body?.reason === "person" ? "person" : "bot";
      if (deps.localVmAuto) void Promise.resolve(deps.localVmAuto.ensure(reason)).catch(() => {});
      return json(res, 202, { auto: deps.localVmAuto?.snapshot() ?? null });
    }

    if (body?.confirm !== true) return json(res, 400, { error: "confirm must be true" });
    const refusal = deps.hostRefusal();
    if (refusal) return json(res, 403, { error: refusal, code: "host_computer" });
    if (deps.setupBusy()) return json(res, 409, { error: "another Local VM setup action is still running" });
    if (deps.botUsesLocalVm()) return json(res, 409, { error: "a bot is using a Local VM — stop that turn first", code: "in_use" });
    const targets = await deps.listTargets();
    if (deps.botHoldsLease(targets)) return json(res, 409, { error: "a bot is using a Local VM — stop that turn first", code: "in_use" });
    await deps.withLifecycleBusy(targets, async () => {
      for (const target of targets) await deps.removeVm(target);
    });
    if (deps.localVmAuto) {
      deps.localVmAuto.personStarted();
      void Promise.resolve(deps.localVmAuto.ensure("person")).catch(() => {});
    }
    return json(res, 200, await deps.sharedPayload(auth));
  };
}
