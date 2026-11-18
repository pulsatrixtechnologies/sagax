// The Computers tab of the Remote Sessions page (docs/inscription-hote.md,
// "Côté Sagax"; a table since 2026-11-17): one table with two group bands,
// "Unattended" (the computers Perspicax enrolled) and "My devices" (every Sagax
// install of the person: this computer, a phone, a tablet), both as the same
// ComputerTableRow. A host row says its OS, "Online now" or "Last seen ...",
// which bots may use it ("All bots" or their names, "Shared by <name>", "Bot
// computer", tags), what bots may do with it (Always allow, Ask every time,
// Never allow, enforced by the server) and a "..." menu (Unattended access,
// Revoke, Bots, Team, Share, Copy the id). Organization, scope and dates ride
// the name's second line, never folded. A host not seen for 14 days is dimmed.
// No host id on screen: the readable name, the id only in a tooltip and the
// Copy action. Unattended access is always enabled (2026-11-01).
// #2957: "Shared by <name>" for a colleague's computer; Bots... and Share...
// on the person's own hosts (Share only inside an organization).
// #4327: the menu keeps the computer's own actions; how each bot uses the
// computer (isolated or as-is) is set in Bots....
import { useState } from "react";
import { Bot as BotIcon, Copy, KeyRound, Monitor, Network, Plus, Search, Share2, ShieldOff, Smartphone } from "lucide-react";

import {
  canOpenUnattendedHost,
  canRevokeUnattendedHost,
  unattendedHostOnline,
  type UnattendedHostAccess,
  type UnattendedHostOs,
  type UnattendedHostRow,
} from "../../../shared/remote-unattended-host";
import type { BotComputerHostView } from "../../../shared/bot-computer-host";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PAGE_ACTION_BUTTON, PageEmpty, PageMenuItem } from "@/components/content-page";
import { GroupBand } from "@/components/routines/RoutineTable";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/copy-text";
import { activeLocale, t } from "@/lib/i18n";
import type { MyDevice } from "@/lib/desktop-bridge";
import { relativeTime } from "@/lib/memory";
import { DEVICE_CHIP, ComputerTableHead, ComputerTableRow } from "./ComputerTableRow";
import { DeviceRow, deviceKind, deviceRowKey, groupDevices, seenLongAgo } from "./MyDevicesList";
import { setRemoteHostAccess, type UnattendedHostShare } from "./remote-hosts-client";
import { HostBotsDialog, HostShareDialog, HostTeamDialog, hostBotsLabel, useHostBotChoices } from "./HostSharingControls";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { HostBotComputerChips, HostBotComputerMenuItems, HostBotComputerTags } from "./HostBotComputerControls";
import { useHostComputers } from "@/lib/host-computers";
import {
  openUnattendedHost,
  revokeUnattendedHost,
  type UnattendedHostFailure,
  type UnattendedHostsState,
} from "./use-remote-sessions-admin";

function dateLabel(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(activeLocale(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hourCycle: "h23" }).format(date);
}

/** The name a person reads for a host: its readable hostname, else a plain word. */
export function unattendedHostLabel(row: Pick<UnattendedHostRow, "hostname">): string {
  return row.hostname ?? t("remoteSessionsAdmin.hosts.unnamed");
}

type Notice = { kind: "pending" | "revoked"; host: string } | { kind: "error"; error: UnattendedHostFailure } | { kind: "access" };

const OS_LABEL: Record<UnattendedHostOs, string> = { macos: "macOS", windows: "Windows", linux: "Linux" };

const seenAt = (row: Pick<UnattendedHostRow, "lastSeenAt">) => (row.lastSeenAt ? Date.parse(row.lastSeenAt) || 0 : 0);

export function hostKind(os: UnattendedHostOs | undefined): string {
  return os ? OS_LABEL[os] : t("myDevices.computer");
}

export function hostPresence(row: UnattendedHostRow, now = Date.now()): string {
  const seen = seenAt(row);
  return row.state !== "enrolled"
    ? t(`remoteSessionsAdmin.hosts.state.${row.state}`)
    : unattendedHostOnline(row, now) ? t("myDevices.onlineNow")
      : seen > 0 ? t("remoteSessionsAdmin.hosts.lastSeen", { when: relativeTime(seen, now) }) : t("remoteSessionsAdmin.hosts.neverSeen");
}

/** "Linux · Online now", "Computer · Last seen 5 hr ago", "Windows · Revoked". */
export function hostLine(row: UnattendedHostRow, os: UnattendedHostOs | undefined, now = Date.now()): string {
  return `${hostKind(os)} · ${hostPresence(row, now)}`;
}

export type DeviceEntry = { kind: "device"; device: MyDevice } | { kind: "host"; host: UnattendedHostRow };

/** One list: "This device" first, then online, offline last; the most
 * recent activity first inside each group. */
export function sortDeviceEntries(devices: readonly MyDevice[], hosts: readonly UnattendedHostRow[], now = Date.now()): DeviceEntry[] {
  const rank = (entry: DeviceEntry) => entry.kind === "device"
    ? { current: entry.device.current, online: entry.device.online, at: entry.device.lastSeenAt }
    : { current: false, online: unattendedHostOnline(entry.host, now), at: seenAt(entry.host) };
  const entries: DeviceEntry[] = [
    ...devices.map((device) => ({ kind: "device" as const, device })),
    ...hosts.map((host) => ({ kind: "host" as const, host })),
  ];
  return entries
    .map((entry, index) => ({ entry, index, key: rank(entry) }))
    .sort((a, b) => Number(b.key.current) - Number(a.key.current) || Number(b.key.online) - Number(a.key.online) || b.key.at - a.key.at || a.index - b.index)
    .map(({ entry }) => entry);
}

function HostRow({ row, os, busy, onOpen, onRevoke, onError, botComputer, onBotComputerChanged }: {
  row: UnattendedHostRow;
  /** #2726: this host as a bot computer (toggle, tags, per-bot mode in Bots…). */
  botComputer: BotComputerHostView | null;
  onBotComputerChanged: () => void;
  os?: UnattendedHostOs;
  busy: boolean;
  onOpen: (row: UnattendedHostRow) => void;
  onRevoke: (row: UnattendedHostRow) => void;
  onError: () => void;
}) {
  const label = unattendedHostLabel(row);
  const [editingTags, setEditingTags] = useState(false);
  const [access, setAccess] = useState<UnattendedHostAccess>(row.access ?? "always");
  const [saving, setSaving] = useState(false);
  // #2957: which bots may use it, and who it is shared with (own hosts only).
  const botChoices = useHostBotChoices();
  const [bots, setBots] = useState<string[] | null>(row.bots && row.bots.length ? [...row.bots] : null);
  const [shares, setShares] = useState<UnattendedHostShare[]>(row.shares ?? []);
  const [editingBots, setEditingBots] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [placing, setPlacing] = useState(false);
  const mine = !row.sharedBy;
  const inOrg = usePerspicaxOrg() !== null;
  const choose = (next: UnattendedHostAccess) => {
    const previous = access;
    setAccess(next);
    setSaving(true);
    void setRemoteHostAccess(row.hostId, next)
      .catch(() => { setAccess(previous); onError(); })
      .finally(() => setSaving(false));
  };
  const usable = canOpenUnattendedHost(row);
  // the second line of the name: where it is enrolled, with what scope, since when
  const facts = [
    row.org,
    t(`remoteSessionsAdmin.hosts.scope.${row.scope}`),
    row.enrolledAt ? `${t("remoteSessionsAdmin.hosts.col.enrolled")} ${dateLabel(row.enrolledAt)}` : "",
    row.expiresAt ? `${t("remoteSessionsAdmin.hosts.col.expires")} ${dateLabel(row.expiresAt)}` : "",
  ].filter((part): part is string => Boolean(part));
  const enrolled = row.state === "enrolled";
  const botsWorkHere = Object.keys(botComputer?.modes ?? {}).length > 0;
  return (
    <ComputerTableRow kind="unattended-host" icon={Monitor} online={unattendedHostOnline(row)} dim={seenLongAgo(unattendedHostOnline(row), seenAt(row))}
      foldedTitle={[hostLine(row, os), ...facts].join(" · ")} type={hostKind(os)} presence={hostPresence(row)} folded={[hostLine(row, os), enrolled ? (row.sharedBy ? t("remoteSessionsAdmin.hosts.share.sharedBy", { name: row.sharedBy }) : hostBotsLabel(bots, botChoices)) : ""].filter(Boolean).join(" · ")} sub={<span title={facts.join(" · ")}>{facts.join(" · ")}</span>}
      meta={(
        <>
          {enrolled && (row.sharedBy ? (
            <span data-unattended-host-shared-by="" className={DEVICE_CHIP} title={t("remoteSessionsAdmin.hosts.share.sharedBy", { name: row.sharedBy })}>
              <Share2 size={11} aria-hidden="true" className="shrink-0" /><span className="truncate">{t("remoteSessionsAdmin.hosts.share.sharedBy", { name: row.sharedBy })}</span>
            </span>
          ) : (
            <span data-unattended-host-bots="" className={DEVICE_CHIP} title={hostBotsLabel(bots, botChoices)}>
              <BotIcon size={11} aria-hidden="true" className="shrink-0" /><span className="truncate">{hostBotsLabel(bots, botChoices)}</span>
            </span>
          ))}
          {enrolled && mine && shares.length > 0 && (
            <span data-unattended-host-shares="" className={DEVICE_CHIP} title={shares.map((share) => share.name).join(", ")}>
              <Share2 size={11} aria-hidden="true" className="shrink-0" /><span className="truncate">{t("remoteSessionsAdmin.hosts.share.count", { count: String(shares.length) })}</span>
            </span>
          )}
          <HostBotComputerChips host={botComputer} />
        </>
      )}
      rowData={{ "data-unattended-host": "", "data-state": row.state, ...(row.sharedBy ? { "data-shared": "" } : {}) }}
      title={<span className="block truncate text-[13px] font-medium leading-[18px] text-ink" title={row.hostId}>{label}</span>}
      access={usable ? { value: access, name: label, disabled: saving || busy, onChange: choose } : undefined}
      menu={{
        name: label,
        items: (close) => <>
          {usable && (
            <PageMenuItem icon={KeyRound} data-unattended-host-open="" aria-disabled={busy || undefined} onClick={() => { if (busy) return; close(); onOpen(row); }}>{t("remoteSessionsAdmin.hosts.open")}</PageMenuItem>
          )}
          {mine && canRevokeUnattendedHost(row) && (
            <PageMenuItem icon={ShieldOff} data-unattended-host-revoke="" aria-disabled={busy || undefined} onClick={() => { if (busy) return; close(); onRevoke(row); }}>{t("remoteSessionsAdmin.hosts.revoke")}</PageMenuItem>
          )}
          {/* #4327: on a shared computer, Bots… keeps only the environment of the person's bots. */}
          {enrolled && (mine || botsWorkHere) && (
            <PageMenuItem icon={BotIcon} data-unattended-host-bots-edit="" onClick={() => { close(); setEditingBots(true); }}>{t("remoteSessionsAdmin.hosts.bots.menu")}</PageMenuItem>
          )}
          {mine && row.state === "enrolled" && (
            <PageMenuItem icon={Network} data-unattended-host-team="" onClick={() => { close(); setPlacing(true); }}>{t("remoteSessionsAdmin.hosts.team.menu")}</PageMenuItem>
          )}
          {mine && inOrg && row.state === "enrolled" && (
            <PageMenuItem icon={Share2} data-unattended-host-share="" trailing={shares.length > 0 ? String(shares.length) : undefined}
              onClick={() => { close(); setSharing(true); }}>{t("remoteSessionsAdmin.hosts.share.menu")}</PageMenuItem>
          )}
          {row.state === "enrolled" && (
            <HostBotComputerMenuItems hostId={row.hostId} host={botComputer} close={close}
              onEditTags={() => setEditingTags(true)} onChanged={onBotComputerChanged} />
          )}
          <PageMenuItem icon={Copy} data-unattended-host-copy="" title={row.hostId} onClick={() => { close(); void copyText(row.hostId); }}>{t("remoteSessionsAdmin.hosts.copyId")}</PageMenuItem>
        </>,
      }}>
      <HostBotComputerTags hostId={row.hostId} host={botComputer} editing={editingTags}
        onDone={() => setEditingTags(false)} onChanged={onBotComputerChanged} />
      {editingBots && <HostBotsDialog hostId={row.hostId} host={label} value={bots} scoped={mine} computer={botComputer}
        onSaved={setBots} onComputerChanged={onBotComputerChanged} onClose={() => setEditingBots(false)} />}
      {placing && <HostTeamDialog hostId={row.hostId} host={label} onClose={() => setPlacing(false)} />}
      {sharing && <HostShareDialog hostId={row.hostId} host={label} shares={shares} onChanged={setShares} onClose={() => setSharing(false)} />}
    </ComputerTableRow>
  );
}

/** What the toolbar narrows the Computers tab to; every field is optional. */
export interface ComputerFilters {
  query?: string;
  onlineOnly?: boolean;
  /** Only the Unattended group. */
  unattendedOnly?: boolean;
  type?: "all" | "computer" | "phone";
}

export function UnattendedHostsSection({ state, devices = [], osByHost, onOpened, onAdd, filters = {}, onClearFilters }: {
  state: Pick<UnattendedHostsState, "hosts" | "available" | "loading" | "reload">;
  /** The person's own devices, in the same table (src/lib/desktop-bridge.ts myDevices). */
  devices?: readonly MyDevice[];
  /** A host's OS when Perspicax did not give it: from its sessions, by lowercase hostname. */
  osByHost?: ReadonlyMap<string, UnattendedHostOs>;
  /** A session was opened against a host: the page takes over once its row connects. */
  onOpened?: (opened: { code: string; botId: string }) => void;
  /** The empty state's action: enrol a computer (the page's "Add computer"). */
  onAdd?: () => void;
  filters?: ComputerFilters;
  onClearFilters?: () => void;
}) {
  const { hosts, available, loading, reload } = state;
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<UnattendedHostRow | null>(null);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) => setFolded((current) => { const next = new Set(current); if (!next.delete(key)) next.add(key); return next; });
  // Bot computers (#2726): the toggle, the tags and the isolated / as-is answers.
  const botComputers = useHostComputers(hosts.length > 0);

  const open = async (row: UnattendedHostRow) => {
    setBusy(row.hostId);
    const out = await openUnattendedHost(row.hostId);
    setBusy(null);
    if (!out.ok) { setNotice({ kind: "error", error: out.error }); return; }
    setNotice({ kind: "pending", host: unattendedHostLabel(row) });
    onOpened?.({ code: out.code, botId: out.botId });
  };
  const revoke = async (row: UnattendedHostRow) => {
    setConfirmRevoke(null);
    setBusy(row.hostId);
    const out = await revokeUnattendedHost(row.hostId, reason);
    setReason("");
    setBusy(null);
    if (!out.ok) { setNotice({ kind: "error", error: out.error }); return; }
    setNotice({ kind: "revoked", host: unattendedHostLabel(row) });
    reload();
  };
  const query = (filters.query ?? "").trim().toLowerCase();
  const type = filters.type ?? "all";
  const osOf = (host: UnattendedHostRow) => host.os ?? (host.hostname ? osByHost?.get(host.hostname.toLowerCase()) : undefined);
  // #3134: the unattended computers apart from the person's other devices.
  const hostEntries = sortDeviceEntries([], hosts).flatMap((entry) => entry.kind === "host" ? [entry.host] : [])
    .filter((host) => type !== "phone"
      && (!filters.onlineOnly || unattendedHostOnline(host))
      && (!query || `${unattendedHostLabel(host)} ${host.org ?? ""} ${hostKind(osOf(host))}`.toLowerCase().includes(query)));
  const deviceGroups = filters.unattendedOnly ? [] : groupDevices(sortDeviceEntries(devices, []).flatMap((entry) => entry.kind === "device" ? [entry.device] : []))
    .filter(({ device, aliases }) => (type === "all" || (type === "phone") === (device.kind === "phone"))
      && (!filters.onlineOnly || device.online || aliases.some((alias) => alias.online))
      && (!query || [device, ...aliases].some((one) => `${one.name} ${deviceKind(one)}`.toLowerCase().includes(query))));
  const narrowed = Boolean(query || filters.onlineOnly || filters.unattendedOnly || type !== "all");
  const empty = hostEntries.length === 0 && deviceGroups.length === 0;
  const count = (n: number) => t(n === 1 ? "remoteComputers.countOne" : "remoteComputers.count", { count: n });

  return (
    <div data-unattended-hosts="" data-my-devices-section="" className="space-y-3">
      {notice && (
        <p data-unattended-hosts-notice={notice.kind} role="status" className={cn("rounded-lg border px-3 py-2 text-[12.5px]", notice.kind === "error" ? "border-danger/30 bg-danger/10 text-danger" : "border-hairline/50 bg-panel text-ink-secondary")}>
          {notice.kind === "error" ? t(`remoteSessionsAdmin.hosts.error.${notice.error}`) : notice.kind === "access" ? t("remoteSessionsAdmin.hosts.accessFailed") : t(`remoteSessionsAdmin.hosts.${notice.kind}`, { host: notice.host })}
        </p>
      )}
      {empty && (
        <div data-unattended-hosts-empty="">
          <PageEmpty icon={narrowed ? Search : Monitor} action={narrowed
            ? (onClearFilters ? <button type="button" onClick={onClearFilters} className={PAGE_ACTION_BUTTON}>{t("remoteSessionsAdmin.clearFilters")}</button> : undefined)
            : !loading && available && onAdd
              ? <button type="button" data-unattended-hosts-add="" onClick={onAdd} className={PAGE_ACTION_BUTTON}><Plus size={15} aria-hidden="true" />{t("remoteSessionsAdmin.addComputer")}</button>
              : undefined}>
            <p className={cn(!loading && (available || narrowed) && "font-medium text-ink")}>
              {narrowed ? t("remoteComputers.emptyFilteredTitle") : loading ? t("remoteSessionsAdmin.hosts.loading") : available ? t("remoteSessionsAdmin.hosts.empty") : t("remoteSessionsAdmin.hosts.unavailable")}
            </p>
            {!loading && (available || narrowed) && <p className="mt-1">{narrowed ? t("remoteComputers.emptyFiltered") : t("remoteSessionsAdmin.hosts.emptyHint")}</p>}
          </PageEmpty>
        </div>
      )}
      {!empty && (
        <div role="table" aria-label={t("remoteComputers.tab")} data-computers-table="">
          <ComputerTableHead />
          {hostEntries.length > 0 && (
            <div role="rowgroup" data-unattended-hosts-list="" className="pt-2">
              <GroupBand data-computers-group="unattended" lead={<KeyRound size={16} />} name={t("remoteComputers.group.unattended")} count={hostEntries.length} countLabel={count(hostEntries.length)}
                collapsed={folded.has("unattended")} onToggle={() => toggle("unattended")} columnCount={6} />
              {!folded.has("unattended") && hostEntries.map((host) => (
                <HostRow key={`${host.hostId}:${host.access ?? ""}`} row={host} busy={busy === host.hostId}
                  os={osOf(host)}
                  onOpen={(row) => void open(row)} onRevoke={(row) => { setReason(""); setConfirmRevoke(row); }}
                  onError={() => setNotice({ kind: "access" })}
                  botComputer={botComputers.hosts.find((candidate) => candidate.hostId === host.hostId) ?? null}
                  onBotComputerChanged={() => botComputers.reload()} />
              ))}
            </div>
          )}
          {deviceGroups.length > 0 && (
            <div role="rowgroup" data-my-devices="" aria-label={t("myDevices.title")} className="pt-3">
              <GroupBand data-computers-group="devices" lead={<Smartphone size={16} />} name={t("myDevices.title")} count={deviceGroups.length} countLabel={t(deviceGroups.length === 1 ? "remoteComputers.devicesOne" : "remoteComputers.devices", { count: deviceGroups.length })}
                collapsed={folded.has("devices")} onToggle={() => toggle("devices")} columnCount={6} />
              {!folded.has("devices") && deviceGroups.map((group) => <DeviceRow key={deviceRowKey(group.device, group.aliases)} device={group.device} aliases={group.aliases} />)}
            </div>
          )}
        </div>
      )}
      {confirmRevoke && (
        <ConfirmDialog
          open
          tone="danger"
          title={t("remoteSessionsAdmin.hosts.revokeTitle", { host: unattendedHostLabel(confirmRevoke) })}
          body={t("remoteSessionsAdmin.hosts.revokeBody")}
          confirmLabel={t("remoteSessionsAdmin.hosts.revoke")}
          onCancel={() => setConfirmRevoke(null)}
          onConfirm={() => void revoke(confirmRevoke)}
          extra={
            <label className="block text-[12px] text-ink-secondary">
              {t("remoteSessionsAdmin.hosts.reasonLabel")}
              <input
                type="text"
                data-unattended-host-revoke-reason=""
                value={reason}
                maxLength={256}
                onChange={(event) => setReason(event.target.value)}
                placeholder={t("remoteSessionsAdmin.hosts.reasonPlaceholder")}
                className="mt-1 w-full rounded-lg border border-hairline/50 bg-raised px-2 py-1 text-[13px] text-ink"
              />
            </label>
          }
        />
      )}
    </div>
  );
}
