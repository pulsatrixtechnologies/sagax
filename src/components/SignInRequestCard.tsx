import { useState } from "react";
import { Check, Hand, Loader2, LockKeyhole, LogIn, RefreshCw, X } from "lucide-react";

import type { ComputerHelpRef } from "../../shared/wire";
import { signInOutcome } from "../../shared/sign-in-request";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { answerSignIn, signInHostIsHere } from "@/lib/sign-in";
import { useStore, type Message } from "@/state/store";
import { ASK_CHIP, ASK_CHIP_IDLE, ASK_PRIMARY_BUTTON, ASK_QUIET_BUTTON, AskCard, AskSettledLine, returnFocusToComposer } from "./AskCard";

// A bot asked the person to sign in to a site themselves (request_sign_in).
// The site is the headline and the bot's reason is quoted as its own words.
// Open goes to the exact place the bot works — the login only reaches the
// bot there — and Done or Cancel resumes it. The card answers only that:
// Sagax keeps no saved login of its own here (its credential vault and
// secure fill are separate).

/** Where to sign in, by place; "host" is this computer seen from elsewhere. */
const WHERE = {
  browser: "signIn.where.browser",
  vm: "signIn.where.vm",
  cloud: "signIn.where.cloud",
  local: "signIn.where.local",
  host: "signIn.where.host",
} as const;

export function SignInRequestCard({
  botId,
  botName,
  threadId,
  message,
}: {
  botId: string;
  botName: string;
  threadId: string;
  message: Message;
}) {
  const { dispatch } = useStore();
  const card = message.signIn!;
  const [pending, setPending] = useState<"done" | "cancel" | null>(null);
  const [explained, setExplained] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const error = localError ?? card.error;
  const outcome = signInOutcome(card);
  const ref = { botId, threadId, messageId: message.id, place: card.place };
  // This computer is the person's own only in the desktop app hosting the
  // bot; anywhere else it is the computer Sagax runs on.
  const here = signInHostIsHere();

  const answer = async (choice: "done" | "cancel") => {
    if (pending) return;
    setPending(choice);
    setLocalError(null);
    try {
      await answerSignIn(ref, choice);
      returnFocusToComposer();
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(null);
    }
  };

  // Stop ended the turn this card paused: nothing resumes, whatever is
  // answered afterwards (the answer is kept).
  const stopped = card.stopped === true;

  if (card.superseded || (stopped && !outcome)) {
    return (
      <AskSettledLine icon={<X size={13} />} ariaLabel={t("signIn.title")}>
        <span className="text-ink-secondary">{card.site}</span>
        <span> · {t(card.superseded ? "signIn.superseded" : "chat.turnStopped")}</span>
      </AskSettledLine>
    );
  }

  if (outcome) {
    const retry = !card.resumed && !stopped && error ? (
      <button type="button" onClick={() => void answer(outcome === "done" ? "done" : "cancel")} disabled={pending !== null}
        className={cn(ASK_QUIET_BUTTON, "text-accent-text")}>
        {pending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        {t("signIn.retry")}
      </button>
    ) : undefined;
    return (
      <AskSettledLine
        ariaLabel={t("signIn.title")}
        icon={outcome === "cancelled" ? <X size={13} className="text-ink-tertiary" /> : card.resumed || stopped ? undefined : error ? <LogIn size={13} /> : <Loader2 size={13} className="animate-spin" />}
        action={retry}
        detail={error && <p role="alert" className="ms-[19px] mt-1 text-[12px] text-danger">{error}</p>}
      >
        <span className="text-ink-secondary">{t(outcome === "done" ? "signIn.settled.done" : "signIn.settled.cancelled", { site: card.site })}</span>
        <span> · {card.resumed ? t("signIn.settled.resumed", { name: botName }) : stopped ? t("chat.turnStopped") : error ? t("signIn.settled.failed") : t("signIn.settled.waiting")}</span>
      </AskSettledLine>
    );
  }

  const where = WHERE[card.place === "local" && !here ? "host" : card.place];
  const open = () => {
    if (card.place === "local") setExplained(true);
    else dispatch({ type: "openSignIn", botId, messageId: message.id, url: card.url, site: card.site, place: card.place });
  };
  return (
    <AskCard
      ariaLabel={t("signIn.cardLabel", { name: botName, site: card.site })}
      icon={<LogIn size={15} />}
      title={t("signIn.title")}
      footer={<>
        <button type="button" onClick={() => void answer("cancel")} disabled={pending !== null} className={cn(ASK_CHIP, ASK_CHIP_IDLE)}>
          {pending === "cancel" ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
          {t("signIn.cancel")}
        </button>
        <button type="button" onClick={open} disabled={pending !== null} className={cn(ASK_CHIP, ASK_CHIP_IDLE)}>
          <LogIn size={14} />
          {t("signIn.open")}
        </button>
        <button type="button" onClick={() => void answer("done")} disabled={pending !== null} className={ASK_PRIMARY_BUTTON}>
          {pending === "done" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {t("signIn.done")}
        </button>
      </>}
    >
      <div dir="ltr" className="break-all text-[20px] font-semibold leading-7 text-ink" data-testid="sign-in-site">{card.site}</div>
      {card.reason && (
        <blockquote className="mt-1.5 border-s-2 border-hairline ps-2.5 text-[13px] leading-snug text-ink-secondary">
          <bdi dir="auto">“{card.reason}”</bdi> <span className="text-ink-tertiary">— {botName}</span>
        </blockquote>
      )}
      <p className="mt-2 text-[12.5px] leading-snug text-ink-secondary">{t(where, { name: botName })}</p>
      {explained && (
        <p role="note" className="mt-1.5 text-[12.5px] leading-snug text-ink">{t(here ? "signIn.local.explain" : "signIn.local.explainHost", { name: botName })}</p>
      )}
      <p className="mt-2 flex items-center gap-1 text-[11.5px] text-ink-tertiary">
        <LockKeyhole size={11} aria-hidden="true" /> {t("signIn.private")}
      </p>
      {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
    </AskCard>
  );
}

/** The bot's open sign-in request where the person is signing in: the
 * Computer panel and the remote client's panel. It names the site and offers
 * the card's own Done and Cancel; a computer's banner adds Take control. */
export function SignInBanner({
  help,
  askerName,
  takeControl,
  onError,
}: {
  help: ComputerHelpRef;
  askerName: string;
  takeControl?: { onClick: () => void; disabled?: boolean; pending?: boolean };
  onError?: (message: string | null) => void;
}) {
  const [pending, setPending] = useState<"done" | "cancel" | null>(null);
  const answer = async (choice: "done" | "cancel") => {
    if (pending) return;
    setPending(choice);
    onError?.(null);
    try { await answerSignIn(help, choice); }
    catch (cause) { onError?.(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPending(null); }
  };
  return (
    <div className="mt-3 rounded-xl border border-warning/25 bg-warning/10 p-4 text-start" data-testid="sign-in-banner">
      <div className="text-[13px] leading-relaxed text-warning">
        <b>{askerName}</b> {t("signIn.banner", { site: help.site })}
      </div>
      {help.place === "local" && (
        <div className="mt-1 text-[12px] leading-relaxed text-ink-secondary">
          {t(signInHostIsHere() ? "signIn.where.local" : "signIn.where.host", { name: askerName })}
        </div>
      )}
      <div className="mt-2 flex gap-2">
        {takeControl && (
          <button
            type="button"
            onClick={takeControl.onClick}
            disabled={takeControl.disabled}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent py-2 text-[13px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-50"
          >
            {takeControl.pending ? <Loader2 size={14} className="animate-spin" /> : <Hand size={14} />}
            {t("computer.takeControl")}
          </button>
        )}
        <button
          type="button"
          onClick={() => void answer("done")}
          disabled={pending !== null}
          className={cn("flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium disabled:opacity-50",
            takeControl ? "bg-control text-ink hover:bg-raised-hover" : "flex-1 bg-accent text-accent-ink hover:brightness-110")}
        >
          {pending === "done" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {t("signIn.done")}
        </button>
        <button
          type="button"
          onClick={() => void answer("cancel")}
          disabled={pending !== null}
          className="rounded-lg bg-control px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50"
        >
          {t("signIn.cancel")}
        </button>
      </div>
    </div>
  );
}
