// One engine's own access for the signed-in person on an organization server
// (Perspicax), drawn the same way in Settings > Model providers and in the
// model picker: one status line ("Pays with: ..."), one button ("Connect
// ChatGPT", "Connect Claude", ...) or "Connected" with Disconnect, and a small
// "Manage my keys in Perspicax" link while no subscription is signed in on an
// engine whose provider key a person can keep in Perspicax. The payer order
// itself stays the server's (server/engine-credentials.ts, `myTurns` on
// GET /api/me/engines); the subscription signs in through
// `/api/me/engines/<id>/login`, never the server's own engine login.
import { useState } from "react";
import { Check, ExternalLink, Loader2, LogOut } from "lucide-react";

import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { perspicaxKeysUrl, type MyEngine } from "@/lib/perspicax-org";
import { engineUnavailable, keyProviderDriver } from "@/lib/model-payers";
import { ClaudeSignIn } from "./ClaudeSignIn";
import { DeviceSignIn } from "./DeviceSignIn";
import { MyEngineAccess, connectName } from "./settings/MyEngines";

export { connectName };

/** The engine can still be connected from this card (a subscription sign-in or
 * a key in Perspicax), so a bare `installed: false` is a signed-out state, not
 * missing software. */
function engineConnectable(engine: Partial<Pick<MyEngine, "subscription" | "driver">>): boolean {
  return engine.subscription?.supported === true || (engine.driver ? keyProviderDriver(engine.driver) : false);
}

/** The one status line: what pays for the person's turns today. */
export function paysWithText(
  engine: Pick<MyEngine, "myTurns" | "installed" | "notAvailable"> & Partial<Pick<MyEngine, "subscription" | "driver">>,
): string {
  // Only the image deliberately not carrying the engine is "not available".
  if (engineUnavailable(engine)) return t("myEngines.notAvailable");
  // A bare `installed: false` reads as "not installed" only when there is no
  // way to connect it here; a signed-out subscription or key engine is simply
  // "not connected" (the Grok lockout: a logout must not say "not installed").
  if (!engine.installed && !engineConnectable(engine)) return t("myEngines.notInstalled");
  if (engine.installed) {
    if (engine.myTurns === "subscription") return t("engineConnect.paysWith.subscription");
    if (engine.myTurns === "key") return t("engineConnect.paysWith.key");
    if (engine.myTurns === "org-key") return t("engineConnect.paysWith.orgKey");
  }
  return t("engineConnect.notConnected");
}

/** The person's own subscription on this engine signs out (Disconnect, here
 * and on the model window's provider row). */
export async function signOutMyEngine(instanceId: string): Promise<void> {
  await api(`/api/me/engines/${encodeURIComponent(instanceId)}/login/sign-out`, { method: "POST", body: "{}" });
}

/** The card has something to show besides the status line and Disconnect:
 * a Connect button, or the link to the person's keys in Perspicax. */
export function engineConnectHasAction(engine: MyEngine): boolean {
  const { supported, signedIn } = engine.subscription;
  if (engineUnavailable(engine)) return false;
  return !signedIn && (supported || keyProviderDriver(engine.driver));
}

/** The `data-pays-with` marker for the status line. */
function paysWithState(engine: MyEngine): string {
  if (engineUnavailable(engine)) return "not-available";
  if (!engine.installed && !(engine.subscription.supported || keyProviderDriver(engine.driver))) return "not-installed";
  return engine.installed ? engine.myTurns : "none";
}

/** The one status line, as a paragraph. */
export function PaysWithLine({ engine, className = "text-[12px]" }: { engine: MyEngine; className?: string }) {
  return (
    <p data-pays-with={paysWithState(engine)}
      title={engineUnavailable(engine) ? engine.notAvailable : undefined}
      className={cn("text-ink-secondary", className)}>{paysWithText(engine)}</p>
  );
}

export function EngineConnect({ engine, issuer, onChanged, className, statusLine = true, disconnect: showDisconnect = true }: {
  engine: MyEngine;
  issuer: string;
  /** Reload the person's engines after a sign-in or sign-out. */
  onChanged: () => Promise<unknown> | void;
  className?: string;
  /** The "Pays with" line; the model window shows it under the engine's
   * name instead. */
  statusLine?: boolean;
  /** Connected and Disconnect; the model window puts Disconnect on the
   * provider's row instead (2026-10-15). */
  disconnect?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const loginBase = `/api/me/engines/${encodeURIComponent(engine.instanceId)}/login`;
  const name = connectName(engine);
  const { supported, signedIn } = engine.subscription;
  const keysApply = !engineUnavailable(engine) && !signedIn && keyProviderDriver(engine.driver);

  const disconnect = async () => {
    setBusy(true);
    setError("");
    try {
      await signOutMyEngine(engine.instanceId);
      await onChanged();
    } catch {
      setError(t("myEngines.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section data-engine-connect={engine.instanceId} className={cn("flex min-w-0 flex-col gap-2", className)}>
      {statusLine && <PaysWithLine engine={engine} />}
      {/* Connect/Disconnect is gated on the engine being connectable here, not
          on the bare `installed` probe: a signed-out subscription engine must
          always offer an enabled Connect (the Grok lockout, where a logout read
          as "not installed" and disabled the only way back in). */}
      {!engineUnavailable(engine) && supported && (signedIn ? showDisconnect && (
        <div data-engine-connected className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[12.5px] text-success"><Check size={13} aria-hidden="true" />{t("engineConnect.connected")}</span>
          <button type="button" disabled={busy} onClick={() => void disconnect()}
            className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px] text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-50">
            {busy ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <LogOut size={12} aria-hidden="true" />}
            {t("engineConnect.disconnect")}
          </button>
        </div>
      ) : (
        <div data-engine-connect-button className="[&>div]:mt-0">
          {engine.driver === "claudeAgent"
            ? <ClaudeSignIn key={engine.instanceId} instanceId={engine.instanceId} base={loginBase} onSignedIn={onChanged} />
            : engine.driver === "codex"
              ? <DeviceSignIn key={engine.instanceId} instanceId={engine.instanceId} base={loginBase} onSignedIn={onChanged} />
              // Grok Build and Kimi Code: a device code on the provider's own page
              : <MyEngineAccess key={engine.instanceId} engine={engine} label={t("engineConnect.connect", { name })} onChanged={() => { void onChanged(); }} />}
        </div>
      ))}
      {keysApply && (
        <a href={perspicaxKeysUrl(issuer)} target="_blank" rel="noreferrer noopener" data-engine-keys-link
          className="flex w-fit items-center gap-1 text-[11.5px] text-ink-secondary hover:text-ink hover:underline">
          {t("myEngines.manageKeys")} <ExternalLink size={11} aria-hidden="true" />
        </a>
      )}
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
    </section>
  );
}
