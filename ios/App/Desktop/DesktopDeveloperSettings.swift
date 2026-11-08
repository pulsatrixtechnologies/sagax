import SwiftUI

/// Settings > Developer on iPad (#2729), in DeveloperSettings.tsx's order:
/// Conversation, Bots, event log cleanup, Interface, the release links,
/// Experimental features, Context pods. What the desktop offers there and
/// iOS cannot do (turn timing, usage meter, MCP timeout, loop guard,
/// telemetry, logs and diagnostics, Claude Code, the Grok bridge, the GitHub
/// app) is left out rather than greyed.
struct DesktopDeveloperSettings: View {
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var shell: DesktopShellModel
    @EnvironmentObject private var model: DesktopSettingsModel
    @ObservedObject private var mode = DesktopInterfaceMode.shared
    @AppStorage(RunCardPreference.key) private var showRunCard = true
    @AppStorage(DesktopInspectorButton.key) private var showInspector = false
    @AppStorage(DevPodsPrefs.enabled) private var devPods = false

    var body: some View {
        DesktopSettingsGroup(Text("Conversation"), identifier: "developerConversation") {
            DesktopCompactRow(Text("This run"), identifier: "runCard") {
                DesktopSwitch(isOn: showRunCard, label: Text("Show the run card"), identifier: "desktop-settings.run-card") {
                    showRunCard.toggle()
                }
            }
            // a display preference: an organization member opens the
            // Inspector on the bots they own (2026-10-26)
            if session.surfaceGate.allows(.inspector) || session.surfaceGate.isOrgMemberSession {
                DesktopCompactRow(Text("Inspector button"), identifier: "inspectorButton") {
                    DesktopSwitch(isOn: showInspector, label: Text("Show the Inspector button"), identifier: "desktop-settings.inspector-button") {
                        showInspector.toggle()
                    }
                }
            }
        }
        if model.config != nil {
            DesktopSettingsGroup(Text("Bots"), plain: true, identifier: "developerBots") {
                DesktopGroupTurnsCard()
            }
            DesktopEventLogCleanupCard()
        }
        DesktopSettingsGroup(Text("Interface"), identifier: "generalInterface") {
            DesktopDescribedRow(Text("Advanced mode"), description: Text("Show technical controls. Saved choices stay either way."), identifier: "advancedMode") {
                DesktopSwitch(isOn: mode.advanced, label: Text("Advanced mode"), identifier: "desktop-settings.advanced-mode") {
                    mode.set(!mode.advanced, session: session)
                }
            }
        }
        DesktopSettingsGroup(identifier: "updatesLinks") {
            DesktopLinkRow(label: Text("Release notes"), identifier: "desktop-settings.release-notes") {
                shell.modal = .releaseNotes
            }
            DesktopLinkRow(label: Text("About Sagax"), identifier: "desktop-settings.developer.about") {
                shell.modal = .about
            }
        }
        DesktopExperimentalSettings()
        DesktopSettingsGroup(Text("Context pods"), identifier: "developerDevPods") {
            DesktopDescribedRow(Text(verbatim: DevPodsStrings.settingTitle),
                                description: Text(verbatim: DevPodsStrings.settingDetail),
                                identifier: "devPods") {
                DesktopSwitch(isOn: devPods, label: Text("Turn on context pods for development"),
                              identifier: "desktop-settings.dev-pods") { devPods.toggle() }
            }
        }
    }
}
