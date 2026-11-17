// A row's state as ONE small icon, no text (#4453, the owner's review of
// after-v4: "should be a tooltip with an icon"): a green check for connected,
// an orange warning for what the person can fix (key expired, key missing,
// key refused, to connect), a grey info for what they cannot fix here (not
// offered on this deployment, setup an administrator must finish). The whole
// sentence is the tooltip and the accessible name; the icon is focusable, so
// the keyboard reaches the tooltip. A warning is a button: it opens what fixes
// it (the key field, the sign-in), as the words did.
import { useId } from "react";
import { Check, Info, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/cn";
import { TipBubble, TipHost } from "../TipBubble";
import type { PluginStatus } from "@/lib/plugins-model";
import { t } from "@/lib/i18n";

export type StateTone = "ok" | "fix" | "info";

export interface RowState {
  tone: StateTone;
  /** the full sentence: the tooltip and the accessible name */
  text: string;
  /** a warning opens what fixes it */
  onFix?: () => void;
}

const ICON = { ok: Check, fix: TriangleAlert, info: Info } as const;
const INK: Record<StateTone, string> = { ok: "text-success", fix: "text-warning", info: "text-ink-tertiary" };

/** The app's tooltip shape (NudgeButton's): a `role="tooltip"` that opens on
 * hover and on focus within, wired to its trigger with aria-describedby. */
export function StateIcon({ state }: { state: RowState }) {
  const tipId = useId();
  const Glyph = ICON[state.tone];
  const face = cn("inline-flex size-7 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong", INK[state.tone]);
  const icon = <Glyph size={state.tone === "ok" ? 15 : 16} strokeWidth={state.tone === "ok" ? 2.5 : 2} aria-hidden="true" />;
  return (
    <TipHost className="shrink-0" data-row-state={state.tone}>
      {state.tone === "fix" && state.onFix ? (
        <button type="button" aria-label={state.text} aria-describedby={tipId} data-row-state-fix="" onClick={(event) => { event.stopPropagation(); state.onFix?.(); }} className={cn(face, "hover:bg-warning/10")}>
          {icon}
        </button>
      ) : (
        <span role="img" tabIndex={0} aria-label={state.text} aria-describedby={tipId} className={face}>{icon}</span>
      )}
      <TipBubble id={tipId} wide data-row-state-tooltip="">{state.text}</TipBubble>
    </TipHost>
  );
}

/** A catalog or installed row's status as an icon state: connected is a
 * check, needs sign-in is a warning that opens the row; off and available
 * say nothing (the switch and the Install button already do). */
export function statusState(status: PluginStatus, onFix?: () => void): RowState | null {
  if (status === "connected") return { tone: "ok", text: t("connectApps.status.connected") };
  if (status === "needs_auth") return { tone: "fix", text: t("connectApps.status.needsAuth"), onFix };
  if (status === "pending") return { tone: "info", text: t("connectApps.status.pending") };
  return null;
}
