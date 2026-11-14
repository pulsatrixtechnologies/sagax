// Rows the Settings tree draws (feedback, links outside the app, the
// system notification switch), Settings > General (quick replies and the
// call voice, kept for old links) and
// Settings > Experimental (SettingsModal.tsx "experimental": the
// installation's early features, an admin pairing only), plus the picker
// rows Appearance gains (list density, activity, home chrome).
import CompanionCore
import MessageUI
import SwiftUI
import UIKit

/// Settings > General: what the root does not carry (#518 folded the
/// phone's settings here; the root now holds them again, the reference design iOS 1.14).
struct GeneralSettingsView: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var navigator: SettingsNavigator

    var body: some View {
        SettingsPage(title: "General") {
            SettingsSectionLabel(text: "Chat")
            SettingsCard {
                SettingsRow(title: "Quick Replies", accessory: .chevron, identifier: "settings-quick-replies") { navigator.sheet = .quickReplies }
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                SettingsRow(title: "Call voice", accessory: .chevron, identifier: "settings-walkie-voice") { navigator.sheet = .walkieVoice }
            }
            SettingsSpacer(40)
        }
    }
}

/// The Send Feedback row, in its card or in the Help card of the root.
struct SettingsFeedbackRow: View {
    @Environment(\.themePalette) var themePalette
    var height: CGFloat? = 44.67
    @State private var composingMail = false

    var body: some View {
        SettingsRow(title: "Send Feedback", accessory: .chevron, identifier: "settings-feedback") { sendFeedback() }
            .sheet(isPresented: $composingMail) {
                MailComposeSheet(recipient: SettingsLinks.supportEmail, subject: feedbackSubject, body: feedbackBody) {
                    composingMail = false
                }
                .ignoresSafeArea()
            }
    }

    private var feedbackSubject: String { String(localized: "Sagax feedback") }

    private var feedbackBody: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?"
        return "\n\n—\nSagax iOS \(version) (\(build)), iOS \(UIDevice.current.systemVersion)"
    }

    private func sendFeedback() {
        if MFMailComposeViewController.canSendMail() {
            composingMail = true
            return
        }
        var components = URLComponents()
        components.scheme = "mailto"
        components.path = SettingsLinks.supportEmail
        components.queryItems = [URLQueryItem(name: "subject", value: feedbackSubject), URLQueryItem(name: "body", value: feedbackBody)]
        if let url = components.url { UIApplication.shared.open(url) }
    }
}

/// A page outside the app, opened in Safari over Settings.
struct SettingsLinkRow: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.locale) private var locale
    @AppStorage(PrefKey.language) private var language = AppLanguage.system.rawValue
    let title: LocalizedStringKey
    let identifier: String
    let url: (_ french: Bool) -> URL
    @State private var link: URL?

    private var french: Bool {
        (AppLanguage.resolved(language).locale ?? locale).language.languageCode?.identifier == "fr"
    }

    var body: some View {
        SettingsRow(title: title, accessory: .external, identifier: identifier) { link = url(french) }
            .sheet(item: Binding(get: { link.map(IdentifiedURL.init) }, set: { link = $0?.url })) { item in
                SafariSheet(url: item.url).ignoresSafeArea()
            }
    }
}

/// The system's notification permission as a switch: on asks iOS, off
/// opens the iOS Settings app (only the person can turn it off).
struct SystemNotificationsRow: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @State private var enabling = false

    var body: some View {
        SettingsRow(
            title: "Allow notifications",
            accessory: .toggle(Binding(get: { Self.isOn(session) }, set: { setNotifications($0) })),
            identifier: "settings-notifications-system"
        )
        .task { await session.refreshNotificationAuthorization() }
    }

    static func isOn(_ session: Session) -> Bool {
        switch session.notificationAuthorization {
        case .authorized, .provisional, .ephemeral: true
        default: false
        }
    }

    private func setNotifications(_ on: Bool) {
        if on {
            guard !enabling else { return }
            enabling = true
            Task {
                await session.enableNotifications()
                enabling = false
            }
        } else if let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
        }
    }
}

// MARK: - Experimental

/// Settings > Developer on iPhone (#2729), in the desktop's order
/// (DeveloperSettings.tsx): Conversation, Bots (group turns, MCP calls),
/// Loop guard, OpenTelemetry, Event log cleanup, Interface, Experimental
/// features, Context pods, then the release links. The server rows show only
/// to someone who may edit the config (canEditConfig), each experimental
/// switch only to someone who may flip it; what a person may not change is
/// hidden, never greyed. What iOS cannot do (turn timing, usage meter, logs,
/// Claude Code, the Grok bridge, the GitHub app, the Inspector button the
/// iPhone does not draw) is left out.
struct ExperimentalSettingsView: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var navigator: SettingsNavigator
    @ObservedObject private var mode = DesktopInterfaceMode.shared
    @AppStorage(RunCardPreference.key) private var showRunCard = true
    /// Development context pods: this device only, off by default.
    @AppStorage(DevPodsPrefs.enabled) private var devPods = false
    @State private var config: DesktopSettingsConfig?
    /// `useServerFeature("memberPersonSettings")`: the descriptor's list,
    /// then what a personal switch's save showed.
    @State private var listedFeatures: [String]?
    @State private var personalEvidence: Bool?
    @State private var saving = false
    @State private var error: String?
    @State private var showingReleaseNotes = false
    @State private var showingTelemetry = false
    /// The last length picked while cleanup was on, offered again when it is
    /// turned back on (the desktop keeps the field's value the same way).
    @State private var lastDays = DesktopConfigChange.defaultRetentionDays
    @State private var lastCapBytes = Int(DesktopConfigChange.defaultCapMiB * 1_048_576)

    /// The group-turn lengths offered, in minutes (the desktop takes any 1 to 1440).
    static let turnPresets = [1, 2, 5, 10, 15, 30, 60, 120]
    /// MCP call limits offered, in minutes (the desktop takes any 1 to 60).
    static let mcpPresets = [1, 2, 5, 10, 15, 20, 30, 45, 60]
    /// Event log ages offered, in days (the desktop takes any 1 to 3650).
    static let dayPresets = [1, 7, 14, 30, 60, 90, 180, 365]
    /// Event log sizes offered, in MiB (the desktop takes 0.25 to 4096 by quarters).
    static let capPresetsMiB: [Double] = [1, 5, 10, 25, 50, 100, 250, 500, 1_024]
    /// Tool steps before a skill review (the desktop takes any 3 to 100).
    static let reviewPresets = [3, 5, 10, 15, 20, 30, 50, 100]

    var body: some View {
        let served = ServerFeatureState.of("memberPersonSettings", listed: listedFeatures, evidence: personalEvidence)
        let rows = ExperimentalFeatureRow.shown(config, served: served)
        SettingsPage(title: "Developer") {
#if DEBUG
            // Parity captures: -paritySettingsRoute experimental -parityScrollEnd YES
            if ParityLaunch.current != nil, UserDefaults.standard.bool(forKey: "parityScrollEnd") {
                ScrollOffsetSetter(offset: 100_000)
            }
#endif
            SettingsSectionLabel(text: "Conversation")
            SettingsCard {
                SettingsRow(
                    title: "This run",
                    subtitle: "Show a list of the shell commands a bot ran for your current request. Turn it off to hide the card and its shortcut for saving the run as a skill.",
                    accessory: .toggle($showRunCard),
                    identifier: "settings.runCard"
                )
            }
            if let config, config.canEditConfig {
                serverSections(config)
            }
            SettingsSectionLabel(text: "Interface")
            SettingsCard {
                SettingsRow(
                    title: "Advanced mode",
                    subtitle: "Show technical controls. Saved choices stay either way.",
                    accessory: .toggle(Binding(get: { mode.advanced }, set: { mode.set($0, session: session) })),
                    identifier: "settings-developer.advancedMode"
                )
            }
            if let config, !rows.isEmpty {
                SettingsSectionLabel(text: LocalizedStringKey(stringLiteral: AppStrings.localized("Experimental features") + " · "
                    + String(format: AppStrings.localized("%@ of %@ on"), "\(rows.filter(\.on).count)", "\(rows.count)")))
                SettingsCard {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, feature in
                        if index > 0 { CardHairline(leadingInset: SettingsMetrics.rowInset) }
                        SettingsRow(
                            title: LocalizedStringKey(feature.title),
                            subtitle: feature.note,
                            accessory: .toggle(Binding(get: { feature.on }, set: { on in
                                if let change = config.experimentalChange(feature.key, on, served: served) { apply(change) }
                            })),
                            identifier: "settings-experimental.\(feature.key)"
                        )
                        .disabled(saving)
                        if feature.key == "skillAuthoring", feature.on, config.canSetSkillReview {
                            CardHairline(leadingInset: SettingsMetrics.rowInset)
                            presetRow("Review after this many tool steps",
                                      value: config.features?.skillReviewSteps ?? DesktopConfigChange.defaultReviewSteps,
                                      presets: Self.reviewPresets, text: { "\($0)" },
                                      identifier: "settings-experimental.skillReviewSteps") { apply(.skillReviewSteps($0)) }
                        }
                    }
                }
                SettingsFooter(text: "Early features may change while we test them. Each one says whether it starts on or off.")
            } else if let config, config.personalMissing(served) {
                // ExperimentalSettings.tsx `personalMissing`: an older
                // organization server without /api/me/experimental.
                SettingsFooter(text: "Available after the server update.")
                    .accessibilityIdentifier("settings-experimental.needsUpdate")
            }
            SettingsSectionLabel(text: "Context pods")
            SettingsCard {
                SettingsRow(
                    title: LocalizedStringKey(DevPodsStrings.settingTitle),
                    subtitle: DevPodsStrings.settingDetail,
                    accessory: .toggle($devPods),
                    identifier: "settings-experimental.devPods"
                )
            }
            SettingsCard {
                SettingsRow(title: "Release notes", accessory: .chevron, identifier: "settings-developer.releaseNotes") { showingReleaseNotes = true }
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                SettingsRow(title: "About Sagax", accessory: .chevron, identifier: "settings-developer.about") { navigator.push(.about) }
            }
            if let error {
                SettingsFooter(text: LocalizedStringKey(stringLiteral: error))
            }
            SettingsSpacer(40)
        }
        .navigationDestination(isPresented: $showingReleaseNotes) { ReleaseNotesPage() }
        .navigationDestination(isPresented: $showingTelemetry) { TelemetrySettingsPage() }
        .task(id: session.connection?.id) {
            guard let client = session.settingsClient else { return }
            async let environment = try? client.environment()
            do {
                let loaded = try await client.desktopSettingsConfig()
                config = loaded
                lastDays = loaded.threads?.eventLogRetentionDays ?? lastDays
                lastCapBytes = loaded.threads?.eventLogMaxBytes ?? lastCapBytes
            } catch { self.error = error.localizedDescription }
            listedFeatures = await environment?.capabilities?.features
        }
    }

    /// Bots, Loop guard, OpenTelemetry and Event log cleanup: the server's
    /// own settings, for someone who may edit the config.
    @ViewBuilder
    private func serverSections(_ config: DesktopSettingsConfig) -> some View {
        SettingsSectionLabel(text: "Bots")
        SettingsCard {
            presetRow("Group turns", subtitle: "Longest a bot may answer in a group. A conversation can set its own.",
                      value: config.rooms?.turnTimeoutMinutes ?? 5, presets: Self.turnPresets,
                      text: { String(localized: "\($0) min") },
                      identifier: "settings-developer.roomTurns") { apply(.roomTurnMinutes($0)) }
            CardHairline(leadingInset: SettingsMetrics.rowInset)
            presetRow("MCP calls", subtitle: "Longest a bot's MCP tool call may run.",
                      value: config.mcp?.callTimeoutMinutes ?? DesktopConfigChange.defaultMcpMinutes, presets: Self.mcpPresets,
                      text: { String(localized: "\($0) min") },
                      identifier: "settings-developer.mcpCalls") { apply(.mcpCallTimeout($0)) }
        }
        SettingsSectionLabel(text: "Loop guard")
        SettingsCard {
            SettingsRow(
                title: "Loop guard",
                subtitle: "Steer, then stop, when a shell command keeps failing the same way.",
                accessory: .toggle(Binding(get: { config.loopGuard?.enabled != false }, set: { apply(.loopGuard($0)) })),
                identifier: "settings-developer.loopGuard"
            )
            .disabled(saving)
        }
        SettingsSectionLabel(text: "OpenTelemetry")
        SettingsCard {
            SettingsRow(title: "Trace export", accessory: .chevron, identifier: "settings-developer.telemetry") { showingTelemetry = true }
        }
        let days = config.threads?.eventLogRetentionDays
        let cap = config.threads?.eventLogMaxBytes
        SettingsSectionLabel(text: "Event log cleanup")
        SettingsCard {
            SettingsRow(
                title: "Delete event logs after",
                subtitle: "Finished conversations only, never the conversations themselves.",
                accessory: .toggle(Binding(get: { days != nil }, set: { apply(.eventLogRetention($0 ? lastDays : nil)) })),
                identifier: "settings-developer.cleanup"
            )
            .disabled(saving)
            if let days {
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                presetRow("Days", value: days, presets: Self.dayPresets,
                          text: { "\($0) " + AppStrings.localized("days") },
                          identifier: "settings-developer.cleanupDays") { value in
                    lastDays = value
                    apply(.eventLogRetention(value))
                }
            }
            CardHairline(leadingInset: SettingsMetrics.rowInset)
            SettingsRow(
                title: "Trim each event log to",
                accessory: .toggle(Binding(get: { cap != nil }, set: { apply(.eventLogMaxBytes($0 ? lastCapBytes : nil)) })),
                identifier: "settings-developer.cleanupCap"
            )
            .disabled(saving)
            if let cap {
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                presetRow("Size", value: cap, presets: Self.capPresetsMiB.map { Int($0 * 1_048_576) },
                          text: { DesktopConfigChange.mibText($0) + " " + AppStrings.localized("MiB") },
                          identifier: "settings-developer.cleanupSize") { value in
                    lastCapBytes = value
                    apply(.eventLogMaxBytes(value))
                }
            }
        }
    }

    /// A number picked from a menu of presets, the current value among them.
    private func presetRow(_ title: LocalizedStringKey, subtitle: String? = nil, value: Int, presets: [Int],
                          text: @escaping (Int) -> String, identifier: String, set: @escaping (Int) -> Void) -> some View {
        Menu {
            Picker(selection: Binding(get: { value }, set: { if $0 != value { set($0) } })) {
                ForEach(Array(Set(presets + [value])).sorted(), id: \.self) { option in
                    Text(verbatim: text(option)).tag(option)
                }
            } label: { EmptyView() }
        } label: {
            SettingsRow(title: title, subtitle: subtitle, accessory: .valueChevron(text(value)))
        }
        .accessibilityIdentifier(identifier)
        .disabled(saving)
    }

    private func apply(_ change: DesktopConfigChange) {
        guard let client = session.settingsClient else { return }
        saving = true
        Task {
            defer { saving = false }
            do {
                config = try await client.updateDesktopSettings(change)
                DesktopSidebarFlags.shared.apply(config)
                if case .myFeature = change { personalEvidence = true }
                error = nil
            } catch {
                // featureMissingOnServer: no red error, the switches go and
                // the update note takes their place.
                if case .myFeature = change, ServerFeatureState.routeMissing(error) {
                    personalEvidence = false
                    return
                }
                self.error = error.localizedDescription
            }
        }
    }
}

/// Settings > Developer > OpenTelemetry on iPhone (TelemetrySettings.tsx):
/// the export state, the collector, the service name, the headers (values go
/// up once, never shown again), and Save / Send a test span / Turn off.
struct TelemetrySettingsPage: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @State private var view: TelemetrySettingsView?
    @State private var endpoint = ""
    @State private var serviceName = ""
    @State private var headers: [TelemetryHeaderDraft] = []
    @State private var dirtyHeaders = false
    @State private var busy = false
    @State private var note: (text: String, error: Bool)?

    var body: some View {
        let summary = view?.summary ?? TelemetrySettingsView().summary
        SettingsPage(title: "OpenTelemetry") {
            SettingsCard {
                SettingsRow(
                    title: "Trace export",
                    subtitle: String(format: AppStrings.localized(summary.format), arguments: summary.arguments),
                    accessory: .value(AppStrings.localized(view?.enabled == true ? "On" : "Off")),
                    identifier: "settings-telemetry.export"
                )
            }
            SettingsFooter(text: "Sends the server's traces (bot turns, model calls with tokens and cost, tool and MCP calls, sub-agents, routines) to an OTLP/HTTP collector, following the OpenTelemetry GenAI conventions. Usage statistics keep working without a collector.")
            SettingsSectionLabel(text: "Collector address")
            SettingsCard {
                PhoneSettingsField(text: $endpoint, prompt: "https://otel.example.org:4318", identifier: "settings-telemetry.endpoint", url: true)
                    .disabled(busy || view == nil)
            }
            SettingsFooter(text: "OTLP/HTTP base URL; /v1/traces is added.")
            SettingsSectionLabel(text: "Service name")
            SettingsCard {
                PhoneSettingsField(text: $serviceName, prompt: "sagax", identifier: "settings-telemetry.service")
                    .disabled(busy || view == nil)
            }
            SettingsFooter(text: "service.name of the traces; sagax when empty.")
            SettingsSectionLabel(text: "Headers")
            SettingsCard {
                ForEach($headers) { $row in
                    PhoneSettingsField(text: Binding(get: { row.name }, set: { row.name = $0; dirtyHeaders = true }),
                                       prompt: "Authorization", identifier: "settings-telemetry.header-name")
                        .disabled(busy || row.saved)
                    CardHairline(leadingInset: SettingsMetrics.rowInset)
                    PhoneSettingsField(text: Binding(get: { row.value }, set: { row.value = $0; dirtyHeaders = true }),
                                       prompt: AppStrings.localized(row.saved ? "Saved (type to replace)" : "Value"),
                                       identifier: "settings-telemetry.header-value", secure: true)
                        .disabled(busy)
                    CardHairline(leadingInset: SettingsMetrics.rowInset)
                    SettingsRow(title: "Remove", style: .destructive, identifier: "settings-telemetry.header-remove") {
                        headers.removeAll { $0.id == row.id }
                        dirtyHeaders = true
                    }
                    .disabled(busy)
                    CardHairline(leadingInset: 0)
                }
                SettingsRow(title: "Add a header", style: .action, identifier: "settings-telemetry.header-add") {
                    headers.append(TelemetryHeaderDraft())
                    dirtyHeaders = true
                }
                .disabled(busy || view == nil)
            }
            SettingsFooter(text: "An API key or a token for the collector. Values are never shown again.")
            SettingsCard {
                SettingsRow(title: "Save", style: .action, identifier: "settings-telemetry.save") { save() }
                    .disabled(busy || !canSave)
                    .opacity(busy || !canSave ? 0.5 : 1)
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                SettingsRow(title: "Send a test span", style: .action, identifier: "settings-telemetry.test") { test() }
                    .disabled(busy || !canTest)
                    .opacity(busy || !canTest ? 0.5 : 1)
                if view?.enabled == true {
                    CardHairline(leadingInset: SettingsMetrics.rowInset)
                    SettingsRow(title: "Turn off", style: .destructive, identifier: "settings-telemetry.off") { remove() }
                        .disabled(busy)
                }
            }
            if let note {
                Text(verbatim: note.text)
                    .font(Theme.Font.label)
                    .foregroundStyle(note.error ? Theme.danger : Theme.textTertiary)
                    .padding(.horizontal, SettingsMetrics.rowInset)
                    .padding(.top, 8)
                    .accessibilityIdentifier("settings-telemetry.note")
            }
            SettingsSpacer(40)
        }
        .task(id: session.connection?.id) { await load() }
    }

    private var changed: Bool {
        endpoint.trimmingCharacters(in: .whitespaces) != (view?.endpoint ?? "")
            || serviceName.trimmingCharacters(in: .whitespaces) != (view?.serviceName ?? "")
            || dirtyHeaders
    }
    private var canSave: Bool { view != nil && !endpoint.trimmingCharacters(in: .whitespaces).isEmpty && changed }
    private var canTest: Bool { view != nil && (!endpoint.trimmingCharacters(in: .whitespaces).isEmpty || view?.enabled == true) }

    private func apply(_ next: TelemetrySettingsView) {
        view = next
        endpoint = next.endpoint ?? ""
        serviceName = next.serviceName ?? ""
        headers = next.headerNames.map { TelemetryHeaderDraft(name: $0, saved: true) }
        dirtyHeaders = false
    }

    private func load() async {
        guard let client = session.settingsClient else { return }
        do { apply(try await client.telemetrySettings()) } catch {
            note = (AppStrings.localized("Could not load the OpenTelemetry settings."), true)
        }
    }

    private func run(_ work: @escaping (CompanionClient) async throws -> String) {
        guard let client = session.settingsClient else { return }
        busy = true
        note = nil
        Task {
            do { note = (try await work(client), false) } catch {
                let message = error.localizedDescription
                note = (message.isEmpty ? AppStrings.localized("That did not work.") : message, true)
            }
            busy = false
        }
    }

    private func save() {
        let headerObject = TelemetryHeaderDraft.object(headers)
        let typed = endpoint, service = serviceName
        run { client in
            apply(try await client.saveTelemetry(endpoint: typed, headers: headerObject, serviceName: service))
            return AppStrings.localized("Saved. Traces go to the collector within a few seconds.")
        }
    }

    private func test() {
        let headerObject = TelemetryHeaderDraft.object(headers)
        let typed = endpoint
        run { client in
            guard try await client.testTelemetry(endpoint: typed, headers: headerObject) else {
                return AppStrings.localized("That did not work.")
            }
            return AppStrings.localized("The collector accepted the test span.")
        }
    }

    private func remove() {
        run { client in
            apply(try await client.removeTelemetry())
            return AppStrings.localized("Export is off.")
        }
    }
}

/// A text field in a settings card, at the rows' inset.
struct PhoneSettingsField: View {
    @Binding var text: String
    var prompt: String
    var identifier: String
    var secure = false
    var url = false

    var body: some View {
        Group {
            if secure {
                SecureField(text: $text, prompt: Text(verbatim: prompt)) { Text(verbatim: prompt) }
            } else {
                TextField(text: $text, prompt: Text(verbatim: prompt)) { Text(verbatim: prompt) }
                    .keyboardType(url ? .URL : .default)
            }
        }
        .font(Theme.Font.body)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .padding(.horizontal, SettingsMetrics.rowInset)
        .frame(minHeight: 44)
        .accessibilityIdentifier(identifier)
    }
}

// MARK: - Appearance's display pickers

/// List density, activity and home chrome, moved from the old Advanced page:
/// how the home and the chats show things on this phone.
struct DisplaySettingsCard: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    /// Tool calls ("Details"): the desktop's own switch, kept by the server.
    @ObservedObject private var toolCalls = ToolCallsSetting.shared
    @AppStorage(PrefKey.rosterDensity) private var rosterDensity = RosterDensity.default.rawValue
    @AppStorage(PrefKey.updatesButton) private var updatesButton = false
    @AppStorage(PrefKey.rosterChromeAtTop) private var rosterChromeAtTop = false

    var body: some View {
        SettingsSectionLabel(text: "Display")
        SettingsCard {
            Menu {
                Picker(selection: Binding(get: { RosterDensity.shown(stored: rosterDensity) }, set: { rosterDensity = $0.rawValue })) {
                    ForEach(RosterDensity.selectable, id: \.self) { density in
                        Text(LocalizedStringKey(density.label)).tag(density)
                    }
                } label: { EmptyView() }
            } label: {
                SettingsRow(title: "List density", accessory: .valueChevron(String(localized: String.LocalizationValue(RosterDensity.shown(stored: rosterDensity).label))))
            }
            .accessibilityIdentifier("list-density")
            CardHairline(leadingInset: SettingsMetrics.rowInset)
            SettingsRow(
                title: "Updates button",
                subtitle: "A large Updates button at the bottom of the home, to see what the bots did at a glance.",
                accessory: .toggle($updatesButton),
                identifier: "settings.updatesButton"
            )
            CardHairline(leadingInset: SettingsMetrics.rowInset)
            SettingsRow(
                title: "Tool calls",
                subtitle: "Show tool calls in chat. Off: the chat shows the messages, a turn's steps fold away. The same switch as on your computer.",
                accessory: .toggle(Binding(get: { toolCalls.showToolCalls }, set: { on in
                    Task { await toolCalls.set(session, on) }
                })),
                identifier: "settings-activity"
            )
            .disabled(toolCalls.saving)
            CardHairline(leadingInset: SettingsMetrics.rowInset)
            SettingsRow(
                title: "Search and + at top",
                subtitle: "Place search and the new button at the top of the home instead of the bottom.",
                accessory: .toggle($rosterChromeAtTop),
                identifier: "settings.rosterChromeAtTop"
            )
        }
        if let error = toolCalls.error {
            SettingsFooter(text: LocalizedStringKey(error))
        }
        SettingsFooter(text: LocalizedStringKey(RosterDensity.shown(stored: rosterDensity).caption))
            .task(id: session.connection?.id) { await toolCalls.load(session) }
    }
}
