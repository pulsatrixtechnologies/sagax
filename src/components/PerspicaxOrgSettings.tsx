// Settings > Organization on a server signed in with Perspicax (slice 3):
// the link line, the viewer's role, and one link to the Perspicax console.
// Below that card: interim people, sharing, full access and,
// for admins, the server commands waiting for an admin.
// Slice 4 adds Sharing in the organization (the bots whose sharing the
// viewer administers; an admin can force-stop or force-delete any of them).
// Since 2026-10-01 a person's own engine sign-in (My engines) lives in
// Settings > Model providers, and "Bring bots from a solo Sagax" is hidden
// (the desktop's join flow still copies bots through POST /api/org/import).
// An admin also allows or refuses Full access for every bot (2026-10-01,
// OrgFullAccessPolicy, server/org-full-access.ts).
// People, teams and invitations live in Perspicax, never here.
// 2026-10-15 (JC): Sharing in the organization (every bot of the
// organization with its owner) is hidden from the app, like Activity, Email,
// People and Installations (#518, #524): the app shows the person signed in,
// views of everyone belong to Sagax Business and the Perspicax console.
// OrgSharing and its server routes stay; an old link to the
// "organization.sharing" card opens this page. A bot's owner still shares it
// from the bot's own Shared with section.
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";

import { t } from "@/lib/i18n";
import type { PerspicaxOrg } from "@/lib/perspicax-org";
import { setOrgApprovalsCount, useOrgApprovalsVersion } from "@/lib/org-approvals";
import { api } from "@/state/store";
import { CountPill, DescribedRow, PILL, SettingsGroup } from "./SettingsPrimitives";
import { InterimPeople } from "./settings/InterimPeople";

import { OrgFullAccessPolicy } from "./settings/OrgFullAccessPolicy";
import { OrgMemberAutoApprovalPolicy } from "./settings/OrgMemberAutoApprovalPolicy";
import { OrgVaultExportPolicy } from "./settings/OrgVaultExportPolicy";
import { OrgMemberEnvironmentPolicy } from "./settings/OrgMemberEnvironmentPolicy";
import { OrgConfidentialThreadsDefault } from "./settings/OrgConfidentialThreadsDefault";
import { OrgTeamSecrets } from "./settings/OrgTeamSecrets";
import { OrgPhoneCalls } from "./settings/OrgPhoneCalls";

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
 * this view, so the admin still sees the "Attached to" notice. */
export function showInterimCard(admin: boolean, interim: PerspicaxOrg["settings"]["interimAttach"], shownBefore: boolean): boolean {
  return admin && Boolean(interim?.until) && ((interim?.people ?? 0) > 0 || shownBefore);
}

export function PerspicaxOrgSettings({ org, onChanged, botRows = null, after = null }: {
  org: PerspicaxOrg;
  onChanged: () => void | Promise<void>;
  /** More rows of the organization's bots group (routines, group turns, MCP calls). */
  botRows?: React.ReactNode;
  /** What follows the two groups (This computer). */
  after?: React.ReactNode;
}) {
  const admin = org.viewerRole === "admin";
  const [approvals, setApprovals] = useState<PendingAdminApproval[] | null>(null);
  const [answering, setAnswering] = useState<string | null>(null);
  const [showApprovals, setShowApprovals] = useState(false);
  const interim = org.settings.interimAttach;
  const [interimShown, setInterimShown] = useState(false);
  const interimVisible = showInterimCard(admin, interim, interimShown);
  useEffect(() => { if (interimVisible) setInterimShown(true); }, [interimVisible]);

  // reloads whenever the server says the waiting list changed (org.approvals)
  const approvalsVersion = useOrgApprovalsVersion();
  const loadApprovals = async () => {
    if (!admin) return;
    try {
      const list = (await api<{ approvals: PendingAdminApproval[] }>("/api/org/approvals")).approvals ?? [];
      setApprovals(list);
      setOrgApprovalsCount(list.length);
    } catch {
      setApprovals([]);
    }
  };
  useEffect(() => { void loadApprovals(); }, [admin, approvalsVersion]);

  const answer = async (approval: PendingAdminApproval, behavior: "allow" | "deny") => {
    setAnswering(approval.requestId);
    try {
      await api(`/api/threads/${approval.threadId}/respond`, {
        method: "POST",
        body: JSON.stringify({ requestId: approval.requestId, behavior, ...(behavior === "deny" ? { message: "Denied by an admin." } : {}) }),
      });
    } catch {
      /* the list below says what is still waiting */
    } finally {
      setAnswering(null);
      await loadApprovals();
    }
  };

  // 0.5.6 (JC): Grok Bot's layout. "Organization": its name, the link and
  // the viewer's role on one grey line, Manage in Perspicax as a pill; the
  // people from before Perspicax folded behind a count. "Organization's
  // bots": the commands waiting for an admin (folded, with a count), Full
  // access, and the rows the page adds (routines, group turns, MCP calls).
  const linked = org.link.state === "ok";
  const role = admin ? t("organization.role.adminShort") : t("organization.role.memberShort");
  const waiting = approvals ?? [];
  return (
    <>
      <SettingsGroup title={t("settings.section.organization")} groupId="organization">
        <div data-settings-card="organization.perspicax" data-perspicax-org>
          <DescribedRow
            label={org.org.name}
            rowId="perspicax"
            description={<span role="status" className={linked ? undefined : "text-warning"}>{linked ? t("organization.link.okShort") : linkStateLine(org.link)} · {role}</span>}
          >
            <a href={perspicaxConsoleUrl(org.org.identity.issuer)} target="_blank" rel="noreferrer noopener" className={`${PILL} inline-flex items-center gap-1.5`}>
              {t("organization.manageInPerspicax")}
              <ExternalLink size={12} aria-hidden="true" className="text-ink-secondary" />
            </a>
          </DescribedRow>
        </div>
        {interimVisible && interim?.until ? <InterimPeople until={interim.until} onChanged={onChanged} /> : null}
      </SettingsGroup>
      <SettingsGroup title={t("organization.group.bots")} groupId="organizationBots">
        {admin && (
          <div data-settings-card="organization.adminApprovals">
            <DescribedRow
              label={t("organization.adminApprovals.title")}
              rowId="adminApprovals"
              description={waiting.length ? approvalWho(waiting[0]!) : t("organization.adminApprovals.empty")}
              below={showApprovals && waiting.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1" aria-label={t("organization.adminApprovals.title")}>
                  {waiting.map((approval) => (
                    <li key={`${approval.threadId}:${approval.requestId}`} className="flex min-w-0 flex-col gap-1.5 rounded-lg bg-inset px-3 py-2">
                      <div className="flex min-w-0 items-baseline justify-between gap-2">
                        <span className="truncate text-[13px] text-ink">{approvalWho(approval)}</span>
                        {approval.tool && <span className="shrink-0 text-[12px] text-ink-secondary">{approval.tool}</span>}
                      </div>
                      {approval.summary && (
                        <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md bg-app/40 px-2.5 py-1.5 font-mono text-[12px] text-ink">{approval.summary}</pre>
                      )}
                      <div className="flex flex-wrap justify-end gap-2">
                        <button type="button" className={`${PILL} text-danger`} disabled={answering !== null} onClick={() => void answer(approval, "deny")}>
                          {t("organization.adminApprovals.deny")}
                        </button>
                        <button type="button" className={PILL} disabled={answering !== null} onClick={() => void answer(approval, "allow")}>
                          {t("organization.adminApprovals.allow")}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            >
              {waiting.length > 0 && (
                <CountPill count={waiting.length} open={showApprovals} label={t("organization.adminApprovals.title")} onToggle={() => setShowApprovals((value) => !value)} />
              )}
            </DescribedRow>
          </div>
        )}
        {admin && <OrgFullAccessPolicy initial={org.settings.allowFullAccess !== false} onChanged={onChanged} />}
        {admin && <OrgMemberEnvironmentPolicy initial={org.settings.memberEnvironmentAutonomy !== false} onChanged={onChanged} />}
        {admin && <OrgConfidentialThreadsDefault initial={org.settings.confidentialThreadsByDefault === true} onChanged={onChanged} />}
        {admin && <OrgMemberAutoApprovalPolicy initial={org.settings.memberAutoApproval !== false} onChanged={onChanged} />}
        {admin && <OrgVaultExportPolicy initial={org.settings.allowVaultExport !== false} onChanged={onChanged} />}
        {admin && <OrgTeamSecrets />}
        {admin && <OrgPhoneCalls />}
        {botRows}
      </SettingsGroup>
      {after}
    </>
  );
}
