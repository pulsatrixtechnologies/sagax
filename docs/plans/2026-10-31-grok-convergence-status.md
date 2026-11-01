# Grok Bot convergence execution

Objective: finish all six lots in `2026-10-31-grok-convergence.md`, preserving
Sagax strengths. A passing first lot is not completion of this objective.
Pinned starting point: `81e0dd358a7db3b1a5b8be1559ddb03f8dc373be`.
Integration branch: `feat/grok-convergence-complete`.

## Claimed work

| Lot | Branch | Integrated state (2026-11-01) | Remaining |
| --- | --- | --- | --- |
| 1. Scoped discovery | PR #1893 | Done, integrated. | Rerun at the final gate. |
| 2. Engine continuity | feat/grok-convergence-engines | Done on synthetic engines, integrated (523415e7f). | Real provider turns in lot 6; no org Flow fixture for the workspace_read e2e. |
| 3. Runtime reliability | feat/grok-convergence-runtime | Done. Ledger paths, aside, Continue:, external sync/review, room goal workers on the runtime; legacy ledger deleted; 22 convergence e2e + 12 group-goal e2e pass. | `run_with_engine` receipt drawer (out of this cut). |
| 4. Files and media | upload-recovery, video, native-upload | Done on fixtures and headless builds, integrated (b01753735, 3ce0d7548, e3af6469b). Server and iOS limits held equal by a parity test. | First live xAI video (billable key, JC); live proxies and the Perspicax sandbox proxy; physical iPhone (#1708); app-suspended uploads need iOS background transfer. |
| 5. Interface | interface, sidebar | Pages and chat on the real ChatView, integrated (43e56045f). JC decided 2026-11-01: an automatic icons-only rail at medium widths, in progress. | Side by side with the live Grok app (lot 6). |
| 6. Qualification | integration | Both macOS apps and Sagax iOS opened. | Grok Bot iOS (not installed in the simulator, mirroring timed out); same task corpus on both apps; p50/p95, lost, duplicate; bilingual voice; iPhone and Watch; full suite at version cut. |

No lot is called complete from source inspection or synthetic narrow checks
alone where its acceptance requires a real engine, comparative run or device.
Record inaccessible dependencies explicitly and continue other implementation.

JC explicitly requires opening both real apps and visually comparing all
macOS and iOS surfaces, not only galleries, source or documentation. Compare
navigation, chat/composer, files, Pages, skills/plugins, routines, approvals,
settings and narrow/native behavior. Record exact app versions and whether
the evidence is a real app, simulator, physical device or gallery. Never
substitute a responsive web capture for opening the native iOS app.
Actual versions, visited surfaces and remaining access are recorded in
[`grok-convergence-native-visual-audit.md`](grok-convergence-native-visual-audit.md).

Upload review remediation is claimed by the existing capabilities_advisor
worker on feat/grok-convergence-upload-recovery, isolated from the root's
visual audit. Pinned implementation checkpoint: b71559896. Fix all remaining
review findings and qualify the full upload step before returning commits.

Video provider implementation is claimed by capabilities_adversary in
feat/grok-convergence-video, pinned at a521c13c4. It owns working make_video
provider dispatch, polling/recovery/durable attachment and meaningful isolated
provider tests, not upload/native code or release. Its own implementation will
receive a separate review.

Native attachment parity is claimed by native_upload on
feat/grok-convergence-native-upload, pinned c3bf9b03d. It owns iOS native
streaming/resumable upload progress/cancel/retry and limits, with touched Swift
checks. Root owns simulator UI audit and later integrated device qualification.
The native worker delegated the actual-demo Library/upload/AX fixture repairs
to Grok CLI on feat/grok-convergence-native-fixture, pinned c3bf9b03d in its
own worktree. Root integrates its commits separately; no simulator control.

## Preserved invariants

Keep identity/themes, personalization, engine/provider choice, local models,
self-hosting, personal autonomy, personal libraries, native Claude plugins,
advanced Pages/routines, telephony, recall, split views and team coordination.
Keep existing organization Ask/Deny rules, person isolation and sensitive
paths. No invented admin gate or extra approval within a person's environment.
Shipping/deployment, ConnectWise writes and messages to third parties retain
JC's explicit GO requirement. Tests use disposable data and synthetic people.
