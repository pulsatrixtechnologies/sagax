// Settings > Model providers on a server signed in with Perspicax (slice 4):
// each engine card carries the person's own access (2026-10-02; the separate
// "My subscriptions and keys" card is gone): what their own turns on it run
// with (their subscription, their key, the organization's key: on their bots
// and on bots shared with them), their own subscription sign-in (Claude,
// Codex), never the server's, and one link to their model keys in Perspicax.
// Keys are never set here: they live in Perspicax.
import { useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";

import { ApiError, api } from "@/state/store";
import { t } from "@/lib/i18n";
import { openExternalLink } from "@/lib/app-links";
import { perspicaxKeysUrl, reloadMyEngines, type MyEngine } from "@/lib/perspicax-org";
import { engineUnavailable } from "@/lib/model-payers";

interface LoginState {
  flowId: string | null;
  authorizationUrl: string | null;
  userCode?: string;
  phase: string;
  message?: string;
}

/** https only, with no embedded credentials. The server already limits device
 * pages to the provider's own host. */
function signInPage(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

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
 * Codex, Grok Build, Kimi Code): sign in, paste the code or follow the link, sign out. */
export function MyEngineAccess({ engine, label, onChanged = () => { void reloadMyEngines(); } }: {
  engine: MyEngine;
  /** The sign-in button's text ("Connect Grok"). */
  label?: string;
  onChanged?: () => void;
}) {
  const [login, setLogin] = useState<LoginState | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const id = engine.instanceId;

  const stopPolling = () => {
    if (poll.current) clearInterval(poll.current);
    poll.current = null;
  };
  useEffect(() => stopPolling, []);
  const watch = (flowId: string) => {
    stopPolling();
    poll.current = setInterval(() => {
      void api<{ auth: LoginState }>(`/api/me/engines/${id}/login/status?flowId=${encodeURIComponent(flowId)}`)
        .then(({ auth }) => {
          if (auth.phase === "waiting") return;
          stopPolling();
          setLogin(null);
          if (auth.phase !== "succeeded") setError(engineSignInError(engine, auth.message ? new Error(auth.message) : null));
          onChanged();
        })
        .catch((cause) => {
          // The server is still writing the flow. The next poll asks again.
          if (cause instanceof ApiError && cause.status === 409) return;
          stopPolling();
          setLogin(null);
          setError(engineSignInError(engine, cause));
        });
    }, 1500);
  };
  const post = (action: string, body: unknown = {}) =>
    api<{ auth?: LoginState }>(`/api/me/engines/${id}/login/${action}`, { method: "POST", body: JSON.stringify(body) });

  const signIn = async () => {
    setBusy(true);
    setError("");
    try {
      const { auth } = await post("start");
      if (!auth || auth.phase === "succeeded") {
        onChanged();
        return;
      }
      setLogin(auth);
      const page = signInPage(auth.authorizationUrl);
      if (page) void openExternalLink(page).catch(() => {});
      if (auth.flowId) watch(auth.flowId);
    } catch (cause) {
      setError(engineSignInError(engine, cause));
    } finally {
      setBusy(false);
    }
  };
  const complete = async () => {
    if (!login?.flowId || !code.trim()) return;
    setBusy(true);
    try {
      await post("complete", { flowId: login.flowId, code: code.trim() });
      setCode("");
      // The code is in: reload now rather than wait for the next poll.
      onChanged();
    } catch (cause) {
      setError(engineSignInError(engine, cause));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (!login) return;
    stopPolling();
    try { await post("cancel", { flowId: login.flowId }); } catch { /* the flow ends anyway */ }
    setLogin(null);
  };
  const signOut = async () => {
    setBusy(true);
    try {
      await post("sign-out");
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
  if (engineUnavailable(engine) || !engine.subscription.supported) return null;
  return (
    <div className="flex min-w-0 flex-col gap-2 text-[13px]" data-my-engine={id}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] text-ink-secondary">{engine.subscription.signedIn ? t("myEngines.signedIn") : null}</span>
        {engine.subscription.signedIn ? (
          <button type="button" className="ui-button" disabled={busy} onClick={() => void signOut()}>{t("myEngines.signOut")}</button>
        ) : (
          <button type="button" className="ui-button flex items-center gap-1.5" disabled={busy || login !== null} onClick={() => void signIn()}>
            {busy ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : null}
            {label ?? t("myEngines.signIn")}
          </button>
        )}
      </div>
      {login && (
        <div className="flex flex-col gap-2 rounded-lg border border-hairline/40 p-3">
          {login.userCode && <span className="font-mono text-[13px] text-ink">{t("myEngines.code", { code: login.userCode })}</span>}
          {signInPage(login.authorizationUrl) && (
            <button type="button" className="w-fit text-left text-[12px] text-accent underline" onClick={() => void openExternalLink(signInPage(login.authorizationUrl)!)}>{t("myEngines.openLink")}</button>
          )}
          {!login.userCode && (
            <div className="flex flex-wrap gap-2">
              <input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder={t("myEngines.pasteCode")}
                aria-label={t("myEngines.pasteCode")}
                className="min-w-0 flex-1 rounded-lg border border-hairline/40 bg-inset px-3 py-1.5 text-[13px] text-ink"
              />
              <button type="button" className="ui-button" disabled={!code.trim() || busy} onClick={() => void complete()}>{t("myEngines.complete")}</button>
            </div>
          )}
          <button type="button" className="ui-button w-fit" onClick={() => void cancel()}>{t("myEngines.cancel")}</button>
        </div>
      )}
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
    </div>
  );
}
