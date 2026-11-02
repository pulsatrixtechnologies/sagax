import CompanionCore
import SwiftUI

/// iOS list of a team bot's shared vault. Managers only; values never shown.
struct TeamBotVaultListView: View {
    let botId: String
    let botName: String
    @EnvironmentObject private var session: Session
    @State private var items: [VaultItemPublic] = []
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        SettingsPage(title: "Shared vault") {
            if let error {
                Text(verbatim: error).font(.footnote).foregroundStyle(.red).padding(.horizontal, 24)
            }
            SettingsCard {
                SettingsFooter(text: "Logins \(botName) can fill on its sites. Managers only. The bot never sees a password.")
                if items.isEmpty {
                    Text("No shared login yet.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, SettingsMetrics.rowInset)
                        .padding(.vertical, 10)
                } else {
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                        if index > 0 { CardHairline(leadingInset: SettingsMetrics.rowInset) }
                        SettingsRow(
                            title: "",
                            verbatimTitle: item.name,
                            subtitle: item.subtitle,
                            accessory: .none,
                            identifier: "team-vault-\(item.id)"
                        )
                    }
                }
            }
        }
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        guard let client = session.settingsClient else { return }
        busy = true
        defer { busy = false }
        do {
            let list = try await client.teamBotVaultItems(botId: botId)
            items = list.items
            error = nil
        } catch {
            self.error = error.localizedDescription
            items = []
        }
    }
}
