// Plugins > Installed > Providers in the iPad desktop window, 1:1 with
// the desktop (InstalledView.tsx `providers`, AccountsView.tsx,
// HarnessConnectorGroups.tsx): "Providers" 13 semibold and its note, the
// pills (All, Claude, Grok), then a section per engine: its mark,
// "Connectors of your X account", Check again (not on Grok), "Manage on X",
// the Grok note, and its connectors in two columns or the line that says
// why there are none and offers the way out. The rules are CompanionCore's
// ProviderConnectorGroups.
import SwiftUI
import CompanionCore

struct DesktopProvidersSection: View {
    @Environment(\.desktopTheme) private var theme
    @Environment(\.openURL) private var openURL
    @EnvironmentObject private var session: Session
    @StateObject private var harness = HarnessConnectorsModel()
    @State private var grokConfigured = false
    @State private var service = "all"
    /// The person's own MCP servers (an organization server), the last pill.
    var servers: Bool = false

    private var groups: [ProviderConnectorGroup] {
        ProviderConnectorGroups.groups(claude: harness.answer, claudeLoading: harness.loading, grokConfigured: grokConfigured)
    }

    var body: some View {
        let groups = groups
        let services = ProviderConnectorGroups.services(groups, servers: servers)
        let chosen = services.contains(service) ? service : "all"
        VStack(alignment: .leading, spacing: 0) {
            Text("Providers").font(theme.font(13, .semibold)).foregroundStyle(theme.ink)
                .padding(.bottom, 4)
            Text("Your provider accounts serve all your bots, whatever the install scope.")
                .font(theme.font(12)).lineSpacing(3).foregroundStyle(theme.inkSecondary)
                .padding(.bottom, 12)
            if !services.isEmpty {
                HStack(spacing: 6) {
                    ForEach(services, id: \.self) { id in
                        let on = chosen == id
                        Button { service = id } label: {
                            Text(verbatim: label(id, groups))
                                .font(theme.font(12.5))
                                .foregroundStyle(on ? theme.accentInk : theme.ink)
                                .padding(.horizontal, 12)
                                .frame(height: 28)
                                .background(on ? theme.accent : Color.clear, in: Capsule())
                                .overlay(Capsule().strokeBorder(on ? Color.clear : theme.border, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(on ? .isSelected : [])
                        .accessibilityIdentifier("desktop-providers.service.\(id)")
                    }
                }
                .padding(.bottom, 16)
            }
            VStack(alignment: .leading, spacing: 24) {
                ForEach(groups.filter { chosen == "all" || chosen == $0.engine.rawValue }) { group in
                    section(group)
                }
            }
        }
        // `mt-6`, after the empty line's own bottom margin
        .padding(.top, 32)
        .frame(maxWidth: .infinity, alignment: .leading)
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("connect-apps-providers")
        .task {
            await harness.load(session.settingsClient)
            grokConfigured = ProviderConnectorGroups.grokConfigured(await session.modelInstances())
        }
    }

    private func label(_ id: String, _ groups: [ProviderConnectorGroup]) -> String {
        switch id {
        case "all": String(localized: "All")
        case "servers": String(localized: "My MCP servers")
        default: groups.first { $0.engine.rawValue == id }?.name ?? id
        }
    }

    private func mark(_ engine: ProviderEngine) -> some View {
        ProviderMarkView(driverKind: engine == .claude ? "claudeAgent" : engine == .grok ? "grokAgent" : "codex", size: 16)
            .frame(width: 20, height: 20)
    }

    private func pill(_ title: Text, icon: DesktopIcon, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                DesktopIconView(icon: icon, size: 12)
                title.font(theme.font(11.5, .medium))
            }
            .foregroundStyle(theme.ink)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(theme.control, in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(id)
    }

    private func section(_ group: ProviderConnectorGroup) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                mark(group.engine)
                Text("Connectors of your \(group.name) account")
                    .font(theme.font(13, .semibold)).foregroundStyle(theme.ink).lineLimit(1)
                Spacer(minLength: 0)
                if group.engine != .grok {
                    Button { Task { await harness.load(session.settingsClient, refresh: true) } } label: {
                        DesktopIconView(icon: .refresh, size: 14)
                            .foregroundStyle(theme.inkSecondary)
                            .frame(width: 28, height: 28)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(harness.loading)
                    .accessibilityLabel(Text("Check again"))
                    .accessibilityIdentifier("desktop-providers.refresh.\(group.engine.rawValue)")
                }
                pill(Text("Manage on \(group.name)"), icon: .externalLink, id: "desktop-providers.manage.\(group.engine.rawValue)") {
                    if let url = URL(string: group.manageUrl) { openURL(url) }
                }
            }
            if group.engine == .grok, group.notice == nil {
                Text("Grok's connectors reach bots on an organization server only, and only on the person's own Grok sign-in.")
                    .font(theme.font(11.5)).lineSpacing(3).foregroundStyle(theme.inkTertiary)
            }
            if let notice = group.notice { noticeCard(group, notice) }
            if !group.connectors.isEmpty {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], alignment: .leading, spacing: 2) {
                    ForEach(group.connectors) { connector in connectorRow(connector, group: group) }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-providers.group.\(group.engine.rawValue)")
    }

    private func noticeText(_ group: ProviderConnectorGroup, _ notice: ProviderGroupNotice) -> Text {
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

    /// `GroupNotice`: rounded-xl, the inset colour, 12.5 pt, its way out.
    private func noticeCard(_ group: ProviderConnectorGroup, _ notice: ProviderGroupNotice) -> some View {
        HStack(spacing: 12) {
            HStack(spacing: 8) {
                if notice == .loading { ProgressView().controlSize(.small) }
                noticeText(group, notice).lineSpacing(3)
            }
            Spacer(minLength: 0)
            switch notice.action {
            case .setup?:
                Button {
                    NotificationCenter.default.post(name: .desktopOpenSettings, object: DesktopSettingsSection.engines.rawValue)
                } label: {
                    Text("Connect \(group.name)").font(theme.font(12, .medium)).foregroundStyle(theme.ink)
                        .padding(.horizontal, 12).padding(.vertical, 4)
                        .background(theme.control, in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("desktop-providers.setup.\(group.engine.rawValue)")
            case .retry?:
                Button { Task { await harness.load(session.settingsClient, refresh: true) } } label: {
                    HStack(spacing: 4) { DesktopIconView(icon: .refresh, size: 12); Text("Check again") }
                        .font(theme.font(12, .medium)).foregroundStyle(theme.ink)
                        .padding(.horizontal, 12).padding(.vertical, 4)
                        .background(theme.control, in: Capsule())
                }
                .buttonStyle(.plain)
            default:
                EmptyView()
            }
        }
        .font(theme.font(12.5))
        .foregroundStyle(theme.inkSecondary)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.inset, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-providers.notice.\(group.engine.rawValue)")
    }

    private func connectorRow(_ connector: ProviderConnector, group: ProviderConnectorGroup) -> some View {
        let missing = connector.status == "needs_auth" || connector.status == "failed"
        let statusText: Text = switch connector.status {
        case "connected": Text("Connected")
        case "needs_auth": Text("Sign-in required")
        case "failed": Text("Unavailable")
        case .some: Text("Unknown")
        case nil: Text("Not verifiable: Grok catalog")
        }
        return HStack(spacing: 12) {
            Text(verbatim: String(connector.name.prefix(1)).uppercased())
                .font(theme.font(15, .semibold))
                .foregroundStyle(theme.ink)
                .frame(width: 44, height: 44)
                .background(theme.raised, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            VStack(alignment: .leading, spacing: 0) {
                Text(verbatim: connector.name).font(theme.font(13, .medium)).foregroundStyle(theme.ink).lineLimit(1)
                statusText.font(theme.font(12)).lineLimit(1)
                    .foregroundStyle(connector.status == "connected" ? theme.success : missing ? theme.warning : theme.inkSecondary)
            }
            Spacer(minLength: 0)
        }
        .padding(10)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("desktop-providers.connector.\(connector.id)")
    }
}
