# Claim: Grok convergence native fixture (demo library / files / pages)

## Worker

Grok CLI native fixture worker. Explicitly authorized by the operator and root.
No internal or external subagents.

## Scope

Implement ONLY:

- `ios/Sources/CompanionCore/Demo.swift` and necessary `Demo*.swift` reference
  files / tests
- A small accessibility fix in
  `ios/App/Features/Pages/PageSurfaceView.swift` if required (PageHeaderMore:
  real accessible label / identifier on the Menu label)

Out of scope (other workers / root):

- Simulator UI build / install / launch / control
- Unsigned native app build and core unit tests owned by parent
- `AttachmentUpload.swift`, `Client.swift`, `Session.swift`, other app files,
  production server
- Push, merge, deploy, release, cherry-pick of moving branches

## Base and worktree

- Worktree: `/Users/jencryzthers/sagax-grok-native-fixture`
- Branch: `feat/grok-convergence-native-fixture`
- Pinned base: `c3bf9b03d` (`c3bf9b03d7a422b6aa4f75f3be7fca61eef56312`)
- Reuse this worktree. Do not write any other worktree.
- Parent has claimed overall native scope.

## Acceptance (this claim)

1. Demo Library / files / pages routes match the real contracts with synthetic
   fixture entries (Atlas chat files no longer 404 as "Couldn't load this
   chat's files").
2. Demo implements resumable upload transport meaningfully:
   `POST /api/files` (documents / audio / video / archives) and
   `POST /api/attachments` (images) with query `uploadId`, `total`,
   `phase=status|chunk|commit|cancel`, `offset`; `/api/files` also `name`.
   Content-Type is the normalized MIME. Chunks <= 4 MiB. status nonexistent
   404; chunk offset 0 creates; replies and receipt / cancel / retry as in
   the real contract. Synthetic data only.
3. Meaningful tests with real DemoServer URLSession against a fixture
   listening on loopback (not only `URLProtocol`): library listing, pages
   metadata / reads if missing, resumable status / chunks / receipt retry /
   cancel, missing route feedback.
4. Preserve personal autonomy, org Ask/Deny / isolation / sensitive paths,
   identity / themes / Pages richness. No secrets or user data.
5. Explicit-path commits only. Evidence in
   `docs/plans/grok-convergence-native-fixture-evidence.md`.

## Claimed at

2026-10-31 (evening EDT). Fresh Grok quota noted by parent: 24% used, 76%
remaining at 20:17 EDT.
