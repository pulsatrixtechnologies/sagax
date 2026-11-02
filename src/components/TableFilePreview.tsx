import { lazy, Suspense, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Braces, FileText, LoaderCircle, Table2 } from "lucide-react";
import { requestMessageFile, type MessageAttachmentContext } from "@/lib/message-file";
import { HtmlFileButton } from "./HtmlFilePreview";
import { RichTable, TableDialog } from "./RichTable";
import { TABLE_FILE_MAX_BYTES, readTableResponse, tableDelimiter, type TextTable } from "@/lib/table-data";
import { t } from "@/lib/i18n";
import { scrollTabsWithWheel } from "@/lib/tab-wheel-scroll";
import { isXlsxName, type SheetTable } from "@/lib/xlsx-data";
import { readBoundedBytes } from "@/lib/pdf-view";
import { isJsonName } from "@/lib/json-tree";

/** What a message file previews as in the app, from its name. */
export function filePreviewKind(name: string, path = ""): "table" | "xlsx" | "pdf" | "json" | "html" | null {
  if (tableDelimiter(name) ?? tableDelimiter(path)) return "table";
  if (isXlsxName(name) || isXlsxName(path)) return "xlsx";
  if (/\.pdf$/i.test(name.trim()) || /\.pdf$/i.test(path.trim())) return "pdf";
  if (isJsonName(name) || isJsonName(path)) return "json";
  if (/\.html?$/i.test(name.trim()) || /\.html?$/i.test(path.trim())) return "html";
  return null;
}

const PdfViewer = lazy(() => import("./PdfViewer"));
const JsonViewer = lazy(() => import("./JsonViewer"));

/** The preview button next to a message file: a table dialog for CSV, TSV
 * and XLSX, the PDF viewer for a PDF, a collapsible tree for JSON, a
 * sandboxed HTML frame for .html/.htm, nothing for other files. */
export function FilePreviewButton({ path, name, message }: { path: string; name: string; message: MessageAttachmentContext }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const kind = filePreviewKind(name, path);
  if (!kind) return null;
  if (kind === "html") {
    return <HtmlFileButton path={path} name={name} message={message} />;
  }
  if (kind === "pdf") {
    return <>
      <button ref={trigger} type="button" className="table-action" title={t("pdf.preview", { name })} aria-label={t("pdf.preview", { name })} onClick={() => setOpen(true)}><FileText size={14} /></button>
      {open && <Suspense fallback={null}><PdfViewer path={path} name={name} message={message} returnFocus={trigger.current} onClose={() => setOpen(false)} /></Suspense>}
    </>;
  }
  if (kind === "json") {
    return <>
      <button ref={trigger} type="button" className="table-action" title={t("json.preview", { name })} aria-label={t("json.preview", { name })} onClick={() => setOpen(true)}><Braces size={14} /></button>
      {open && <Suspense fallback={null}><JsonViewer path={path} name={name} message={message} returnFocus={trigger.current} onClose={() => setOpen(false)} /></Suspense>}
    </>;
  }
  const delimiter = tableDelimiter(name) ?? tableDelimiter(path);
  return <>
    <button ref={trigger} type="button" className="table-action" title={t("table.preview", { name })} aria-label={t("table.preview", { name })} onClick={() => setOpen(true)}><Table2 size={14} /></button>
    {open && <TableDialog title={name} returnFocus={trigger.current} onClose={() => setOpen(false)}>
      {delimiter
        ? <TableFileContent key={`${message.threadId}:${message.messageId}:${path}`} path={path} name={name} message={message} delimiter={delimiter} />
        : <XlsxFileContent key={`${message.threadId}:${message.messageId}:${path}`} path={path} name={name} message={message} />}
    </TableDialog>}
  </>;
}

/** Earlier name, kept for the existing call sites. */
export const TableFileButton = FilePreviewButton;

/** An .xlsx: every sheet as a tab over the same grid as a CSV. Parsed in a
 * worker; each sheet is capped (src/lib/xlsx-data.ts) and the grid is
 * virtualized, so a large sheet never mounts all its rows. */
function XlsxFileContent({ path, name, message }: { path: string; name: string; message: MessageAttachmentContext }) {
  const [attempt, setAttempt] = useState(0);
  const [sheets, setSheets] = useState<SheetTable[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const tabs = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    let worker: Worker | undefined;
    setError(null);
    setSheets(null);
    setSelected(0);
    const fail = (reason: string) => {
      if (!controller.signal.aborted) setError(reason);
      worker?.terminate();
    };
    void (async () => {
      try {
        const response = await requestMessageFile(path, message, controller.signal);
        const bytes = await readBoundedBytes(response, controller.signal, TABLE_FILE_MAX_BYTES);
        controller.signal.throwIfAborted();
        worker = new Worker(new URL("../lib/xlsx-file.worker.ts", import.meta.url), { type: "module" });
        worker.onmessage = (event: MessageEvent<{ sheets?: SheetTable[]; error?: string }>) => {
          if (event.data.error || !event.data.sheets) fail(event.data.error ?? "format");
          else if (!controller.signal.aborted) setSheets(event.data.sheets);
          worker?.terminate();
        };
        worker.onerror = () => fail("format");
        worker.postMessage({ buffer: bytes.buffer }, [bytes.buffer]);
      } catch (reason) { fail(reason instanceof Error && reason.message === "size" ? "size" : "load"); }
    })();
    return () => { controller.abort(); worker?.terminate(); };
  }, [path, message.threadId, message.messageId, attempt]);
  const sheet = sheets?.[selected];
  const data = useMemo(() => sheet && ({ columns: sheet.headers.map((text) => ({ text })), rows: sheet.rows.map((row) => row.map((text) => ({ text }))) }), [sheet]);
  if (error) return <div className="p-8 text-center text-sm"><p role="alert" className="mb-3 text-ink-secondary">{t(error === "size" ? "table.xlsxTooLarge" : error === "format" ? "table.xlsxInvalid" : "table.loadFailed")}</p><button type="button" className="rounded-lg border border-hairline px-3 py-2 hover:bg-raised" onClick={() => setAttempt(attempt + 1)}>{t("chat.retry")}</button></div>;
  if (!sheets) return <div role="status" className="flex items-center justify-center gap-2 p-12 text-sm text-ink-secondary"><LoaderCircle size={16} className="animate-spin" />{t("table.loading")}</div>;
  if (!sheet || !data) return <p className="p-8 text-center text-sm text-ink-secondary">{t("table.empty")}</p>;
  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const next = event.key === "Home" ? 0 : event.key === "End" ? sheets.length - 1 : step ? (selected + step + sheets.length) % sheets.length : -1;
    if (next < 0) return;
    event.preventDefault();
    setSelected(next);
    tabs.current?.querySelectorAll<HTMLElement>("[role=tab]")[next]?.focus();
  };
  return <div className="flex min-w-0 flex-col gap-2">
    {sheets.length > 1 && (
      <div ref={tabs} role="tablist" aria-label={t("table.sheets")} onKeyDown={onTabKey} onWheel={scrollTabsWithWheel} className="flex min-w-0 gap-1 overflow-x-auto border-b border-hairline/40 pb-1">
        {sheets.map((entry, index) => (
          <button key={index} type="button" role="tab" aria-selected={index === selected} tabIndex={index === selected ? 0 : -1} onClick={() => setSelected(index)}
            className={index === selected
              ? "shrink-0 rounded-md bg-accent/15 px-2.5 py-1 text-xs font-medium text-accent"
              : "shrink-0 rounded-md px-2.5 py-1 text-xs text-ink-secondary hover:bg-raised hover:text-ink"}>
            {entry.name || t("table.sheetNumber", { number: index + 1 })}
          </button>
        ))}
      </div>
    )}
    {sheet.truncated && <p role="status" className="text-[11.5px] text-ink-secondary">{t("table.xlsxTruncated", { shown: sheet.rows.length.toLocaleString(), total: sheet.totalRows.toLocaleString() })}</p>}
    <div role={sheets.length > 1 ? "tabpanel" : undefined}>
      <RichTable key={selected} {...data} name={sheets.length > 1 ? `${name} · ${sheet.name}` : name} expanded />
    </div>
  </div>;
}

function TableFileContent({ path, name, message, delimiter }: {
  path: string; name: string; message: MessageAttachmentContext; delimiter: "," | "\t";
}) {
  const [attempt, setAttempt] = useState(0);
  const [table, setTable] = useState<TextTable | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let worker: Worker | undefined;
    setError(null);
    setTable(null);
    const fail = (reason: string) => {
      if (!controller.signal.aborted) setError(reason);
      worker?.terminate();
    };
    void (async () => {
      try {
        const response = await requestMessageFile(path, message, controller.signal);
        const text = await readTableResponse(response, controller.signal);
        controller.signal.throwIfAborted();
        worker = new Worker(new URL("../lib/table-file.worker.ts", import.meta.url), { type: "module" });
        worker.onmessage = (event: MessageEvent<{ table?: TextTable; error?: string }>) => {
          if (event.data.error) fail(event.data.error);
          else if (!controller.signal.aborted && event.data.table) setTable(event.data.table);
          worker?.terminate();
        };
        worker.onerror = () => fail("format");
        worker.postMessage({ text, delimiter });
      } catch (reason) { fail(reason instanceof Error && reason.message === "size" ? "size" : "load"); }
    })();
    return () => { controller.abort(); worker?.terminate(); };
  }, [path, message.threadId, message.messageId, delimiter, attempt]);
  const data = useMemo(() => table && ({ columns: table.headers.map((text) => ({ text })), rows: table.rows.map((row) => row.map((text) => ({ text }))) }), [table]);
  if (error) return <div className="p-8 text-center text-sm"><p role="alert" className="mb-3 text-ink-secondary">{t(error === "size" ? "table.tooLarge" : error === "columns" || error === "format" ? "table.invalid" : "table.loadFailed")}</p><button type="button" className="rounded-lg border border-hairline px-3 py-2 hover:bg-raised" onClick={() => setAttempt(attempt + 1)}>{t("chat.retry")}</button></div>;
  if (!data) return <div role="status" className="flex items-center justify-center gap-2 p-12 text-sm text-ink-secondary"><LoaderCircle size={16} className="animate-spin" />{t("table.loading")}</div>;
  return <RichTable {...data} name={name} expanded />;
}
