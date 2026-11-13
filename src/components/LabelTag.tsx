// The small tag a label is drawn with: a bot's label (Bot Settings > Title)
// and a person's custom label (src/lib/person-labels.ts) look the same
// wherever they show. `tone` follows the surface (the sidebar's own colours,
// or a content surface); `size` the row (a list row, or the smaller pinned
// tile, a faint filled tag). Nothing renders for an empty label.
import { cn } from "@/lib/cn";
import { usePersonLabel } from "@/lib/person-labels";

export function LabelTag({ text, tone = "sidebar", size = "row", className }: {
  text: string | null | undefined;
  tone?: "sidebar" | "surface";
  size?: "row" | "small";
  className?: string;
}) {
  const label = text?.trim();
  if (!label) return null;
  // Same markup as the bot row's tag always had (one span, classes in this
  // order), so the tag looks and tests the same for bots and people. The
  // pinned tile's tag is the reference window's: a faint fill and outline.
  const small = size === "small";
  return (
    <span
      className={cn(
        className,
        "truncate rounded-[5px] border",
        tone === "sidebar" ? (small ? "border-sidebar-ink/[0.055] bg-sidebar-ink/[0.02]" : "border-sidebar-hairline bg-sidebar-hover") : (small ? "border-ink/[0.055] bg-ink/[0.02]" : "border-hairline-weak bg-hover"),
        small ? "px-1" : "px-1.5",
        small ? "text-[11.5px] leading-[17px]" : "text-[11px] leading-4",
        tone === "sidebar" ? "text-sidebar-ink-secondary" : "text-ink-secondary",
      )}
    >
      {label}
    </span>
  );
}

/** A person's label from the shared store, as a LabelTag. */
export function PersonLabelTag({ principalId, ...rest }: { principalId: string | null | undefined } & Omit<Parameters<typeof LabelTag>[0], "text">) {
  const label = usePersonLabel(principalId);
  return <LabelTag text={label} {...rest} />;
}

/** A bot's role beside its name in a sidebar row or under its pinned tile,
 * as the reference app writes it (#4093, the owner's side by side of
 * 2026-11-12): in a row, " · Role" on the name's line, 14px regular in the
 * rail's secondary ink, no outline or fill; under a pinned tile, the role as
 * plain secondary text under the name. In a row it gives way first, down to
 * 2em, so a short name stays whole (#2992). The shrink weight is huge on
 * purpose: flex shares the overflow by weight times width, and at 999 the
 * name still lost a fraction of a pixel and showed an ellipsis ("Feedba..."). */
export function BotRoleTag({ text, tile = false, className }: { text: string | null | undefined; tile?: boolean; className?: string }) {
  const label = text?.trim();
  if (!label) return null;
  if (tile) {
    return (
      <span data-bot-role-tag="" className={cn("block max-w-full truncate text-center text-[12px] font-normal leading-4 text-sidebar-ink-secondary", className)}>
        {label}
      </span>
    );
  }
  return (
    <span
      data-bot-role-tag=""
      className={cn(
        "flex min-w-[2em] max-w-fit shrink-[100000] basis-auto items-baseline gap-1 overflow-hidden text-[14px] font-normal leading-5 text-sidebar-ink-secondary",
        className,
      )}
    >
      <span aria-hidden="true" className="shrink-0">·</span>
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}
