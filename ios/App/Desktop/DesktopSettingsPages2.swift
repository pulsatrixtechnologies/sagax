// iPad lot 2b (2026-11-03): the rest of the desktop's Settings pages, as
// SettingsModal.tsx draws them, each on the route the desktop reads:
// Security (your keys, the approvals that need a key, your approval rules,
// your tool access), Vault, Notifications, Import (a Grok Bot, preference
// lines), and the Account page's time zone rows.
import SwiftUI
import UIKit
import UserNotifications
import UniformTypeIdentifiers
import CompanionCore

// MARK: - Security

struct DesktopSecuritySettings: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @State private var keys: SecurityKeysList?
    @State private var rules: [OwnerApprovalRule]?
    @State private var grants: [OwnToolGrant]?
    @State private var error: String?

    @State private var name = ""
    @State private var busy = false
    @State private var notice: String?

    private var httpsServer: Bool { session.settingsClient?.connection.baseURL?.scheme == "https" }

    var body: some View {
        DesktopText(Text("Ask for a security key or a passkey (Touch ID, Face ID) before Sagax approves the actions you choose. A tap alone is then not enough."),
                    color: \.inkSecondary)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.bottom, 4)
        if let error { DesktopSettingsNotice(Text(verbatim: error), color: \.danger) }
        if keys?.unreadable == true { DesktopSettingsNotice(Text("Your saved security keys could not be read on the server, so sensitive approvals are refused until it is repaired."), color: \.danger) }
        if let notice { DesktopSettingsNotice(Text(verbatim: notice), color: \.success) }

        DesktopSettingsGroup(Text("Your keys"), identifier: "security.keys") {
            if let keys {
                ForEach(keys.keys) { key in
                    DesktopDescribedRow(Text(verbatim: key.name), description: Text(verbatim: keyLine(key, list: keys)), identifier: "security-key-\(key.id.prefix(12))") {
                        Button { Task { await removeKey(key) } } label: {
                            HStack(spacing: 4) {
                                DesktopSettingsIconView(icon: .trash2, size: 13)
                                Text("Remove")
                            }
                        }
                        .buttonStyle(DesktopButtonStyle(kind: .control))
                        .disabled(busy)
                        .accessibilityLabel(Text(verbatim: String(format: AppStrings.localized("Remove %@"), key.name)))
                    }
                }
                if keys.keys.isEmpty {
                    DesktopDescribedRow(Text("No key yet"), identifier: "security-keys-none") { EmptyView() }
                }
                if keys.needsSignIn == true {
                    // the first key needs a fresh Pulsatrix sign-in; a server
                    // without one says so, as the desktop does
                    DesktopDescribedRow(
                        Text("Sign in again to add your first key"),
                        description: session.surfaceGate.organization
                            ? Text("For your safety, the first key needs a Pulsatrix sign-in from the last 15 minutes, with your password or passkey. An email code does not count. You come back to this page afterwards.")
                            : Text("This server offers no Pulsatrix sign-in, and an email code does not count. Add your first key from the Sagax desktop app."),
                        identifier: "security-keys-reauth"
                    ) { EmptyView() }
                } else {
                    DesktopDescribedRow(
                        Text("Add a security key or a passkey"),
                        description: httpsServer ? Text("A hardware key (such as a YubiKey), or a passkey on this device.")
                                                 : Text("Security keys need this page on https, or the desktop app on this computer."),
                        identifier: "security-keys-add"
                    ) {
                        TextField(text: $name, prompt: Text("My key").foregroundColor(theme.inkSecondary)) { Text("Key name") }
                            .font(theme.font(13))
                            .padding(.horizontal, 10)
                            .frame(width: 160, height: 32)
                            .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.border, lineWidth: 1))
                            .submitLabel(.done)
                            .onSubmit { Task { await addKey() } }
                            .disabled(busy)
                            .accessibilityIdentifier("desktop-settings.security.key-name")
                        Button("Add a key") { Task { await addKey() } }
                            .buttonStyle(DesktopButtonStyle(kind: .accent))
                            .disabled(busy || !httpsServer)
                            .accessibilityIdentifier("desktop-settings.security.add-key")
                    }
                }
            }
        }

        DesktopSettingsGroup(Text("Approvals that need a key"), identifier: "security.classes") {
            let hasKey = !(keys?.keys.isEmpty ?? true)
            DesktopSettingsTextRow(hasKey ? Text("When one of these is on, approving that kind of action asks for one of your keys. Turning one off asks for your key too.")
                                          : Text("Add a key first, then choose which approvals need it."))
            if hasKey, keys?.keyHere == false {
                DesktopSettingsTextRow(Text("None of your keys works on this address, so these approvals will be refused here. Add a key from this address."), color: \.warning)
            }
            ForEach(StepUpClass.allCases, id: \.self) { step in
                let on = keys?.classes.contains(step.rawValue) == true
                DesktopDescribedRow(Self.title(step), description: Self.hint(step), identifier: "security-class-\(step.rawValue)") {
                    DesktopSwitch(isOn: on, label: Self.title(step), identifier: "desktop-settings.security.\(step.rawValue)",
                                  disabled: busy || keys == nil || (!hasKey && !on)) {
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

    private func keyLine(_ key: SecurityKeyPublic, list: SecurityKeysList) -> String {
        func day(_ at: Double) -> String { Date(timeIntervalSince1970: at / 1000).formatted(date: .abbreviated, time: .omitted) }
        return [
            key.deviceType == "multiDevice" ? AppStrings.localized("Passkey") : AppStrings.localized("Security key"),
            String(format: AppStrings.localized("Added %@"), day(key.createdAt)),
            key.lastUsedAt.map { String(format: AppStrings.localized("last used %@"), day($0)) },
            list.rpId != nil && key.rpId != nil && key.rpId != list.rpId ? String(format: AppStrings.localized("works on %@"), key.rpId!) : nil,
        ].compactMap { $0 }.joined(separator: " · ")
    }

    /// Add a key (`registerSecurityKey`): the server's ceremony page in the
    /// system's web sheet, where iPadOS offers the passkey or the key.
    private func addKey() async {
        guard let client = session.settingsClient, !busy else { return }
        busy = true
        error = nil
        notice = nil
        defer { busy = false }
        do {
            let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
            switch try await client.startSecurityKey(name: trimmed.isEmpty ? AppStrings.localized("Security key") : trimmed) {
            case .needsSignIn:
                keys?.needsSignIn = true
            case let .ceremony(start):
                guard let page = client.stepUpPageURL(start) else {
                    error = AppStrings.localized("Security keys need this page on https, or the desktop app on this computer.")
                    return
                }
                if try await SecurityKeyStepUp.shared.open(page: page, ceremonyId: start.ceremonyId) {
                    name = ""
                    notice = AppStrings.localized("Key added.")
                }
                await load()
            }
        } catch {
            self.error = error.localizedDescription
            await load()
        }
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

    @State private var failure: String?

    var body: some View {
        // the desktop's states (CredentialsSettings.tsx): nothing read yet is
        // the loading line or the error alone; the page once it answers
        if list == nil {
            Group {
                if failed {
                    DesktopSettingsNotice(failure.map { Text(verbatim: $0) } ?? Text("Sign in to do this."), color: \.danger)
                } else {
                    DesktopText(Text("Loading your vault…"), color: \.inkSecondary).padding(.bottom, 4)
                }
            }
            .task { await load() }
        } else if let list {
            DesktopText(Text("Logins, API keys and notes your bots can use without seeing them. A bot fills a login into its browser only on the sites you set, and only after you allow it."),
                        color: \.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, 4)
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
                    .buttonStyle(DesktopButtonStyle(kind: .control))
            }
            DesktopSettingsGroup {
                let items = list.items.filter { filter == "all" || Self.kind($0.kind) == filter }
                if items.isEmpty {
                    DesktopSettingsTextRow(Text("Nothing in your vault yet."))
                }
                ForEach(items) { item in
                    Button { managing = true } label: {
                        DesktopDescribedRow(Text(verbatim: item.name), description: item.domains.isEmpty ? nil : Text(verbatim: item.domains.joined(separator: ", "))) {
                            DesktopSettingsIconView(icon: .chevronRight, size: 14).foregroundStyle(theme.inkSecondary)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(DesktopHoverFill(radius: 0))
                }
            }
            .sheet(isPresented: $managing, onDismiss: { Task { await load() } }) {
                NavigationStack { VaultSettingsView() }
                    .environmentObject(session)
            }
        }
    }

    private func load() async {
        guard let client = session.settingsClient else { failed = true; return }
        do {
            list = try await client.vaultItems()
            failed = false
        } catch {
            failed = true
            // the server's own sentence (server-error-text.ts), else the desktop's no_person line
            if case let APIError.status(_, message?) = error, !message.isEmpty, !message.lowercased().contains("person") {
                failure = message
            } else {
                failure = nil
            }
        }
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

    @State private var link = ""
    @State private var reply = ""
    @State private var marketplaceSlug: String?
    @State private var staged = ""
    @State private var copied = false
    @State private var grokError: String?
    @State private var choosingFile = false

    private var primary: Bot? { session.state.bots.first { $0.chiefOfStaff == true } }

    private func box(_ content: some View) -> some View {
        content
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(theme.inset, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(theme.hairline.opacity(0.4), lineWidth: 1))
    }

    var body: some View {
        // Settings > Import (ImportSettings.tsx, GrokImportBox.tsx): the link,
        // the two steps with Copy export prompt, the reply box, Preview and
        // Choose a .json file; the preview and Add are the import sheet's
        DesktopSettingsGroup(Text("Import a Grok Bot"), identifier: "import") {
            VStack(alignment: .leading, spacing: 12) {
                DesktopText(Text("Bring a shared Grok Bot into Sagax: its instructions, skills (turned off), timed routines (paused) and the apps it used. The model, the computer, logins and keys never come over; the bot uses your own engine and apps."),
                            size: 12.5, line: 20, color: \.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 8) {
                    box(TextField(text: $link, prompt: Text(verbatim: "https://x.ai/bot/...").foregroundColor(theme.inkSecondary)) { Text("Grok Bot link") }
                        .font(theme.font(13))
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.go)
                        .onSubmit { readLink() })
                        .accessibilityIdentifier("desktop-settings.import.link")
                    Button("Read the link") { readLink() }
                        .buttonStyle(DesktopButtonStyle(kind: .control, size: 12))
                        .disabled(link.trimmingCharacters(in: .whitespaces).isEmpty)
                        .accessibilityIdentifier("desktop-settings.import.grok")
                }
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        DesktopText(verbatim: "1. " + AppStrings.localized("Copy the export prompt and send it to your own Grok Bot."), size: 12.5, line: 20, color: \.inkSecondary)
                        Button { Task { await copyPrompt() } } label: {
                            HStack(spacing: 6) {
                                DesktopSettingsIconView(icon: copied ? .check : .copy, size: 12)
                                Text(copied ? "Copied" : "Copy export prompt")
                            }
                        }
                        .buttonStyle(DesktopButtonStyle(kind: .control, size: 12))
                        .accessibilityIdentifier("desktop-settings.import.copy-prompt")
                    }
                    DesktopText(verbatim: "2. " + AppStrings.localized("Paste its reply below, or choose the .json file you saved it in."), size: 12.5, line: 20, color: \.inkSecondary)
                }
                .padding(.leading, 6)
                ZStack(alignment: .topLeading) {
                    TextEditor(text: $reply)
                        .font(.system(size: 12, design: .monospaced))
                        .scrollContentBackground(.hidden)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .frame(minHeight: 96)
                        .accessibilityLabel(Text("Grok Bot's reply"))
                        .accessibilityIdentifier("desktop-settings.import.reply")
                    if reply.isEmpty {
                        Text("Paste the JSON reply here")
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundStyle(theme.inkSecondary)
                            .padding(.top, 8).padding(.leading, 5)
                            .allowsHitTesting(false)
                    }
                }
                .padding(.horizontal, 6).padding(.vertical, 2)
                .background(theme.inset, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(theme.hairline.opacity(0.4), lineWidth: 1))
                HStack(spacing: 8) {
                    Button("Preview") { staged = reply; importing = true }
                        .buttonStyle(DesktopButtonStyle(kind: .control, size: 12))
                        .disabled(reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityIdentifier("desktop-settings.import.preview")
                    Button { choosingFile = true } label: {
                        HStack(spacing: 6) {
                            DesktopSettingsIconView(icon: .fileUp, size: 12)
                            Text("Choose a .json file")
                        }
                    }
                    .buttonStyle(DesktopButtonStyle(kind: .control, size: 12))
                    .accessibilityIdentifier("desktop-settings.import.file")
                }
                if let grokError { DesktopText(verbatim: grokError, size: 12, line: 16, color: \.danger) }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
        }
        .sheet(isPresented: $importing, onDismiss: { marketplaceSlug = nil }) {
            AgentImportSheet(close: { importing = false }, imported: { bot in
                importing = false
                if let bot { shell.modal = nil; shell.open(.bot(bot)) }
            }, initialReply: staged, marketplaceSlug: marketplaceSlug)
            .environmentObject(session)
        }
        .fileImporter(isPresented: $choosingFile, allowedContentTypes: [.json, .plainText]) { result in
            guard case let .success(url) = result else { return }
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            guard let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= 4 * 1024 * 1024 else {
                grokError = AppStrings.localized("That file is larger than 4 MB.")
                return
            }
            guard let text = try? String(contentsOf: url, encoding: .utf8) else { return }
            reply = text
            staged = text
            importing = true
        }

        DesktopSettingsGroup(Text("Import preferences"), identifier: "preference-import") {
            VStack(alignment: .leading, spacing: 8) {
                DesktopText(Text("Paste preference lines for your primary bot. Nothing is written until you accept the lines on the card. A line that would replace one starts unchecked."),
                            size: 12.5, line: 18, color: \.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                if primary == nil {
                    DesktopText(Text("You have no primary bot yet."), size: 12.5, line: 18)
                }
                TextEditor(text: $text)
                    .font(theme.font(12.5))
                    .frame(minHeight: 110)
                    .scrollContentBackground(.hidden)
                    .padding(6)
                    .background(theme.raised, in: RoundedRectangle(cornerRadius: 4, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).strokeBorder(theme.hairline.opacity(0.6), lineWidth: 1))
                    .accessibilityLabel(Text("Preference lines"))
                    .accessibilityIdentifier("desktop-settings.import.preferences")
                Button { Task { await preview() } } label: {
                    DesktopText(Text("Review the preference lines"), size: 12.5, color: \.accent)
                }
                .buttonStyle(DesktopHoverFill(radius: 4))
                .disabled(busy || primary == nil || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .opacity(busy || primary == nil || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.4 : 1)
                if let lines {
                    if lines.isEmpty { DesktopText(Text("No preference lines in that text."), size: 12.5, line: 18, color: \.inkSecondary) }
                    ForEach(lines) { line in lineRow(line) }
                    if !lines.isEmpty {
                        Button { Task { await apply() } } label: { DesktopText(Text("Apply the checked lines"), size: 12.5, color: \.accent) }
                            .buttonStyle(DesktopHoverFill(radius: 4))
                            .disabled(busy)
                    }
                }
                if let message { DesktopText(Text(verbatim: message), size: 12.5, line: 18) }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
        }
    }

    /// "Read the link": a marketplace page is staged at once; a share
    /// link's bot comes over through its export prompt (the steps below).
    private func readLink() {
        grokError = nil
        let value = link.trimmingCharacters(in: .whitespacesAndNewlines)
        if let slug = GrokLink.marketplaceSlug(value) {
            marketplaceSlug = slug
            staged = ""
            importing = true
        } else if GrokLink.shareId(value) == nil {
            grokError = AppStrings.localized("Paste a Grok Bot link, like https://x.ai/bot/... or a Grok Bot marketplace page.")
        } else {
            grokError = "1. " + AppStrings.localized("Copy the export prompt and send it to your own Grok Bot.")
        }
    }

    private func copyPrompt() async {
        grokError = nil
        do {
            guard let prompt = try await session.profileClient?.agentImportPrompt() else { return }
            UIPasteboard.general.string = prompt
            copied = true
        } catch {
            grokError = AppStrings.localized("The prompt could not be copied. Select it from the docs instead.")
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
