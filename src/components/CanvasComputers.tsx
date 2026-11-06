import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Box, ExternalLink, Monitor, RefreshCw, X } from "lucide-react";
import { activeLocale, t } from "@/lib/i18n";
import { api, useStore } from "@/state/store";
import type { TeamComputer } from "../../shared/team-computer";
import { ConfirmDialog } from "./ConfirmDialog";
import { readableError } from "@/lib/plain-error";
import { cn } from "@/lib/cn";
import { UnattendedHostSetup } from "./remote-session/UnattendedHostSetup";
import { unattendedHostLabel } from "./remote-session/UnattendedHostsSection";
import { fetchRemoteHosts, placeRemoteHost, type RemoteHostCard, type RemoteHostsAnswer } from "./remote-session/remote-hosts-client";

const control = "rounded-lg px-3 py-2 text-[12px] text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-40";
const field = "w-full rounded-lg border border-hairline/60 bg-inset px-3 py-2 text-[12px] text-ink outline-none focus:border-accent";
type Inventory = { computers: TeamComputer[]; configured: boolean; problem?: string };
/** What can be placed on a team: a cloud computer, or an unattended host
 * added through Unattended Remote Control (2026-11-06). */
type Placeable = { kind: "cloud" | "host"; id: string; name: string; section: string | null };
const cloudPlaceable = (computer: TeamComputer): Placeable => ({ kind: "cloud", id: computer.id, name: computer.name, section: computer.section });
const hostPlaceable = (host: RemoteHostCard): Placeable => ({ kind: "host", id: host.hostId, name: unattendedHostLabel(host), section: host.section });
const hostStatus = (host: RemoteHostCard) => host.online ? t("canvasComputers.unattended.online") : t("canvasComputers.unattended.offline");

function seenLabel(iso: string | null): string {
  if (!iso) return t("remoteSessionsAdmin.hosts.never");
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return t("remoteSessionsAdmin.hosts.never");
  return new Intl.DateTimeFormat(activeLocale(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hourCycle: "h23" }).format(date);
}

/** This shelf is only an owner control. Its list is read-only; every paid
 * lifecycle action is a deliberate button press, never a render effect.
 * Computers are added through Unattended Remote Control (an installed host,
 * always on); existing cloud computers stay listed and placeable. */
export function CanvasComputers({ cloud: cloudEnabled = true, open, createRequest, drop, sections, onClose, onDropHandled, onChange }: {
  /** Server-wide cloud team computers (admin routes); a member sees only their own hosts. */
  cloud?: boolean;
  open: boolean;
  /** Above zero, opens the Unattended Remote Control add flow. */
  createRequest: number;
  drop: { id: string; section: string } | null;
  sections: Array<{ key: string; name: string }>;
  onClose: () => void;
  onDropHandled: () => void;
  onChange: (computers: TeamComputer[]) => void;
}) {
  const { dispatch } = useStore();
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [remote, setRemote] = useState<RemoteHostsAnswer | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  const read = useRef<AbortController | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [assignment, setAssignment] = useState<{ computer: Placeable; section: string | null } | null>(null);
  const [viewer, setViewer] = useState<{ id: string; url: string } | null>(null);
  const [heldHere, setHeldHere] = useState<string | null>(null);
  const controlLeaseId = useRef(crypto.randomUUID());
  const heldHereRef = useRef<string | null>(null);
  const shelf = useRef<HTMLElement>(null);
  const pointer = useRef<{ id: number; x: number; y: number; moved: boolean; computer: Placeable; handle: HTMLElement } | null>(null);
  const highlighted = useRef<HTMLElement | null>(null);
  const [dragging, setDragging] = useState<{ name: string; kind: Placeable["kind"]; x: number; y: number; hint: string } | null>(null);
  const clearDrag = useCallback(() => {
    const active = pointer.current;
    pointer.current = null;
    highlighted.current?.removeAttribute("data-computer-dropping");
    highlighted.current = null;
    if (active?.handle.hasPointerCapture(active.id)) active.handle.releasePointerCapture(active.id);
    setDragging(null);
  }, []);
  useEffect(() => {
    if (!open) clearDrag();
    return () => { highlighted.current?.removeAttribute("data-computer-dropping"); };
  }, [open, clearDrag]);
  useEffect(() => { heldHereRef.current = heldHere; }, [heldHere]);
  // The shelf mounts conditionally; a control lease this client took must
  // not outlive it. Best-effort release, mirroring LocalVmWorkspace.
  useEffect(() => () => {
    const held = heldHereRef.current;
    if (!held) return;
    void fetch(`/api/team-computers/${encodeURIComponent(held)}/control`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "release", controlLeaseId: controlLeaseId.current }),
      keepalive: true,
    }).catch(() => {});
  }, []);
  const requestAssignment = useCallback((computer: Placeable, section: string | null) => {
    if (pending.current || computer.section === section) return;
    // A cloud computer keeps one team's files and logins: unassign first. An
    // unattended host moves straight to the new team.
    if (computer.kind === "cloud" && computer.section !== null && section !== null) {
      setError(t("canvasComputers.moveError", { name: computer.name, team: computer.section || t("sidebar.section.general") }));
      return;
    }
    setError("");
    setAssignment({ computer, section });
  }, []);
  const targetAt = (x: number, y: number) => {
    const canvas = shelf.current?.parentElement?.querySelector("[data-team-canvas]");
    const team = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-team-key]");
    return team && canvas?.contains(team) && sections.some((section) => section.key === team.dataset.teamKey) ? team : null;
  };
  const dragMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = pointer.current;
    if (!active || event.pointerId !== active.id) return;
    if (event.buttons === 0) { clearDrag(); return; }
    if (!active.moved && Math.hypot(event.clientX - active.x, event.clientY - active.y) < 5) return;
    active.moved = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const target = targetAt(event.clientX, event.clientY);
    if (highlighted.current !== target) {
      highlighted.current?.removeAttribute("data-computer-dropping");
      target?.setAttribute("data-computer-dropping", "true");
      highlighted.current = target;
    }
    const team = target ? sections.find((section) => section.key === target.dataset.teamKey) : null;
    setDragging({ name: active.computer.name, kind: active.computer.kind, x: event.clientX, y: event.clientY,
      hint: team ? active.computer.kind === "cloud" && active.computer.section !== null && active.computer.section !== team.key
        ? t("canvasComputers.hint.unassignFirst") : t("canvasComputers.hint.assign", { team: team.name }) : t("canvasComputers.hint.drop") });
  };
  const grab = (event: ReactPointerEvent<HTMLDivElement>, computer: Placeable) => {
    if (pending.current || pointer.current || event.button !== 0 || !event.isPrimary) return;
    event.currentTarget.focus({ preventScroll: true });
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, computer, handle: event.currentTarget };
    // This handle has no click action. Capture immediately so the
    // first movement can leave the narrow shelf without losing it.
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const dragEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = pointer.current;
    if (!active || active.id !== event.pointerId) return;
    const section = active.moved ? targetAt(event.clientX, event.clientY)?.dataset.teamKey : undefined;
    clearDrag();
    if (section !== undefined) requestAssignment(active.computer, section);
  };

  const refresh = useCallback(async () => {
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    setLoading(true);
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]);
      const [cloud, hosts] = await Promise.allSettled([cloudEnabled ? api<Inventory>("/api/team-computers", { signal }) : Promise.resolve(null), fetchRemoteHosts(signal)]);
      if (controller.signal.aborted || !mounted.current) return;
      const value = cloud.status === "fulfilled" ? cloud.value : null;
      const placed = hosts.status === "fulfilled" ? hosts.value : null;
      if (value) setInventory(value);
      if (placed) setRemote(placed);
      const failed = cloud.status === "rejected" ? cloud.reason : hosts.status === "rejected" ? hosts.reason : null;
      setReadError(failed ? readableError(failed) : "");
      onChangeRef.current([
        ...(placed?.hosts ?? []).filter((host) => host.state === "enrolled").map((host): TeamComputer => ({ id: host.hostId, name: unattendedHostLabel(host), section: host.section, state: hostStatus(host), held: false })),
        ...(value?.computers ?? []),
      ]);
    } catch (cause) {
      if (!controller.signal.aborted && mounted.current) setReadError(readableError(cause));
    } finally {
      if (!controller.signal.aborted && mounted.current) setLoading(false);
    }
  }, [cloudEnabled]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; read.current?.abort(); };
  }, [refresh]);
  useEffect(() => {
    if (!open) return;
    void refresh();
    const timer = window.setInterval(() => { if (!pending.current && document.visibilityState === "visible") void refresh(); }, 20_000);
    return () => window.clearInterval(timer);
  }, [open, refresh]);
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, [open]);
  useEffect(() => {
    if (!drop) return;
    const cloud = inventory?.computers.find((item) => item.id === drop.id);
    const host = remote?.hosts.find((item) => item.hostId === drop.id);
    if (cloud) requestAssignment(cloudPlaceable(cloud), drop.section);
    else if (host) requestAssignment(hostPlaceable(host), drop.section);
    onDropHandled();
  }, [drop, inventory, remote, onDropHandled, requestAssignment]);

  const mutate = async (key: string, action: () => Promise<unknown>, success?: (value: any) => void, failure?: () => void) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(key);
    setError("");
    read.current?.abort();
    try {
      const value = await action();
      if (mounted.current) success?.(value);
    } catch (cause) {
      if (mounted.current) {
        setError(readableError(cause));
        failure?.();
      }
    } finally {
      pending.current = false;
      if (mounted.current) { setBusy(null); await refresh(); }
    }
  };
  const cancelAssignment = useCallback(() => setAssignment(null), []);
  const post = (id: string, action: string, body = {}) => api(`/api/team-computers/${encodeURIComponent(id)}/${action}`, { method: "POST", body: JSON.stringify(body) });
  const settings = () => { onClose(); dispatch({ type: "toggleAppSettings", open: true, section: "computer" }); };

  return <>
    {open && <aside ref={shelf} aria-label={t("canvasComputers.shelf")} onKeyDown={(event) => { if (event.key === "Escape" && !assignment) { event.stopPropagation(); if (pointer.current) clearDrag(); else onClose(); } }} className="flex w-[300px] max-w-[90vw] shrink-0 flex-col border-l border-hairline/50 bg-panel max-sm:absolute max-sm:inset-y-0 max-sm:right-0 max-sm:z-30 max-sm:shadow-xl">
      <header className="flex items-center gap-2 border-b border-hairline/40 px-4 py-3">
        <Monitor size={16} className="text-ink-secondary" /><h2 className="flex-1 text-[13px] font-semibold">{t("canvasComputers.title")}</h2>
        <button aria-label={t("canvasComputers.refresh")} className={control} disabled={loading || busy !== null} onClick={() => { setError(""); void refresh(); }}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button>
        <button ref={closeButton} aria-label={t("canvasComputers.close")} className={control} onClick={onClose}><X size={15} /></button>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        <p className="text-[12px] leading-relaxed text-ink-secondary">{t("canvasComputers.intro")}</p>
        {(error || readError || inventory?.problem) && <p role="alert" className="rounded-lg bg-danger/10 p-3 text-[12px] text-danger">{error || readError || inventory?.problem}</p>}
        <UnattendedHostSetup available={remote?.available ?? true} reason={remote?.reason} startRequest={createRequest} disabled={busy !== null} onIssued={() => void refresh()} />
        {remote?.hosts.filter((host) => host.state === "enrolled").map((host) => {
          const item = hostPlaceable(host);
          return <article key={host.hostId} data-remote-host-id={host.hostId} className="rounded-xl border border-hairline/60 bg-card p-3">
          <div data-computer-drag-id={host.hostId} role="group" tabIndex={-1} aria-label={t("canvasComputers.dragAria", { name: item.name })}
            onPointerDown={(event) => grab(event, item)} onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={clearDrag}
            onLostPointerCapture={() => { if (pointer.current) clearDrag(); }}
            className="flex touch-none select-none cursor-grab items-center gap-2.5 rounded-lg py-1 outline-none active:cursor-grabbing">
            <span className="relative flex size-9 shrink-0 items-center justify-center rounded-lg bg-control text-ink-secondary"><Monitor size={18} />
              <span data-remote-host-online={host.online ? "true" : "false"} className={cn("absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-card", host.online ? "bg-success" : "bg-ink-secondary/50")} /></span>
            <span className="min-w-0"><span className="block truncate text-[13px] font-medium" title={host.hostId}>{item.name}</span>
              <span className="block text-[11px] text-ink-secondary">{t("canvasComputers.unattended.stateLine", { status: busy === host.hostId ? t("canvasComputers.updating") : hostStatus(host) })}</span>
              <span className="block truncate text-[10px] text-ink-secondary">{[host.org, t(`remoteSessionsAdmin.hosts.scope.${host.scope}`), t("canvasComputers.unattended.seen", { time: seenLabel(host.lastSeenAt) })].filter(Boolean).join(" · ")}</span></span>
          </div>
          <label className="sr-only" htmlFor={`computer-team-${host.hostId}`}>{t("canvasComputers.teamFor", { name: item.name })}</label>
          <select id={`computer-team-${host.hostId}`} className={`${field} mt-3`} disabled={busy !== null} value={host.section === null ? "unassigned" : `team:${host.section}`}
            onChange={(event) => requestAssignment(item, event.target.value === "unassigned" ? null : event.target.value.slice(5))}>
            <option value="unassigned">{t("canvasComputers.notAssigned")}</option>
            {sections.map((section) => <option key={section.key} value={`team:${section.key}`}>{section.name}</option>)}
          </select>
        </article>; })}
        {inventory?.computers.map((computer) => {
          const ready = ["idle", "ready", "running"].includes(computer.state);
          const starting = ["init", "provisioning", "provisioned", "cloning", "starting"].includes(computer.state);
          const heldHereNow = heldHere === computer.id;
          const held = computer.held || heldHereNow;
          return <article key={computer.id} data-computer-id={computer.id} className="rounded-xl border border-hairline/60 bg-card p-3">
          <div data-computer-drag-id={computer.id} role="group" tabIndex={-1} aria-label={t("canvasComputers.dragAria", { name: computer.name })}
            onPointerDown={(event) => grab(event, cloudPlaceable(computer))} onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={clearDrag}
            onLostPointerCapture={() => { if (pointer.current) clearDrag(); }}
            className="flex touch-none select-none cursor-grab items-center gap-2.5 rounded-lg py-1 outline-none active:cursor-grabbing">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-control text-ink-secondary"><Box size={18} /></span>
            <span className="min-w-0"><span className="block truncate text-[13px] font-medium">{computer.name}</span><span className="block text-[11px] text-ink-secondary">{t("canvasComputers.stateLine", { status: busy === computer.id ? t("canvasComputers.updating") : computer.state })}</span></span>
          </div>
          {computer.problem && <p className="mt-2 text-[11px] text-danger">{computer.problem}</p>}
          <label className="sr-only" htmlFor={`computer-team-${computer.id}`}>{t("canvasComputers.teamFor", { name: computer.name })}</label>
          <select id={`computer-team-${computer.id}`} className={`${field} mt-3`} disabled={busy !== null} value={computer.section === null ? "unassigned" : `team:${computer.section}`}
            onChange={(event) => requestAssignment(cloudPlaceable(computer), event.target.value === "unassigned" ? null : event.target.value.slice(5))}>
            <option value="unassigned">{t("canvasComputers.notAssigned")}</option>
            {sections.filter((section) => computer.section === null || section.key === computer.section).map((section) => <option key={section.key} value={`team:${section.key}`}>{section.name}</option>)}
          </select>
          {computer.section !== null && <p className="mt-1.5 text-[10px] text-ink-secondary">{t("canvasComputers.unassignHint")}</p>}
          <div className="mt-2 flex flex-wrap gap-1">
            {!ready && !starting && <button className={control} title={t("canvasComputers.startTitle")} disabled={busy !== null || held} onClick={() => void mutate(computer.id, () => post(computer.id, "provision", { acknowledgeCost: true }))}>{t("canvasComputers.startRetry")}</button>}
            {ready && !held && <button className={control} disabled={busy !== null} onClick={() => void mutate(computer.id, () => post(computer.id, "sleep"))}>{t("canvasComputers.sleep")}</button>}
            {ready && <button className={`${control} flex items-center gap-1.5`} title={t("canvasComputers.openDesktopTitle")} disabled={busy !== null} onClick={() => void mutate(computer.id, async () => {
              await post(computer.id, "control", { action: "take", controlLeaseId: controlLeaseId.current });
              setHeldHere(computer.id);
              return post(computer.id, "join");
            }, (value) => {
              // Only expose a deliberate link. A blocked popup must not trigger
              // another lifecycle request, and provider URLs are never iframes.
              if (typeof value.joinUrl === "string" && value.joinUrl.startsWith("https://")) setViewer({ id: computer.id, url: value.joinUrl });
            })}>{t("canvasComputers.openDesktop")} <ExternalLink size={11} /></button>}
            {heldHereNow && <button className={`${control} text-accent`} disabled={busy !== null} onClick={() => void mutate(computer.id, () => post(computer.id, "control", { action: "release", controlLeaseId: controlLeaseId.current }), () => { setHeldHere(null); setViewer(null); })}>{t("canvasComputers.returnToBots")}</button>}
            {computer.held && !heldHereNow && <button className={control} disabled title={t("canvasComputers.inUseTitle")}>{t("vm.state.inUse")}</button>}
          </div>
          {viewer?.id === computer.id && <a href={viewer.url} target="_blank" rel="noopener noreferrer" className="mt-2 block rounded-lg px-3 py-2 text-[12px] text-accent hover:bg-control">{t("canvasComputers.openSecure")}</a>}
        </article>; })}
      </div>
      {cloudEnabled && <footer className="border-t border-hairline/40 p-3"><button className={`${control} w-full text-left`} onClick={settings}>{t("canvasComputers.footer")}</button></footer>}
    </aside>}
    {dragging && createPortal(<div role="status" className="pointer-events-none fixed z-[70] rounded-xl border border-accent/40 bg-card px-4 py-3 text-[12px] text-ink shadow-xl" style={{ left: dragging.x + 14, top: dragging.y + 14 }}>
      <span className="flex items-center gap-2">{dragging.kind === "host" ? <Monitor size={15} /> : <Box size={15} />}{dragging.name}</span>
      <p className="mt-1 text-[10px] text-ink-secondary">{dragging.hint}</p>
    </div>, document.body)}
    <ConfirmDialog open={assignment !== null} tone="neutral" title={assignment?.section === null ? t("canvasComputers.dialog.unassignTitle", { name: assignment?.computer.name ?? t("canvasComputers.fallbackName") }) : t("canvasComputers.dialog.assignTitle", { name: assignment?.computer.name ?? t("canvasComputers.fallbackName"), team: assignment?.section || t("sidebar.section.general") })}
      body={assignment?.computer.kind === "host"
        ? assignment.section === null ? t("canvasComputers.dialog.hostUnassignBody") : t("canvasComputers.dialog.hostAssignBody")
        : assignment?.section === null
          ? t("canvasComputers.dialog.unassignBody")
          : t("canvasComputers.dialog.assignBody")}
      confirmLabel={assignment?.section === null ? t("canvasComputers.dialog.unassignConfirm") : t("canvasComputers.dialog.assignConfirm")} onCancel={cancelAssignment} onConfirm={() => {
        const target = assignment;
        if (!target) return;
        setAssignment(null);
        setViewer(null);
        if (target.computer.kind === "host") void mutate(target.computer.id, () => placeRemoteHost(target.computer.id, target.section));
        else void mutate(target.computer.id, () => api(`/api/team-computers/${encodeURIComponent(target.computer.id)}`, { method: "PATCH", body: JSON.stringify({ section: target.section, acknowledgeSharedAccess: true }) }));
      }} />
  </>;
}
