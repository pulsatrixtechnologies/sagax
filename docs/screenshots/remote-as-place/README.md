# Remote sessions as Computer places (2026-11-01)

JC's decisions: unattended access always on (no server gate), remote endpoints
live in the bot Computer tab, enrolled hosts appear as places in the place
dropdown, ended or temporary sessions never linger as active.

Follow-up (same day): calm asleep / waking / running Computer screens (Grok Bot
style) for every place, centered Open pill while running, per-person place
rename in the dropdown. See [computer-asleep/](computer-asleep/).

## Before (live UI, `.ref/`)

Captured on the running app before this change:

  full-window Remote sessions page with "Unattended access (a persistent host
  service) is designed but not enabled on this server yet" and
  "Opening unattended access is not enabled on this server".
  Computer tab place control showing Cloud only.
  place list with Cloud, the person's Mac, Browser (no enrolled host).

## After (headless gallery)

Synthetic gallery `src/gallery/remote-as-place.html`, captured with
`node scripts/capture-remote-as-place.mjs` (Playwright headless). Set
`SAGAX_VERIFY_BROWSER_CHROME` when the Playwright browser cache is missing.

- [after-place-dropdown-with-host.png](after-place-dropdown-with-host.png):
  place list includes PC-A (enrolled host) beside Cloud, Mac de Owner, Browser,
  each with a status dot.
- [after-computer-place-closed.png](after-computer-place-closed.png):
  closed picker naming Cloud.
- [after-endpoints-section.png](after-endpoints-section.png):
  Computer tab endpoints: attached host with Open / Remove / Revoke, plus Add
  endpoint for another enrolled host.
- [after-details-no-sessions.png](after-details-no-sessions.png):
  Details stub with no RemoteSessionsSection (sessions no longer linger there).

## Calm screens + rename

[computer-asleep/](computer-asleep/) — before Off badge, Grok Bot refs, after
asleep / waking / running+Open / place rename.

Looked at by the implementing agent on 2026-11-01.
