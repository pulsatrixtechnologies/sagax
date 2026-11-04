// iPad I5: Settings pages for an admin pairing (the served renderer's):
// General, Experimental, API keys, Decision model, Usage and Backups, each
// laid out as SettingsModal.tsx draws it and saved through the routes the
// desktop calls (`PUT`/`PATCH /api/config`, `/api/workspace-backup/*`).
//
// Rows the desktop draws only for its own window (App tour, Welcome tour,
// Diagnostics export, Defaults for new bots, which opens the full New Bot
// editor) are not on the iPad.
import SwiftUI
import UniformTypeIdentifiers
import UIKit
import CompanionCore

// MARK: - General

/// General (#518): Profile, About me, Language and new bots' effort; the
/// technical cards (routines in the conversation, group turns, parallel
/// threads, recovery, event log cleanup) wait on the Advanced sub-page.
struct DesktopGeneralSettings: View {
    @State private var advanced = false

    var body: some View {
        if advanced {
            AnyView(DesktopGeneralAdvancedSettings { advanced = false })
        } else {
            AnyView(DesktopGeneralMainSettings { advanced = true })
        }
    }
}

/// A row that opens a sub-page (`SettingsSubPageRow`): title, summary and
/// a chevron.
/// A page's grey section title (`SettingsSection` heading): 13/18 medium
/// in the secondary ink, 2 pt in, above its card.
struct DesktopSettingsHeading: View {
    let title: Text
    init(_ title: Text) { self.title = title }

    var body: some View {
        DesktopText(title, size: 13, line: 18, color: \.inkSecondary)
            .padding(.leading, 4)
            .accessibilityAddTraits(.isHeader)
    }
}

struct DesktopSubPageRow: View {
    @Environment(\.desktopTheme) private var theme
    let title: Text
    var summary: Text? = nil
    let identifier: String
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    DesktopText(title)
                    if let summary {
                        DesktopText(summary, size: 12.5, line: 17, color: \.inkSecondary)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(theme.inkSecondary)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .padding(1)
            .contentShape(Rectangle())
        }
        .buttonStyle(DesktopHoverFill(radius: 14))
        .desktopHairlineBox()
        .accessibilityIdentifier(identifier)
    }
}

private struct DesktopGeneralMainSettings: View {
    @EnvironmentObject private var model: DesktopSettingsModel
    @AppStorage(PrefKey.language) private var language = AppLanguage.system.rawValue
    @ObservedObject private var mode = DesktopInterfaceMode.shared
    @State private var editingAboutMe = false
    let openAdvanced: () -> Void

    var body: some View {
        let config = model.config
        // Settings > Account (2026-10-28): Account (who is signed in, About
        // me), Appearance (Language, time zone), System (Guided tours,
        // Advanced), under the desktop's grey headings.
        DesktopSettingsGroup(Text("Account"), identifier: "account") {
            AnyView(DesktopProfileCard())
            DesktopSubPageRowBare(title: Text("About me"), summary: aboutMeSummary, action: Text("Edit"),
                                  identifier: "desktop-settings.about-me") { editingAboutMe = true }
        }
        .sheet(isPresented: $editingAboutMe) {
            DesktopAboutMeEditor(initial: config?.profile?.aboutMe ?? "")
                .environmentObject(model)
        }
        DesktopSettingsGroup(Text("Appearance"), identifier: "appearance") {
            DesktopCompactRow(Text("Language"), identifier: "language") {
                DesktopPillSelect(
                    options: AppLanguage.allCases.map { ($0.rawValue, $0.optionLabel) },
                    selection: language,
                    shown: AppLanguage(rawValue: language).map(\.inEffect)?.optionLabel,
                    label: Text("App language"),
                    identifier: "desktop-settings.language",
                    choose: { language = $0 }
                )
            }
            DesktopTimeZoneRows()
        }
        DesktopSettingsGroup(Text("System"), identifier: "system") {
            // the desktop's guided tours (GuidedToursRow) play in its window;
            // on the iPad the row says so behind its help
            DesktopCompactRow(Text("Guided tours"), identifier: "tours") {
                DesktopTourButton(title: Text("App tour"), identifier: "desktop-settings.app-tour")
                DesktopTourButton(title: Text("Welcome tour"), identifier: "desktop-settings.welcome-tour")
            }
            if mode.advanced {
                DesktopSubPageRowBare(title: Text("Advanced"), summary: Text("People's tool access, conversation cleanup, diagnostics"),
                                      action: Text("Open"), identifier: "desktop-settings.advanced", open: openAdvanced)
            }
        }
    }

    private var aboutMeSummary: Text {
        let first = (model.config?.profile?.aboutMe ?? "")
            .split(whereSeparator: \.isNewline).first.map(String.init)?
            .trimmingCharacters(in: .whitespaces) ?? ""
        return first.isEmpty ? Text("Not set") : Text(verbatim: first)
    }
}

/// A guided tour's button (GuidedToursRow): the tours play in the desktop's
/// window, so on the iPad the button says where to find them.
struct DesktopTourButton: View {
    let title: Text
    let identifier: String
    @State private var showing = false

    var body: some View {
        Button { showing = true } label: { title }
            .buttonStyle(DesktopPillButtonStyle())
            .accessibilityIdentifier(identifier)
            .popover(isPresented: $showing) {
                DesktopText("The app tour and the welcome tour play in Sagax on your computer.", size: 12, line: 17, color: \.inkSecondary)
                    .frame(width: 232, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(12)
                    .desktopPopoverOnCompact()
            }
    }
}

/// `SettingsSubPageRow bare`: a row of a group's card that opens a
/// sub-page: title, summary, the accent action word and a chevron.
struct DesktopSubPageRowBare: View {
    @Environment(\.desktopTheme) private var theme
    let title: Text
    let summary: Text
    let action: Text
    let identifier: String
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    DesktopText(title)
                    DesktopText(summary, size: 12.5, line: 18, color: \.inkSecondary).lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                DesktopText(action, size: 12.5, weight: .medium, color: \.accent)
                DesktopSettingsIconView(icon: .chevronRight, size: 14)
                    .foregroundStyle(theme.inkSecondary)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(DesktopHoverFill(radius: 0))
        .accessibilityIdentifier(identifier)
    }
}

/// General > Advanced: the technical cards, under Back.
private struct DesktopGeneralAdvancedSettings: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var model: DesktopSettingsModel
    let close: () -> Void

    var body: some View {
        let config = model.config
        let saving = !model.saving.isEmpty
        Button(action: close) {
            HStack(spacing: 4) {
                Image(systemName: "chevron.left").font(.system(size: 12, weight: .medium))
                DesktopText(Text("General"), size: 12.5, color: \.inkSecondary)
            }
            .foregroundStyle(theme.inkSecondary)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("desktop-settings.advanced-back")
        DesktopText(Text("Advanced"), size: 14, weight: .medium, line: 20)
            .accessibilityAddTraits(.isHeader)
        DesktopSettingsGroup {
            DesktopSettingRow(
                title: Text("Routines in the conversation"),
                subtitle: Text("The default for whether a new routine posts its result in the conversation."),
                help: Text("A routine always runs in the background; questions, approvals and errors reach you, and a run with nothing to report stays silent. This is the default for whether a new routine also posts its result as a message. Each routine can override it, and nothing ever posts the routine's instructions.")
            ) {
                let on = config?.features?.routinesInConversation == true
                DesktopSwitch(isOn: on, label: Text("Run routines in the conversation"),
                              identifier: "desktop-settings.routines-in-conversation", disabled: saving || config == nil) {
                    Task { _ = await model.apply(.feature("routinesInConversation", !on), key: "routines") }
                }
            }
        }
        DesktopSettingsCard(
            Text("Group turns"),
            summary: Text("\(config?.rooms?.turnTimeoutMinutes ?? 5) min per turn"),
            subtitle: Text("Set one maximum duration for every bot turn in a group."),
            open: false, identifier: "general.roomTurns"
        ) {
            DesktopNumberStepper(
                label: Text("Maximum turn length"), unit: Text("minutes"),
                value: config?.rooms?.turnTimeoutMinutes ?? 5, range: 1...1_440,
                identifier: "desktop-settings.room-turns"
            ) { minutes in
                Task { _ = await model.apply(.roomTurnMinutes(minutes), key: "rooms") }
            }
            DesktopText("Applies to every bot turn in groups. Direct threads use the inactivity watchdog instead.",
                        size: 12, line: 17, color: \.inkSecondary)
                .padding(.top, 8)
        }
        DesktopSettingsCard(
            Text("Parallel threads"),
            summary: Text("\(config?.threads?.maxConcurrentPerBot ?? 3) per bot"),
            subtitle: Text("Choose how much each bot can work on at once."),
            open: false, identifier: "general.threads"
        ) {
            DesktopNumberStepper(
                label: Text("Maximum running threads per bot"), unit: nil,
                value: config?.threads?.maxConcurrentPerBot ?? 3, range: 1...10,
                identifier: "desktop-settings.parallel-threads"
            ) { count in
                Task { _ = await model.apply(.parallelThreads(count), key: "threads") }
            }
        }
        DesktopSettingsCard(
            Text("Automatic recovery"),
            summary: config?.automaticRecovery?.enabled == true ? Text("On") : Text("Off"),
            open: false, identifier: "general.recovery"
        ) {
            VStack(alignment: .leading, spacing: 10) {
                DesktopText("If an ACP model provider (such as Qwen or OpenCode) fails before starting, try a backup once. Work that may have already run is not replayed.",
                            color: \.inkSecondary)
                if config?.automaticRecovery?.enabled == true {
                    Button("Turn off") { Task { _ = await model.apply(.automaticRecoveryOff, key: "recovery") } }
                        .buttonStyle(DesktopPillButtonStyle())
                        .disabled(saving)
                        .accessibilityIdentifier("desktop-settings.recovery-off")
                } else {
                    DesktopText("The backup model is chosen in Sagax on the computer.", size: 12, line: 17, color: \.inkTertiary)
                }
            }
        }
        DesktopSettingsCard(
            Text("Event log cleanup"),
            summary: config?.threads?.eventLogRetentionDays.map { Text("Delete after \($0) days") } ?? Text("Off"),
            subtitle: Text("Trim the logs threads accumulate while they run."),
            open: false, identifier: "general.threadCleanup"
        ) {
            let days = config?.threads?.eventLogRetentionDays
            HStack(spacing: 12) {
                DesktopText("Delete event logs of finished threads after", color: \.ink)
                Spacer(minLength: 0)
                DesktopSwitch(isOn: days != nil, label: Text("Delete event logs of finished threads"),
                              identifier: "desktop-settings.cleanup", disabled: saving || config == nil) {
                    Task { _ = await model.apply(.eventLogRetention(days == nil ? 30 : nil), key: "cleanup") }
                }
            }
            if let days {
                DesktopNumberStepper(label: Text("Days"), unit: Text("days"), value: days, range: 1...3_650,
                                     identifier: "desktop-settings.cleanup-days") { value in
                    Task { _ = await model.apply(.eventLogRetention(value), key: "cleanup") }
                }
                .padding(.top, 8)
            }
            DesktopText("When on, a daily sweep deletes the event-log files of threads that closed or were archived more than this many days ago. It only removes event-log files, never threads or transcripts.",
                        size: 12, line: 17, color: \.inkSecondary)
                .padding(.top, 8)
        }
    }
}

extension DesktopGeneralSettings {
    static func effortLabel(_ level: String) -> String {
        level == "xhigh" ? "X-High" : level.prefix(1).uppercased() + level.dropFirst()
    }
}

private extension AppLanguage {
    /// System resolves to the language the app is showing (the desktop's
    /// select names the language in use, not "System").
    var inEffect: AppLanguage {
        guard self == .system else { return self }
        let preferred = Bundle.main.preferredLocalizations.first ?? "en"
        if preferred.hasPrefix("fr") { return .french }
        if preferred.hasPrefix("pt") { return .portugueseBrazil }
        return .english
    }

    var optionLabel: String {
        switch self {
        case .system: AppStrings.localized("System")
        case .english: "English"
        case .french: "Français"
        case .portugueseBrazil: "Português (Brasil)"
        }
    }
}

/// A row that looks like a collapsed card (title, summary, chevron) and
/// opens something else (`SettingsSubPageRow`).
struct DesktopCollapsedRow: View {
    @Environment(\.desktopTheme) private var theme
    let title: Text
    var summary: Text? = nil

    var body: some View {
        HStack(spacing: 12) {
            DesktopText(title)
            Spacer(minLength: 0)
            if let summary {
                DesktopText(summary, size: 12.5, color: \.inkSecondary).lineLimit(1)
            }
            DesktopSettingsIconView(icon: .chevronDown, size: 14)
                .foregroundStyle(theme.inkSecondary)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .padding(1)
        .contentShape(Rectangle())
    }
}

/// The account row (AccountCard.tsx, OperatorIdentity): the initial, the
/// name and the address edited in place, the person's own label under the
/// name (MyLabelField) and the copy-email button.
struct DesktopProfileCard: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var model: DesktopSettingsModel
    @EnvironmentObject private var session: Session
    @ObservedObject private var people = PeopleDirectory.shared
    @State private var name = ""
    @State private var email = ""
    @State private var seeded = false
    @State private var label = ""
    @State private var editingLabel = false
    @State private var labelError: String?
    @State private var copied = false
    @FocusState private var labelFocused: Bool

    private var principal: String? {
        let id = session.account?.principalId?.trimmingCharacters(in: .whitespaces) ?? session.roomViewer.actorId
        return id.isEmpty ? nil : id
    }

    var body: some View {
        let profile = model.config?.profile
        HStack(spacing: 12) {
            Text(verbatim: String((name.isEmpty ? (email.isEmpty ? "?" : email) : name).prefix(1)).uppercased())
                .font(theme.font(13, .semibold))
                .foregroundStyle(theme.ink)
                .frame(width: 36, height: 36)
                .background(theme.raised, in: Circle())
            VStack(alignment: .leading, spacing: 4) {
                TextField(text: $name, prompt: Text("Your name").foregroundColor(theme.inkSecondary)) { Text("Your name") }
                    .font(theme.font(13, .medium))
                    .foregroundStyle(theme.ink)
                    .frame(height: 18)
                    .submitLabel(.done)
                    .onSubmit { save(.profileName(name), was: profile?.name) }
                    .accessibilityIdentifier("desktop-settings.profile-name")
                if let principal { labelLine(principal) }
                HStack(spacing: 4) {
                    TextField(text: $email, prompt: Text(verbatim: "you@example.com").foregroundColor(theme.inkSecondary)) { Text("Email") }
                        .font(theme.font(13))
                        .foregroundStyle(theme.inkSecondary)
                        .frame(height: 18)
                        .fixedSize()
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.done)
                        .onSubmit { save(.profileEmail(email), was: profile?.email) }
                        .accessibilityIdentifier("desktop-settings.profile-email")
                    if !email.trimmingCharacters(in: .whitespaces).isEmpty {
                        Button {
                            UIPasteboard.general.string = email.trimmingCharacters(in: .whitespaces)
                            copied = true
                            Task { try? await Task.sleep(nanoseconds: 1_500_000_000); copied = false }
                        } label: {
                            DesktopSettingsIconView(icon: copied ? .check : .copy, size: 13)
                                .foregroundStyle(copied ? theme.success : theme.inkSecondary)
                                .frame(width: 24, height: 24)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(DesktopHoverFill(radius: 6))
                        .accessibilityLabel(copied ? Text("Email copied") : Text("Copy email"))
                        .accessibilityIdentifier("desktop-settings.copy-email")
                    }
                    Spacer(minLength: 0)
                }
                if let labelError {
                    DesktopText(verbatim: labelError, size: 12, line: 16, color: \.danger)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 14)
        .padding(.top, 14)
        .padding(.bottom, 10)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("settings-card.general.account")
        .onAppear(perform: seed)
        .onValueChange(of: model.config?.profile) { _ in seed() }
    }

    /// The person's own label (`InlineEditableText`, muted 12/16): the
    /// placeholder reads as editable; a tap edits it in place.
    @ViewBuilder
    private func labelLine(_ principal: String) -> some View {
        let saved = people.label(principal) ?? ""
        if editingLabel {
            TextField(text: $label, prompt: Text("Add a label").foregroundColor(theme.inkSecondary)) { Text("Edit label") }
                .font(theme.font(12))
                .foregroundStyle(theme.inkSecondary)
                .frame(height: 16)
                .focused($labelFocused)
                .submitLabel(.done)
                .onSubmit { commitLabel(principal, was: saved) }
                .onChange(of: labelFocused) { focused in if !focused { commitLabel(principal, was: saved) } }
                .accessibilityIdentifier("desktop-settings.my-label-field")
        } else {
            Button {
                label = saved
                editingLabel = true
                labelFocused = true
            } label: {
                DesktopText(verbatim: saved.isEmpty ? AppStrings.localized("Add a label") : saved, size: 12, line: 16, color: \.inkSecondary)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Edit label"))
            .accessibilityValue(Text(verbatim: saved))
            .accessibilityIdentifier("desktop-settings.my-label")
        }
    }

    private func commitLabel(_ principal: String, was: String) {
        guard editingLabel else { return }
        editingLabel = false
        let next = label.trimmingCharacters(in: .whitespacesAndNewlines)
        guard next != was else { return }
        Task { labelError = await people.saveLabel(principal, next, session: session) }
    }

    private func seed() {
        guard let profile = model.config?.profile else { return }
        name = profile.name ?? ""
        email = profile.email ?? ""
        seeded = true
    }

    private func save(_ change: DesktopConfigChange, was: String?) {
        let value: String
        switch change {
        case let .profileName(text), let .profileEmail(text): value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        default: return
        }
        guard seeded, value != (was ?? "") else { return }
        Task { _ = await model.apply(change, key: "profile") }
    }
}

/// About me (`AboutMeSettings.tsx`): what every bot reads about the person.
struct DesktopAboutMeEditor: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var model: DesktopSettingsModel
    let initial: String
    @State private var text = ""
    @State private var error: String?

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 8) {
                // the markdown editor (desktop AboutMeSettings, #258)
                MarkdownEditor(
                    text: $text,
                    placeholder: String(localized: "For example: I handle IT for a 40-person firm in Montréal. Answer in French, short and direct."),
                    minHeight: 240, maxLength: 4_000,
                    accessibilityLabel: String(localized: "About me"), identifier: "desktop-settings.about-me-text"
                )
                if let error {
                    Text(verbatim: error).font(.footnote).foregroundStyle(.red)
                }
                Text("Every bot reads this before it answers you.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .padding()
            .navigationTitle("About me")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            error = await model.apply(.aboutMe(text), key: "aboutMe")
                            if error == nil { dismiss() }
                        }
                    }
                    .disabled(text == initial)
                    .accessibilityIdentifier("desktop-settings.about-me-save")
                }
            }
        }
        .onAppear { text = initial }
    }
}

/// A number with − and + (the desktop's number inputs, on a touch screen).
struct DesktopNumberStepper: View {
    @Environment(\.desktopTheme) private var theme
    let label: Text
    let unit: Text?
    let value: Int
    let range: ClosedRange<Int>
    var identifier: String
    let change: (Int) -> Void

    var body: some View {
        HStack(spacing: 10) {
            DesktopText(label)
            Spacer(minLength: 0)
            Button { change(max(range.lowerBound, value - 1)) } label: {
                Text(verbatim: "−").font(theme.font(15)).frame(width: 30, height: 30)
            }
            .buttonStyle(DesktopButtonStyle(kind: .control, height: 30, horizontal: 0))
            .disabled(value <= range.lowerBound)
            .accessibilityLabel(Text("Decrease"))
            DesktopText(verbatim: "\(value)", line: 18)
                .monospacedDigit()
                .frame(minWidth: 36)
                .accessibilityIdentifier(identifier)
            Button { change(min(range.upperBound, value + 1)) } label: {
                Text(verbatim: "+").font(theme.font(15)).frame(width: 30, height: 30)
            }
            .buttonStyle(DesktopButtonStyle(kind: .control, height: 30, horizontal: 0))
            .disabled(value >= range.upperBound)
            .accessibilityLabel(Text("Increase"))
            if let unit {
                DesktopText(unit, color: \.inkSecondary)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Experimental

struct DesktopExperimentalSettings: View {
    @EnvironmentObject private var model: DesktopSettingsModel
    /// Development context pods: this device only, off by default.
    @AppStorage(DevPodsPrefs.enabled) private var devPods = false

    var body: some View {
        let config = model.config
        let features = config?.features
        let busy = !model.saving.isEmpty || config == nil
        let skills = features?.skillAuthoring != false
        let browser = features?.browser == true
        let engine = config?.browserEngine
        let browserReady = engine?.kind != "unavailable"
        let browserInstallable = engine?.installable == true
        let decision = features?.decisionModel == true
        let dataWindow = features?.dataWindow == true
        let notetaker = features?.meetingNotetaker == true
        let titles = features?.llmThreadTitles == true
        let on = [skills, browser, decision, dataWindow, notetaker, devPods, titles].filter { $0 }.count
        DesktopSettingsGroup(
            Text("Experimental features"),
            accessory: AnyView(DesktopText(verbatim: "· " + String(format: AppStrings.localized("%@ of %@ on"), "\(on)", "7"), color: \.inkSecondary).lineLimit(1)),
            identifier: "experimental"
        ) {
            row("skillAuthoring", Text("Bots may write their own skills"), aria: Text("Allow bots to draft skills"), on: skills, busy: busy, identifier: "desktop-settings.skill-authoring")
            row("browser", Text("Built-in browser"), aria: Text("Enable the built-in browser"), on: browser, busy: busy,
                unavailable: !browserReady && !browserInstallable,
                reason: Text(verbatim: AppStrings.localized("The browser engine is not installed on this server yet. Enable the browser switches in App Settings → Experimental and the bot's Access settings, then open Bot's computer → Browser to install it. Or run `sagax browser install` on the server.")),
                note: !browserReady && browserInstallable ? Text("Then install the engine from a bot's Computer > Browser.") : nil,
                identifier: "desktop-settings.browser")
            row("decisionModel", Text("Decision model"), aria: Text("Decision model"), on: decision, busy: busy, identifier: "desktop-settings.decision-model")
            row("dataWindow", Text("Data window"), aria: Text("Turn on the Data window"), on: dataWindow, busy: busy,
                unavailable: features?.dataWindow == nil,
                reason: Text("This server does not offer the Data window yet. It comes with Sagax 0.5.3 on the server."),
                identifier: "desktop-settings.data-window")
            row("meetingNotetaker", Text("Meeting notetaker (Google Meet)"), aria: Text("Meeting notetaker (Google Meet)"), on: notetaker, busy: busy,
                unavailable: features?.meetingNotetaker == nil,
                reason: Text("This server does not offer the meeting notetaker yet."),
                note: Text("Bots can ask to join a Google Meet and take notes, after your approval on each meeting. Not yet tested on real meetings."),
                identifier: "desktop-settings.meeting-notetaker")
            row("llmThreadTitles", Text("Generated conversation titles"), aria: Text("Turn on generated conversation titles"), on: titles, busy: busy,
                unavailable: features?.llmThreadTitles == nil,
                reason: Text("This server does not offer this feature yet. Update Sagax on the server."),
                identifier: "desktop-settings.thread-titles")
            DesktopDescribedRow(Text("Context pods for development"), identifier: "devPods") {
                DesktopSwitch(isOn: devPods, label: Text("Turn on context pods for development"), identifier: "desktop-settings.dev-pods") { devPods.toggle() }
            }
        }
    }

    /// `FeatureRow`: a feature the server cannot run keeps its row, greyed,
    /// with "Not available on this server" and the reason behind the help.
    private func row(_ feature: String, _ label: Text, aria: Text, on: Bool, busy: Bool, unavailable: Bool = false,
                     reason: Text? = nil, note: Text? = nil, identifier: String) -> some View {
        DesktopDescribedRow(label, description: unavailable ? Text("Not available on this server") : note, identifier: feature) {
            if unavailable, let reason { DesktopHelpTip(help: reason) }
            DesktopSwitch(isOn: on, label: aria, identifier: identifier, disabled: busy || (unavailable && !on)) {
                Task { _ = await model.apply(.feature(feature, !on), key: feature) }
            }
        }
        .opacity(unavailable ? 0.75 : 1)
    }
}

// MARK: - API keys

struct DesktopAPIKeysSettings: View {
    @EnvironmentObject private var model: DesktopSettingsModel
    @State private var otherOpen = false

    var body: some View {
        let config = model.config ?? DesktopSettingsConfig()
        DesktopText("Keys for AI providers and optional services. Paste a key and it saves and checks itself.", color: \.inkSecondary)
        DesktopSettingsCard(
            Text("Provider keys"),
            summary: Self.summary(config, [.openai, .anthropic, .xai, .openrouter, .mistral, .openaiCompat]),
            subtitle: Text("Keys every bot in this installation runs on, billed per token to your provider account."),
            identifier: "connections.providers"
        ) {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    key(.openai, Text("OpenAI API key"), config)
                    DesktopText("Codex doesn't use this key; it signs in with ChatGPT.", size: 11.5, line: 16.1, color: \.inkSecondary)
                }
                key(.anthropic, Text("Anthropic API key"), config)
                key(.xai, Text("xAI API key"), config)
                key(.openrouter, Text("OpenRouter API key"), config)
                key(.mistral, Text("Mistral API key"), config)
                DesktopDisclosure(title: Text("Other OpenAI-compatible server (Groq, Together, Ollama…)"), open: $otherOpen) {
                    key(.openaiCompat, Text("OpenAI-compatible API key"), config)
                }
            }
        }
    }

    private func key(_ provider: DesktopAPIKeyProvider, _ title: Text, _ config: DesktopSettingsConfig) -> some View {
        DesktopKeyField(
            title: title, provider: provider, configured: config.keyConfigured(provider),
            help: Text("Stored on the computer, never shown again. Paste a new key to replace it.")
        ) { value in
            await model.apply(.apiKey(provider, value), key: provider.rawValue)
        }
    }

    /// `configuredSummary`: how many of the keys are on file, or Not set.
    static func summary(_ config: DesktopSettingsConfig, _ providers: [DesktopAPIKeyProvider]) -> Text {
        let count = providers.filter(config.keyConfigured).count
        return count == 0 ? Text("Not set") : Text("\(count) set")
    }
}

/// A `<details>` box (`rounded-lg border border-hairline/40 bg-inset px-3 py-2`).
struct DesktopDisclosure<Content: View>: View {
    @Environment(\.desktopTheme) private var theme
    let title: Text
    @Binding var open: Bool
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button { withAnimation(.easeOut(duration: 0.15)) { open.toggle() } } label: {
                HStack(spacing: 6) {
                    Image(systemName: "arrowtriangle.right.fill")
                        .font(.system(size: 8))
                        .rotationEffect(.degrees(open ? 90 : 0))
                    DesktopText(title, line: 19.5, color: \.inkSecondary)
                    Spacer(minLength: 0)
                }
                .foregroundStyle(theme.inkSecondary)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if open { content() }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .padding(1)
        .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.4), lineWidth: 1))
    }
}

// MARK: - Decision model

struct DesktopDecisionModelSettings: View {
    @Environment(\.desktopTheme) private var theme
    @Environment(\.openURL) private var openURL
    @EnvironmentObject private var model: DesktopSettingsModel

    var body: some View {
        let config = model.config ?? DesktopSettingsConfig()
        let configured = config.decider?.configured == true
        let enabled = config.decider?.enabled == true
        let routing = config.decider?.jobs?.roomRouting == true
        DesktopText("A fast decision model that picks things for your bots in a few hundred milliseconds, for a fraction of a cent. Your bots still do the work.",
                    line: 21.125, color: \.inkSecondary)
        DesktopSettingRow(
            title: Text("Use Jev for fast decisions"),
            subtitle: configured ? Text("Rooms set to Auto ask Jev who answers.") : Text("Save a key below to turn this on.")
        ) {
            DesktopSwitch(isOn: enabled, label: Text("Use Jev for fast decisions"), identifier: "desktop-settings.jev",
                          disabled: !configured || !model.saving.isEmpty) {
                Task { _ = await model.apply(.deciderEnabled(!enabled), key: "jev") }
            }
            .opacity(configured ? 1 : 0.8)
        }
        .padding(.horizontal, -0.5)
        VStack(alignment: .leading, spacing: 0) {
            DesktopText("Jev API key")
                .padding(.bottom, 10)
            HStack(spacing: 8) {
                Circle().fill(configured ? theme.success : theme.raisedHover).frame(width: 6, height: 6)
                DesktopText(configured ? Text("Connected") : Text("Not connected"), line: 19.5, color: \.inkSecondary)
            }
            .padding(.bottom, 8)
            DesktopJevKeyRow(configured: configured)
            Button {
                if let url = URL(string: "https://typesafe.ai") { openURL(url) }
            } label: {
                HStack(spacing: 4) {
                    DesktopText("Get a key at typesafe.ai", size: 12, line: 18, color: \.accent)
                    DesktopSettingsIconView(icon: .externalLink, size: 11)
                        .foregroundStyle(theme.accent)
                }
            }
            .buttonStyle(.plain)
            .padding(.top, 8)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(1)
        .desktopHairlineBox()
        VStack(alignment: .leading, spacing: 0) {
            DesktopText("What it decides")
                .padding(.bottom, 18)
            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 2) {
                    DesktopText("Who answers in rooms", weight: .medium, line: 19.5)
                    DesktopText("In rooms set to Auto, picks the bot that fits each message nobody @mentioned. When Jev is unsure or unreachable, the room's lead answers.",
                                size: 12, line: 19.5, color: \.inkSecondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                DesktopSwitch(isOn: enabled && routing, label: Text("Who answers in rooms"), identifier: "desktop-settings.jev-rooms",
                              disabled: !enabled || !model.saving.isEmpty) {
                    Task { _ = await model.apply(.deciderRoomRouting(!routing), key: "jevRooms") }
                }
            }
            .padding(.bottom, 8)
            ForEach([Text("Browser clicks"), Text("Tool selection"), Text("Where work runs")].indices, id: \.self) { index in
                let label = [Text("Browser clicks"), Text("Tool selection"), Text("Where work runs")][index]
                HStack {
                    DesktopText(label, line: 19.5, color: \.inkSecondary)
                    Spacer(minLength: 0)
                    DesktopBadge(text: Text("Coming soon"))
                }
                .padding(.vertical, 8)
                .overlay(alignment: .top) { Rectangle().fill(theme.hairline.opacity(0.4)).frame(height: 1) }
                .opacity(0.5)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(1)
        .desktopHairlineBox()
    }
}

// MARK: - Usage

/// Usage (#518, `UsageSection.tsx`): the signed-in person's own usage.
/// Cost (this month, its trend, the last 30 days) on top, then Plan (only
/// connected providers, absent when none, 2026-10-15), then a folded
/// breakdown by bot and by model, all from `GET /api/usage?mine=1`. The
/// installation's spend limit, other people and the history by person are
/// Sagax Business's.
struct DesktopUsageSettings: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @StateObject private var personal = PersonalUsageModel()
    @State private var spendCap: PersonalSpendCap?

    var body: some View {
        DesktopSettingsGroup(Text("Cost"), identifier: "cost") {
            AnyView(cost).padding(.horizontal, 14).padding(.vertical, 10)
        }
        .task(id: session.connection?.id) {
            await personal.load(session.settingsClient)
            spendCap = try? await session.settingsClient?.spendCap()
        }
        // UsageLayout: `flex-col gap-6` between Cost, the limit, Plan and the traces
        if personal.usage != nil, spendCap?.supported == true { AnyView(DesktopSpendCapGroup(data: $spendCap)).padding(.top, 12) }
        AnyView(DesktopPlanUsageCard()).padding(.top, 12)
        AnyView(DesktopUsageTraces()).padding(.top, 12)
        if let usage = personal.usage, !usage.isEmpty {
            DesktopSettingsCard(Text("By bot and by model"), summary: Text("This month"), open: false, identifier: "usage.breakdown") {
                VStack(alignment: .leading, spacing: 16) {
                    DesktopUsageGroupList(title: Text("By bot"), groups: PersonalUsageRules.ranked(usage.byBot), kind: "bot")
                    DesktopUsageGroupList(title: Text("By model"), groups: PersonalUsageRules.ranked(usage.byModel), kind: "model")
                }
            }
        }
    }

    @ViewBuilder
    private var cost: some View {
        if personal.failed {
            DesktopText("Your usage could not be loaded. Try again later.", color: \.danger)
        } else if let usage = personal.usage {
            if usage.isEmpty {
                DesktopText("Nothing spent yet. Your cost shows after your bots' first turns.", color: \.inkSecondary)
            } else {
                HStack(alignment: .bottom, spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        DesktopText(verbatim: PersonalUsageModel.cost(usage.cost), size: 22, weight: .semibold, line: 30)
                            .monospacedDigit()
                            .accessibilityIdentifier("desktop-settings.usage-cost")
                        DesktopText(verbatim: PersonalUsageModel.monthLine(usage), size: 12.5, line: 17, color: \.inkSecondary)
                        if usage.estimated {
                            DesktopText("Part of it is estimated from public prices.", size: 12, line: 17, color: \.inkSecondary)
                        }
                    }
                    Spacer(minLength: 0)
                    VStack(alignment: .trailing, spacing: 2) {
                        UsageSparkline(values: PersonalUsageRules.dailyCosts(usage.days30, range: PersonalUsagePeriods().days30),
                                       color: theme.accent)
                        DesktopText("Last 30 days", size: 11.5, line: 16, color: \.inkSecondary)
                    }
                }
            }
        } else {
            ProgressView().controlSize(.small)
        }
    }
}

/// Spending limit (SpendCapCard): the person's own monthly limit; a reached
/// limit stops new turns until it is raised. Hidden where the server does
/// not know the route.
struct DesktopSpendCapGroup: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @Binding var data: PersonalSpendCap?
    @State private var text = ""
    @State private var busy = false
    @State private var failed: String?
    @State private var confirmRemove = false

    var body: some View {
        Group {
            if let data, data.supported {
                let parsed = PersonalSpendCap.parse(text, minUsd: data.minUsd)
                DesktopSettingsGroup(Text("Spending limit"), identifier: "spendCap") {
                    DesktopDescribedRow(Text("Monthly limit (USD)"), description: description(data), identifier: "cap-state") {
                        if data.cap != nil {
                            Button(confirmRemove ? "Confirm removal" : "Remove limit") {
                                if confirmRemove { Task { await save(nil) } } else { confirmRemove = true }
                            }
                            .buttonStyle(DesktopPillButtonStyle())
                            .disabled(busy)
                        }
                    }
                    HStack(spacing: 8) {
                        TextField(text: $text, prompt: Text(data.cap == nil ? "e.g. 50" : "New limit").foregroundColor(theme.inkSecondary)) { Text("Monthly limit (USD)") }
                            .font(theme.font(13))
                            .keyboardType(.decimalPad)
                            .padding(.horizontal, 10)
                            .frame(width: 160, height: 32)
                            .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.border, lineWidth: 1))
                            .accessibilityIdentifier("desktop-settings.spend-cap")
                        Button(data.cap == nil ? "Set limit" : "Change limit") { if let parsed { Task { await save(parsed) } } }
                            .buttonStyle(DesktopPillButtonStyle(primary: true))
                            .disabled(busy || parsed == nil)
                            .accessibilityIdentifier("desktop-settings.spend-cap-save")
                    }
                    .padding(.horizontal, 14).padding(.bottom, 10)
                    if !text.isEmpty && parsed == nil {
                        DesktopText(verbatim: String(format: AppStrings.localized("Enter an amount of %@ or more, like 25 or 25.50."), PersonalUsageModel.cost(data.minUsd)), size: 12, line: 16, color: \.danger)
                            .padding(.horizontal, 14).padding(.bottom, 10)
                    }
                    if let failed {
                        DesktopText(verbatim: failed, size: 12, line: 16, color: \.danger).padding(.horizontal, 14).padding(.bottom, 10)
                    }
                    DesktopText(Text("Counts every bot turn and voice request on this computer this month (voice is estimated). The limit stops the next turn; a turn already running can finish and go past it. You are notified at 80% and at the limit."),
                                size: 12, line: 16, color: \.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 14).padding(.bottom, 10)
                }
            }
        }
    }

    private func description(_ data: PersonalSpendCap) -> Text {
        guard let cap = data.cap else { return Text("No limit is set. Your bots spend freely.") }
        let line = DesktopSettingsSummary.spend(cap.spentUsd, of: cap.monthlyUsd)
        let state = cap.exceeded ? AppStrings.localized("Limit reached: the next turns are refused until you raise it.")
            : cap.warn ? AppStrings.localized("Nearing the limit") : AppStrings.localized("Within the limit")
        return Text(verbatim: line + "\n" + state)
    }

    private func save(_ value: Double?) async {
        guard let client = session.settingsClient else { return }
        busy = true
        failed = nil
        confirmRemove = false
        defer { busy = false }
        do {
            data = try await client.setSpendCap(value)
            text = ""
        } catch { failed = error.localizedDescription }
    }
}

/// Usage traces (UsageTraces.tsx): where each of the person's own jobs spent
/// its time and money this month, ten a page, newest first.
struct DesktopUsageTraces: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @State private var list: UsageTraceList?
    @State private var failed = false
    @State private var offset = 0
    private let pageSize = 10

    var body: some View {
        DesktopSettingsGroup(Text("Usage traces"), plain: true, identifier: "usage-traces") {
            DesktopText(Text("Where each of your jobs spent its time and its money, from the usage ledger. Counters, time and cost only; no message content."),
                        size: 12, line: 17, color: \.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 4)
            VStack(alignment: .leading, spacing: 0) {
                if failed {
                    DesktopText(Text("Couldn't load the usage traces."), size: 12, color: \.inkSecondary).padding(12)
                } else if let list {
                    if list.jobs.isEmpty && (list.total?.jobs ?? 0) == 0 {
                        DesktopText(Text("No job recorded for this period yet."), size: 12, color: \.inkSecondary).padding(12)
                    } else {
                        if let total = list.total {
                            HStack {
                                DesktopText(Text("Period total"), size: 12, color: \.inkSecondary)
                                Spacer(minLength: 0)
                                DesktopText(verbatim: [total.costUsd.map(PersonalUsageModel.cost), String(format: AppStrings.localized("%@ jobs"), "\(total.jobs)")].compactMap { $0 }.joined(separator: " · "), size: 12, color: \.inkSecondary)
                            }
                            .padding(12)
                        }
                        ForEach(list.jobs) { job in
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 0) {
                                    DesktopText(verbatim: job.botName, weight: .medium).lineLimit(1)
                                    DesktopText(verbatim: job.triggerLabel + " · " + String(format: AppStrings.localized("%@ turns"), "\(job.turns)"), size: 12, line: 16, color: \.inkSecondary).lineLimit(1)
                                }
                                Spacer(minLength: 0)
                                DesktopText(verbatim: (job.costUsd ?? job.estimatedUsd).map(PersonalUsageModel.cost) ?? "—", size: 12).monospacedDigit()
                            }
                            .padding(.horizontal, 12).padding(.vertical, 8)
                            .overlay(alignment: .top) { Rectangle().fill(theme.border).frame(height: 0.5) }
                        }
                        let total = list.total?.jobs ?? list.jobs.count
                        if total > pageSize {
                            HStack(spacing: 8) {
                                Spacer(minLength: 0)
                                DesktopText(verbatim: "\(offset + 1)–\(min(offset + pageSize, total)) / \(total)", size: 12, color: \.inkSecondary)
                                Button { offset = max(0, offset - pageSize) } label: { DesktopSettingsIconView(icon: .chevronDown, size: 13).rotationEffect(.degrees(90)) }
                                    .buttonStyle(DesktopButtonStyle(kind: .ghost)).disabled(offset == 0)
                                Button { offset += pageSize } label: { DesktopSettingsIconView(icon: .chevronRight, size: 13) }
                                    .buttonStyle(DesktopButtonStyle(kind: .ghost)).disabled(offset + pageSize >= total)
                            }
                            .padding(.horizontal, 12).padding(.vertical, 6)
                            .overlay(alignment: .top) { Rectangle().fill(theme.border).frame(height: 0.5) }
                        }
                    }
                } else {
                    DesktopText(Text("Loading usage traces…"), size: 12, color: \.inkSecondary).padding(12)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.elevated, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .desktopHairlineBox(radius: 12)
        }
        .task(id: offset) { await load() }
    }

    private func load() async {
        guard let client = session.settingsClient else { return }
        let month = PersonalUsagePeriods().month
        do { list = try await client.myUsageTraces(from: month.from, to: month.to, limit: pageSize, offset: offset); failed = false }
        catch { failed = true }
    }
}

/// One list of the breakdown: the top five, then Show all.
struct DesktopUsageGroupList: View {
    @Environment(\.desktopTheme) private var theme
    let title: Text
    let groups: [UsageGroup]
    let kind: String
    @State private var all = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            DesktopText(title, size: 12, weight: .medium, color: \.inkSecondary)
            if groups.isEmpty {
                DesktopText("Nothing this month.", color: \.inkSecondary)
            }
            ForEach(all ? groups : Array(groups.prefix(5))) { group in
                HStack(spacing: 12) {
                    DesktopText(verbatim: group.label).lineLimit(1)
                    Spacer(minLength: 0)
                    DesktopText(Text("\(group.turns) turns"), color: \.inkSecondary).monospacedDigit()
                    DesktopText(verbatim: group.costUsd.map(PersonalUsageModel.cost) ?? "·")
                        .monospacedDigit()
                        .frame(width: 80, alignment: .trailing)
                }
                .padding(.vertical, 6)
                .overlay(alignment: .top) { Rectangle().fill(theme.hairline.opacity(0.3)).frame(height: 1) }
                .accessibilityIdentifier("desktop-settings.usage-\(kind).\(group.key)")
            }
            if groups.count > 5 {
                Button(all ? "Show less" : "Show all (\(groups.count))") { all.toggle() }
                    .font(theme.font(12.5))
                    .foregroundStyle(theme.accent)
                    .buttonStyle(.plain)
            }
        }
    }
}

/// Per bot: name, turns, tokens, cost (`UsageSection`).
struct DesktopUsageTable: View {
    @Environment(\.desktopTheme) private var theme
    let rows: [BotUsageRow]

    var body: some View {
        let total = UsageByBot.total(rows)
        VStack(spacing: 0) {
            line(Text("Bot"), Text("Turns"), Text("Tokens"), Text("Cost"), header: true)
            ForEach(rows) { row in
                line(Text(verbatim: row.bot.name), Text(verbatim: "\(row.usage.turns)"),
                     Text(verbatim: BotUsageTotal.formatTokens(row.usage.headlineTokens)),
                     Text(verbatim: row.usage.hasCost ? BotUsageTotal.formatUsd(row.usage.costUsd ?? 0) : "—"))
            }
            line(Text("All bots"), Text(verbatim: "\(total.turns)"), Text(verbatim: BotUsageTotal.formatTokens(total.headlineTokens)),
                 Text(verbatim: total.hasCost ? BotUsageTotal.formatUsd(total.costUsd ?? 0) : "—"), bold: true)
        }
    }

    private func line(_ name: Text, _ turns: Text, _ tokens: Text, _ cost: Text, header: Bool = false, bold: Bool = false) -> some View {
        let color: KeyPath<DesktopTheme, Color> = header ? \.inkSecondary : \.ink
        let weight: Font.Weight = bold ? .medium : .regular
        return HStack {
            DesktopText(name, size: header ? 12 : 13, weight: weight, color: color).frame(maxWidth: .infinity, alignment: .leading)
            DesktopText(turns, size: header ? 12 : 13, weight: weight, color: color).frame(width: 70, alignment: .trailing)
            DesktopText(tokens, size: header ? 12 : 13, weight: weight, color: color).frame(width: 90, alignment: .trailing)
            DesktopText(cost, size: header ? 12 : 13, weight: weight, color: color).frame(width: 80, alignment: .trailing)
        }
        .padding(.vertical, 6)
        .overlay(alignment: .top) { if !header { Rectangle().fill(theme.hairline.opacity(0.4)).frame(height: 1) } }
    }
}

// MARK: - Backups

struct DesktopBackupsSettings: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var model: DesktopSettingsModel
    @State private var password = ""
    @State private var confirm = ""
    @State private var exporting = false
    @State private var error: String?
    @State private var shared: DesktopSharedFile?

    @State private var open: String?
    @State private var choosing = false
    @State private var file: URL?
    @State private var importPassword = ""
    @State private var preview: WorkspaceBackupPreview?
    @State private var typed = ""
    @State private var restoring = false
    @State private var restored = false

    /// Full backup (WorkspaceBackupSettings.tsx): its help, then the two
    /// rows, Export a backup and Restore a backup, each opening its form.
    var body: some View {
        DesktopSettingsGroup(Text("Full backup"), accessory: AnyView(DesktopHelpTip(help: Text(verbatim: [
            AppStrings.localized("A password-protected backup of this installation: bots, conversations, instructions, local files, and non-secret settings. Drafts and preferences from this browser are included."),
            AppStrings.localized("Saved account credentials and connections are not included. Reconnect your accounts on a new machine; existing credentials on the destination stay unchanged. External CLI sign-ins and remote VM disks are not included."),
            AppStrings.localized("Chats, drafts, and user files are not automatically redacted and may contain pasted secrets. Keep this backup private and save its password safely; it cannot be recovered."),
        ].joined(separator: "\n\n")))), identifier: "backups") {
            {
                var row = DesktopDescribedRow(Text("Export a backup"), description: Text("An encrypted copy of your bots, conversations and files, to restore here or on another computer."), identifier: "backupExport") {
                    Button("Export") { open = open == "export" ? nil : "export" }
                        .buttonStyle(DesktopPillButtonStyle())
                        .accessibilityIdentifier("desktop-settings.backup-export-open")
                } below: {
                    if open == "export" { exportForm.padding(.top, 8) }
                }
                row.descriptionWidth = 440
                return row
            }()
            DesktopDescribedRow(Text("Restore a backup"), description: Text("Replaces everything here, once the file is checked."), identifier: "backupRestore") {
                Button("Restore") { open = open == "import" ? nil : "import" }
                    .buttonStyle(DesktopPillButtonStyle())
                    .accessibilityIdentifier("desktop-settings.backup-restore-open")
            } below: {
                if open == "import" { restoreForm.padding(.top, 8) }
            }
        }
        .sheet(item: $shared) { file in
            DesktopShareSheet(url: file.url)
        }
        .fileImporter(isPresented: $choosing, allowedContentTypes: [.data]) { result in
            if case let .success(url) = result { file = url; preview = nil }
        }
    }

    private var exportForm: some View {
        VStack(alignment: .leading, spacing: 10) {
            passwordField(Text("Backup password"), text: $password, identifier: "desktop-settings.backup-password")
            passwordField(Text("Confirm backup password"), text: $confirm, identifier: "desktop-settings.backup-confirm")
            DesktopText("Use a password of at least 12 characters. You will need it to import this backup.", size: 12, line: 16, color: \.inkSecondary)
            DesktopText("Chats, drafts, and user files are not automatically redacted and may contain pasted secrets. Keep this backup private and save its password safely; it cannot be recovered.", size: 12, line: 16, color: \.warning)
                .fixedSize(horizontal: false, vertical: true)
            let ready = password.count >= 12 && password == confirm && !exporting
            HStack {
                Spacer(minLength: 0)
                Button(action: export) {
                    HStack(spacing: 6) {
                        if exporting { ProgressView().controlSize(.mini) } else { DesktopSettingsIconView(icon: .download, size: 13) }
                        Text(exporting ? "Creating encrypted backup…" : "Export full backup")
                    }
                }
                .buttonStyle(DesktopPillButtonStyle(primary: true))
                .disabled(!ready)
                .accessibilityIdentifier("desktop-settings.backup-export")
            }
            if let error { DesktopText(verbatim: error, size: 12, line: 16, color: \.danger) }
        }
    }

    private var restoreForm: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                DesktopText(Text("Backup file"), size: 12, color: \.inkSecondary)
                Button(file?.lastPathComponent ?? AppStrings.localized("Choose a file")) { choosing = true }
                    .buttonStyle(DesktopPillButtonStyle())
                    .accessibilityIdentifier("desktop-settings.backup-file")
            }
            if let preview {
                VStack(alignment: .leading, spacing: 4) {
                    DesktopText(Text("Validated backup"), size: 14, weight: .medium)
                    DesktopText(verbatim: [
                        preview.summary.appVersion.map { AppStrings.localized("App version") + " " + $0 },
                        "\(AppStrings.localized("Bots")): \(preview.summary.bots)",
                        "\(AppStrings.localized("Groups")): \(preview.summary.groups)",
                        "\(AppStrings.localized("Threads")): \(preview.summary.threads)",
                        "\(AppStrings.localized("Messages")): \(preview.summary.messages)",
                        "\(AppStrings.localized("Files")): \(preview.summary.files)",
                    ].compactMap { $0 }.joined(separator: " · "), size: 12, line: 16, color: \.inkSecondary)
                }
                DesktopText("This replaces everything in this installation; it does not merge. A recoverable safety backup of the current installation is kept before replacement. Restart is required.", size: 12, line: 16, color: \.danger)
                    .fixedSize(horizontal: false, vertical: true)
                DesktopText("Only restore backups you trust: instructions, skills, and bot permissions are restored too. Reconnect accounts as needed. Routines, webhooks, and calendar calls arrive paused; pending work is not resumed.", size: 12, line: 16, color: \.danger)
                    .fixedSize(horizontal: false, vertical: true)
                VStack(alignment: .leading, spacing: 4) {
                    DesktopText(Text("Type REPLACE to confirm"), size: 12, color: \.inkSecondary)
                    TextField("", text: $typed)
                        .font(theme.font(13))
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .padding(.horizontal, 10).frame(height: 32)
                        .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.border, lineWidth: 1))
                        .accessibilityIdentifier("desktop-settings.backup-replace-confirm")
                }
                HStack {
                    Spacer(minLength: 0)
                    Button { Task { await restore() } } label: {
                        Text(restoring ? "Preparing replacement…" : "Replace installation").foregroundStyle(Color.white)
                    }
                    .buttonStyle(DesktopDangerButtonStyle())
                    .disabled(restoring || !WorkspaceRestore.ready(typed))
                    .accessibilityIdentifier("desktop-settings.backup-replace")
                }
            } else {
                passwordField(Text("Password for this backup"), text: $importPassword, identifier: "desktop-settings.backup-import-password")
                HStack {
                    Spacer(minLength: 0)
                    Button("Validate backup") { Task { await check() } }
                        .buttonStyle(DesktopPillButtonStyle(primary: true))
                        .disabled(restoring || file == nil || importPassword.isEmpty)
                        .accessibilityIdentifier("desktop-settings.backup-check")
                }
            }
            if let error { DesktopText(verbatim: error, size: 12, line: 16, color: \.danger) }
        }
    }

    private func check() async {
        guard let client = model.client, let file else { return }
        restoring = true
        error = nil
        defer { restoring = false }
        do {
            let scoped = file.startAccessingSecurityScopedResource()
            defer { if scoped { file.stopAccessingSecurityScopedResource() } }
            let data = try Data(contentsOf: file)
            let id = try await client.uploadWorkspaceBackup(data)
            preview = try await client.previewWorkspaceBackup(id: id, password: importPassword)
            importPassword = ""
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func restore() async {
        guard let client = model.client, let preview, WorkspaceRestore.ready(typed) else { return }
        restoring = true
        error = nil
        defer { restoring = false }
        do {
            try await client.restoreWorkspaceBackup(id: preview.id)
            restored = true
            self.preview = nil
            typed = ""
            file = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func passwordField(_ label: Text, text: Binding<String>, identifier: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            DesktopText(label, line: 19.5)
            SecureField(text: text) { label }
                .font(theme.font(14))
                .foregroundStyle(theme.ink)
                .textContentType(.newPassword)
                .padding(.horizontal, 12)
                .frame(height: 39)
                .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
                .accessibilityIdentifier(identifier)
        }
    }

    private func export() {
        guard let client = model.client, !exporting else { return }
        exporting = true
        error = nil
        Task {
            defer { exporting = false }
            do {
                let url = try await client.exportWorkspaceBackup(password: password)
                password = ""
                confirm = ""
                shared = DesktopSharedFile(url: url)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

/// `bg-accent` when ready, the muted fill otherwise (35.5 tall).
struct DesktopBackupButtonStyle: ButtonStyle {
    @Environment(\.desktopTheme) private var theme
    let ready: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(theme.font(13, .medium))
            .foregroundStyle(ready ? theme.accentInk : theme.inkSecondary)
            .frame(height: 35.5)
            .background(ready ? theme.accent : theme.raisedHover, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .opacity(configuration.isPressed ? 0.85 : 1)
    }
}

struct DesktopSharedFile: Identifiable {
    let url: URL
    var id: String { url.path }
}

/// The share sheet for a file the iPad saved (a backup, an export).
struct DesktopShareSheet: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

/// The Jev key row: the write-only field, Save (72 wide) and Test.
struct DesktopJevKeyRow: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var model: DesktopSettingsModel
    let configured: Bool
    @State private var draft = ""
    @State private var saving = false
    @State private var testing = false
    @State private var verdict: (ok: Bool, text: String)?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                SecureField(text: $draft, prompt: Text(verbatim: configured
                    ? AppStrings.localized("Saved. Paste a new key to replace it.")
                    : AppStrings.localized("Paste your TypeSafe API key")).foregroundColor(theme.inkSecondary)) {
                    Text("Jev API key")
                }
                .font(theme.font(13))
                .foregroundStyle(theme.ink)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .onSubmit(save)
                .disabled(saving)
                .padding(.horizontal, 13)
                .frame(height: 37.5)
                .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.4), lineWidth: 1))
                .accessibilityIdentifier("desktop-settings.jev-key")
                Button(action: save) {
                    HStack(spacing: 6) {
                        if saving { ProgressView().controlSize(.mini) } else { DesktopSettingsIconView(icon: .check, size: 13) }
                        Text("Save")
                    }
                    .frame(width: 72 - 24)
                }
                .buttonStyle(DesktopButtonStyle(kind: .control, height: 37.5))
                .disabled(saving || draft.trimmingCharacters(in: .whitespaces).isEmpty)
                .accessibilityIdentifier("desktop-settings.jev-save")
                Button(action: test) {
                    Text(testing ? "Testing…" : "Test")
                        .foregroundStyle(theme.inkSecondary)
                }
                .buttonStyle(DesktopButtonStyle(kind: .outline, height: 37.5))
                .disabled(testing || saving || (draft.isEmpty && !configured))
                .accessibilityIdentifier("desktop-settings.jev-test")
            }
            if let verdict {
                DesktopText(verbatim: verdict.text, size: 12, line: 17, color: verdict.ok ? \.success : \.danger)
            }
        }
    }

    private func save() {
        let key = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty, !saving else { return }
        saving = true
        verdict = nil
        Task {
            if let error = await model.apply(.apiKey(.decider, key), key: "decider") {
                verdict = (false, error)
            } else {
                draft = ""
            }
            saving = false
        }
    }

    private func test() {
        guard let client = model.client, !testing else { return }
        testing = true
        verdict = nil
        Task {
            defer { testing = false }
            do {
                let result = try await client.testDecider(key: draft.isEmpty ? nil : draft)
                if result.ok {
                    verdict = (true, pluginsFormat("Jev answered in %@ ms.", "\(result.latencyMs ?? 0)"))
                } else {
                    verdict = (false, Self.text(result.failure ?? .other))
                }
            } catch {
                verdict = (false, error.localizedDescription)
            }
        }
    }

    static func text(_ failure: DeciderTestResult.Failure) -> String {
        switch failure {
        case .rejected: AppStrings.localized("Jev rejected this key. Check it at typesafe.ai.")
        case .unreachable: AppStrings.localized("Could not reach Jev. Check your connection.")
        case .timeout: AppStrings.localized("Jev did not answer in time. Try again.")
        case .rateLimited: AppStrings.localized("Jev is limiting requests right now. Try again in a minute.")
        case .overloaded: AppStrings.localized("Jev is overloaded right now. Try again shortly.")
        case .malformed: AppStrings.localized("Jev sent an answer Sagax could not read.")
        case .noKey: AppStrings.localized("Paste a key or save one first.")
        case .misconfigured: AppStrings.localized("The decision model address is not allowed. It must use https.")
        case let .http(status): pluginsFormat("Jev returned an unexpected error (HTTP %@).", status.map(String.init) ?? "?")
        case .other: AppStrings.localized("The test did not finish. Try again.")
        }
    }
}
