// iPad I1: the desktop shell. A row like the Electron window's: the sidebar
// (280), the content, and the bot panel (360) docked at 1024 pt and wider,
// over the leading edge below (spec "SwiftUI architecture", "At each iPad
// width"). Not `NavigationSplitView`: it cannot say "dock at 1024, overlay
// below" and brings its own columns, toolbars and glass.
//
// The iPhone never reaches this file: `HomeRoot` picks the desktop shell only
// on an iPad in a regular-width window of 768 pt or more (Slide Over, a
// third of Split View and narrow Stage Manager windows keep the phone UI).
//
// Each column is type-erased (`AnyView`): build 6 overflowed the main
// thread's stack at launch on iPad resolving one deep SwiftUI type.
import SwiftUI
import UIKit
import CompanionCore

// MARK: - Which home

/// The home for the window: the phone's roster, or the desktop shell.
struct HomeRoot: View {
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        if UIDevice.current.userInterfaceIdiom != .pad {
            // the iPhone: exactly the phone home, no measuring around it
            AnyView(ChatListView().parityLauncher())
        } else {
            AnyView(padHome)
        }
    }

    private var padHome: some View {
        GeometryReader { geometry in
            if DesktopShellRules.usesDesktop(
                idiomIsPad: UIDevice.current.userInterfaceIdiom == .pad,
                regularWidth: sizeClass == .regular,
                width: geometry.size.width
            ) {
                AnyView(DesktopShell())
            } else {
                AnyView(ChatListView().parityLauncher())
            }
        }
    }
}

/// The size rules, by window width (`w`).
enum DesktopShellRules {
    static let desktopMinWidth: CGFloat = 768
    static let dockMinWidth: CGFloat = 1024
    static let sidebarWidth: CGFloat = 280
    /// The collapsed sidebar: the icon rail (SIDEBAR_RAIL_WIDTH).
    static let railWidth: CGFloat = 80
    static let panelWidth: CGFloat = 360
    /// The desktop's title band: the top inset of the sidebar and the panel.
    static let topBand: CGFloat = 36
    /// The transcript and composer column caps here (ChatView.tsx:1482).
    static let chatColumn: CGFloat = 960

    static func usesDesktop(idiomIsPad: Bool, regularWidth: Bool, width: CGFloat) -> Bool {
        idiomIsPad && regularWidth && width >= desktopMinWidth
    }

    static func docksPanel(width: CGFloat) -> Bool { width >= dockMinWidth }
}

// MARK: - State

/// The renderer's store, for the shell: what is selected, which panel and
/// modal are open, the sidebar's density and its open menu.
@MainActor
final class DesktopShellModel: ObservableObject {
    enum Modal: String, Identifiable {
        case settings, search, newBot, newGroup, teamMap, automations, plugins, templates, about, shortcuts, achievements
        /// The release notes dialog: browsing (the account menu) or What's new after an update.
        case releaseNotes, whatsNew

        /// Drawn in the shell as the desktop's modals, not as sheets.
        var inShell: Bool { [.settings, .plugins, .shortcuts, .releaseNotes, .whatsNew].contains(self) }
        var id: String { rawValue }
    }

    @Published var selected: Chat?
    /// Team map or Automations in the main column (I-sync); a conversation
    /// opened from the sidebar takes the column back.
    @Published var page: DesktopPage?
    @Published var panelOpen = false
    @Published var panelTab: BotPanelTab = .details
    /// The persona editor sheet over the panel ("Edit persona").
    @Published var personaOpen = false
    /// The persona editor's open section; nil shows its list.
    @Published var panelSection: DesktopPanelSection?
    /// The character editor over the panel (the mascot's Edit avatar).
    @Published var avatarEditorOpen = false
    /// A move the editor asks the panel's owl to play.
    @Published var avatarMove: OwlWingMove?
    /// A Shapes move the editor asks the panel's shape to play.
    @Published var avatarShapeMove: ShapeMove?
    /// Bumped by the panel's Inspector button; the chat column opens it.
    @Published var inspectorRequest = 0
    /// The bot panel's width, 320 to 720 (`omb-settings-panel-width`).
    @Published var panelWidth: CGFloat = CGFloat(DesktopPanelPlacement.clampedWidth(
        UserDefaults.standard.object(forKey: DesktopShellModel.panelWidthKey) as? Double))
    /// The window docks the panel (1024 pt and wider); set by the shell.
    @Published var panelDocked = true

    static let panelWidthKey = "omb-settings-panel-width"

    /// A drag of the panel's edge, held to the desktop's range; saved when
    /// the drag ends.
    func resizePanel(to width: CGFloat, save: Bool) {
        panelWidth = CGFloat(DesktopPanelPlacement.clampedWidth(Double(width)))
        if save { UserDefaults.standard.set(Double(panelWidth), forKey: Self.panelWidthKey) }
    }
    @Published var modal: Modal?
    /// The composer's model picker (I3), over the whole window.
    @Published var modelPickerOpen = false
    /// The Settings modal's section and the Plugins modal's tab (I5).
    @Published var settingsSection: DesktopSettingsSection = .general
    @Published var pluginsTab: DesktopPluginsTab = .mcp

    // MARK: Sidebar (I2)

    /// Comfortable, compact or the 80 pt icon rail (`openmausbot.sidebarDensity`).
    @Published private(set) var density: DesktopSidebarDensity
    /// The row under the pointer: its hover fill and actions.
    @Published var hoveredRow: String?
    /// The desktop popover open over the shell (a row's Actions, the
    /// account menu, New), anchored in the shell's coordinates.
    @Published var menu: DesktopMenuRequest?
    /// Bots whose thread list is open (Show threads on).
    @Published var openThreadLists = Set<String>()
    /// Folders folded in those lists, by "botId:folderId".
    @Published var foldedFolders = Set<String>()
    /// The section a dragged row or section hovers (DD1).
    @Published var dropTarget: String?
    @Published var renamingBot: Bot?
    @Published var renameDraft = ""
    @Published var deletingBot: Bot?
    /// The bot menu's Archive and Replace with different Bot (I2b).
    @Published var archivingBot: Bot?
    @Published var replacingPrimary: Bot?
    /// The team menu's Share team… (the package file, then the share sheet).
    @Published var sharingTeam: String?
    /// The open "To:" picker's ⌘1 to ⌘9 (DesktopKeyCommands routes them).
    var composeActivate: ((Int) -> Void)?
    #if DEBUG
    /// The parity launch's picker state (the desktop reference's pointer
    /// rests on a row after its click).
    var parityComposePreset: (group: Bool, cursor: Int)?
    #endif
    /// The WP5, WP6 and WP11 menus' prompts, mounted once by the shell.
    let threadActions = ThreadActions()
    let sectionActions = SidebarSectionActions()
    let roomActions = RoomActions()
    #if DEBUG
    /// The parity launch's Show threads (the references preset it per
    /// surface); never written to the person's synced preferences.
    @Published var parityShowThreads: Bool?
    #endif

    private let defaults: UserDefaults
    private var persistsDensity = true
    private var defaultsObserver: NSObjectProtocol?

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        density = DesktopSidebarDensity(rawValue: defaults.string(forKey: PrefKey.desktopSidebarDensity) ?? "") ?? .comfortable
        if !ParityMode.isActive {
            sidebarExpandedWidth = CGFloat(DesktopSidebarEdge.clamped(defaults.object(forKey: Self.sidebarWidthKey) as? Double))
        }
        // Settings > Appearance writes the same key (`@AppStorage`).
        defaultsObserver = NotificationCenter.default.addObserver(
            forName: UserDefaults.didChangeNotification, object: defaults, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.reloadDensity() }
        }
    }

    deinit {
        if let defaultsObserver { NotificationCenter.default.removeObserver(defaultsObserver) }
    }

    private func reloadDensity() {
        guard persistsDensity,
              let stored = DesktopSidebarDensity(rawValue: defaults.string(forKey: PrefKey.desktopSidebarDensity) ?? ""),
              stored != density
        else { return }
        withAnimation(.easeOut(duration: 0.2)) { density = stored }
    }

    func open(_ chat: Chat) {
        selected = chat
        page = nil
    }

    /// A sidebar place: its page in the main column.
    func show(_ page: DesktopPage) {
        menu = nil
        self.page = page
    }

    func togglePanel() {
        withAnimation(.easeOut(duration: 0.2)) { panelOpen.toggle() }
        if !panelOpen { avatarEditorOpen = false }
    }

    /// Opens the panel on a tab.
    func showPanel(_ tab: BotPanelTab) {
        panelTab = tab
        if !panelOpen { togglePanel() }
    }

    /// Opens the persona editor over the panel, on its list or on a section
    /// (a deep link such as the allowlist's Permissions).
    func showPersona(_ section: DesktopPanelSection? = nil) {
        panelSection = section
        if !panelOpen { togglePanel() }
        personaOpen = true
    }

    /// The panel's Inspector button (`toggleInspector`): the Inspector takes
    /// the panel's place.
    func requestInspector() {
        inspectorRequest += 1
    }

    var sidebarWidth: CGFloat {
        density == .icons ? DesktopShellRules.railWidth : sidebarExpandedWidth
    }

    /// The expanded sidebar's width, 240 to 400 (`omb-sidebar-width-v2`);
    /// the parity captures keep the desktop's default 280.
    @Published private(set) var sidebarExpandedWidth: CGFloat = DesktopShellRules.sidebarWidth
    static let sidebarWidthKey = "omb-sidebar-width-v2"

    /// A drag of the sidebar's edge (I2b): to the rail under the snap
    /// width, back out past it, and the width in between; kept when the
    /// drag ends.
    func dragSidebarEdge(toRaw raw: CGFloat, save: Bool) {
        switch DesktopSidebarEdge.target(raw: Double(raw)) {
        case .collapsed:
            if density != .icons { setDensity(.icons) }
        case let .expanded(width):
            if density == .icons { toggleCollapsed() }
            sidebarExpandedWidth = CGFloat(width)
            if save, persistsDensity { defaults.set(width, forKey: Self.sidebarWidthKey) }
        }
    }

    /// Settings > Appearance, or the rail's edge: the density, remembered on
    /// this device like the desktop's.
    func setDensity(_ value: DesktopSidebarDensity) {
        guard value != density else { return }
        if density != .icons, value == .icons, persistsDensity {
            defaults.set(density.rawValue, forKey: PrefKey.desktopSidebarExpandedDensity)
        }
        withAnimation(.easeOut(duration: 0.2)) { density = value }
        if persistsDensity { defaults.set(value.rawValue, forKey: PrefKey.desktopSidebarDensity) }
    }

    /// The collapse button: to the rail, or back to the density it left.
    func toggleCollapsed() {
        menu = nil
        if density == .icons {
            let back = DesktopSidebarDensity(rawValue: defaults.string(forKey: PrefKey.desktopSidebarExpandedDensity) ?? "") ?? .comfortable
            setDensity(back == .icons ? .comfortable : back)
        } else {
            setDensity(.icons)
        }
    }

    #if DEBUG
    /// A parity surface's preset density, kept out of the person's defaults.
    func presetDensity(_ value: DesktopSidebarDensity) {
        persistsDensity = false
        density = value
    }
    #endif

    /// ⌘1 to ⌘9 and ⌘⇧[ / ⌘⇧]: the visible bots in the roster's order
    /// (App.tsx: `state.bots` without the hidden ones).
    func jump(to index: Int, in session: Session) {
        let bots = session.state.bots.filter { $0.hidden != true }
        guard bots.indices.contains(index) else { return }
        open(session.returning(to: .bot(bots[index])))
    }

    func step(_ direction: Int, in session: Session) {
        let bots = session.state.bots.filter { $0.hidden != true }
        guard !bots.isEmpty else { return }
        let current = bots.firstIndex { $0.id == selected?.id } ?? -1
        let next = bots[((current + direction) % bots.count + bots.count) % bots.count]
        open(session.returning(to: .bot(next)))
    }
}

// MARK: - Shell

struct DesktopShell: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @StateObject private var model = DesktopShellModel()

    var body: some View {
        let theme = DesktopTheme.of(themePalette.id)
        return GeometryReader { geometry in
            AnyView(columns(width: geometry.size.width, theme: theme))
                .onAppear { model.panelDocked = DesktopShellRules.docksPanel(width: geometry.size.width) }
                .onValueChange(of: geometry.size.width) { model.panelDocked = DesktopShellRules.docksPanel(width: $0) }
        }
        .ignoresSafeArea(.container)
        .coordinateSpace(name: desktopShellSpace)
        .overlay { AnyView(DesktopMenuLayer()) }
        .background { AnyView(DesktopKeyCommands()) }
        .environment(\.desktopTheme, theme)
        .environmentObject(model)
        .statusBarHidden(true)
        // no home indicator over the composer: the desktop window has none
        .persistentSystemOverlays(.hidden)
        .parityLauncher()
        .modifier(DesktopShellPresenter(model: model))
        .modifier(DesktopSidebarPrompts(model: model))
        .modifier(DesktopShellRouting(model: model))
        .onReceive(NotificationCenter.default.publisher(for: .approvalEditRule)) { _ in
            model.showPersona(.access)
        }
        .onReceive(NotificationCenter.default.publisher(for: .desktopOpenSettings)) { _ in
            model.menu = nil
            model.modal = .settings
        }
        .onAppear {
            // What's new, once after an update (`ReleaseNotesPrompt`)
            if ReleaseNotesStore.whatsNewOnLaunch(), model.modal == nil { model.modal = .whatsNew }
        }
    }

    private func columns(width: CGFloat, theme: DesktopTheme) -> some View {
        let docked = DesktopShellRules.docksPanel(width: width)
        let botOpen = model.panelOpen && selectedBot != nil && model.page == nil
        return ZStack(alignment: .topLeading) {
            HStack(spacing: 0) {
                AnyView(DesktopSidebar())
                    .frame(width: model.sidebarWidth)
                    .clipped()
                    .overlay(alignment: .trailing) { DesktopSidebarEdgeHandle(model: model) }
                    .zIndex(1)
                AnyView(DesktopContent())
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                if docked, botOpen, let bot = selectedBot {
                    AnyView(BotPanel(bot: bot, docked: true))
                        .frame(width: model.panelWidth)
                        .overlay(alignment: .leading) { DesktopPanelResizeHandle(model: model) }
                        .transition(.move(edge: .trailing))
                }
            }
            if !docked, botOpen, let bot = selectedBot {
                // Below 1024 the panel covers the leading edge (measured at
                // 834: x 0, 360 wide), the chat still visible to its right.
                Color.black.opacity(0.001)
                    .onTapGesture { model.togglePanel() }
                AnyView(BotPanel(bot: bot, docked: false))
                    .frame(width: min(model.panelWidth, width))
                    .frame(maxHeight: .infinity)
                    .transition(.move(edge: .leading))
            }
            if model.modelPickerOpen, let bot = selectedBot {
                AnyView(DesktopModelPicker(
                    bot: bot.projected(forThread: model.selected?.threadId ?? bot.threadId) ?? bot,
                    close: { model.modelPickerOpen = false },
                    openProviders: {
                        model.modelPickerOpen = false
                        model.settingsSection = .engines
                        model.modal = .settings
                    }
                ))
                .transition(.opacity)
            }
            // I5: Settings and Plugins are the desktop's modals, over everything
            if model.modal == .settings {
                AnyView(DesktopSettingsModal(close: { model.modal = nil }))
                    .transition(.opacity)
            } else if model.modal == .plugins {
                AnyView(DesktopPluginsModal(close: { model.modal = nil }))
                    .transition(.opacity)
            } else if model.modal == .shortcuts {
                AnyView(DesktopShortcutsModal(close: { model.modal = nil }))
                    .transition(.opacity)
            } else if model.modal == .releaseNotes || model.modal == .whatsNew {
                AnyView(DesktopReleaseNotesModal(mode: model.modal == .whatsNew ? .current : .browse, close: { model.modal = nil }))
                    .transition(.opacity)
            }
        }
        .background(theme.app)
    }

    private var selectedBot: Bot? {
        guard case let .bot(bot) = model.selected else { return nil }
        return session.state.bot(bot.id) ?? bot
    }
}

// MARK: - Content column

/// The selected conversation, or a quiet empty state.
struct DesktopContent: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var model: DesktopShellModel

    var body: some View {
        if let page = model.page {
            switch page {
            case .teamMap: AnyView(DesktopTeamMapPage())
            case .automations: AnyView(DesktopAutomationsPage())
            }
        } else if let chat = model.selected {
            AnyView(DesktopChatColumn(chat: chat))
                .id(chat.threadId)
        } else {
            ZStack {
                DesktopAppGlow()
                Text("Pick a conversation in the sidebar.")
                    .font(theme.font(13))
                    .foregroundStyle(theme.inkSecondary)
            }
        }
    }
}

/// `main.app-glow`: the app colour with two radial accent glows from the top.
struct DesktopAppGlow: View {
    @Environment(\.desktopTheme) private var theme

    var body: some View {
        let accent = theme.accent
        let glow = theme.glow
        return ZStack {
            theme.app
            if glow.0 > 0 {
                Canvas { context, size in
                    // radial-gradient(ellipse 110% 62% at 50% 0%, accent a, transparent 70%)
                    Self.ellipse(&context, centre: CGPoint(x: size.width * 0.5, y: 0),
                                 radii: CGSize(width: size.width * 1.10, height: size.height * 0.62),
                                 color: accent, alpha: glow.0, end: 0.70)
                    // radial-gradient(ellipse 72% 44% at 80% 0%, accent b, transparent 68%)
                    Self.ellipse(&context, centre: CGPoint(x: size.width * 0.8, y: 0),
                                 radii: CGSize(width: size.width * 0.72, height: size.height * 0.44),
                                 color: accent, alpha: glow.1, end: 0.68)
                }
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }

    /// One CSS elliptical gradient: a unit circle's radial gradient,
    /// stretched to the ellipse's radii.
    private static func ellipse(_ context: inout GraphicsContext, centre: CGPoint, radii: CGSize, color: Color, alpha: Double, end: CGFloat) {
        var layer = context
        layer.translateBy(x: centre.x, y: centre.y)
        layer.scaleBy(x: radii.width, y: radii.height)
        let gradient = Gradient(stops: [
            .init(color: color.opacity(alpha), location: 0),
            .init(color: color.opacity(0), location: end),
        ])
        layer.fill(
            Path(ellipseIn: CGRect(x: -1, y: -1, width: 2, height: 2)),
            with: .radialGradient(gradient, center: .zero, startRadius: 0, endRadius: 1)
        )
    }
}

// MARK: - Routing

/// Deep links, notifications and the parity launch select a conversation.
private struct DesktopShellRouting: ViewModifier {
    @ObservedObject var model: DesktopShellModel
    @EnvironmentObject private var session: Session
    @ObservedObject private var sidebarPrefs = SidebarPrefsModel.shared

    func body(content: Content) -> some View {
        content
            .onValueChange(of: session.notificationChat) { chat in
                guard let chat else { return }
                model.open(chat)
                session.consumeNotificationChat()
            }
            .onValueChange(of: session.pendingChat) { chat in
                guard let chat else { return }
                model.open(chat)
                session.consumePendingChat()
            }
            // The open conversation disappears (deleted on the server) or the
            // person closes or hides it: the column shows its empty state,
            // never a conversation the sidebar no longer has (bug 2026-10-15).
            .onValueChangePair(of: session.state.rooms.map(\.id)) { previous, _ in leaveIfGone(wasIn: previous) }
            .onValueChangePair(of: session.state.bots.map(\.id)) { previous, _ in leaveIfGone(wasIn: previous) }
            .onValueChangePair(of: sidebarPrefs.prefs.hidden) { previous, next in
                if let chat = model.selected, OpenConversation.newlyHidden(chat, previous: previous, next: next) {
                    model.selected = nil
                }
            }
            .task {
                if let chat = session.notificationChat {
                    model.open(chat)
                    session.consumeNotificationChat()
                }
                if let chat = session.pendingChat {
                    model.open(chat)
                    session.consumePendingChat()
                }
                #if DEBUG
                await applyParityLaunch()
                #endif
                await openDefault()
            }
            .task(id: session.connection?.id) {
                await session.loadAccount()
                await SidebarPrefsModel.shared.load(session)
            }
    }

    /// Only a conversation that was there counts as gone: one opened from a
    /// notification before the snapshot lands stays.
    private func leaveIfGone(wasIn previous: [String]) {
        guard let chat = model.selected, previous.contains(chat.id) else { return }
        if !OpenConversation.present(chat, in: session.state) { model.selected = nil }
    }

    /// The desktop opens on a conversation: the Primary Bot, else the first bot.
    private func openDefault() async {
        for _ in 0..<150 where model.selected == nil {
            let bots = session.state.bots.filter { $0.hidden != true }
            if let first = bots.first(where: { $0.chiefOfStaff == true }) ?? bots.first {
                model.open(session.returning(to: .bot(first)))
                return
            }
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
    }

    #if DEBUG
    /// `-parityIPadScreen main | panel-details | main-compact | ...`: Ara's
    /// chat (the desktop references select Ara), the panel open for the
    /// panel surfaces, and the sidebar surfaces' presets: the density, Show
    /// threads (off except main-threads, as the references' localStorage),
    /// the pointer over Aurora, or a menu open where the desktop opened it.
    private func applyParityLaunch() async {
        guard let screen = ParityLaunch.current?.iPadScreen, screen.implemented else { return }
        model.parityShowThreads = screen == .mainThreads || screen == .chatThreads
        switch screen {
        case .mainCompact: model.presetDensity(.compact)
        case .mainCollapsed: model.presetDensity(.icons)
        default: model.presetDensity(.comfortable)
        }
        for _ in 0..<150 {
            if screen == .groupChat {
                // the room chat (Peer Managers), as the reference selects it
                if let room = session.state.rooms.first(where: { $0.name == "Peer Managers" }) {
                    model.open(.room(room))
                    return
                }
            } else if let ara = session.state.bots.first(where: { $0.name == "Ara" }) {
                model.open(.bot(ara))
                model.panelOpen = screen.opensBotPanel
                if let tab = screen.panelTab { model.panelTab = tab }
                model.panelSection = screen.panelSection
                model.personaOpen = screen.opensPersonaEditor
                model.avatarEditorOpen = screen == .panelAvatarEditor
                model.modelPickerOpen = screen == .chatModelPicker
                model.applyParityModals(screen)
                model.page = screen.parityPage
                if screen == .keyboardShortcuts { model.modal = .shortcuts }
                await applyParitySidebar(screen)
                return
            }
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
    }

    /// The sidebar surfaces' pointer and menus, at the references' points
    /// (desktop-*-08 to -12 DOM dumps). On the iPad a right click or a long
    /// press opens iPadOS's context menu with the same entries; the
    /// surfaces draw the desktop popover at the desktop's click point.
    private func applyParitySidebar(_ screen: IPadParityScreen) async {
        let bot = { (name: String) in session.state.bots.first { $0.name == name } }
        let height = UIScreen.main.bounds.height
        switch screen {
        case .sidebarRowHover:
            model.hoveredRow = bot("Aurora")?.id
        case .sidebarBotMenu:
            // the reference moves the pointer away after the click: no hover
            guard let aurora = bot("Aurora") else { return }
            model.menu = DesktopMenuRequest(kind: .bot(aurora.id), anchor: CGPoint(x: 235, y: 413))
        case .sidebarBotContextMenu:
            guard let helix = bot("Helix") else { return }
            model.menu = DesktopMenuRequest(kind: .bot(helix.id), anchor: CGPoint(x: 76, y: 446))
        case .sidebarSectionMenu:
            guard let aurora = bot("Aurora"), let team = aurora.section, !team.isEmpty else { return }
            model.menu = DesktopMenuRequest(kind: .section(SidebarSectionID.user(team)), anchor: CGPoint(x: 68, y: 351))
        case .sidebarProfileMenu:
            // 4 pt over the 48 pt account row (12 pt from the bottom)
            model.menu = DesktopMenuRequest(kind: .profile, anchor: CGPoint(x: 8, y: height - 64), opensUp: true)
        case .sidebarNewMenu:
            model.menu = DesktopMenuRequest(kind: .new, anchor: .zero)
        case .newGroup:
            // the reference's pointer stays on the row under the click (Orion)
            model.parityComposePreset = (group: true, cursor: 1)
            model.menu = DesktopMenuRequest(kind: .new, anchor: .zero)
        default:
            break
        }
    }
    #endif
}

// MARK: - Modals

/// The surfaces I5-I8 turn into desktop modals; for now the phone's own
/// sheets, presented as iPad form sheets.
private struct DesktopShellPresenter: ViewModifier {
    @ObservedObject var model: DesktopShellModel
    @EnvironmentObject private var session: Session

    func body(content: Content) -> some View {
        content.sheet(item: sheetModal) { modal in
            AnyView(sheet(modal))
                .environmentObject(session)
        }
    }

    /// Settings and Plugins draw in the shell as the desktop's modals (I5);
    /// the other surfaces are still sheets.
    private var sheetModal: Binding<DesktopShellModel.Modal?> {
        Binding(
            get: { model.modal.flatMap { $0.inShell ? nil : $0 } },
            set: { model.modal = $0 }
        )
    }

    @ViewBuilder
    private func sheet(_ modal: DesktopShellModel.Modal) -> some View {
        switch modal {
        case .settings:
            EmptyView()
        case .search:
            // The phone's sheet, large: the iPad's page sheet holds it
            // (no dim or top inset of its own).
            SearchSheet(embedded: true, close: { model.modal = nil }) { destination in
                model.modal = nil
                switch destination {
                case let .chat(chat): model.open(session.returning(to: chat))
                case let .exact(chat): model.open(chat)
                }
            }
            .searchPageSheet()
        case .newBot:
            CreateBotSheet(close: { model.modal = nil }) { bot in
                model.modal = nil
                model.open(.bot(bot))
            }
        case .newGroup:
            NewGroupSheet(close: { model.modal = nil }) { room in
                model.modal = nil
                model.open(.room(room))
            }
        case .teamMap:
            TeamMapSheet { chat in
                model.modal = nil
                model.open(chat)
            }
        case .automations:
            AutomationsSheet()
        case .plugins:
            EmptyView()
        case .templates:
            DesktopTemplatesSheet { model.modal = nil }
        case .about:
            NavigationStack { AboutPage() }
        case .shortcuts, .releaseNotes, .whatsNew:
            EmptyView()
        case .achievements:
            NavigationStack {
                AchievementsPage()
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) { Button("Done") { model.modal = nil } }
                    }
            }
        }
    }
}

// MARK: - Panel edge

/// The docked panel's resize handle (`app-resize-handle`, 12 pt across its
/// leading edge): drag to 320 to 720 pt; the width is kept.
private struct DesktopPanelResizeHandle: View {
    @ObservedObject var model: DesktopShellModel
    @State private var start: CGFloat?

    var body: some View {
        Color.clear
            .frame(width: 12)
            .contentShape(Rectangle())
            .offset(x: -6)
            .hoverEffect(.highlight)
            .gesture(
                DragGesture(minimumDistance: 2, coordinateSpace: .global)
                    .onChanged { value in
                        let from = start ?? model.panelWidth
                        if start == nil { start = from }
                        model.resizePanel(to: from - value.translation.width, save: false)
                    }
                    .onEnded { _ in
                        start = nil
                        model.resizePanel(to: model.panelWidth, save: true)
                    }
            )
            .accessibilityElement()
            .accessibilityLabel(Text("Resize settings"))
            .accessibilityValue(Text(verbatim: "\(Int(model.panelWidth))"))
            .accessibilityAdjustableAction { direction in
                switch direction {
                case .increment: model.resizePanel(to: model.panelWidth + 24, save: true)
                case .decrement: model.resizePanel(to: model.panelWidth - 24, save: true)
                @unknown default: break
                }
            }
    }
}
