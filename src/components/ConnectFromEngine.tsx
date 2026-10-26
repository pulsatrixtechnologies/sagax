// A reusable "connect this from the engine" pointer. When a capability the
// person asked for is genuinely missing — a connector that needs sign-in or
// failed, or none on the account yet — this surfaces ONE link to the engine's
// own connector page (claude.ai Customize > Connectors, or grok.com), the
// same page Manage opens. It never signs anyone in and never opens an OAuth
// flow of its own: Sagax holds no token for these (shared/connector-setup.ts),
// so the only thing it does is hand the person the engine's existing page.
//
// It is not a chat widget. It is meant to sit where the connector/tool list
// already lives (Settings > connectors, Providers), as a per-item fix-it link
// on a not-connected row, so the person is not left at a dead end. If a caller
// ever places it near a conversation, `dismissible` turns it into a small,
// honest, dismissible affordance (#876: no widget injected without cause).
import { useState } from "react";
import { ExternalLink, X } from "lucide-react";

import { openExternalLink } from "@/lib/app-links";
import { isConnectorSetupUrl } from "../../shared/connector-setup";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

export function ConnectFromEngine({ missing, manageUrl, name, host, dismissible = false, className }: {
  /** true only when the capability is genuinely not usable right now */
  missing: boolean;
  /** the engine's own connector page; the same page Manage opens */
  manageUrl: string;
  /** the connector or capability name, for the one-line human explanation */
  name?: string;
  /** the engine host for the button label; derived from the URL otherwise */
  host?: string;
  /** near a conversation: show a dismiss control (hidden until asked) */
  dismissible?: boolean;
  className?: string;
}) {
  const [dismissed, setDismissed] = useState(false);
  // Fail closed: only ever point at the engine's own page (claude.ai/grok.com),
  // never a URL we did not vet. No capability, no card.
  if (!missing || dismissed || !isConnectorSetupUrl(manageUrl)) return null;
  const engineHost = host ?? (new URL(manageUrl).hostname.includes("grok") ? "grok.com" : "claude.ai");
  return (
    <div data-connect-from-engine className={cn("flex items-center gap-2", className)}>
      {name && (
        <span className="min-w-0 truncate text-[12px] text-ink-tertiary">{t("connectFromEngine.notConnected", { name })}</span>
      )}
      <button
        type="button"
        data-connect-from-engine-open
        onClick={() => void openExternalLink(manageUrl)}
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-control px-2.5 py-1 text-[11.5px] font-medium text-ink hover:bg-raised-hover"
      >
        <ExternalLink size={12} aria-hidden="true" /> {t("connectFromEngine.open", { host: engineHost })}
      </button>
      {dismissible && (
        <button
          type="button"
          data-connect-from-engine-dismiss
          onClick={() => setDismissed(true)}
          className="ui-icon-button shrink-0"
          aria-label={t("connectFromEngine.dismiss")}
          title={t("connectFromEngine.dismiss")}
        >
          <X size={13} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
