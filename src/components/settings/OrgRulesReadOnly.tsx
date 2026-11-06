// #2080 (L3): Organization rules as read-only OrgManagedRows for everyone.
// Values come from org.settings (already loaded). Edits live in Perspicax.
import { useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import type { PerspicaxOrg } from "@/lib/perspicax-org";
import { api } from "@/state/store";
import { OrgManagedRow, SettingsGroup } from "../SettingsPrimitives";

const consoleUrl = (issuer: string) => `${issuer.replace(/\/+$/, "")}/console/`;

/** Read-only organization rules: confidential threads, vault export, team
 * secrets, sources, published pages. Same rows for admin and member. */
export function OrgRulesReadOnly({ org }: { org: PerspicaxOrg }) {
  const href = consoleUrl(org.org.identity.issuer);
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
      <OrgManagedRow
        label={t("organization.rules.confidential")}
        value={confidential ? t("organization.rules.confidential.on") : t("organization.rules.confidential.off")}
        href={`${href}settings`}
        rowId="confidentialDefault"
      />
      <OrgManagedRow
        label={t("organization.rules.vaultExport")}
        value={vaultAllowed ? t("organization.rules.vaultExport.allowed") : t("organization.rules.vaultExport.blocked")}
        href={`${href}settings`}
        rowId="vaultExport"
      />
      <OrgManagedRow
        label={t("organization.rules.teamSecrets")}
        value={secretCount === null ? t("organization.rules.teamSecrets.unknown") : t("organization.rules.teamSecrets.count", { count: secretCount })}
        href={`${href}secrets`}
        rowId="teamSecrets"
      />
      <OrgManagedRow
        label={t("organization.rules.sources")}
        value={sourcesLinked ? t("organization.rules.sources.linked") : t("organization.rules.sources.none")}
        href={`${href}sources`}
        rowId="orgSources"
      />
      <OrgManagedRow
        label={t("organization.rules.pages")}
        value={pageCount === null ? t("organization.rules.pages.unknown") : t("organization.rules.pages.count", { count: pageCount })}
        href={`${href}pages`}
        rowId="orgPages"
      />
    </SettingsGroup>
  );
}
