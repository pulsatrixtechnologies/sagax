// iPad I5: Settings as the desktop's modal (src/components/SettingsModal.tsx):
// `min(900, 100vw-40)` by `min(700, 100dvh-96)` over a 50 % scrim, the 198 pt
// nav (title, search, sections) and the section's page with its cards. The
// sections listed are the pairing's (`DesktopSettingsSection.available`, the
// desktop remote client's rule); each page reads and writes through the
// client routes the desktop uses (`GET`/`PUT /api/config`, usage, pairing).
//
// Sub-trees are type-erased (`AnyView`) at the nav, the page and each
// section: a deep SwiftUI type overflowed the main thread's stack on iPad.
import SwiftUI
import UIKit
import CompanionCore

// MARK: - Model

/// What the open Settings modal reads: the config slice, usage, and the
/// saves in flight. One per open modal.
@MainActor
final class DesktopSettingsModel: ObservableObject {
    @Published private(set) var config: DesktopSettingsConfig?
    @Published private(set) var usage: UsageSummary?
    @Published private(set) var loaded = false
    @Published var error: String?
    @Published private(set) var saving: Set<String> = []

    private weak var session: Session?
    var client: CompanionClient? { session?.settingsClient }

    func attach(_ session: Session) {
        self.session = session
    }

    func load() async {
        guard let client else { loaded = true; return }
        async let config = try? client.desktopSettingsConfig()
        async let usage = try? client.usage()
        let loadedConfig = await config
        self.config = loadedConfig
        self.usage = await usage
        loaded = true
    }

    func reloadUsage() async {
        guard let client else { return }
        usage = try? await client.usage()
    }

    /// Sends one change; the server's config replaces the local one. The
    /// error, if any, is returned for the control that sent it.
    @discardableResult
    func apply(_ change: DesktopConfigChange, key: String) async -> String? {
        guard let client else { return AppStrings.localized("Not connected") }
        saving.insert(key)
        defer { saving.remove(key) }
        do {
            config = try await client.updateDesktopSettings(change)
            DesktopSidebarFlags.shared.apply(config)
            return nil
        } catch {
            let message = error.localizedDescription
            self.error = message
            return message
        }
    }
}

// MARK: - Modal

struct DesktopSettingsModal: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var shell: DesktopShellModel
    @StateObject private var model = DesktopSettingsModel()
    @State private var query = ""
    let close: () -> Void

    private var available: [DesktopSettingsSection] {
        DesktopSettingsSection.available(for: session.surfaceGate)
    }

    private var visible: [DesktopSettingsSection] {
        available.filter { $0.matches(query, label: $0.labelString) }
    }

    private var section: DesktopSettingsSection {
        DesktopSettingsSection.resolve(shell.settingsSection, available: available, visible: visible) ?? .appearance
    }

    var body: some View {
        DesktopModalFrame(width: 900, close: close) {
            HStack(spacing: 0) {
                AnyView(DesktopSettingsNav(
                    sections: visible, current: section, query: $query,
                    choose: { shell.settingsSection = $0 }
                ))
                .frame(width: 198)
                AnyView(page)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .environmentObject(model)
        .environment(\.desktopSettingsQuery, query)
        .task {
            model.attach(session)
            await model.load()
        }
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
        .accessibilityIdentifier("desktop-settings")
    }

    private var page: some View {
        ZStack(alignment: .topTrailing) {
            ScrollViewReader { reader in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    DesktopText(Text(section.label), size: 17, weight: .semibold, line: 24, tracking: -0.136)
                        .padding(.horizontal, 32)
                        .padding(.top, 24)
                        .padding(.bottom, 4)
                        .accessibilityAddTraits(.isHeader)
                    VStack(alignment: .leading, spacing: 12) {
                        AnyView(DesktopSettingsPage(section: section))
                    }
                    .padding(.horizontal, 32)
                    .padding(.top, 16)
                    .padding(.bottom, 24)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Color.clear.frame(height: 0).id(DesktopSettingsScroll.bottom)
                }
                .id(section)
            }
            .scrollIndicators(.hidden)
            .task(id: model.loaded) {
                guard model.loaded, DesktopSettingsScroll.parityScrollsToEnd else { return }
                try? await Task.sleep(nanoseconds: 600_000_000)
                reader.scrollTo(DesktopSettingsScroll.bottom, anchor: .bottom)
            }
            }
            DesktopCloseButton(label: "Close settings", identifier: "desktop-settings.close", action: close)
                .padding(.top, 10)
                .padding(.trailing, 10)
        }
    }
}

extension DesktopSettingsSection {
    /// The nav label (the desktop's `settings.section.*`, as the references read).
    var label: LocalizedStringKey {
        switch self {
        case .general: "Account"
        case .organization: "Organization"
        case .appearance: "Appearance"
        case .experimental: "Experimental"
        case .connections: "API keys"
        case .myConnections: "My connections"
        case .decisionModel: "Decision model"
        case .engines: "Models"
        case .myEngines: "My engines"
        case .companion: "Pair devices"
        case .computer: "Computer"
        case .usage: "Usage"
        case .people: "People"
        case .mail: "Email"
        case .activity: "Activity"
        case .backups: "Backups"
        case .providers: "Providers"
        case .voice: "Voice"
        case .updates: "Updates"
        case .about: "About"
        case .security: "Security"
        case .vault: "Vault"
        case .notifications: "Notifications"
        case .importBot: "Import"
        }
    }

    /// The label as a string, for search (in the app's language).
    var labelString: String {
        switch self {
        case .general: AppStrings.localized("Account")
        case .organization: AppStrings.localized("Organization")
        case .appearance: AppStrings.localized("Appearance")
        case .experimental: AppStrings.localized("Experimental")
        case .connections: AppStrings.localized("API keys")
        case .myConnections: AppStrings.localized("My connections")
        case .decisionModel: AppStrings.localized("Decision model")
        case .engines: AppStrings.localized("Models")
        case .myEngines: AppStrings.localized("My engines")
        case .companion: AppStrings.localized("Pair devices")
        case .computer: AppStrings.localized("Computer")
        case .usage: AppStrings.localized("Usage")
        case .people: AppStrings.localized("People")
        case .mail: AppStrings.localized("Email")
        case .activity: AppStrings.localized("Activity")
        case .backups: AppStrings.localized("Backups")
        case .providers: AppStrings.localized("Providers")
        case .voice: AppStrings.localized("Voice")
        case .updates: AppStrings.localized("Updates")
        case .about: AppStrings.localized("About")
        case .security: AppStrings.localized("Security")
        case .vault: AppStrings.localized("Vault")
        case .notifications: AppStrings.localized("Notifications")
        case .importBot: AppStrings.localized("Import")
        }
    }

    var icon: DesktopSettingsIcon {
        switch self {
        case .general: .user
        case .organization: .building2
        case .appearance: .palette
        case .experimental: .flaskConical
        case .connections: .keyRound
        case .myConnections: .plug
        case .decisionModel: .zap
        case .engines: .terminal
        case .myEngines: .keyRound
        case .companion: .tabletSmartphone
        case .computer: .monitor
        case .usage: .coins
        case .people: .users
        case .mail: .mail
        case .activity: .scrollText
        case .backups: .archive
        case .providers: .plug
        case .voice: .audioLines
        case .updates: .download
        case .about: .info
        case .security: .shield
        case .vault: .keyRound
        case .notifications: .bell
        case .importBot: .download
        }
    }
}

extension DesktopSettingsNavGroup {
    var label: LocalizedStringKey {
        switch self {
        case .personal: "Personal"
        case .ai: "AI"
        case .installation: "Installation"
        case .app: "App"
        }
    }
}

// MARK: - Nav

/// The 198 pt nav (`bg-panel px-3 py-4`, a hairline at its right).
struct DesktopSettingsNav: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var shell: DesktopShellModel
    let sections: [DesktopSettingsSection]
    let current: DesktopSettingsSection
    @Binding var query: String
    let choose: (DesktopSettingsSection) -> Void
    @FocusState private var searching: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            // The search sits on the row of the close button (its centre is
            // at 26 pt from the top: 10 pt inset, 32 pt tall), the title below.
            // SettingsModal.tsx: "Settings" over the search, then the rail
            // under the desktop's headings (Personal, AI, Installation, App).
            DesktopText(Text("Settings"), size: 13, weight: .semibold, line: 18)
                .padding(.horizontal, 9)
                .padding(.top, -2)
                .padding(.bottom, 8)
                .accessibilityAddTraits(.isHeader)
            search
                .padding(.bottom, 4)
            if sections.isEmpty {
                DesktopText(Text("No settings match “\(query.trimmingCharacters(in: .whitespaces))”."),
                            size: 12.5, line: 20.3, color: \.inkSecondary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 16)
            }
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(DesktopSettingsNavGroup.grouped(sections), id: \.group) { entry in
                        DesktopText(Text(entry.group.label), size: 11.5, weight: .medium, line: 16, color: \.inkSecondary)
                            .padding(.horizontal, 9)
                            .padding(.top, 12)
                            .padding(.bottom, 4)
                            .accessibilityAddTraits(.isHeader)
                        ForEach(entry.sections, id: \.self) { section in
                            navRow(section)
                        }
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.top, 16)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(theme.panel)
        .overlay(alignment: .trailing) {
            Rectangle().fill(theme.hairlineWeak).frame(width: 1)
        }
    }

    private func navRow(_ section: DesktopSettingsSection) -> some View {
        // About is the centred About window, as on the desktop
        Button { if section == .about { shell.modal = .about } else { choose(section) } } label: {
            HStack(spacing: 9) {
                DesktopSettingsIconView(icon: section.icon, size: 15)
                DesktopText(Text(section.label))
                Spacer(minLength: 0)
            }
            .foregroundStyle(theme.ink)
            .padding(.horizontal, 9)
            .frame(height: 32)
            .background(section == current ? theme.selected : .clear,
                        in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(DesktopHoverFill(radius: 8))
        .accessibilityAddTraits(section == current ? .isSelected : [])
        .accessibilityIdentifier("desktop-settings.nav.\(section.rawValue)")
    }

    private var search: some View {
        HStack(spacing: 8) {
            DesktopSettingsIconView(icon: .search, size: 14)
                .foregroundStyle(theme.inkSecondary)
            TextField(text: $query, prompt: Text("Search").foregroundColor(theme.inkSecondary)) {
                Text("Search settings")
            }
            .font(theme.font(13))
            .foregroundStyle(theme.ink)
            .focused($searching)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitLabel(.search)
            .accessibilityIdentifier("desktop-settings.search")
        }
        .padding(.horizontal, 11)
        .frame(height: 32)
        .background(theme.ink.opacity(0.03), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(searching || DesktopSettingsParity.searchLooksFocused ? theme.borderStrong : theme.border, lineWidth: 1)
        )
    }
}

/// The parity references open Settings with the search focused (the
/// desktop focuses it on open); the iPad never raises the keyboard for it,
/// so a parity launch only draws the focused border.
enum DesktopSettingsParity {
    static var searchLooksFocused: Bool {
        #if DEBUG
        ParityLaunch.current?.iPadScreen?.isDesktopSettings == true
        #else
        false
        #endif
    }
}

// MARK: - Pages

/// One section's page.
struct DesktopSettingsPage: View {
    let section: DesktopSettingsSection

    var body: some View {
        switch section {
        case .general: AnyView(DesktopGeneralSettings())
        case .organization: AnyView(DesktopOrganizationSettings())
        case .appearance: AnyView(DesktopAppearanceSettings())
        case .experimental: AnyView(DesktopExperimentalSettings())
        case .connections: AnyView(DesktopAPIKeysSettings())
        // 2026-10-27: GitHub and the person's MCP servers live in Connect
        // apps (Sources, Providers); this page links there
        case .myConnections: AnyView(DesktopMyConnectionsLinks())
        case .decisionModel: AnyView(DesktopDecisionModelSettings())
        // Models and voice (#518): the providers, then API keys and the
        // Decision model as cards of the page
        case .providers: AnyView(DesktopProvidersSettings())
        case .engines: AnyView(DesktopBotModelsPage())
        case .voice: AnyView(DesktopVoiceSettings())
        case .updates: AnyView(DesktopUpdatesSettings())
        case .about: AnyView(EmptyView())
        case .security: AnyView(DesktopSecuritySettings())
        case .vault: AnyView(DesktopVaultSettings())
        case .notifications: AnyView(DesktopNotificationsSettings())
        case .importBot: AnyView(DesktopImportSettings())
        // #1098: the person's own subscription sign-in on each engine
        case .myEngines: AnyView(MyEnginesSection(style: .desktop))
        case .companion: AnyView(DesktopPairDevicesSettings())
        case .computer: AnyView(DesktopComputerSettings())
        case .usage: AnyView(DesktopUsageSettings())
        // not drawn on the iPad yet; `available` never lists them
        case .people, .activity, .mail: AnyView(EmptyView())
        case .backups: AnyView(DesktopBackupsSettings())
        }
    }
}

/// Models and voice: model providers and accounts, then the keys and the
/// decision model that were pages of their own.
/// Providers (2026-10-30): every account, key and server of this computer
/// that pays for a turn or a voice, in one page; API keys are its card.
struct DesktopProvidersSettings: View {
    var body: some View {
        // the keys are reached from "Add a provider" (Paste a key, a server)
        AnyView(DesktopEnginesSettings())
    }
}

private struct DesktopSettingsQueryKey: EnvironmentKey {
    static let defaultValue = ""
}

extension EnvironmentValues {
    /// The Settings modal's search, for a page whose cards open on a match.
    var desktopSettingsQuery: String {
        get { self[DesktopSettingsQueryKey.self] }
        set { self[DesktopSettingsQueryKey.self] = newValue }
    }
}

// MARK: - Parity surfaces

extension IPadParityScreen {
    /// The Settings and Plugins references (desktop-*-59..79).
    var isDesktopSettings: Bool { parityModal != nil }

    /// Which modal, section or tab the surface opens.
    var parityModal: (modal: DesktopShellModel.Modal, section: DesktopSettingsSection?, tab: DesktopPluginsTab?)? {
        switch self {
        case .searchPalette, .searchPaletteQuery: (.search, nil, nil)
        case .pluginsMcp: (.plugins, nil, .mcp)
        case .capabilities: (.plugins, nil, nil)
        case .settingsGeneral, .settingsGeneralScrolled: (.settings, .general, nil)
        // the desktop opens Account for its former Cloud account section
        case .settingsCloudAccount: (.settings, .general, nil)
        case .settingsOrganization: (.settings, .organization, nil)
        case .settingsAppearance: (.settings, .appearance, nil)
        case .settingsExperimental: (.settings, .experimental, nil)
        case .settingsConnections: (.settings, .connections, nil)
        case .settingsMyConnections: (.settings, .myConnections, nil)
        case .settingsDecisionModel: (.settings, .decisionModel, nil)
        case .settingsEngines: (.settings, .engines, nil)
        case .settingsCompanion: (.settings, .companion, nil)
        case .settingsComputer: (.settings, .computer, nil)
        case .settingsUsage: (.settings, .usage, nil)
        case .settingsBackups: (.settings, .backups, nil)
        // 2026-11-03: the desktop's pages of 2026-10-28 and 2026-10-30
        case .settingsAccount: (.settings, .general, nil)
        case .settingsProviders: (.settings, .providers, nil)
        case .settingsVoice: (.settings, .voice, nil)
        case .settingsUpdates: (.settings, .updates, nil)
        case .settingsAbout: (.about, nil, nil)
        case .settingsSecurity: (.settings, .security, nil)
        case .settingsCredentials: (.settings, .vault, nil)
        case .settingsNotifications: (.settings, .notifications, nil)
        case .settingsImport: (.settings, .importBot, nil)
        default: nil
        }
    }
}

#if DEBUG
extension DesktopShellModel {
    /// A Settings or Plugins reference: the modal open on its section or
    /// tab, over Ara's chat as the desktop captured it.
    func applyParityModals(_ screen: IPadParityScreen) {
        guard let target = screen.parityModal else { return }
        if let section = target.section { settingsSection = section }
        if let tab = target.tab { pluginsTab = tab }
        modal = target.modal
    }
}
#endif

/// settings-general-scrolled: the page scrolled to its end.
enum DesktopSettingsScroll {
    static let bottom = "desktop-settings.bottom"

    static var parityScrollsToEnd: Bool {
        #if DEBUG
        ParityLaunch.current?.iPadScreen == .settingsGeneralScrolled
        #else
        false
        #endif
    }
}

extension Notification.Name {
    /// The app menu's Settings (⌘,): the desktop shell opens its modal.
    static let desktopOpenSettings = Notification.Name("ca.pulsatrix.sagax.desktopOpenSettings")
}
