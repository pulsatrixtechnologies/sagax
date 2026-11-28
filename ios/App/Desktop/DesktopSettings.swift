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
    /// `useServerFeature("memberPersonSettings")`: from the descriptor's
    /// list, else from what a personal switch's save showed.
    @Published private(set) var personalServed: ServerFeatureState = .unknown
    private var listedFeatures: [String]?
    private var personalEvidence: Bool?

    private weak var session: Session?
    var client: CompanionClient? { session?.settingsClient }

    func attach(_ session: Session) {
        self.session = session
    }

    func load() async {
        guard let client else { loaded = true; return }
        async let config = try? client.desktopSettingsConfig()
        async let usage = try? client.usage()
        async let environment = try? client.environment()
        let loadedConfig = await config
        self.config = loadedConfig
        self.usage = await usage
        listedFeatures = await environment?.capabilities?.features
        notePersonal(nil)
        loaded = true
    }

    private func notePersonal(_ present: Bool?) {
        if let present { personalEvidence = present }
        personalServed = .of("memberPersonSettings", listed: listedFeatures, evidence: personalEvidence)
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
            if case .myFeature = change { notePersonal(true) }
            return nil
        } catch {
            // An older organization server has no /api/me/experimental: the
            // switches go and the note says why (featureMissingOnServer).
            if case .myFeature = change, ServerFeatureState.routeMissing(error) {
                notePersonal(false)
                return nil
            }
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
        DesktopSettingsSection.resolve(shell.settingsSection, available: available, visible: visible) ?? .general
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
                    // #2080 (L0): page title and the page's one-sentence intro
                    // (settings.intro.*); the pages draw no intro of their own.
                    VStack(alignment: .leading, spacing: 2) {
                        DesktopText(Text(section.label), size: 20, weight: .semibold, line: 28, tracking: -0.24)
                            .accessibilityAddTraits(.isHeader)
                        if let intro = section.intro {
                            DesktopText(Text(intro), size: 13, line: 18, color: \.inkSecondary)
                                .accessibilityIdentifier("desktop-settings.intro")
                        }
                    }
                    .padding(.horizontal, 32)
                    .padding(.top, 24)
                    .padding(.bottom, 4)
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
        // #4457 / #5527: rail labels match the desktop (General, Permissions, …).
        case .general: "General"
        case .organization: "Organization"
        case .appearance: "Appearance"
        case .experimental: "Experimental"
        case .developer: "Developer"
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
        case .backups: "Backups and storage"
        case .providers: "Providers"
        case .voice: "Voice"
        case .updates: "Updates"
        case .about: "App"
        case .security: "Permissions"
        case .vault: "Vault"
        case .notifications: "Notifications"
        case .importBot: "Import"
        }
    }

    /// The label as a string, for search (in the app's language).
    var labelString: String {
        switch self {
        case .general: AppStrings.localized("General")
        case .organization: AppStrings.localized("Organization")
        case .appearance: AppStrings.localized("Appearance")
        case .experimental: AppStrings.localized("Experimental")
        case .developer: AppStrings.localized("Developer")
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
        case .backups: AppStrings.localized("Backups and storage")
        case .providers: AppStrings.localized("Providers")
        case .voice: AppStrings.localized("Voice")
        case .updates: AppStrings.localized("Updates")
        case .about: AppStrings.localized("App")
        case .security: AppStrings.localized("Permissions")
        case .vault: AppStrings.localized("Vault")
        case .notifications: AppStrings.localized("Notifications")
        case .importBot: AppStrings.localized("Import")
        }
    }

    /// The page's one-sentence intro under the title (#2080, settings.intro.*).
    var intro: LocalizedStringKey? {
        switch self {
        // #4457 / #5527: intros match the desktop rail pages.
        case .general: "Your account, appearance, notifications, backups and advanced options."
        case .appearance: "Theme, conversations and mascots."
        case .notifications: "On this computer: what alerts you and who sees you."
        case .security: "What your bots may do without asking you, your privacy and your keys."
        case .vault: "What your bots can use for you. Encrypted on this computer with the system keychain, or with the server's key."
        case .providers: "Where models, voice and services come from."
        case .engines: "Which model each bot uses."
        case .voice: "How your bots speak and listen."
        case .usage: "What your bots used and what it costs."
        case .organization: "The server you work on and what it shares."
        case .computer: "The computer your bots work on."
        case .backups: "Save, restore and bring in your data."
        case .about: "This app's version, updates and help."
        case .experimental: "Features still being tried out."
        case .developer: "Technical options: run details, timeouts, telemetry, logs and diagnostics."
        case .updates: "This app's version, updates and help."
        case .connections, .myConnections, .decisionModel, .myEngines, .companion,
             .people, .mail, .activity, .importBot:
            nil
        }
    }

    var icon: DesktopSettingsIcon {
        switch self {
        case .general: .user
        case .organization: .building2
        case .appearance: .palette
        case .experimental: .flaskConical
        case .developer: .code2
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
        // #4457: flat rail draws no heading for this block.
        case .rail: ""
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
            ScrollViewReader { reader in
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 2) {
                    // the desktop's rail is one scroller: the title and the search scroll with it
                    // `px-2 py-2 text-[13px] font-semibold`, then the search `mt-1 mb-2`
                    DesktopText(Text("Settings"), size: 13, weight: .semibold, line: 19.5)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 8)
                        .accessibilityAddTraits(.isHeader)
                    search
                        .padding(.top, 4)
                        .padding(.bottom, 8)
                    if sections.isEmpty {
                        DesktopText(Text("No settings match “\(query.trimmingCharacters(in: .whitespaces))”."),
                                    size: 12.5, line: 20.3, color: \.inkSecondary)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 16)
                    }
                    // #4457 / #5527: flat rail, no Personal / AI / Installation / App headings.
                    ForEach(DesktopSettingsNavGroup.grouped(sections), id: \.group) { entry in
                        ForEach(entry.sections, id: \.self) { section in
                            navRow(section)
                        }
                    }
                    Color.clear.frame(height: 0).id(DesktopSettingsScroll.navBottom)
                }
            }
            // settings-general-scrolled: the desktop scrolls every scroller of
            // the dialog to its end, the rail too
            .task {
                guard DesktopSettingsScroll.parityScrollsToEnd else { return }
                try? await Task.sleep(nanoseconds: 600_000_000)
                reader.scrollTo(DesktopSettingsScroll.navBottom, anchor: .bottom)
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
        Button { choose(section) } label: {
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
        // #4457 / #5527: General hosts Appearance, Notifications, Backups and Developer.
        case .general: AnyView(DesktopGeneralHubSettings())
        case .organization: AnyView(DesktopOrganizationSettings())
        case .appearance: AnyView(DesktopAppearanceSettings())
        case .experimental, .developer: AnyView(DesktopDeveloperSettings())
        case .connections: AnyView(DesktopAPIKeysSettings())
        case .myConnections: AnyView(DesktopMyConnectionsLinks())
        case .decisionModel: AnyView(DesktopDecisionModelSettings())
        // #4457: Providers hosts Models and Voice.
        case .providers: AnyView(DesktopProvidersHubSettings())
        case .engines: AnyView(DesktopBotModelsPage())
        case .voice: AnyView(DesktopVoiceSettings())
        // #4457: Updates hosts About.
        case .updates: AnyView(DesktopUpdatesHubSettings())
        case .about: AnyView(DesktopAppSettings())
        case .security: AnyView(DesktopSecuritySettings())
        case .vault: AnyView(DesktopVaultSettings())
        case .notifications: AnyView(DesktopNotificationsSettings())
        case .importBot: AnyView(DesktopImportSettings())
        case .myEngines: AnyView(MyEnginesSection(style: .desktop))
        case .companion: AnyView(DesktopPairDevicesSettings())
        case .computer: AnyView(DesktopComputerSettings())
        case .usage: AnyView(DesktopUsageSettings())
        case .people, .activity, .mail: AnyView(EmptyView())
        case .backups: AnyView(DesktopBackupsAndImportSettings())
        }
    }
}

/// Settings > General (#4457): the former Account page plus the hosted cards
/// (Appearance, Notifications, Backups and import, Developer / Advanced).
struct DesktopGeneralHubSettings: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            DesktopGeneralSettings()
            DesktopAppearanceSettings()
            DesktopNotificationsSettings()
            DesktopBackupsAndImportSettings()
            DesktopDeveloperSettings()
        }
    }
}

/// Settings > Providers (#4457): accounts and keys, then Models and Voice.
struct DesktopProvidersHubSettings: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            DesktopProvidersSettings()
            DesktopBotModelsPage()
            DesktopVoiceSettings()
        }
    }
}

/// Settings > Updates (#4457): version / channel, then About (DesktopAppSettings).
struct DesktopUpdatesHubSettings: View {
    var body: some View {
        DesktopAppSettings()
    }
}

/// Settings > App (#2080): Updates first (about.updates), then the way to
/// the centred About window (about.about). The About card has no group
/// title: one LinkRow, as SettingsModal.tsx draws it.
struct DesktopAppSettings: View {
    @EnvironmentObject private var shell: DesktopShellModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            DesktopUpdatesSettings()
            DesktopSettingsGroup(identifier: "about.about") {
                DesktopLinkRow(
                    label: Text("About Sagax: version, license, documentation"),
                    identifier: "desktop-settings.about.open"
                ) {
                    shell.modal = .about
                }
            }
        }
    }
}

/// Settings > Backups and import (#2080): the full backup card, then Import
/// as its second card (backups.import).
struct DesktopBackupsAndImportSettings: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            DesktopBackupsSettings()
            DesktopImportSettings()
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
        case .settingsCloudAccount: (.settings, .general, nil)
        case .settingsOrganization: (.settings, .organization, nil)
        // #4457 / #5527: former pages open their host on the seven-entry rail.
        case .settingsAppearance: (.settings, .general, nil)
        case .settingsDeveloper, .settingsDeveloperScrolled: (.settings, .general, nil)
        case .settingsConnections: (.settings, .providers, nil)
        case .settingsMyConnections: (.settings, .myConnections, nil)
        case .settingsDecisionModel: (.settings, .providers, nil)
        case .settingsEngines: (.settings, .providers, nil)
        case .settingsCompanion: (.settings, .general, nil)
        case .settingsComputer: (.settings, .computer, nil)
        case .settingsUsage: (.settings, .usage, nil)
        case .settingsBackups: (.settings, .general, nil)
        case .settingsAccount: (.settings, .general, nil)
        case .settingsProviders: (.settings, .providers, nil)
        case .settingsVoice: (.settings, .providers, nil)
        case .settingsUpdates: (.settings, .updates, nil)
        case .settingsAbout: (.settings, .updates, nil)
        case .settingsSecurity: (.settings, .security, nil)
        case .settingsCredentials: (.settings, .vault, nil)
        case .settingsNotifications: (.settings, .general, nil)
        case .settingsImport: (.settings, .general, nil)
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

/// settings-general-scrolled, settings-developer-scrolled: the page scrolled to its end.
enum DesktopSettingsScroll {
    static let bottom = "desktop-settings.bottom"
    static let navBottom = "desktop-settings.nav-bottom"

    static var parityScrollsToEnd: Bool {
        #if DEBUG
        [.settingsGeneralScrolled, .settingsDeveloperScrolled].contains(ParityLaunch.current?.iPadScreen)
        #else
        false
        #endif
    }
}

extension Notification.Name {
    /// The app menu's Settings (⌘,): the desktop shell opens its modal.
    static let desktopOpenSettings = Notification.Name("ca.pulsatrix.sagax.desktopOpenSettings")
}
