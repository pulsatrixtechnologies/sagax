// #2080 (L3): Organization rules as read-only rows for everyone: the label
// and the current value in grey at the right. Values come from org.settings (already
// loaded). No shortcut to Perspicax (owner, 2026-11-05: it only took space).
import { useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import type { PerspicaxOrg } from "@/lib/perspicax-org";
import { api } from "@/state/store";
import { CompactRow, SettingsGroup } from "../SettingsPrimitives";

/** Read-only organization rules: confidential threads, vault export, team
 * secrets, sources, published pages. Same rows for admin and member. */
export function OrgRulesReadOnly({ org }: { org: PerspicaxOrg }) {
  const confidential = org.settings.confidentialThreadsByDefault === true;
  const vaultAllowed = org.settings.allowVaultExport !== false;
  const github = org.settings.github;
  const sourcesLinked = Boolean(github?.clientId);
  const [secretCount, setSecretCount] = useState<number | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    void api<{ secrets?: unknown[] }>("/api/org/bot-secrets")
      .then((body) => { if (live) setSecretCount(Array.isArray(body.secrets) ? body.secrets.length : 0); })
      .catch(() => { if (live) setSecretCount(null); });
    void api<{ pages?: Array<{ status?: string }> }>("/api/admin/pages")
      .then((body) => {
        if (!live) return;
        const livePages = (body.pages ?? []).filter((page) => page.status === "published");
        setPageCount(livePages.length);
      })
      .catch(() => { if (live) setPageCount(null); });
    return () => { live = false; };
  }, []);

  return (
    <SettingsGroup title={t("organization.rules.title")} groupId="organizationRules">
      <OrgRuleRow
        label={t("organization.rules.confidential")}
        value={confidential ? t("organization.rules.confidential.on") : t("organization.rules.confidential.off")}
        rowId="confidentialDefault"
      />
      <OrgRuleRow
        label={t("organization.rules.vaultExport")}
        value={vaultAllowed ? t("organization.rules.vaultExport.allowed") : t("organization.rules.vaultExport.blocked")}
        rowId="vaultExport"
      />
      <OrgRuleRow
        label={t("organization.rules.teamSecrets")}
        value={secretCount === null ? null : t("organization.rules.teamSecrets.count", { count: secretCount })}
        rowId="teamSecrets"
      />
      <OrgRuleRow
        label={t("organization.rules.sources")}
        value={sourcesLinked ? t("organization.rules.sources.linked") : t("organization.rules.sources.none")}
        rowId="orgSources"
      />
      <OrgRuleRow
        label={t("organization.rules.pages")}
        value={pageCount === null ? null : t("organization.rules.pages.count", { count: pageCount })}
        rowId="orgPages"
      />
    </SettingsGroup>
  );
}

// One line per rule, the value at the right. A count the server does not
// give this person draws no row rather than repeat its label.
function OrgRuleRow({ label, value, rowId }: { label: string; value: React.ReactNode; rowId: string }) {
  if (value === null) return null;
  return <CompactRow label={label} rowId={rowId}><span className="text-[13px] leading-[18px] text-ink-secondary">{value}</span></CompactRow>;
}
