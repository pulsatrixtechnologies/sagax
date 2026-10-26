// The Settings sheet's inner pages: Account (16), Bot Computer (21),
// Auto-review Rules and the time zone picker. Geometry: measure-settings.md
// §6 and §7.
import CompanionCore
import SwiftUI
import UIKit

// MARK: - Account (16)

struct AccountSettingsView: View {
    @Environment(\.themePalette) var themePalette
    let closeSheet: (() -> Void)?

    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: SettingsModel
    @ObservedObject private var photos = AccountPhotoStore.shared
    @EnvironmentObject private var navigator: SettingsNavigator
    @State private var confirmingSignOut = false
    @State private var confirmingDelete = false
    @State private var deleting = false
    @State private var notice: Notice?

    private struct Notice: Identifiable {
        let id = UUID()
        let title: LocalizedStringKey
        let message: String
        var afterwards: (() -> Void)?
    }

    var body: some View {
        SettingsPage(title: "Account") {
            SettingsCard {
                AccountCardRow(name: model.displayName, detail: model.detail, photo: session.accountPhoto)
            }
            // Organization server: the person changes their own photo here;
            // it is written to Perspicax as them (AccountOwnPhoto.swift).
            if session.account?.ownPhotoEditable == true {
                SettingsSpacer(SettingsMetrics.cardGap)
                AccountOwnPhotoRows()
            }
            // Card bottom to the next card top: 49, the label between.
            SettingsSectionLabel(text: "Switch Account")
                .padding(.top, 0.33)
            SettingsCard {
                ForEach(session.connections) { connection in
                    let current = connection.id == session.connection?.id
                    SettingsRow(
                        title: LocalizedStringKey(stringLiteral: accountLabel(for: connection, current: current)),
                        accessory: current ? .check : .none,
                        height: 44.33,
                        identifier: "account-switch.\(connection.id)",
                        leading: AnyView(SwitchAccountPhoto(connection: connection, current: current, name: current ? model.displayName : connection.name)),
                        accessibilityValueText: switchPhoto(for: connection, current: current) == nil ? nil : "photo"
                    ) {
                        guard !current else { return }
                        closeSheet?()
                        session.switchComputer(to: connection.id)
                    }
                    CardHairline(leadingInset: SettingsMetrics.rowInset)
                }
                SettingsRow(title: "Add Account", systemImage: "plus", height: 43.67, identifier: "account-add") {
                    closeSheet?()
                    session.beginPairing()
                }
            }
            SettingsSpacer(26.67)
            SettingsCard {
                SettingsRow(title: "Sign Out", style: .destructive, height: 44.67, identifier: "account-sign-out") { confirmingSignOut = true }
            }
            SettingsSpacer(SettingsMetrics.cardGap)
            SettingsCard {
                SettingsRow(title: "Delete Account", systemImage: "trash", accessory: deleting ? .progress : .none, style: .destructive, height: 44.33, identifier: "account-delete") {
                    if !deleting { confirmingDelete = true }
                }
            }
            SettingsFooter(text: "Permanently deletes your Sagax account. This can't be undone.")
            if session.connection != nil {
                SettingsSpacer(SettingsMetrics.cardGap)
                SettingsCard {
                    // the paired computer's address, refresh and forget
                    SettingsRow(title: "Connection details", accessory: .chevron, height: 44.33, identifier: "account-connection") {
                        navigator.sheet = .connection
                    }
                }
            }
        }
        // Each saved account's own photo, read through its own server.
        .task { await session.refreshSavedAccountPhotos() }
        .confirmationDialog("Sign out of this computer?", isPresented: $confirmingSignOut, titleVisibility: .visible) {
            Button("Sign Out", role: .destructive) {
                closeSheet?()
                session.signOut()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This phone forgets this computer. Pair it again to come back.")
        }
        .confirmationDialog("Delete your account?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Delete Account", role: .destructive) { Task { await deleteAccount() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Your bots, conversations and saved settings on this server are deleted with it. This can't be undone.")
        }
        .alert(item: $notice) { notice in
            Alert(title: Text(notice.title), message: Text(verbatim: notice.message), dismissButton: .default(Text("OK")) {
                notice.afterwards?()
            })
        }
    }

    private func switchPhoto(for connection: Connection, current: Bool) -> UIImage? {
        current ? session.accountPhoto : photos.image(for: connection.id)
    }

    /// The email for the account this phone is signed in as; the computer's
    /// name for the others.
    private func accountLabel(for connection: Connection, current: Bool) -> String {
        if current, let email = model.identity?.email { return email }
        return connection.name
    }

    private func deleteAccount() async {
        guard let client = session.settingsClient, let connection = session.connection else { return }
        deleting = true
        defer { deleting = false }
        do {
            var outcome = try await client.deleteAccount()
            // 2026-10-18: Perspicax needs a sign-in of the last five minutes.
            if case .reauthRequired = outcome {
                try await AccountReauthSheet.shared.signInAgain(with: client)
                outcome = try await client.deleteAccount()
            }
            switch outcome {
            case .deleted:
                closeSheet?()
                session.forgetConnection(id: connection.id)
            case .personalServer:
                // A personal computer has no account: forget it and erase
                // what this phone keeps for it.
                notice = Notice(
                    title: "This is a personal computer",
                    message: String(localized: "There is no account on it to delete. This phone forgets the computer and erases its data for it."),
                    afterwards: {
                        closeSheet?()
                        if ParityMode.isActive { session.signOut() } else { session.forgetConnection(id: connection.id) }
                    }
                )
            case let .unavailable(message):
                notice = Notice(
                    title: "Ask your organization",
                    message: message ?? String(localized: "Your organization must delete your account in Pulsatrix Perspicax. Nothing was deleted.")
                )
            case let .reauthRequired(message):
                // Signed in again, yet still too old (a slow sheet): retry.
                notice = Notice(
                    title: "Sign in again",
                    message: message ?? String(localized: "Sign in again with Pulsatrix, then delete your account. Nothing was deleted.")
                )
            }
        } catch {
            notice = Notice(title: "Could not delete the account", message: error.localizedDescription)
        }
    }
}

/// A Switch Account row's photo: the account in use shows the session's
/// photo, the others the last one kept for them (AccountPhotoStore), else
/// their initial.
private struct SwitchAccountPhoto: View {
    let connection: Connection
    let current: Bool
    let name: String

    @EnvironmentObject private var session: Session
    @ObservedObject private var photos = AccountPhotoStore.shared

    var body: some View {
        AccountPhoto(photo: current ? session.accountPhoto : photos.image(for: connection.id), name: name, size: 28)
    }
}

enum ParityMode {
    /// True only in a DEBUG parity launch.
    static var isActive: Bool {
#if DEBUG
        ParityLaunch.current != nil
#else
        false
#endif
    }
}

// MARK: - Bot Computer (21)

struct BotComputerSettingsView: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @State private var status: ComputerStatus?
    @State private var loadError: String?
    @State private var running: Action?
    @State private var confirming: Action?
    @State private var failure: String?

    enum Action: String, Identifiable {
        case update, reset, recover
        var id: String { rawValue }
    }

    var body: some View {
        SettingsPage(title: "Bot Computer") {
            SettingsCard {
                if showsRecover {
                    SettingsRow(
                        title: "Recover computer",
                        subtitle: recoverDescription,
                        accessory: running == .recover ? .progress : .none,
                        style: .action,
                        height: 89.33,
                        identifier: "computer-recover"
                    ) { if running == nil { confirming = .recover } }
                    CardHairline(leadingInset: SettingsMetrics.rowInset)
                } else {
                    SettingsRow(
                        title: "Update Computer",
                        subtitle: "Moves your Bots' shared computer to the latest version. Files and logins stay, but installed apps and packages are removed.",
                        accessory: running == .update ? .progress : .none,
                        style: .action,
                        height: 89.33,
                        identifier: "computer-update"
                    ) { if running == nil { confirming = .update } }
                    CardHairline(leadingInset: SettingsMetrics.rowInset)
                }
                SettingsRow(
                    title: "Reset Computer",
                    subtitle: resetDescription,
                    accessory: running == .reset ? .progress : .none,
                    style: .destructive,
                    height: 74,
                    identifier: "computer-reset",
                    textTop: 13.0
                ) { if running == nil { confirming = .reset } }
            }
            .disabled(running != nil)
            SettingsFooter(text: footerText)
            SettingsCard {
                SettingsRow(title: "Disk space", accessory: .value(diskText), height: 45, identifier: "computer-disk")
            }
            ComputerMaintenanceSection()
            OtherComputersSection()
            // What the computer says is wrong ("Start docker first") comes
            // with the refusal when an action is tried; the status row
            // itself stays as in the reference.
        }
        .task { await load() }
        .confirmationDialog(confirmTitle, isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }), titleVisibility: .visible) {
            if let action = confirming {
                Button(confirmLabel(action), role: action == .reset ? .destructive : nil) {
                    Task { await run(action) }
                }
                .accessibilityIdentifier("computer-confirm")
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(confirmMessage)
        }
        .alert("Bot Computer", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(verbatim: failure ?? "")
        }
    }

    private var confirmTitle: LocalizedStringKey {
        switch confirming {
        case .reset: "Reset your Bots' computer?"
        case .recover: "Recover your Bots' computer?"
        default: "Update your Bots' computer?"
        }
    }

    private var confirmMessage: LocalizedStringKey {
        switch confirming {
        case .reset: LocalizedStringKey(resetDescription)
        case .recover: LocalizedStringKey(recoverDescription)
        default: "Installed apps and packages are removed. Files and logins stay."
        }
    }

    private func confirmLabel(_ action: Action) -> LocalizedStringKey {
        switch action {
        case .update: "Update Computer"
        case .reset: "Reset Computer"
        case .recover: "Recover computer"
        }
    }

    /// Shown instead of Update while the computer is stuck. Same route as
    /// Update: rebuild from the current image and keep files. There is no snapshot.
    private var showsRecover: Bool {
        guard let status else { return false }
        return ComputerCare.needsRecover(
            configured: status.configured, state: status.state, problem: status.problem, waking: status.waking != nil
        )
    }

    private var recoverDescription: String {
        status?.waking != nil
            ? String(localized: "Your computer is waking. If it does not come back on its own, recover it. Files stay.")
            : String(localized: "If it does not come back on its own, recover it. Files stay. Installed apps and packages are removed.")
    }

    private var resetDescription: String {
        status?.kind == .local
            ? "Rebuild from the current image. Files in your workspace folder stay."
            : "Rebuild from the latest image. Files in your workspace are erased."
    }

    private var footerText: LocalizedStringKey {
        if running == .update { return "Updating… This can take a few minutes." }
        if running == .recover { return "Recovering… This can take a few minutes." }
        if running == .reset { return "Resetting… This can take a few minutes." }
        return "The one computer your Bots share."
    }

    private var diskText: String {
        guard let status, status.configured else { return loadError == nil && status == nil ? "" : "—" }
        switch status.diskState {
        case .normal: return String(localized: "Normal")
        case .almostFull: return String(localized: "Almost full")
        case .full: return String(localized: "Full")
        }
    }

    /// A failed read is tried twice more: right after launch the first one
    /// can race the connection coming up.
    private func load() async {
        for attempt in 0..<3 {
            guard let client = session.settingsClient else { return }
            do {
                status = try await client.computerStatus()
                loadError = nil
                return
            } catch let APIError.status(code, message) {
                loadError = message ?? "HTTP \(code)"
                return
            } catch {
                loadError = error.localizedDescription
                if attempt < 2 { try? await Task.sleep(nanoseconds: 1_000_000_000) }
            }
        }
    }

    private func run(_ action: Action) async {
        guard let client = session.settingsClient else { return }
        running = action
        Haptics.impact(.light)
        do {
            switch action {
            case .update, .recover: status = try await client.updateComputer()
            case .reset: status = try await client.resetComputer()
            }
        } catch {
            failure = error.localizedDescription
        }
        running = nil
        // The action answers with the state it reached; read it once more.
        await load()
    }
}

// MARK: - Auto-review Rules

struct AutoReviewRulesView: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var model: SettingsModel

    var body: some View {
        SettingsPage(title: "Auto-review Rules", scrollable: false) {
            Group {
                if let rules = model.rules, !rules.all.isEmpty {
                    List {
                        Section {
                            ForEach(rules.all) { rule in
                                RuleRow(rule: rule)
                                    .listRowBackground(Theme.card)
                                    .listRowInsets(EdgeInsets(top: 10, leading: SettingsMetrics.rowInset, bottom: 10, trailing: SettingsMetrics.trailingInset))
                                    .listRowSeparatorTint(Theme.hairline)
                                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                        Button(role: .destructive) {
                                            Task { await model.deleteRule(rule) }
                                        } label: {
                                            Label("Delete", systemImage: "trash")
                                        }
                                    }
                                    .accessibilityIdentifier("rule.\(rule.id)")
                            }
                        } footer: {
                            Text("Each rule always allows one exact command in one folder for one bot. Swipe left to remove it.")
                                .font(Theme.Font.label)
                                .foregroundStyle(Theme.textTertiary)
                        }
                    }
                    .listStyle(.insetGrouped)
                    .scrollContentBackground(.hidden)
                    .accessibilityIdentifier("rules-list")
                } else if model.rules == nil {
                    ProgressView().tint(Theme.textSecondary).padding(.top, 40)
                } else {
                    VStack(spacing: 8) {
                        Text("No rules")
                            .font(Theme.Font.rowTitle)
                            .foregroundStyle(Theme.textPrimary)
                        Text("When you always allow a command from an approval, it shows up here.")
                            .font(Theme.Font.label)
                            .foregroundStyle(Theme.textSecondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.horizontal, 40)
                    .padding(.top, 40)
                    .accessibilityIdentifier("rules-empty")
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .task { await model.reloadRules() }
    }

    private struct RuleRow: View {
        @Environment(\.themePalette) var themePalette
        let rule: AutoReviewRule

        var body: some View {
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: rule.command)
                    .font(Theme.Font.code)
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(3)
                Text(verbatim: [rule.botName ?? String(localized: "All bots"), rule.cwd].joined(separator: " · "))
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            .accessibilityElement(children: .combine)
        }
    }
}

// MARK: - Time zone

struct TimeZonePickerView: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var model: SettingsModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.settingsPop) private var settingsPop
    @State private var query = ""

    private var zones: [String] {
        let all = TimeZone.knownTimeZoneIdentifiers.sorted()
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return all }
        let needle = trimmed.replacingOccurrences(of: " ", with: "_")
        return all.filter { $0.localizedCaseInsensitiveContains(needle) || $0.localizedCaseInsensitiveContains(trimmed) }
    }

    var body: some View {
        SettingsPage(title: "Time Zone", contentTop: 70, scrollable: false) {
            VStack(spacing: 10) {
                SettingsSearchField(prompt: "Search time zones", text: $query, identifier: "time-zone-search")
                    .padding(.horizontal, SettingsMetrics.headerInset)
                List {
                    ForEach(zones, id: \.self) { zone in
                        Button {
                            Haptics.selection()
                            Task {
                                await model.setTimeZone(zone)
                                if let settingsPop { settingsPop() } else { dismiss() }
                            }
                        } label: {
                            HStack {
                                Text(verbatim: zone.replacingOccurrences(of: "_", with: " "))
                                    .font(Theme.Font.rowTitle)
                                    .foregroundStyle(Theme.textPrimary)
                                Spacer()
                                if zone == model.timeZone {
                                    Image(systemName: "checkmark")
                                        .font(.system(size: 15, weight: .medium))
                                        .foregroundStyle(Theme.textPrimary)
                                }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .listRowBackground(Theme.card)
                        .listRowSeparatorTint(Theme.hairline)
                        .accessibilityIdentifier("time-zone.\(zone)")
                    }
                }
                .listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
                .scrollDismissesKeyboard(.immediately)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
    }
}

/// The glass search capsule: magnifier, field, measured at 40.67 pt.
struct SettingsSearchField: View {
    @Environment(\.themePalette) var themePalette
    let prompt: LocalizedStringKey
    @Binding var text: String
    var identifier: String

    var body: some View {
        HStack(spacing: 7.67) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 15.3, weight: .medium))
                .foregroundStyle(Theme.parity(Color(hex: 0x6B6B6D), Theme.placeholder))
            TextField("", text: $text, prompt: Text(prompt).foregroundColor(Theme.parity(Color(hex: 0x6C6B6F), Theme.placeholder)).tracking(SettingsMetrics.tracking135))
                .font(Theme.Font.rowTitle)
                .foregroundStyle(Theme.textPrimary)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .accessibilityIdentifier(identifier)
            if !text.isEmpty {
                Button {
                    text = ""
                } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.placeholder)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear")
            }
        }
        .offset(y: -0.33)
        .padding(.leading, 12.67)
        .padding(.trailing, 12)
        .frame(height: 40.67)
        .themeGlass(Capsule())
    }
}
