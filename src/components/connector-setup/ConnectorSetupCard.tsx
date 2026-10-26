// "Connect Microsoft Teams" (shared/connector-setup.ts): the card a bot
// posts with open_connector_setup. One primary button opens the sign-in page
// (grok.com or claude.ai) in the person's own browser through the app's link
// path (Electron's open-external on desktop, a new tab on the web); nothing
// opens until they click. Back in the app, or on "I'm done", Sagax checks
// and the card says Connected only on evidence (server/routes/connector-setup.ts).
import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, PlugZap } from "lucide-react";

import { isConnectorSetupUrl, type ConnectorSetupView } from "../../../shared/connector-setup";
import { openExternalLink } from "@/lib/app-links";
import { t } from "@/lib/i18n";
import { api } from "@/state/store";
import { ASK_PRIMARY_BUTTON, ASK_QUIET_BUTTON, AskCard, AskSettledLine } from "../AskCard";

/** Opens the card's page, only on an allowed host. */
export async function openConnectorSetup(view: Pick<ConnectorSetupView, "url">): Promise<boolean> {
  if (!isConnectorSetupUrl(view.url)) return false;
  // desktop: the card's own channel, where main checks the host again
  if (window.ogb?.openConnectorSetup) {
    try {
      await window.ogb.openConnectorSetup(view.url);
      return true;
    } catch (error) {
      console.warn("desktop:open-connector-setup refused the link; trying the app's link path", error);
    }
  }
  await openExternalLink(view.url);
  return true;
}

export function ConnectorSetupBody({ view, checking, opened, error, onConnect, onDone }: {
  view: ConnectorSetupView;
  checking: boolean;
  /** the person clicked the button in this session */
  opened: boolean;
  error?: string | null;
  onConnect: () => void;
  onDone: () => void;
}) {
  if (view.status === "connected") {
    return (
      <AskSettledLine ariaLabel={view.label}>
        <span className="text-ink-secondary">{view.label}</span>
        <span> · {t("connectorSetup.connected")}</span>
      </AskSettledLine>
    );
  }
  const host = view.provider === "claude" ? "claude.ai" : "grok.com";
  const showDone = opened || view.status === "pending";
  return (
    <AskCard
      ariaLabel={view.label}
      icon={<PlugZap size={15} />}
      title={view.label}
      explanation={t("connectorSetup.where", { host })}
      footer={
        <>
          <span role="status" className="me-auto flex min-w-0 items-center gap-1.5 text-[12px] text-ink-tertiary">
            {checking && <Loader2 size={12} className="shrink-0 animate-spin" />}
            {checking ? t("connectorSetup.checking") : view.status === "pending" ? t("connectorSetup.pending") : opened ? t("connectorSetup.waiting") : t("connectors.card.requested")}
          </span>
          {showDone && (
            <button type="button" data-connector-setup-done onClick={onDone} disabled={checking} className={ASK_QUIET_BUTTON}>
              {t("connectorSetup.done")}
            </button>
          )}
          <button type="button" data-connector-setup-connect onClick={onConnect} className={ASK_PRIMARY_BUTTON}>
            <ExternalLink size={14} />
            {t("connectorSetup.connect", { name: view.label })}
          </button>
        </>
      }
    >
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
    </AskCard>
  );
}

export function ConnectorSetupCard({ threadId, view }: { threadId: string; view: ConnectorSetupView }) {
  const [opened, setOpened] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const awaitingReturn = useRef(false);

  const check = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      // the server patches the message; the live thread brings the new status
      await api(`/api/connector-setup/${encodeURIComponent(view.id)}/check`, { method: "POST", body: JSON.stringify({ threadId }) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setChecking(false);
    }
  }, [threadId, view.id]);

  // Back from the browser: check once, on the person's return only.
  useEffect(() => {
    if (view.status === "connected") return;
    const onFocus = () => {
      if (!awaitingReturn.current) return;
      awaitingReturn.current = false;
      void check();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [check, view.status]);

  const connect = () => {
    setError(null);
    void openConnectorSetup(view).then((ok) => {
      if (!ok) {
        setError(t("connectorSetup.blocked"));
        return;
      }
      setOpened(true);
      awaitingReturn.current = true;
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  };

  return <ConnectorSetupBody view={view} checking={checking} opened={opened} error={error} onConnect={connect} onDone={() => void check()} />;
}
