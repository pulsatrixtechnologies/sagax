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
        case .general: "General"
        case .organization: "Organization"
        case .appearance: "Appearance"
        case .experimental: "Experimental"
        case .connections: "API keys"
        case .myConnections: "My connections"
        case .decisionModel: "Decision model"
        case .engines: "Models and voice"
        case .companion: "Pair devices"
        case .computer: "Local VM"
        case .usage: "Usage"
        case .people: "People"
        case .mail: "Email"
        case .activity: "Activity"
        case .backups: "Backups"
        }
    }

    /// The label as a string, for search (in the app's language).
    var labelString: String {
        switch self {
        case .general: AppStrings.localized("General")
        case .organization: AppStrings.localized("Organization")
        case .appearance: AppStrings.localized("Appearance")
        case .experimental: AppStrings.localized("Experimental")
        case .connections: AppStrings.localized("API keys")
        case .myConnections: AppStrings.localized("My connections")
        case .decisionModel: AppStrings.localized("Decision model")
        case .engines: AppStrings.localized("Models and voice")
        case .companion: AppStrings.localized("Pair devices")
        case .computer: AppStrings.localized("Local VM")
        case .usage: AppStrings.localized("Usage")
        case .people: AppStrings.localized("People")
        case .mail: AppStrings.localized("Email")
        case .activity: AppStrings.localized("Activity")
        case .backups: AppStrings.localized("Backups")
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
        case .companion: .tabletSmartphone
        case .computer: .monitor
        case .usage: .coins
        case .people: .users
        case .mail: .mail
        case .activity: .scrollText
        case .backups: .archive
        }
    }
}

// MARK: - Nav

/// The 198 pt nav (`bg-panel px-3 py-4`, a hairline at its right).
struct DesktopSettingsNav: View {
    @Environment(\.desktopTheme) private var theme
    let sections: [DesktopSettingsSection]
    let current: DesktopSettingsSection
    @Binding var query: String
    let choose: (DesktopSettingsSection) -> Void
    @FocusState private var searching: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            DesktopText("Settings", weight: .semibold, line: 19.5)
                .padding(8)
            search
                .padding(.top, 4)
                .padding(.bottom, 8)
            if sections.isEmpty {
                DesktopText(Text("No settings match “\(query.trimmingCharacters(in: .whitespaces))”."),
                            size: 12.5, line: 20.3, color: \.inkSecondary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 16)
            }
            ForEach(sections, id: \.self) { section in
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
        case .myConnections: AnyView(DesktopMyConnectionsSettings())
        case .decisionModel: AnyView(DesktopDecisionModelSettings())
        // Models and voice (#518): the providers, then API keys and the
        // Decision model as cards of the page
        case .engines: AnyView(DesktopModelsVoiceSettings())
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
struct DesktopModelsVoiceSettings: View {
    @Environment(\.desktopSettingsQuery) private var query

    /// A search for a key or the decision model opens its card, as the
    /// desktop's `cardsMatching` does.
    private func searched(_ section: DesktopSettingsSection) -> Bool {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return q.count >= 3 && section.matches(q, label: "")
    }

    var body: some View {
        let keys = searched(.connections)
        let decision = searched(.decisionModel)
        AnyView(DesktopEnginesSettings())
        DesktopSettingsCard(Text("API keys"), summary: Text("Providers and connected apps"), open: keys, identifier: "engines.keys") {
            VStack(alignment: .leading, spacing: 12) {
                AnyView(DesktopAPIKeysSettings())
            }
        }
        .id("keys-\(keys)")
        .padding(.top, 12)
        DesktopSettingsCard(Text("Decision model"), summary: Text(verbatim: "Jev"), open: decision, identifier: "engines.decisionModel") {
            VStack(alignment: .leading, spacing: 12) {
                AnyView(DesktopDecisionModelSettings())
            }
        }
        .id("decision-\(decision)")
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
        case .settingsGeneral, .settingsGeneralScrolled: (.settings, .general, nil)
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
