import { useState, type FormEvent, type ReactNode } from "react";
import { copyText } from "@/lib/copy-text";
import type { OrgRole } from "../../server/org-directory.ts";
import { t } from "@/lib/i18n";
import { Card, CountPill, DANGER_PILL, DescribedRow, PILL, SettingsGroup, cardCount } from "./SettingsPrimitives";
import { OrgCreateForm, orgHostFromInput } from "./OrgCreateForm";
import { personLabel as humanPersonLabel } from "@/lib/human-label";

export type OrgPersonView = { id: string; role: OrgRole; email?: string };
export type PendingInviteView = { email: string; token?: string; link?: string; expiresAt?: number };

const inputClass = "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink outline-none focus:border-accent/50";

/** A person by email; a principal without one reads as an unknown person
 * (never its id). */
export function personLabel(person: OrgPersonView): string {
  return humanPersonLabel(person.email, person.id);
}

function roleLabel(role: OrgRole): string {
  return t(role === "owner" ? "org.role.owner" : role === "admin" ? "org.role.admin" : "org.role.member");
}

function CopyLinkButton({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={PILL}
      onClick={() => {
        void copyText(link).then((result) => setCopied(result === "copied"));
      }}
    >
      {copied ? t("org.copied") : t("org.copyLink")}
    </button>
  );
}

export function OrgDirectory({
  org,
  people,
  pendingInvites = [],
  initialAddress = "",
  canManage = true,
  invitesOff = false,
  lastInvite = null,
  onCreate,
  onInvite,
  onRevoke,
  onUpdateHost,
  domainSettings = null,
}: {
  org: { name: string; host?: { kind: "this-computer" } | { kind: "server"; url: string } } | null;
  people: OrgPersonView[];
  pendingInvites?: PendingInviteView[];
  initialAddress?: string;
  /** Owners and admins invite, revoke and edit the address, and see the
   * people list; a member sees only the organization's name, address and
   * status. */
  canManage?: boolean;
  /** An organization server that signs people in with Pulsatrix: accounts
   * are created in Perspicax, so no invitation is shown or offered. */
  invitesOff?: boolean;
  /** The invite just issued, so its link can be copied at once. */
  lastInvite?: { email: string; link?: string } | null;
  onCreate: (name: string, host: { kind: "server"; url: string }) => void;
  onInvite: (email: string) => void | Promise<void>;
  onRevoke?: (token: string) => void | Promise<void>;
  onUpdateHost?: (host: { kind: "server"; url: string }) => void | Promise<void>;
  /** The server's custom-domain card, shown under the address for owners
   * and admins only. */
  domainSettings?: ReactNode;
}) {
  const [email, setEmail] = useState("");
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState("");
  const [showPeople, setShowPeople] = useState(false);
  const [showPending, setShowPending] = useState(false);

  if (!org) {
    return (
      <Card collapsible cardId="organization.createForm" title={t("org.createCard")} summary={t("settings.card.optional")}>
        <OrgCreateForm initialAddress={initialAddress} onCreate={onCreate} />
      </Card>
    );
  }

  const currentAddress = org.host?.kind === "server" ? org.host.url : "";
  const nextHost = orgHostFromInput(address);

  // 0.5.6 (JC): Grok Bot's rows under a People heading. The server's address
  // (when it has one) with Edit, Invite with its field at the right, then
  // the people and the pending invitations folded behind a count. A solo
  // server's own invitations carry no organization name worth a row (it was
  // this computer's host name), so none is drawn.
  return (
    <>
      <SettingsGroup title={t("org.people")} groupId="people">
        {org.host && (
          <div data-settings-card="organization.directory">
            <DescribedRow
              label={t("org.serverAddress")}
              rowId="serverAddress"
              description={<span className="break-all">{currentAddress || "-"}</span>}
              below={editing && (
                <form
                  className="mt-2 flex flex-col gap-2"
                  onSubmit={async (event: FormEvent) => {
                    event.preventDefault();
                    if (!nextHost || !onUpdateHost) return;
                    try {
                      await onUpdateHost(nextHost);
                      setEditing(false);
                    } catch {
                      // The parent shows the error; keep the draft so it can be corrected.
                    }
                  }}
                >
                  <input
                    name="org-server-address-edit"
                    aria-label={t("org.serverAddress")}
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                    placeholder="https://…"
                    autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false}
                    className={inputClass}
                  />
                  {address.trim() && !nextHost && <span className="text-[12px] text-ink-secondary">{t("org.addressInvalid")}</span>}
                  <div className="flex justify-end gap-2">
                    <button type="button" className={PILL} onClick={() => setEditing(false)}>{t("org.cancel")}</button>
                    <button type="submit" disabled={!nextHost} className="ui-button ui-button-primary min-h-[44px] disabled:opacity-50 md:min-h-0">{t("org.saveAddress")}</button>
                  </div>
                </form>
              )}
            >
              {canManage && onUpdateHost && !editing && (
                <button type="button" className={PILL} onClick={() => { setAddress(currentAddress); setEditing(true); }}>
                  {t("org.editAddress")}
                </button>
              )}
            </DescribedRow>
          </div>
        )}
        {canManage && !invitesOff && (
          <div data-settings-card="organization.invite">
            <DescribedRow
              label={t("org.inviteTitle")}
              rowId="invite"
              below={lastInvite?.link && (
                <div role="status" className="mt-2 rounded-lg bg-inset px-3 py-2">
                  <p className="text-[12px] text-ink">{t("org.inviteLinkReady", { email: lastInvite.email })}</p>
                  <div className="mt-1.5 flex min-w-0 items-center gap-2">
                    <code dir="ltr" className="min-w-0 flex-1 select-all break-all text-[12px] text-ink-secondary">{lastInvite.link}</code>
                    <CopyLinkButton link={lastInvite.link} />
                  </div>
                </div>
              )}
            >
              <form
                className="flex min-w-0 flex-wrap items-center justify-end gap-2"
                onSubmit={async (event: FormEvent) => {
                  event.preventDefault();
                  const value = email.trim();
                  if (!value) return;
                  try {
                    await onInvite(value);
                    setEmail("");
                  } catch {
                    // Keep the address so a refused invite can be corrected.
                  }
                }}
              >
                <input
                  type="email"
                  aria-label={t("org.inviteEmail")}
                  placeholder={t("org.inviteEmail")}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="h-7 min-h-[44px] w-52 min-w-0 rounded-lg border-[0.5px] border-border bg-inset px-2.5 text-[13px] text-ink outline-none placeholder:text-ink-secondary focus:border-focus md:min-h-0"
                />
                <button type="submit" className={PILL}>{t("org.invite")}</button>
              </form>
            </DescribedRow>
          </div>
        )}
        {(canManage || invitesOff) && (
          <div data-settings-card="organization.people">
            <DescribedRow
              label={t("org.people")}
              rowId="people"
              description={invitesOff ? t("org.managedInPerspicax") : undefined}
              below={canManage && (
                <ul hidden={!showPeople} className="mt-2 flex flex-col gap-0.5" aria-label={t("org.people")}>
                  {people.map((person) => (
                    <li key={person.id} className="flex min-w-0 items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-[13px] hover:bg-hover">
                      <span className="min-w-0 break-all text-ink">{personLabel(person)}</span>
                      <span className="shrink-0 text-[12px] text-ink-secondary">{roleLabel(person.role)}</span>
                    </li>
                  ))}
                </ul>
              )}
            >
              {canManage && <CountPill count={people.length} open={showPeople} label={cardCount("people", people.length)} onToggle={() => setShowPeople((open) => !open)} />}
            </DescribedRow>
          </div>
        )}
        {canManage && !invitesOff && pendingInvites.length > 0 && (
          <div data-settings-card="organization.pending">
            <DescribedRow
              label={t("org.pendingInvites")}
              rowId="pending"
              description={t("org.pendingHint")}
              below={(
                <ul hidden={!showPending} className="mt-2 flex flex-col gap-0.5" aria-label={t("org.pendingInvites")}>
                  {pendingInvites.map((invite) => (
                    <li key={invite.token ?? invite.email} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[13px]">
                      <span className="min-w-0 break-all text-ink">{invite.email}</span>
                      {(invite.link || (invite.token && onRevoke)) && (
                        <span className="flex gap-2">
                          {invite.link && <CopyLinkButton link={invite.link} />}
                          {invite.token && onRevoke && (
                            <button
                              type="button"
                              className={`${DANGER_PILL} min-h-[44px] md:min-h-0`}
                              onClick={() => {
                                if (!confirmRevoke(invite.email)) return;
                                void onRevoke(invite.token!);
                              }}
                            >
                              {t("org.revoke")}
                            </button>
                          )}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            >
              <CountPill count={pendingInvites.length} open={showPending} label={t("settings.card.pending", { count: pendingInvites.length })} onToggle={() => setShowPending((open) => !open)} />
            </DescribedRow>
          </div>
        )}
      </SettingsGroup>
      {canManage && domainSettings}
    </>
  );
}

/** Revoking an invitation asks first: its link stops working at once. */
function confirmRevoke(email: string): boolean {
  try {
    return typeof window === "undefined" || typeof window.confirm !== "function" ? true : window.confirm(t("org.revokeConfirm", { email }));
  } catch {
    return true;
  }
}
