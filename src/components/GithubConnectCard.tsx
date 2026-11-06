// The GitHub sign-in card a bot posts in its chat (#2109, 2026-11-05, JC:
// every GitHub connection uses a generated GitHub link plus a pairing code,
// the token is the last resort). connect_github starts GitHub's device flow
// for the person speaking; this card shows the code with Copy code and the
// github.com link with Open link, then turns into "GitHub connected as
// @login" when the server patches it. It stays in the bot's chat: no Open
// thread, no side panel (shared/github-connect-card.ts).
import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";

import { Github } from "@/components/brand-icons";
import { openExternalLink } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import type { GithubConnectCard as Card } from "../../shared/github-connect-card";

const ACTION_PILL = "inline-flex shrink-0 items-center gap-1 rounded-full border border-hairline/50 px-3 py-1 text-[12.5px] font-medium text-ink transition-colors hover:bg-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";

/** github.com (or a GitHub Enterprise host) over https only. */
function safeLink(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function expiryLabel(expiresAt: number | undefined, now: number): string | null {
  if (!expiresAt) return null;
  const minutes = Math.ceil((expiresAt - now) / 60_000);
  if (minutes <= 0) return t("chat.githubConnect.expired");
  return t("chat.githubConnect.expiresIn", { minutes: String(minutes) });
}

export function GithubConnectCard({ card, now = Date.now() }: { card: Card; now?: number }) {
  const [copied, setCopied] = useState(false);
  const link = safeLink(card.verificationUri);
  const title = card.state === "connected"
    ? t("chat.githubConnect.connected", { login: card.login ?? "" })
    : card.state === "failed"
      ? t("chat.githubConnect.failed")
      : card.state === "cancelled"
        ? t("chat.githubConnect.cancelled")
        : t("chat.githubConnect.title");
  const expiry = card.state === "pending" ? expiryLabel(card.expiresAt, now) : null;
  return (
    <section
      data-github-connect-card
      data-github-connect-state={card.state}
      aria-label={title}
      className={cn(
        "relative w-full max-w-[520px] overflow-hidden rounded-2xl border bg-card px-3.5 py-3 shadow-sm",
        card.state === "connected" ? "border-success/40" : card.state === "failed" ? "border-danger/40" : "border-hairline/60",
      )}
    >
      <div className="flex items-start gap-3">
        <div aria-hidden="true" className="flex size-[30px] shrink-0 items-center justify-center rounded-xl bg-inset">
          {card.state === "connected" ? <Check size={15} className="text-success" /> : <Github size={15} className="text-ink" />}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-semibold leading-snug text-ink">{title}</h3>
          {card.state === "pending" && (
            <>
              <p className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">{t("chat.githubConnect.steps")}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code data-github-connect-code className="rounded-lg bg-inset px-3 py-1.5 font-mono text-[17px] tracking-widest text-ink">{card.userCode}</code>
                <button
                  type="button"
                  data-github-connect-copy
                  className={ACTION_PILL}
                  onClick={() => {
                    void copyText(card.userCode ?? "").then((result) => setCopied(result === "copied"));
                  }}
                >
                  {copied ? t("chat.githubConnect.copied") : t("myConnections.github.copyCode")}
                  {copied ? <Check aria-hidden="true" size={12} /> : <Copy aria-hidden="true" size={12} />}
                </button>
                {link && (
                  <button type="button" data-github-connect-open className={ACTION_PILL} onClick={() => void openExternalLink(link)}>
                    {t("chat.githubConnect.openLink")}
                    <ExternalLink aria-hidden="true" size={12} />
                  </button>
                )}
              </div>
              {expiry && <p className="mt-1.5 text-[11.5px] text-ink-secondary" data-github-connect-expiry>{expiry}</p>}
            </>
          )}
          {card.state === "failed" && card.error && (
            <p role="alert" className="mt-0.5 text-[12px] leading-relaxed text-danger">{card.error}</p>
          )}
          {card.state === "cancelled" && (
            <p className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">{t("chat.githubConnect.cancelledHint")}</p>
          )}
        </div>
      </div>
    </section>
  );
}
