// Who pays for a person's turns on an organization server, as the model
// picker shows it. The server decides (server/engine-credentials.ts, the
// person who speaks pays, 2026-10-01) and answers it per engine as
// `myTurns` on GET /api/me/engines; this module only lays out the rows in
// that order and never recomputes the choice. A routine pays as the bot's
// owner. Solo servers have no payer order.
import type { MyEngine } from "@/lib/perspicax-org";
import { PERSONAL_KEY_DRIVERS } from "../../shared/org-engine-readiness";

/** A payer the person's own turns can use, in engine-credentials.ts order:
 * their subscription, their key in Perspicax, the organization's key. */
export type PayerId = Exclude<MyEngine["myTurns"], "none">;

export const PAYER_ORDER: readonly PayerId[] = ["subscription", "key", "org-key"];

export interface PayerRow {
  id: PayerId;
  /** This payer is available to the person (it may still not be first). */
  ready: boolean;
}

export interface PayerOrder {
  rows: PayerRow[];
  /** The server's answer: the payer the person's turns use now, or null. */
  current: PayerId | null;
}

type EngineFacts = Pick<MyEngine, "installed" | "notAvailable" | "subscription" | "myKey" | "orgKey" | "myTurns"> & { driver: string };

/** Drivers whose provider key a person can keep in Perspicax
 * (server/engine-credentials.ts providersOfDriver). */
export function keyProviderDriver(driver: string): boolean {
  return PERSONAL_KEY_DRIVERS.includes(driver);
}

/** The server image deliberately does not carry this engine
 * (engines.lock.json notPreinstalled, surfaced as `notAvailable`): a real,
 * unactionable state, never a mere signed-out login. This is the ONLY case
 * that withholds Connect and reads as "not installed / not available". A bare
 * `installed: false` with no reason is not proof the binary is gone (a stale
 * probe, or a managed engine between sign-ins), so it never locks Connect out. */
export function engineUnavailable(engine: Pick<MyEngine, "installed" | "notAvailable">): boolean {
  return !engine.installed && Boolean(engine.notAvailable);
}

/** Connecting is the right action now: a subscription engine that is signed
 * out, on a server that is not deliberately missing it. Independent of the
 * `installed` probe on purpose: a sign-out (or a transient probe miss) must
 * never remove the way back in (fix/engine-connect-not-blocked-by-installed,
 * the Grok lockout: a logout read as "not installed" with Connect disabled). */
export function engineCanConnect(engine: Pick<MyEngine, "installed" | "notAvailable" | "subscription">): boolean {
  return engine.subscription.supported && !engine.subscription.signedIn && !engineUnavailable(engine);
}

export function payerOrder(engine: EngineFacts): PayerOrder {
  const ready: Record<PayerId, boolean> = { subscription: engine.subscription.signedIn, key: engine.myKey, "org-key": engine.orgKey };
  const rows = PAYER_ORDER
    .filter((id) => (id === "subscription" ? engine.subscription.supported : id === "key" ? keyProviderDriver(engine.driver) : true))
    .map((id) => ({ id, ready: ready[id] }));
  return { rows, current: engine.myTurns === "none" ? null : engine.myTurns };
}

export type OrgEngineState = "connected" | "signInRequired" | "noAccess" | "notInstalled" | "notAvailable";

/** One word for the provider column: connected, or what is missing. */
export function orgEngineState(engine: EngineFacts): OrgEngineState {
  // The server image deliberately does not carry it (engines.lock.json): a
  // real, unactionable state.
  if (engineUnavailable(engine)) return "notAvailable";
  if (engine.myTurns !== "none") return "connected";
  // A subscription engine that is signed out needs a sign-in, even if the CLI
  // probe is momentarily unsure: a logout must never read as missing software
  // (the Grok lockout). Only a non-connectable engine whose binary is genuinely
  // absent is "not installed".
  if (engine.subscription.supported) return "signInRequired";
  if (!engine.installed) return "notInstalled";
  return "noAccess";
}
