// Settings search (matrix ST11): the field at the top of Settings finds any
// page by its name or the desktop's keywords for it (SettingsDestination),
// the way the desktop's Settings filters its sections, and opens it.
import CompanionCore
import SwiftUI

struct SettingsSearchResults: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    let query: String
    let open: (SettingsDestination) -> Void

    var body: some View {
        let results = SettingsSearch.results(query, available: available, label: Self.label)
        if results.isEmpty {
            Text("Nothing matches “\(query.trimmingCharacters(in: .whitespacesAndNewlines))”")
                .font(Theme.Font.rowTitle)
                .foregroundStyle(Theme.textSecondary)
                .frame(maxWidth: .infinity)
                .padding(.top, 24)
                .accessibilityIdentifier("settings-search-empty")
        } else {
            SettingsCard {
                ForEach(Array(results.enumerated()), id: \.element) { index, destination in
                    if index > 0 { CardHairline(leadingInset: SettingsMetrics.rowInset) }
                    SettingsRow(
                        title: LocalizedStringKey(stringLiteral: Self.label(destination)),
                        systemImage: Self.symbol(destination),
                        accessory: .chevron,
                        identifier: "settings-search.\(destination.rawValue)"
                    ) { open(destination) }
                }
            }
        }
    }

    /// The pages this pairing shows.
    private var available: [SettingsDestination] {
        let gate = session.surfaceGate
        let connected = session.connection != nil
        let sections = NavigationMenus.settings(
            gate: gate, connected: connected,
            achievementsAvailable: AchievementStore.shared.status != .unavailable
        )
        return SettingsDestination.allCases.filter { destination in
            switch destination {
            case .organization: return sections.contains(.organization)
            case .achievements: return sections.contains(.achievements)
            case .privacy: return NavigationMenus.showsPrivacy(gate: gate, connected: connected)
            case .experimental: return sections.contains(.experimental)
            case .plugins, .botComputer, .pages, .usage, .rules, .approvalGrants, .timeZone, .credentials, .securityKeys: return connected
            default: return true
            }
        }
    }

    static func label(_ destination: SettingsDestination) -> String {
        switch destination {
        case .general: String(localized: "General")
        case .organization: String(localized: "Organization")
        case .appearance: String(localized: "Appearance")
        case .achievements: String(localized: "Achievements")
        case .notifications: String(localized: "Notifications")
        case .privacy: String(localized: "Privacy")
        case .experimental: String(localized: "Experimental")
        case .plugins: String(localized: "Connect apps")
        case .account: String(localized: "Account")
        case .botComputer: String(localized: "Bot Computer")
        case .pages: String(localized: "Published pages")
        case .usage: String(localized: "Usage")
        case .rules: String(localized: "Auto-review Rules")
        case .approvalGrants: String(localized: "Approval rules")
        case .timeZone: String(localized: "Time Zone")
        case .language: String(localized: "Language")
        case .haptics: String(localized: "Haptics")
        case .quickReplies: String(localized: "Quick Replies")
        case .walkieVoice: String(localized: "Call voice")
        case .about: String(localized: "About")
        case .credentials: String(localized: "Vault")
        case .securityKeys: String(localized: "Security keys")
        }
    }

    static func symbol(_ destination: SettingsDestination) -> String {
        switch destination {
        case .general: "gearshape"
        case .organization: "building.2"
        case .appearance: "paintpalette"
        case .achievements: "trophy"
        case .notifications: "bell"
        case .privacy: "hand.raised"
        case .experimental: "flask"
        case .plugins: "puzzlepiece.extension"
        case .account: "person.crop.circle"
        case .botComputer: "desktopcomputer"
        case .pages: "doc.richtext"
        case .usage: "chart.bar"
        case .rules: "checklist"
        case .approvalGrants: "checkmark.shield"
        case .timeZone: "clock"
        case .language: "globe"
        case .haptics: "speaker.wave.2"
        case .quickReplies: "bolt"
        case .walkieVoice: "waveform"
        case .about: "info.circle"
        case .credentials: "key"
        case .securityKeys: "lock"
        }
    }
}

/// The Settings pages drawn as lists of their own (a navigation bar, a
/// Done button), opened in a sheet over Settings.
enum SettingsSheetPage: String, Identifiable {
    case organization, achievements, quickReplies, walkieVoice, about, connection
    var id: String { rawValue }
}

struct SettingsSheetPageView: View {
    let page: SettingsSheetPage
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        if page == .walkieVoice {
            WalkieVoiceSheet(onSample: {})
        } else {
            NavigationStack {
                content
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button(String(localized: "Done")) { dismiss() }
                                .accessibilityIdentifier("settings-sheet-done")
                        }
                    }
            }
        }
    }

    private var content: AnyView {
        switch page {
        case .organization: AnyView(OrganizationSettingsPage())
        case .achievements: AnyView(AchievementsPage())
        case .quickReplies: AnyView(QuickRepliesEditor())
        case .about: AnyView(AboutPage())
        case .connection: AnyView(ConnectionSecurityView())
        case .walkieVoice: AnyView(EmptyView())
        }
    }
}
