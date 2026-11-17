// Settings > General > Account: the account card, exactly the reference's
// (#4457, the owner 2026-11-17, reference-wanted-2):
//
//   [avatar]  Name                           [Add account] [Sign out]
//             email [copy]
//   Team  <the organization signed in to>
//
// Nothing else in the card: a 44px avatar, 14px gap, 16px padding, the
// page's plain pill buttons (30px), the rows placed as measured on the
// reference (avatar 22px under the card's edge, Team 65px under its centre). On a solo install with no organization
// the Team row is hidden and the card is one row. The server's address and
// "Managed by your organization" are the tooltip of the organization's name
// (the address also stays on the Computer page); with a Perspicax profile
// link the name opens it ("Edit in Perspicax", in the same tooltip).
//
// On an organization server (Pulsatrix Perspicax) the name and email are
// Perspicax's and read-only; the signed-in person changes their own photo
// from the avatar (OwnAvatarField: crop, then written to Perspicax as them,
// 2026-10-16). On a personal server the operator edits name, email and photo
// here; the action is Add account (the desktop server list) beside Sign out.
// Sign out is the desktop's server mode bridge (src/lib/launch.ts): it asks
// natively, signs out and returns to the launch screen, unchanged. About me
// is not here: the person's bots keep it (sagax_settings account.aboutMe).
import { useEffect, useRef, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { openExternalLink } from "@/lib/app-links";
import { useCopyFeedback } from "@/lib/copy-text";
import { MENU_FIT_ROW, MENU_ROW, MENU_ROW_DANGER, MENU_SURFACE } from "@/components/menu-look";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { serverModeBridge } from "@/lib/launch";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { managedProfile } from "@/lib/profile-management";
import { useStore, type ConfigStatus } from "@/state/store";
import { InitialsAvatar } from "../Avatar";
import { useDesktopWorkspace } from "../DesktopWorkspaceSwitcher";
import type { ServerModeState } from "../ServerModeSettings";
import { profileInitials, profileLabel } from "../SidebarProfileMenu";
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

/** The tooltip of the organization's name on the Team row: the server's
 * address, then "Managed by your organization" and, with a Perspicax
 * profile link, "Edit in Perspicax". */
export function accountServerDetails(input: { origin?: string | null; managed?: boolean; editable?: boolean }): string {
  const parts: string[] = [];
  if (input.origin) parts.push(t("settings.serverMode.connectedTo", { server: host(input.origin) }));
  if (input.managed) parts.push(t("settings.serverMode.managedShort"));
  if (input.managed && input.editable) parts.push(t("settings.profile.editInPerspicax"));
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
  const editUrl = managed?.url || null;
  const details = accountServerDetails({ origin: lockedServer?.origin, managed: Boolean(managed), editable: Boolean(editUrl) });

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
          />
        )}
      {organization && (
        <div data-account-team="" className="flex min-w-0 items-baseline gap-2 px-4 pb-[9px] pt-[19px] text-[13px] leading-[18px]">
          <span className="shrink-0 text-ink-secondary">{t("settings.account.team")}</span>
          {editUrl
            ? (
              <button
                type="button"
                title={details || undefined}
                data-account-server={lockedServer?.origin ? host(lockedServer.origin) : undefined}
                onClick={() => void openExternalLink(editUrl)}
                className="min-w-0 truncate rounded-sm text-left text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
              >
                {organization}
              </button>
            )
            : <span title={details || undefined} data-account-server={lockedServer?.origin ? host(lockedServer.origin) : undefined} className="min-w-0 truncate text-ink">{organization}</span>}
        </div>
      )}
      <div className="px-4"><OwnAvatarStatusLine status={photoStatus} /></div>
      {signOutFailed && <p role="alert" className="px-4 pb-3 text-[12px] text-danger">{t("settings.serverMode.signOutFailed")}</p>}
      {workspace.error && <p role="alert" className="px-4 pb-3 text-[12px] text-danger">{workspace.error}</p>}
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

function ReadOnlyIdentity({ name, email, avatarUrl, avatar, action }: {
  name: string;
  email: string;
  avatarUrl?: string;
  /** Replaces the picture (the person's own photo button). */
  avatar?: React.ReactNode;
  action: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3.5 px-4 py-[15px] text-left" data-testid="account-identity">
      {avatar ?? (avatarUrl ? (
        <img src={avatarUrl} alt="" width={44} height={44} className="size-11 shrink-0 rounded-full object-cover" />
      ) : (
        <InitialsAvatar initials={profileInitials({ name, email })} size={44} />
      ))}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium leading-[18px] text-ink">{profileLabel({ name, email })}</div>
        <EmailLine email={email} />
      </div>
      {action && <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2" data-account-action="">{action}</div>}
    </div>
  );
}

/** The reference card's pills, measured on it: 32px tall, 14px text, 12px
 * sides (the page's other pills stay 30px and 13px). */
const ACCOUNT_PILL = "h-8 px-3 text-[14px]";

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
    <button type="button" onClick={leave} disabled={busy} className={`ui-button ${ACCOUNT_PILL}`}>
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
      className={`ui-button ${ACCOUNT_PILL}`}
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

  return (
    <div className="flex items-center gap-3.5 px-4 py-[15px]" data-testid="account-identity">
      <div ref={avatarRootRef} className="relative shrink-0">
        <button
          ref={avatarButtonRef}
          type="button"
          aria-label={t("settings.profile.changeAvatar")}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          className="flex size-11 items-center justify-center overflow-hidden rounded-full"
        >
          {avatarUrl ? <img src={avatarUrl} alt="" className="size-full object-cover" /> : <InitialsAvatar initials={profileInitials({ name, email })} size={44} />}
        </button>
        {menuOpen && (
          <AnchoredPopover anchorRef={avatarButtonRef} popoverRef={avatarMenuRef} role="menu" aria-label={t("settings.profile.changeAvatar")} gap={8} className={cn(MENU_SURFACE, MENU_FIT_ROW)}>
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); fileRef.current?.click(); }} className={MENU_ROW}>{t("settings.profile.uploadPhoto")}</button>
            {avatarUrl && <button type="button" role="menuitem" onClick={() => { setAvatarUrl(""); setMenuOpen(false); save({ avatarUrl: "" }); }} className={MENU_ROW_DANGER}>{t("settings.profile.removePhoto")}</button>}
          </AnchoredPopover>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" aria-label={t("settings.profile.uploadAvatar")} onChange={(event) => { choosePhoto(event.target.files?.[0]); event.target.value = ""; }} />
      </div>
      <div className="min-w-0 flex-1">
        <input aria-label={t("settings.profile.name")} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => save()} placeholder={t("settings.profile.name")} className="w-full bg-transparent text-[13px] font-medium leading-[18px] text-ink placeholder:text-ink-secondary focus:outline-none" />
        <div className="flex min-w-0 items-center gap-1">
          <input type="email" aria-label={t("phone.signIn.email")} value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => save()} placeholder={t("settings.profile.emailPlaceholder")} className="min-w-[12ch] max-w-full bg-transparent text-[13px] leading-[18px] text-ink-secondary [field-sizing:content] placeholder:text-ink-secondary focus:outline-none" />
          {email.trim() && <OperatorCopyEmail email={email.trim()} />}
        </div>
      </div>
      {action && <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2" data-account-action="">{action}</div>}
    </div>
  );
}
