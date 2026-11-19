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
//   node scripts/verify/release/guard-tests.mjs --source-text --touched
//                                                 the same, only when a file
//                                                 of $FAST_GATE_FILES is one
//                                                 they read (SOURCE_TEXT_READS)
//   node scripts/verify/release/guard-tests.mjs --catalog --touched
//                                                 the catalog tests (budget,
//                                                 loaded part, wire, families)
//                                                 a file of
//                                                 $FAST_GATE_FILES that feeds
//                                                 the tool list needs, less
//                                                 the guard tests, or one line
//                                                 "skip: <why>"
//   node scripts/verify/release/guard-tests.mjs --parity --touched
//                                                 the parity tests a side of
//                                                 which $FAST_GATE_FILES
//                                                 touches, less those the
//                                                 source-text line runs, or
//                                                 one line "skip: <why>"
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, posix, resolve } from "node:path";
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
 * native-controls-scheme,switch-colors}.test.ts join when
 * their entries leave scripts/testing/known-failures.json. */
export const SOURCE_TEXT_TESTS = [
  "electron/skin-overlay.test.mjs",
  // reads the English catalog for the Connect Apps name since #4255
  "scripts/testing/compose-flow.test.ts",
  // #4316: every hook a real-renderer smoke selects is still written in src/
  "scripts/testing/renderer-smoke-hooks.test.ts",
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
  // the Routines table: its columns by class (RoutineTable.layout.test) and on the rendered DOM of the Overview, plain
  // and grouped (RoutineTable.layout.dom.test, which a change to RoutinesOverview.tsx or RoutineGroupedTable.tsx alone runs)
  "src/components/routines/RoutineTable.layout.test.ts",
  "src/components/routines/RoutineTable.layout.dom.test.ts",
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
  // #5068: reads src/styles.css and components as text; green again, its entry left the known failures
  "src/lib/sidebar-motion.test.ts",
  "src/lib/simple-mode-connect-apps.test.ts",
  "src/lib/skin-families.test.ts",
  "src/lib/skins.test.ts",
  "src/lib/status-tones.test.ts",
  "src/lib/topbar-parity.test.ts",
  // the trend bars' result colours, in every skin of the stylesheet
  "src/lib/trend-colors.test.ts",
  "src/lib/user-bubble-tone.test.ts",
  "src/lib/voice-mode/call-mark.test.ts",
  "src/lib/voice-mode/progress.test.ts",
  "src/locales/always-allow-fr.test.ts",
  "src/locales/words.test.ts",
  "src/state/routines-one-place.test.ts",
];

/** What the source-text tests read as text: a lot that touches one of these
 * runs them all (the "source-text" line of .fast-gate). src/, the phone's
 * catalog, the iPad wording map, the model providers docs page and two
 * scripts/testing files. */
export const SOURCE_TEXT_READS = /^(src\/|ios\/App\/Localizable\.xcstrings$|ios\/parity\/desktop-wording\.json$|apps\/docs\/content\/docs\/providers\/model-providers\.mdx$|scripts\/testing\/(compose-flow|bot-tools-ui\.e2e\.test)\.ts$)/;

/** The parity pairs: a text-level test that holds one side to the other, and
 * the files of both sides it reads. A lot that touches either side runs the
 * test (the "parity-pairs" line of .fast-gate; the source-text line runs it
 * instead when the lot touches a file the source-text tests read). A desktop
 * change already ran these tests through the source-text line; the pairs add
 * the other side: a lot that touches only the phone's, the tablet's or a
 * smoke's files runs the pair's test too (#4305, #4320, #4316), and the
 * renderer smokes' hooks get a text-level test of their own (they had none
 * before a merge). */
export const PARITY_PAIRS = [
  // the phone's trigger kinds and sources against the desktop's (#4305, #4320)
  { test: "src/components/ios-trigger-parity.test.ts", reads: [/^src\/locales\/en\.json$/, /^shared\/trigger-sources\.ts$/, /^ios\/Sources\/CompanionCore\/DesktopBotPanel\.swift$/] },
  // the phone and tablet wording against the desktop's catalogs and shortcuts
  { test: "src/components/ios-desktop-wording.test.ts", reads: [/^src\/locales\/(en|fr)\.json$/, /^src\/lib\/keyboard-shortcuts\.ts$/, /^ios\/parity\/desktop-wording\.json$/, /^ios\/App\/Localizable\.xcstrings$/, /^ios\/App\/Desktop\/DesktopShortcuts\.swift$/] },
  // the phone's theme and switch tokens against the desktop's stylesheets
  { test: "src/components/ios-desktop-tokens.test.ts", reads: [/^src\/styles\.css$/, /^src\/styles\/skin-switch\.css$/, /^ios\/App\/Desktop\/(DesktopTheme|DesktopSettingsKit)\.swift$/] },
  // the hooks the real-renderer smokes select against the app's sources
  { test: "scripts/testing/renderer-smoke-hooks.test.ts", reads: [/^src\//, /^scripts\/testing\/[^/]+\.e2e\.test\.ts$/] },
];

/** The parity tests a lot needs, from its touched files: those a side of
 * which it touches, less those the source-text line already runs for it
 * (`sourceText`), with the reason when none is left. */
export function parityPlan(files) {
  const sourceText = files.some((file) => SOURCE_TEXT_READS.test(file));
  const touched = PARITY_PAIRS.filter((pair) => files.some((file) => pair.reads.some((side) => side.test(file)))).map((pair) => pair.test);
  const tests = touched.filter((test) => !(sourceText && SOURCE_TEXT_TESTS.includes(test)));
  const skip = tests.length ? "" : touched.length ? "source-text runs the parity tests of this lot" : "no side of a parity pair touched";
  return { tests, sourceText, skip };
}

/** #4518: the tests that measure and pin the tool list a bot is sent on every
 * turn: its ceiling, its bytes, the part a Claude turn loads up front and the
 * listing by family. The budget test stayed red on main for a week, the
 * loaded part and the family goldens too: the files that add tool text (a
 * definition, a shared schema, a profile) reach them only through
 * agents-catalog.ts, so a lot that grew a description never ran them. */
export const CATALOG_TESTS = [
  // pins what the widget tools' descriptions tell the bot (red since #3281)
  "server/drivers/agents-call-cards.test.ts",
  "server/drivers/agents-catalog-budget.test.ts",
  "server/drivers/agents-catalog-deferred.test.ts",
  "server/drivers/agents-catalog-wire.test.ts",
  "server/drivers/agents-merged.test.ts",
];

/** The roots of the tool list: the catalog and its profiles, the groups and
 * budget module, and the agents proxy that serves the list (tools/list). */
export const CATALOG_ROOTS = ["server/drivers/agents-catalog.ts", "server/drivers/agents-catalog-budget.ts", "server/drivers/agents-proxy.ts"];

/** The checked-in goldens of the list: a lot that edits one by hand runs the
 * tests that pin it. */
export const CATALOG_GOLDENS = /^server\/drivers\/agents-catalog-goldens\//;

const TYPE_ONLY_IMPORT = /\b(?:import|export)\s+type\s+[^;]*?\bfrom\s*["'][^"']+["']/g;
const IMPORT_FROM = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g;
const SOURCE_SUFFIXES = ["", ".ts", ".tsx", ".mts", ".mjs", ".js", "/index.ts", "/index.mjs", "/index.js"];

/** Every file that feeds the tool list: the catalog roots and what they
 * import, transitively (relative imports; a type-only import sends no byte). */
export function catalogFeeders(root) {
  const seen = new Set();
  const queue = CATALOG_ROOTS.filter((file) => existsSync(join(root, file)));
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    let text;
    try { text = readFileSync(join(root, file), "utf8"); } catch { continue; }
    for (const match of text.replace(TYPE_ONLY_IMPORT, "").matchAll(IMPORT_FROM)) {
      if (!match[1].startsWith(".")) continue;
      const target = posix.normalize(posix.join(posix.dirname(file), match[1]));
      const found = SOURCE_SUFFIXES.map((suffix) => target + suffix).find((candidate) => {
        try { return statSync(join(root, candidate)).isFile(); } catch { return false; }
      });
      if (found && !seen.has(found)) queue.push(found);
    }
  }
  return seen;
}

/** The catalog tests a lot needs: both when it touches a file that feeds the
 * tool list or one of the tests, none otherwise, with the reason. `run` is
 * the part the guard-tests line does not already run on every lot. */
export function catalogPlan(files, root) {
  const feeders = catalogFeeders(root);
  const touched = files.some((file) => feeders.has(file) || CATALOG_TESTS.includes(file) || CATALOG_GOLDENS.test(file));
  const tests = touched ? CATALOG_TESTS.filter((file) => existsSync(join(root, file))) : [];
  const run = tests.filter((file) => !GUARD_TESTS.includes(file));
  const skip = run.length ? "" : tests.length ? "the guard tests run the catalog tests of this lot" : "no file of the tool list touched";
  return { tests, run, skip };
}

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
  const touched = (process.env.FAST_GATE_FILES ?? "").split("\n").filter(Boolean);
  if (process.argv.includes("--catalog")) {
    const { run, skip } = catalogPlan(touched, root);
    console.log(run.length ? run.join("\n") : `skip: ${skip}`);
  } else if (process.argv.includes("--parity")) {
    const { tests, skip } = parityPlan(touched);
    const present = tests.filter((file) => existsSync(join(root, file)));
    console.log(present.length ? present.join("\n") : `skip: ${skip || "the parity tests of this lot are gone"}`);
  } else if (sourceText && process.argv.includes("--touched") && !touched.some((file) => SOURCE_TEXT_READS.test(file))) {
    // no file the source-text tests read: nothing to print
  } else {
    const files = sourceText
      ? SOURCE_TEXT_TESTS.filter((file) => existsSync(join(root, file)))
      : existingGuardTests(root).filter((file) => !SOURCE_TEXT_TESTS.includes(file));
    if (files.length) console.log(files.join("\n"));
  }
}
