// My devices (2026-11-07, Grok "Manage devices"): every Sagax install of
// the person (desktop and iOS), this one first. One card row per device: its
// icon, its name (a pencil renames the current one), "Computer · Online now"
// or "iOS · Last opened 5 hours ago", then for a computer what bots may do
// with it (Always allow, Ask every time, Never allow) and a "⋯" menu (Rename,
// Remove). A phone is listed for presence only. The Computer menu and
// Settings > Computer read this same list (src/lib/desktop-bridge.ts).
import { useRef, useState } from "react";
import { MoreHorizontal, Pencil, Smartphone, Monitor, Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PAGE_POPOVER, PageMenuItem } from "@/components/content-page";
import { PillSelect } from "@/components/SettingsPrimitives";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { cn } from "@/lib/cn";
import { ComputerChangeError, removeComputer, renameComputer, setComputerAccess, type DeviceAccess, type MyDevice } from "@/lib/desktop-bridge";
import { t } from "@/lib/i18n";
import { relativeTime } from "@/lib/memory";

const PLATFORM: Record<string, string> = { darwin: "macOS", win32: "Windows", linux: "Linux", ios: "iOS", ipados: "iPadOS" };

/** "Computer · Online now", "iOS · Last opened 5 hr ago". */
export function deviceLine(device: MyDevice, now = Date.now()): string {
  const kind = device.kind === "phone" ? PLATFORM[device.platform] ?? t("myDevices.phone") : t("myDevices.computer");
  const presence = device.online
    ? t("myDevices.onlineNow")
    : device.lastSeenAt > 0 ? t("myDevices.lastOpened", { when: relativeTime(device.lastSeenAt, now) }) : t("myDevices.neverOpened");
  return `${kind} · ${presence}`;
}

function refusal(error: unknown): string {
  const code = error instanceof ComputerChangeError ? error.code : undefined;
  if (code === "computer_online") return t("computer.remove.online");
  if (code === "computer_rate") return t("computer.remove.rate");
  return t("computer.change.failed");
}

const ICON_BUTTON = "flex size-8 shrink-0 items-center justify-center rounded-lg border border-hairline/50 text-ink-secondary hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:opacity-40";

function DeviceRow({ device }: { device: MyDevice }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(device.name);
  const [menu, setMenu] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // shown at once, the next status agrees
  const [access, setAccess] = useState<DeviceAccess | null>(device.access);
  const [name, setName] = useState(device.name);
  const menuRoot = useRef<HTMLDivElement>(null);
  usePopoverDismiss(menu, menuRoot, () => setMenu(false));
  const computer = device.kind === "computer";
  const target = device.desktopId ?? device.name;
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try { await work(); setError(""); } catch (failure) { setError(refusal(failure)); } finally { setBusy(false); }
  };
  const save = () => run(async () => {
    const next = draft.trim();
    if (!next || next === name) { setEditing(false); return; }
    await renameComputer(target, next);
    setName(next);
    setEditing(false);
  });
  const choose = (next: DeviceAccess) => {
    const previous = access;
    setAccess(next);
    void run(async () => {
      try { await setComputerAccess(target, next); } catch (failure) { setAccess(previous); throw failure; }
    });
  };
  const Icon = computer ? Monitor : Smartphone;
  return (
    <li data-my-device={device.kind} data-current={device.current ? "" : undefined} data-online={device.online ? "yes" : "no"}
      className="flex flex-col gap-1 rounded-xl border border-hairline/50 bg-panel p-3 transition-colors hover:border-hairline">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-raised text-ink-secondary"><Icon size={16} aria-hidden="true" /></span>
        <div className="min-w-[9rem] flex-1">
          {editing ? (
            <form className="flex min-w-0 items-center gap-2" onSubmit={(event) => { event.preventDefault(); void save(); }}>
              <input autoFocus value={draft} maxLength={120} disabled={busy} aria-label={t("computer.rename.aria", { name })}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Escape") { setEditing(false); setDraft(name); } }}
                className="h-7 min-w-0 flex-1 rounded-md bg-control px-2 text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/70" />
              <button type="submit" disabled={busy || !draft.trim()} className="ui-button">{t("computer.rename.save")}</button>
            </form>
          ) : (
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[13.5px] font-semibold text-ink" data-my-device-name="">{name}</span>
              {device.current && computer && (
                <button type="button" data-my-device-rename="" aria-label={t("computer.rename.aria", { name })} title={t("computer.rename")}
                  onClick={() => { setDraft(name); setEditing(true); }} className="rounded p-0.5 text-ink-secondary hover:text-ink">
                  <Pencil size={12} aria-hidden="true" />
                </button>
              )}
              {device.current && <span className="shrink-0 text-[12px] text-ink-secondary">{t("myDevices.thisDevice")}</span>}
            </div>
          )}
          <p className="mt-0.5 flex items-center gap-1.5 text-[12px] leading-[18px] text-ink-secondary" data-my-device-line="">
            <span className={cn("size-1.5 shrink-0 rounded-full", device.online ? "bg-success" : "bg-ink-secondary/50")} aria-hidden="true" />
            {deviceLine(device)}
          </p>
        </div>
        {computer && access && (
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <div data-my-device-access={access}>
              <PillSelect bordered value={access} disabled={busy} ariaLabel={t("myDevices.access.aria", { name })} onChange={choose}
                options={[
                  { value: "always", label: t("myDevices.access.always") },
                  { value: "ask", label: t("myDevices.access.ask") },
                  { value: "never", label: t("myDevices.access.never") },
                ]} />
            </div>
            <div ref={menuRoot} className="relative">
              <button type="button" data-my-device-more="" aria-haspopup="menu" aria-expanded={menu} aria-label={t("myDevices.more", { name })}
                onClick={() => setMenu((open) => !open)} className={ICON_BUTTON}>
                <MoreHorizontal size={14} aria-hidden="true" />
              </button>
              {menu && (
                <div role="menu" className={cn(PAGE_POPOVER, "w-[200px] gap-0.5 p-1.5")}>
                  {device.desktopId && (
                    <PageMenuItem icon={Pencil} onClick={() => { setMenu(false); setDraft(name); setEditing(true); }}>{t("computer.rename")}</PageMenuItem>
                  )}
                  <PageMenuItem icon={Trash2} data-my-device-remove="" aria-disabled={device.online || undefined}
                    title={device.online ? t("computer.remove.online") : undefined}
                    onClick={() => { if (device.online) return; setMenu(false); setConfirming(true); }}>{t("computer.remove")}</PageMenuItem>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {error && <p role="alert" className="pl-12 text-[12px] text-danger">{error}</p>}
      <ConfirmDialog open={confirming} tone="danger" title={t("computer.remove.title")} body={t("computer.remove.body", { name })}
        confirmLabel={t("computer.remove")} pending={busy} onCancel={() => setConfirming(false)}
        onConfirm={() => void run(async () => { try { await removeComputer(target); } finally { setConfirming(false); } })} />
    </li>
  );
}

/** The person's devices as card rows, this one first (the order the server gives). */
export function MyDevicesList({ devices }: { devices: readonly MyDevice[] }) {
  if (devices.length === 0) return null;
  return (
    <ul data-my-devices="" aria-label={t("myDevices.title")} className="flex flex-col gap-2">
      {devices.map((device) => <DeviceRow key={`${device.key}:${device.access ?? ""}:${device.name}`} device={device} />)}
    </ul>
  );
}
