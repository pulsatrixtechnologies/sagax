// Organization server: may this engine run a turn here? Only when its driver
// withholds the engine's own shell, file and web tools (withholdHostTools);
// otherwise 409 `host_tools` with the engine's reason (shared/org-engines.ts),
// the same words the picker and the engine card show.
import { orgHostToolsRefusal } from "../../shared/org-engines.ts";

export interface OrgEngineInstance {
  adapter: { capabilities: { withholdsHostTools?: boolean } };
  displayName?: string;
  driverKind: string;
}

export class OrgHostToolsError extends Error {
  readonly status = 409;
  readonly code = "host_tools";
}

/** True when the turn must set withholdHostTools; throws OrgHostToolsError
 * for an engine that cannot hold its tools back. Off an organization server
 * nothing is withheld. */
export function orgWithholdHostTools(instance: OrgEngineInstance, organization: boolean, name: string): boolean {
  if (!organization) return false;
  if (instance.adapter.capabilities.withholdsHostTools !== true) {
    throw new OrgHostToolsError(orgHostToolsRefusal(name, instance.driverKind));
  }
  return true;
}
