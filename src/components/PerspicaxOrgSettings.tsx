// Settings > Organization on a server signed in with Perspicax (#2080 L3):
// the same page for everyone. OrgBand + OrgManagedRows; edits live in
// Perspicax. Approvals are a count row with a Perspicax link (the allow/deny
// file left Settings). Interim people stay when the window still has some.
import { useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import type { PerspicaxOrg } from "@/lib/perspicax-org";
import { setOrgApprovalsCount, useOrgApprovalsVersion } from "@/lib/org-approvals";
import { api } from "@/state/store";
import { DescribedRow, ExternalLinkPill, OrgBand, OrgManagedRow, SettingsGroup } from "./SettingsPrimitives";
import { InterimPeople } from "./settings/InterimPeople";
import { OrgRulesReadOnly } from "./settings/OrgRulesReadOnly";
import { OrganizationBotRows } from "./settings/OrganizationBotRules";

interface PendingAdminApproval {
  botId: string;
  botName: string;
  threadId: string;
  requestId: string;
  ownerName?: string;
  requestedBy?: string;
  tool?: string;
  summary?: string;
  at: number;
}

/** Whose request it is: the person whose turn asked, else the bot's owner. */
export function approvalWho(approval: Pick<PendingAdminApproval, "botName" | "ownerName" | "requestedBy">): string {
  if (approval.requestedBy) return t("organization.adminApprovals.requestedBy", { bot: approval.botName, person: approval.requestedBy });
  if (approval.ownerName) return t("organization.adminApprovals.ownedBy", { bot: approval.botName, person: approval.ownerName });
  return approval.botName;
}

/** `<issuer>/console/`, the Perspicax console. */
export function perspicaxConsoleUrl(issuer: string): string {
  return `${issuer.replace(/\/+$/, "")}/console/`;
}

export function linkStateLine(link: PerspicaxOrg["link"]): string {
  if (link.state === "ok") return t("organization.link.ok");
  if (link.state === "missing") return t("organization.link.missing");
  return t("organization.link.error", { error: link.error ?? "error" });
}

/** Whether the "People from before Perspicax" card shows: while the window
 * is open and someone is left, and also once the last one is attached in
 * this view, so the person still sees the "Attached to" notice. */
export function showInterimCard(interim: PerspicaxOrg["settings"]["interimAttach"], shownBefore: boolean): boolean {
  return Boolean(interim?.until) && ((interim?.people ?? 0) > 0 || shownBefore);
}

export function PerspicaxOrgSettings({ org, onChanged }: {
  org: PerspicaxOrg;
  onChanged: () => void | Promise<void>;
}) {
  const admin = org.viewerRole === "admin";
  const [approvals, setApprovals] = useState<PendingAdminApproval[] | null>(null);
  const interim = org.settings.interimAttach;
  const [interimShown, setInterimShown] = useState(false);
  const interimVisible = showInterimCard(interim, interimShown);
  useEffect(() => { if (interimVisible) setInterimShown(true); }, [interimVisible]);

  const approvalsVersion = useOrgApprovalsVersion();
  const loadApprovals = async () => {
    // The route answers admins only; members keep a zero count.
    if (!admin) {
      setApprovals([]);
      return;
    }
    try {
      const list = (await api<{ approvals: PendingAdminApproval[] }>("/api/org/approvals")).approvals ?? [];
      setApprovals(list);
      setOrgApprovalsCount(list.length);
    } catch {
      setApprovals([]);
    }
  };
  useEffect(() => { void loadApprovals(); }, [admin, approvalsVersion]);

  const linked = org.link.state === "ok";
  const role = admin ? t("organization.role.adminShort") : t("organization.role.memberShort");
  const waiting = (approvals ?? []).length;
  const consoleHref = perspicaxConsoleUrl(org.org.identity.issuer);
  const bandRole = (
    <span role="status" className={linked ? undefined : "text-warning"}>
      {linked ? t("organization.link.okShort") : linkStateLine(org.link)} · {role}
    </span>
  );

  return (
    <>
      <OrgBand
        name={org.org.name}
        role={bandRole}
        sentence={t("organization.orgBand.sentence")}
        href={consoleHref}
      />
      <SettingsGroup groupId="organizationPeople">
        <div data-settings-card="organization.perspicax" data-perspicax-org>
          <OrgManagedRow
            label={t("organization.people")}
            value={t("organization.people.value")}
            href={`${consoleHref}people`}
            rowId="orgPeople"
          />
          {waiting > 0 && (
            <DescribedRow
              label={t("organization.approvals.waiting")}
              description={t("organization.approvals.count", { count: waiting })}
              rowId="adminApprovals"
            >
              <ExternalLinkPill href={`${consoleHref}approvals`}>{t("organization.approvals.see")}</ExternalLinkPill>
            </DescribedRow>
          )}
        </div>
        {interimVisible && interim?.until ? <InterimPeople until={interim.until} onChanged={onChanged} /> : null}
      </SettingsGroup>
      <OrgRulesReadOnly org={org} />
      <SettingsGroup advanced title={t("organization.group.botRules")} groupId="organizationBots">
        <OrganizationBotRows />
      </SettingsGroup>
    </>
  );
}
