# Remote Sessions page and unattended access (Sagax control plane)

This note is for the operator. It covers the admin "Remote Sessions" page added to Sagax,
the unattended (ScreenConnect Access equivalent) model, the Loi 25 and code
signing requirements, and exactly what must be tested on a real machine. The
per OS persistence mechanics live in the Pulsatrix Assist helper repo, in
`docs/remote-control-service.md`; this note is the Sagax and Perspicax side.

## Status (2026-11-01)

Unattended access is always enabled server-side. It is not a mode and cannot
be disabled. There is no `SAGAX_UNATTENDED_ACCESS` flag and no "not enabled on
this server" gate. Safeguards that stay part of the design (and are not
toggles for turning unattended off): org consent at host install, visible
banner/tray on the host, non-disableable audit, expiry, revoke.

Works today:
- The Remote Sessions admin page (org-wide listing for admins; a person sees
  only their own sessions): listing (active and history), filters, search, the
  redacted log view, End session, and the live-session revoke path that cuts
  the tunnel.
- Org isolation and the admin vs owner visibility rules on the page and routes.
- Enrolled hosts: list, open unattended, revoke.
- Personal endpoint attach and live place selection live in the bot's Computer
  tab (not a separate full-window page for the person).

Host-side wiring that still lives in pulsatrix-assist (see RESULT notes when
a Sagax change needs a host change):
- The persistent host service install ("Sagax Remote Control") CLI dispatch.
- Revoke uninstalling the host service and invalidating the Perspicax `--allow`.
- Expiry and consent enforcement at (re)connect time on the host.

## Enrolled hosts (2026-10-26)

The contract is `docs/inscription-hote.md` in `sagax-remote-access` ("Côté
Sagax"). Perspicax is the authority: it keeps the enrolled hosts
(`remote_support_hosts`), keyed by `host_id` (`h_` and 32 hex, the fingerprint
of the host's own key, never a hostname or a serial: E3).

- The page shows an "Enrolled hosts" section above the sessions
  (`src/components/remote-session/UnattendedHostsSection.tsx`): the readable
  name, the organization when it is a name, the scope, enrolled, expires, last
  seen and the state (enrolled, expired, revoked). The `host_id` is only in the
  name's tooltip and behind the Copy button, never in the text.
- "Unattended access" (`POST /api/admin/remote-sessions/hosts/<host_id>/open`)
  shows on an enrolled host. Any person
  who reaches this server may open (no admin approval, decision 2026-10-26).
  Sagax makes a client key for that session only (as for a coded open), sends
  `remote_support_open` with `host_id` and the public nodekey, follows
  `remote_support_status` until the host picks the session at its beat, and
  the usual registrar posts the card and the panel row (`client = "app"`) in
  the conversation of the person's Primary Bot (else another bot of theirs
  with a Perspicax profile). The page then opens the live control overlay by
  itself.
- "Revoke" (`POST /api/admin/remote-sessions/hosts/<host_id>/revoke`, optional
  body `{ reason }`) shows on every host not yet revoked, flag OFF included
  (M2), with a confirm and an optional reason. Who may: the person who
  enrolled the host revokes it themselves (their own environment, no admin),
  and an admin revokes any host of the organization; Perspicax decides and
  Sagax adds no gate of its own. Sessions opened from this page on that host
  end here at once; Perspicax ends the others and the host stops and
  uninstalls at its next beat (a 410: only a 410 makes the host uninstall; a
  404, a 5xx or a network failure is retried with backoff).
- Every open writes an `unattended.open` line and every revoke a
  `remote_host.revoked` line (the name Perspicax gives the same act) in
  `remote-session-actions.jsonl`: the actor is the person who acted (M4), the
  host is in its own field, with the reason and the UTC time (`atUtc`). The
  legacy consent revoke writes the same kind; it is open to the person who
  recorded the consent and to an admin.
- Server: `server/remote-unattended-hosts.ts` (list, open, revoke),
  `shared/remote-unattended-host.ts` (rows, states, what may be opened),
  `openUnattendedSession` in `server/remote-support-local.ts`.

Perspicax tools (names frozen with Perspicax): `remote_support_hosts` (answer
`{ hosts: [{ host_id, hostname, org, scope, created_at, expires_at,
last_seen_at, revoked_at, ... }] }`), `remote_support_host_revoke`
(`{ host_id, reason? }`) and `remote_support_open` with `host_id`, which
answers the session's `code`, as status and close stay keyed by code. A
server without them reads as "list not available".

## What shipped in Sagax (this PR)

- A "Remote Sessions" page under the account menu, next to Automations
  (`src/components/remote-session/RemoteSessionsAdminPage.tsx`). iOS is not in
  this PR; it can come later as a read mostly list.
- It lists every remote session the viewer may see, active and history, with:
  computer, user, OS, started at, ends at, status (connected, ended, failed),
  rights (standard or elevated), the bot that initiated it (human label, id in
  a tooltip), the person who opened it, and an Unattended column (yes or no,
  since when, the expiry, whether the on screen banner is on or off, and a flag
  when the agent is not code signed).
- Per row: take control (reuses the live screen overlay), open the redacted
  log, and End session with a confirm. Filters: active only, unattended only,
  by bot, by computer. Search.
- The log view shows the audited actions (control start, grant and release
  with activity counts, exec commands with their read only or approved status,
  file transfers) with no secrets, no keystrokes and no tunnel address.

## Who can see what (org isolation)

One Sagax server is one organization. The server routes are admin scoped
(`/api/admin/remote-sessions...`), so the tool policy marks them
`defaultEnabled: false`: an agent tool never reaches them without an explicit
grant. A signed in person reaches the page from the account menu, and the
server then enforces: a workspace admin sees the organization's sessions;
anyone else sees only the sessions they own. The same rule gates the log and
the End action. Recording or revoking unattended consent is admin only.

## Unattended access (install time consent, Access model)

Unattended replaces the per session end user click with an install time
consent recorded by the client organization. It is the ScreenConnect Access
model, kept legitimate (discreet, never stealth):

- The host runs a persistent service with an honest name, "Sagax Remote
  Control" (display name configurable per deployment, always clearly our
  product and our publisher, Pulsatrix Technologies). It appears normally in
  the OS service list, Task Manager or Activity Monitor, Windows Apps and
  features, a macOS LaunchDaemon with our label, a Linux systemd unit. Never a
  misleading name, never hidden from the process list, never undeletable.
- Consent is recorded once, at install, by an admin or an org signed token
  (who, when, which machine, scope, expiry and renewal). It is never a silent
  install: the CLI and the page both refuse a record with no accountable
  installer. The record shows on the page.
- The on screen "remote control in progress" banner is optional, defaulting
  per the organization's setting. An org admin can turn the banner off for
  unattended machines, and can turn off the tray or menubar presence. Turning
  the banner off never turns off the audit: every connect, control, exec and
  file transfer stays on the Remote Sessions page.
- Expiry is required and not infinite by default (90 days, renewable, two year
  cap). The page surfaces the expiry.
- The service auto starts on reboot, survives logout (service or session 0
  context where the OS allows), and auto relaunches on crash (Windows SCM
  recovery, launchd KeepAlive, systemd Restart=on-failure).
- The end user can uninstall it locally (an admin of that machine), and the
  person who installed it, or an org admin, can revoke it remotely from the
  Remote Sessions page. Revoke marks the
  consent revoked, cuts any live tunnel at once, and propagates to the host
  service (uninstall) and to Perspicax (the `--allow` binding drops).

## Perspicax

The unattended agent still binds its tailcat node restricted to our control
node key with `--allow`, and the bind is audited. A revoke from the page
propagates so the key no longer resolves for that host. The helper exposes the
`--allow` argv and an audit hook (`internal/service/allow.go`).

## Session grant and per-session key

The single long-lived technician key is gone. Sagax (technician side) creates
one tailcat client key per session, kept in that session's folder
(`<data dir>/remote-support/sessions/<CODE>/`), never sent, and deleted when the
session is closed or past its end; see `docs/remote-sessions.md`. The old
shared `technician.private.json` is deleted when found.

Perspicax binds that session's public nodekey into a short authorization, the
session grant, which it signs (ES256) and hands to the helper with the support
page answer. The helper on the end user's machine verifies it before it admits
any tunnel client:

- Audience: the grant names the machine (the host id the helper sent on its
  first fetch); another machine refuses it.
- Admitted client: only the nodekey in the grant, that is the key of this one
  session.
- Expiry: at most one hour after it is issued, and never past the session end.
  While the session runs the helper renews it online; Perspicax signs a new
  grant only for a session still open.
- Revocation: closing the session (the technician, the panel, or an admin on
  this page) makes Perspicax answer 404 to the helper's check; the helper tears
  the session down, refuses new connections when it cannot check, and the last
  grant dies at its expiry because no renewal is signed.
- Scope: `remote_support_open` takes an optional `scope` (`full-control` by
  default, `view-only`, `shell-only`) carried in the grant, and an optional
  `call_ref`, the reference of the phone call or ticket that records the
  person's consent, kept in the Perspicax session journal.

## Flow skill wording (to mirror into the Flow skill)

> Enabling unattended access on a client host is done with the end user present
> and the client organization consenting. Install the "Sagax Remote Control"
> service from the Pulsatrix Assist helper or the CLI
> (`pulsatrix-assist install --unattended --org <id> --code <code>
> --consent-recorded-by <admin>`), record who consented, and set the banner and
> tray options per the client's policy. The install is auditable and the host
> shows the service by name. To stop it, uninstall locally or revoke from the
> Sagax Remote Sessions page; revoke cuts any live session.

## Loi 25

- The deploying organization (the client) is the data controller and is
  responsible for informing its own users per its policy before enabling
  unattended access. Sagax and the deploying operator are the processor.
- The log view states retention (90 days) and who can see it (a workspace
  admin or the session owner). The audit records who connected and what ran,
  by action and counts only, never keystrokes, file contents, secrets or the
  tunnel address (minimisation).
- Consent (who, when, scope, expiry) is recorded and shown, and is revocable.

## Code signing

- Windows: the service binary must be Authenticode signed.
- macOS: the LaunchDaemon binary must be signed and notarized.
- Linux: no OS signing requirement; distribute from a trusted package.
- An unsigned agent is flagged on the page (the Unattended column shows "Agent
  not code signed"). Ship signed builds for unattended.

## What to test on a real host

On the Sagax and Perspicax side:

1. Open the account menu and confirm "Remote Sessions" sits next to
   Automations and opens the page.
2. With a live Tailcat session, confirm the row shows the computer, bot, opener
   and rights, that Take control opens the overlay, that the log shows the
   exec and transfer actions without secrets, and that End closes the session.
3. As a non admin, confirm you see only your own sessions and cannot open
   another person's log or End it.
4. Record unattended consent for a host, confirm the Unattended column shows
   yes, the since and expiry, and the banner on or off state; then Revoke and
   confirm the row drops unattended and any live session is cut.

On a real machine of each OS (details and the install CLI in the helper doc
`docs/remote-control-service.md`): install the service, reboot and confirm it
auto starts, log out and confirm it still runs, kill the process and confirm it
relaunches, confirm it appears by its honest name in the OS service and app
lists, uninstall locally and confirm it is gone, and revoke from the page and
confirm it stops and removes and cuts the tunnel. Confirm the signed and
notarized builds are accepted. macOS limit: when logged out at the login
window there is no console user session, so screen and input control wait until
someone logs in (the daemon keeps running). Linux limit: Wayland needs a portal
and may block headless capture; a headless server is shell only (shell, files
and facts, no screen or control).

## Host-side follow-ups (pulsatrix-assist)

From the security review of PR #981. Sagax no longer gates these behind a
server flag (2026-11-01); they still need to land in the helper:

1. Route the helper CLI: wire `cmd/pulsatrix-assist/main.go` to
   `service.Dispatch` (install / status / uninstall are implemented and tested
   in `internal/service` but not reachable from the binary yet).
2. Enforce `Expired()` at runtime: a host whose consent lapsed must not accept
   an unattended (re)connect.
3. `onRevoke` must actually uninstall the host service and invalidate the
   Perspicax `--allow` binding, not only write an audit line. (Enrolled hosts:
   revoke goes to Perspicax, which tells the host at its next beat.)
4. `publish()` must refuse a session from a host without active consent
   (revoked or expired), so unattended cannot be used past its window.
5. Decide signed consent attestation (org signed token) vs free text
   `--consent-recorded-by`, and enforce the chosen form.

Ship signed and notarized helper builds for unattended hosts.
