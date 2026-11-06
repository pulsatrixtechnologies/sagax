// iPad lot 3 (2026-11-03): Capabilities as the desktop's centred window
// (DesktopCapabilities.tsx, `togglePlugins`): its title, the scope (This
// bot while a bot is open, Me, Organization on an organization server), the
// close button, then the page itself: Me is Connect apps (Discover, Bots,
// Installed, Sources, one search), This bot the open bot's capabilities.
import SwiftUI
import UIKit
import CompanionCore

struct DesktopCapabilitiesModal: View {
    enum Scope: String, CaseIterable { case bot, me, organization }

    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    @State private var scope: Scope = .me
    @State private var query = ""
    @FocusState private var searching: Bool
    let close: () -> Void

    private var bot: Bot? {
        guard case let .bot(bot)? = model.selected else { return nil }
        return session.state.bot(bot.id) ?? bot
    }

    /// The desktop's rule (PluginsPanel.tsx `ScopeToggle organization`):
    /// Organization shows to whoever manages the workspace's marketplaces
    /// (`GET /api/marketplaces` answers) and may manage the organization: an
    /// organization admin on an organization server, else the computer's
    /// owner or an admin.
    @State private var managesWorkspace = false

    private var scopes: [Scope] {
        (bot == nil ? [] : [.bot]) + [.me] + (managesWorkspace ? [.organization] : [])
    }

    private var mayManageOrganization: Bool {
        session.surfaceGate.organization ? session.surfaceGate.scope == .serverAdmin : session.canAdminister
    }

    var body: some View {
        DesktopModalFrame(width: 900, background: \.app, close: close) {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 0) {
                    DesktopText(Text("Plugins"), size: 17, weight: .semibold, line: 24, tracking: -0.136)
                        .padding(.trailing, 48)
                    // the scope and the one search share a line (2026-10-29)
                    HStack(spacing: 12) {
                        scopeToggle
                        Spacer(minLength: 0)
                        if scope == .me { searchField }
                    }
                    .padding(.top, 12)
                    DesktopText(scope == .bot ? Text("Plugins installed here go to \(bot?.name ?? "") only, with their agents, commands and skills. Hooks and the plugin's own MCP servers are left out.")
                                              : scope == .organization ? Text("Plugins for members of the organization.")
                                              : Text("These plugins serve all of your bots. You manage them here."),
                                size: 12, line: 18, color: \.inkSecondary)
                        .frame(minHeight: 36, alignment: .topLeading)
                        .padding(.top, 8)
                }
                .padding(.leading, 32)
                .padding(.trailing, 48)
                .padding(.top, 24)
                .overlay(alignment: .topTrailing) {
                    DesktopCloseButton(label: "Close", identifier: "desktop-plugins.close", action: close)
                        .padding(10)
                }
                content
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .onAppear { if model.selected != nil, scope == .me, Self.parityOpensOnBot { scope = .bot } }
        .task(id: session.connection?.id) {
            guard mayManageOrganization, let client = session.settingsClient else { managesWorkspace = false; return }
            managesWorkspace = await client.marketplacesReadable()
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-capabilities")
    }

    /// `ScopeToggle`: SEGMENT_GROUP (rounded-full, a border, p-0.5), 28 pt options.
    private var scopeToggle: some View {
        HStack(spacing: 2) {
            ForEach(scopes, id: \.self) { option in
                Button { scope = option } label: {
                    HStack(spacing: 6) {
                        DesktopIconView(icon: icon(option), size: 13)
                        Text(label(option)).font(theme.font(12.5)).lineLimit(1)
                    }
                    .foregroundStyle(scope == option ? theme.accentInk : theme.inkSecondary)
                    .padding(.horizontal, 12)
                    .frame(height: 28)
                    .background(scope == option ? theme.accent : .clear, in: Capsule())
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(scope == option ? .isSelected : [])
                .accessibilityIdentifier("desktop-capabilities.scope.\(option.rawValue)")
            }
        }
        .padding(2)
        .overlay(Capsule().strokeBorder(theme.border, lineWidth: 1))
        .fixedSize()
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            DesktopIconView(icon: .search, size: 14).foregroundStyle(theme.inkSecondary)
            TextField(text: $query, prompt: Text("Search plugins, skills, MCP servers, bots, templates, pages and sources").foregroundColor(theme.inkSecondary)) {
                Text("Search")
            }
            .font(theme.font(13))
            .foregroundStyle(theme.ink)
            .focused($searching)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .accessibilityIdentifier("desktop-capabilities.search")
        }
        .padding(.horizontal, 11)
        .frame(minWidth: 200, maxWidth: 320)
        .frame(height: 34)
        .background(theme.ink.opacity(0.03), in: Capsule())
        .overlay(Capsule().strokeBorder(searching ? theme.borderStrong : theme.border, lineWidth: 1))
    }

    @ViewBuilder
    private var content: some View {
        switch scope {
        case .bot:
            if let bot {
                ScrollView { AnyView(BotPanelCapabilities(bot: bot)).padding(20) }
            }
        case .me, .organization:
            // Organization lists the workspace's own (every app and server)
            ConnectAppsPage(initialTab: Self.parityTab, embedded: true, embeddedQuery: $query, personalScope: scope == .me)
                .environmentObject(session)
        }
    }

    private func label(_ scope: Scope) -> LocalizedStringKey {
        switch scope {
        case .bot: "This bot"
        case .me: "Me"
        case .organization: "Organization"
        }
    }

    private func icon(_ scope: Scope) -> DesktopIcon {
        switch scope {
        case .bot: .bot
        case .me: .user
        case .organization: .users
        }
    }

    static let parityOpensOnBot = false

    #if DEBUG
    /// The desktop's plugins-mcp reference is Capabilities on Installed.
    static var parityTab: ConnectAppsTab? { ParityLaunch.current?.iPadScreen == .pluginsMcp ? .installed : nil }
    #else
    static let parityTab: ConnectAppsTab? = nil
    #endif
}
