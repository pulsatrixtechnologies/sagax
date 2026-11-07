// "Provided by Claude (your account)" (iOS parity matrix PL7): the
// connectors of the person's own claude.ai account, read-only, as the
// desktop's HarnessConnectorsSection.tsx draws them. People add, sign in to
// and remove them on claude.ai; they are always allowed on a server (the
// admin switch is retired, as on the desktop since #168). Gate:
// `SurfaceFeature.harnessConnectors`.
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
        SettingsPage(title: "Provided by Claude", contentTop: 80) {
            PluginsRefreshButton(label: "Check again", spinning: model.loading && model.answer != nil, identifier: "harness-connectors-refresh") {
                Task { await model.load(session.settingsClient, refresh: true) }
            }
        } content: {
            HarnessConnectorsSection(model: model)
        }
        .task { await model.load(session.settingsClient) }
    }
}

/// The section itself, layout-agnostic.
struct HarnessConnectorsSection: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.openURL) private var openURL
    @EnvironmentObject private var session: Session
    @ObservedObject var model: HarnessConnectorsModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Provided by Claude (your account)")
                    .font(Theme.Font.headerTitle)
                    .foregroundStyle(Theme.textPrimary)
                Text("The connectors of your own claude.ai account reach your Claude bots when they run on your Claude subscription. They act as you, with your access.")
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                PluginsPillButton(title: Text("Manage on claude.ai"), identifier: "harness-connectors-manage") {
                    openURL(model.answer?.manageLink ?? URL(string: "https://claude.ai/customize/connectors")!)
                }
                .padding(.top, 8)
            }
            .padding(.horizontal, 21.7)
            .padding(.bottom, 16)

            content

            if let answer = model.answer, !answer.codex.available {
                PluginsNote(text: Text("Codex: ChatGPT connectors do not reach bots in Sagax."), color: Theme.textTertiary)
            }
            if let error = model.error {
                PluginsCallout(tone: .danger) { Text(verbatim: error) }
                    .padding(.top, 8)
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if model.loading && model.answer == nil {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small).tint(Theme.textSecondary)
                Text("Checking your Claude account...")
            }
            .font(Theme.Font.label)
            .foregroundStyle(Theme.textSecondary)
            .padding(.horizontal, 21.7)
            .padding(.vertical, 10)
        } else if let claude = model.answer?.claude, !claude.available {
            PluginsNote(text: unavailable(claude.reason))
                .accessibilityIdentifier("harness-connectors-unavailable")
        } else if let claude = model.answer?.claude, claude.connectors.isEmpty {
            PluginsNote(text: Text("No connector on your claude.ai account yet."))
                .accessibilityIdentifier("harness-connectors-empty")
        } else if let claude = model.answer?.claude {
            SettingsCard {
                ForEach(Array(claude.connectors.enumerated()), id: \.element.id) { index, connector in
                    if index > 0 { CardHairline(leadingInset: SettingsMetrics.rowInset) }
                    HStack(spacing: 10) {
                        Image(systemName: "powerplug")
                            .font(.system(size: 14))
                            .foregroundStyle(Theme.textTertiary)
                        Text(verbatim: connector.name)
                            .font(Theme.Font.rowTitle)
                            .foregroundStyle(Theme.textPrimary)
                            .lineLimit(1)
                        Spacer(minLength: 8)
                        status(connector.status)
                    }
                    .padding(.horizontal, SettingsMetrics.rowInset)
                    .frame(minHeight: 43.5)
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("harness-connector.\(connector.name)")
                }
            }
        }
    }

    private func status(_ value: String) -> some View {
        switch value {
        case "connected": PluginsBadge(text: Text("Connected"), tone: .success)
        case "needs_auth": PluginsBadge(text: Text("Sign-in required"), tone: .warning)
        case "failed": PluginsBadge(text: Text("Unavailable"))
        default: PluginsBadge(text: Text("Unknown"))
        }
    }

    private func unavailable(_ reason: String?) -> Text {
        switch reason {
        case "disabled": Text("An administrator turned off Claude connectors on this server.")
        case "managed_policy": Text("Your organization restricts MCP servers on this computer.")
        case "no_engine": Text("No Claude engine on this server.")
        case "not_signed_in": Text("Connect your Claude subscription to use your connectors.")
        case "not_operator": Text("On this server, Claude connectors belong to its owner's Claude account.")
        case "key": Text("Connect your Claude subscription to use your connectors. An API key brings none.")
        default: Text("Claude Code did not answer. Check that it is installed and signed in.")
        }
    }
}
