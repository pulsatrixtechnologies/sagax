// My devices (2026-11-07, Grok "Manage devices"): every Sagax install of
// the person (desktop and iOS), this one first. One card row per device: its
// icon, its name (a pencil renames the current one), "Computer · Online now"
// or "iOS · Last opened 5 hours ago", then for a computer what bots may do
// with it (Always allow, Ask every time, Never allow) and a "⋯" menu (Rename,
// Remove). A phone is listed for presence only. The Computer menu and
// Settings > Computer read this same list (src/lib/desktop-bridge.ts).
import { useState } from "react";
import { Pencil, Smartphone, Monitor, Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PageMenuItem } from "@/components/content-page";
import { ComputerChangeError, removeComputer, renameComputer, setComputerAccess, type DeviceAccess, type MyDevice } from "@/lib/desktop-bridge";
import { t } from "@/lib/i18n";
import { relativeTime } from "@/lib/memory";
import { DeviceCardRow } from "./DeviceCardRow";

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

export function DeviceRow({ device }: { device: MyDevice }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(device.name);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // shown at once, the next status agrees
  const [access, setAccess] = useState<DeviceAccess | null>(device.access);
  const [name, setName] = useState(device.name);
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
  const title = editing ? (
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
  );
  return (
    <DeviceCardRow kind="my-device" icon={computer ? Monitor : Smartphone} title={title} line={deviceLine(device)} online={device.online}
      rowData={{ "data-my-device": device.kind, "data-current": device.current ? "" : undefined }}
      access={computer && access ? { value: access, name, disabled: busy, onChange: choose } : undefined}
      menu={computer && access ? {
        name,
        items: (close) => <>
          {device.desktopId && (
            <PageMenuItem icon={Pencil} onClick={() => { close(); setDraft(name); setEditing(true); }}>{t("computer.rename")}</PageMenuItem>
          )}
          <PageMenuItem icon={Trash2} data-my-device-remove="" aria-disabled={device.online || undefined}
            title={device.online ? t("computer.remove.online") : undefined}
            onClick={() => { if (device.online) return; close(); setConfirming(true); }}>{t("computer.remove")}</PageMenuItem>
        </>,
      } : undefined}>
      {error && <p role="alert" className="pl-12 text-[12px] text-danger">{error}</p>}
      <ConfirmDialog open={confirming} tone="danger" title={t("computer.remove.title")} body={t("computer.remove.body", { name })}
        confirmLabel={t("computer.remove")} pending={busy} onCancel={() => setConfirming(false)}
        onConfirm={() => void run(async () => { try { await removeComputer(target); } finally { setConfirming(false); } })} />
    </DeviceCardRow>
  );
}

/** The React key of a device row: changes when the server's name or access does. */
export const deviceRowKey = (device: MyDevice) => `${device.key}:${device.access ?? ""}:${device.name}`;

/** The person's devices as card rows, this one first (the order the server gives). */
export function MyDevicesList({ devices }: { devices: readonly MyDevice[] }) {
  if (devices.length === 0) return null;
  return (
    <ul data-my-devices="" aria-label={t("myDevices.title")} className="flex flex-col gap-2">
      {devices.map((device) => <DeviceRow key={deviceRowKey(device)} device={device} />)}
    </ul>
  );
}
