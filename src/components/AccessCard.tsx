// A turn that could not run on an organization server (slice 3): the
// engine is not installed, no credentials serve the turn, or the provider
// refused the key. Since 2026-10-01 the person who speaks pays (the bot's
// owner for its routines), and the server sends the card to that person only
// (accessCardAudience in server/engines/engine-access.ts): it speaks to them ("you"),
// with what to do (sign in with their own subscription, add their key in
// Perspicax) and, for an admin only, where the organization's key lives. The
// third-person lines remain for a viewer the card is not about (a card the
// server still shares: a refused organization key). Slice 6: a routine the
// server paused shows one neutral line (its person is out, or lost the
// right to run the bot). Since 2026-10-08 a routine always acts in its
// owner's name: there is no delegation card and no button, and an old card
// for a missing, ended or revoked delegation shows nothing.
//
// #1137: a person writing to someone else's bot whose replies each person
// pays for reads that the person who writes pays, with the bot's name, and
// may choose a model they can pay for (the model window, their own model
// for that bot). When the owner pays, a turn on the owner's computer's
// model that is offline says so by name; a refusal of the owner's own
// access tells the person who wrote that the owner pays.
import { CheckCircle2, KeyRound } from "lucide-react";

import { activeLocale, t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { accessNoticePlace } from "@/lib/access-notice";
import { useMyEngines } from "@/lib/perspicax-org";
import { formatTime, type Message } from "@/state/store";
import { SettingsText } from "./SettingsLink";
import type { WireAccessCard } from "../../shared/wire";
import { permissionMissingText } from "@/lib/permissions";
import { openModelWindow } from "@/lib/model-window";

export type AccessViewer = { principalId: string | null; admin: boolean };

const ROUTINE_REASON_KEYS = {
  person_out: "access.routineDelegation.reason.person_out",
  no_right: "access.routineDelegation.reason.no_right",
} as const;

export interface AccessCardLines {
  text: string;
  hint?: string;
  detail?: string;
  /** Where the viewer adds their own key (Perspicax console). */
  link?: { href: string; label: string };
  /** The viewer can sign in with their own subscription for this engine
   * (Settings > Model providers > My subscriptions and keys). */
  signIn?: boolean;
  /** A routine the server paused: one neutral status line, no card. */
  plain?: boolean;
  /** #1137: offer to choose a model the viewer can pay for. */
  chooseModel?: boolean;
  /** The sign-in button's words, when not "Sign in with my subscription"
   * (#1533: "Reconnect Claude"). */
  signInLabel?: string;
}

const same = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());

/** The card's lines for this viewer: the reason, then what the person whose
 * credentials the turn needed can do, or an admin. Null: nothing to show (an
 * old routine delegation card). */
export function accessCardLines(access: WireAccessCard, viewer: AccessViewer): AccessCardLines | null {
  const owner = same(viewer.principalId, access.ownerPrincipalId);
  if (access.reason === "routine_delegation") {
    const reason = access.suspendReason;
    if (reason !== "person_out" && reason !== "no_right") return null;
    return {
      text: t("access.routinePaused", { routine: access.routineName ?? "", reason: t(ROUTINE_REASON_KEYS[reason]) }),
      plain: true,
    };
  }
  // #1545: a bot asks the person to sign in to an engine or account
  if (access.reason === "sign_in") {
    return { text: t("access.signInRequested", { bot: access.botName?.trim() || t("access.thisBot"), engine: access.engine }), signIn: true };
  }
  if (access.reason === "engine_missing") {
    return { text: t("access.engineMissing", { engine: access.engine }), ...(owner && !viewer.admin ? { hint: permissionMissingText("engines.manage") } : {}) };
  }
  if (access.reason === "key_refused") {
    return {
      text: t("access.keyRefused"),
      ...(viewer.admin ? { hint: t("access.keyRefused.admin") } : {}),
      ...((owner || viewer.admin) && access.detail ? { detail: access.detail } : {}),
    };
  }
  const engine = access.engine;
  const bot = access.botName?.trim() || t("access.thisBot");
  // #1137: the owner pays, and their computer's model is offline.
  if (access.cause === "owner_model_offline") {
    const name = access.ownerName?.trim();
    return { text: name ? t("access.ownerModelOffline", { owner: name }) : t("access.ownerModelOffline.unnamed") };
  }
  // whose credentials the turn needed: the speaker, or the owner for a
  // routine; a card from before payerPrincipalId is the owner's (as on the server)
  const payer = access.payerPrincipalId || access.ownerPrincipalId;
  // #4233: a server engine's fix card is for the administrators who reconnect it
  const server = Boolean(access.audiencePrincipalIds?.length);
  const mine = server ? access.audiencePrincipalIds!.some((id) => same(viewer.principalId, id)) : same(viewer.principalId, payer);
  // #4233: a backup runs meanwhile; the card says which, and what brings the engine back
  if (access.meanwhile && (access.cause === "sign_in_expired" || access.cause === "out_of_credit")) {
    if (!mine) return { text: t("access.noAccess.other", { engine }) };
    const words = { engine, backup: access.meanwhile };
    if (access.cause === "out_of_credit") return { text: t(server ? "access.serverOutOfCredit.meanwhile" : "access.outOfCredit.meanwhile", words) };
    return { text: t(server ? "access.serverSignInExpired.meanwhile" : "access.signInExpired.meanwhile", words), signIn: true, signInLabel: t("engineConnect.reconnect", { name: engine }) };
  }
  // #1533: the person's own subscription sign-in expired: they reconnect it
  if (access.cause === "sign_in_expired") {
    if (!mine) return { text: t("access.noAccess.other", { engine }) };
    return { text: t("access.signInExpired", { bot, engine }), signIn: true, signInLabel: t("engineConnect.reconnect", { name: engine }) };
  }
  const admin = viewer.admin ? { hint: t("access.noAccess.admin.orgKey") } : {};
  // the person it is about, an admin: the organization's key is theirs to set too
  const mineAdmin = viewer.admin ? { hint: t("access.noAccess.mine.admin") } : {};
  // #1137: the owner pays for this bot, and the viewer is the person who
  // wrote, not the owner: the owner's access is what is missing.
  if (access.ownerPays && !mine) {
    return { text: t(access.cause === "payer_disabled" ? "access.ownerPays.disabled" : "access.ownerPays.other", { bot, engine }) };
  }
  if (access.cause === "payer_disabled") {
    if (access.routine || access.payer === "owner") return { text: t(mine ? "access.payerDisabled.routineMine" : "access.payerDisabled.owner") };
    return mine ? { text: t("access.payerDisabled.speaker") } : { text: t("access.noAccess.other", { engine }) };
  }
  if (access.cause === "server_engine_not_allowed") {
    const ownWays = {
      ...(access.keysUrl ? { link: { href: access.keysUrl, label: t("access.addKey") } } : {}),
      ...(access.subscriptionSignIn ? { signIn: true } : {}),
    };
    if (!mine) return { text: t("access.noAccess.other", { engine }), ...(viewer.admin ? { hint: t("access.serverEngine.admin") } : {}) };
    if (access.speakerPays && !access.routine) return { text: t("access.speakerPays.serverEngine", { bot, engine }), ...ownWays, chooseModel: true };
    return { text: t(access.routine ? "access.serverEngine.routineMine" : "access.serverEngine.mine", { engine }), ...ownWays };
  }
  const own = {
    ...(access.keysUrl ? { link: { href: access.keysUrl, label: t("access.addKey") } } : {}),
    ...(access.subscriptionSignIn ? { signIn: true } : {}),
  };
  if (access.routine) {
    return mine
      ? { text: t("access.noAccess.routineMine", { engine }), ...mineAdmin, ...own }
      : { text: t("access.noAccess.routine", { engine }), ...admin };
  }
  if (mine && access.speakerPays) return { text: t("access.speakerPays", { bot, engine }), ...mineAdmin, ...own, chooseModel: true };
  if (mine && access.ownerPays) return { text: t("access.ownerPays.mine", { bot, engine }), ...mineAdmin, ...own };
  if (mine) return { text: t("access.noAccess.mine", { engine }), ...mineAdmin, ...own };
  return { text: t("access.noAccess.other", { engine }), ...admin };
}

/** The card's words, hint, actions and detail: one body for the passing
 * banner (AccessCard) and the conversation's row (AccessNoticeRow). A
 * resolved card keeps its words and detail, without its actions. */
function AccessCardBody({ access, lines, onSignIn, resolved }: { access: WireAccessCard; lines: AccessCardLines; onSignIn?: () => void; resolved?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="break-words">{lines.text}</span>
      {!resolved && lines.hint && (
        lines.hint.includes("{settings}")
          ? <SettingsText text={lines.hint} links={{ settings: { section: "providers" } }} className="break-words text-[12px] text-ink-secondary" />
          : <span className="break-words text-[12px] text-ink-secondary">{lines.hint}</span>
      )}
      {!resolved && ((lines.signIn && onSignIn) || lines.link || lines.chooseModel) ? (
        <div className="flex flex-wrap items-center gap-2">
          {lines.chooseModel && (
            <button type="button" className="ui-button min-h-[44px] w-fit md:min-h-0" onClick={() => openModelWindow(access.botId)} data-access-choose-model>
              {t("access.chooseModel")}
            </button>
          )}
          {lines.signIn && onSignIn && (
            <button type="button" className="ui-button min-h-[44px] w-fit md:min-h-0" onClick={onSignIn} data-access-sign-in>
              {lines.signInLabel ?? t("access.signIn")}
            </button>
          )}
          {lines.link && (
            <a href={lines.link.href} target="_blank" rel="noreferrer noopener" className="break-words text-[12px] text-accent underline" data-access-add-key>{lines.link.label}</a>
          )}
        </div>
      ) : null}
      {lines.detail && <code className="break-words text-[11.5px] text-ink-secondary">{lines.detail}</code>}
    </div>
  );
}

/** The passing banner's card (TransientNotice: a routine's access card). */
export function AccessCard({ access, viewer, onSignIn }: { access: WireAccessCard; viewer: AccessViewer; onSignIn?: () => void }) {
  const lines = accessCardLines(access, viewer);
  if (!lines) return null;
  if (lines.plain) {
    return <p role="status" data-access-card={access.reason} className="break-words text-[12px] text-ink-secondary">{lines.text}</p>;
  }
  return (
    <div role="status" data-access-card={access.reason} className="flex w-fit max-w-full items-start gap-2 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-[13px] text-ink">
      <KeyRound size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-warning" />
      <AccessCardBody access={access} lines={lines} onSignIn={onSignIn} />
    </div>
  );
}

/** #3656: the card as a row of the conversation (a 1:1 chat and a room
 * alike): drawn as the bot's message, under it the person's message that got
 * no answer with its time, and marked resolved once the access works again
 * (src/lib/access-notice.ts). Never a status docked to the composer. */
export function AccessNoticeRow({ message, transcript, viewer, onSignIn, room }: { message: Message; transcript: readonly Message[]; viewer: AccessViewer; onSignIn?: () => void; room?: boolean }) {
  const engines = useMyEngines();
  const access = message.access;
  const lines = access ? accessCardLines(access, viewer) : null;
  if (!access || !lines) return null;
  if (lines.plain) {
    return <p role="status" data-access-card={access.reason} className="break-words text-[12px] text-ink-secondary">{lines.text}</p>;
  }
  const { failed: place, laterAsks, mine, resolved } = accessNoticePlace(message, transcript, engines, viewer.principalId, room);
  // someone else's message is never "your": the card then shows its own time
  const failed = mine ? place : undefined;
  return (
    <div className="flex justify-start" data-access-notice={resolved ? "resolved" : "open"}>
      <div className="flex w-fit max-w-[min(42rem,78%)] flex-col items-start">
        <div role="status" data-access-card={access.reason} className={cn("flex items-start gap-2 rounded-[18px] bg-bubble-bot px-3 py-[7px] text-[13px] leading-5", resolved ? "text-ink-secondary" : "text-ink")}>
          {resolved
            ? <CheckCircle2 size={14} aria-hidden="true" className="mt-[3px] shrink-0 text-success" />
            : <KeyRound size={14} aria-hidden="true" className="mt-[3px] shrink-0 text-warning" />}
          <div className="flex min-w-0 flex-col gap-1">
            {resolved && <span className="break-words font-medium text-ink">{t("access.notice.resolved", { engine: access.engine })}</span>}
            <AccessCardBody access={access} lines={lines} onSignIn={onSignIn} resolved={resolved} />
          </div>
        </div>
        <span className="mt-1 px-1 text-[11px] text-ink-tertiary" title={new Date((failed ?? message).at).toLocaleString(activeLocale())}>
          {!failed ? formatTime(message.at)
            : laterAsks ? t("access.notice.failedMessages", { count: laterAsks + 1, time: formatTime(failed.at) })
            : t("access.notice.failedMessage", { time: formatTime(failed.at) })}
        </span>
      </div>
    </div>
  );
}
