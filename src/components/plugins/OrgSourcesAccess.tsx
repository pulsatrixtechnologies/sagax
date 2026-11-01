// Connect apps > Sources > Organization sources and access (an organization
// admin only; it moved between Connect apps and Settings, and since
// 2026-10-27 it is the admin part of Sources; Settings > Organization keeps
// one link): "Allowed marketplaces". Since 2026-10-28 (owner: one option,
// one place) the organization's GitHub access tokens are in the one
// credential list of the GitHub plugin's page (marked Organization), and the GitHub
// OAuth App's client id, a server setting, is in Settings > Organization
// (OrgGithubApp).
//
// The block saves through PATCH /api/org/settings and shows its result
// beside its button. The answer carries the organization's settings, so the
// field follows what the server kept.
//
// Capabilities lot 4: on a server whose Perspicax owns the organization's
// marketplace rule (`settings.pluginMarketplacesOwner === "perspicax"`), this
// block reads and writes Perspicax's allowed marketplaces and policy through
// this server's link (PerspicaxSources), never a second local copy. Opening
// it first moves the historical local list into Perspicax, once.
import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";

import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { loadPerspicaxOrg, type PerspicaxOrg } from "@/lib/perspicax-org";
import { loadInventory, migrateMarketplaces, removeMarketplace, saveMarketplace, setMarketplacePolicy, type OrgInventory } from "@/lib/org-capabilities";
import { api } from "@/state/store";
import { validateMarketplace, type MarketplaceMode } from "../../../shared/org-capability-form";
import { Switch } from "../SettingsPrimitives";

type Settings = PerspicaxOrg["settings"];
type Policy = NonNullable<Settings["pluginMarketplaces"]>;
type Block = "marketplaces";
type Status = { block: Block; kind: "saved" | "error"; text: string } | null;
type Save = (block: Block, body: Record<string, unknown>) => Promise<boolean>;

const fieldClass = "w-full rounded-lg border border-border bg-raised px-3 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink-secondary focus:border-accent";

function policyList(policy: Policy): string {
  return policy.mode === "list" ? policy.allow.join("\n") : "";
}

/** The marketplace list an admin typed: one per line or comma separated. */
export function marketplacePolicyBody(mode: Policy["mode"], list: string): Policy {
  return mode === "any" ? { mode: "any" } : { mode: "list", allow: list.split(/[\n,]+/).map((entry) => entry.trim()).filter(Boolean) };
}

function StatusLine({ status, block }: { status: Status; block: Block }) {
  if (!status || status.block !== block) return null;
  return status.kind === "saved"
    ? <p role="status" data-org-access-saved={block} className="text-[12px] text-ink-secondary">{status.text}</p>
    : <p role="alert" data-org-access-error={block} className="text-[12px] text-danger">{status.text}</p>;
}

/** Perspicax owns the rule: its allowed marketplaces and its policy, read
 * and written through this server's link with the admin's sign-in. */
export function PerspicaxSources() {
  const [inventory, setInventory] = useState<OrgInventory | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [fieldErrors, setFieldErrors] = useState<ReturnType<typeof validateMarketplace>>({});
  const reload = useCallback(async () => setInventory(await loadInventory()), []);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await work();
      await reload();
      setSaved(true);
    } catch (failure) {
      setError(readableError(failure));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const first = await loadInventory();
        // the historical local list moves to Perspicax once, then Perspicax
        // is the only place it is kept
        if (first.owner === "perspicax" && !first.migrated) await migrateMarketplaces();
        const answer = first.owner === "perspicax" && !first.migrated ? await loadInventory() : first;
        if (alive) setInventory(answer);
      } catch (failure) {
        if (alive) setError(readableError(failure));
      }
    })();
    return () => { alive = false; };
  }, []);
  const mode: MarketplaceMode | null = inventory?.marketplace_policy?.mode ?? null;
  const add = () => {
    const found = validateMarketplace({ name, source, enabled: true });
    setFieldErrors(found);
    if (found.name || found.source) return;
    void run(async () => {
      await saveMarketplace({ name: name.trim(), source: source.trim(), enabled: true });
      setName("");
      setSource("");
    });
  };
  return (
    <div className="flex flex-col gap-1.5" data-org-access="marketplaces" data-org-access-owner="perspicax">
      <span className="font-medium text-ink">{t("organization.plugins.marketplaces")}</span>
      <p className="text-[12px] leading-relaxed text-ink-secondary">{t("orgCapabilities.sources.owner")}</p>
      <label className="flex items-center gap-2 text-[12.5px]">
        <input type="radio" name="org-marketplaces" checked={mode === "any"} disabled={busy || !inventory} onChange={() => void run(() => setMarketplacePolicy("any"))} />
        {t("organization.plugins.any")}
      </label>
      <label className="flex items-center gap-2 text-[12.5px]">
        <input type="radio" name="org-marketplaces" checked={mode === "list"} disabled={busy || !inventory} onChange={() => void run(() => setMarketplacePolicy("list"))} />
        {t("organization.plugins.list")}
      </label>
      {inventory && mode === null && <p className="text-[12px] text-ink-secondary">{t("orgCapabilities.sources.noPolicy")}</p>}
      <ul className="divide-y divide-hairline/60 rounded-xl border border-border" data-org-marketplaces="">
        {(inventory?.marketplaces ?? []).map((market) => (
          <li key={market.id} className="flex items-center gap-2 px-3 py-1.5 text-[12.5px]">
            <span className="min-w-0 flex-1">
              <span className="block text-ink">{market.name}</span>
              <span className="block break-all font-mono text-[11.5px] text-ink-secondary">{market.source}</span>
            </span>
            <Switch checked={market.enabled} disabled={busy} aria-label={t("orgCapabilities.sources.enabledAria", { name: market.name })}
              onClick={() => void run(() => saveMarketplace({ name: market.name, source: market.source, enabled: !market.enabled }, market.id))} />
            <button type="button" className="ui-icon-button" disabled={busy} aria-label={t("orgCapabilities.sources.removeAria", { name: market.name })}
              onClick={() => void run(() => removeMarketplace(market.id))}><Trash2 size={13} aria-hidden="true" /></button>
          </li>
        ))}
        {inventory && (inventory.marketplaces ?? []).length === 0 && <li className="px-3 py-1.5 text-[12px] text-ink-secondary">{t("orgCapabilities.sources.empty")}</li>}
      </ul>
      <div className="mt-1 grid gap-1.5 sm:grid-cols-[1fr_2fr_auto]" data-org-marketplace-add="">
        <input aria-label={t("orgCapabilities.sources.name")} placeholder={t("orgCapabilities.sources.name")} value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} />
        <input aria-label={t("orgCapabilities.sources.source")} placeholder="example-org/marketplace" value={source} onChange={(event) => setSource(event.target.value)} className={`${fieldClass} font-mono`} />
        <button type="button" className="ui-button" disabled={busy} onClick={add}>{t("orgCapabilities.sources.add")}</button>
      </div>
      {(fieldErrors.name || fieldErrors.source) && <p role="alert" className="text-[12px] text-danger">{t((fieldErrors.source ?? fieldErrors.name)!.key as never)}</p>}
      <p className="text-[12px] leading-relaxed text-ink-secondary">{t("organization.plugins.hint")}</p>
      {saved && <p role="status" data-org-access-saved="marketplaces" className="text-[12px] text-ink-secondary">{t("organization.plugins.saved")}</p>}
      {error && <p role="alert" data-org-access-error="marketplaces" className="text-[12px] text-danger">{error}</p>}
    </div>
  );
}

export function OrgSourcesAccess({ initial, flat = false }: { initial: Settings; /** inside a Settings group that carries the title */ flat?: boolean }) {
  const [settings, setSettings] = useState<Settings>(initial);
  const marketplaces: Policy = settings.pluginMarketplaces ?? { mode: "any" };
  const [mode, setMode] = useState<Policy["mode"]>(marketplaces.mode);
  const [list, setList] = useState(policyList(marketplaces));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  // The settings as the server has them now (another admin, or another
  // window, may have changed them since the organization was first read).
  useEffect(() => {
    let alive = true;
    void loadPerspicaxOrg(true).then((org) => {
      if (!alive || !org) return;
      setSettings(org.settings);
      const policy = org.settings.pluginMarketplaces ?? { mode: "any" as const };
      setMode(policy.mode);
      setList(policyList(policy));
    });
    return () => { alive = false; };
  }, []);

  const save: Save = async (block, body) => {
    setBusy(true);
    setStatus(null);
    try {
      const answer = await api<{ settings?: Settings }>("/api/org/settings", { method: "PATCH", body: JSON.stringify(body) });
      if (answer?.settings) setSettings(answer.settings);
      void loadPerspicaxOrg(true);
      setStatus({ block, kind: "saved", text: t("organization.plugins.saved") });
      return true;
    } catch (failure) {
      setStatus({ block, kind: "error", text: readableError(failure) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={flat ? undefined : "mt-6"} data-plugins-org-access data-org-plugin-policy={mode}>
      {!flat && <h3 className="mb-1 text-[13px] font-semibold text-ink">{t("connectApps.orgAccess.title")}</h3>}
      <p className="mb-3 text-[12px] leading-relaxed text-ink-secondary">{t("sources.orgAccess.intro")}</p>
      <div className="flex flex-col gap-5 text-[13px]">
        {settings.pluginMarketplacesOwner === "perspicax" ? <PerspicaxSources /> : (
        <div className="flex flex-col gap-1.5" data-org-access="marketplaces">
          <span className="font-medium text-ink">{t("organization.plugins.marketplaces")}</span>
          <label className="flex items-center gap-2 text-[12.5px]">
            <input type="radio" name="org-marketplaces" checked={mode === "any"} onChange={() => setMode("any")} />
            {t("organization.plugins.any")}
          </label>
          <label className="flex items-center gap-2 text-[12.5px]">
            <input type="radio" name="org-marketplaces" checked={mode === "list"} onChange={() => setMode("list")} />
            {t("organization.plugins.list")}
          </label>
          {mode === "list" && (
            <textarea value={list} onChange={(event) => setList(event.target.value)} rows={3} placeholder={"pulsatrixtechnologies/marketplace\nexample-org/*"}
              aria-label={t("organization.plugins.list")}
              className={`${fieldClass} font-mono`} />
          )}
          <p className="text-[12px] leading-relaxed text-ink-secondary">{t("organization.plugins.hint")}</p>
          <div>
            <button type="button" className="ui-button" disabled={busy || (mode === "list" && !list.trim())}
              onClick={() => void save("marketplaces", { pluginMarketplaces: marketplacePolicyBody(mode, list) })}>{t("organization.plugins.save")}</button>
          </div>
          <StatusLine status={status} block="marketplaces" />
        </div>
        )}
      </div>
    </section>
  );
}

