// Folding JSON tree for memory notes (read mode). Reuses the pure helpers
// of JsonViewer; kept small for the right panel density.
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import {
  JSON_PAGE,
  ROOT_PATH,
  childPath,
  expandAllPaths,
  jsonChildren,
  jsonKind,
  parseJsonText,
} from "@/lib/json-tree";

const SCALAR_TONE = {
  string: "text-success",
  number: "text-accent",
  boolean: "text-warning",
  null: "text-ink-tertiary",
} as const;

function Scalar({ value }: { value: unknown }) {
  const kind = jsonKind(value);
  if (kind === "object" || kind === "array") return null;
  const text = kind === "string"
    ? JSON.stringify(String(value).length > 240 ? `${String(value).slice(0, 240)}…` : value)
    : String(value);
  return <span className={cn("break-all", SCALAR_TONE[kind])}>{text}</span>;
}

function Node({ label, value, path, open, toggle, depth }: {
  label: string | null;
  value: unknown;
  path: string;
  open: Set<string>;
  toggle: (path: string) => void;
  depth: number;
}) {
  const kind = jsonKind(value);
  const container = kind === "object" || kind === "array";
  const [shown, setShown] = useState(JSON_PAGE);
  const labelNode = label !== null && (
    <span className="text-ink">{label}<span className="text-ink-tertiary">: </span></span>
  );
  if (!container) {
    return (
      <div role="treeitem" aria-level={depth} className="flex gap-1 py-px ps-5">
        {labelNode}
        <Scalar value={value} />
      </div>
    );
  }
  const isOpen = open.has(path);
  const children = isOpen ? jsonChildren(value) : [];
  const count = jsonChildren(value).length;
  return (
    <div role="treeitem" aria-level={depth} aria-expanded={isOpen}>
      <button
        type="button"
        onClick={() => toggle(path)}
        className="flex w-full items-baseline gap-1 rounded py-px text-start hover:bg-raised"
        data-memory-json-fold=""
      >
        {isOpen
          ? <ChevronDown size={14} className="shrink-0 translate-y-0.5 text-ink-secondary" aria-hidden="true" />
          : <ChevronRight size={14} className="shrink-0 translate-y-0.5 text-ink-secondary" aria-hidden="true" />}
        {labelNode}
        <span className="text-ink-secondary">{kind === "array" ? "[" : "{"}{isOpen ? "" : `… ${kind === "array" ? "]" : "}"}`}</span>
        <span className="text-[11px] text-ink-tertiary">
          {kind === "array" ? t("memoryManager.json.items", { count }) : t("memoryManager.json.keys", { count })}
        </span>
      </button>
      {isOpen && (
        <div role="group" className="ms-2 border-s border-hairline/40 ps-3">
          {children.slice(0, shown).map(([key, child]) => (
            <Node key={key} label={key} value={child} path={childPath(path, key)} open={open} toggle={toggle} depth={depth + 1} />
          ))}
          {children.length > shown && (
            <button type="button" className="ps-5 text-xs text-accent hover:underline" onClick={() => setShown(shown + JSON_PAGE)}>
              {t("memoryManager.json.showMore", { count: children.length - shown })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Renders valid JSON as a folding tree; invalid JSON falls back to plain text. */
export function MemoryJsonTree({ source, className }: { source: string; className?: string }) {
  const parsed = useMemo(() => parseJsonText(source), [source]);
  const [open, setOpen] = useState<Set<string>>(() => new Set([ROOT_PATH]));
  if (!parsed) {
    return <pre className={cn("whitespace-pre-wrap break-all text-[12.5px] text-ink", className)}>{source}</pre>;
  }
  const toggle = (path: string) => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };
  return (
    <div className={cn("rounded-xl border border-hairline/50 bg-inset/40 px-2.5 py-2 font-mono text-[12.5px]", className)} data-memory-json-tree="">
      <div className="mb-1.5 flex items-center gap-1">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-ink-secondary hover:bg-raised hover:text-ink"
          onClick={() => setOpen(expandAllPaths(parsed.value))}
        >
          <ChevronsUpDown size={12} aria-hidden="true" />
          {t("memoryManager.json.expandAll")}
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-ink-secondary hover:bg-raised hover:text-ink"
          onClick={() => setOpen(new Set())}
        >
          <ChevronsDownUp size={12} aria-hidden="true" />
          {t("memoryManager.json.collapseAll")}
        </button>
      </div>
      <div role="tree">
        <Node label={null} value={parsed.value} path={ROOT_PATH} open={open} toggle={toggle} depth={1} />
      </div>
    </div>
  );
}
