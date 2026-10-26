import CompanionCore
import SwiftUI

/// Slack for each bot the server offers an Admin link for (PL6). The same
/// deep link as the bot's profile: Sagax does not connect Slack on the phone.
struct SlackConnectionsSection: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.openURL) private var openURL
    @EnvironmentObject private var session: Session
    @State private var links: [(bot: Bot, url: URL)] = []

    var body: some View {
        Group {
            if !links.isEmpty {
                slackSection
            }
        }
        .task(id: session.state.bots.map(\.id).joined(separator: ",")) { await load() }
    }

    private var slackSection: some View {
        Section {
                ForEach(links, id: \.bot.id) { row in
                    Button {
                        openURL(row.url)
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(verbatim: row.bot.name).foregroundStyle(Theme.textPrimary)
                            Text(String(localized: "Manage in Admin"))
                                .font(.footnote)
                                .foregroundStyle(Theme.textSecondary)
                        }
                    }
                    .accessibilityIdentifier("slack-manage.\(row.bot.id)")
                }
            } header: {
                Text(String(localized: "Slack"))
            } footer: {
                Text(String(localized: "Give this agent its own Slack app, with its own name and picture, so your team can message it directly."))
            }
    }

    private func load() async {
        guard session.surfaceGate.allows(.botSlack), let client = session.profileClient else {
            links = []
            return
        }
        var found: [(bot: Bot, url: URL)] = []
        for bot in session.state.bots where bot.hidden != true {
            if found.count >= 12 { break }
            if let url = await client.slackManagementURL(botId: bot.id) {
                found.append((bot, url))
            }
        }
        links = found
    }
}
