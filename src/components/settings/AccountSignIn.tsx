// #4415 (the owner 2026-11-15 on a provider's Accounts: "why does the first
// one says connect claude ?? I already have the sign in button", and on the
// sign-in that opened under it: "This looks awful."): ONE sign-in flow for
// every account of every provider, drawn in the account's own row.
//
// - The row's Sign in starts it; while it runs, the row's button is replaced
//   by the flow's state ("Waiting for sign-in...") and a quiet Cancel.
// - Under the row, no card: one short sentence with the expiry, then the
//   step: the code to enter on the vendor's page (a device code), the field
//   for the code the vendor's page shows (a pasted code), or nothing more
//   than the page that opened (a browser sign-in). "Open sign-in page" is the
//   page's grey pill, never a brand-coloured or full-width button.
// - The steps stay honest: the vendor's page, the code, finish; the expiry;
//   only a code from a sign-in started here; the bots share the plan's limits.
//
// The same verbs on both servers: `/api/instances/<id>/auth` (the server's
// own engine) or `/api/me/engines/<id>/login` (the person's own sign-in on an
// organization server), start, status, complete, cancel.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy, ExternalLink, Loader2, X } from "lucide-react";

import { api, type InstanceInfo } from "@/state/store";
import { activeLocale, t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { openExternalLink } from "@/lib/app-links";
import { useCopyFeedback } from "@/lib/copy-text";
import { readableError } from "@/lib/plain-error";
import type { MyEngine } from "@/lib/perspicax-org";
import { cursorSignInLink } from "../../../shared/cli-sign-in";
import { deviceSignInLink, isDeviceSignInCode, type DeviceSignInProvider } from "../../../shared/device-sign-in";
import { claudeSignInLink } from "../ClaudeSignIn";
import { chatgptPlanLink, deviceFlowUnavailable, deviceSignInProvider, type DeviceSignInStatus } from "../DeviceSignIn";
import { needsSignIn } from "../EngineSetup";
import { FIELD } from "../SettingsPrimitives";
import { pluginActionClass } from "../plugins/plugins-style";
import { StatusText } from "./SettingsPatterns";

/** How an account signs in here: a code the vendor's page shows, pasted
 * back ("paste"); a code to enter on the vendor's page ("device"); the
 * vendor's page alone ("page"). */
export type SignInKind = "paste" | "device" | "page";

/** Whose page the link may be (the links are checked, never raw output). */
export type SignInVendor = "claude" | "chatgpt" | "cursor" | DeviceSignInProvider | "other";

export interface SignInWay {
  /** The verbs' base path, without the verb. */
  base: string;
  /** `account=second`: the person's second sign-in on the engine (Grok). */
  query?: string;
  kind: SignInKind;
  vendor: SignInVendor;
}

/** How an account signs in from its row, or null when it does not sign in
 * in the app (its setup opens instead: an install, a terminal command). */
export function signInWay(instance: InstanceInfo | undefined, mine: MyEngine | undefined, slot?: "second"): SignInWay | null {
  if (mine) {
    if (!mine.subscription.supported) return null;
    const base = `/api/me/engines/${encodeURIComponent(mine.instanceId)}/login`;
    const query = slot ? `account=${slot}` : undefined;
    // Claude shows a code to paste back; the others a code to enter on their page
    if (mine.driver === "claudeAgent") return { base, ...(query ? { query } : {}), kind: "paste", vendor: "claude" };
    const vendor: SignInVendor = mine.driver === "codex" || mine.driver === "grokAgent" || mine.driver === "kimiAgent" ? deviceSignInProvider(mine.driver) : "other";
    return { base, ...(query ? { query } : {}), kind: "device", vendor };
  }
  if (!instance || !needsSignIn(instance)) return null;
  const base = `/api/instances/${encodeURIComponent(instance.instanceId)}/auth`;
  switch (instance.authentication?.method) {
    case "paste-code": return { base, kind: "paste", vendor: "claude" };
    case "device-code": return { base, kind: "device", vendor: deviceSignInProvider(instance.driverKind) };
    case "browser-pkce": return { base, kind: "page", vendor: "chatgpt" };
    case "open-link": return { base, kind: "page", vendor: "cursor" };
    default: return null;
  }
}

/** https only, with no embedded credentials (the organization's server
 * already limits the page to the vendor's own host). */
function httpsPage(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

/** The vendor's sign-in page of a flow, or null when it is not one. */
export function signInLink(way: Pick<SignInWay, "vendor" | "base">, auth: Pick<DeviceSignInStatus, "authorizationUrl" | "userCode">): string | null {
  const personal = way.base.startsWith("/api/me/");
  switch (way.vendor) {
    case "claude": return claudeSignInLink(auth.authorizationUrl);
    case "chatgpt": return chatgptPlanLink(auth.authorizationUrl);
    case "cursor": return cursorSignInLink(auth.authorizationUrl);
    case "other": return personal ? httpsPage(auth.authorizationUrl) : null;
    default: return deviceSignInLink(way.vendor, auth.authorizationUrl, auth.userCode) ?? (personal ? httpsPage(auth.authorizationUrl) : null);
  }
}

type Busy = "start" | "finish" | "cancel" | null;

export interface AccountSignInFlow {
  /** A sign-in is in progress (the row shows its state, not its button). */
  running: boolean;
  auth: DeviceSignInStatus | null;
  busy: Busy;
  /** What ended it, in the person's words (expired, failed); null otherwise. */
  outcome: string | null;
  code: string;
  setCode: (code: string) => void;
  start: () => Promise<void>;
  finish: () => Promise<void>;
  cancel: () => Promise<void>;
}

const ended = (phase: "expired" | "failed", message?: string): DeviceSignInStatus => ({ phase, flowId: null, authorizationUrl: null, expiresAt: null, ...(message ? { message } : {}) });

/** The one sign-in flow (#4415): start, wait (the server is asked every 2
 * seconds while the vendor's page does its part), finish with a pasted code,
 * cancel. A finished sign-in hands over to `onSignedIn` and leaves nothing
 * behind: the row says Connected. */
export function useAccountSignIn(
  way: SignInWay | null,
  onSignedIn: () => Promise<unknown> | void,
  /** The words of a refused start or code, when the surface has its own. */
  explain: (cause: unknown) => string = readableError,
): AccountSignInFlow {
  const [auth, setAuth] = useState<DeviceSignInStatus | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const done = useRef(onSignedIn);
  done.current = onSignedIn;
  const path = (verb: string, extra = "") => {
    const query = [extra, way?.query ?? ""].filter(Boolean).join("&");
    return `${way?.base ?? ""}/${verb}${query ? `?${query}` : ""}`;
  };
  const succeed = async () => {
    setAuth(null);
    setCode("");
    setError(null);
    await done.current();
  };

  const waiting = auth?.phase === "waiting" && Boolean(auth.flowId);
  useEffect(() => {
    if (!way || !waiting || !auth) return;
    const controller = new AbortController();
    const remaining = auth.expiresAt ? Date.parse(auth.expiresAt) - Date.now() : Number.NaN;
    const expiry = Number.isFinite(remaining)
      ? window.setTimeout(() => { controller.abort(); setAuth(ended("expired")); }, Math.max(0, remaining))
      : null;
    // a pasted code finishes it; the other kinds end on the vendor's page
    const poll = way.kind === "paste" || busy ? null : window.setTimeout(() => {
      void api(path("status", `flowId=${encodeURIComponent(auth.flowId!)}`), { signal: controller.signal })
        .then(async ({ auth: next }: { auth: DeviceSignInStatus }) => {
          if (controller.signal.aborted) return;
          if (next.phase === "succeeded") { await succeed(); return; }
          if (next.phase === "cancelled") { setAuth(null); return; }
          setAuth(next.phase === "waiting" ? { ...auth, ...next } : next);
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          if (deviceFlowUnavailable(cause)) { setAuth(ended("failed", t("providers.signIn.ended"))); return; }
          // a passing network failure: ask again, never start another sign-in
          setAuth({ ...auth });
        });
    }, 2000);
    return () => {
      if (expiry !== null) window.clearTimeout(expiry);
      if (poll !== null) window.clearTimeout(poll);
      controller.abort();
    };
  }, [auth, busy, waiting]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    if (!way || busy) return;
    setBusy("start");
    setError(null);
    setCode("");
    try {
      const { auth: next }: { auth: DeviceSignInStatus } = await api(path("start"), { method: "POST", body: "{}" });
      if (next.phase === "succeeded") { await succeed(); return; }
      setAuth(next);
      // a browser sign-in has nothing to enter here: its page opens at once
      const link = way.kind === "page" && next.phase === "waiting" ? signInLink(way, next) : null;
      if (link) void openExternalLink(link).catch(() => {});
    } catch (cause) {
      setAuth(null);
      setError(explain(cause));
    } finally {
      setBusy(null);
    }
  };

  const finish = async () => {
    if (!way || !auth?.flowId || busy || !code.trim()) return;
    setBusy("finish");
    setError(null);
    try {
      // the server answers once the sign-in is confirmed: a 200 is the success
      await api(path("complete"), { method: "POST", body: JSON.stringify({ flowId: auth.flowId, code: code.trim() }) });
      await succeed();
    } catch (cause) {
      if (deviceFlowUnavailable(cause)) {
        // the server already knows the outcome: ask it rather than guess
        try {
          const { auth: next }: { auth: DeviceSignInStatus } = await api(path("status", `flowId=${encodeURIComponent(auth.flowId)}`));
          if (next.phase === "succeeded") await succeed();
          else setAuth(next.phase === "waiting" ? next : ended("failed", next.message || t("providers.signIn.ended")));
        } catch {
          setAuth(ended("failed", t("providers.signIn.ended")));
        }
        return;
      }
      setError(explain(cause));
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    const flowId = auth?.flowId;
    if (!way || busy) return;
    setBusy("cancel");
    try {
      if (flowId) await api(path("cancel"), { method: "POST", body: JSON.stringify({ flowId }) });
    } catch {
      // the sign-in ends here either way; the server lets go of it on its own
    } finally {
      setAuth(null);
      setCode("");
      setError(null);
      setBusy(null);
    }
  };

  const running = busy === "start" || auth?.phase === "waiting";
  const outcome = error
    ?? (auth?.phase === "expired" ? t("providers.signIn.expired")
      : auth?.phase === "failed" ? auth.message || t("providers.signIn.failed")
        : null);
  return { running, auth, busy, outcome, code, setCode, start, finish, cancel };
}

/** What the row shows in place of its button while a sign-in runs: the
 * flow's state, and Cancel as a quiet action. */
export function SignInState({ flow, name }: { flow: AccountSignInFlow; name: string }) {
  return (
    <span data-sign-in-state="" className="flex shrink-0 items-center gap-2">
      <span role="status" className="flex items-center gap-1.5 text-[12px] leading-4 text-ink-secondary">
        <Loader2 size={12} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
        {flow.busy === "start" ? t("providers.signIn.starting") : t("providers.signIn.waiting")}
      </span>
      <button type="button" data-sign-in-cancel="" disabled={flow.busy === "cancel" || flow.busy === "finish"} onClick={() => void flow.cancel()}
        aria-label={`${t("common.cancel")} · ${name}`}
        className="rounded-md px-1.5 py-0.5 text-[12px] leading-4 text-ink-secondary outline-none transition-colors hover:bg-ink/[0.06] hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/70 disabled:opacity-50 motion-reduce:transition-none">
        {t("common.cancel")}
      </button>
    </span>
  );
}

/** The code to enter on the vendor's page, with its copy button. */
function DeviceCode({ code }: { code: string }) {
  const { state, copy } = useCopyFeedback(code);
  const label = t(state === "failed" ? "common.copyFailed" : "engineSetup.device.copyCode");
  return (
    <span className="inline-flex items-center gap-1" data-sign-in-code="">
      <code className="select-all font-mono text-[13px] font-medium leading-[18px] tracking-wider text-ink">{code}</code>
      <button type="button" onClick={copy} aria-label={label} title={label}
        className="flex size-6 items-center justify-center rounded-full text-ink-tertiary transition-colors hover:bg-ink/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 motion-reduce:transition-none">
        {state === "copied" ? <Check size={12} aria-hidden="true" className="text-success" /> : state === "failed" ? <X size={12} aria-hidden="true" className="text-danger" /> : <Copy size={12} aria-hidden="true" />}
      </button>
    </span>
  );
}

/** Under the row while a sign-in runs (or once it ended badly): one short
 * sentence with the expiry, then the one step left. Nothing once it is done. */
export function SignInSteps({ flow, way, rowId, inset = true }: {
  flow: AccountSignInFlow;
  way: SignInWay;
  rowId: string;
  /** In an account row the steps line up with the row's text; elsewhere they
   * sit flush under the button. */
  inset?: boolean;
}) {
  const auth = flow.auth;
  const pad = inset ? "px-3.5" : "";
  if (!flow.running && flow.outcome) {
    return <p data-sign-in-outcome={rowId} role="status" className={cn(pad, inset && "pb-2.5", "text-[12px] leading-4")}><StatusText tone="warning">{flow.outcome}</StatusText></p>;
  }
  if (!auth || auth.phase !== "waiting") return null;
  const link = signInLink(way, auth);
  // a code is shown only in its vendor's own shape, never raw output
  const known = way.vendor === "codex" || way.vendor === "grok" || way.vendor === "kimi";
  const deviceCode = way.kind === "device" && auth.userCode && (!known || isDeviceSignInCode(way.vendor as DeviceSignInProvider, auth.userCode)) ? auth.userCode : null;
  // a code from the vendor's page comes back here (Claude; a person's sign-in that names no code to enter)
  const paste = way.kind === "paste" || (way.kind === "device" && !auth.userCode);
  if (!link || (way.kind === "device" && auth.userCode && !deviceCode)) {
    return <p data-sign-in-outcome={rowId} role="alert" className={cn(pad, inset && "pb-2.5", "text-[12px] leading-4 text-danger")}>{t("providers.signIn.invalid")}</p>;
  }
  const expires = auth.expiresAt && Number.isFinite(Date.parse(auth.expiresAt))
    ? t("providers.signIn.expires", { time: new Date(auth.expiresAt).toLocaleTimeString(activeLocale(), { hour: "2-digit", minute: "2-digit" }) })
    : null;
  const sentence = t(paste ? "providers.signIn.paste" : deviceCode ? "providers.signIn.device" : "providers.signIn.page");
  const codeId = `sign-in-code-${rowId}`;
  return (
    <div data-sign-in-steps={rowId} className={cn("flex min-w-0 flex-col gap-2", pad, inset && "pb-3")}>
      <p className="text-[12px] leading-4 text-ink-secondary">{expires ? `${sentence} ${expires}` : sentence}</p>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {deviceCode && <DeviceCode code={deviceCode} />}
        <a href={link} target="_blank" rel="noopener noreferrer" data-sign-in-open=""
          onClick={(event) => { if (window.ogb?.openExternal) { event.preventDefault(); void openExternalLink(link); } }}
          className={pluginActionClass("fill")}>
          {t("providers.signIn.open")}<ExternalLink size={12} aria-hidden="true" />
        </a>
        {paste && (
          <form className="flex min-w-0 flex-1 basis-56 items-center gap-2" onSubmit={(event) => { event.preventDefault(); void flow.finish(); }}>
            <label htmlFor={codeId} className="sr-only">{t("providers.signIn.codeLabel")}</label>
            <input id={codeId} data-sign-in-code-input="" value={flow.code} onChange={(event) => flow.setCode(event.target.value)}
              placeholder={t("providers.signIn.codeLabel")} autoComplete="off" spellCheck={false} disabled={flow.busy === "finish"}
              className={cn(FIELD, "h-[26px] min-h-0 flex-1 py-0.5 font-mono md:min-h-0")} />
            <button type="submit" data-sign-in-finish="" disabled={flow.busy !== null || !flow.code.trim()} className={pluginActionClass("fill")}>
              {flow.busy === "finish" && <Loader2 size={12} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
              {t("providers.signIn.finish")}
            </button>
          </form>
        )}
      </div>
      {/* a refused code keeps the step and says why */}
      {flow.outcome && <p data-sign-in-outcome={rowId} role="alert" className="text-[12px] leading-4 text-danger">{flow.outcome}</p>}
    </div>
  );
}

/** The same flow where a sign-in is offered outside a provider's account
 * rows (a reconnect under the plan's usage, the onboarding, a chat that needs
 * an engine, the organization's engine setup): the button, then the flow's
 * state in its place while it runs, then the steps under it. */
export function AccountSignIn({ way, onSignedIn, label, name, explain, hint, className, ...data }: {
  way: SignInWay;
  onSignedIn: () => Promise<unknown> | void;
  /** The button's words ("Connect Claude"). */
  label: string;
  /** Whose sign-in, for the Cancel button's accessible name. */
  name: string;
  explain?: (cause: unknown) => string;
  /** One more line under an ended sign-in, when the vendor has a known fix. */
  hint?: (outcome: string) => ReactNode;
  className?: string;
} & Record<`data-${string}`, string | boolean | undefined>) {
  const flow = useAccountSignIn(way, onSignedIn, explain);
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return (
    <div {...data} data-account-sign-in="" className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div className="flex min-w-0 items-center">
        {flow.running
          ? <SignInState flow={flow} name={name} />
          : (
            <button type="button" data-sign-in-start="" disabled={flow.busy !== null} onClick={() => void flow.start()} className={pluginActionClass("fill")}>
              {flow.outcome ? t("engineSetup.device.tryAgain") : label}
            </button>
          )}
      </div>
      <SignInSteps flow={flow} way={way} rowId={id} inset={false} />
      {!flow.running && flow.outcome && hint?.(flow.outcome)}
    </div>
  );
}
