// Settings > Organization: admin kill switch for the per-person Grok bridge
// bridge (#2193). Off disables delivery both ways without clearing keys.
import { useState } from "react";

import { t } from "@/lib/i18n";
import { loadPerspicaxOrg } from "@/lib/perspicax-org";
import { api } from "@/state/store";
import { DescribedRow, SettingsGroup, Switch } from "../SettingsPrimitives";
import { readableError } from "@/lib/plain-error";

export function saveOrgGrokBridge(allowed: boolean): Promise<{ settings: { allowGrokBridge?: boolean } }> {
  return api("/api/org/settings", { method: "PATCH", body: JSON.stringify({ allowGrokBridge: allowed }) });
}

export function OrgGrokBridgePolicy({ initial, onChanged }: { initial: boolean; onChanged?: () => void | Promise<void> }) {
  const [allowed, setAllowed] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    const next = !allowed;
    setBusy(true);
    setError(null);
    try {
      const saved = await saveOrgGrokBridge(next);
      setAllowed(saved.settings.allowGrokBridge !== false);
      await loadPerspicaxOrg(true);
      await onChanged?.();
    } catch (failure) {
      setError(t("organization.fullAccess.failed", { error: readableError(failure) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-settings-card="organization.grokBridge" data-org-grok-bridge={allowed ? "on" : "off"}>
      {/* A shared row in a card, under its grey heading (JC 2026-11-07). */}
      <SettingsGroup groupId="organizationGrokBridge" title={t("organization.grokBridge.title")}>
        <DescribedRow
          label={t("organization.grokBridge.label")}
          rowId="grokBridge"
          description={error ? <span role="alert" className="text-danger">{error}</span> : t("organization.grokBridge.short")}
        >
          <Switch checked={allowed} disabled={busy} aria-label={t("organization.grokBridge.label")} onClick={() => void toggle()} />
        </DescribedRow>
      </SettingsGroup>
    </div>
  );
}
