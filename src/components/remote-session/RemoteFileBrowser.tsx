// The remote computer's files, in a window drawn like Settings (2026-10-21,
// JC: Télécharger and Envoyer un fichier open a browser of the remote
// computer instead of asking for a path). It starts in the user's profile,
// climbs with the breadcrumb or the parent button, switches drives on
// Windows, and lists name, size and last change. Download picks a file;
// upload picks the folder the chosen file goes to.
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronRight, File, Folder, HardDrive, Home, Loader2 } from "lucide-react";

import { remoteCrumbs, remoteJoin, scpSafePath, sensitiveRemoteDir, type RemoteEntry, type RemoteListing } from "../../../shared/remote-files";
import { publicText, type RemoteSessionView } from "../../../shared/remote-session";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { DANGER_PILL, DialogFrame, DialogLayer, PILL, PRIMARY_PILL } from "../SettingsPrimitives";
import { listRemoteDir } from "./remote-session-client";

export type RemoteBrowserMode = { kind: "download" } | { kind: "upload"; fileName: string };

/** "2,1 Mo" / "2.1 MB", in the reader's language. */
export function formatRemoteSize(bytes: number | undefined, locale = activeLocale()): string {
  if (bytes === undefined) return "";
  const units = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  try {
    return new Intl.NumberFormat(locale, { style: "unit", unit: units[unit], unitDisplay: "short", maximumFractionDigits: unit === 0 || value >= 10 ? 0 : 1 }).format(value);
  } catch {
    return `${Math.round(value)} ${["B", "KB", "MB", "GB", "TB"][unit]}`;
  }
}

function formatModified(iso: string | undefined, locale = activeLocale()): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}

function driveLabel(root: string): string {
  return root.replace(/\\$/, "") || root;
}

export function RemoteFileBrowser({ botId, view, mode, busy = false, error: actionError, conflict = false, onPick, onBack, onClose }: {
  botId: string;
  view: RemoteSessionView;
  mode: RemoteBrowserMode;
  /** the transfer is running */
  busy?: boolean;
  /** what the transfer answered, shown under the list */
  error?: string | null;
  /** upload: the server said a file of that name is already there */
  conflict?: boolean;
  /** download: the chosen file's path; upload: the chosen folder, with
   * `overwrite` once the person confirmed replacing the file there */
  onPick: (path: string, overwrite?: boolean) => void;
  /** leaving the replace question */
  onBack?: () => void;
  onClose: () => void;
}) {
  const host = publicText(view.hostname) || view.code;
  const [listing, setListing] = useState<RemoteListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [lastPath, setLastPath] = useState("");
  const [confirming, setConfirming] = useState(false);
  const request = useRef(0);
  const crumbsRef = useRef<HTMLElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const close = () => { if (!busy) onClose(); };
  useModalDialog(frame, close);

  const open = useCallback(async (path: string) => {
    const ticket = ++request.current;
    setLoading(true);
    setListError(null);
    setSelected(null);
    setLastPath(path);
    const answer = await listRemoteDir(botId, view.id, path);
    if (ticket !== request.current) return;
    setLoading(false);
    if ("error" in answer) setListError(answer.error);
    else setListing(answer);
  }, [botId, view.id]);

  useEffect(() => { void open(""); }, [open]);
  // a long path shows its end (the folder you are in), not its drive
  useEffect(() => {
    const nav = crumbsRef.current;
    if (nav) nav.scrollLeft = nav.scrollWidth;
    // the row that was clicked is gone with the old listing: keep focus in
    // the window so Escape and Tab still work
    const dialog = frame.current;
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus();
  }, [listing, listError]);

  const download = mode.kind === "download";
  const titleId = "remote-file-browser-title";
  const title = download ? t("remoteSession.browser.downloadTitle", { host }) : t("remoteSession.browser.uploadTitle", { name: mode.fileName });
  const subtitle = download ? t("remoteSession.browser.downloadSubtitle") : t("remoteSession.browser.uploadSubtitle", { host });
  const here = listing?.path ?? "";
  const crumbs = listing ? remoteCrumbs(listing.path, view.os) : [];
  const roots = listing?.roots ?? [];
  const currentRoot = roots.find((root) => here.toUpperCase().startsWith(root.toUpperCase())) ?? roots[0];
  // after a failed listing the one on screen is stale: no climbing from it
  const stale = Boolean(listError);
  const asking = !download && (confirming || conflict);
  const locked = busy || loading || stale || asking;
  const target = listing ? (download ? (selected ? remoteJoin(listing.path, selected, view.os) : null) : listing.path) : null;
  const blocked = !target ? null
    : !download && sensitiveRemoteDir(target, view.os) ? t("remoteSession.browser.systemFolder")
      : !scpSafePath(target) ? t("remoteSession.browser.unsafeName")
        : null;
  const canPick = !busy && !loading && !stale && target !== null && !blocked;
  const pick = () => {
    if (!canPick || !target) return;
    if (download) onPick(target);
    else setConfirming(true);
  };
  const back = () => {
    setConfirming(false);
    onBack?.();
  };
  const enter = (entry: RemoteEntry) => {
    if (locked || !listing) return;
    if (entry.kind === "dir") void open(remoteJoin(listing.path, entry.name, view.os));
    else if (download) setSelected(entry.name);
  };

  const iconButton = "flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary transition-colors hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none";

  return (
    <DialogLayer className="z-[70]" onBackdropMouseDown={close}>
      <DialogFrame
        titleId={titleId}
        title={title}
        subtitle={subtitle}
        width="lg"
        closeLabel={t("common.close")}
        onClose={close}
        closeDisabled={busy}
        frameRef={frame}
        frameProps={{ "data-remote-file-browser": mode.kind, "aria-busy": busy || loading || undefined }}
        footer={asking && listing ? (
          <div data-remote-confirm={conflict ? "replace" : "send"} className="flex w-full flex-col gap-3">
            <div className={cn("rounded-xl px-3 py-2.5 text-[13px]", conflict ? "bg-danger/10 text-ink" : "bg-inset text-ink")}>
              <p className="font-medium">
                {conflict
                  ? t("remoteSession.browser.confirmReplace", { name: mode.kind === "upload" ? mode.fileName : "" })
                  : t("remoteSession.browser.confirmSend", { name: mode.kind === "upload" ? mode.fileName : "" })}
              </p>
              <p data-remote-confirm-path="" className="mt-1 break-all font-mono text-[12px] text-ink-secondary">{listing.path}</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button type="button" className={PILL} onClick={back} disabled={busy}>{t("remoteSession.browser.back")}</button>
              <button
                type="button"
                data-remote-confirm-go=""
                className={cn(conflict ? `${DANGER_PILL} min-h-[44px] md:min-h-0` : PRIMARY_PILL, "font-medium")}
                disabled={busy}
                onClick={() => onPick(listing.path, conflict)}
              >
                {busy && <Loader2 size={14} aria-hidden="true" className="animate-spin" />}
                {t(busy ? "remoteSession.browser.sending" : conflict ? "remoteSession.browser.replace" : "remoteSession.uploadShort")}
              </button>
            </div>
          </div>
        ) : (
          <>
            {blocked ? (
              <p data-remote-dest-note="" role="note" className="mr-auto min-w-0 flex-1 text-[12.5px] text-danger">{blocked}</p>
            ) : !download && listing ? (
              <p data-remote-destination="" className="mr-auto min-w-0 flex-1 truncate text-[12.5px] text-ink-tertiary" title={listing.path}>
                {t("remoteSession.browser.destination", { path: listing.path })}
              </p>
            ) : null}
            <button type="button" className={PILL} onClick={close} disabled={busy}>{t("common.cancel")}</button>
            <button type="button" data-remote-browser-pick="" className={cn(PRIMARY_PILL, "font-medium")} onClick={pick} disabled={!canPick}>
              {busy && <Loader2 size={14} aria-hidden="true" className="animate-spin" />}
              {download
                ? t(busy ? "remoteSession.browser.downloading" : "remoteSession.download")
                : t("remoteSession.browser.sendHere")}
            </button>
          </>
        )}
      >
        <div className="flex min-w-0 items-center gap-1">
          <button type="button" data-remote-browser-up="" className={iconButton} aria-label={t("remoteSession.browser.up")} title={t("remoteSession.browser.up")}
            disabled={locked || !listing?.parent} onClick={() => listing?.parent && void open(listing.parent)}>
            <ArrowUp size={16} aria-hidden="true" />
          </button>
          <button type="button" data-remote-browser-home="" className={iconButton} aria-label={t("remoteSession.browser.home")} title={t("remoteSession.browser.home")}
            disabled={busy || loading || asking} onClick={() => void open(listing?.home ?? "")}>
            <Home size={16} aria-hidden="true" />
          </button>
          {view.os === "windows" && roots.length > 1 && (
            <label className="relative ml-0.5 flex shrink-0 items-center">
              <span className="sr-only">{t("remoteSession.browser.drive")}</span>
              <HardDrive size={14} aria-hidden="true" className="pointer-events-none absolute left-2.5 text-ink-secondary" />
              <select
                data-remote-browser-drive=""
                value={currentRoot}
                disabled={locked}
                onChange={(event) => void open(event.target.value)}
                className="h-8 appearance-none rounded-lg border-[0.5px] border-border bg-elevated pl-7 pr-3 text-[13px] text-ink hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40"
              >
                {roots.map((root) => <option key={root} value={root}>{driveLabel(root)}</option>)}
              </select>
            </label>
          )}
          <nav ref={crumbsRef} title={listing?.path} aria-label={t("remoteSession.browser.location")} className="ml-1 flex min-w-0 flex-1 items-center overflow-x-auto rounded-lg bg-inset px-1.5 py-1 [scrollbar-width:none]">
            <ol className="flex min-w-max items-center gap-0.5 text-[12.5px]">
              {crumbs.map((crumb, index) => {
                const last = index === crumbs.length - 1;
                return (
                  <li key={crumb.path} className="flex items-center gap-0.5">
                    {index > 0 && !(index === 1 && crumbs[0]!.label === "/") && <ChevronRight size={12} aria-hidden="true" className="text-ink-tertiary" />}
                    <button
                      type="button"
                      data-remote-crumb={crumb.path}
                      aria-current={last ? "location" : undefined}
                      disabled={locked || last}
                      onClick={() => void open(crumb.path)}
                      className={cn("rounded-md px-1.5 py-0.5 transition-colors motion-reduce:transition-none", last ? "font-medium text-ink" : "text-ink-secondary hover:bg-hover hover:text-ink")}
                    >
                      {crumb.label}
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
        </div>

        <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border-[0.5px] border-border bg-elevated">
          <div aria-hidden="true" className="grid grid-cols-[minmax(0,1fr)_72px] gap-3 border-b border-hairline/40 px-3 py-1.5 text-[11.5px] font-medium text-ink-tertiary sm:grid-cols-[minmax(0,1fr)_72px_132px]">
            <span>{t("remoteSession.browser.name")}</span>
            <span className="text-right">{t("remoteSession.browser.size")}</span>
            <span className="hidden sm:block">{t("remoteSession.browser.modified")}</span>
          </div>
          <div role="list" aria-label={t("remoteSession.browser.label")} aria-busy={loading || undefined} className="h-[min(320px,calc(100dvh-340px))] min-h-[160px] overflow-y-auto py-1">
            {loading && (
              <p role="status" className="flex items-center gap-2 px-3 py-3 text-[13px] text-ink-secondary">
                <Loader2 size={14} aria-hidden="true" className="animate-spin" /> {t("remoteSession.browser.loading")}
              </p>
            )}
            {!loading && listError && (
              <div className="flex flex-col items-start gap-2 px-3 py-3">
                <p role="alert" className="text-[13px] text-danger">{listError}</p>
                <button type="button" className={PILL} onClick={() => void open(lastPath)}>{t("remoteSession.browser.retry")}</button>
              </div>
            )}
            {!loading && !listError && listing && listing.entries.length === 0 && (
              <p className="px-3 py-3 text-[13px] text-ink-secondary">{t("remoteSession.browser.empty")}</p>
            )}
            {!loading && !listError && listing?.entries.map((entry) => {
              const folder = entry.kind === "dir";
              const isSelected = !folder && selected === entry.name;
              const inert = !folder && !download;
              return (
                <div role="listitem" key={`${entry.kind}:${entry.name}`}>
                  <button
                    type="button"
                    data-remote-entry={entry.kind}
                    data-name={entry.name}
                    aria-pressed={download && !folder ? isSelected : undefined}
                    disabled={locked || inert}
                    onClick={() => enter(entry)}
                    onDoubleClick={() => { if (!folder && download && !locked && scpSafePath(remoteJoin(listing.path, entry.name, view.os))) { setSelected(entry.name); onPick(remoteJoin(listing.path, entry.name, view.os)); } }}
                    className={cn(
                      "mx-1 grid w-[calc(100%-8px)] grid-cols-[minmax(0,1fr)_72px] items-center gap-3 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors motion-reduce:transition-none sm:grid-cols-[minmax(0,1fr)_72px_132px]",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                      isSelected ? "bg-accent/15 text-ink" : "text-ink hover:bg-hover",
                      inert && "cursor-default opacity-45 hover:bg-transparent",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      {folder
                        ? <Folder size={16} aria-hidden="true" className="shrink-0 fill-accent/20 text-accent" />
                        : <File size={16} aria-hidden="true" className="shrink-0 text-ink-tertiary" />}
                      <span className="truncate" title={entry.name}>{entry.name}</span>
                    </span>
                    <span className="text-right text-[12px] tabular-nums text-ink-secondary">{folder ? "" : formatRemoteSize(entry.size)}</span>
                    <span className="hidden truncate text-[12px] tabular-nums text-ink-secondary sm:block">{formatModified(entry.modifiedAt)}</span>
                  </button>
                </div>
              );
            })}
            {!loading && !listError && listing?.truncated && (
              <p className="px-3 pb-1 pt-2 text-[12px] text-ink-tertiary">{t("remoteSession.browser.truncated", { count: listing.entries.length })}</p>
            )}
          </div>
        </div>
        {actionError && <p role="alert" className="px-1 text-[12.5px] text-danger">{actionError}</p>}
      </DialogFrame>
    </DialogLayer>
  );
}
