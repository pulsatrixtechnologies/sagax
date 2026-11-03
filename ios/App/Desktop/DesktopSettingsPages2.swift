// iPad lot 2b (2026-11-03): the rest of the desktop's Settings pages, as
// SettingsModal.tsx draws them, each on the route the desktop reads:
// Security (your keys, the approvals that need a key, your approval rules,
// your tool access), Vault, Notifications, Import (a Grok Bot, preference
// lines), and the Account page's time zone rows.
import SwiftUI
import UIKit
import UserNotifications
import CompanionCore

// MARK: - Security

struct DesktopSecuritySettings: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @State private var keys: SecurityKeysList?
    @State private var rules: [OwnerApprovalRule]?
    @State private var grants: [OwnToolGrant]?
    @State private var error: String?

    var body: some View {
        DesktopText(Text("Ask for a security key or a passkey (Touch ID, Face ID) before Sagax approves the actions you choose. A tap alone is then not enough."),
                    line: 19.5, color: \.inkSecondary)
        if let error { DesktopText(Text(verbatim: error), color: \.danger) }

        DesktopSettingsGroup(Text("Your keys")) {
            if let keys, !keys.keys.isEmpty {
                ForEach(keys.keys) { key in
                    DesktopSettingRow(title: Text(verbatim: key.name),
                                      subtitle: Text("Added \(Date(timeIntervalSince1970: key.createdAt / 1000).formatted(date: .abbreviated, time: .omitted))")) {
                        Button("Remove") { Task { await removeKey(key) } }
                            .buttonStyle(DesktopButtonStyle(kind: .ghost, size: 12.5, weight: .medium, height: 30, horizontal: 10))
                            .accessibilityLabel(Text("Remove \(key.name)"))
                    }
                }
            } else {
                DesktopSettingRow(title: Text("No key yet"),
                                  subtitle: Text("Add your first key from the Sagax desktop app.")) { EmptyView() }
            }
        }

        DesktopSettingsGroup(Text("Approvals that need a key")) {
            let hasKey = !(keys?.keys.isEmpty ?? true)
            DesktopText(hasKey ? Text("When one of these is on, approving that kind of action asks for one of your keys. Turning one off asks for your key too.")
                               : Text("Add a key first, then choose which approvals need it."),
                        size: 12.5, line: 18, color: \.inkSecondary)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
            ForEach(StepUpClass.allCases, id: \.self) { step in
                let on = keys?.classes.contains(step.rawValue) == true
                DesktopSettingRow(title: Self.title(step), subtitle: Self.hint(step)) {
                    DesktopSwitch(isOn: on, label: Self.title(step), identifier: "desktop-settings.security.\(step.rawValue)",
                                  disabled: keys == nil || (!hasKey && !on)) {
                        Task { await setClass(step, on: !on) }
                    }
                }
            }
        }

        DesktopSettingsGroup(Text("Your approval rules")) {
            if let rules, !rules.isEmpty {
                ForEach(rules) { rule in
                    DesktopSettingRow(title: Text(verbatim: rule.description),
                                      subtitle: Text(verbatim: [rule.botName ?? (rule.botId == nil ? String(localized: "All bots") : nil), rule.behavior == "deny" ? String(localized: "Always deny") : String(localized: "Always allow")].compactMap { $0 }.joined(separator: " · "))) {
                        Button("Remove") { Task { await removeRule(rule) } }
                            .buttonStyle(DesktopButtonStyle(kind: .ghost, size: 12.5, weight: .medium, height: 30, horizontal: 10))
                    }
                }
            } else {
                DesktopText(Text("No rules yet. Answer a card with Always allow or Always deny to add one."), size: 12.5, line: 18, color: \.inkSecondary)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
            }
        }

        DesktopSettingsGroup(Text("My tool access")) {
            if let grants, !grants.isEmpty {
                ForEach(grants) { grant in
                    DesktopSettingRow(title: Text(verbatim: grant.scope), subtitle: Text(verbatim: grant.state)) {
                        if grant.state == "active" {
                            Button("Revoke") { Task { await revoke(grant) } }
                                .buttonStyle(DesktopButtonStyle(kind: .ghost, size: 12.5, weight: .medium, height: 30, horizontal: 10))
                        }
                    }
                }
            } else {
                DesktopText(Text("No access beyond the defaults."), size: 12.5, line: 18, color: \.inkSecondary)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
            }
        }
        .task { await load() }
    }

    private func load() async {
        guard let client = session.settingsClient else { return }
        keys = try? await client.securityKeys()
        rules = (try? await client.approvalRules()) ?? []
        grants = (try? await client.ownToolGrants()) ?? []
    }

    private func setClass(_ step: StepUpClass, on: Bool) async {
        guard let client = session.settingsClient, let current = keys else { return }
        let classes = on ? current.classes + [step.rawValue] : current.classes.filter { $0 != step.rawValue }
        do { keys = try await client.setSecurityKeyClasses(classes) } catch { self.error = error.localizedDescription }
    }

    private func removeKey(_ key: SecurityKeyPublic) async {
        guard let client = session.settingsClient else { return }
        do { try await client.deleteSecurityKey(id: key.id); await load() } catch { self.error = error.localizedDescription }
    }

    private func removeRule(_ rule: OwnerApprovalRule) async {
        guard let client = session.settingsClient else { return }
        do { try await client.deleteApprovalRule(id: rule.id); await load() } catch { self.error = error.localizedDescription }
    }

    private func revoke(_ grant: OwnToolGrant) async {
        guard let client = session.settingsClient else { return }
        do { try await client.revokeOwnToolGrant(id: grant.id); await load() } catch { self.error = error.localizedDescription }
    }

    static func title(_ step: StepUpClass) -> Text {
        switch step {
        case .destructive: Text("Deleting")
        case .irreversible: Text("Actions that cannot be undone")
        case .money: Text("Money")
        case .externalSend: Text("Sending outside")
        case .alwaysGrant: Text("Always allow")
        case .publishPage: Text("Publishing a page")
        case .ruleChange: Text("Changing approval rules")
        }
    }

    static func hint(_ step: StepUpClass) -> Text {
        switch step {
        case .destructive: Text("Removing files, records or messages.")
        case .irreversible: Text("Commands Sagax cannot read as safe, a git push, a forced overwrite.")
        case .money: Text("Paying, charging, refunding or transferring.")
        case .externalSend: Text("An email, a message or a post that reaches someone else.")
        case .alwaysGrant: Text("Remembering an approval so the bot no longer asks.")
        case .publishPage: Text("Putting a page or a site online.")
        case .ruleChange: Text("A rule that allows, or a looser permission mode for a bot.")
        }
    }
}

// MARK: - Vault

/// Settings > Vault: the person's logins, payments and contacts, which bots
/// use without seeing them; a row opens the vault to edit it.
struct DesktopVaultSettings: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @State private var list: VaultList?
    @State private var failed = false
    @State private var filter = "all"
    @State private var managing = false

    var body: some View {
        HStack(spacing: 4) {
            ForEach([("all", String(localized: "All")), ("login", String(localized: "Logins")), ("payment", String(localized: "Payments")), ("contact", String(localized: "Contacts"))], id: \.0) { option in
                Button { filter = option.0 } label: {
                    DesktopText(Text(verbatim: option.1), size: 12, line: 16, color: filter == option.0 ? \.ink : \.inkSecondary)
                        .padding(.horizontal, 8)
                        .frame(minHeight: 30)
                        .background(filter == option.0 ? theme.selected : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("desktop-settings.vault.filter.\(option.0)")
            }
            Spacer(minLength: 0)
            Button("Add an item") { managing = true }
                .buttonStyle(DesktopButtonStyle(kind: .ghost, size: 12.5, weight: .medium, height: 30, horizontal: 10))
        }
        DesktopSettingsGroup {
            if failed {
                DesktopText(Text("Sign in to do this."), size: 12.5, line: 18, color: \.inkSecondary)
                    .padding(.horizontal, 14).padding(.vertical, 10)
            } else if let list {
                let items = list.items.filter { filter == "all" || Self.kind($0.kind) == filter }
                if items.isEmpty {
                    DesktopText(Text("Nothing in your vault yet."), size: 12.5, line: 18, color: \.inkSecondary)
                        .padding(.horizontal, 14).padding(.vertical, 10)
                }
                ForEach(items) { item in
                    Button { managing = true } label: {
                        DesktopSettingRow(title: Text(verbatim: item.name), subtitle: item.domains.isEmpty ? nil : Text(verbatim: item.domains.joined(separator: ", "))) {
                            DesktopSettingsIconView(icon: .chevronDown, size: 12, strokeWidth: 2.5).rotationEffect(.degrees(-90))
                                .foregroundStyle(theme.inkSecondary)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(DesktopHoverFill(radius: 0))
                }
            } else {
                ProgressView().controlSize(.small).padding(14)
            }
        }
        .task { await load() }
        .sheet(isPresented: $managing, onDismiss: { Task { await load() } }) {
            NavigationStack { VaultSettingsView() }
                .environmentObject(session)
        }
    }

    private func load() async {
        guard let client = session.settingsClient else { failed = true; return }
        do { list = try await client.vaultItems(); failed = false } catch { failed = true }
    }

    private static func kind(_ raw: String) -> String {
        switch raw {
        case "card", "payment": "payment"
        case "address", "contact", "identity": "contact"
        default: "login"
        }
    }
}

// MARK: - Notifications

/// Settings > Notifications: Alerts (the system permission, sounds, the
/// icon's count, the approval chime), Nudges, then Blocked people.
struct DesktopNotificationsSettings: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @AppStorage(NotificationSounds.key) private var sounds = true
    @AppStorage(AttentionPrefs.badgeKey) private var badge = true
    @AppStorage(AttentionPrefs.nudgeSoundKey) private var nudgeSound = true
    @AppStorage(AttentionPrefs.nudgeHapticKey) private var nudgeHaptic = true
    @AppStorage(AttentionPrefs.approvalChimeKey) private var approvalChime = true
    @AppStorage(NotificationSounds.choiceKey) private var soundChoice = NotificationSoundChoice.system.rawValue
    @State private var authorized: Bool?
    /// "Keep notifications on screen": iPadOS keeps a banner up when its
    /// style is Persistent (`alertStyle == .alert`), set in the iPad's Settings.
    @State private var persistent = false
    @State private var reports: [Moderation.Report]?
    @State private var reportsError: String?

    private var admin: Bool {
        let role = session.surfaceGate.viewer?.role
        return role == "admin" || role == "owner" || session.surfaceGate.scope == .sidecar
    }

    private var thisIPad: AnyView {
        AnyView(DesktopText(verbatim: "· " + AppStrings.localized("On this iPad"), color: \.inkSecondary).lineLimit(1))
    }

    var body: some View {
        DesktopSettingsGroup(Text("Alerts"), accessory: thisIPad, identifier: "alerts") {
            if authorized != true {
                DesktopCompactRow(Text("Let your bots notify you when something needs your attention"), identifier: "notificationInvite") {
                    Button("Enable") { Task { await enable() } }
                        .buttonStyle(DesktopButtonStyle(kind: .control))
                        .accessibilityIdentifier("desktop-settings.notifications.enable")
                }
            }
            DesktopCompactRow(Text("Notification sounds"), identifier: "notificationSounds") {
                DesktopSwitch(isOn: sounds, label: Text("Notification sounds"), identifier: "desktop-settings.notifications.sounds") {
                    sounds.toggle()
                    let value = sounds
                    Task {
                        await NotificationSounds.set(value, session: session)
                        await PushRegistrar.shared.sync()
                    }
                }
            }
            DesktopCompactRow(Text("Notification sound"), identifier: "notificationSound") {
                DesktopPillSelect(options: NotificationSoundChoice.allCases.map { ($0.rawValue, AppStrings.localized($0.label)) },
                                  selection: soundChoice, label: Text("Notification sound"), identifier: "desktop-settings.notifications.sound",
                                  disabled: !sounds) { value in
                    soundChoice = value
                    NotificationSounds.applyChoice(NotificationSoundChoice.parse(value))
                    Task { await PushRegistrar.shared.sync() }
                }
            }
            DesktopDescribedRow(Text("Keep notifications on screen"), description: Text("On the iPad, choose Persistent banners in Settings > Notifications > Sagax."), identifier: "persistentNotifications") {
                DesktopSwitch(isOn: persistent, label: Text("Keep notifications on screen"), identifier: "desktop-settings.notifications.persistent") {
                    if let url = URL(string: UIApplication.openNotificationSettingsURLString) { UIApplication.shared.open(url) }
                }
            }
            DesktopCompactRow(Text("Unread count on the app icon"), identifier: "dockBadge") {
                DesktopSwitch(isOn: badge, label: Text("Unread count on the app icon"), identifier: "desktop-settings.notifications.badge") {
                    badge.toggle()
                    NotificationCoordinator.shared.setBadge(session.state.unreadCount)
                    Task { await PushRegistrar.shared.sync() }
                }
            }
            DesktopCompactRow(Text("Chime when an approval arrives"), identifier: "approvalChime") {
                DesktopSwitch(isOn: approvalChime, label: Text("Chime when an approval arrives"), identifier: "desktop-settings.notifications.chime") {
                    approvalChime.toggle()
                    Task { await PushRegistrar.shared.sync() }
                }
            }
        }
        DesktopSettingsGroup(Text("Nudges"), accessory: thisIPad, identifier: "nudges") {
            DesktopCompactRow(Text("Nudge sound"), identifier: "nudgeSound") {
                DesktopSwitch(isOn: nudgeSound, label: Text("Nudge sound"), identifier: "desktop-settings.notifications.nudge-sound") { nudgeSound.toggle() }
            }
            DesktopCompactRow(Text("Shake on nudge"), identifier: "nudgeShake") {
                DesktopSwitch(isOn: nudgeHaptic, label: Text("Shake on nudge"), identifier: "desktop-settings.notifications.nudge-shake") { nudgeHaptic.toggle() }
            }
        }
        DesktopSettingsGroup(Text("Blocked people"), identifier: "blockedPeople") {
            if session.blockedPeople.isEmpty {
                DesktopCompactRow(Text("Nobody blocked"), identifier: "blockedPeople") { EmptyView() }
            } else {
                ForEach(session.blockedPeople, id: \.id) { person in
                    DesktopCompactRow(person.name.isEmpty ? Text("Someone") : Text(verbatim: person.name), identifier: "blocked-\(person.id)") {
                        Button("Unblock") { Task { _ = await session.unblock(person.id) } }
                        .buttonStyle(DesktopButtonStyle(kind: .control))
                    }
                }
            }
            DesktopText(Text("Their messages are hidden for you only, on all your devices."), size: 12.5, line: 18, color: \.inkSecondary)
                .padding(.horizontal, 14)
                .padding(.bottom, 8)
        }
        if admin {
            DesktopSettingsGroup(Text("Reports"), identifier: "reports") {
                let listed = Moderation.listed(reports ?? [])
                if reports != nil && !listed.contains(where: \.isOpen) {
                    DesktopCompactRow(Text("No open reports"), identifier: "reports") { EmptyView() }
                }
                ForEach(listed) { report in reportRow(report) }
                if let reportsError {
                    DesktopText(verbatim: reportsError, size: 12.5, line: 18, color: \.danger)
                        .padding(.horizontal, 14).padding(.bottom, 8)
                }
            }
        }
        Color.clear.frame(height: 0)
            .task {
                await session.loadModeration()
                let settings = await UNUserNotificationCenter.current().notificationSettings()
                authorized = settings.authorizationStatus == .authorized
                persistent = settings.alertStyle == .alert
                if admin { await loadReports() }
            }
            .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
                Task {
                    let settings = await UNUserNotificationCenter.current().notificationSettings()
                    authorized = settings.authorizationStatus == .authorized
                    persistent = settings.alertStyle == .alert
                }
            }
    }

    private func reportRow(_ report: Moderation.Report) -> some View {
        let someone = AppStrings.localized("Someone")
        let line = String(format: AppStrings.localized("%@ reported %@: %@"),
                          report.reporterName?.isEmpty == false ? report.reporterName! : someone,
                          report.reportedName?.isEmpty == false ? report.reportedName! : someone,
                          Self.reasonLabel(report.reason))
        let place = report.peopleDm == true ? AppStrings.localized("In a direct message")
            : report.groupName.map { String(format: AppStrings.localized("In %@"), $0) }
        let date = Date(timeIntervalSince1970: report.at / 1000).formatted(date: .abbreviated, time: .shortened)
        return VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 0) {
                    DesktopText(verbatim: line)
                    DesktopText(verbatim: [place, date].compactMap { $0 }.joined(separator: " · "), size: 12, line: 16, color: \.inkSecondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if report.isOpen {
                    Button("Mark handled") {
                        Task {
                            do { _ = try await session.settingsClient?.resolveReport(id: report.id); await loadReports() }
                            catch { reportsError = error.localizedDescription }
                        }
                    }
                    .buttonStyle(DesktopButtonStyle(kind: .control))
                } else {
                    DesktopText("Handled", size: 12, line: 16, color: \.inkSecondary)
                }
            }
            if let excerpt = report.excerpt, !excerpt.isEmpty {
                DesktopText(verbatim: excerpt, size: 12.5, line: 18, color: \.inkSecondary)
                    .padding(.leading, 8)
                    .overlay(alignment: .leading) { Rectangle().fill(theme.hairline).frame(width: 2) }
            }
            if let note = report.note, !note.isEmpty {
                DesktopText(verbatim: String(format: AppStrings.localized("Note: %@"), note), size: 12.5, line: 18, color: \.inkSecondary)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
    }

    static func reasonLabel(_ reason: String) -> String {
        switch reason {
        case "harassment": AppStrings.localized("Harassment or bullying")
        case "hate": AppStrings.localized("Hate speech")
        case "sexual": AppStrings.localized("Sexual content")
        case "violence": AppStrings.localized("Violence or threats")
        case "spam": AppStrings.localized("Spam or scam")
        case "privacy": AppStrings.localized("Private information")
        default: AppStrings.localized("Something else")
        }
    }

    private func loadReports() async {
        guard let client = session.settingsClient else { return }
        do {
            reports = try await client.moderationReports()
            reportsError = nil
        } catch {
            reportsError = error.localizedDescription
        }
    }

    private func enable() async {
        let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        if !granted, let url = URL(string: UIApplication.openSettingsURLString) { await UIApplication.shared.open(url) }
        authorized = granted
    }
}

// MARK: - Import

/// Settings > Import: a shared Grok Bot, then preference lines for the
/// primary bot (PreferenceImportCard.tsx).
struct DesktopImportSettings: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var shell: DesktopShellModel
    @State private var importing = false
    @State private var text = ""
    @State private var lines: [PreferenceImportLine]?
    @State private var checked: Set<String> = []
    @State private var message: String?
    @State private var busy = false

    private var primary: Bot? { session.state.bots.first { $0.chiefOfStaff == true } }

    var body: some View {
        DesktopSettingsGroup(Text("Import a Grok Bot")) {
            DesktopText(Text("Bring a shared Grok Bot into Sagax: its instructions, skills (turned off), timed routines (paused) and the apps it used. The model, the computer, logins and keys never come over; the bot uses your own engine and apps."),
                        size: 12.5, line: 18, color: \.inkSecondary)
                .padding(.horizontal, 14).padding(.vertical, 10)
            DesktopSettingRow(title: Text("Grok Bot link")) {
                Button("Read the link") { importing = true }
                    .buttonStyle(DesktopButtonStyle(kind: .ghost, size: 12.5, weight: .medium, height: 30, horizontal: 10))
                    .accessibilityIdentifier("desktop-settings.import.grok")
            }
        }
        .sheet(isPresented: $importing) {
            AgentImportSheet(close: { importing = false }) { bot in
                importing = false
                if let bot { shell.modal = nil; shell.open(.bot(bot)) }
            }
            .environmentObject(session)
        }

        DesktopSettingsGroup(Text("Import preferences")) {
            VStack(alignment: .leading, spacing: 8) {
                DesktopText(Text("Paste preference lines for your primary bot. Nothing is written until you accept the lines on the card. A line that would replace one starts unchecked."),
                            size: 12.5, line: 18, color: \.inkSecondary)
                if primary == nil {
                    DesktopText(Text("You have no primary bot yet."), size: 12.5, line: 18)
                } else {
                    TextEditor(text: $text)
                        .font(theme.font(12.5))
                        .frame(minHeight: 110)
                        .scrollContentBackground(.hidden)
                        .padding(6)
                        .background(theme.raised, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                        .accessibilityLabel(Text("Preference lines"))
                    Button("Review") { Task { await preview() } }
                        .buttonStyle(DesktopButtonStyle(kind: .ghost, size: 12.5, weight: .medium, height: 30, horizontal: 10))
                        .disabled(busy || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    if let lines {
                        if lines.isEmpty { DesktopText(Text("No preference lines in that text."), size: 12.5, line: 18, color: \.inkSecondary) }
                        ForEach(lines) { line in lineRow(line) }
                        if !lines.isEmpty {
                            Button("Apply the checked lines") { Task { await apply() } }
                                .buttonStyle(DesktopButtonStyle(kind: .ghost, size: 12.5, weight: .medium, height: 30, horizontal: 10))
                                .disabled(busy)
                        }
                    }
                }
                if let message { DesktopText(Text(verbatim: message), size: 12.5, line: 18) }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
        }
    }

    @ViewBuilder
    private func lineRow(_ line: PreferenceImportLine) -> some View {
        if line.kind == "same" {
            DesktopText(Text("Already there: \(line.text)"), size: 12.5, line: 18, color: \.inkSecondary)
        } else {
            Button {
                if checked.contains(line.id) { checked.remove(line.id) } else { checked.insert(line.id) }
            } label: {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: checked.contains(line.id) ? "checkmark.square.fill" : "square")
                        .foregroundStyle(checked.contains(line.id) ? theme.accent : theme.inkSecondary)
                    VStack(alignment: .leading, spacing: 2) {
                        DesktopText(line.kind == "add" ? Text("Add: \(line.text)") : Text("Replace: \(line.text)"), size: 12.5, line: 18)
                        if line.kind == "conflict", let existing = line.existing {
                            DesktopText(Text("Current: \(existing)"), size: 12.5, line: 18, color: \.inkSecondary)
                        }
                    }
                }
                .frame(minHeight: 32, alignment: .topLeading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }

    private func preview() async {
        guard let client = session.settingsClient, let bot = primary else { return }
        busy = true
        defer { busy = false }
        message = nil
        do {
            let found = try await client.previewPreferenceImport(botId: bot.id, text: text)
            lines = found
            checked = Set(found.filter { $0.kind == "add" }.map(\.id))
        } catch { message = String(localized: "Those preferences could not be read.") }
    }

    private func apply() async {
        guard let client = session.settingsClient, let bot = primary, let lines else { return }
        busy = true
        defer { busy = false }
        let accept = lines.filter { $0.kind != "same" && checked.contains($0.id) }.map(\.id)
        do {
            try await client.applyPreferenceImport(botId: bot.id, text: text, accept: accept)
            message = String(localized: "The checked lines were saved. The others were left as they were.")
            self.lines = nil
            text = ""
        } catch { message = String(localized: "Those preferences could not be read.") }
    }
}

// MARK: - Account: the time zone

/// Account > Appearance's time zone rows (the bots' own computer clock):
/// "Detect time zone automatically" and, under it, the zone in use.
struct DesktopTimeZoneRows: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @StateObject private var model = SettingsModel()

    var body: some View {
        Group {
            DesktopCompactRow(Text("Detect time zone automatically"), identifier: "timeZoneAuto") {
                DesktopSwitch(isOn: model.timeZoneAuto, label: Text("Detect time zone automatically"), identifier: "desktop-settings.time-zone-auto") {
                    let next = !model.timeZoneAuto
                    Task { await model.setTimeZoneAuto(next) }
                }
            }
            DesktopCompactRow(Text("Time zone"), identifier: "timeZone") {
                let current = model.timeZone ?? TimeZone.current.identifier
                // the desktop's field (`h-8 w-56 rounded-full bg-control
                // text-right`), its zones in a menu
                Menu {
                    ForEach(Self.zones, id: \.self) { zone in
                        Button {
                            Task { await model.setTimeZone(zone) }
                        } label: {
                            if zone == current { Label(zone, systemImage: "checkmark") } else { Text(verbatim: zone) }
                        }
                    }
                } label: {
                    Text(verbatim: current)
                        .font(theme.font(13))
                        .foregroundStyle(theme.ink)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                        .padding(.horizontal, 12)
                        .frame(width: 224, height: 32)
                        .background(theme.control, in: Capsule())
                }
                .disabled(model.timeZoneAuto)
                .opacity(model.timeZoneAuto ? 0.6 : 1)
                .accessibilityLabel(Text("Time zone"))
                .accessibilityValue(Text(verbatim: current))
                .accessibilityIdentifier("desktop-settings.time-zone")
            }
        }
        .task {
            model.attach(session)
            await model.load()
        }
    }

    static let zones: [String] = TimeZone.knownTimeZoneIdentifiers
}
