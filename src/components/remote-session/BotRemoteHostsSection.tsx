// Computer tab: enrolled hosts attached to this bot (2026-11-01). The person
// adds endpoints so the bot has access by default; list and revoke live here.
// History and filters stay behind progressive disclosure. Temporary/ended
// sessions never appear as active places.
import { useCallback, useEffect, useState } from "react";
import { Monitor, Plus, ShieldOff } from "lucide-react";

import type { UnattendedHostRow } from "../../../shared/remote-unattended-host";
import { canRevokeUnattendedHost } from "../../../shared/remote-unattended-host";
import { GROUPED_CARD, GROUPED_ROW } from "@/lib/grouped-card";
import { t } from "@/lib/i18n";
import { unattendedHostLabel } from "./UnattendedHostsSection";
import {
  attachBotRemoteHost,
  detachBotRemoteHost,
  fetchBotRemoteHosts,
  openBotRemoteHost,
} from "./bot-remote-hosts-client";
import { revokeUnattendedHost } from "./use-remote-sessions-admin";

export function BotRemoteHostsSection({ botId, onChanged }: { botId: string; onChanged?: () => void }) {
  const [catalog, setCatalog] = useState<UnattendedHostRow[]>([]);
  const [attached, setAttached] = useState<UnattendedHostRow[]>([]);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    let stop = false;
    setLoading(true);
    fetchBotRemoteHosts(botId)
      .then((body) => {
        if (stop) return;
        setAvailable(body.available);
        setCatalog(body.catalog);
        setAttached(body.hosts);
        setLoading(false);
      })
      .catch(() => { if (!stop) setLoading(false); });
    return () => { stop = true; };
  }, [botId]);

  useEffect(() => reload(), [reload]);

  const addable = catalog.filter((row) => row.state === "enrolled" && !attached.some((a) => a.hostId === row.hostId));

  const attach = async (row: UnattendedHostRow) => {
    setBusy(row.hostId);
    setError(null);
    const out = await attachBotRemoteHost(botId, row.hostId);
    setBusy(null);
    if (!out.ok) { setError(out.error); return; }
    reload();
    onChanged?.();
  };

  const detach = async (row: UnattendedHostRow) => {
    setBusy(row.hostId);
    setError(null);
    const out = await detachBotRemoteHost(botId, row.hostId);
    setBusy(null);
    if (!out.ok) { setError(out.error); return; }
    reload();
    onChanged?.();
  };

  const revoke = async (row: UnattendedHostRow) => {
    setBusy(row.hostId);
    setError(null);
    const out = await revokeUnattendedHost(row.hostId);
    setBusy(null);
    if (!out.ok) { setError(out.error); return; }
    await detachBotRemoteHost(botId, row.hostId);
    reload();
    onChanged?.();
  };

  const openHost = async (row: UnattendedHostRow) => {
    setBusy(row.hostId);
    setError(null);
    const out = await openBotRemoteHost(botId, row.hostId);
    setBusy(null);
    if (!out.ok) { setError(out.error); return; }
    onChanged?.();
  };

  if (!loading && !available && attached.length === 0 && catalog.length === 0) {
    return null;
  }

  return (
    <section data-bot-remote-hosts="" className="mt-4 flex flex-col gap-2">
      <button
        type="button"
        data-bot-remote-hosts-toggle=""
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 self-start text-[12.5px] text-ink-secondary hover:text-ink"
      >
        <Monitor size={14} aria-hidden="true" />
        <span className="font-medium">{t("botRemoteHosts.title")}</span>
        <span className="tabular-nums">({attached.length})</span>
      </button>
      {open && (
        <div className="flex flex-col gap-2">
          <p className="text-[12px] text-ink-secondary">{t("botRemoteHosts.hint")}</p>
          {attached.length === 0 && (
            <p data-bot-remote-hosts-empty="" className="text-[13px] text-ink-secondary">
              {loading ? t("botRemoteHosts.loading") : t("botRemoteHosts.empty")}
            </p>
          )}
          {attached.length > 0 && (
            <div className={GROUPED_CARD} data-bot-remote-hosts-list="">
              {attached.map((row) => {
                const label = unattendedHostLabel(row);
                const working = busy === row.hostId;
                return (
                  <div key={row.hostId} data-bot-remote-host="" data-state={row.state} className={`flex flex-col gap-2 ${GROUPED_ROW}`}>
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-ink">{label}</span>
                        <span className="text-[12px] text-ink-secondary">{t(`remoteSessionsAdmin.hosts.state.${row.state}`)}</span>
                      </div>
                      {row.state === "enrolled" && (
                        <button type="button" data-bot-remote-host-open="" disabled={working} onClick={() => void openHost(row)} className="rounded-lg border border-hairline/50 px-2 py-1 text-[12px] text-ink hover:bg-raised disabled:opacity-50">
                          {t("botRemoteHosts.open")}
                        </button>
                      )}
                      <button type="button" data-bot-remote-host-detach="" disabled={working} onClick={() => void detach(row)} className="rounded-lg border border-hairline/50 px-2 py-1 text-[12px] text-ink-secondary hover:bg-raised disabled:opacity-50">
                        {t("botRemoteHosts.detach")}
                      </button>
                      {canRevokeUnattendedHost(row) && (
                        <button type="button" data-bot-remote-host-revoke="" disabled={working} onClick={() => void revoke(row)} className="inline-flex items-center gap-1 rounded-lg border border-danger/50 px-2 py-1 text-[12px] text-danger hover:bg-raised disabled:opacity-50">
                          <ShieldOff size={12} /> {t("botRemoteHosts.revoke")}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {addable.length > 0 && (
            <div className="flex flex-col gap-1.5" data-bot-remote-hosts-add="">
              <span className="text-[12px] text-ink-secondary">{t("botRemoteHosts.add")}</span>
              {addable.map((row) => (
                <button
                  key={row.hostId}
                  type="button"
                  data-bot-remote-host-attach=""
                  disabled={busy === row.hostId}
                  onClick={() => void attach(row)}
                  className="inline-flex items-center gap-1.5 self-start rounded-lg border border-hairline/50 px-2.5 py-1 text-[12.5px] text-ink hover:bg-raised disabled:opacity-50"
                >
                  <Plus size={12} /> {unattendedHostLabel(row)}
                </button>
              ))}
            </div>
          )}
          {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
        </div>
      )}
    </section>
  );
}
