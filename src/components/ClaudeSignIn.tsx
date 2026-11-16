import { useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { AccountSignIn } from "./settings/AccountSignIn";

const SIGN_IN_HOSTS = ["claude.com", "claude.ai", "console.anthropic.com", "platform.claude.com"];

/** Never turn arbitrary process output into a link: only Anthropic's own
 * sign-in pages over https. The server applies the same rule first. */
export function claudeSignInLink(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const trusted = SIGN_IN_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
    return url.protocol === "https:" && trusted && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

/** Claude's sign-in outside a provider's account rows: open Anthropic's
 * page, paste the code it shows, done. The server drives the unmodified CLI.
 * The flow and its look are the provider page's own (#4415). */
export function ClaudeSignIn({ instanceId, base, onSignedIn, label }: {
  instanceId: string;
  /** The start button's words (default "Connect Claude"; "Reconnect
   * Claude" once a sign-in expired, #1533). */
  label?: string;
  /** Another sign-in with the same verbs (start, status, complete, cancel):
   * a person's own subscription on an organization server
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
  return (
    <AccountSignIn data-claude-sign-in="" className="mt-3"
      way={{ base: base ?? `/api/instances/${encodeURIComponent(instanceId)}/auth`, kind: "paste", vendor: "claude" }}
      onSignedIn={refresh} name="Claude" label={label ?? t("engineConnect.connect", { name: "Claude" })} />
  );
}
