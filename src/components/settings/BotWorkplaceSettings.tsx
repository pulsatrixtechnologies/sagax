// Settings > Computer > Your computer, on an organization server (0.5.6:
// Grok Bot's Computer page, JC). Each bot's Works on decides (Auto and
// Cloud: the person's server environment; Local VM and This computer: their
// own computer through this desktop app); here, rows of the "Your computer"
// group: whether routines may use it, which destinations bots may reach
// through it (with whether it is connected), the person's other computers,
// and, behind a discreet link, what bots recently did there (#555)
// (src/lib/desktop-bridge.ts, server/desktop-bridge.ts).
import { useEffect, useState } from "react";
import { Link2, Pencil, Trash2 } from "lucide-react";

import { activeLocale, t } from "@/lib/i18n";
import { ComputerChangeError, currentDesktop, readWorkplace, removeComputer, renameComputer, useDesktopBridgeStatus, writeWorkplace, type DesktopBridgeActivity, type DesktopBridgeDesktop, type DesktopBridgeStatus } from "@/lib/desktop-bridge";
import { DEFAULT_BOT_WORKPLACE, type BotWorkplace } from "../../../shared/bot-workplace";
import { ConfirmDialog } from "../ConfirmDialog";
import { CountPill, DescribedRow, PillSelect, Switch } from "../SettingsPrimitives";

function when(ms: number): string {
  return new Intl.DateTimeFormat(activeLocale(), { dateStyle: "short", timeStyle: "short" }).format(new Date(ms));
}

export function activityLine(entry: DesktopBridgeActivity): string {
  const where = entry.target === "user-desktop" ? t("botWorkplace.activity.computer") : entry.target === "user-sandbox" ? t("botWorkplace.activity.server") : t("botWorkplace.activity.direct");
  // a connection's detail is the platform and host name: never shown
  const what = entry.kind === "connect" ? t("botWorkplace.activity.connected") : entry.detail;
  return `${what} · ${where}${entry.ok ? "" : ` · ${t("botWorkplace.activity.failed")}`}`;
}

/** The person's computers other than the one bots use now, the most
 * recently seen first. */
export function otherComputers(status: DesktopBridgeStatus): DesktopBridgeDesktop[] {
  const current = currentDesktop(status);
  return status.desktops.filter((desktop) => desktop.id !== current?.id).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

function seenLine(desktop: DesktopBridgeDesktop): string {
  return desktop.online ? t("orgComputer.connected") : t("computer.lastSeen", { when: when(desktop.lastSeenAt) });
}

function refusal(error: unknown): string {
  const code = error instanceof ComputerChangeError ? error.code : undefined;
  if (code === "computer_online") return t("computer.remove.online");
  if (code === "computer_rate") return t("computer.remove.rate");
  return t("computer.change.failed");
}

/** One other computer: its name and when it was seen, with Rename (in the
 * row) and Remove (confirmed; refused while it is online). sagax_settings:
 * computer.rename, computer.remove. */
function OtherComputerRow({ desktop, name, onRenamed, onRemoved }: { desktop: DesktopBridgeDesktop; name: string; onRenamed: (name: string) => void; onRemoved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    const next = draft.trim();
    if (!next || next === name) { setEditing(false); return; }
    setBusy(true);
    try {
      await renameComputer(desktop.id, next);
      onRenamed(next);
      setEditing(false);
      setError("");
    } catch (failure) {
      setError(refusal(failure));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await removeComputer(desktop.id);
      setConfirming(false);
      onRemoved();
    } catch (failure) {
      setConfirming(false);
      setError(refusal(failure));
    } finally {
      setBusy(false);
    }
  };
  const iconButton = "inline-flex size-7 min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-ink-secondary hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:opacity-40 md:min-h-0 md:min-w-0";
  return (
    <li className="flex flex-col gap-0.5 rounded-lg px-2 py-1 text-[13px] hover:bg-hover" data-computer-row="">
      <div className="flex min-w-0 items-center justify-between gap-3">
        {editing ? (
          <form className="flex min-w-0 flex-1 items-center gap-2" onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <input
              autoFocus
              value={draft}
              maxLength={120}
              disabled={busy}
              aria-label={t("computer.rename.aria", { name })}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Escape") { setEditing(false); setDraft(name); } }}
              className="h-7 min-w-0 flex-1 rounded-md bg-control px-2 text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
            />
            <button type="submit" disabled={busy || !draft.trim()} className="ui-button">{t("computer.rename.save")}</button>
          </form>
        ) : (
          <span className="min-w-0 truncate text-ink">{name}</span>
        )}
        <span className="flex shrink-0 items-center gap-1">
          <span className="text-[12px] text-ink-secondary">{seenLine(desktop)}</span>
          {!editing && (
            <button type="button" className={iconButton} aria-label={t("computer.rename.aria", { name })} title={t("computer.rename")} onClick={() => { setDraft(name); setEditing(true); }}>
              <Pencil size={13} aria-hidden="true" />
            </button>
          )}
          <button type="button" className={iconButton} aria-label={t("computer.remove.aria", { name })} title={desktop.online ? t("computer.remove.online") : t("computer.remove")} disabled={desktop.online || busy} onClick={() => setConfirming(true)}>
            <Trash2 size={13} aria-hidden="true" />
          </button>
        </span>
      </div>
      {error ? <span role="alert" className="text-[12px] text-danger">{error}</span> : null}
      <ConfirmDialog
        open={confirming}
        tone="danger"
        title={t("computer.remove.title")}
        body={t("computer.remove.body", { name })}
        confirmLabel={t("computer.remove")}
        pending={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void remove()}
      />
    </li>
  );
}

export function BotWorkplaceSettings({ status: given }: { status?: DesktopBridgeStatus } = {}) {
  const polled = useDesktopBridgeStatus(15_000);
  const status = given ?? polled;
  const [showActivity, setShowActivity] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  const [workplace, setWorkplace] = useState<BotWorkplace>(() => {
    if (given?.workplace) return given.workplace;
    try { return readWorkplace(); } catch { return { ...DEFAULT_BOT_WORKPLACE }; }
  });
  useEffect(() => { if (status?.workplace) setWorkplace(status.workplace); }, [status?.workplace?.routines, status?.workplace?.network]);
  // renamed or removed here: shown at once, the next poll agrees
  const [names, setNames] = useState<Record<string, string>>({});
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  if (!status) return null;
  const change = (next: Partial<BotWorkplace>) => {
    const value = { ...workplace, ...next };
    setWorkplace(value);
    writeWorkplace(value);
  };
  const others = otherComputers(status).filter((desktop) => !gone.has(desktop.id)).map((desktop) => (names[desktop.id] ? { ...desktop, name: names[desktop.id]! } : desktop));
  return (
    <div data-settings-card="organization.botWorkplace" data-desktop-connected={status.connected ? "yes" : "no"}>
      <DescribedRow label={t("botWorkplace.routinesShort")} description={t("botWorkplace.routinesHint")} rowId="routines">
        <Switch checked={workplace.routines} aria-label={t("botWorkplace.routines")} onClick={() => change({ routines: !workplace.routines })} />
      </DescribedRow>
      <DescribedRow
        label={t("botWorkplace.network")}
        icon={<Link2 size={14} />}
        description={<span role="status">{t(status.connected ? "botWorkplace.status.connected" : "botWorkplace.status.notConnected")}</span>}
        rowId="network"
      >
        <PillSelect
          value={workplace.network}
          ariaLabel={t("botWorkplace.network")}
          onChange={(network) => change({ network })}
          options={[
            { value: "all", label: t("botWorkplace.network.all") },
            { value: "lan", label: t("botWorkplace.network.lan") },
          ]}
        />
      </DescribedRow>
      {others.length > 0 && (
        <DescribedRow
          label={t("computer.others")}
          description={`${others[0]!.name} · ${seenLine(others[0]!)}`}
          rowId="others"
          below={showOthers && (
            <ul className="mt-2 flex flex-col gap-0.5" aria-label={t("computer.others")} data-other-computers="">
              {others.map((desktop) => (
                <OtherComputerRow
                  key={desktop.id}
                  desktop={desktop}
                  name={desktop.name}
                  onRenamed={(next) => setNames((current) => ({ ...current, [desktop.id]: next }))}
                  onRemoved={() => setGone((current) => new Set([...current, desktop.id]))}
                />
              ))}
            </ul>
          )}
        >
          <CountPill
            count={others.length}
            open={showOthers}
            label={t(showOthers ? "computer.others.hide" : "computer.others.show")}
            onToggle={() => setShowOthers((open) => !open)}
          />
        </DescribedRow>
      )}
      {status.activity.length > 0 && (
        <div className="flex flex-col gap-1 px-3.5 pb-2 pt-1" data-bot-activity={showActivity ? "open" : "closed"}>
          <button type="button" aria-expanded={showActivity} onClick={() => setShowActivity((open) => !open)}
            className="min-h-[44px] self-start rounded-md text-[12px] text-ink-secondary hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 md:min-h-0">
            {showActivity ? t("botWorkplace.activity.hide") : t("botWorkplace.activity.show")}
          </button>
          {showActivity && (
            <ul className="flex flex-col gap-0.5 text-[12px]" aria-label={t("botWorkplace.activity")}>
              {status.activity.slice(0, 10).map((entry, index) => (
                <li key={`${entry.at}-${index}`} className={entry.ok ? "text-ink" : "text-danger"}>
                  <span className="text-ink-secondary">{when(entry.at)}</span> {activityLine(entry)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
