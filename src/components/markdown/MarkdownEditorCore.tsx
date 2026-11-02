// The CodeMirror half of the shared markdown editor, in its own chunk:
// MarkdownEditor.tsx loads it on first mount (and shows a plain textarea
// with the same value until it arrives), so a launch that never opens an
// editor never parses CodeMirror. Everything here is local: no fetch, no
// worker, no remote font.
//
// Live formatting: the markdown stays plain text (what is saved is what was
// typed), but headings are sized, bold is bold, italic is italic, code is
// monospace on a tinted band, quotes carry a bar, tables are monospace and a
// checked task is struck through. The edits themselves (lists, wraps, paste,
// Format) are the pure functions of markdown-edits.ts.
import { useEffect, useRef } from "react";
import { Annotation, EditorSelection, EditorState, Compartment, Transaction, type Extension, RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, keymap, placeholder as placeholderExt, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { HighlightStyle, Language, LanguageSupport, defineLanguageFacet, languageDataProp, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { GFM, parser as markdownParser } from "@lezer/markdown";

import {
  autoPair,
  continueList,
  deletePair,
  indentList,
  linkFromPaste,
  minimalChange,
  tableFromTsv,
  toggleTask,
  type TextSelection,
} from "./markdown-edits";
import type { MarkdownCoreHandle, MarkdownCoreProps, MarkdownEditFn } from "./markdown-editor-types";

/** Marks a change that came from the value prop, so it is not reported
 * back through onChange (the parent already has it). */
const external = Annotation.define<boolean>();

const markdownData = defineLanguageFacet({ commentTokens: { block: { open: "<!--", close: "-->" } } });
const markdownLanguage = new Language(
  markdownData,
  markdownParser.configure([GFM, { props: [languageDataProp.add({ Document: markdownData })] }]),
  [],
  "markdown",
);
const markdownSupport = new LanguageSupport(markdownLanguage);

/** Shared marks. Links read as normal underlined text (not accent orange
 * brackets); headings stay moderate so a side-panel editor stays readable. */
const highlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: "1.2em", fontWeight: "650", lineHeight: "1.35" },
  { tag: tags.heading2, fontSize: "1.1em", fontWeight: "650", lineHeight: "1.35" },
  { tag: tags.heading3, fontSize: "1.05em", fontWeight: "600" },
  { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: "600" },
  { tag: tags.heading, fontWeight: "600" },
  { tag: tags.strong, fontWeight: "650" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.monospace, fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)", fontSize: "0.92em" },
  { tag: tags.link, color: "var(--color-ink)", textDecoration: "underline", textUnderlineOffset: "2px" },
  { tag: tags.url, color: "var(--color-ink-secondary)", textDecoration: "underline", textUnderlineOffset: "2px" },
  { tag: tags.quote, color: "var(--color-ink-secondary)" },
  { tag: tags.processingInstruction, color: "var(--color-ink-tertiary)" },
  { tag: tags.labelName, color: "var(--color-ink-tertiary)" },
  { tag: tags.contentSeparator, color: "var(--color-ink-tertiary)" },
  { tag: tags.atom, color: "var(--color-ink-secondary)", fontWeight: "600" },
  { tag: tags.comment, color: "var(--color-ink-tertiary)", fontStyle: "italic" },
]);

// Line level styling the token highlighter cannot give: bands, bars and
// sizes that span the whole line, from the syntax tree of what is visible.
const lineDeco = (name: string) => Decoration.line({ class: name });
const LINE_CLASSES: Record<string, Decoration> = {
  FencedCode: lineDeco("cm-md-code"),
  CodeBlock: lineDeco("cm-md-code"),
  Blockquote: lineDeco("cm-md-quote"),
  Table: lineDeco("cm-md-table"),
  HorizontalRule: lineDeco("cm-md-rule"),
  ATXHeading1: lineDeco("cm-md-h1"),
  ATXHeading2: lineDeco("cm-md-h2"),
  ATXHeading3: lineDeco("cm-md-h3"),
  SetextHeading1: lineDeco("cm-md-h1"),
  SetextHeading2: lineDeco("cm-md-h2"),
};
const taskDone = Decoration.mark({ class: "cm-md-task-done" });

function buildDecorations(view: EditorView): DecorationSet {
  const lines = new Map<number, Decoration[]>();
  const marks: { from: number; to: number }[] = [];
  const { doc } = view.state;
  const tree = syntaxTree(view.state);
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        const deco = LINE_CLASSES[node.name];
        if (deco) {
          const first = doc.lineAt(Math.max(node.from, from)).number;
          const last = doc.lineAt(Math.min(node.to, to)).number;
          for (let n = first; n <= last; n += 1) {
            const at = doc.line(n).from;
            const list = lines.get(at) ?? [];
            if (!list.includes(deco)) list.push(deco);
            lines.set(at, list);
          }
        }
        if (node.name === "TaskMarker") {
          const marker = doc.sliceString(node.from, node.to);
          if (/\[[xX]\]/.test(marker)) {
            const line = doc.lineAt(node.to);
            if (node.to + 1 < line.to) marks.push({ from: node.to + 1, to: line.to });
          }
        }
      },
    });
  }
  const builder = new RangeSetBuilder<Decoration>();
  const points = [
    ...[...lines.entries()].flatMap(([at, decos]) => decos.map((deco) => ({ from: at, to: at, deco }))),
    ...marks.map((mark) => ({ ...mark, deco: taskDone })),
  ].sort((a, b) => a.from - b.from || (a.from === a.to ? -1 : 0) - (b.from === b.to ? -1 : 0));
  for (const point of points) builder.add(point.from, point.to, point.deco);
  return builder.finish();
}

const blockStyling = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const theme = EditorView.theme({
  "&": {
    color: "var(--color-ink)",
    backgroundColor: "transparent",
    fontSize: "var(--md-font-size, 13px)",
    minHeight: "var(--md-min-h, 160px)",
    maxHeight: "var(--md-max-h, 60vh)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "inherit",
    lineHeight: "1.55",
    overflow: "auto",
  },
  ".cm-content": {
    padding: "8px 12px",
    caretColor: "var(--color-ink)",
  },
  ".cm-line": { padding: "1px 0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-ink)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--color-accent) 30%, transparent)",
  },
  ".cm-placeholder": { color: "var(--color-ink-tertiary)" },
  ".cm-md-code": {
    backgroundColor: "color-mix(in srgb, var(--color-ink) 6%, transparent)",
    fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
    fontSize: "0.92em",
    paddingInline: "6px !important",
  },
  ".cm-md-quote": {
    borderInlineStart: "3px solid var(--color-hairline)",
    paddingInlineStart: "10px !important",
  },
  ".cm-md-table": {
    fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
    fontSize: "0.92em",
  },
  ".cm-md-rule": { color: "var(--color-ink-tertiary)" },
  ".cm-md-h1": { paddingTop: "4px !important", paddingBottom: "2px !important" },
  ".cm-md-h2": { paddingTop: "3px !important", paddingBottom: "1px !important" },
  ".cm-md-h3": { paddingTop: "2px !important" },
  ".cm-md-task-done": { textDecoration: "line-through", color: "var(--color-ink-secondary)" },
});

function selectionOf(state: EditorState): TextSelection {
  const range = state.selection.main;
  return { doc: state.doc.toString(), from: range.from, to: range.to };
}

/** Apply a pure edit as the smallest change, with the new selection. */
export function applyEdit(view: EditorView, edit: MarkdownEditFn | ((state: TextSelection) => TextSelection | null)): boolean {
  if (view.state.readOnly) return false;
  const before = selectionOf(view.state);
  const result = edit(before);
  if (!result) return false;
  const change = minimalChange(before.doc, result.doc);
  view.dispatch({
    changes: change.from === change.to && change.insert === "" ? undefined : change,
    selection: EditorSelection.range(result.from, result.to),
    scrollIntoView: true,
    userEvent: "input.markdown",
  });
  return true;
}

function pasteHandler(event: ClipboardEvent, view: EditorView): boolean {
  if (view.state.readOnly) return false;
  const text = event.clipboardData?.getData("text/plain");
  if (!text) return false;
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  const replacement = linkFromPaste(selected, text) ?? tableFromTsv(text);
  if (!replacement) return false;
  event.preventDefault();
  view.dispatch({
    changes: { from, to, insert: replacement },
    selection: EditorSelection.cursor(from + replacement.length),
    scrollIntoView: true,
    userEvent: "input.paste",
  });
  return true;
}

function maxLengthFilter(max: number): Extension {
  return EditorState.transactionFilter.of((tr: Transaction) => {
    if (!tr.docChanged || tr.newDoc.length <= max || tr.newDoc.length <= tr.startState.doc.length) return tr;
    return [];
  });
}

export default function MarkdownEditorCore(props: MarkdownCoreProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const editable = useRef(new Compartment());
  const attrs = useRef(new Compartment());
  const limit = useRef(new Compartment());
  const hint = useRef(new Compartment());

  const contentAttributes = (p: MarkdownCoreProps) => {
    const out: Record<string, string> = { "aria-multiline": "true", role: "textbox", spellcheck: "true" };
    if (p.id) out.id = p.id;
    if (p.ariaLabel) out["aria-label"] = p.ariaLabel;
    if (p.ariaLabelledBy) out["aria-labelledby"] = p.ariaLabelledBy;
    if (p.ariaDescribedBy) out["aria-describedby"] = p.ariaDescribedBy;
    if (p.invalid) out["aria-invalid"] = "true";
    if (p.disabled) out["aria-disabled"] = "true";
    if (p.dataField) out["data-markdown-field"] = p.dataField;
    return out;
  };

  useEffect(() => {
    const p = latest.current;
    const run = (edit: (state: TextSelection) => TextSelection | null) => (target: EditorView) => applyEdit(target, edit);
    const shortcuts = keymap.of([
      { key: "Enter", run: run(continueList) },
      { key: "Tab", run: run((state) => indentList(state, 1)) },
      { key: "Shift-Tab", run: run((state) => indentList(state, -1)) },
      { key: "Backspace", run: run(deletePair) },
      {
        key: "Escape",
        stopPropagation: true,
        run: (target) => {
          target.contentDOM.blur();
          latest.current.onEscape?.();
          return true;
        },
      },
      ...latest.current.shortcuts.map((shortcut) => ({
        key: shortcut.key,
        preventDefault: true,
        // Mod-k is also the app's command palette chord, on window
        stopPropagation: true,
        run: (target: EditorView) => {
          if (target.state.readOnly) return true;
          applyEdit(target, shortcut.edit);
          return true;
        },
      })),
    ]);
    const state = EditorState.create({
      doc: p.value,
      extensions: [
        history(),
        shortcuts,
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdownSupport,
        syntaxHighlighting(highlight),
        blockStyling,
        theme,
        EditorView.lineWrapping,
        hint.current.of(p.placeholder ? placeholderExt(p.placeholder) : []),
        editable.current.of([EditorView.editable.of(!p.disabled), EditorState.readOnly.of(Boolean(p.disabled || p.readOnly))]),
        attrs.current.of(EditorView.contentAttributes.of(contentAttributes(p))),
        limit.current.of(p.maxLength ? maxLengthFilter(p.maxLength) : []),
        EditorView.inputHandler.of((target, from, to, text) => {
          if (text.length !== 1 || target.state.readOnly || target.composing) return false;
          const range = target.state.selection.main;
          if (range.from !== from || range.to !== to) return false;
          return applyEdit(target, (state) => autoPair(state, text));
        }),
        EditorView.domEventHandlers({
          paste: pasteHandler,
          blur: () => {
            latest.current.onBlur?.();
          },
          mousedown: (event, target) => {
            if (target.state.readOnly || event.button !== 0) return false;
            const pos = target.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos === null) return false;
            let onMarker = false;
            syntaxTree(target.state).iterate({
              from: pos,
              to: pos,
              enter(node) {
                if (node.name === "TaskMarker") onMarker = true;
              },
            });
            if (!onMarker) return false;
            const next = toggleTask(target.state.doc.toString(), pos);
            if (next === null) return false;
            event.preventDefault();
            const change = minimalChange(target.state.doc.toString(), next);
            target.dispatch({ changes: change, userEvent: "input.markdown" });
            return true;
          },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !update.transactions.some((tr) => tr.annotation(external))) latest.current.onChange(update.state.doc.toString());
          if (update.selectionSet || update.docChanged) latest.current.onSelection?.();
        }),
      ],
    });
    const created = new EditorView({ state, parent: host.current! });
    view.current = created;
    const handle: MarkdownCoreHandle = {
      run: (edit) => {
        if (created.state.readOnly) return;
        applyEdit(created, edit);
        created.focus();
      },
      focus: () => created.focus(),
      selection: () => selectionOf(created.state),
    };
    p.handleRef.current = handle;
    if (p.autoFocus) created.focus();
    return () => {
      if (p.handleRef.current === handle) p.handleRef.current = null;
      created.destroy();
      view.current = null;
    };
    // the view is created once; later prop changes reconfigure it below
  }, []);

  // A value from outside (a reload, a server change) replaces the text; the
  // value this editor just reported back is already there.
  useEffect(() => {
    const target = view.current;
    if (!target) return;
    const current = target.state.doc.toString();
    if (current === props.value) return;
    const change = minimalChange(current, props.value);
    target.dispatch({ changes: change, annotations: [external.of(true), Transaction.addToHistory.of(false)] });
  }, [props.value]);

  useEffect(() => {
    view.current?.dispatch({
      effects: [
        editable.current.reconfigure([EditorView.editable.of(!props.disabled), EditorState.readOnly.of(Boolean(props.disabled || props.readOnly))]),
        attrs.current.reconfigure(EditorView.contentAttributes.of(contentAttributes(props))),
        limit.current.reconfigure(props.maxLength ? maxLengthFilter(props.maxLength) : []),
        hint.current.reconfigure(props.placeholder ? placeholderExt(props.placeholder) : []),
      ],
    });
  }, [props.disabled, props.readOnly, props.id, props.ariaLabel, props.ariaLabelledBy, props.ariaDescribedBy, props.invalid, props.maxLength, props.placeholder, props.dataField]);

  return <div ref={host} className="markdown-editor-cm min-w-0" data-markdown-editor-ready="" />;
}
