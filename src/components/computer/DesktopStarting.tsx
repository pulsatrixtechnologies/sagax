// The desktop view's waiting state (#3386): while a desktop starts, connects
// or waits for its first frame, the app's own activity dots (WorkingDots)
// pulse above a short label in the middle of the screen, never a still black
// area. Shared by the server environment desktop, this computer's live
// screen and a remote session's screen.
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { WorkingDots } from "../WorkingIndicator";

export function DesktopStarting({ label, className }: {
  /** Defaults to "Starting desktop". */
  label?: string;
  className?: string;
}) {
  return (
    <div role="status" data-desktop-starting="" className={cn("flex flex-col items-center gap-3 px-6 text-center", className)}>
      <WorkingDots size={8} className="gap-1.5" />
      <p className="text-[13px] font-medium">{label ?? t("sandboxDesktop.connecting")}</p>
    </div>
  );
}
