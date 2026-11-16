// Settings > Model providers on a server signed in with Perspicax (slice 4):
// each engine card carries the person's own access (2026-10-02; the separate
// "My subscriptions and keys" card is gone): what their own turns on it run
// with (their subscription, their key, the organization's key: on their bots
// and on bots shared with them), their own subscription sign-in (Claude,
// Codex), never the server's, and one link to their model keys in Perspicax.
// Keys are never set here: they live in Perspicax.
import { useState } from "react";
import { ExternalLink } from "lucide-react";

import { t } from "@/lib/i18n";
import { perspicaxKeysUrl, reloadMyEngines, type MyEngine } from "@/lib/perspicax-org";
import { engineUnavailable } from "@/lib/model-payers";
import { signOutMyEngine } from "../EngineConnect";
import { AccountSignIn, signInWay } from "./AccountSignIn";

/** The name on the Connect button: the account people sign in with. */
export function connectName(engine: Pick<MyEngine, "driver" | "displayName">): string {
  switch (engine.driver) {
    case "codex": return "ChatGPT";
    case "claudeAgent": return "Claude";
    case "grokAgent": return "Grok";
    case "kimiAgent": return "Kimi";
    case "geminiAgent": return "Gemini";
    default: return engine.displayName;
  }
}

/** The words under a refused sign-in. The server's "<engine> is not installed
 * on this server." is a spawn failure of the sign-in command; on an engine the
 * server lists as installed, it means the person is not connected, not that
 * software is missing, so the card says to connect. A host that really lacks
 * the engine (installed false) keeps its own wording. */
export function engineSignInError(engine: Pick<MyEngine, "installed" | "driver" | "displayName">, cause: unknown): string {
  const message = cause instanceof Error ? cause.message.trim() : "";
  if (engine.installed && /is not installed on this server/i.test(message)) {
    return t("engineConnect.notConnectedHint", { name: connectName(engine) });
  }
  return message || t("myEngines.failed");
}

/** The one "Manage my keys in Perspicax" link of the page. */
export function ManageMyKeysLink({ issuer }: { issuer: string }) {
  return (
    <a href={perspicaxKeysUrl(issuer)} target="_blank" rel="noreferrer noopener" data-my-keys-link
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-[12px] font-medium text-ink-secondary hover:bg-control hover:text-ink">
      <ExternalLink size={13} aria-hidden="true" />
      {t("myEngines.manageKeys")}
    </a>
  );
}

/** One engine's own subscription sign-in for the signed-in person (Claude,
 * Codex, Grok Build, Kimi Code): sign in through the one sign-in flow, sign out. */
export function MyEngineAccess({ engine, label, onChanged = () => { void reloadMyEngines(); }, account, signedIn: signedInOverride }: {
  engine: MyEngine;
  /** The sign-in button's text ("Connect Grok"). */
  label?: string;
  onChanged?: () => void;
  /** 2026-10-29: the person's second sign-in on this engine (`?account=second`). */
  account?: "second";
  /** That sign-in's own state, when it is not the engine's first one. */
  signedIn?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const signedIn = signedInOverride ?? engine.subscription.signedIn;
  const way = signInWay(undefined, engine, account);
  const signOut = async () => {
    setBusy(true);
    setError("");
    try {
      await signOutMyEngine(engine.instanceId, account);
      onChanged();
    } catch (cause) {
      setError(engineSignInError(engine, cause));
    } finally {
      setBusy(false);
    }
  };

  // Gate on connectability, not the bare `installed` probe: a signed-out
  // subscription engine still offers Connect (the Grok lockout). Only an engine
  // the image deliberately does not carry (engineUnavailable) withholds it.
  if (engineUnavailable(engine) || !way) return null;
  const id = engine.instanceId;
  return (
    <div className="flex min-w-0 flex-col gap-2 text-[13px]" data-my-engine={account ? `${id}#${account}` : id}>
      {signedIn ? (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <span className="text-[12px] text-ink-secondary">{t("myEngines.signedIn")}</span>
          <button type="button" className="ui-button" disabled={busy} onClick={() => void signOut()}>{t("myEngines.signOut")}</button>
        </div>
      ) : (
        // the one sign-in flow of every provider (#4415)
        <AccountSignIn way={way} onSignedIn={onChanged} name={connectName(engine)} label={label ?? t("myEngines.signIn")}
          explain={(cause) => engineSignInError(engine, cause)} />
      )}
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
    </div>
  );
}
