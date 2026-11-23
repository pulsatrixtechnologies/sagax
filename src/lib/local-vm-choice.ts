// Whether the computer picker offers Local VM, and why it would not.
// A connected desktop registers Local VM in its bridge capabilities
// (electron/desktop-bridge.mjs). A solo server's Local VM is its own
// container, so it needs no desktop. A cloud home has neither.
import { t } from "@/lib/i18n";
import type { DesktopBridgeStatus } from "@/lib/desktop-bridge";

/** What the picker knows about a desktop that can run a Local VM.
 * `unknown`: an organization server has not answered the bridge yet, so the
 * picker does not call the Local VM unavailable. */
export type LocalVmDesktop = "solo" | "ready" | "offline" | "unregistered" | "unknown";

export interface LocalVmChoiceInput {
  /** A cloud home has no Local VM. */
  cloudHome?: boolean;
  /** Organization policy. Absent means allowed. */
  policyAllows?: boolean;
  organizationName?: string;
  /** The engine can drive a computer. Absent: not known yet, so it does not block. */
  modelCanUseComputer?: boolean | null;
  modelName?: string;
  /** Solo, a registered desktop, none connected, or connected without Local VM. */
  desktop?: LocalVmDesktop;
}

export interface LocalVmChoice {
  /** Hidden only when the place does not exist (a cloud home). */
  shown: boolean;
  selectable: boolean;
  /** Why a shown Local VM cannot be chosen. */
  reason: string | null;
}

/** Organization: an online desktop that registered Local VM. Solo: the server's own. */
export function localVmDesktopState(bridge: DesktopBridgeStatus | null, organization: boolean): LocalVmDesktop {
  if (!organization) return "solo";
  if (!bridge) return "unknown";
  const online = bridge.desktops.filter((desktop) => desktop.online && desktop.access !== "never");
  if (online.some((desktop) => desktop.capabilities?.localVm)) return "ready";
  if (online.length > 0) return "unregistered";
  return "offline";
}

/** Show Local VM when it can be used. Hide it on a cloud home. Otherwise keep
 * it in the list, not selectable, with the reason it cannot be chosen. */
export function localVmChoice(input: LocalVmChoiceInput = {}): LocalVmChoice {
  if (input.cloudHome) return { shown: false, selectable: false, reason: null };
  if (input.policyAllows === false) {
    const organization = input.organizationName?.trim();
    return {
      shown: true,
      selectable: false,
      reason: organization ? t("computerMenu.vmPolicy", { organization }) : t("computerMenu.vmPolicyPlain"),
    };
  }
  if (input.modelCanUseComputer === false) {
    const model = input.modelName?.trim();
    return {
      shown: true,
      selectable: false,
      reason: model ? t("place.view.vmCannot.line", { model }) : t("place.view.vmCannot.short"),
    };
  }
  if (input.desktop === "offline") {
    return { shown: true, selectable: false, reason: t("localVm.problem.not_connected") };
  }
  if (input.desktop === "unregistered") {
    return { shown: true, selectable: false, reason: t("localVm.problem.no_runtime") };
  }
  return { shown: true, selectable: true, reason: null };
}
