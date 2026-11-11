/** One account into an ACP engine's child environment (#3519): a turn and a
 * one-shot call of the same bot sign in through this one function, so the
 * one-shot never runs on the server's own login while the turn runs on the
 * payer's own home or key. */
import { DATA_DIR } from "../../config.ts";
import { applyStoredEngineEnv } from "../../engines/engine-api-keys.ts";
import type { TurnAccessInput } from "../../contracts.ts";
import type { AcpSupport } from "./types.ts";

export function applyAcpAccess(
  env: Record<string, string | undefined>,
  support: Pick<AcpSupport, "applyAccess">,
  driverKind: string,
  access: TurnAccessInput | undefined,
  instanceEnvironment: Record<string, string> | undefined,
  dataDir: string = DATA_DIR,
): void {
  if (!access) return;
  support.applyAccess?.(env, access, instanceEnvironment);
  // After applyAccess: a driver's own hook may clear a variable and
  // restore only a Perspicax key. A pasted key fills the variable when
  // it is still empty, and only for this person.
  if (access.localKeyPrincipal) {
    applyStoredEngineEnv(env, driverKind, dataDir, { organization: true, principalId: access.localKeyPrincipal });
  }
}
