// The guard tests: one list, read by both gates. verify:merge runs it as its
// second stage; scripts/fast-gate.sh runs it on every lot through the
// "guard-tests" line of .fast-gate (#3509), so a guard a merge breaks shows
// on the next lot whatever files that lot touches.
//
//   node scripts/verify/release/guard-tests.mjs   prints the files that exist,
//                                                 one per line, but the
//                                                 source-text tests
//   node scripts/verify/release/guard-tests.mjs --source-text
//                                                 prints the source-text
//                                                 tests that exist
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The UI guards that scan the whole of src or the shared stylesheet: motion
 * tokens, touch and keyboard reveal of hover actions, window drag regions,
 * settings placement and contract, theme colour tokens, faded and focused
 * text, the guided tour, modal use, the model picker's one menu and the
 * mascots drawn in every surface (#4131). */
export const UI_GUARD_TESTS = [
  "src/lib/motion.test.ts",
  "src/components/touch-actions.test.ts",
  "src/components/window-drag.layout.test.ts",
  "src/components/settings/settingsPlacement.test.ts",
  "src/components/settings/settings-contract.test.ts",
  "src/components/ModelPicker.single-menu.test.ts",
  "src/components/floating-bots/mascots.test.ts",
  "src/lib/color-utilities.test.ts",
  "src/lib/faded-text.test.ts",
  "src/lib/field-focus.test.ts",
  "src/lib/guided-tour.test.ts",
  "src/lib/modal-usage.guard.test.ts",
];

/** The tests that read the app's sources or its locale catalogs as text
 * (readFileSync, readdirSync or a walk over src/, src/locales/*.json,
 * ios/App/Localizable.xcstrings): the import graph of scripts/fast-gate.sh
 * does not link a file read as text, so a lot that changed what they read
 * left eight of them red on the 0.8.100 release commit (#4186). They read
 * src/, the catalogs, the model providers docs page and two scripts/testing
 * files, so the fast gate runs them on a lot that touches one of those (the
 * "source-text" line of .fast-gate); verify:merge runs them
 * with the other guards. A file with a known failure is not listed (a guard
 * is fixed, never listed): src/components/ChatErrorBanner.test.ts, src/components/lazy-screens.test.ts,
 * src/components/skin-fx/skin-fx.test.ts and src/lib/{bubble-colors,
 * native-controls-scheme,sidebar-motion,switch-colors}.test.ts join when
 * their entries leave scripts/testing/known-failures.json. */
export const SOURCE_TEXT_TESTS = [
  "electron/skin-overlay.test.mjs",
  // reads the English catalog for the Connect Apps name since #4255
  "scripts/testing/compose-flow.test.ts",
  "scripts/testing/ui-click.test.ts",
  "server/model-providers-docs.test.ts",
  "shared/approval-describe.test.ts",
  "src/components/AboutDialog.test.ts",
  "src/components/achievements/achievements-ui.test.ts",
  "src/components/bot-profile/BotProfilePage.dom.test.ts",
  "src/components/bot-settings/ActivitySection.test.ts",
  "src/components/bot-settings/BotNameTitleStack.dom.test.ts",
  "src/components/bot-settings/CodeBranchList.test.ts",
  "src/components/bot-settings/PermissionsSection.rows.test.ts",
  "src/components/bot-settings/RoutinesSection.test.ts",
  "src/components/bot-settings/SuggestionsSection.test.ts",
  "src/components/BotContextMenu.model.test.ts",
  "src/components/BotPanel.frame.layout.test.ts",
  "src/components/BotSettingsDialog.mascot-size.test.ts",
  "src/components/BotSettingsDialog.remote-hosts.test.ts",
  "src/components/bunbu.test.ts",
  "src/components/chat-dir-auto.test.ts",
  "src/components/ChatEdgeFade.test.ts",
  "src/components/ChatMarkdown.test.ts",
  "src/components/Composer.grok.test.ts",
  "src/components/ComposerControls.look.test.ts",
  "src/components/computer/ComputerMoreMenu.test.ts",
  "src/components/ConversationTurnLimit.test.ts",
  "src/components/DialogLayer.test.ts",
  "src/components/GroupPanel.parity.test.ts",
  "src/components/InspectorPanel.i18n.dom.test.ts",
  "src/components/ios-desktop-tokens.test.ts",
  "src/components/ios-desktop-wording.test.ts",
  // #4305: the phone's trigger kinds and sources against the desktop's
  "src/components/ios-trigger-parity.test.ts",
  "src/components/LimitResetContinue.dom.test.ts",
  "src/components/list-virtualization.test.ts",
  "src/components/MentionTextarea.test.ts",
  "src/components/MenuMotion.test.ts",
  "src/components/MessageBar.test.ts",
  "src/components/plugins/ConnectAppsView.test.ts",
  "src/components/provider-marks.test.ts",
  "src/components/ProviderIcons.deepseek.test.ts",
  "src/components/PulsatrixMark.test.ts",
  "src/components/RawMarkdownToggle.test.ts",
  "src/components/remote-desktop-panel.test.ts",
  "src/components/resize-handles.test.ts",
  "src/components/retro-assistant/Trombi.test.ts",
  "src/components/retro98/RetroChrome.test.ts",
  "src/components/RichTable.fit.test.ts",
  "src/components/RightRail.dom.test.ts",
  "src/components/RoutineCalendarPage.test.ts",
  "src/components/routines/UpcomingPanel.test.ts",
  "src/components/RoutineScheduleNote.test.ts",
  "src/components/settings/toggle-consumers.test.ts",
  "src/components/shape-avatar.test.ts",
  "src/components/sidebar-hover-intent.test.ts",
  "src/components/Sidebar.edit-bot.test.ts",
  "src/components/Sidebar.head.layout.test.ts",
  "src/components/Sidebar.header.test.ts",
  "src/components/SidebarFoot.test.ts",
  "src/components/SidebarPlaces.test.ts",
  // compiles src/styles.css for the popover measures
  "src/components/SidebarPopoverMenu.measures.test.ts",
  "src/components/SidebarProfileMenu.focus.test.ts",
  "src/components/SidebarProfileMenu.footer.test.ts",
  "src/components/SidebarProfileMenu.test.ts",
  "src/components/SidebarSectionHeader.test.ts",
  "src/components/TurnPresence.test.ts",
  // reads ChatViewBanners.tsx, which it does not import
  "src/components/TurnTimingLine.test.ts",
  "src/components/UpdateBanner.test.ts",
  "src/components/voice-mode/VoiceModeBar.layout.test.ts",
  "src/components/voice-mode/VoiceModeBar.test.ts",
  "src/components/widget/WidgetMessage.test.ts",
  "src/components/window-drag-regions.test.ts",
  "src/gallery/gallery-fr-datasets.test.ts",
  // reads today-box.tsx and today-box.html, which it does not import
  "src/gallery/today-box.test.ts",
  "src/lib/bot-identity.test.ts",
  "src/lib/bubble-bot-accent.test.ts",
  "src/lib/control-focus.test.ts",
  "src/lib/crisp-rendering.test.ts",
  "src/lib/floating-bots.test.ts",
  "src/lib/fonts.test.ts",
  "src/lib/frame-gate.test.ts",
  "src/lib/glass-surface.test.ts",
  "src/lib/i18n.test.ts",
  "src/lib/ios-skin-variants-export.test.ts",
  "src/lib/keyboard-shortcuts.test.ts",
  "src/lib/mascot-shadow.test.ts",
  "src/lib/midnight-skin.test.ts",
  "src/lib/open-bot-profile.test.ts",
  "src/lib/owl/owl-motion-css.test.ts",
  "src/lib/popover-contrast.test.ts",
  "src/lib/retro98.test.ts",
  "src/lib/shell-parity.test.ts",
  "src/lib/simple-mode-connect-apps.test.ts",
  "src/lib/skin-families.test.ts",
  "src/lib/skins.test.ts",
  "src/lib/status-tones.test.ts",
  "src/lib/topbar-parity.test.ts",
  "src/lib/user-bubble-tone.test.ts",
  "src/lib/voice-mode/call-mark.test.ts",
  "src/lib/voice-mode/progress.test.ts",
  "src/locales/always-allow-fr.test.ts",
  "src/locales/words.test.ts",
  "src/state/routines-one-place.test.ts",
];

/** Tests that hold main to a line: a key nothing reads, a route without a
 * policy row, a golden or a budget. They fail for the PR that merged last,
 * so every PR runs them. */
export const GUARD_TESTS = [
  "scripts/testing/index-route-ratchet.test.ts",
  // #2086: JC product rules (unified chat, Always allow, no unrequested caution, fr dashes/UUIDs)
  // also #2081 / #2096 / #2098 / #2106 chat rules; #2091 Always allow / settings-driven guards
  "scripts/testing/jc-rules.guard.test.ts",
  "scripts/tool-policy/tool-policy-coverage.test.ts",
  "scripts/self-knowledge/knowledge.test.ts",
  // a docs site page and its generated repository copy (scripts/docs-copies.mjs)
  "scripts/docs-copies.test.mjs",
  "src/locales/unused-keys.test.ts",
  "src/locales/data-keys.test.ts",
  "src/lib/copy-text.guard.test.ts",
  "src/lib/view-transitions.test.ts",
  "src/lib/bundled-release-notes.test.ts",
  "src/components/dialogs-close.test.ts",
  // #3581: chat rows in the application's look, no quiet mode switch
  "src/components/chat-rows.guard.test.ts",
  // #3681: an ask that waits is drawn once, on the pinned card over the box;
  // the conversation mounted with a waiting question and approval counts one each
  "src/components/ChatView.pinned-once.dom.test.ts",
  "server/admission-golden.test.ts",
  "server/drain-coalescing-golden.test.ts",
  "server/drivers/agents-catalog-wire.test.ts",
  "server/drivers/agents-proxy.test.ts",
  "server/drivers/tool-scope-coverage.test.ts",
  // #1905: every approval or choice card reads the one Full access decision
  "server/approvals/full-access-gate.guard.test.ts",
  // #1386: docs/ media must be cited; no large GIF; PR proofs on pr-assets
  "scripts/testing/docs-media.guard.test.ts",
  // #2085 / #2125 (Refs #2086): the bot panel has only Activity and Library (no Roles tab)
  "src/components/bot-settings/panel-tabs.guard.test.ts",
  // #3292: AGENTS.md stays rules only (size ceiling, no dated journal section)
  "scripts/testing/agents-md.guard.test.ts",
  // #3538: two files that went red on main unseen, since only a lot that
  // touched them ran them: routine effort at turn admission (#2038, red since
  // the connector plan of #3368) and the agent-to-agent API on a real server
  // with the reach rule of 2026-11-09 (#3264). About 15 s together.
  "server/turns/start-turn-prepare-admit.test.ts",
  "server/agent-api.e2e.test.ts",
  // #4131: the UI guards that read the whole of src (or the shared
  // stylesheet) rather than one component went red on main after three UI
  // lots, each of which ran only the tests beside its own files. Static
  // scans, about 2 s each and some 25 s together on a busy machine.
  ...UI_GUARD_TESTS,
  // #4186: scans every tracked file of server, src, shared, scripts and
  // electron for machine-bound paths, so it runs on every lot.
  "scripts/stability/portable-paths.test.ts",
  ...SOURCE_TEXT_TESTS,
];

/** The guard tests present under `root` (a lot may predate one of them). */
export function existingGuardTests(root) {
  return GUARD_TESTS.filter((file) => existsSync(join(root, file)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
  const sourceText = process.argv.includes("--source-text");
  const files = sourceText
    ? SOURCE_TEXT_TESTS.filter((file) => existsSync(join(root, file)))
    : existingGuardTests(root).filter((file) => !SOURCE_TEXT_TESTS.includes(file));
  if (files.length) console.log(files.join("\n"));
}
