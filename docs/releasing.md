# Releasing

Every version note in `docs/releases/` has two sections, in this order, in French and in English: the changes, then **Avant de mettre à jour** / **Before updating**. The second section says what a person should do before replacing the app or the server image. If nothing is required, say so. Do not leave the section out.



> **Sagax updater:** installed apps update only from
> `pulsatrixtechnologies/sagax` releases tagged `pulsa-vX.Y.Z`
> (`electron/update-feed.mjs`). By default they look at the latest **full**
> release (`/releases/latest`); a GitHub pre-release is offered only to people
> who switched on Settings > Updates > Pre-release versions. Publish a
> version everyone should get (starting with 0.4.0) as a full release, not a
> pre-release (`gh release create` without `--prerelease`, step 5 below).

For a normal release, run **Actions → Prepare next release → Run workflow** and
choose a patch, minor, or custom version. It opens a tiny version-bump PR;
merging that PR automatically starts **Release** and assembles a draft from the
exact merge commit. Review and publish the draft when it is ready.

The existing **Actions → Release → Run workflow** button remains available for
reruns and recovery. It
builds macOS (arm64 + x64, signed, notarized, stapled), Windows, and Ubuntu
from a single pinned commit, verifies every artifact the way a user would
receive it, and assembles the canonical draft in
[Sagax releases](https://github.com/pulsatrixtechnologies/sagax/releases).
The exact same assets are also staged in the public legacy releases repo so
installed builds from 0.1.46 and earlier can update across the repository
migration.

Tick **publish** to publish and verify the canonical release first, then make
the identical legacy updater bridge visible. Leave it unticked to review the
canonical draft; when you publish that draft in GitHub's UI, the **Sync
published release** workflow
verifies and publishes its legacy mirror automatically. Never publish only the
legacy draft.

The release commit must have passed CI: the **CI passed on the release commit**
job waits (while the platforms build) for ci.yml's `CI` check on the pinned
commit and stops the release before any draft if it failed. If that commit
has no CI run, or a newer merge replaced it, the job runs CI on the commit
itself on a temporary `release-ci/v<version>` branch. After a flaky failure,
re-run the failed CI jobs; a release still waiting picks up the new attempt,
and a release that already stopped needs only `gh run rerun <id> --failed`.
`ship_without_ci` skips the wait, for emergencies only.

Before the tag, dispatch the CI workflow on the release candidate SHA
(Actions → CI → Run workflow). Do not tag until the Windows and macOS
vitest jobs on that SHA have succeeded. A green push or merge-group run
only ran Ubuntu, and the release job's CI gate does not check those
platforms. `ship_without_ci` does not replace that dispatch.

The workflow refuses to overwrite an already-published version. Manual Release
runs still require `package.json`'s version to be bumped on the selected ref.
A release is rejected if any installer, stable download
name, updater feed, blockmap, size, or digest is absent or inconsistent.

GitHub generates the release body from pull requests since the previous
canonical tag. The docs changelog combines published canonical releases with
the legacy archive into one complete history and caches it for five minutes.
Configure the optional Vercel hook below to rebuild the docs immediately after
publication; otherwise the live cache or the next normal docs deployment
refreshes it.

## Sagax local release (no GitHub Actions)

Sagax releases are built on a Mac, not by the workflows above.

### Tag on main's squash commit

PRs are squash-merged into `main`. The `pulsa-vX.Y.Z` tag must point at that
squash commit on `main`, not at the tip of the release branch before the
merge. A tag on the branch tip is not an ancestor of `main` (see
`pulsa-v0.8.17`). Tools that walk commits or pull requests since the previous
tag then attribute every PR merged into `main` in the meantime to the next
version (issue #1709).

Order: open the release PR, build and gate from that tree, squash-merge into
`main`, check out the squash commit, then create the tag on it. Packaging may
still run on the release branch; only the tag placement is constrained.
`node scripts/check-release-tag.mjs` refuses to continue when `HEAD` (or the
sha you pass) is not an ancestor of `origin/main`. Run it after
`git fetch origin main`, immediately before `gh release create`.

1. Set `forkVersion` in `package.json` (`version` stays the Sagax base)
   and write `docs/releases/X.Y.Z.md`. French comes first. A line that is
   exactly `## English` starts the English section. Its first line is the
   release date as a hidden comment, `<!-- date: YYYY-MM-DD -->` (the
   release notes window shows it under the version; GitHub hides it).
   That file is the GitHub
   release body (`pulsa-vX.Y.Z`) and the notes the app shows before and
   after the update. `node scripts/check-release-notes.mjs` fails with a
   clear message when the file is missing, has no French section, or has
   no `## English` line. `pnpm package:fork:mac` and `pnpm package:fork:win`
   run the same check before packaging, and step 5 runs it again before
   the tag is created. A version that fails the check is not tagged.
   After electron-builder, `package:fork:mac` and `package:fork:win` write
   that file into the feed they produced (`release/latest-mac.yml`,
   `release/latest.yml`) as `releaseNotes`, on one line
   (`node scripts/embed-feed-release-notes.mjs <feed>`). The app shows the
   notes from the feed before the update; without them it falls back to
   GitHub (atom feed, then the public API), which can be late or empty
   right after publication (0.5.4 showed "No notes were published").
2. macOS: `SAGAX_MAC_IDENTITY="<Developer ID name or SHA-1 hash>" pnpm package:fork:mac`
   (a hash is required when the keychain holds two identities with the same
   name), then notarize and staple each `.zip`/`.dmg`, re-zip and regenerate
   `latest-mac.yml` (`node scripts/regenerate-mac-feed.mjs`). It keeps the
   `releaseNotes` line and fails when the feed has none: run
   `node scripts/embed-feed-release-notes.mjs release/latest-mac.yml`, then
   regenerate again.
3. Windows x64 + arm64: `pnpm package:fork:win:cross` (one NSIS installer for
   both arches, two portable zips, `latest.yml`), signed with Azure Trusted
   Signing (Windows signing, below). Without the signing settings or the az
   login the build stops before packaging: there is no unsigned Windows
   release build. After-pack refuses a
   package whose `.node` addons or `Sagax.exe` are not PE images for that
   arch; recheck a built or downloaded package with
   `node scripts/verify-win-natives.mjs <win-unpacked or unzipped dir> x64|arm64`.
   Nothing here runs the app: a Windows launch (Windows, below) is still
   needed before release.
4. Gates: `scripts/smoke-browser-bundle.mjs` (live on the host arch,
   `--check-only` for the others) and `SAGAX_SMOKE_DIST=<resources>/server
   node scripts/smoke-packaged-server.mjs` for every package.
   Before notarizing, launch the packaged app on the host arch:
   `pnpm smoke:launch --app release/mac-arm64/Sagax.app`, and again with
   `--user-data-copy` pointing at an existing userData folder (it is copied,
   never modified). Both must load the main window within 60 s.
5. Dispatch CI on the release candidate SHA (Actions → CI → Run workflow) and
   wait until the Windows and macOS vitest jobs on that SHA have succeeded. A
   green push only ran Ubuntu. Squash-merge the release PR into `main`, then
   `git fetch origin main` and check out the squash commit (the merge commit
   sha on `main`, not the release branch tip). Then
   `node scripts/check-release-notes.mjs`,
   `node scripts/check-release-tag.mjs` (refuses when this commit is not an
   ancestor of `origin/main`),
   `node scripts/embed-feed-release-notes.mjs --check release/latest-mac.yml release/latest.yml`
   (fails when either updater manifest is missing on disk, or when a feed does
   not carry exactly `docs/releases/X.Y.Z.md`; both `latest-mac.yml` and
   `latest.yml` must always be published),
   `node scripts/verify-win-signatures.mjs release` (every Windows `.exe`
   signed and timestamped, `latest.yml` sha512 and sizes match the signed
   files), and
   `gh release create pulsa-vX.Y.Z --target "$(git rev-parse HEAD)" --notes-file docs/releases/X.Y.Z.md`
   with every installer, zip, blockmap and both feeds, as a full release.
   `--target` pins the tag to this squash commit on `main`. Do not tag the
   release branch tip and do not omit `--target` while still on that branch.
   The release body is the notes file. Do not write a different body: the
   desktop updater shows it as the notes for the version.
   This repository has immutable releases: once a release is published, no
   asset can be added, replaced or removed (`gh release upload` answers
   HTTP 422 "Cannot upload assets to an immutable release"). Build macOS and
   Windows first, then create the release with every asset in ONE
   `gh release create` call. Publishing macOS first and adding Windows later is
   not possible. A Latest release without `latest.yml` breaks the Windows
   update check, and without `latest-mac.yml` breaks the macOS update check,
   so never publish without both feeds (0.4.11 shipped macOS only for this
   reason).

### Windows signing

From 0.8.3, every Windows release build is signed with Azure Trusted Signing
(Artifact Signing) from the Mac, with [jsign](https://ebourg.github.io/jsign/).
Releases published before 0.8.3 stay unsigned: releases are immutable and are
never re-signed.

Prerequisites on the build Mac:

- `brew install jsign osslsigncode` and the Azure CLI.
- An `az login` in the signing tenant, in the az profile the build uses
  (`AZURE_CONFIG_DIR` when it is not the default one), by an account that has
  the "Artifact Signing Certificate Profile Signer" role on the certificate
  profile.
- These variables, kept outside the repository (a private env file you
  source, never committed):

  | Variable | Value |
  |---|---|
  | `SAGAX_WIN_SIGN_ENDPOINT` | the account's regional endpoint host, e.g. `eus.codesigning.azure.net` |
  | `SAGAX_WIN_SIGN_ACCOUNT` | the Trusted Signing account name |
  | `SAGAX_WIN_SIGN_PROFILE` | the certificate profile name |
  | `SAGAX_WIN_SIGN_TENANT` | the tenant id the az login must be in |
  | `SAGAX_WIN_SIGN_PUBLISHER` | the profile's subject CN, as Windows shows the publisher |

What the build does (`scripts/package-fork.mjs` with
`scripts/win-sign-trusted.cjs` and `scripts/win-trusted-signing.mjs`):

1. Before packaging, it checks jsign, the az login, its tenant and that az can
   mint a code signing token. Any of them missing stops the build with the
   reason.
2. electron-builder calls the sign hook for every executable it signs:
   `Sagax.exe`, `elevate.exe`, the NSIS uninstaller and the setup, for x64
   and arm64. It never calls it for single-file extra resources, so
   `scripts/after-pack.mjs` signs those (the CUA driver executables, whose
   upstream signature is replaced) before the zips and the installer are
   made. Each is signed in place
   (SHA-256, RFC 3161 timestamp from `http://timestamp.acs.microsoft.com`)
   before electron-builder computes the blockmaps and the sha512 of
   `latest.yml`, so the feed describes the signed files. Vendor binaries
   whose bytes after-pack checks against a pinned digest (browser engine,
   cloudflared, tailcat) and the Android platform tools keep their vendor
   signature and are not re-signed.
3. The access token is requested once per build, kept in memory and handed
   to jsign through its environment (`--storepass env:...`), never on a
   command line, in a file or in a log.
4. After the feed gets its release notes, `scripts/verify-win-signatures.mjs`
   runs `osslsigncode verify` on the setup and on every `.exe` of
   `win-unpacked`, `win-arm64-unpacked` and both zips (signer CN must be
   `SAGAX_WIN_SIGN_PUBLISHER`, signature and timestamp valid, against the
   Microsoft roots it downloads and checks by pinned SHA-256), then checks
   every sha512 and size of `latest.yml` against the files. A failure fails
   the build. Run it again before `gh release create` (step 5).

A certificate from a new publisher can still meet SmartScreen until the
publisher has reputation; the signature is what lets it build.

Auto-update: `publisherName` is not set, so electron-updater does not check
the update's signer. Setting it later makes every installed signed build
reject an update signed by any other subject; list every subject the
releases will use (old and new) before changing the certificate's
organization.

### Windows

The Windows packages are cross-built on macOS (step 3) and nothing in that
flow runs the app, so a person launches it on a real Windows PC before the
release: Windows 11 on arm64 first (a Snapdragon PC, or a Windows 11 ARM VM
on Apple Silicon), then Windows 10 or 11 on x64, ideally on a clean user
profile. Note the Windows build (`winver`) and the arch.

- The installer's hash matches the feed. In PowerShell, the base64 value
  must equal the `sha512` line of `latest.yml`:

  ```powershell
  $h = (Get-FileHash .\Sagax-X.Y.Z-setup.exe -Algorithm SHA512).Hash
  [Convert]::ToBase64String([byte[]] -split ($h -replace '..', '0x$& '))
  Select-String -Path .\latest.yml -Pattern 'sha512'
  ```

- Install: the setup's Properties > Digital Signatures tab shows the
  publisher with a timestamp (from 0.8.3; earlier builds are unsigned and
  SmartScreen needs More info, then Run anyway); no UAC prompt (per-user install); Sagax opens by itself; the Start
  menu and desktop shortcut read "Pulsatrix Sagax" and Installed apps lists
  "Pulsatrix Sagax X.Y.Z"; Task Manager's Architecture column shows
  `Sagax.exe` as ARM64 on arm64 and x64 on x64 (not emulated).
- First launch: the chat loads within 60 s (not "Couldn't start the bot
  server", not a black window), and no update popup shows.
- Working app: `%APPDATA%\sagax` exists (an older install may still use
  `%APPDATA%\openmausbot`) and its `logs\server.log` has no stack trace at
  startup; the model picker lists at least one engine (the `.cmd` shim
  resolution of `server/procs.ts` runs only on Windows); a new bot answers a
  message; a small `.zip` attached to a message reaches the bot; the chat is
  still there after closing and reopening from the Start menu; quitting
  leaves no `Sagax.exe` in Task Manager.
- Portable zips: the same first launch checks with the zip of the PC's arch,
  and on arm64 the x64 zip too (it runs emulated, slower).
- Optional scripted smoke, with Node 24 and a checkout on the PC (use `x64`
  on an x64 PC; the shortcut's "Open file location" shows the folder):

  ```powershell
  node scripts\smoke-packaged-launch.mjs --app "$env:LOCALAPPDATA\Programs\Sagax\Sagax.exe"
  node scripts\verify-win-natives.mjs "$env:LOCALAPPDATA\Programs\Sagax" arm64
  ```

  It prints `[smoke] renderer-ready` and exits 0 when the window reached the
  server.
- Update path: the previous version, installed and launched, offers and
  installs the new one and restarts on it (About shows the version). A
  download that does nothing points at a `latest.yml` sha512 mismatch.

Report the Windows build, the arch and each check, or the failure with a
screenshot and the last 50 lines of `server.log`. Never paste a token, cookie
or credentials file.

## Updater migration invariant

`app-update.yml` is baked into every packaged desktop app. Builds through
0.1.46 point to `milind-soni/openmausbot-releases`; newer builds point to
`pulsatrixtechnologies/sagax`. For that reason:

1. Every new release is published byte-for-byte to both repositories during
   the bridge period.
2. `openmausbot-releases` must stay public. Do not delete its final bridge
   release, feeds, or assets.
3. README and docs downloads point at the canonical repo, while the legacy
   mirror exists only for installed updater clients and historical releases.

The npm package is published separately (below). It is not a desktop
updater artifact and is not attached to the GitHub release: releases are
immutable once published, and their body is the desktop update notes.

## Public server image: `ghcr.io/pulsatrixtechnologies/sagax`

Publishing the release (`gh release create pulsa-vX.Y.Z`, step 5) fires
`release.yml` on its `release: published` event. Only the `server-image` job
runs for that event (every installer job skips it), so this is the one CI
run of the release. It builds the repository's `Dockerfile` at the tagged
commit for `linux/amd64` and `linux/arm64`, pushes it by digest to
`sagax-staging`, scans both platforms (zero critical and high findings,
exceptions from the `TRIVYIGNORE_PRIVATE` secret as in `docker.yml`), signs it
keyless, attests the scan, then points `X.Y.Z`, `X.Y`, `sha-<commit>` and,
for the latest full release, `latest` at that digest. No job waits for it,
so it never holds up the desktop release. It carries no deployment's
configuration. `install.sh` and `sagax update` pull it (docs/install.md).

- To publish or republish the image of an already published release: Actions
  > Release > Run workflow with `server_image_tag` = `pulsa-vX.Y.Z`. Nothing
  else runs.
- One-time setup: after the first publish, set the `sagax` package to
  **Public** in the organization's Packages settings, and link it to this
  repository, so anyone can pull it without signing in.

## npm package: `@pulsatrixtechnologies/sagax`

The CLI and server are published to npm as `@pulsatrixtechnologies/sagax` (command
`sagax`), at the release's own version: tag `pulsa-vX.Y.Z` publishes
`@pulsatrixtechnologies/sagax@X.Y.Z`, built from `package.json` `forkVersion`. This is
the only npm package of this project. The unscoped names are not ours: one
is the upstream author's package and `sagax` is an unrelated one, so never
publish, install or document them. Until the first version is on npm, the
checkout (`pnpm install && pnpm build`, then `pnpm omb <command>`) remains
the way to run the CLI, and docs that show `npm install -g @pulsatrixtechnologies/sagax`
say so.

- `.github/workflows/npm-package.yml` runs on every pushed `pulsa-v*` tag
  (`gh release create pulsa-vX.Y.Z`, step 5 above, creates and pushes it)
  and on a manual dispatch. It builds the package
  (`scripts/build-npm-package.mjs`), proves the packed tarball runs with no
  `node_modules`, checks that the tag, the package version and
  `forkVersion` agree, then publishes with
  `npm publish --provenance --access public`. A manual run on a branch
  stops before publishing; a manual run on a `pulsa-v` tag publishes (use it
  to retry a failed publish).
- Publishing uses npm trusted publishing (OIDC): no npm token is stored.
  The publish job runs in the GitHub environment `npm` with
  `id-token: write`. The trusted publisher on npmjs.com names organization
  `pulsatrixtechnologies`, repository `Sagax`, workflow `npm-package.yml`
  and environment `npm`, and allows `npm publish`.
- npm accepts a trusted publisher only on a package that already exists.
  The first version is therefore published once with a short-lived
  granular token saved as the optional repository secret `NPM_TOKEN`
  (the workflow falls back to it only when OIDC fails), or by hand from the
  proven tarball. Then add the trusted publisher, delete `NPM_TOKEN`, revoke
  the token, and set the package to require two-factor authentication and
  disallow tokens.
- `fleet upgrade` installs exactly `@pulsatrixtechnologies/sagax@<version>`, never a
  floating tag, so a fleet moves only when its operator names a release.

## Why the gates exist

Each verification step in `release.yml` maps to a real incident from the
hand-cut releases (0.1.15–0.1.25): stale build output breaking the code
signature, a bare import killing the packaged server on launch while every
check stayed green, helper paths resolving outside the app after bundling,
stapling silently invalidating every published hash, and a finished release
sitting invisible as a draft. Don't remove a gate without reading the comment
above it.

## Bundled browser gates

Desktop builds also stage a pinned engine and Chromium Headless Shell before
packaging. Pre-signing checks validate complete resources and upstream hashes;
native browser smoke tests and macOS signature checks run on the packaged
output. See [browser packaging](browser-packaging.md) for update ownership,
license provenance and Linux sandbox constraints. Missing browser resources
must fail the build, not ship an installer that downloads them on first use.

## One-time setup: release secrets

Set these in **Sagax → Settings → Secrets and variables → Actions**.

The **Prepare next release** workflow also needs
**Settings → Actions → General → Workflow permissions → Allow GitHub Actions
to create and approve pull requests** enabled. The workflow only creates the
version PR; it never approves or merges it.

### 1. `MAC_CERT_P12_BASE64` + `MAC_CERT_PASSWORD`

The Developer ID Application certificate, exported from the Mac that
currently signs releases:

```sh
# Keychain Access → My Certificates → "Developer ID Application: Alex Martin
# (PP546MZVHZ)" → right-click → Export… → .p12 with a strong password, then:
base64 -i DeveloperID.p12 | pbcopy   # → MAC_CERT_P12_BASE64
# the export password             → MAC_CERT_PASSWORD
```

### 2. `APPLE_API_KEY_P8_BASE64` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER_ID`

An App Store Connect API key for notarization (better than an app-specific
password for CI — revocable, scoped, no 2FA dance):

1. [App Store Connect → Users and Access → Integrations → App Store Connect API](https://appstoreconnect.apple.com/access/integrations/api)
2. Generate a **Team Key** with the **Developer** role
3. Download the `.p8` (one chance only), note the Key ID and Issuer ID

```sh
base64 -i AuthKey_XXXXXXXX.p8 | pbcopy   # → APPLE_API_KEY_P8_BASE64
```

### 3. `RELEASES_PAT`

A fine-grained personal access token that lets the workflow write to the
legacy updater mirror: **GitHub → Settings → Developer settings →
Fine-grained tokens** → repository access: only `openmausbot-releases` →
permissions: **Contents: Read and write**. Set a long expiry and a calendar
reminder. The canonical release uses the workflow's scoped `GITHUB_TOKEN` and
does not need a PAT.

### 4. Optional `DOCS_DEPLOY_HOOK_URL`

In Vercel, open the docs project and create a **Deploy Hook** for its production
branch. Store that private URL as the `DOCS_DEPLOY_HOOK_URL` repository secret.
Publishing a release then requests a fresh docs deployment so the generated
changelog appears immediately. Do not put the hook URL in source control.

### Local fallback

The hand-cut path still works when Actions is down or a release needs
surgery: `pnpm package:mac`, gate with `codesign --verify --deep --strict`,
notarize with the local keychain profile (`xcrun notarytool submit …
--keychain-profile AC_PASSWORD`), staple, re-zip, regenerate blockmaps and
`node scripts/regenerate-mac-feed.mjs`, upload the identical complete asset set
to both repositories, publish and verify the canonical release before the
legacy mirror, and always verify the published bytes against the published feed
by downloading them back.

## iOS version follows the desktop version

The iOS app's `MARKETING_VERSION` (four places in `ios/project.yml`) is bumped to the same number as `forkVersion` in every release branch, with `CURRENT_PROJECT_VERSION` incremented for the next TestFlight upload. The two apps never show different version numbers. Rule set on 2026-10-09; first applied in 0.4.16.
