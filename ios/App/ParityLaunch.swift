// DEBUG-only entry points for the visual-parity harness (ios/parity/).
//
// The harness runs the real server on a throwaway data directory, pairs
// through the server's own pairing API and launches the app with:
//
//   -parityEndpoint http://127.0.0.1:PORT   the server to use
//   -parityToken TOKEN                      the bearer it issued
//   -parityEnvironment ENV                  its environment id (server pairing)
//   -parityScreen 02-chat                   which reference screen to open
//
// Nothing is written to the Keychain or the saved connections: the session
// is built in memory, so a build without signing entitlements works and a
// normal launch afterwards finds the phone exactly as it was. Release builds
// compile none of this.
import SwiftUI
import CompanionCore

/// The 21 reference screens, plus Settings > Appearance and the theme gallery.
enum ParityScreen: String, CaseIterable {
    case home = "01-home"
    case chat = "02-chat"
    case profileInfo = "03-profile-info"
    case profileInfoScrolled = "04-profile-info-scrolled"
    case routineDetail = "05-routine-detail"
    case routineInstruction = "06-routine-instruction"
    case profileMoreMenu = "07-profile-more-menu"
    case profileLinks = "08-profile-links"
    case profileMedia = "09-profile-media"
    case profileFiles = "10-profile-files"
    case computerTrackpadToast = "11-computer-trackpad-toast"
    case settingsTop = "12-settings-top"
    case computer = "13-computer"
    case settingsBottom = "14-settings-bottom"
    case plugins = "15-plugins"
    case account = "16-account"
    case newGroupChat = "17-new-group-chat"
    case homePlusMenu = "18-home-plus-menu"
    case search = "19-search"
    /// Not a reference: search with "ar" typed (grouped results, bold match).
    case searchTyped = "search-typed"
    /// Not a reference: the home's "+" as New chat (bots and members).
    case newChat = "new-chat"
    case createBot = "20-create-bot"
    case botComputer = "21-bot-computer"
    /// Not a reference: Settings > Appearance, for the theme captures.
    case appearance = "22-appearance"
    case themeGallery = "theme-gallery"
    /// Not a reference: the profile sheet's Computer tab (its screen picker).
    case profileComputer = "profile-computer"

    /// Accepts the full name, the number ("02") or the name ("chat").
    init?(argument: String) {
        let value = argument.lowercased()
        if let exact = ParityScreen(rawValue: value) { self = exact; return }
        guard let match = Self.allCases.first(where: { screen in
            let parts = screen.rawValue.split(separator: "-", maxSplits: 1)
            return parts.first.map(String.init) == value || (parts.count == 2 && String(parts[1]) == value)
        }) else { return nil }
        self = match
    }

    /// Screens shown inside Ara's chat (pushed from the home).
    var opensAraChat: Bool {
        switch self {
        case .chat, .profileInfo, .profileInfoScrolled, .profileMoreMenu, .profileLinks, .profileMedia,
             .profileFiles, .computer, .computerTrackpadToast, .routineDetail, .routineInstruction, .profileComputer:
            true
        default:
            false
        }
    }

    var opensComputer: Bool { self == .computer || self == .computerTrackpadToast }

    /// Screens the home opens itself: its "+" menu and its sheets.
    var opensFromHome: Bool {
        switch self {
        case .home, .homePlusMenu, .search, .searchTyped, .newChat, .newGroupChat, .createBot,
             .settingsTop, .settingsBottom, .plugins, .account, .botComputer, .appearance: true
        default: false
        }
    }

    /// Screens on Ara's profile (pushed from the chat); 05 and 06 go on to
    /// her first routine.
    var opensProfile: Bool {
        switch self {
        case .profileInfo, .profileInfoScrolled, .profileMoreMenu, .profileLinks, .profileMedia, .profileFiles,
             .routineDetail, .routineInstruction, .profileComputer:
            true
        default:
            false
        }
    }
}


// MARK: - iPad: the desktop surfaces
//
// The iPad must look like the desktop app (src/, the Electron renderer). Its
// references are captured from the renderer by ios/parity/desktop/
// capture-desktop.mjs at the iPad viewports; ios/parity/desktop/capture-ipad.sh
// launches the app with
//
//   -parityIPadScreen main          which desktop surface to draw (the ids below)
//   -parityOrientation landscape    landscape | portrait: what the harness turned the
//                                   device to (a UI test does it; iPadOS refuses
//                                   programmatic rotation in its windowing mode)
//   -paritySkin midnight            the desktop skin, for the main-skin-* references
//
// beside -parityEndpoint/-parityToken, and diffs the screenshot against
// refs/desktop-<W>x<H>-<NN>-<id>.png. The ids are the desktop surface names
// of ios/parity/desktop/surfaces.mjs (the NN prefix is only in file names),
// in the same order; capture-ipad.sh refuses to run when the two lists
// differ. A surface not built yet draws IPadParityPlaceholder, so the diff
// measures the whole gap.
enum IPadParityScreen: String, CaseIterable {
    case onboardingWelcome = "onboarding-welcome"
    case onboardingTour = "onboarding-tour"
    case main = "main"
    case mainCompact = "main-compact"
    case mainCollapsed = "main-collapsed"
    case mainThreads = "main-threads"
    case sidebarRowHover = "sidebar-row-hover"
    case sidebarBotMenu = "sidebar-bot-menu"
    case sidebarBotContextMenu = "sidebar-bot-context-menu"
    case sidebarSectionMenu = "sidebar-section-menu"
    case sidebarProfileMenu = "sidebar-profile-menu"
    case sidebarNewMenu = "sidebar-new-menu"
    case newGroup = "new-group"
    case searchPalette = "search-palette"
    case searchPaletteQuery = "search-palette-query"
    case chatTop = "chat-top"
    case chatAttachments = "chat-attachments"
    case chatMarkdown = "chat-markdown"
    case chatApproval = "chat-approval"
    case chatQuestion = "chat-question"
    case chatMessageHover = "chat-message-hover"
    case chatComposerDraft = "chat-composer-draft"
    case chatComposerSlash = "chat-composer-slash"
    case chatExportMenu = "chat-export-menu"
    case chatModelPicker = "chat-model-picker"
    case chatApprovalMode = "chat-approval-mode"
    case chatWhereMenu = "chat-where-menu"
    case chatFind = "chat-find"
    case chatThreads = "chat-threads"
    case inspector = "inspector"
    case groupChat = "group-chat"
    case groupPanel = "group-panel"
    case panelDetails = "panel-details"
    case panelAvatarEditor = "panel-avatar-editor"
    case panelLibrary = "panel-library"
    case panelComputer = "panel-computer"
    case panelMore = "panel-more"
    case panelMoreOverview = "panel-more-overview"
    case panelMoreSlack = "panel-more-slack"
    case panelMoreSoul = "panel-more-soul"
    case panelMoreSkills = "panel-more-skills"
    case panelMoreMemory = "panel-more-memory"
    case panelMoreAccess = "panel-more-access"
    case panelMoreWorksOn = "panel-more-works-on"
    case panelMoreModel = "panel-more-model"
    case panelMorePermissions = "panel-more-permissions"
    case panelMoreVoice = "panel-more-voice"
    case panelMoreVisibility = "panel-more-visibility"
    case panelMoreSharing = "panel-more-sharing"
    case panelMorePerspicax = "panel-more-perspicax"
    case panelMoreHistory = "panel-more-history"
    case panelMoreUsage = "panel-more-usage"
    case routinesCalendar = "routines-calendar"
    case routinesList = "routines-list"
    case routinesLogs = "routines-logs"
    case teamMap = "team-map"
    case templates = "templates"
    case newBot = "new-bot"
    case pluginsMcp = "plugins-mcp"
    case keyboardShortcuts = "keyboard-shortcuts"
    case noticeThreadGone = "notice-thread-gone"
    case settingsGeneral = "settings-general"
    case settingsOrganization = "settings-organization"
    case settingsCloudAccount = "settings-cloudAccount"
    case settingsAppearance = "settings-appearance"
    case settingsExperimental = "settings-experimental"
    case settingsConnections = "settings-connections"
    case settingsDecisionModel = "settings-decisionModel"
    case settingsEngines = "settings-engines"
    case settingsCompanion = "settings-companion"
    case settingsComputer = "settings-computer"
    case settingsUsage = "settings-usage"
    case settingsPeople = "settings-people"
    case settingsMail = "settings-mail"
    case settingsActivity = "settings-activity"
    case settingsBackups = "settings-backups"
    case settingsWorkspaces = "settings-workspaces"
    case settingsGeneralScrolled = "settings-general-scrolled"
    // I-sync: appended after the I5 list (surfaces.mjs keeps the numbers)
    case panelLibrarySkills = "panel-library-skills"
    case panelLibraryPlugins = "panel-library-plugins"
    case settingsMyConnections = "settings-myConnections"

    /// Accepts the id, or a capture file stem ("03-main", "desktop-1366x1024-03-main").
    init?(argument: String) {
        // ids keep their case (settings-decisionModel): match without it
        let value = argument.lowercased()
        if let exact = Self.allCases.first(where: { $0.rawValue.lowercased() == value }) { self = exact; return }
        guard let match = Self.allCases
            .sorted(by: { $0.rawValue.count > $1.rawValue.count })
            .first(where: { value.hasSuffix("-" + $0.rawValue.lowercased()) })
        else { return nil }
        self = match
    }

    /// Built for the iPad so far (the desktop shell draws them itself).
    /// Everything else routes to the placeholder.
    var implemented: Bool {
        switch self {
        case .main, .panelDetails: true
        // I2: the sidebar's densities, threads, hover and menus
        case .mainCompact, .mainCollapsed, .mainThreads, .sidebarRowHover, .sidebarBotMenu,
             .sidebarBotContextMenu, .sidebarSectionMenu, .sidebarProfileMenu, .sidebarNewMenu, .newGroup: true
        default: isDesktopChat || opensBotPanel || isDesktopSettings || parityPage != nil || self == .keyboardShortcuts
        }
    }

    /// The bot panel is open on this surface (I4).
    var opensBotPanel: Bool { panelTab != nil }

    /// The panel's tab on a panel surface.
    var panelTab: DesktopPanelTab? {
        switch self {
        case .panelDetails, .panelAvatarEditor: .details
        case .panelLibrary, .panelLibrarySkills, .panelLibraryPlugins: .library
        case .panelComputer: .computer
        // the persona editor opens over Details, as on the desktop
        case .panelMore: .details
        default: panelSection != nil ? .details : nil
        }
    }

    /// The persona editor is open on this surface (`panel-more` and its
    /// sections keep their ids from when it was the More tab).
    var opensPersonaEditor: Bool { self == .panelMore || panelSection != nil }

    /// The persona editor section open on a `panel-more-<section>` surface
    /// (the section's id in kebab case: `panel-more-works-on` is worksOn).
    var panelSection: DesktopPanelSection? {
        guard rawValue.hasPrefix("panel-more-") else { return nil }
        let id = String(rawValue.dropFirst("panel-more-".count))
        return DesktopPanelSection.allCases.first { section in
            section.rawValue.replacingOccurrences(of: "([A-Z])", with: "-$1", options: .regularExpression).lowercased() == id
        }
    }
}

#if DEBUG
struct ParityLaunch {
    let endpoint: URL
    let token: String
    let environmentId: String?
    let screen: ParityScreen?
    /// iPad desktop-parity launch (ios/parity/desktop/capture-ipad.sh).
    var iPadScreen: IPadParityScreen? = nil
    var orientation: String? = nil
    var skin: String? = nil
    /// `-parityChat NAME`: the chat screens open this bot instead of Ara
    /// (the card lab of the WP2 UI tests).
    var chatName: String? = nil

    static let current: ParityLaunch? = parse(ProcessInfo.processInfo.arguments)

    /// Launch arguments arrive as `-key value` pairs.
    static func parse(_ arguments: [String]) -> ParityLaunch? {
        func value(_ key: String) -> String? {
            guard let index = arguments.firstIndex(of: key), arguments.indices.contains(index + 1) else { return nil }
            return arguments[index + 1]
        }
        guard let raw = value("-parityEndpoint"), let endpoint = URL(string: raw),
              endpoint.host != nil, let token = value("-parityToken"), !token.isEmpty
        else { return nil }
        return ParityLaunch(
            endpoint: endpoint,
            token: token,
            environmentId: value("-parityEnvironment"),
            screen: value("-parityScreen").flatMap(ParityScreen.init(argument:)),
            iPadScreen: value("-parityIPadScreen").flatMap(IPadParityScreen.init(argument:)),
            orientation: value("-parityOrientation"),
            skin: value("-paritySkin"),
            chatName: value("-parityChat")
        )
    }

    /// The in-memory connection the session uses.
    var connection: Connection {
        Connection(
            id: "parity-harness",
            name: "Parity fixture",
            host: endpoint.host ?? "127.0.0.1",
            port: endpoint.port ?? 8799,
            serverEnvironmentId: environmentId,
            serverScopes: ["admin", "client"]
        )
    }
}

/// Opens the requested reference screen once the roster has arrived.
struct ParityScreenLauncher: ViewModifier {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @State private var presented: ParityScreen?
    @State private var launched = false

    func body(content: Content) -> some View {
        content
            .task {
                guard !launched, let screen = ParityLaunch.current?.screen else { return }
                launched = true
                if screen.opensAraChat {
                    // Wait for the fleet, then push Ara's chat the way a deep link does.
                    let name = ParityLaunch.current?.chatName ?? "Ara"
                    for _ in 0..<150 {
                        if let ara = session.state.bots.first(where: { $0.name == name }) {
                            session.openChat(threadId: ara.threadId)
                            return
                        }
                        // a room by its name (the composer tests' Lab Room)
                        if let room = session.state.rooms.first(where: { $0.name == name }) {
                            session.openChat(threadId: room.threadId)
                            return
                        }
                        try? await Task.sleep(nanoseconds: 100_000_000)
                    }
                    return
                }
                if screen.opensFromHome { return }
                for _ in 0..<150 where session.state.bots.isEmpty {
                    try? await Task.sleep(nanoseconds: 100_000_000)
                }
                presented = screen
            }
            .sheet(isPresented: sheetBinding) {
                switch presented {
                default:
                    EmptyView()
                }
            }
            .fullScreenCover(isPresented: coverBinding) {
                if presented == .themeGallery {
                    ThemeGalleryView()
                } else {
                    ParityPlaceholderView(screen: presented ?? .home) { presented = nil }
                }
            }
    }

    private static let sheetScreens: Set<ParityScreen> = []

    private var sheetBinding: Binding<Bool> {
        Binding(
            get: { presented.map(Self.sheetScreens.contains) ?? false },
            set: { if !$0 { presented = nil } }
        )
    }

    private var coverBinding: Binding<Bool> {
        Binding(
            get: { presented.map { !Self.sheetScreens.contains($0) && !$0.opensAraChat && !$0.opensFromHome } ?? false },
            set: { if !$0 { presented = nil } }
        )
    }
}

/// Draws the requested desktop surface over the whole iPad window.
struct IPadParityLauncher: ViewModifier {
    @State private var presented: IPadParityScreen?

    func body(content: Content) -> some View {
        content
            .task {
                guard let screen = ParityLaunch.current?.iPadScreen, !screen.implemented else { return }
                presented = screen
            }
            .fullScreenCover(item: $presented) { screen in
                IPadParityRoot(screen: screen)
            }
    }
}

extension IPadParityScreen: Identifiable {
    var id: String { rawValue }
}

/// The iPad surface for a desktop reference. Each case moves from the
/// placeholder to its real view as the iPad UI is built.
struct IPadParityRoot: View {
    let screen: IPadParityScreen

    var body: some View {
        switch screen {
        default:
            IPadParityPlaceholder(screen: screen)
        }
    }
}

/// A desktop surface the iPad does not draw yet: the desktop's own app
/// background (Pulsatrix skin, --color-app #030b17) and the surface id, so
/// the diff reports the full distance to the reference.
struct IPadParityPlaceholder: View {
    let screen: IPadParityScreen

    var body: some View {
        ZStack {
            Color(red: 3 / 255, green: 11 / 255, blue: 23 / 255).ignoresSafeArea()
            Text(verbatim: "iPad parity placeholder: \(screen.rawValue)")
                .font(.system(size: 13))
                .foregroundStyle(Color(red: 154 / 255, green: 166 / 255, blue: 194 / 255))
        }
        .preferredColorScheme(.dark)
    }
}

/// A screen that a later phase builds. Drawn on the theme background so the
/// diff measures the gap honestly instead of comparing against the home.
struct ParityPlaceholderView: View {
    @Environment(\.themePalette) var themePalette
    let screen: ParityScreen
    let close: () -> Void

    var body: some View {
        ZStack(alignment: .topLeading) {
            Theme.bg.ignoresSafeArea()
            GlassCircleButton(systemImage: "xmark", action: close)
                .padding(.leading, Theme.Metric.screenEdge)
                .padding(.top, 12)
            Text(verbatim: "Parity placeholder: \(screen.rawValue)")
                .font(Theme.Font.label)
                .foregroundStyle(Theme.textTertiary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}
#endif

extension View {
    /// The parity harness's screen launcher in DEBUG; nothing otherwise.
    @ViewBuilder
    func parityLauncher() -> some View {
        #if DEBUG
        if ParityLaunch.current?.iPadScreen != nil {
            modifier(IPadParityLauncher())
        } else if ParityLaunch.current != nil {
            modifier(ParityScreenLauncher())
        } else {
            self
        }
        #else
        self
        #endif
    }
}
