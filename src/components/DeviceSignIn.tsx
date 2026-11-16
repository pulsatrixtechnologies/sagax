// The in-app sign-in for an engine's CLI on the machine running Sagax, where
// it is offered outside a provider's account rows: Codex and Kimi with a
// one-time code, Grok Build the same way, the ChatGPT plan (a browser page,
// no code), and Cursor (its own page, no code). The flow and its look are the
// provider page's own (settings/AccountSignIn.tsx, #4415).
import { ApiError, useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { deviceSignInLink, type DeviceSignInProvider } from "../../shared/device-sign-in";
import { AccountSignIn, type SignInWay } from "./settings/AccountSignIn";

export interface DeviceSignInStatus {
  phase: "waiting" | "succeeded" | "failed" | "expired" | "cancelled";
  flowId: string | null;
  authorizationUrl: string | null;
  userCode?: string;
  expiresAt: string | null;
  message?: string;
}

/** Whose page an engine's device code is entered at. Cursor is a page
 * without a code (`open-link`); it is not mapped here. */
export function deviceSignInProvider(driverKind: string): DeviceSignInProvider {
  if (driverKind === "grokAgent") return "grok";
  if (driverKind === "kimiAgent") return "kimi";
  return "codex";
}

export type SetupSignInProvider = DeviceSignInProvider | "cursor";

/** The words that differ by whose account the code signs in. */
export const DEVICE_SIGN_IN_COPY: Record<SetupSignInProvider, Record<"description" | "start" | "connectedAccount", LocaleKey>> = {
  codex: {
    description: "engineSetup.device.description",
    start: "engineSetup.device.start",
    connectedAccount: "engineSetup.device.connectedAccount",
  },
  grok: {
    description: "engineSetup.grok.description",
    start: "engineSetup.grok.start",
    connectedAccount: "engineSetup.grok.connectedAccount",
  },
  kimi: {
    description: "engineSetup.kimi.description",
    start: "engineSetup.kimi.start",
    connectedAccount: "engineSetup.kimi.connectedAccount",
  },
  cursor: {
    description: "engineSetup.cursor.description",
    start: "engineSetup.cursor.start",
    connectedAccount: "engineSetup.cursor.connectedAccount",
  },
};

export function deviceFlowUnavailable(cause: unknown): boolean {
  return cause instanceof ApiError && [401, 403, 404, 410].includes(cause.status);
}

/** Never turn arbitrary process output into a sign-in link. The server also
 * validates this address before returning a device challenge. */
export function codexDeviceLink(value: string | null): string | null {
  return deviceSignInLink("codex", value);
}

export function chatgptPlanLink(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.origin === "https://auth.openai.com" && url.pathname === "/api/accounts/authorize" &&
      !url.username && !url.password && !url.hash ? url.href : null;
  } catch { return null; }
}

/** The device-code hint shows only once a sign-in failed, and not when the
 * failure already says it (server/drivers/codex-device-auth.ts). */
export function deviceCodeHintShown(auth: Pick<DeviceSignInStatus, "phase" | "message"> | null, error: string | null): boolean {
  if (auth?.phase !== "failed" && !error) return false;
  return !/device.?code/i.test(`${auth?.message ?? ""} ${error ?? ""}`);
}

/** How each of these sign-ins runs in the shared flow. */
function deviceWay(base: string, browserPkce: boolean, linkOnly: boolean, provider: SetupSignInProvider): SignInWay {
  if (browserPkce) return { base, kind: "page", vendor: "chatgpt" };
  if (linkOnly || provider === "cursor") return { base, kind: "page", vendor: "cursor" };
  return { base, kind: "device", vendor: provider };
}

export function DeviceSignIn({ instanceId, browserPkce = false, linkOnly = false, provider = "codex", base, onSignedIn }: {
  instanceId: string;
  browserPkce?: boolean;
  /** A page with no one-time code (Cursor). The button opens it, and the
   * flow asks the server until it confirms the sign-in. */
  linkOnly?: boolean;
  provider?: SetupSignInProvider;
  /** Another sign-in with the same verbs (start, status, cancel): a
   * person's own subscription on an organization server
   * (`/api/me/engines/<id>/login`). Defaults to the server's own engine. */
  base?: string;
  /** Called after a sign-in succeeds, in place of refreshing the engines. */
  onSignedIn?: () => Promise<unknown> | void;
}) {
  const { refreshInstances, refreshModels } = useStore();
  const refresh = onSignedIn ?? (async () => {
    await refreshInstances();
    await refreshModels(instanceId);
  });
  const way = deviceWay(base ?? `/api/instances/${encodeURIComponent(instanceId)}/auth`, browserPkce, linkOnly, provider);
  const name = browserPkce || provider === "codex" ? "ChatGPT" : provider === "grok" ? "Grok" : provider === "kimi" ? "Kimi" : "Cursor";
  return (
    <AccountSignIn className="mt-3" data-device-sign-in={linkOnly ? undefined : provider} data-link-sign-in={linkOnly ? provider : undefined} data-chatgpt-plan-sign-in={browserPkce || undefined}
      way={way} onSignedIn={refresh} name={name} label={t(browserPkce ? "engineSetup.chatgpt.start" : DEVICE_SIGN_IN_COPY[provider].start)}
      // ChatGPT refuses a device code until the person turns it on in their security settings
      hint={!browserPkce && provider === "codex" ? (outcome) => deviceCodeHintShown({ phase: "failed", message: outcome }, null)
        ? <p className="text-[11px] leading-relaxed text-ink-secondary">{t("engineSetup.device.enableHint")}</p> : null : undefined} />
  );
}
