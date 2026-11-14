// The Settings pages drawn from SettingsTree (2026-10-26, the reference app
// layout): the root's cards, Bots, Privacy and security, and About. Each
// row keeps the identifier it had before the layout changed.
import CompanionCore
import SwiftUI
import UIKit

extension Session {
    /// The tree's context for this pairing.
    var settingsContext: SettingsContext {
        SettingsContext(gate: surfaceGate, connected: connection != nil, ownPhoto: account?.ownPhotoEditable == true)
    }
}

/// A tree page's cards, with the gap (or a label) between them.
struct SettingsTreeCards: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    let page: SettingsPageID
    var closeSheet: (() -> Void)?

    var body: some View {
        let cards = SettingsTree.cards(page, session.settingsContext)
        ForEach(Array(cards.enumerated()), id: \.offset) { index, card in
            if let label = Self.label(page, card) {
                SettingsSectionLabel(text: label)
            } else if index > 0 {
                SettingsSpacer(SettingsMetrics.cardGap)
            }
            switch card {
            // These two are cards of their own (PrivacySettings.swift).
            case [.presence]: PrivacyPresenceCard()
            case [.readReceipts]: ReadReceiptsCard()
            default:
                SettingsCard {
                    ForEach(Array(card.enumerated()), id: \.element) { position, item in
                        if position > 0 { CardHairline(leadingInset: SettingsMetrics.rowInset) }
                        SettingsTreeRow(item: item, closeSheet: closeSheet)
                    }
                }
            }
            if let footer = Self.footer(page, card) {
                SettingsFooter(text: footer)
            }
        }
    }

    /// The few labels the pages keep: the root's "Bot", as reference app's sheet.
    private static func label(_ page: SettingsPageID, _ card: [SettingsItem]) -> LocalizedStringKey? {
        switch (page, card.first) {
        // The reference's Bot card (#4103), with or without a pairing
        case (.root, _) where card.contains(.callVoice): "Bot"
        case (.privacySecurity, .presence?): "Privacy"
        default: nil
        }
    }

    private static func footer(_ page: SettingsPageID, _ card: [SettingsItem]) -> LocalizedStringKey? {
        switch (page, card.first) {
        case (.privacySecurity, .securityKeys?): "Security keys confirm what matters. The vault keeps cards and passwords your bots may use."
        default: nil
        }
    }
}

/// One row of the tree.
struct SettingsTreeRow: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: SettingsModel
    @EnvironmentObject private var navigator: SettingsNavigator
    @ObservedObject private var themes = ThemeStore.shared
    @AppStorage(PrefKey.language) private var language = AppLanguage.system.rawValue
    @AppStorage(PrefKey.haptics) private var haptics = true
    @State private var confirmingSignOut = false
    let item: SettingsItem
    var closeSheet: (() -> Void)?

    var body: some View {
        switch item {
        // Root
        case .profile:
            AccountCardRow(name: model.displayName, detail: model.detail, photo: session.accountPhoto, chevron: true) { navigator.push(.account) }
        case .usage:
            SettingsRow(title: "Usage", accessory: model.usagePercent.map { .valueChevron("\($0)%") } ?? .chevron, identifier: "settings-usage") { navigator.push(.usage) }
        case .organization:
            SettingsRow(title: "Organization", accessory: .chevron, identifier: "settings-organization") { navigator.sheet = .organization }
        case .bots:
            // The reference's Permissions row (#4103): the review mode and
            // how many rules, the approvals one level in
            SettingsRow(title: "Permissions", subtitle: permissionsLine, accessory: .chevron,
                        identifier: "settings-bots") { navigator.push(.bots) }
        case .connectApps:
            // The reference app's "Connect apps" (2026-11-01): plugins, with the tools
            // and skills they resolve to
            SettingsRow(title: "Connect apps", subtitle: "Search plugins", accessory: .chevron,
                        identifier: "settings-plugins") { navigator.push(.plugins) }
        case .publishedPages:
            SettingsRow(title: "Published pages", accessory: .chevron, identifier: "settings-pages") { navigator.push(.pages) }
        case .notifications:
            SettingsRow(title: "Notifications", accessory: .valueChevron(SystemNotificationsRow.isOn(session) ? String(localized: "On") : String(localized: "Off")), identifier: "settings-notifications") { navigator.push(.notifications) }
        case .appearance:
            SettingsRow(title: "Appearance", accessory: .valueChevron(appearanceValue), identifier: "settings-appearance") { navigator.push(.appearance) }
        case .language:
            SettingsRow(title: "Language", accessory: .valueChevron(AppLanguage.resolved(language).shortLabel), identifier: "settings-language") { navigator.push(.language) }
        case .haptics:
            SettingsRow(title: "Haptics", accessory: .valueChevron(haptics ? String(localized: "On") : String(localized: "Off")), identifier: "settings-haptics") { navigator.push(.haptics) }
        case .privacySecurity:
            SettingsRow(title: "Privacy and security", accessory: .chevron, identifier: "settings-privacy-security") { navigator.push(.privacySecurity) }
        case .helpCenter:
            SettingsLinkRow(title: "Help Center", identifier: "settings-help") { SettingsLinks.helpCenter(french: $0) }
        case .sendFeedback:
            SettingsFeedbackRow(height: 44)
        case .about:
            SettingsRow(title: "About", accessory: .chevron, identifier: "settings-about") { navigator.push(.about) }
        case .signOut:
            SettingsRow(title: "Sign Out", style: .destructive, identifier: "settings-sign-out") { confirmingSignOut = true }
                .confirmationDialog("Sign out of this computer?", isPresented: $confirmingSignOut, titleVisibility: .visible) {
                    Button("Sign Out", role: .destructive) {
                        closeSheet?()
                        session.signOut()
                    }
                    Button("Cancel", role: .cancel) {}
                } message: {
                    Text("This phone forgets this computer. Pair it again to come back.")
                }
        // Bots
        case .autoReviewRules:
            SettingsRow(title: "Auto-review Rules", accessory: .valueChevron(model.rules.map { "\($0.total)" } ?? ""), identifier: "settings-rules") {
                navigator.push(.rules)
            }
        case .approvalRules:
            SettingsRow(title: "Approval rules", accessory: .chevron, identifier: "settings-approval-grants") { navigator.push(.approvalGrants) }
        case .actionJournal:
            SettingsRow(title: "Journal of actions", accessory: .chevron, identifier: "settings-action-journal") { navigator.push(.actionJournal) }
        case .reachMe:
            SettingsRow(title: "Reach me", subtitle: "How each bot reaches you outside the app, and when.", accessory: .chevron,
                        identifier: "settings-reach-me") { navigator.push(.reachMe) }
        case .myEngines:
            SettingsRow(title: "My engines", subtitle: "Sign in to your own subscription on the engines your organization offers.", accessory: .chevron,
                        identifier: "settings-my-engines") { navigator.push(.myEngines) }
        case .timeZoneAuto:
            SettingsRow(
                title: "Set Time Zone Automatically",
                subtitle: "Your Bot's computer follows this device's time zone.",
                accessory: .toggle(Binding(get: { model.timeZoneAuto }, set: { on in Task { await model.setTimeZoneAuto(on) } })),
                identifier: "settings-time-zone-auto")
        case .timeZone:
            if model.timeZoneAuto {
                SettingsRow(title: "Time Zone", accessory: .value(model.timeZone ?? ""), identifier: "settings-time-zone")
            } else {
                SettingsRow(title: "Time Zone", accessory: .valueChevron(model.timeZone ?? ""), identifier: "settings-time-zone") {
                    navigator.push(.timeZone)
                }
            }
        case .botComputer:
            SettingsRow(title: "Bot Computer", accessory: .chevron, identifier: "settings-bot-computer") { navigator.push(.botComputer) }
        case .quickReplies:
            SettingsRow(title: "Quick Replies", accessory: .chevron, identifier: "settings-quick-replies") { navigator.sheet = .quickReplies }
        case .callVoice:
            SettingsRow(title: "Call voice", accessory: .chevron, identifier: "settings-walkie-voice") { navigator.sheet = .walkieVoice }
        case .experimental:
            SettingsRow(title: "Developer", accessory: .chevron, identifier: "settings-experimental") { navigator.push(.experimental) }
        // Privacy and security
        case .securityKeys:
            SettingsRow(title: "Security keys", accessory: .chevron, identifier: "settings-security-keys") { navigator.push(.securityKeys) }
        case .vault:
            SettingsRow(title: "Vault", subtitle: "Logins, cards and contact info your bots can use", accessory: .chevron,
                        identifier: "settings-vault") { navigator.push(.vault) }
        case .presence, .readReceipts:
            EmptyView()  // drawn as their own cards by SettingsTreeCards
        // About
        case .version:
            SettingsRow(title: "Version", accessory: .value("\(AboutPage.version) (\(AboutPage.build))"), identifier: "settings-version")
        case .privacyPolicy:
            SettingsLinkRow(title: "Privacy Policy", identifier: "settings-privacy") { SettingsLinks.privacy(french: $0) }
        case .termsOfService:
            SettingsLinkRow(title: "Terms of Service", identifier: "settings-terms") { SettingsLinks.terms(french: $0) }
        case .sagaxTerms:
            SettingsLinkRow(title: "Sagax Terms", identifier: "settings-sagax-terms") { _ in SettingsLinks.sagaxTerms }
        // Account: drawn by AccountSettingsView itself.
        case .accountPhoto, .switchAccount, .addAccount, .accountSignOut, .deleteAccount, .connectionDetails:
            EmptyView()
        }
    }

    /// "20 rules": the Permissions row's second line. The reference's
    /// "Auto-review on" part has no Sagax counterpart since #4200 (one
    /// approval level per bot), so only the count shows.
    private var permissionsLine: String? {
        model.rules.map { String.localizedStringWithFormat(AppStrings.localized("%lld rules"), $0.total) }
    }

    /// "System · Black": how the skin is chosen, then the one worn now.
    private var appearanceValue: String {
        let mode: String
        switch themes.effective.mode {
        case .system: mode = String(localized: "System")
        case .fixed: mode = String(localized: "Fixed")
        case .computer: mode = String(localized: "Computer")
        }
        return "\(mode) · \(themePalette.id.name)"
    }
}

// MARK: - Sub-pages

/// Settings > Permissions (#4103): auto-review, its rules, the approval
/// rules and the journal of actions. The rest of the bots' settings sit in
/// the root's Bot card.
struct BotsSettingsView: View {
    @Environment(\.themePalette) var themePalette

    var body: some View {
        SettingsPage(title: "Permissions") {
            SettingsTreeCards(page: .bots)
        }
    }
}

/// Settings > Privacy and security: security keys, the vault, and on an
/// organization server presence and read receipts.
struct PrivacySecuritySettingsView: View {
    @Environment(\.themePalette) var themePalette

    var body: some View {
        SettingsPage(title: "Privacy and security") {
            SettingsTreeCards(page: .privacySecurity)
            PhonePermissionsCard()
            BlockedPeopleCard()
        }
    }
}

/// Settings > Privacy and security > Blocked people (App Store 1.2,
/// Session+Moderation.swift): the people this person blocked, each with
/// Unblock. Personal, and the same list on every device of theirs.
struct BlockedPeopleCard: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session

    var body: some View {
        SettingsSectionLabel(text: "Blocked people")
        SettingsCard {
            if session.blockedPeople.isEmpty {
                SettingsRow(title: "Nobody blocked", identifier: "blocked-none")
            } else {
                ForEach(Array(session.blockedPeople.enumerated()), id: \.element.id) { index, person in
                    if index > 0 { CardHairline(leadingInset: SettingsMetrics.rowInset) }
                    SettingsRow(title: "\(person.name)", accessory: .value(String(localized: "Unblock")), style: .action, identifier: "blocked-person") {
                        Task { _ = await session.unblock(person.id) }
                    }
                }
            }
        }
        SettingsFooter(text: "Their messages in rooms and direct messages are hidden for you only, on all your devices. Tap someone to unblock them.")
            .task { await session.loadModeration() }
    }
}

/// Settings > About: the same page as the account menu's About (the
/// version, release notes, links and the legal pages), so the search and
/// the tree open one About.
struct AboutSettingsView: View {
    var body: some View { AboutPage() }
}
