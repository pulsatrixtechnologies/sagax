// Settings > Privacy (#167; matrix DC11): "Show when I am online", the
// synced preference `sagax.presenceVisible.v1` ("0" hides). Hidden, the
// person reads as offline with no last-seen time for everyone, admins
// included; they still see their own state "(hidden from others)".
// Organization servers only. Since #518 it is a card of Settings >
// Notifications (`PrivacyPresenceCard`); the page stays for old links.
import CompanionCore
import SwiftUI

struct PrivacySettingsView: View {
    @Environment(\.themePalette) var themePalette

    static let key = "sagax.presenceVisible.v1"

    var body: some View {
        SettingsPage(title: "Privacy") {
            PrivacyPresenceCard()
            ReadReceiptsCard()
        }
    }
}

/// "Show when I am online", as a card.
struct PrivacyPresenceCard: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @State private var visible = true
    @State private var loaded = false

    private static var key: String { PrivacySettingsView.key }

    var body: some View {
        Group {
            SettingsCard {
                SettingsRow(
                    title: "Show when I am online",
                    subtitle: "People of your organization see a green, amber or grey dot on your picture. Off: you appear offline to everyone, with no last-seen time.",
                    accessory: .toggle(Binding(get: { visible }, set: { value in
                        visible = value
                        Task { await save(value) }
                    })),
                    identifier: "settings-presence-visible"
                )
            }
            .disabled(!loaded)
        }
        .task {
            if let record = try? await session.settingsClient?.preferences() {
                visible = record.preferences[Self.key] != "0"
            }
            loaded = true
        }
    }

    /// PUT replaces the whole record: read, change one key, write back.
    private func save(_ on: Bool) async {
        guard let client = session.settingsClient, let record = try? await client.preferences() else { return }
        var values = record.preferences
        values[Self.key] = on ? "1" : "0"
        _ = try? await client.putPreferences(values)
        await PeopleDirectory.shared.load(session, force: true)
    }
}

/// "Send read receipts" (Settings > Privacy, `sagax.readReceipts.v1`): off,
/// nobody sees where this person read a conversation between people, and
/// they see nobody's (server/messages/read-receipts.ts). Rooms and bots always show.
struct ReadReceiptsCard: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @ObservedObject private var prefs = SidebarPrefsModel.shared

    var body: some View {
        SettingsCard {
            SettingsRow(
                title: "Send read receipts",
                subtitle: "Off: you do not see other people's either.",
                accessory: .toggle(Binding(get: { prefs.readReceipts }, set: { prefs.setReadReceipts(session, $0) })),
                identifier: "settings-read-receipts"
            )
        }
        .disabled(!prefs.synced)
    }
}
