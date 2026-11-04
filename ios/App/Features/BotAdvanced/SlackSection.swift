import CompanionCore
import SwiftUI

/// The Slack row: present only when the server offered an https link (the
/// parent loads it with `CompanionClient.slackManagementURL`).
struct BotSlackSection: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.openURL) private var openURL
    let url: URL

    var body: some View {
        Section {
            Button {
                openURL(url)
            } label: {
                Label(String(localized: "Manage in Admin"), systemImage: "arrow.up.right.square")
            }
            .accessibilityIdentifier("slack-manage")
        } header: {
            Text(String(localized: "Slack"))
        } footer: {
            Text(String(localized: "Give this agent its own Slack app, with its own name and picture, so your team can message it directly."))
        }
    }
}
