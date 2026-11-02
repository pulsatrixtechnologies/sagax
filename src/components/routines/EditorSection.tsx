// One section of "Edit routine" (2026-10-29, polish 2026-11-01): When, What,
// Where results go. Sentence-case label (never all-caps), quiet icon, then the
// fields. Matches the Grok Bot form density in docs/design/ux-reference-grokbot-cursor.md.
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function EditorSection({ icon: Icon, title, children, className, ...rest }: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  className?: string;
} & Record<`data-${string}`, string>) {
  return <section {...rest} className={["space-y-2", className].filter(Boolean).join(" ")}>
    <h3 className="flex items-center gap-1.5 text-[12px] font-medium leading-4 text-ink-secondary">
      <Icon size={13} strokeWidth={1.75} aria-hidden="true" className="text-ink-tertiary" />
      {title}
    </h3>
    <div className="min-w-0 space-y-3">{children}</div>
  </section>;
}

/** A help text one click away: an info button whose text is also read by
 * assistive technology, instead of a paragraph under every field. */
export function HelpTip({ id, text }: { id: string; text: string }) {
  return <span className="group relative inline-flex">
    <button type="button" aria-label={text} title={text} className="flex size-5 items-center justify-center rounded-full text-[11px] font-semibold text-ink-secondary hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-focus">?</button>
    <span id={id} className="sr-only">{text}</span>
  </span>;
}
