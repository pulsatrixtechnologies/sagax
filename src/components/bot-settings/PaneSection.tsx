// One section of a bot editor page, drawn like a Settings group (the maintainer
// 2026-10-16: every window follows Settings): a short grey heading outside
// the card, an optional info button for the longer explanation, an optional
// action at the right of the heading, then the controls in one rounded
// card. `plain` keeps the heading only, for a body that is a list or a
// card of its own.
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { HelpTip, useSettingsSurface } from "../SettingsPrimitives";
import { useRepeatsModalTitle } from "../bot-profile/modal-title";

/** The card a section's controls sit in (a SettingsGroup's card, with
 * room for free-form controls rather than rows). */
export const PANE_CARD = "rounded-xl border-[0.5px] border-border bg-elevated px-3.5 py-3";
/** The same card on the plain surface (the bot's profile page, #2313):
 * one filled rounded card, no border, as Channels and Access. */
export const PLAIN_PANE_CARD = "rounded-2xl bg-card px-4 py-3";

export function PaneSection({
  title,
  help,
  action,
  plain,
  children,
  className,
  ...rest
}: {
  title?: ReactNode;
  /** The detail behind the info button next to the title. */
  help?: ReactNode;
  /** A button or link at the right of the title. */
  action?: ReactNode;
  /** The heading only: the body draws its own list or card. */
  plain?: boolean;
  children?: ReactNode;
  className?: string;
} & Record<`data-${string}`, string | undefined>) {
  const label = typeof title === "string" ? title : "";
  const repeated = useRepeatsModalTitle(title);
  const plainSurface = useSettingsSurface() === "plain";
  const card = plainSurface ? PLAIN_PANE_CARD : PANE_CARD;
  return (
    <section {...rest} data-pane-section="" className={cn("flex min-w-0 flex-col gap-2", className)}>
      {((title && !repeated) || help || action) && (
        // on the bot page (the plain surface) the grey label sits 12px in, as its cards' labels (#4420): the Bot folder under To review
        <div className={cn("flex min-h-6 items-center gap-1.5", plainSurface ? "px-3" : "px-1")}>
          {title && <h3 className={cn("flex min-w-0 items-center gap-1.5 text-[13px] font-normal leading-[18px] text-ink-secondary", repeated && "sr-only")}>{title}</h3>}
          {/* with no visible title, the help rides with the action on the right */}
          {help && <span className={cn("flex", repeated && "ml-auto")}><HelpTip label={t("settings.moreAbout", { title: label })}>{help}</HelpTip></span>}
          {action && <div className={cn("flex shrink-0 items-center gap-2", !repeated || !help ? "ml-auto" : "")}>{action}</div>}
        </div>
      )}
      {children && (plain ? <div className="flex min-w-0 flex-col gap-2">{children}</div> : <div className={card} data-settings-surface="">{children}</div>)}
    </section>
  );
}

/** How a full-width list sits in a section's card: its rows reach the
 * card's edges and keep the card's side padding. The plain surface (the
 * bot's profile page) draws the reference rows: a 14px title, a 12px
 * subtitle and no rule between rows, as Channels and Access. */
export function usePaneRows() {
  const plain = useSettingsSurface() === "plain";
  return plain
    ? { plain, bleed: "-mx-4", list: "", row: "px-4", title: "text-[14px] leading-5", note: "text-[12px] leading-4" }
    : { plain, bleed: "-mx-3.5", list: "divide-y divide-hairline/40", row: "px-3.5", title: "text-[13px]", note: "text-[12px]" };
}

/** A section's quiet one-line state ("No topic files yet."). */
export function PaneEmpty({ children }: { children: ReactNode }) {
  return <p className="text-[12px] text-ink-secondary">{children}</p>;
}
