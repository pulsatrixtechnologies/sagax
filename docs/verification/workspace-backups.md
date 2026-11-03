# Full workspace backups

## User path

Settings → Backups → **Export full backup** → password and confirmation →
encrypted `.sagaxbackup` download. An older `.ombbackup` file still imports. Import uses a native file input, password,
validated preview and an explicit **REPLACE** confirmation. It is replacement,
not an additive team import. Click **Restart and restore** on the local desktop
to quit and reopen it; closing only its window does not restart the server.
A hosted server must restart before its browser's **Retry** can finish recovery.
No restore writes into a running Store. The native-button workflow is exercised
by the [company-backup fixture](company-backups.md).

The previous workspace is retained under `.backups/safety-<restore-id>/data`.
Keep this copy until the restored workspace is checked. Do not publish it.
The downloaded archive is encrypted; private staging and safety directories
are not. They contain private workspace data and require normal host/disk
protection. The latest successful restore's staging is retained for recovery.

Saved account credentials and connections are not transferred. Reconnect on a
new machine; existing credentials and connections on the destination remain
unchanged. Conversations, drafts and user files are not automatically redacted
and may still contain pasted secrets, so the archive must remain private.

## Archive format

A `.sagaxbackup` (or older `.ombbackup`) file is the header `OMB-WORKSPACE-1\n`,
a 16-byte scrypt salt and a 12-byte IV, then an uncompressed tar encrypted with
AES-256-GCM under the password (the header is the AAD), then the 16-byte tag.
Nothing is parsed before the tag authenticates the whole file. The tar holds:

- `manifest.json`: the summary, the source data folder, the allowlisted client
  preferences, every file and folder of `data/` with its size, mode and
  sha256, and `parts` (below) when the archive has any.
- `data/`: the workspace files, minus every exclusion listed under
  [Limits and cleanup](#limits-and-cleanup). Sealed stores (`*.enc`, `*.key`)
  never leave a machine, `installation-capabilities.enc` included.
- `skills-library-index.json` (from 0.8.34, version 1): the organization
  skills library index, `{ "format": "sagax.skills-library-index",
  "version": 1, "entries": { … } }`. Since capabilities lot 5 that index lives
  in the sealed installation store, which a backup leaves out, so it travels as
  this part: the library entries only, never the store's MCP servers,
  marketplaces, markers or any secret. `manifest.parts.skillsLibraryIndex`
  records its path, version, size, sha256 and entry count; a part that does
  not match is refused, as is a part the manifest does not declare. When the
  sealed store cannot be read on that launch, the archive has no part and its
  summary says so. The skill files themselves are in
  `data/skills-library/skills/`.

On restore, the destination keeps its own sealed store. The restore leaves the
part at `skills-library/restore-import.json`, and the next boot, once the store
can be read, adopts it with the rules of the stranded-entry recovery: a valid
entry whose `SKILL.md` has the recorded sha256. A workspace restore is a
REPLACE, so an adopted entry replaces the destination's entry of the same name
and a destination entry whose skill file the restore removed is dropped; any
other import mode never replaces an existing name. The file is then removed (a
file that is not a supported index is set aside as `.rejected`). Bot
assignments travel with the bots. An archive without the part (0.8.33 and
older) restores as before.

## Launch and drive

```sh
node --experimental-strip-types scripts/verify/dev/verify-workspace-backup.ts
```

This recipe accepts no live URL. It launches two owned fake-engine servers with
temporary data and homes, creates a real conversation, profile, memory, reviewed
skill and attachment, exports via the real HTTP route, uploads to the second
workspace, validates and confirms replacement, then restarts that exact fixture.
It compares original IDs, history, attachment bytes and app-managed paths, saved
non-secret settings, credential exclusion and destination preservation,
browser-state allowlisting, and the automatic safety copy. It sends a new turn
through the restored conversation. Wrong passwords, wrong confirmation,
non-admin access and post-confirmation writes are rejected. A second recipe
(`verifyWorkspaceBackupLibrarySkills`) adds organization library skills,
assigns them to two bots, restores into a fresh install and checks they are
listed, readable (200 from the library and from the bot) and assigned as
before, with the sealed installation store left out of the archive.

Keep its JSON output and the reported persistent log/evidence paths. The
permanent version is:

```sh
pnpm exec vitest run server/workspace-backup-workflow.e2e.test.ts --silent=false
```

## Additional checks

Export worker behavior and repeatable latency measurements are documented in
[Backup responsiveness](backup-responsiveness.md).

```sh
pnpm exec vitest run server/workspace-backup.test.ts \
  server/backup/workspace-backup-policy.test.ts \
  server/backup/workspace-backup-http.test.ts \
  server/backup/workspace-backup-maintenance.test.ts \
  server/webhook-ingress.test.ts server/request-auth.test.ts
SAGAX_UI_E2E=1 pnpm exec vitest run scripts/testing/workspace-backup-ui.e2e.test.ts
```

The archive tests cover authenticated encryption, damaged/wrong-password files,
path traversal, links and duplicate entries, SQLite WAL rows, modified staging,
cross-directory path repair, interrupted replacement, credential exclusion,
destination credential preservation and recovery. The maintenance checks keep
ordinary requests, turns, schedulers and the separate webhook receiver from
writing during a snapshot.
Unknown external writers cannot be frozen: users must stop external editors and
managed desktops before exporting.

All tests use disposable workspaces and synthetic credential values, never the
user's keychain or live sign-ins. The renderer recipe drives the real Settings
screen in an isolated Chromium fixture with simulated backup endpoints; it checks the native
file input, password errors, preview and confirmation. Actual archive and restart
behavior is proved separately by the two-server recipe above.

## Limits and cleanup

Backups include this workspace's durable files and complete message records—not
saved account credentials/connections, remote VM disks, other workspaces, external
project files, external CLI/browser login homes, or live device sessions. The
10 GB and 100,000-entry limits fail visibly. Scheduled routines/webhooks are paused and
unfinished work is not replayed after restore. Known temporary sockets, leases,
tool downloads and caches are excluded, as are the Organization library's
downloaded catalog and release files (`org-library/catalog.json`,
`org-library/blobs/`); unknown special files are rejected.
If a configured provider login home is inside ordinary workspace files rather
than the excluded `providers/` directory, export and restore refuse to proceed
until that login storage is moved outside the backed-up files.

Both recipes stop only their owned processes and remove only their temporary
workspaces. Evidence logs remain. These tests do not prove real cloud accounts,
external providers, phone recovery or OS-specific file-picker appearance. Saved
credentials are deliberately not transferred. No live mutation is part of this
recipe.
