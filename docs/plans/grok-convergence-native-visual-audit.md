# Native visual comparison, in progress

Date: 2026-10-31. This records opened applications, separately from source,
documentation and galleries. It does not close lots 5 or 6.

## Applications actually opened

| Application | Platform / version | Environment |
| --- | --- | --- |
| Grok Bot | macOS, 0.78.1 | Installed native app. A separate fresh profile reached Sign in; the existing signed-in window supplied the reference navigation and artifact views. |
| Sagax | macOS, 0.8.23 | Installed native app, separate user-data profile and temporary data directory, separate server and debugging ports. This is the installed baseline, not the integrated working branch. |
| Sagax | iOS Simulator, 0.8.23 (100) | Native app built from the first-lot checkout, opened in demo mode with synthetic data. iPhone 17 Pro simulator, iOS 27.0, 402 x 874 points. |
| Grok Bot | iOS | Not yet opened. Absent from the accessible simulator; iPhone Mirroring reports Timed Out. Physical-device access is pending. |

The simulator initially contained Sagax 0.8.5 (81). It was replaced with the
already-built 0.8.23 (100) before continuing current iOS Page qualification.
Earlier captures of 0.8.5 are historical only. A responsive browser capture is
never counted as opening either native iOS application.

## Observations and remaining checks

| Surface | Actual observation | Consequence / remaining evidence |
| --- | --- | --- |
| macOS navigation | Both native apps expose sidebar conversations, search, creation, bot header and composer. Grok has a separate Details / Library / Computer pane. | Preserve Sagax identity, themes, primary bot and richer navigation. Same-viewport and narrow-pane integrated captures remain. |
| Composer | Grok's opened action menu contains Attach files and Teach a task, with separate dictation and voice controls. Sagax exposes attachment and voice controls plus additional actions. | Keep the common attachment path discoverable and preserve useful Sagax actions. Busy send, failure, retry and keyboard behavior require the isolated integrated fixture. |
| Files | Grok Library and a Markdown file preview were opened; the preview exposes download and close. | Integrated large-file download/playback/progress/cancel/retry qualification is still lot 4. Opening a file preview is not proof of upload limits. |
| HTML Pages | Two existing interactive HTML artifacts were opened from Grok Library. Each filled the main area beside the sidebar, with close/title/share at the top and a floating composer below. Focusing Prompt did not reveal a transcript pane. | Do not infer an always-visible side chat from documentation alone. Trace Page kind, state and feature conditions before choosing the default. This observation does not prove every Grok Page kind has the same layout. |
| Page placeholder | In those two Grok artifact views, the placeholder remained Message followed by the bot's name. Current Sagax native iOS demo Page did the same. | The bundled Message about page-title string exists, but its activation condition remains to be traced. Its presence alone is not runtime evidence. |
| Routines | Grok Details displayed active and paused routine rows. | Preserve Sagax's advanced schedule/trigger/run controls. Actual integrated routine navigation and lifecycle checks remain. |
| Permissions | Grok's native Permissions settings were opened: Auto-Review, Always Ask and Allow without Asking rule groups. | Retain explicit Sagax organization Ask/Deny rules and personal autonomy. A settings capture is not proof that a live approval executes correctly. |
| Settings | Native Grok General, Computer and Permissions views opened. Sagax Account settings opened, with separate provider/model/voice, appearance and installation navigation. | Preserve Sagax's multiple providers, local models, self-hosting and personal settings. Do not remove them to match the shorter Grok menu. |
| iOS conversation | Native Sagax demo navigation, chat, composer action menu and bot panel were opened. | Current-build rechecks, keyboard/focus, light/dark, French and real connected account flows remain. |
| iOS Page | Current native Sagax demo Page and Share sheet opened. Page is full screen above the retained chat, with floating composer and close/title/menu/share controls. | Verify close/scroll restoration, context at send, versions and sharing in the integrated build. Grok native iOS comparison is still unavailable. |
| Skills/plugins | Grok Teach a task entry and Sagax's available capability surfaces identified. | Full native skill/plugin flows remain to be opened and compared. Source and delivery tests do not replace this check. |

Reference macOS window geometry was 1338 x 809 points for Grok and
1100 x 780 points for the initial isolated Sagax window. These are initial
observations, not a matched-viewport pixel comparison. The integrated pass
must align viewport, Page kind, task state and theme before measuring layout.

## Handling evidence

Native controls were inspected through macOS Accessibility and simulator AXe;
the isolated Sagax Electron renderer also used its own debugging port. Native
window and simulator screenshots were inspected. Reference screenshots with
account content stay in a private temporary directory, located by the ignored
`.omb-scratch/work/visual-apps.json` manifest. No account screenshots, messages,
artifact content, credentials or private titles belong in this repository.

The UI worker received the observed HTML Page behavior before integration and
must reconcile it with the documented side-chat behavior. Independent review
also requires real ChatView/Composer fixture evidence for container sizing,
split views, exchange-sheet containment, live version-card refresh, focus,
scroll restoration and the context actually sent.

Synthetic native iOS baseline captures can be reviewed in
[`../screenshots/grok-convergence-native/`](../screenshots/grok-convergence-native/README.md).
The current demo's Library actually displayed a load failure. This is assigned
to an isolated native fixture worker, alongside checking the new upload
protocol in the demo. The macOS reference also opened successfully at 700 x
809 points, automatically collapsing its sidebar to icons; its original
1338 x 809 geometry was restored. The isolated Sagax Electron window was
resized to the same 1338 x 809 CSS viewport for subsequent comparisons.

Still open: Grok native iOS access, the full surface matrix on current integrated
builds, physical iPhone/Watch checks, bilingual real voice, matched task corpus
and comparative p50/p95/lost/duplicate/recovery measurements.
