// Provider account connectors on the phone use the same registry model and
// notices as the iPad. Setup remains on each provider's own site.
import CompanionCore
import SwiftUI

@MainActor
final class HarnessConnectorsModel: ObservableObject {
    @Published private(set) var answer: HarnessConnectorsAnswer?
    @Published private(set) var loading = true
    @Published var error: String?

    func load(_ client: CompanionClient?, refresh: Bool = false) async {
        guard let client else { return }
        loading = true
        error = nil
        defer { loading = false }
        do { answer = try await client.harnessConnectors(refresh: refresh) }
        catch { self.error = error.localizedDescription }
    }
}

/// The page pushed from Plugins.
struct HarnessConnectorsView: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @StateObject private var model = HarnessConnectorsModel()

    var body: some View {
        SettingsPage(title: "Providers", contentTop: 80) {
            PluginsRefreshButton(label: "Check again", spinning: model.loading && model.answer != nil, identifier: "harness-connectors-refresh") {
                Task { await model.load(session.settingsClient, refresh: true) }
            }
        } content: {
            HarnessConnectorsSection(model: model)
        }
        .task { await model.load(session.settingsClient) }
    }
}

/// Every provider reads the same account connector registry as the desktop.
struct HarnessConnectorsSection: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.openURL) private var openURL
    @EnvironmentObject private var session: Session
    @ObservedObject var model: HarnessConnectorsModel
    @State private var grokConfigured = false

    private var groups: [ProviderConnectorGroup] {
        ProviderConnectorGroups.groups(claude: model.answer, claudeLoading: model.loading, grokConfigured: grokConfigured)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            ForEach(groups) { group in
                VStack(alignment: .leading, spacing: 12) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Connectors of your \(group.name) account")
                            .font(Theme.Font.headerTitle)
                            .foregroundStyle(Theme.textPrimary)
                        PluginsPillButton(title: Text("Manage on \(group.name)"), identifier: "harness-connectors-manage.\(group.engine.rawValue)") {
                            if let url = URL(string: group.manageUrl) { openURL(url) }
                        }
                    }
                    .padding(.horizontal, SettingsMetrics.rowInset)
                    if let notice = group.notice {
                        PluginsNote(text: providerConnectorNoticeText(group, notice))
                    }
                    if !group.connectors.isEmpty {
                        SettingsCard {
                            ForEach(Array(group.connectors.enumerated()), id: \.element.id) { index, connector in
                                if index > 0 { CardHairline(leadingInset: SettingsMetrics.rowInset) }
                                HStack(spacing: 10) {
                                    Image(systemName: "powerplug")
                                        .font(.system(size: 14)).foregroundStyle(Theme.textTertiary)
                                    Text(verbatim: connector.name)
                                        .font(Theme.Font.rowTitle).foregroundStyle(Theme.textPrimary).lineLimit(1)
                                    Spacer(minLength: 8)
                                    status(connector.status ?? "unknown")
                                }
                                .padding(.horizontal, SettingsMetrics.rowInset)
                                .frame(minHeight: 43.5)
                                .accessibilityElement(children: .combine)
                                .accessibilityIdentifier("harness-connector.\(group.engine.rawValue).\(connector.id)")
                            }
                        }
                    }
                }
                .accessibilityIdentifier("harness-connectors-group.\(group.engine.rawValue)")
            }
            if let error = model.error {
                PluginsCallout(tone: .danger) { Text(verbatim: error) }
            }
        }
        .task { grokConfigured = ProviderConnectorGroups.grokConfigured(await session.modelInstances()) }
    }

    private func status(_ value: String) -> some View {
        switch value {
        case "connected": PluginsBadge(text: Text("Connected"), tone: .success)
        case "needs_auth": PluginsBadge(text: Text("Sign-in required"), tone: .warning)
        case "failed": PluginsBadge(text: Text("Unavailable"))
        default: PluginsBadge(text: Text("Unknown"))
        }
    }
}

func providerConnectorNoticeText(_ group: ProviderConnectorGroup, _ notice: ProviderGroupNotice) -> Text {
    let name = group.name
    switch notice {
    case .loading: return Text("Reading the connectors of your \(name) account…")
    case .empty: return Text("Your \(name) account has no connector yet. Add one on \(name).")
    case .noAccount: return Text("No \(name) account is connected. Connect one to use its connectors (mail, calendar, Teams) in your bots.")
    case let .unavailable(reason):
        switch reason {
        case "managed_policy": return Text("Your organization restricts MCP servers on this computer, so your \(name) connectors are not used here.")
        case "no_engine": return Text("No \(name) engine is set up yet. Add one to use the connectors of your \(name) account.")
        case "not_signed_in": return Text("You are not signed in to \(name) with your own account here. Sign in to see and use its connectors.")
        case "not_operator": return Text("The \(name) sign-in on this computer belongs to its owner: its connectors are theirs, not yours.")
        case "key": return Text("This \(name) engine runs on an API key. Connectors come only with a \(name) subscription sign-in.")
        default: return Text("\(name) did not answer when its connectors were read.")
        }
    }
}
