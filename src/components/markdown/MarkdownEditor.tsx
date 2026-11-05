// The one markdown editor of the app: a bot's soul, its memory files, a
// skill's instructions, routine and trigger instructions, group and team
// instructions, group memory, About me. Same look and the same shortcuts
// everywhere (docs/markdown-editor.md).
//
// The text stays plain markdown and every caller keeps its own value,
// onChange and save path; this component only edits. The CodeMirror half
// (MarkdownEditorCore.tsx) is its own chunk, loaded on first mount; until it
// arrives (or if it cannot load) a plain textarea with the same value, label
// and handlers stands in, so typing is never blocked.
//
// Preview renders with ChatMarkdown, the renderer of chat messages, so what
// the preview shows is what a bot's markdown looks like in the app.
//
// Simple mode keeps the five everyday buttons (bold, italic, bullets,
// checklist, link) and puts the rest behind "More"; Advanced shows them all
// and adds the side by side view.
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import {
  Bold,
  Code,
  Columns2,
  Ellipsis,
  Eye,
  Heading,
  Italic,
  Link,
  List,
  Maximize2,
  Minimize2,
  ListChecks,
  ListOrdered,
  Minus,
  PenLine,
  Table,
  TextQuote,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useAdvancedMode } from "@/lib/interface-mode";
import { isMacPlatform } from "@/lib/keyboard-shortcuts";
import { ChatMarkdown } from "../ChatMarkdown";
import {
  countCharacters,
  countWords,
  cycleHeading,
  formatMarkdown,
  insertLink,
  insertRule,
  insertTable,
  minimalChange,
  setHeading,
  toggleCode,
  toggleLinePrefix,
  toggleWrap,
  type TextSelection,
} from "./markdown-edits";
import type { MarkdownCoreHandle, MarkdownCoreProps, MarkdownEditFn, MarkdownShortcut } from "./markdown-editor-types";

type CoreComponent = (props: MarkdownCoreProps) => ReactNode;

let corePromise: Promise<CoreComponent> | undefined;
let coreReady: CoreComponent | undefined;

/** Load the CodeMirror chunk once; a failed load is forgotten so the next
 * mount asks again (the textarea keeps working meanwhile). */
export function loadMarkdownEditorCore(): Promise<CoreComponent> {
  corePromise ??= import("./MarkdownEditorCore").then(
    (module) => (coreReady = module.default),
    (error: unknown) => {
      corePromise = undefined;
      throw error;
    },
  );
  return corePromise;
}

export type MarkdownAction =
  | "bold"
  | "italic"
  | "heading"
  | "bullet"
  | "numbered"
  | "task"
  | "quote"
  | "code"
  | "link"
  | "table"
  | "rule"
  | "format";

type ViewMode = "write" | "preview" | "split";

const VIEW_KEY = "sagax.markdownEditor.view.v1";

function readView(): ViewMode {
  try {
    const stored = globalThis.localStorage?.getItem(VIEW_KEY);
    if (stored === "preview" || stored === "split") return stored;
  } catch {
    // blocked storage: start on Write
  }
  return "write";
}

function writeView(mode: ViewMode) {
  try {
    // Preview is a per-field moment, not a preference; only Split sticks
    globalThis.localStorage?.setItem(VIEW_KEY, mode === "split" ? "split" : "write");
  } catch {
    // blocked storage: the choice lasts for this editor only
  }
}

/** Format the whole text, keeping the caret on the same text. */
function formatAll(state: TextSelection): TextSelection {
  const next = formatMarkdown(state.doc);
  if (next === state.doc) return state;
  const change = minimalChange(state.doc, next);
  const map = (pos: number) => (pos <= change.from ? pos : pos >= change.to ? pos + change.insert.length - (change.to - change.from) : change.from + change.insert.length);
  return { doc: next, from: Math.min(map(state.from), next.length), to: Math.min(map(state.to), next.length) };
}

export const MARKDOWN_ACTIONS: Record<MarkdownAction, { icon: LucideIcon; label: () => string; keys?: string; edit: () => MarkdownEditFn }> = {
  bold: { icon: Bold, label: () => t("markdownEditor.bold"), keys: "Mod-b", edit: () => (s) => toggleWrap(s, "**", t("markdownEditor.boldPlaceholder")) },
  italic: { icon: Italic, label: () => t("markdownEditor.italic"), keys: "Mod-i", edit: () => (s) => toggleWrap(s, "_", t("markdownEditor.italicPlaceholder")) },
  heading: { icon: Heading, label: () => t("markdownEditor.heading"), keys: "Mod-Alt-1", edit: () => cycleHeading },
  bullet: { icon: List, label: () => t("markdownEditor.bulletList"), keys: "Mod-Shift-8", edit: () => (s) => toggleLinePrefix(s, "bullet") },
  numbered: { icon: ListOrdered, label: () => t("markdownEditor.numberedList"), keys: "Mod-Shift-7", edit: () => (s) => toggleLinePrefix(s, "numbered") },
  task: { icon: ListChecks, label: () => t("markdownEditor.checklist"), keys: "Mod-Shift-9", edit: () => (s) => toggleLinePrefix(s, "task") },
  quote: { icon: TextQuote, label: () => t("markdownEditor.quote"), keys: "Mod-Shift-.", edit: () => (s) => toggleLinePrefix(s, "quote") },
  code: { icon: Code, label: () => t("markdownEditor.code"), keys: "Mod-e", edit: () => (s) => toggleCode(s, t("markdownEditor.codePlaceholder")) },
  link: { icon: Link, label: () => t("markdownEditor.link"), keys: "Mod-k", edit: () => (s) => insertLink(s, t("markdownEditor.linkPlaceholder")) },
  table: { icon: Table, label: () => t("markdownEditor.table"), edit: () => (s) => insertTable(s, { column: (n) => t("markdownEditor.tableColumn", { n }) }) },
  rule: { icon: Minus, label: () => t("markdownEditor.rule"), edit: () => insertRule },
  format: { icon: WandSparkles, label: () => t("markdownEditor.format"), keys: "Shift-Alt-f", edit: () => formatAll },
};

const SIMPLE_ACTIONS: MarkdownAction[] = ["bold", "italic", "bullet", "task", "link"];
const ALL_ACTIONS: MarkdownAction[] = ["bold", "italic", "heading", "bullet", "numbered", "task", "quote", "code", "link", "table", "rule", "format"];
/** a thin divider goes before these in the toolbar */
const GROUP_STARTS = new Set<MarkdownAction>(["heading", "quote", "table", "format"]);

/** "Mod-Shift-7" as the person reads it: ⌘⇧7 on a Mac, Ctrl+Shift+7 elsewhere. */
export function shortcutLabel(keys: string, mac = isMacPlatform()): string {
  const parts = keys.split("-");
  const key = parts.pop()!;
  const shown = key.length === 1 ? key.toUpperCase() : key;
  if (mac) {
    const symbols: Record<string, string> = { Mod: "⌘", Shift: "⇧", Alt: "⌥", Ctrl: "⌃" };
    return parts.map((part) => symbols[part] ?? part).join("") + shown;
  }
  const names: Record<string, string> = { Mod: "Ctrl", Shift: "Shift", Alt: "Alt", Ctrl: "Ctrl" };
  return [...parts.map((part) => names[part] ?? part), shown].join("+");
}

/** The same keys in aria-keyshortcuts syntax ("Meta+Shift+7"). */
export function ariaShortcut(keys: string, mac = isMacPlatform()): string {
  const parts = keys.split("-");
  const key = parts.pop()!;
  const names: Record<string, string> = { Mod: mac ? "Meta" : "Control", Shift: "Shift", Alt: "Alt", Ctrl: "Control" };
  return [...parts.map((part) => names[part] ?? part), key.length === 1 ? key.toUpperCase() : key].join("+");
}

const SHORTCUTS: MarkdownShortcut[] = [
  ...ALL_ACTIONS.flatMap((action) => {
    const spec = MARKDOWN_ACTIONS[action];
    return spec.keys ? [{ key: spec.keys, edit: ((s) => spec.edit()(s)) as MarkdownEditFn }] : [];
  }),
  { key: "Mod-Alt-2", edit: (s) => setHeading(s, 2) },
  { key: "Mod-Alt-3", edit: (s) => setHeading(s, 3) },
];
// Mod-Alt-1 sets H1 (the toolbar button cycles)
SHORTCUTS.splice(SHORTCUTS.findIndex((item) => item.key === "Mod-Alt-1"), 1, { key: "Mod-Alt-1", edit: (s) => setHeading(s, 1) });

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** called when the editor loses focus (the text so far is in `value`) */
  onBlur?: () => void;
  /** Escape was pressed inside the editor (focus already left it) */
  onEscape?: () => void;
  /** id of the editable element, for an outside <label htmlFor> */
  id?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  invalid?: boolean;
  /** hard cap in characters, like a textarea's maxLength; the count shows
   * it when showCount is on */
  maxLength?: number;
  /** minimum height of the writing area in px (default 160) */
  minHeight?: number;
  /** maximum height before the writing area scrolls (default 60vh) */
  maxHeight?: number | string;
  autoFocus?: boolean;
  /** word and character count in the status line (default on) */
  showCount?: boolean;
  /** left side of the status line: a hint, a byte counter, a file name */
  footer?: ReactNode;
  /** a stable hook for tests and the docs, e.g. "soul" */
  dataField?: string;
  className?: string;
  /** 2026-10-29: the everyday buttons only, even in Advanced mode (More
   * keeps the rest), and Preview as one toggle. Routine instructions. */
  compact?: boolean;
  /** 2026-10-29: a Full screen button for long text; Escape or Exit full
   * screen brings it back. */
  expandable?: boolean;
  /** 2026-11-02: plain readable text until the person edits; the toolbar
   * shows (under the text, so nothing jumps) on focus, in full screen or in
   * Preview. Routine instructions in "Edit routine". */
  toolbarOnFocus?: boolean;
}

export function MarkdownEditor({
  value,
  onChange,
  onBlur,
  onEscape,
  id,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  placeholder,
  disabled,
  readOnly,
  invalid,
  maxLength,
  minHeight = 160,
  maxHeight = "60vh",
  autoFocus,
  showCount = true,
  footer,
  dataField,
  className,
  compact = false,
  expandable = false,
  toolbarOnFocus = false,
}: MarkdownEditorProps) {
  const advanced = useAdvancedMode() && !compact;
  const [full, setFull] = useState(false);
  const [Core, setCore] = useState<CoreComponent | undefined>(() => coreReady);
  const [view, setView] = useState<ViewMode>(() => readView());
  const [more, setMore] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  // Compact (routine instructions): count only while the person is editing.
  const [editing, setEditing] = useState(false);
  const handle = useRef<MarkdownCoreHandle | null>(null);
  const shell = useRef<HTMLDivElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const statusId = useId();
  const countVisible = showCount && (!compact || editing || full);

  useEffect(() => {
    if (Core) return;
    let cancelled = false;
    loadMarkdownEditorCore().then(
      (component) => { if (!cancelled) setCore(() => component); },
      () => { /* the textarea stays; the next mount asks again */ },
    );
    return () => { cancelled = true; };
  }, [Core]);

  const mode: ViewMode = view === "split" && !advanced ? "write" : view;
  const toolbarShown = !toolbarOnFocus || editing || full || mode !== "write";
  const quiet = toolbarOnFocus && !toolbarShown;
  const changeView = (next: ViewMode) => {
    setView(next);
    writeView(next);
  };

  const actions = advanced || more ? ALL_ACTIONS : SIMPLE_ACTIONS;
  const editable = !disabled && !readOnly;
  const run = (action: MarkdownAction) => {
    const edit = MARKDOWN_ACTIONS[action].edit();
    if (mode === "preview") changeView("write");
    if (handle.current) {
      handle.current.run(edit);
      return;
    }
    // the textarea fallback: same edit, on its own selection
    const field = textarea.current;
    if (!field) return;
    const result = edit({ doc: field.value, from: field.selectionStart, to: field.selectionEnd });
    if (!result) return;
    if (maxLength && result.doc.length > maxLength && result.doc.length > field.value.length) return;
    onChange(result.doc);
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(result.from, result.to);
    });
  };

  // Escape leaves the editor: focus moves to the editor's frame (one Tab
  // from the next control), and the field may close itself.
  const leave = () => {
    if (full) {
      setFull(false);
      return;
    }
    shell.current?.focus();
    onEscape?.();
  };

  // toolbar: one tab stop, arrows move between buttons (WAI-ARIA toolbar)
  const onToolbarKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const buttons = [...(toolbar.current?.querySelectorAll<HTMLButtonElement>("button[data-md-tool]") ?? [])];
    if (buttons.length === 0) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (event.key === "ArrowRight") next = (current + 1) % buttons.length;
    else if (event.key === "ArrowLeft") next = (current - 1 + buttons.length) % buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    if (next < 0) return;
    event.preventDefault();
    setFocusIndex(next);
    buttons[next]!.focus();
  };

  const words = useMemo(() => (countVisible ? countWords(value) : 0), [value, countVisible]);
  const characters = useMemo(() => (countVisible ? countCharacters(value) : 0), [value, countVisible]);
  const shellStyle = {
    "--md-font-size": "13px",
    ...(full
      ? { "--md-min-h": "calc(100vh - 9rem)", "--md-max-h": "calc(100vh - 9rem)" }
      : { "--md-min-h": `${minHeight}px`, "--md-max-h": typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight }),
  } as CSSProperties;

  const markEditing = (next: boolean) => {
    if (compact || toolbarOnFocus) setEditing(next);
  };
  const handleBlur = () => {
    markEditing(false);
    onBlur?.();
  };

  const toolBtn = cn(
    "flex items-center justify-center rounded-md text-ink-secondary hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:opacity-40",
    compact ? "h-6 w-6" : "h-7 w-7",
  );
  const toolIcon = compact ? 13 : 14;

  const writing = (
    <div className="markdown-editor-surface min-w-0" style={shellStyle}>
      {Core ? (
        <Core
          value={value}
          onChange={onChange}
          onBlur={handleBlur}
          onEscape={leave}
          id={id}
          ariaLabel={ariaLabel}
          ariaLabelledBy={ariaLabelledBy}
          ariaDescribedBy={[ariaDescribedBy, countVisible || footer ? statusId : undefined].filter(Boolean).join(" ") || undefined}
          placeholder={placeholder}
          disabled={disabled}
          readOnly={readOnly}
          invalid={invalid}
          maxLength={maxLength}
          autoFocus={autoFocus}
          dataField={dataField}
          shortcuts={SHORTCUTS}
          handleRef={handle}
        />
      ) : (
        <textarea
          ref={textarea}
          id={id}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          aria-invalid={invalid || undefined}
          data-markdown-field={dataField}
          placeholder={placeholder}
          disabled={disabled}
          readOnly={readOnly}
          maxLength={maxLength}
          autoFocus={autoFocus}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => markEditing(true)}
          onBlur={handleBlur}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              leave();
            }
          }}
          className="markdown-editor-fallback block max-h-[var(--md-max-h)] min-h-[var(--md-min-h)] w-full resize-none bg-transparent px-3 py-2 text-[13px] leading-relaxed text-ink placeholder:text-ink-tertiary focus:outline-none"
        />
      )}
    </div>
  );

  const preview = (
    <div
      className="markdown-editor-preview max-h-[var(--md-max-h)] min-h-[var(--md-min-h)] min-w-0 overflow-auto px-3 py-2 text-[13px] leading-relaxed text-ink"
      style={shellStyle}
      aria-label={t("markdownEditor.previewLabel")}
      role="region"
      tabIndex={0}
      data-markdown-preview=""
    >
      {value.trim() ? <ChatMarkdown text={value} /> : <p className="text-ink-tertiary">{t("markdownEditor.previewEmpty")}</p>}
    </div>
  );

  const viewButton = (target: ViewMode, icon: LucideIcon, label: string) => {
    const Icon = icon;
    const active = mode === target;
    return (
      <button
        type="button"
        aria-pressed={active}
        title={label}
        onClick={() => changeView(target)}
        className={cn(
          "flex items-center gap-1 rounded-md px-1.5 text-[12px] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
          compact ? "h-6" : "h-7 px-2",
          active ? "bg-raised text-ink" : "text-ink-secondary hover:bg-hover hover:text-ink",
        )}
      >
        <Icon size={compact ? 12 : 13} aria-hidden="true" />
        <span className="max-sm:sr-only">{label}</span>
      </button>
    );
  };

  return (
    <div
      ref={shell}
      tabIndex={-1}
      data-markdown-editor={dataField ?? ""}
      data-md-compact={compact ? "" : undefined}
      onFocus={() => markEditing(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) markEditing(false);
      }}
      className={cn(
        "markdown-editor flex min-w-0 flex-col rounded-lg border bg-inset outline-none focus-within:border-border-strong focus-visible:ring-2 focus-visible:ring-focus",
        invalid ? "border-danger/60 ring-1 ring-danger/50" : quiet ? "border-transparent bg-transparent hover:border-hairline/40" : "border-hairline/40",
        disabled && "opacity-60",
        full ? "fixed inset-4 z-[80] bg-elevated shadow-2xl sm:inset-8" : className,
      )}
    >
      {toolbarShown && (
      <div data-md-toolbar="" className={cn("flex flex-wrap items-center justify-between gap-1 border-hairline/40", toolbarOnFocus ? "order-last border-t" : "border-b", compact ? "px-1 py-0.5" : "px-1.5 py-1")}>
        <div
          ref={toolbar}
          role="toolbar"
          aria-label={t("markdownEditor.toolbar")}
          aria-orientation="horizontal"
          onKeyDown={onToolbarKey}
          className="flex min-w-0 flex-wrap items-center gap-0.5"
        >
          {actions.map((action, index) => {
            const spec = MARKDOWN_ACTIONS[action];
            const Icon = spec.icon;
            const label = spec.label();
            const title = spec.keys ? `${label} (${shortcutLabel(spec.keys)})` : label;
            return (
              <span key={action} className="flex items-center">
                {index > 0 && GROUP_STARTS.has(action) && <span aria-hidden="true" className="mx-0.5 h-3.5 w-px bg-hairline/60" />}
                <button
                  type="button"
                  data-md-tool={action}
                  aria-label={label}
                  aria-keyshortcuts={spec.keys ? ariaShortcut(spec.keys) : undefined}
                  title={title}
                  tabIndex={index === Math.min(focusIndex, actions.length - 1) ? 0 : -1}
                  disabled={!editable}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => run(action)}
                  className={toolBtn}
                >
                  <Icon size={toolIcon} aria-hidden="true" />
                </button>
              </span>
            );
          })}
          {!advanced && (
            <button
              type="button"
              data-md-tool="more"
              aria-label={more ? t("markdownEditor.fewer") : t("markdownEditor.more")}
              aria-expanded={more}
              title={more ? t("markdownEditor.fewer") : t("markdownEditor.more")}
              tabIndex={-1}
              onClick={() => setMore((open) => !open)}
              className={toolBtn}
            >
              <Ellipsis size={toolIcon} aria-hidden="true" />
            </button>
          )}
        </div>
        <div role="group" aria-label={t("markdownEditor.viewLabel")} className="flex items-center gap-0.5">
          {compact
            ? (mode === "preview" ? viewButton("write", PenLine, t("markdownEditor.write")) : viewButton("preview", Eye, t("markdownEditor.preview")))
            : <>
              {viewButton("write", PenLine, t("markdownEditor.write"))}
              {viewButton("preview", Eye, t("markdownEditor.preview"))}
              {advanced && viewButton("split", Columns2, t("markdownEditor.split"))}
            </>}
          {expandable && (
            <button
              type="button"
              data-md-full=""
              aria-pressed={full}
              title={full ? t("markdownEditor.exitFull") : t("markdownEditor.full")}
              aria-label={full ? t("markdownEditor.exitFull") : t("markdownEditor.full")}
              onClick={() => setFull((open) => !open)}
              className={toolBtn}
            >
              {full ? <Minimize2 size={compact ? 12 : 13} aria-hidden="true" /> : <Maximize2 size={compact ? 12 : 13} aria-hidden="true" />}
            </button>
          )}
        </div>
      </div>
      )}
      {mode === "write" && writing}
      {mode === "preview" && preview}
      {mode === "split" && (
        <div className="grid min-w-0 grid-cols-1 sm:grid-cols-2">
          {writing}
          <div className="border-t border-hairline/40 sm:border-l sm:border-t-0">{preview}</div>
        </div>
      )}
      {(countVisible || footer) && (
        <div id={statusId} className="flex items-start justify-between gap-3 border-t border-hairline/40 px-2.5 py-1 text-[11px] text-ink-tertiary">
          <span className="min-w-0 flex-1">{footer}</span>
          {countVisible && (
            <span className={cn("shrink-0 tabular-nums", maxLength && value.length >= maxLength && "font-medium text-danger")} data-markdown-count="">
              {t("markdownEditor.count", { words: words.toLocaleString(), characters: characters.toLocaleString() })}
              {maxLength ? ` · ${value.length.toLocaleString()} / ${maxLength.toLocaleString()}` : ""}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
