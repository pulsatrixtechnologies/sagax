// Text that reads as plain text and becomes a field on click: the bot's (and
// a group's) name and label at the top of its side panel. Enter or leaving
// the field saves, Escape restores what was there. A hover shows a pencil so
// it reads as editable; without `onSave` it is plain text.
import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";

import { cn } from "@/lib/cn";

/** What a commit should do with the typed text: nothing when it did not
 * change, nothing for an empty required value, else the trimmed text. */
export function inlineEditCommit(draft: string, current: string, { required }: { required: boolean }): string | null {
  const next = draft.trim();
  if (next === current.trim()) return null;
  if (required && !next) return null;
  return next;
}

export function InlineEditableText({
  value,
  onSave,
  placeholder,
  maxLength,
  required = false,
  ariaLabel,
  id,
  className,
  inputClassName,
  muted = false,
  editRequest = 0,
}: {
  value: string;
  /** Absent: shown read-only. */
  onSave?: (next: string) => void;
  /** Shown (muted) when the value is empty, e.g. "Add a label". */
  placeholder?: string;
  maxLength?: number;
  /** An empty value is refused (a name); otherwise it clears the field. */
  required?: boolean;
  ariaLabel: string;
  id?: string;
  className?: string;
  inputClassName?: string;
  muted?: boolean;
  /** Counts up each time something else asks for the field (the mascot
   * menu's Rename the bot): each new value opens it. */
  editRequest?: number;
}) {
  const [editing, setEditing] = useState(false);
  const editable = onSave !== undefined;
  useEffect(() => { if (editRequest > 0 && editable) setEditing(true); }, [editRequest, editable]);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const shown = value.trim();
  if (!onSave) {
    return shown ? <span id={id} className={cn("max-w-full truncate", className)}>{shown}</span> : null;
  }

  const commit = () => {
    const next = inlineEditCommit(draft, value, { required });
    setEditing(false);
    if (next === null) { setDraft(value); return; }
    onSave(next);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        id={id}
        aria-label={ariaLabel}
        data-inline-edit="input"
        value={draft}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
          if (event.key === "Escape") {
            // Escape cancels the edit only; the panel stays open.
            event.preventDefault();
            event.stopPropagation();
            event.nativeEvent.stopImmediatePropagation?.();
            setDraft(value);
            setEditing(false);
          }
        }}
        className={cn(
          "w-full max-w-full rounded-md border border-hairline/50 bg-inset px-2 py-0.5 text-center text-ink placeholder:text-ink-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
          className,
          inputClassName,
        )}
      />
    );
  }

  return (
    <button
      type="button"
      id={id}
      aria-label={ariaLabel}
      data-inline-edit="text"
      title={ariaLabel}
      onClick={() => setEditing(true)}
      className={cn(
        "group/inline relative inline-flex max-w-full items-center justify-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        className,
      )}
    >
      <span className={cn("min-w-0 truncate", (!shown || muted) && "text-ink-secondary")}>{shown || placeholder}</span>
      {/* the pencil overlays the right edge, outside the text: it never takes room at rest (#2126) */}
      <Pencil size={11} aria-hidden="true" className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 text-ink-secondary opacity-0 transition-opacity group-hover/inline:opacity-100 group-focus-within/inline:opacity-100 touch:opacity-100" />
    </button>
  );
}
