// "Unattended computers" (was "Enrolled hosts") on the Remote Sessions page (docs/inscription-hote.md,
// "Côté Sagax"): one list of the person's own devices (every Sagax install)
// and the computers Perspicax enrolled for unattended access, as the same
// card row (#2723, DeviceCardRow): "This device" first, then online, offline
// last, most recent first in each group. A host row says "Linux · Online now"
// or "Last seen ...", what bots may do with it (Always allow, Ask every time,
// Never allow, enforced by the server) and a "⋯" menu (Unattended access,
// Revoke, Copy the id). Organization, scope and dates sit behind Details.
// Unattended access is always enabled (2026-11-01). No host id on screen:
// the readable name, the id only in a tooltip and the Copy action.
// #2957: the row also says which bots may use the host ("All bots" or their
// names) and, for a colleague's computer, "Shared by <name>"; the menu adds
// "Bots…" and "Share…" on the person's own hosts (Share only inside an
// organization: an impossible option is hidden, never greyed).
// #3134: two sections, "Unattended computers" (the enrolled hosts) and "My
// devices" (the Sagax installs: this computer, a phone, a tablet), each card
// the same height: bots, shares and "Bot computer" ride the card's line as
// chips, and Details repeats them in full with the tags.
import { useState } from "react";
import { Bot as BotIcon, ChevronDown, Copy, KeyRound, Monitor, Network, Plus, Share2, ShieldOff } from "lucide-react";

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
import { PAGE_ACTION_BUTTON, PageEmpty, PageMenuItem, PageSection } from "@/components/content-page";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/copy-text";
import { activeLocale, t } from "@/lib/i18n";
import type { MyDevice } from "@/lib/desktop-bridge";
import { relativeTime } from "@/lib/memory";
import { DEVICE_CHIP, DeviceCardRow } from "./DeviceCardRow";
import { DeviceRow, deviceRowKey } from "./MyDevicesList";
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

/** "Linux · Online now", "Computer · Last seen 5 hr ago", "Windows · Revoked". */
export function hostLine(row: UnattendedHostRow, os: UnattendedHostOs | undefined, now = Date.now()): string {
  const kind = os ? OS_LABEL[os] : t("myDevices.computer");
  const seen = seenAt(row);
  const presence = row.state !== "enrolled"
    ? t(`remoteSessionsAdmin.hosts.state.${row.state}`)
    : unattendedHostOnline(row, now) ? t("myDevices.onlineNow")
      : seen > 0 ? t("remoteSessionsAdmin.hosts.lastSeen", { when: relativeTime(seen, now) }) : t("remoteSessionsAdmin.hosts.neverSeen");
  return `${kind} · ${presence}`;
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
  /** #2726: this host as a bot computer (toggle, tags, per-bot mode). */
  botComputer: BotComputerHostView | null;
  onBotComputerChanged: () => void;
  os?: UnattendedHostOs;
  busy: boolean;
  onOpen: (row: UnattendedHostRow) => void;
  onRevoke: (row: UnattendedHostRow) => void;
  onError: () => void;
}) {
  const label = unattendedHostLabel(row);
  const [details, setDetails] = useState(false);
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
  const facts: [string, string][] = [
    [t("remoteSessionsAdmin.hosts.col.org"), row.org ?? ""],
    [t("remoteSessionsAdmin.hosts.col.scope"), t(`remoteSessionsAdmin.hosts.scope.${row.scope}`)],
    [t("remoteSessionsAdmin.hosts.col.enrolled"), dateLabel(row.enrolledAt)],
    [t("remoteSessionsAdmin.hosts.col.expires"), dateLabel(row.expiresAt)],
    // #3134: what the chips on the line say, in full.
    [t("remoteSessionsAdmin.hosts.col.sharedBy"), row.sharedBy ?? ""],
    [t("remoteSessionsAdmin.hosts.col.bots"), row.state === "enrolled" && mine ? hostBotsLabel(bots, botChoices) : ""],
    [t("remoteSessionsAdmin.hosts.col.shares"), mine ? shares.map((share) => share.name).join(", ") : ""],
    [t("remoteSessionsAdmin.hosts.col.role"), botComputer?.botComputer ? t("hostComputer.badge") : ""],
    [t("remoteSessionsAdmin.hosts.col.tags"), (botComputer?.tags ?? []).join(", ")],
  ];
  const enrolled = row.state === "enrolled";
  return (
    <DeviceCardRow kind="unattended-host" icon={Monitor} online={unattendedHostOnline(row)} line={hostLine(row, os)}
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
      title={(
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13.5px] font-semibold text-ink" title={row.hostId}>{label}</span>
          <button type="button" data-unattended-host-details="" aria-expanded={details} onClick={() => setDetails((open) => !open)}
            className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-[12px] text-ink-secondary hover:text-ink">
            {t("remoteSessionsAdmin.hosts.details")}<ChevronDown size={12} aria-hidden="true" className={cn("transition-transform", details && "rotate-180")} />
          </button>
        </div>
      )}
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
          {mine && row.state === "enrolled" && (
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
      {editingBots && <HostBotsDialog hostId={row.hostId} host={label} value={bots} onSaved={setBots} onClose={() => setEditingBots(false)} />}
      {placing && <HostTeamDialog hostId={row.hostId} host={label} onClose={() => setPlacing(false)} />}
      {sharing && <HostShareDialog hostId={row.hostId} host={label} shares={shares} onChanged={setShares} onClose={() => setSharing(false)} />}
      {details && (
        <dl data-unattended-host-facts="" className="ml-12 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px] leading-[18px]">
          {facts.filter(([, value]) => value).map(([name, value]) => (
            <div key={name} className="contents">
              <dt className="text-ink-secondary">{name}</dt>
              <dd className="min-w-0 truncate text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </DeviceCardRow>
  );
}

export function UnattendedHostsSection({ state, devices = [], osByHost, onOpened, onAdd }: {
  state: Pick<UnattendedHostsState, "hosts" | "available" | "loading" | "reload">;
  /** The person's own devices, in the same list (src/lib/desktop-bridge.ts myDevices). */
  devices?: readonly MyDevice[];
  /** A host's OS when Perspicax did not give it: from its sessions, by lowercase hostname. */
  osByHost?: ReadonlyMap<string, UnattendedHostOs>;
  /** A session was opened against a host: the page takes over once its row connects. */
  onOpened?: (opened: { code: string; botId: string }) => void;
  /** The empty state's action: enrol a computer (the page's "Add computer"). */
  onAdd?: () => void;
}) {
  const { hosts, available, loading, reload } = state;
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<UnattendedHostRow | null>(null);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
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
  // #3134: the unattended computers apart from the person's other devices.
  const hostEntries = sortDeviceEntries([], hosts);
  const deviceEntries = sortDeviceEntries(devices, []);

  return (
    <>
    <PageSection title={t("remoteSessionsAdmin.hosts.unattendedTitle")} count={hosts.length || undefined} data-unattended-hosts="">
      {notice && (
        <p data-unattended-hosts-notice={notice.kind} role="status" className={cn("rounded-lg border px-3 py-2 text-[12.5px]", notice.kind === "error" ? "border-danger/30 bg-danger/10 text-danger" : "border-hairline/50 bg-panel text-ink-secondary")}>
          {notice.kind === "error" ? t(`remoteSessionsAdmin.hosts.error.${notice.error}`) : notice.kind === "access" ? t("remoteSessionsAdmin.hosts.accessFailed") : t(`remoteSessionsAdmin.hosts.${notice.kind}`, { host: notice.host })}
        </p>
      )}
      {hostEntries.length === 0 && (
        <div data-unattended-hosts-empty="">
          <PageEmpty icon={Monitor} action={!loading && available && onAdd
            ? <button type="button" data-unattended-hosts-add="" onClick={onAdd} className={PAGE_ACTION_BUTTON}><Plus size={15} aria-hidden="true" />{t("remoteSessionsAdmin.addComputer")}</button>
            : undefined}>
            <p className={cn(!loading && available && "font-medium text-ink")}>{loading ? t("remoteSessionsAdmin.hosts.loading") : available ? t("remoteSessionsAdmin.hosts.empty") : t("remoteSessionsAdmin.hosts.unavailable")}</p>
            {!loading && available && <p className="mt-1">{t("remoteSessionsAdmin.hosts.emptyHint")}</p>}
          </PageEmpty>
        </div>
      )}
      {hostEntries.length > 0 && (
        <ul data-unattended-hosts-list="" aria-label={t("remoteSessionsAdmin.hosts.unattendedTitle")} className="flex flex-col gap-2">
          {hostEntries.map((entry) => entry.kind === "device"
            ? null
            : <HostRow key={`${entry.host.hostId}:${entry.host.access ?? ""}`} row={entry.host} busy={busy === entry.host.hostId}
                os={entry.host.os ?? (entry.host.hostname ? osByHost?.get(entry.host.hostname.toLowerCase()) : undefined)}
                onOpen={(row) => void open(row)} onRevoke={(row) => { setReason(""); setConfirmRevoke(row); }}
                onError={() => setNotice({ kind: "access" })}
                botComputer={botComputers.hosts.find((host) => host.hostId === entry.host.hostId) ?? null}
                onBotComputerChanged={() => botComputers.reload()} />)}
        </ul>
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
    </PageSection>
    {deviceEntries.length > 0 && (
      <PageSection title={t("myDevices.title")} count={devices.length} data-my-devices-section="">
        <ul data-my-devices="" aria-label={t("myDevices.title")} className="flex flex-col gap-2">
          {deviceEntries.map((entry) => entry.kind === "device" ? <DeviceRow key={deviceRowKey(entry.device)} device={entry.device} /> : null)}
        </ul>
      </PageSection>
    )}
    </>
  );
}
