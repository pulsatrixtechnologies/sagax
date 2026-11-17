// Settings > General > Account: the account row of the Account group
// (2026-10-15 one card; 0.5.6 the reference design's layout).
//
//   [avatar]  Name                           [Add account] [Sign out]
//             label (pencil on hover)
//             email [copy]
//             Managed by your organization · Edit in Perspicax
//   Team  <the organization signed in to; no row on a solo install>
//
// The reference's account card (#4457, the owner 2026-11-17): a 44px avatar,
// 14px gap, the page's 14px side padding, the page's plain pill buttons (30px).
//
// On an organization server (Pulsatrix Perspicax) the name and email are
// Perspicax's and read-only; the signed-in person changes their own photo
// from the avatar (OwnAvatarField: crop, then written to Perspicax as them,
// 2026-10-16); the server and the organization stay one
// hover away, on "Managed by your organization". On a personal server the
// operator edits name, email and photo here; the label stays; the action is
// Add account (the desktop server list) beside Sign out. Sign out is the
// desktop's server mode bridge (src/lib/launch.ts): it asks natively, signs
// out and returns to the launch screen, unchanged. No help paragraph: the
// native confirmation says what Sign out does.
import { useEffect, useRef, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { openExternalLink } from "@/lib/app-links";
import { useCopyFeedback } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { serverModeBridge } from "@/lib/launch";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { managedProfile } from "@/lib/profile-management";
import { useStore, type ConfigStatus } from "@/state/store";
import { InitialsAvatar } from "../Avatar";
import { useDesktopWorkspace } from "../DesktopWorkspaceSwitcher";
import type { ServerModeState } from "../ServerModeSettings";
import { profileInitials, profileLabel } from "../SidebarProfileMenu";
import { MyLabelField } from "./MyLabelField";
import { OwnAvatarField, OwnAvatarStatusLine, setOwnAvatarNotice, useOwnAvatarNotice } from "./OwnAvatarField";
import { AnchoredPopover, useAnchoredDismissRoot } from "@/components/AnchoredPopover";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";

export type LockedServer = Extract<ServerModeState, { active: true }>;

function host(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/** Where this account lives, for the tooltip of "Managed by your
 * organization": the server's address and the organization's name. */
export function accountServerDetails(input: { origin?: string | null; organization?: string | null }): string {
  const parts: string[] = [];
  if (input.origin) parts.push(t("settings.serverMode.connectedTo", { server: host(input.origin) }));
  const organization = input.organization?.trim();
  if (organization) parts.push(t("settings.serverMode.organization", { name: organization }));
  return parts.join(" · ");
}

export function AccountCard({ lockedServer }: { lockedServer: LockedServer | null }) {
  const { state } = useStore();
  const org = usePerspicaxOrg();
  const viewer = state.config?.viewer;
  const managed = managedProfile(viewer);
  const operator = !managed && !(viewer && !viewer.operator);
  const organization = (org?.org.name || lockedServer?.name || "").trim();
  const [signOutFailed, setSignOutFailed] = useState(false);
  const photoStatus = useOwnAvatarNotice();
  // 2026-10-16: on an organization server the signed-in person changes their
  // own photo here; it is written to Perspicax as them (OwnAvatarField).
  const ownPhotoPrincipal = managed && viewer && !viewer.operator ? viewer.principalId?.trim() || null : null;
  const workspace = useDesktopWorkspace();

  const action = lockedServer || workspace.available
    ? (
      <>
        {workspace.available && <AddAccountButton workspace={workspace} />}
        {lockedServer && <SignOutButton onFailed={setSignOutFailed} />}
      </>
    )
    : null;
  const details = accountServerDetails({ origin: lockedServer?.origin, organization });

  return (
    <div
      role="group"
      aria-label={t("settings.profile.title")}
      data-settings-card="general.account"
    >
      {operator
        ? <OperatorIdentity action={action} />
        : (
          <ReadOnlyIdentity
            name={managed?.name || viewer?.name || ""}
            email={managed?.email || viewer?.email || ""}
            avatarUrl={managed?.avatarUrl}
            action={action}
            avatar={ownPhotoPrincipal ? (
              <OwnAvatarField
                principalId={ownPhotoPrincipal}
                avatarUrl={managed?.avatarUrl}
                initials={profileInitials({ name: managed?.name || viewer?.name || "", email: managed?.email || viewer?.email || "" })}
                onStatus={setOwnAvatarNotice}
              />
            ) : undefined}
          >
            {managed ? (
              <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1 text-[12px] leading-4 text-ink-secondary">
                <span title={details || undefined} data-account-managed="">{t("settings.serverMode.managedShort")}</span>
                {managed.url && (
                  <>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      onClick={() => void openExternalLink(managed.url!)}
                      className="rounded-sm text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                    >
                      {t("settings.profile.editInPerspicax")}
                    </button>
                  </>
                )}
              </div>
            ) : lockedServer && lockedServer.origin ? (
              // the organization's name is the Team row's: the server's address only
              <div className="mt-0.5 truncate text-[12px] leading-4 text-ink-secondary" data-server-connected="">{t("settings.serverMode.connectedTo", { server: host(lockedServer.origin) })}</div>
            ) : null}
          </ReadOnlyIdentity>
        )}
      {organization && (
        <div data-account-team="" className="flex min-w-0 items-baseline gap-2 px-3.5 pb-[15px] text-[13px] leading-[18px]">
          <span className="shrink-0 text-ink-secondary">{t("settings.account.team")}</span>
          <span className="min-w-0 truncate text-ink">{organization}</span>
        </div>
      )}
      <div className="px-3.5"><OwnAvatarStatusLine status={photoStatus} /></div>
      {signOutFailed && <p role="alert" className="px-3.5 pb-3 text-[12px] text-danger">{t("settings.serverMode.signOutFailed")}</p>}
      {workspace.error && <p role="alert" className="px-3.5 pb-3 text-[12px] text-danger">{workspace.error}</p>}
    </div>
  );
}

/** The email with its copy button. */
function EmailLine({ email }: { email: string }) {
  const { state, copy } = useCopyFeedback(email);
  if (!email) return null;
  return (
    <div className="flex min-w-0 items-center gap-1">
      <span className="truncate text-[13px] leading-[18px] text-ink-secondary">{email}</span>
      <CopyEmailButton state={state} copy={copy} />
    </div>
  );
}

function OperatorCopyEmail({ email }: { email: string }) {
  return <CopyEmailButton {...useCopyFeedback(email)} />;
}

function CopyEmailButton({ state, copy }: ReturnType<typeof useCopyFeedback>) {
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={state === "failed" ? t("common.copyFailed") : state === "copied" ? t("settings.account.emailCopied") : t("settings.account.copyEmail")}
      title={t("settings.account.copyEmail")}
      className="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
    >
      {state === "copied" ? <Check size={13} className="text-success" aria-hidden="true" /> : state === "failed" ? <X size={13} className="text-danger" aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
    </button>
  );
}

function ReadOnlyIdentity({ name, email, avatarUrl, avatar, action, children }: {
  name: string;
  email: string;
  avatarUrl?: string;
  /** Replaces the picture (the person's own photo button). */
  avatar?: React.ReactNode;
  action: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3.5 px-3.5 py-5 text-left" data-testid="account-identity">
      {avatar ?? (avatarUrl ? (
        <img src={avatarUrl} alt="" width={44} height={44} className="size-11 shrink-0 rounded-full object-cover" />
      ) : (
        <InitialsAvatar initials={profileInitials({ name, email })} size={44} />
      ))}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium leading-[18px] text-ink">{profileLabel({ name, email })}</div>
        <MyLabelField />
        <EmailLine email={email} />
        {children}
      </div>
      {action && <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2" data-account-action="">{action}</div>}
    </div>
  );
}

/** Sign out of the organization server: the desktop asks for confirmation,
 * signs out and leaves this page. */
function SignOutButton({ onFailed }: { onFailed: (failed: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const leave = () => {
    const bridge = serverModeBridge(window.ogb);
    if (!bridge || busy) return;
    setBusy(true);
    onFailed(false);
    void bridge.leave().catch(() => onFailed(true)).finally(() => setBusy(false));
  };
  return (
    <button type="button" onClick={leave} disabled={busy} className="ui-button">
      {t("settings.serverMode.signOut")}
    </button>
  );
}

/** "Add account": the desktop's own server list (native menu), where another
 * account or server is added or chosen. */
function AddAccountButton({ workspace }: { workspace: ReturnType<typeof useDesktopWorkspace> }) {
  return (
    <button
      type="button"
      aria-haspopup="menu"
      aria-expanded={workspace.open}
      onClick={workspace.openMenu}
      className="ui-button"
    >
      {t("settings.account.addAccount")}
    </button>
  );
}

function profilePhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(t("settings.profile.photoReadError")));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error(t("settings.profile.photoReadError")));
      image.onload = () => {
        const size = 256;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error(t("settings.profile.photoReadError")));
          return;
        }
        const scale = Math.max(size / image.width, size / image.height);
        const width = image.width * scale;
        const height = image.height * scale;
        ctx.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

/** The operator of a personal server: name, email and photo are this
 * server's own, saved as they are typed (PUT /api/config). */
function OperatorIdentity({ action }: { action: React.ReactNode }) {
  const { state, dispatch } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(state.config?.profile?.name ?? "");
  const [email, setEmail] = useState(state.config?.profile?.email ?? "");
  const [avatarUrl, setAvatarUrl] = useState(state.config?.profile?.avatarUrl ?? "");
  const [menuOpen, setMenuOpen] = useState(false);
  const avatarRootRef = useRef<HTMLDivElement>(null);
  const avatarButtonRef = useRef<HTMLButtonElement>(null);
  const avatarMenuRef = useRef<HTMLElement | null>(null);
  usePopoverDismiss(menuOpen, useAnchoredDismissRoot(avatarRootRef, avatarMenuRef), () => setMenuOpen(false));
  useEffect(() => {
    setName(state.config?.profile?.name ?? "");
    setEmail(state.config?.profile?.email ?? "");
    setAvatarUrl(state.config?.profile?.avatarUrl ?? "");
  }, [state.config?.profile?.name, state.config?.profile?.email, state.config?.profile?.avatarUrl]);

  const save = (next: { name?: string; email?: string; avatarUrl?: string } = {}) => {
    const profile = {
      name: (next.name ?? name).trim(),
      email: (next.email ?? email).trim().toLowerCase(),
      avatarUrl: next.avatarUrl ?? avatarUrl,
    };
    void fetch("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile }),
    })
      .then((r) => { if (!r.ok) throw new Error(t("settings.profile.photoSaveError")); return r.json(); })
      .then((config: ConfigStatus) => {
        if (config.profile) dispatch({ type: "profileSaved", profile: config.profile });
      })
      .catch(() => {});
  };

  const choosePhoto = (file: File | undefined) => {
    if (!file) return;
    void profilePhoto(file).then((url) => {
      setAvatarUrl(url);
      save({ avatarUrl: url });
    }).catch(() => {});
  };

  const initials = (name.trim() || email.trim() || "?").slice(0, 1).toUpperCase();
  return (
    <div className="flex items-center gap-3.5 px-3.5 py-5" data-testid="account-identity">
      <div ref={avatarRootRef} className="relative shrink-0">
        <button
          ref={avatarButtonRef}
          type="button"
          aria-label={t("settings.profile.changeAvatar")}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          className="flex size-11 items-center justify-center overflow-hidden rounded-full bg-raised text-[13px] font-semibold text-ink"
        >
          {avatarUrl ? <img src={avatarUrl} alt="" className="size-full object-cover" /> : initials}
        </button>
        {menuOpen && (
          <AnchoredPopover anchorRef={avatarButtonRef} popoverRef={avatarMenuRef} gap={8} className="flex min-w-[200px] flex-col gap-0.5 rounded-xl border-[0.5px] border-border bg-elevated p-1.5 text-[13px] leading-[18px]">
            <button type="button" onClick={() => { setMenuOpen(false); fileRef.current?.click(); }} className="block w-full rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover">{t("settings.profile.uploadPhoto")}</button>
            {avatarUrl && <button type="button" onClick={() => { setAvatarUrl(""); setMenuOpen(false); save({ avatarUrl: "" }); }} className="block w-full rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover">{t("settings.profile.removePhoto")}</button>}
          </AnchoredPopover>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" aria-label={t("settings.profile.uploadAvatar")} onChange={(event) => { choosePhoto(event.target.files?.[0]); event.target.value = ""; }} />
      </div>
      <div className="min-w-0 flex-1">
        <input aria-label={t("settings.profile.name")} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => save()} placeholder={t("settings.profile.name")} className="w-full bg-transparent text-[13px] font-medium leading-[18px] text-ink placeholder:text-ink-secondary focus:outline-none" />
        <MyLabelField />
        <div className="flex min-w-0 items-center gap-1">
          <input type="email" aria-label={t("phone.signIn.email")} value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => save()} placeholder={t("settings.profile.emailPlaceholder")} className="min-w-[12ch] max-w-full bg-transparent text-[13px] leading-[18px] text-ink-secondary [field-sizing:content] placeholder:text-ink-secondary focus:outline-none" />
          {email.trim() && <OperatorCopyEmail email={email.trim()} />}
        </div>
      </div>
      {action && <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2" data-account-action="">{action}</div>}
    </div>
  );
}
