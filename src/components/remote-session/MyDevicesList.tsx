// My devices (2026-11-07, Grok "Manage devices"; a table group since 2026-11-17):
// every Sagax install of the person (desktop and iOS), this one first, as rows
// of the Computers table (ComputerTableRow): icon, name (a pencil renames the
// current one), type, "Online now" or "Last opened 5 hours ago", then for a
// computer what bots may do with it (Always allow, Ask every time, Never
// allow) and a "..." menu (Rename, Remove). A phone is listed for presence
// only. The same Mac under two names ("Mac.local" and "Mac.localdomain") is
// ONE row with its other names; an old name not seen for a while can be
// removed from the menu, never automatically (the server sends no hardware id,
// so the name, without .local and .localdomain, is the only match). A device
// not seen for 14 days is dimmed. The Computer menu and Settings > Computer
// read this same list (src/lib/desktop-bridge.ts).
import { useState } from "react";
import { Pencil, Smartphone, Monitor, Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PageMenuItem } from "@/components/content-page";
import { ComputerChangeError, removeComputer, renameComputer, setComputerAccess, type DeviceAccess, type MyDevice } from "@/lib/desktop-bridge";
import { t } from "@/lib/i18n";
import { relativeTime } from "@/lib/memory";
import { ComputerTableRow } from "./ComputerTableRow";

const PLATFORM: Record<string, string> = { darwin: "macOS", win32: "Windows", linux: "Linux", ios: "iOS", ipados: "iPadOS" };

export const STALE_AFTER_MS = 14 * 86_400_000;

/** Not online and not seen for 14 days (a never-seen device is unknown, not stale). */
export function seenLongAgo(online: boolean, lastSeenAt: number, now = Date.now()): boolean {
  return !online && lastSeenAt > 0 && now - lastSeenAt > STALE_AFTER_MS;
}

export function deviceKind(device: MyDevice): string {
  return device.kind === "phone" ? PLATFORM[device.platform] ?? t("myDevices.phone") : t("myDevices.computer");
}

export function devicePresence(device: MyDevice, now = Date.now()): string {
  return device.online
    ? t("myDevices.onlineNow")
    : device.lastSeenAt > 0 ? t("myDevices.lastOpened", { when: relativeTime(device.lastSeenAt, now) }) : t("myDevices.neverOpened");
}

/** "Computer · Online now", "iOS · Last opened 5 hr ago". */
export function deviceLine(device: MyDevice, now = Date.now()): string {
  return `${deviceKind(device)} · ${devicePresence(device, now)}`;
}

/** A computer's name without the suffix a Mac gets from the network: "Studio-Mac.local" and "Studio-Mac.localdomain" are one machine. */
export function machineName(name: string): string {
  return name.trim().toLowerCase().replace(/\.(localdomain|local|lan|home)$/, "");
}

export interface DeviceGroup { device: MyDevice; aliases: MyDevice[] }

/** One entry per machine: computers sharing a name (modulo .local and .localdomain) merge, the one to show being this
 * device, else the one online, else the most recent; the others are its aliases. Phones and tablets never merge. Nothing is removed. */
export function groupDevices(devices: readonly MyDevice[]): DeviceGroup[] {
  const groups = new Map<string, MyDevice[]>();
  devices.forEach((device, index) => {
    const key = device.kind === "computer" ? `c:${machineName(device.name)}` : `d:${index}`;
    groups.set(key, [...(groups.get(key) ?? []), device]);
  });
  return [...groups.values()].map((members) => {
    const ranked = [...members].sort((a, b) => Number(b.current) - Number(a.current) || Number(b.online) - Number(a.online) || b.lastSeenAt - a.lastSeenAt);
    return { device: ranked[0]!, aliases: ranked.slice(1) };
  });
}

function refusal(error: unknown): string {
  const code = error instanceof ComputerChangeError ? error.code : undefined;
  if (code === "computer_online") return t("computer.remove.online");
  if (code === "computer_rate") return t("computer.remove.rate");
  return t("computer.change.failed");
}

export function DeviceRow({ device, aliases = [] }: { device: MyDevice; aliases?: readonly MyDevice[] }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(device.name);
  // the device (or one of its other names) the person is about to remove
  const [confirming, setConfirming] = useState<MyDevice | null>(null);
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
      <span className="truncate text-[13px] font-medium leading-[18px] text-ink" data-my-device-name="" title={name}>{name}</span>
      {device.current && computer && (
        <button type="button" data-my-device-rename="" aria-label={t("computer.rename.aria", { name })} title={t("computer.rename")}
          onClick={() => { setDraft(name); setEditing(true); }} className="rounded p-0.5 text-ink-secondary hover:text-ink">
          <Pencil size={12} aria-hidden="true" />
        </button>
      )}
      {device.current && <span className="shrink-0 text-[12px] text-ink-secondary">{t("myDevices.thisDevice")}</span>}
    </div>
  );
  const others = aliases.map((alias) => `${alias.name} (${devicePresence(alias)})`).join(", ");
  const doomed = confirming ?? device;
  const removable = (candidate: MyDevice) => computer && candidate.kind === "computer";
  return (
    <ComputerTableRow kind="my-device" icon={computer ? Monitor : Smartphone} title={title}
      sub={others ? <span data-my-device-aliases="" title={others}>{t("remoteComputers.alsoSeenAs", { names: others })}</span> : undefined}
      foldedTitle={[deviceLine(device), others].filter(Boolean).join(" · ")} type={deviceKind(device)} presence={devicePresence(device)} folded={deviceLine(device)} online={device.online}
      dim={seenLongAgo(device.online, device.lastSeenAt)}
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
            onClick={() => { if (device.online) return; close(); setConfirming(device); }}>{t("computer.remove")}</PageMenuItem>
          {aliases.filter(removable).map((alias) => (
            <PageMenuItem key={alias.key} icon={Trash2} data-my-device-remove-alias="" aria-disabled={alias.online || undefined}
              title={alias.online ? t("computer.remove.online") : undefined}
              onClick={() => { if (alias.online) return; close(); setConfirming(alias); }}>{t("remoteComputers.removeAlias", { name: alias.name })}</PageMenuItem>
          ))}
        </>,
      } : undefined}>
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      <ConfirmDialog open={confirming !== null} tone="danger" title={t("computer.remove.title")} body={t("computer.remove.body", { name: confirming === null || confirming === device ? name : confirming.name })}
        confirmLabel={t("computer.remove")} pending={busy} onCancel={() => setConfirming(null)}
        onConfirm={() => void run(async () => { try { await removeComputer(doomed.desktopId ?? doomed.name); } finally { setConfirming(null); } })} />
    </ComputerTableRow>
  );
}

/** The React key of a device row: changes when the server's name or access does. */
export const deviceRowKey = (device: MyDevice, aliases: readonly MyDevice[] = []) => `${device.key}:${device.access ?? ""}:${device.name}:${aliases.map((alias) => alias.key).join("+")}`;

/** The person's devices as table rows, one per machine, this one first (the order the server gives). */
export function MyDevicesList({ devices }: { devices: readonly MyDevice[] }) {
  if (devices.length === 0) return null;
  return (
    <div role="rowgroup" data-my-devices="" aria-label={t("myDevices.title")}>
      {groupDevices(devices).map((group) => <DeviceRow key={deviceRowKey(group.device, group.aliases)} device={group.device} aliases={group.aliases} />)}
    </div>
  );
}
