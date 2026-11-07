// Settings > General > OpenTelemetry (#2609): the OTLP/HTTP collector the
// server exports its traces to (bot turns, model calls, tools, MCP,
// sub-agents, routines). Off while no address is saved, nothing else to turn
// on. Header values (an API key, a bearer token) go up once and never come
// back: a saved header shows its name and "saved" only (server/routes/telemetry.ts).
import { useCallback, useEffect, useState } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { readableErrorMessage } from "@/lib/readable-error";
import { loadTelemetry, removeTelemetry, saveTelemetry, testTelemetry, type TelemetryAnswer } from "@/lib/telemetry";
import { api } from "@/state/store";
import { DescribedRow, FIELD, FieldRow, PILL } from "../SettingsPrimitives";

type HeaderRow = { id: number; name: string; value: string; saved: boolean };

let nextRowId = 1;

export function TelemetrySettings() {
  const [view, setView] = useState<TelemetryAnswer | null>(null);
  const [endpoint, setEndpoint] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [headers, setHeaders] = useState<HeaderRow[]>([]);
  const [dirtyHeaders, setDirtyHeaders] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);

  const apply = useCallback((next: TelemetryAnswer) => {
    setView(next);
    setEndpoint(next.endpoint ?? "");
    setServiceName(next.serviceName ?? "");
    setHeaders(next.headerNames.map((name) => ({ id: nextRowId++, name, value: "", saved: true })));
    setDirtyHeaders(false);
  }, []);

  useEffect(() => {
    let live = true;
    loadTelemetry(api).then((next) => { if (live) apply(next); }).catch(() => {
      if (live) setNote({ text: t("telemetry.loadError"), error: true });
    });
    return () => { live = false; };
  }, [apply]);

  const headerObject = () => Object.fromEntries(
    headers.filter((row) => row.name.trim() && (row.saved || row.value.trim())).map((row) => [row.name.trim(), row.value.trim()]),
  );
  const changed = endpoint.trim() !== (view?.endpoint ?? "")
    || serviceName.trim() !== (view?.serviceName ?? "")
    || dirtyHeaders;
  const canSave = Boolean(view) && endpoint.trim() !== "" && changed;
  const canTest = Boolean(view) && (endpoint.trim() !== "" || Boolean(view?.enabled));
  const editHeader = (id: number, patch: Partial<HeaderRow>) => {
    setHeaders((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    setDirtyHeaders(true);
  };
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setNote(null);
    try {
      await work();
    } catch (failure) {
      setNote({ text: readableErrorMessage(failure, t("telemetry.actionError")), error: true });
    } finally {
      setBusy(false);
    }
  };

  const stats = view?.stats;
  const summary = view?.enabled && view.endpoint
    ? stats
      ? t("telemetry.summary.onStats", { endpoint: view.endpoint, exported: String(stats.exported), failed: String(stats.failed) })
      : t("telemetry.summary.on", { endpoint: view.endpoint })
    : t("telemetry.summary.off");

  return (
    <div className="flex flex-col" data-telemetry="">
      <DescribedRow label={t("telemetry.export")} description={summary} help={t("telemetry.help")} rowId="telemetry.export">
        <span className={cn("text-[12px]", view?.enabled ? "text-success" : "text-ink-secondary")}>
          {view?.enabled ? t("telemetry.state.on") : t("telemetry.state.off")}
        </span>
      </DescribedRow>
      <FieldRow label={t("telemetry.endpoint")} hint={t("telemetry.endpoint.hint")} rowId="telemetry.endpoint">
        <input
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          className={FIELD}
          placeholder="https://otel.example.org:4318"
          value={endpoint}
          disabled={busy || view === null}
          onChange={(event) => setEndpoint(event.target.value)}
        />
      </FieldRow>
      <FieldRow label={t("telemetry.serviceName")} hint={t("telemetry.serviceName.hint")} rowId="telemetry.serviceName">
        <input
          type="text"
          autoComplete="off"
          spellCheck={false}
          className={FIELD}
          placeholder="sagax"
          value={serviceName}
          disabled={busy || view === null}
          onChange={(event) => setServiceName(event.target.value)}
        />
      </FieldRow>
      <div data-settings-row="telemetry.headers" data-settings-rowkind="field" className="flex min-w-0 flex-col gap-1.5 px-3.5 py-2.5">
        <span className="text-[13px] leading-[18px] text-ink">{t("telemetry.headers")}</span>
        {headers.map((row) => (
          <div key={row.id} className="flex min-w-0 flex-wrap items-center gap-2 md:flex-nowrap" data-telemetry-header="">
            <input
              type="text"
              autoComplete="off"
              spellCheck={false}
              aria-label={t("telemetry.header.name")}
              className={cn(FIELD, "md:w-[40%]")}
              placeholder={t("telemetry.header.namePlaceholder")}
              value={row.name}
              disabled={busy || row.saved}
              onChange={(event) => editHeader(row.id, { name: event.target.value })}
            />
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              aria-label={t("telemetry.header.value")}
              className={FIELD}
              placeholder={row.saved ? t("telemetry.header.saved") : t("telemetry.header.valuePlaceholder")}
              value={row.value}
              disabled={busy}
              onChange={(event) => editHeader(row.id, { value: event.target.value })}
            />
            <button
              type="button"
              className={cn(PILL, "text-danger")}
              disabled={busy}
              onClick={() => { setHeaders((rows) => rows.filter((item) => item.id !== row.id)); setDirtyHeaders(true); }}
            >
              {t("telemetry.header.remove")}
            </button>
          </div>
        ))}
        <span className="text-[12px] leading-4 text-ink-secondary">{t("telemetry.headers.hint")}</span>
        <div>
          <button
            type="button"
            className={PILL}
            disabled={busy || view === null}
            onClick={() => setHeaders((rows) => [...rows, { id: nextRowId++, name: "", value: "", saved: false }])}
          >
            {t("telemetry.header.add")}
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
        <button
          type="button"
          className="ui-button ui-button-primary min-h-[44px] disabled:opacity-50 md:min-h-0"
          disabled={busy || !canSave}
          onClick={() => void run(async () => {
            apply(await saveTelemetry(api, { endpoint: endpoint.trim(), headers: headerObject(), serviceName: serviceName.trim() || null }));
            setNote({ text: t("telemetry.saved"), error: false });
          })}
        >
          {t("telemetry.save")}
        </button>
        <button
          type="button"
          className={PILL}
          disabled={busy || !canTest}
          onClick={() => void run(async () => {
            await testTelemetry(api, endpoint.trim() ? { endpoint: endpoint.trim(), headers: headerObject() } : undefined);
            setNote({ text: t("telemetry.test.ok"), error: false });
          })}
        >
          {t("telemetry.test")}
        </button>
        {view?.enabled && (
          <button
            type="button"
            className={cn(PILL, "text-danger")}
            disabled={busy}
            onClick={() => void run(async () => {
              apply(await removeTelemetry(api));
              setNote({ text: t("telemetry.removed"), error: false });
            })}
          >
            {t("telemetry.remove")}
          </button>
        )}
      </div>
      {note && (
        <p role={note.error ? "alert" : "status"} className={cn("px-3.5 pb-2 text-[12px]", note.error ? "text-danger" : "text-ink-secondary")}>
          {note.text}
        </p>
      )}
    </div>
  );
}
