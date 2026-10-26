// A path field with a navigable dropdown of the folders of the bot's remote
// computer (2026-10-22, JC: "juste un drop down navigable"). Clicking the
// folder button lists the folders of the current directory; a folder row goes
// into it, the first row goes up, and "Choisir ce dossier" writes the absolute
// path (Windows `C:\...` or POSIX `/...`, as the remote OS spells it) into the
// field. It reuses the Tailcat directory listing (server/remote-session-files.ts);
// without a connected computer the button is disabled and typing still works.
import { useEffect, useRef, useState, type InputHTMLAttributes, type Ref } from "react";
import { ArrowUp, Check, Folder, FolderOpen, Loader2 } from "lucide-react";

import { remoteParent, safeRemoteDir, sensitiveRemoteDir, remoteJoin, type RemoteListing } from "../../../shared/remote-files";
import type { RemoteSessionView } from "../../../shared/remote-session";
import { t } from "@/lib/i18n";
import { FIELD } from "../SettingsPrimitives";
import { listRemoteDir } from "./remote-session-client";
import { useRemoteSessions } from "./use-remote-sessions";

/** The connected computer whose listing can be used, if any. */
export function browsableSession(rows: RemoteSessionView[]): RemoteSessionView | undefined {
  return rows.find((row) => row.state === "connected" && (row.inventory === undefined || row.inventory === "ready" || row.inventory === "pending") && row.osKnown !== false);
}

type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "className">;

export function RemoteFolderField({ botId, value, onChange, inputClassName = FIELD, inputRef, view, ...inputProps }: FieldProps & {
  botId: string;
  value: string;
  onChange: (path: string) => void;
  inputClassName?: string;
  inputRef?: Ref<HTMLInputElement>;
  /** tests and callers that already hold the session */
  view?: RemoteSessionView;
}) {
  const polled = useRemoteSessions(view ? undefined : botId).rows;
  const session = view ?? browsableSession(polled);
  const [open, setOpen] = useState(false);
  const [listing, setListing] = useState<RemoteListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPath, setLastPath] = useState("");
  const ticket = useRef(0);
  const box = useRef<HTMLDivElement>(null);

  const load = async (path: string) => {
    if (!session) return;
    const mine = ++ticket.current;
    setLoading(true);
    setError(null);
    setLastPath(path);
    const answer = await listRemoteDir(botId, session.id, path);
    if (mine !== ticket.current) return;
    setLoading(false);
    if ("error" in answer) setError(answer.error);
    else setListing(answer);
  };
  const toggle = () => {
    if (!session) return;
    if (open) { setOpen(false); return; }
    setOpen(true);
    // start where the typed path points when it is valid for that computer, else the profile folder
    const start = safeRemoteDir(value.trim(), session.os);
    void load(start ?? "");
  };
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => { if (box.current && !box.current.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", key); };
  }, [open]);
  useEffect(() => { if (!session) setOpen(false); }, [session]);

  const os = session?.os ?? "linux";
  const folders = listing?.entries.filter((entry) => entry.kind === "dir") ?? [];
  const parent = listing ? (listing.parent ?? remoteParent(listing.path, os)) : null;
  const here = listing?.path ?? "";
  const sensitive = here ? sensitiveRemoteDir(here, os) : false;
  const canChoose = Boolean(listing) && !loading && !error && !sensitive;
  const reason = session ? t("remoteFolder.browse") : t("remoteFolder.noComputer");
  const row = "flex min-h-[40px] w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-ink hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-45 md:min-h-0";

  return (
    <div ref={box} className="min-w-0 flex-1" data-remote-folder-field={session ? "ready" : "none"}>
      <div className="flex items-center gap-1.5">
        <input {...inputProps} ref={inputRef} value={value} onChange={(event) => onChange(event.target.value)} className={inputClassName} />
        <button
          type="button"
          data-remote-folder-toggle=""
          disabled={!session}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={t("remoteFolder.browseButton")}
          title={reason}
          onClick={toggle}
          className="ui-button flex min-h-[44px] shrink-0 items-center gap-1.5 md:min-h-0 disabled:opacity-50"
        >
          <FolderOpen size={14} aria-hidden="true" /> <span>{t("remoteFolder.browseButton")}</span>
        </button>
      </div>
      {!session && <p data-remote-folder-reason="" className="mt-1 text-[12px] text-ink-secondary">{t("remoteFolder.noComputer")}</p>}
      {open && session && (
        <div role="dialog" aria-label={t("remoteFolder.browseButton")} data-remote-folder-menu=""
          className="mt-1.5 flex max-h-[min(300px,50dvh)] flex-col overflow-hidden rounded-xl border-[0.5px] border-border bg-elevated p-1 shadow-lg">
          <div className="truncate px-2 py-1 font-mono text-[12px] text-ink-secondary" title={here || undefined}>{here || t("remoteFolder.loading")}</div>
          <div role="listbox" aria-busy={loading || undefined} className="min-h-[96px] flex-1 overflow-y-auto">
            {loading && <p role="status" className="flex items-center gap-2 px-2 py-2 text-[13px] text-ink-secondary"><Loader2 size={14} aria-hidden="true" className="animate-spin" /> {t("remoteFolder.loading")}</p>}
            {!loading && error && (
              <div className="flex flex-col items-start gap-1.5 px-2 py-2">
                <p role="alert" className="text-[13px] text-danger">{error}</p>
                <button type="button" className="ui-button" onClick={() => void load(lastPath)}>{t("remoteSession.browser.retry")}</button>
              </div>
            )}
            {!loading && !error && listing && (
              <>
                {parent && (
                  <button type="button" role="option" aria-selected={false} data-remote-folder-up="" className={row} onClick={() => void load(parent)}>
                    <ArrowUp size={14} aria-hidden="true" className="text-ink-secondary" /> {t("remoteSession.browser.up")}
                  </button>
                )}
                {folders.map((entry) => (
                  <button key={entry.name} type="button" role="option" aria-selected={false} data-remote-folder-entry={entry.name} className={row} onClick={() => void load(remoteJoin(listing.path, entry.name, os))}>
                    <Folder size={14} aria-hidden="true" className="shrink-0 fill-accent/20 text-accent" />
                    <span className="truncate" title={entry.name}>{entry.name}</span>
                  </button>
                ))}
                {folders.length === 0 && <p className="px-2 py-2 text-[13px] text-ink-secondary">{t("remoteFolder.noSubfolder")}</p>}
                {listing.truncated && <p className="px-2 pb-1 text-[12px] text-ink-tertiary">{t("remoteSession.browser.truncated", { count: listing.entries.length })}</p>}
              </>
            )}
          </div>
          <div className="flex items-center gap-2 border-t border-hairline/40 px-1 pt-1">
            {sensitive && <p className="min-w-0 flex-1 text-[12px] text-danger">{t("remoteSession.browser.systemFolder")}</p>}
            <button type="button" data-remote-folder-choose="" disabled={!canChoose} className="ui-button ui-button-primary ml-auto gap-1.5 font-medium"
              onClick={() => { onChange(here); setOpen(false); }}>
              <Check size={14} aria-hidden="true" /> {t("remoteFolder.choose")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
