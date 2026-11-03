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

    private var scopes: [Scope] {
        (bot == nil ? [] : [.bot]) + [.me] + (session.surfaceGate.organization ? [.organization] : [])
    }

    var body: some View {
        DesktopModalFrame(width: 880, background: \.panel, close: close) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 12) {
                    DesktopText(Text("Capabilities"), size: 17, weight: .semibold, line: 24, tracking: -0.136)
                    HStack(spacing: 2) {
                        ForEach(scopes, id: \.self) { option in
                            Button { scope = option } label: {
                                HStack(spacing: 6) {
                                    DesktopIconView(icon: icon(option), size: 13)
                                    Text(label(option)).font(theme.font(12.5, scope == option ? .medium : .regular))
                                }
                                .foregroundStyle(scope == option ? theme.accentInk : theme.inkSecondary)
                                .padding(.horizontal, 10)
                                .frame(minHeight: 30)
                                .background(scope == option ? theme.accent : .clear, in: Capsule())
                                .contentShape(Capsule())
                            }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(scope == option ? .isSelected : [])
                            .accessibilityIdentifier("desktop-capabilities.scope.\(option.rawValue)")
                        }
                    }
                    .padding(2)
                    .overlay(Capsule().strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
                    Spacer(minLength: 0)
                    if scope == .me {
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
                        .frame(width: 300, height: 34)
                        .background(theme.ink.opacity(0.03), in: Capsule())
                        .overlay(Capsule().strokeBorder(searching ? theme.borderStrong : theme.border, lineWidth: 1))
                    }
                    DesktopCloseButton(label: "Close", identifier: "desktop-plugins.close", action: close)
                }
                .padding(.horizontal, 20)
                .padding(.top, 16)
                .padding(.bottom, 8)
                DesktopText(scope == .bot ? Text("Plugins installed here go to \(bot?.name ?? "") only, with their agents, commands and skills. Hooks and the plugin's own MCP servers are left out.")
                                          : Text("These capabilities serve all of your bots. You manage them here."),
                            size: 12.5, line: 18, color: \.inkSecondary)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 8)
                Rectangle().fill(theme.hairlineWeak).frame(height: 0.5)
                content
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .onAppear { if model.selected != nil, scope == .me, Self.parityOpensOnBot { scope = .bot } }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-capabilities")
    }

    @ViewBuilder
    private var content: some View {
        switch scope {
        case .bot:
            if let bot {
                ScrollView { AnyView(BotPanelCapabilities(bot: bot)).padding(20) }
            }
        case .me:
            ConnectAppsPage(initialTab: Self.parityTab, embedded: true, embeddedQuery: $query)
                .environmentObject(session)
        case .organization:
            VStack(alignment: .leading, spacing: 8) {
                DesktopText(Text("Your organization's capabilities are set by its admins in Perspicax. Those your bots can use are listed under Me."),
                            line: 19.5, color: \.inkSecondary)
            }
            .padding(20)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
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
        case .me: .users
        case .organization: .network
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
