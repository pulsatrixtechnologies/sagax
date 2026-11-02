// The in-app viewer of a .json message file: a collapsible tree in the shared
// viewer dialog. Only open nodes mount their children, each node draws a page
// of children at a time, and the file is read with a size bound, so a large
// document never mounts all its rows.
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Download, LoaderCircle } from "lucide-react";

import { requestMessageFile, saveFailureText, useLocalFileSave, type MessageAttachmentContext } from "@/lib/message-file";
import { ViewerDialog } from "./ViewerDialog";
import { t } from "@/lib/i18n";
import {
  JSON_FILE_MAX_BYTES, JSON_PAGE, ROOT_PATH, childPath, expandAllPaths, jsonChildren, jsonKind, parseJsonText,
} from "@/lib/json-tree";
import { readBoundedBytes } from "@/lib/pdf-view";

type LoadState = { kind: "loading" } | { kind: "error"; reason: "size" | "invalid" | "load" } | { kind: "ready"; value: unknown };

export interface JsonViewerProps {
  path: string;
  name: string;
  message: MessageAttachmentContext;
  onClose: () => void;
  returnFocus: HTMLElement | null;
}

const SCALAR_TONE = {
  string: "text-success",
  number: "text-accent",
  boolean: "text-warning",
  null: "text-ink-tertiary",
} as const;

function Scalar({ value }: { value: unknown }) {
  const kind = jsonKind(value);
  if (kind === "object" || kind === "array") return null;
  const text = kind === "string" ? JSON.stringify(String(value).length > 500 ? `${String(value).slice(0, 500)}…` : value) : String(value);
  return <span className={`break-all ${SCALAR_TONE[kind]}`} title={kind === "string" && String(value).length > 500 ? String(value) : undefined}>{text}</span>;
}

function summary(value: unknown): string {
  const count = jsonChildren(value).length;
  const array = jsonKind(value) === "array";
  if (count === 1) return t(array ? "json.itemsOne" : "json.keysOne");
  return array ? t("json.items", { count }) : t("json.keys", { count });
}

function Node({ label, value, path, open, toggle, depth }: {
  label: string | null; value: unknown; path: string; open: Set<string>; toggle: (path: string) => void; depth: number;
}) {
  const kind = jsonKind(value);
  const container = kind === "object" || kind === "array";
  const [shown, setShown] = useState(JSON_PAGE);
  const labelNode = label !== null && <span className="text-ink">{label}<span className="text-ink-tertiary">: </span></span>;
  if (!container) {
    return <div role="treeitem" aria-level={depth} className="flex gap-1 py-px ps-5">{labelNode}<Scalar value={value} /></div>;
  }
  const isOpen = open.has(path);
  const children = isOpen ? jsonChildren(value) : [];
  const name = label ?? t("json.root");
  const actionLabel = t(isOpen ? "json.collapseNode" : "json.expandNode", { name });
  return (
    <div role="treeitem" aria-level={depth} aria-expanded={isOpen}>
      <button type="button" onClick={() => toggle(path)} aria-label={actionLabel} title={actionLabel}
        className="flex w-full items-baseline gap-1 rounded py-px text-start hover:bg-raised">
        {isOpen ? <ChevronDown size={14} className="shrink-0 translate-y-0.5 text-ink-secondary" aria-hidden="true" /> : <ChevronRight size={14} className="shrink-0 translate-y-0.5 text-ink-secondary" aria-hidden="true" />}
        {labelNode}
        <span className="text-ink-secondary">{kind === "array" ? "[" : "{"}{isOpen ? "" : `… ${kind === "array" ? "]" : "}"}`}</span>
        <span className="text-[11px] text-ink-tertiary">{summary(value)}</span>
      </button>
      {isOpen && (
        <div role="group" className="ms-2 border-s border-hairline/40 ps-3">
          {children.slice(0, shown).map(([key, child]) => (
            <Node key={key} label={key} value={child} path={childPath(path, key)} open={open} toggle={toggle} depth={depth + 1} />
          ))}
          {children.length > shown && (
            <button type="button" className="ps-5 text-xs text-accent hover:underline" onClick={() => setShown(shown + JSON_PAGE)}>
              {t("json.showMore", { count: children.length - shown })}
            </button>
          )}
          {children.length === 0 && <span className="ps-5 text-ink-tertiary">{kind === "array" ? "[]" : "{}"}</span>}
        </div>
      )}
    </div>
  );
}

export function JsonViewer({ path, name, message, onClose, returnFocus }: JsonViewerProps) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [open, setOpen] = useState<Set<string>>(() => new Set([ROOT_PATH]));
  const save = useLocalFileSave(path, name, message);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    setOpen(new Set([ROOT_PATH]));
    void (async () => {
      try {
        const response = await requestMessageFile(path, message, controller.signal);
        const bytes = await readBoundedBytes(response, controller.signal, JSON_FILE_MAX_BYTES);
        controller.signal.throwIfAborted();
        const parsed = parseJsonText(new TextDecoder("utf-8").decode(bytes));
        setState(parsed ? { kind: "ready", value: parsed.value } : { kind: "error", reason: "invalid" });
      } catch (reason) {
        if (controller.signal.aborted) return;
        setState({ kind: "error", reason: reason instanceof Error && reason.message === "size" ? "size" : "load" });
      }
    })();
    return () => controller.abort();
  }, [path, message.threadId, message.messageId, attempt]);

  const value = state.kind === "ready" ? state.value : null;
  const toggle = useMemo(() => (target: string) => setOpen((current) => {
    const next = new Set(current);
    if (!next.delete(target)) next.add(target);
    return next;
  }), []);
  const rootOpen = open.has(ROOT_PATH);

  const actions = state.kind === "ready" && (
    <>
      <button type="button" className="table-action gap-1 px-1.5 text-xs" onClick={() => toggle(ROOT_PATH)}
        aria-label={t(rootOpen ? "json.collapseRoot" : "json.expandRoot")} title={t(rootOpen ? "json.collapseRoot" : "json.expandRoot")}>
        {rootOpen ? <ChevronsDownUp size={15} /> : <ChevronsUpDown size={15} />}
        <span className="hidden md:inline">{t(rootOpen ? "json.collapseRoot" : "json.expandRoot")}</span>
      </button>
      <button type="button" className="table-action gap-1 px-1.5 text-xs" onClick={() => setOpen(expandAllPaths(value))}
        aria-label={t("json.expandAll")} title={t("json.expandAll")}>
        <ChevronsUpDown size={15} /><span className="hidden md:inline">{t("json.expandAll")}</span>
      </button>
      <button type="button" className="table-action gap-1 px-1.5 text-xs" disabled={save.state === "saving"} onClick={() => void save.save()}
        aria-label={t("pdf.saveCopy", { name })} title={save.state === "saved" && save.savedTo ? t("attach.savedTo", { path: save.savedTo }) : t("pdf.saveCopyHint")}>
        {save.state === "saving" ? <LoaderCircle size={15} className="animate-spin" /> : <Download size={15} />}
        <span className="hidden md:inline">{save.state === "saved" ? t("attach.downloaded") : t("pdf.save")}</span>
      </button>
    </>
  );

  return (
    <ViewerDialog title={name} onClose={onClose} returnFocus={returnFocus} actions={actions || undefined} bodyClassName="flex flex-col bg-inset">
      {save.state === "failed" && <p role="alert" className="shrink-0 border-b border-hairline/40 px-4 py-2 text-xs text-danger">{saveFailureText(save)}</p>}
      {state.kind === "loading" && (
        <div role="status" className="flex flex-1 items-center justify-center gap-2 text-sm text-ink-secondary"><LoaderCircle size={16} className="animate-spin" />{t("json.loading")}</div>
      )}
      {state.kind === "error" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-sm">
          <p role="alert" className="max-w-md text-ink-secondary">{t(state.reason === "size" ? "json.tooLarge" : state.reason === "invalid" ? "json.invalid" : "json.loadFailed")}</p>
          {state.reason === "load" && <button type="button" className="rounded-lg border border-hairline px-3 py-2 hover:bg-raised" onClick={() => setAttempt(attempt + 1)}>{t("chat.retry")}</button>}
        </div>
      )}
      {state.kind === "ready" && (
        <div role="tree" aria-label={t("json.tree", { name })} className="min-h-0 flex-1 overflow-auto overscroll-contain p-4 font-mono text-[12.5px] leading-5">
          <Node label={null} value={state.value} path={ROOT_PATH} open={open} toggle={toggle} depth={1} />
        </div>
      )}
    </ViewerDialog>
  );
}

export default JsonViewer;
