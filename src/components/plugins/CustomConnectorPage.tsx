// "Add a custom connector" (#2104, JC 2026-11-06: Grok Bot's form, look for
// look): a remote MCP server by its URL, its HTTP headers as Key / Value
// pairs, and the OAuth client ID when the server wants one. It drives the
// same draft and save as the MCP editor (useMcpServers), so the server rules
// (names, headers, URL) stay in one place.
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, Plug, Plus, X } from "lucide-react";

import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { McpServers } from "../McpServersPanel";
import type { Crumb } from "../Breadcrumb";
import { PluginPageHeader } from "./PluginParts";
import { PLUGINS } from "./plugins-style";

interface HeaderRow { id: number; key: string; value: string }

/** The pairs as the editor's "Key: Value" lines; a row with no key is left out. */
export function headerLines(rows: readonly { key: string; value: string }[]): string {
  return rows
    .filter((row) => row.key.trim())
    .map((row) => `${row.key.trim()}: ${row.value.trim()}`)
    .join("\n");
}

/** Grok Bot shows "example.com/mcp": a URL typed without its scheme is https. */
export function connectorUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// measured on Grok Bot's form (DPR 2): 28px fields, 14px radius, 14px text
const fieldClass = cn(PLUGINS.outlineField, "h-[28px] rounded-[14px] px-[8px] py-0 text-[14px]");
const labelClass = "mb-[6px] block text-[14px] leading-5 text-ink-secondary";

export function CustomConnectorPage({ mcp, onBack, trail }: {
  mcp: McpServers;
  onBack: () => void;
  trail?: readonly Crumb[];
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"http" | "sse">("http");
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState<HeaderRow[]>([{ id: 0, key: "", value: "" }]);
  const [clientId, setClientId] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const nextId = useRef(1);
  const { startAdd, setDraft, save, busy, error, editing, setClientDraft, closeEditor } = mcp;

  // the hook's editor holds the draft: open it once, as "+ Add > Server" does
  useEffect(() => {
    startAdd();
    return () => closeEditor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep the hook's draft in step, so save() reads what is on screen
  useEffect(() => {
    setDraft((current) => ({
      ...current,
      name: name.trim(),
      transport: "remote",
      type,
      url: connectorUrl(url),
      headers: headerLines(headers),
    }));
  }, [name, type, url, headers, setDraft]);

  // saved: editing closes with no error, then back to where it came from
  useEffect(() => {
    if (!submitted || busy === "save") return;
    if (editing === null && !error) {
      const server = name.trim();
      if (clientId.trim()) setClientDraft((current) => ({ ...current, [server]: { redirectUri: current[server]?.redirectUri ?? "", clientId: clientId.trim(), clientSecret: "" } }));
      onBack();
    } else {
      setSubmitted(false);
    }
  }, [submitted, busy, editing, error, name, clientId, setClientDraft, onBack]);

  const complete = Boolean(name.trim() && url.trim());
  const saving = busy === "save";
  const errorText = error ? (typeof error === "string" ? error : t(error.key, error.params)) : null;

  const setHeader = (id: number, patch: Partial<HeaderRow>) => setHeaders((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row));

  return (
    <>
      <PluginPageHeader title="" trail={trail} onBack={onBack} />
      <form
        className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-[22px] sm:px-[33px]"
        data-plugins-connector-page
        onSubmit={(event) => {
          event.preventDefault();
          if (!complete || saving) return;
          setSubmitted(true);
          void save();
        }}
      >
        <div className="flex flex-col items-center">
          <span className="flex size-9 items-center justify-center rounded-[10px] bg-success text-white" aria-hidden="true">
            <Plug size={17} />
          </span>
          <h3 className="mt-4 text-[18px] font-normal leading-7 tracking-[-0.005em] text-ink">{t("connectApps.addCustomConnector")}</h3>
        </div>

        <div className="mt-[28px] space-y-[10px]">
          <label className="block">
            <span className={labelClass}>{t("connectApps.connector.name")}</span>
            <input className={fieldClass} value={name} onChange={(event) => setName(event.target.value)} placeholder={t("connectApps.connector.namePlaceholder")} data-connector-name />
          </label>

          <label className="block">
            <span className={labelClass}>{t("connectApps.connector.type")}</span>
            <span className="relative block">
              <select
                className={cn(fieldClass, "appearance-none bg-card pr-10")}
                value={type}
                onChange={(event) => setType(event.target.value === "sse" ? "sse" : "http")}
                data-connector-type
              >
                <option value="http">{t("connectApps.connector.typeHttp")}</option>
                <option value="sse">{t("connectApps.connector.typeSse")}</option>
              </select>
              <ChevronDown size={15} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-ink-secondary" aria-hidden="true" />
            </span>
          </label>

          <label className="block">
            <span className={labelClass}>{t("connectApps.connector.url")}</span>
            <input className={fieldClass} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="example.com/mcp" inputMode="url" spellCheck={false} data-connector-url />
          </label>

          <div>
            <span className={labelClass}>{t("connectApps.connector.headers")}</span>
            <div className="space-y-[6px]">
              {headers.map((row, index) => (
                <div key={row.id} className="flex items-center gap-[9px]" data-connector-header>
                  <input className={fieldClass} value={row.key} onChange={(event) => setHeader(row.id, { key: event.target.value })} placeholder={t("connectApps.connector.key")} aria-label={t("connectApps.connector.key")} spellCheck={false} />
                  <input className={fieldClass} value={row.value} onChange={(event) => setHeader(row.id, { value: event.target.value })} placeholder={t("connectApps.connector.value")} aria-label={t("connectApps.connector.value")} spellCheck={false} />
                  {headers.length > 1 && (
                    <button
                      type="button"
                      className="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-hover hover:text-ink"
                      aria-label={t("connectApps.connector.removeHeader")}
                      onClick={() => setHeaders((rows) => rows.filter((candidate) => candidate.id !== row.id))}
                    >
                      <X size={15} />
                    </button>
                  )}
                  {index === headers.length - 1 && row.key.trim() && (
                    <button
                      type="button"
                      className="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-hover hover:text-ink"
                      aria-label={t("connectApps.connector.addHeader")}
                      onClick={() => setHeaders((rows) => [...rows, { id: nextId.current++, key: "", value: "" }])}
                      data-connector-add-header
                    >
                      <Plus size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <label className="block">
            <span className={labelClass}>{t("connectApps.connector.clientId")}</span>
            <input className={fieldClass} value={clientId} onChange={(event) => setClientId(event.target.value)} spellCheck={false} data-connector-client />
          </label>
        </div>

        {errorText && <p className="mt-4 text-[13px] text-danger" role="alert">{errorText}</p>}

        <div className="mt-[25px] flex items-center justify-between">
          <button type="button" className={cn(PLUGINS.outlinePill, "h-[31px] px-[11px] text-[15px]")} onClick={onBack} data-connector-cancel>
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            className={cn(PLUGINS.fillPill, "h-[31px] px-[11px] text-[15px]", !complete && "text-ink-tertiary")}
            disabled={!complete || saving}
            data-connector-submit
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {t("connectApps.connector.submit")}
          </button>
        </div>
      </form>
    </>
  );
}
