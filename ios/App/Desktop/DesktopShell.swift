// iPad I1: the desktop shell. A row like the Electron window's: the sidebar
// (280), the content, and the bot panel (308) docked at 1024 pt and wider,
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
        // the bot creation wizard over either home (2026-10-26)
        Group {
            if UIDevice.current.userInterfaceIdiom != .pad {
                // the iPhone: exactly the phone home, no measuring around it
                AnyView(ChatListView().parityLauncher())
            } else {
                AnyView(padHome)
            }
        }
        .botWizardHost()
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
    /// Bot panel like Grok Bot (`BOT_PANEL_BOUNDS` fallback 308, #2141).
    static let panelWidth: CGFloat = 308
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
        case settings, search, newBot, newGroup, teamMap, automations, memory, plugins, templates, about, shortcuts, achievements
        /// The release notes dialog: browsing (the account menu) or What's new after an update.
        case releaseNotes, whatsNew

        /// Drawn in the shell as the desktop's modals, not as sheets.
        var inShell: Bool { [.settings, .search, .plugins, .shortcuts, .about, .releaseNotes, .whatsNew, .newBot].contains(self) }
        var id: String { rawValue }
    }

    @Published var selected: Chat?
    /// Team map or Automations in the main column (I-sync); a conversation
    /// opened from the sidebar takes the column back.
    @Published var page: DesktopPage?
    @Published var panelOpen = false
    @Published var panelTab: BotPanelTab = .activity
    /// The bot's profile page fills the main column (#2136 / #1939).
    @Published var personaOpen = false
    /// The section a deep link asked for (kept for the panel's callers).
    @Published var panelSection: DesktopPanelSection?
    /// Deep-link page inside the profile host (Appearance, Access, …).
    @Published var personaPage: DesktopPersonaPage = .overview
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
    /// Bots whose thread list is open (Show threads on, in the sidebar),
    /// remembered on this device: a relaunch, a refresh or another bot's
    /// selection never folds one shut.
    @Published var openThreadLists = Set(UserDefaults.standard.stringArray(forKey: DesktopShellModel.openThreadListsKey) ?? []) {
        didSet { UserDefaults.standard.set(Array(openThreadLists).sorted(), forKey: DesktopShellModel.openThreadListsKey) }
    }
    static let openThreadListsKey = "sagax.sidebar.threadsOpen.v1"
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
    /// A bot row's Share: the link that opens this bot in Sagax.
    @Published var sharingBotLink: URL?
    /// The sidebar's multi-select of bots (lot 6): the row menu's Select, the
    /// rows' checks and the bar's grouped actions.
    @Published var selection = DesktopBotSelection()
    /// The bar's Edit (Edit N bots) and Archive confirmation.
    @Published var bulkEditing = false
    @Published var archivingSelection = false
    /// The bot's computer window drawn in the shell (lot 6): the fallback
    /// where iPadOS has no second scene to give it, and the parity captures.
    @Published var computerWindow: String?
    /// The chat column's notice (`state.notice`, ChatErrorBanner.tsx
    /// ChatNotice): a dead thread link, a bot that is gone; it clears
    /// itself after 6 s, as the desktop's store does.
    @Published var notice: DesktopNotice?

    func show(notice: DesktopNotice, clearsAfter seconds: Double = 6) {
        self.notice = notice
        let shown = notice
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            if self?.notice == shown { self?.notice = nil }
        }
    }
    /// The open "To:" picker's ⌘1 to ⌘9 (DesktopKeyCommands routes them).
    var composeActivate: ((Int) -> Void)?
    #if DEBUG
    /// The parity launch's picker state (the desktop reference's pointer
    /// rests on a row after its click).
    var parityComposePreset: (group: Bool, cursor: Int)?
    #endif
    /// ⌘⇧N: the next "To:" picker opens in group mode.
    var composeGroupMode = false
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
        // Leaving the bot's profile page for its chat (#2136).
        if personaOpen { personaOpen = false; panelSection = nil }
    }

    /// A sidebar place: its page in the main column.
    func show(_ page: DesktopPage) {
        menu = nil
        self.page = page
        if personaOpen { personaOpen = false; panelSection = nil }
    }

    func togglePanel() {
        withAnimation(.easeOut(duration: 0.2)) { panelOpen.toggle() }
    }

    /// Opens the panel on a tab.
    func showPanel(_ tab: BotPanelTab) {
        panelTab = tab
        if !panelOpen { togglePanel() }
    }

    /// Opens the bot's profile page in the main column (#2136), on its root
    /// or on a section (a deep link such as the allowlist's Permissions).
    /// The right panel closes so the page fills the chat's place.
    func showPersona(_ section: DesktopPanelSection? = nil) {
        panelSection = section
        personaPage = DesktopPersonaPage(section: section)
        page = nil
        if panelOpen {
            withAnimation(.easeOut(duration: 0.2)) { panelOpen = false }
        }
        personaOpen = true
    }

    /// A click on the bot's avatar: Edit bot on Appearance (`openPersonaEditor`).
    /// Set the page before opening so the host does not land on the profile
    /// root for one frame (#1939).
    func showAppearance() {
        panelSection = nil
        personaPage = .appearance
        page = nil
        if panelOpen {
            withAnimation(.easeOut(duration: 0.2)) { panelOpen = false }
        }
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
    /// The guided first run, the terms of use and the guided tour.
    @StateObject private var onboarding = DesktopOnboardingModel()
    /// Connect apps on its Bots tab, from the old link to Browse Bots.
    @State private var connectAppsBots = false

    var body: some View {
        let theme = DesktopTheme.of(themePalette)
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
        .modifier(DesktopSelectionPrompts(model: model))
        .modifier(DesktopShellRouting(model: model))
        .onReceive(NotificationCenter.default.publisher(for: .approvalEditRule)) { _ in
            model.showPersona(.access)
        }
        // a finished bot creation wizard opens the bot it made
        .onReceive(BotWizardPresenter.shared.$finishedBotId) { id in
            guard let id, let bot = session.state.bot(id) else { return }
            BotWizardPresenter.shared.finishedBotId = nil
            model.open(.bot(bot))
        }
        // the old link to Browse Bots' home: Settings closes, Connect apps
        // opens on its Bots tab (the catalogue lives there now)
        .onReceive(NotificationCenter.default.publisher(for: .sagaxOpenBotTemplates)) { _ in
            model.menu = nil
            model.modal = nil
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { connectAppsBots = true }
        }
        .sheet(isPresented: $connectAppsBots) {
            ConnectAppsPage(initialTab: .bots)
                .environmentObject(session)
        }
        .onReceive(NotificationCenter.default.publisher(for: .desktopOpenSettings)) { note in
            model.menu = nil
            // a section asked for (Capabilities > Providers' Connect: Models and voice)
            if let raw = note.object as? String, let section = DesktopSettingsSection(rawValue: raw) { model.settingsSection = section }
            model.modal = .settings
        }
        .onAppear {
            DesktopTermsDialog.shellPresents = true
            // What's new, once after an update (`ReleaseNotesPrompt`)
            if ReleaseNotesStore.whatsNewOnLaunch(), model.modal == nil { model.modal = .whatsNew }
        }
        .onDisappear { DesktopTermsDialog.shellPresents = false }
        // the welcome is due on a workspace that never finished it
        .task(id: session.connection?.id) {
            #if DEBUG
            if let screen = ParityLaunch.current?.iPadScreen {
                switch screen {
                case .onboardingWelcome:
                    // the desktop reference opens on step 1 with the terms over it
                    onboarding.firstRunStep = .engine
                    onboarding.firstRunOpen = true
                    onboarding.parityTerms = true
                case .onboardingTour:
                    onboarding.parityRecord(OnboardingStatus(completedAt: "2026-01-01T00:00:00.000Z", version: FirstRun.welcomeVersion, hintsSeen: []))
                    onboarding.tourOpen = true
                default: break
                }
                return
            }
            #endif
            await onboarding.load(session)
        }
        .onReceive(NotificationCenter.default.publisher(for: .desktopReplayFirstRun)) { _ in
            model.modal = nil
            onboarding.firstRunStep = nil
            onboarding.firstRunOpen = true
        }
        .onReceive(NotificationCenter.default.publisher(for: .desktopReplayTour)) { _ in
            model.modal = nil
            onboarding.replayTour(session)
        }
    }

    private func columns(width: CGFloat, theme: DesktopTheme) -> some View {
        let docked = DesktopShellRules.docksPanel(width: width)
        let botOpen = model.panelOpen && selectedBot != nil && model.page == nil
        let roomOpen = model.panelOpen && selectedPanelRoom != nil && model.page == nil
        return ZStack(alignment: .topLeading) {
            HStack(spacing: 0) {
                AnyView(DesktopSidebar())
                    .frame(width: model.sidebarWidth)
                    .clipped()
                    .overlay(alignment: .trailing) { DesktopSidebarEdgeHandle(model: model) }
                    .zIndex(1)
                AnyView(DesktopContent())
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    // the tour's Automations page step points at the page
                    .transformAnchorPreference(key: DesktopTourAnchorKey.self, value: .bounds) { if model.page == .automations { $0["automations-page"] = $1 } }
                if docked, botOpen, let bot = selectedBot {
                    AnyView(BotPanel(bot: bot, docked: true))
                        .frame(width: model.panelWidth)
                        .overlay(alignment: .leading) { DesktopPanelResizeHandle(model: model) }
                        .transition(.move(edge: .trailing))
                }
                // a group's panel docks in the same slot (GroupPanel.swift)
                if docked, roomOpen, let room = selectedPanelRoom {
                    AnyView(DesktopGroupPanel(room: room, docked: true))
                        .frame(width: model.panelWidth)
                        .overlay(alignment: .leading) { DesktopPanelResizeHandle(model: model) }
                        .transition(.move(edge: .trailing))
                }
            }
            // the computer window's veil blurs what it covers
            // (SandboxDesktopModal: `bg-black/60 backdrop-blur-[2px]`)
            .blur(radius: model.computerWindow != nil ? 2 : 0)
            // Settings open: the window stays drawn behind the centred
            // modal, as the desktop's (2026-11-03 references).
            if !docked, botOpen, let bot = selectedBot {
                // Below 1024 the panel covers the leading edge (measured at
                // 834: x 0, panel width), the chat still visible to its right.
                Color.black.opacity(0.001)
                    .onTapGesture { model.togglePanel() }
                AnyView(BotPanel(bot: bot, docked: false))
                    .frame(width: min(model.panelWidth, width))
                    .frame(maxHeight: .infinity)
                    .transition(.move(edge: .leading))
            }
            if !docked, roomOpen, let room = selectedPanelRoom {
                Color.black.opacity(0.001)
                    .onTapGesture { model.togglePanel() }
                AnyView(DesktopGroupPanel(room: room, docked: false))
                    .frame(width: min(model.panelWidth, width))
                    .frame(maxHeight: .infinity)
                    .transition(.move(edge: .leading))
            }
            // the desktop's model menu (ModelPicker windowOnly, "Lot 7: the
            // full window is gone"): a popover at the window's leading edge,
            // a tap outside closes it. The desktop pins the menu's bottom
            // at 96 pt from the top (#1979, its top falls off the screen):
            // here its top sits there instead.
            if model.modelPickerOpen, let bot = selectedBot {
                Color.black.opacity(0.001)
                    .ignoresSafeArea()
                    .onTapGesture { model.modelPickerOpen = false }
                AnyView(DesktopModelMenu(
                    bot: bot.projected(forThread: model.selected?.threadId ?? bot.threadId) ?? bot,
                    close: { model.modelPickerOpen = false },
                    openProviders: {
                        model.modelPickerOpen = false
                        model.settingsSection = .engines
                        model.modal = .settings
                    }
                ))
                .padding(.leading, 24)
                .padding(.top, 96)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .transition(.opacity)
            }
            // Edit bot / profile fills the main column (#2136), not a centred window.
            // lot 6: the bot's computer window where no second scene exists
            if let botId = model.computerWindow {
                AnyView(DesktopComputerWindowView(botId: botId, floating: true) { model.computerWindow = nil })
                    .transition(.opacity)
                    .zIndex(5)
            }
            // I5: Settings and Plugins are the desktop's modals, over everything
            if model.modal == .settings {
                AnyView(DesktopSettingsModal(close: { model.modal = nil }))
                    .transition(.identity)
            } else if model.modal == .plugins {
                // lot 3: Capabilities, the desktop's centred window
                AnyView(DesktopCapabilitiesModal(close: { model.modal = nil }))
                    .desktopTourAnchor("apps-panel")
                    .transition(.opacity)
            } else if model.modal == .search {
                // lot 3: the desktop's command palette (⌘K)
                AnyView(DesktopCommandPalette(close: { model.modal = nil }))
                    .transition(.opacity)
            } else if model.modal == .shortcuts {
                AnyView(DesktopShortcutsModal(close: { model.modal = nil }))
                    .transition(.opacity)
            } else if model.modal == .about {
                AnyView(DesktopAboutModal(close: { model.modal = nil }, openReleaseNotes: { model.modal = .releaseNotes }))
                    .transition(.opacity)
            } else if model.modal == .newBot {
                // the desktop's New bot: the wizard's first page (BotWizard.tsx)
                AnyView(DesktopNewBotModal(close: { model.modal = nil }) { bot in
                    model.modal = nil
                    model.open(.bot(bot))
                })
                .transition(.opacity)
            } else if model.modal == .releaseNotes || model.modal == .whatsNew {
                AnyView(DesktopReleaseNotesModal(mode: model.modal == .whatsNew ? .current : .browse, close: { model.modal = nil }))
                    .transition(.opacity)
            }
            // the guided first run (GuidedFirstRun, rendered by WelcomeGate at
            // the root); its More options opens New bot over the shell
            if onboarding.firstRunOpen, model.modal == nil {
                AnyView(DesktopGuidedFirstRun(onboarding: onboarding))
                    .transition(.opacity)
                    .zIndex(8)
            }
            // TermsGate: once per account, over everything
            if session.termsPending, parityAllowsTerms {
                AnyView(DesktopTermsDialog())
                    .transition(.opacity)
                    .zIndex(9)
            }
        }
        .background(theme.app)
        // GuidedTour's Spotlight over the live shell, following `data-tour` anchors
        .overlayPreferenceValue(DesktopTourAnchorKey.self) { anchors in
            AnyView(DesktopGuidedTour(onboarding: onboarding, anchors: anchors))
        }
    }

    /// The parity harness shows the terms only on the welcome reference.
    private var parityAllowsTerms: Bool {
        #if DEBUG
        if ParityLaunch.current != nil { return onboarding.parityTerms }
        #endif
        return true
    }

    private var selectedBot: Bot? {
        guard case let .bot(bot) = model.selected else { return nil }
        return session.state.bot(bot.id) ?? bot
    }

    /// The selected group, whose panel the header pill opens.
    private var selectedPanelRoom: Room? {
        guard let chat = model.selected, chat.opensGroupPanel, case let .room(room) = chat else { return nil }
        return session.state.rooms.first { $0.id == room.id } ?? room
    }
}

// MARK: - Content column

/// The selected conversation, or a quiet empty state.
struct DesktopContent: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var model: DesktopShellModel
    @EnvironmentObject private var session: Session

    private var selectedBot: Bot? {
        guard case let .bot(bot) = model.selected else { return nil }
        return session.state.bot(bot.id) ?? bot
    }

    var body: some View {
        if model.modal == .plugins {
            // App.tsx `mainIsApps`: Capabilities takes the main column's
            // place, the chat is not drawn behind its window
            theme.app
        } else if model.personaOpen, let bot = selectedBot {
            // The bot's profile page fills the main panel in place of the chat
            // (#2136); X or Escape goes back to the bot's chat.
            AnyView(DesktopBotProfileHost(bot: bot))
                .id("profile-\(bot.id)")
        } else if let page = model.page {
            switch page {
            case .teamMap: AnyView(DesktopTeamMapPage())
            case .automations: AnyView(DesktopAutomationsPage())
            case .memory: AnyView(DesktopMemoryPage())
            }
        } else if let chat = model.selected {
            // the notice is in the chat's own banner stack (DesktopChatChrome.notice)
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
            if glow.0 > 0 || glow.1 > 0 {
                Canvas { context, size in
                    // radial-gradient(ellipse 110% 62% at 50% 0%, accent a, transparent 70%)
                    Self.ellipse(&context, centre: CGPoint(x: size.width * 0.5, y: 0),
                                 radii: CGSize(width: size.width * 1.10, height: size.height * 0.62),
                                 color: theme.glowColors?.0 ?? accent, alpha: glow.0, end: 0.70)
                    // radial-gradient(ellipse 72% 44% at 80% 0%, accent b, transparent 68%)
                    Self.ellipse(&context, centre: CGPoint(x: size.width * 0.8, y: 0),
                                 radii: CGSize(width: size.width * 0.72, height: size.height * 0.44),
                                 color: theme.glowColors?.1 ?? accent, alpha: glow.1, end: 0.68)
                }
            }
            // the skin's texture over the chat's ground, above the glow (skin-texture.css)
            if theme.texture != .none { SkinTextureView(texture: theme.texture, ink: UIColor(theme.ink)) }
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
    @State private var openedWidgetRoutine: Routine?

    func body(content: Content) -> some View {
        content
            .onValueChange(of: session.notificationChat) { chat in
                guard let chat else { return }
                // a run opened from Automations or a routine's page lands in
                // the chat (#2098): those close
                if model.modal == .automations { model.modal = nil }
                openedWidgetRoutine = nil
                model.open(chat)
                session.consumeNotificationChat()
            }
            .onValueChange(of: session.pendingChat) { chat in
                guard let chat else { return }
                model.open(chat)
                session.consumePendingChat()
            }
            .onValueChange(of: session.pendingWidgetDestination) { destination in
                guard let destination else { return }
                session.consumePendingWidgetDestination()
                Task { await openWidgetDestination(destination) }
            }
            .sheet(item: $openedWidgetRoutine) { routine in
                NavigationStack {
                    RoutineDetailView(routine: routine)
                        .environmentObject(session)
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) {
                                Button(String(localized: "Done")) { openedWidgetRoutine = nil }
                            }
                        }
                }
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
                await ToolCallsSetting.shared.load(session)
            }
            // a new message brings a hidden entry back (Settings > "Show
            // people again" and "Show bots again"), as on the iPhone's home
            .onValueChange(of: session.rosterSignature) { _ in
                sidebarPrefs.unhideNewMessages(session)
            }
    }

    /// A widget button that named a place: open the closest iPad surface.
    private func openWidgetDestination(_ destination: ChatWidgetDestination) async {
        switch destination {
        case .automations, .updates:
            // Approvals has no iPad twin; Automations is the closest place
            // that lists work waiting on the person.
            model.modal = .automations
        case .teamMap:
            model.modal = .teamMap
        case .achievements:
            model.modal = .achievements
        case let .botComputer(botId):
            if let bot = session.state.bot(botId) {
                model.open(session.returning(to: .bot(bot)))
                model.panelTab = BotPanelDoor.computerButton.tab
                model.panelOpen = true
            }
        case let .routine(routineId, _):
            let listing = await session.loadRoutines()
            if let routine = listing.routines.first(where: { $0.id == routineId }) {
                openedWidgetRoutine = routine
            } else {
                model.modal = .automations
            }
        case let .run(runId, _):
            // #2098: the run's message in the bot's chat
            let listing = await session.loadRoutines()
            if let run = listing.runs.first(where: { $0.id == runId }) {
                await session.openRoutineRunInChat(run)
            } else {
                model.modal = .automations
            }
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
            if screen == .groupChat || screen == .groupPanel {
                // the room chat (Peer Managers), as the reference selects it;
                // group-panel: its header pill opened the panel
                if let room = session.state.rooms.first(where: { $0.name == "Peer Managers" }) {
                    model.open(.room(room))
                    if screen == .groupPanel { model.panelOpen = true }
                    return
                }
            } else if let ara = session.state.bots.first(where: { $0.name == "Ara" }) {
                model.open(.bot(ara))
                model.panelOpen = screen.opensBotPanel
                if let tab = screen.panelTab { model.panelTab = tab }
                if screen == .panelAvatarEditor { model.showAppearance() }
                else if screen.opensPersonaEditor { model.showPersona(screen.panelSection) }
                model.applyParityModals(screen)
                model.page = screen.parityPage
                if screen == .keyboardShortcuts { model.modal = .shortcuts }
                if screen == .aboutDialog { model.modal = .about }
                if screen == .releaseNotesDialog { model.modal = .releaseNotes }
                if screen == .newBot { model.modal = .newBot }
                if screen == .noticeThreadGone {
                    model.show(notice: DesktopNotice(kind: .threadGone, botName: "Helix"), clearsAfter: 600)
                }
                await applyParitySidebar(screen)
                return
            }
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
    }

    /// The sidebar surfaces' pointer and menus, at the references' points
    /// (desktop-*-08 to -12 DOM dumps; re-measured on the 1376x1032
    /// references of 2026-11-03: the "⋯" button's bottom, the right click). On the iPad a right click or a long
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
            model.menu = DesktopMenuRequest(kind: .bot(aurora.id), anchor: CGPoint(x: 235, y: 385))
        case .sidebarBotContextMenu:
            guard let helix = bot("Helix") else { return }
            model.menu = DesktopMenuRequest(kind: .bot(helix.id), anchor: CGPoint(x: 76, y: 418))
        case .sidebarSectionMenu:
            guard let aurora = bot("Aurora"), let team = aurora.section, !team.isEmpty else { return }
            model.menu = DesktopMenuRequest(kind: .section(SidebarSectionID.user(team)), anchor: CGPoint(x: 68, y: 322))
        case .sidebarProfileMenu:
            // 4 pt over the 48 pt account row (12 pt from the bottom)
            model.menu = DesktopMenuRequest(kind: .profile, anchor: CGPoint(x: 8, y: height - 64), opensUp: true)
        case .sidebarNewMenu:
            model.menu = DesktopMenuRequest(kind: .new, anchor: .zero)
        case .sidebarSelect:
            // the reference chooses Aurora from its menu, then clicks Helix
            guard let aurora = bot("Aurora"), let helix = bot("Helix") else { return }
            model.selection.start(with: aurora.id)
            model.selection.toggle(helix.id)
        case .computerWindow:
            model.computerWindow = model.selected?.id
        case .newGroup:
            // the reference's pointer rests on Liora's row once the list
            // redraws in group mode: its "Add" hint, ⌘2 on Orion
            model.parityComposePreset = (group: true, cursor: 2)
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
            EmptyView()
        case .newBot:
            EmptyView()
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
        case .memory:
            MemoryManagerSheet()
        case .plugins:
            EmptyView()
        case .templates:
            DesktopTemplatesSheet { model.modal = nil }
        case .about, .shortcuts, .releaseNotes, .whatsNew:
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
    @Environment(\.desktopTheme) private var theme
    @ObservedObject var model: DesktopShellModel
    @State private var start: CGFloat?
    @State private var hovering = false

    /// `.app-resize-handle::after`: a 2 pt accent line (55 %) while the
    /// handle is hovered, dragged or focused. The desktop's Details and
    /// Computer references are taken with the handle focused (the panel
    /// hands it the focus as it opens), so their parity screens draw it lit.
    private var lit: Bool {
        if hovering || start != nil { return true }
        #if DEBUG
        if let screen = ParityLaunch.current?.iPadScreen, screen == .panelDetails || screen == .panelComputer { return true }
        #endif
        return false
    }

    var body: some View {
        Color.clear
            .frame(width: 12)
            .contentShape(Rectangle())
            .overlay {
                RoundedRectangle(cornerRadius: 1)
                    .fill(lit ? theme.accent.opacity(0.55) : .clear)
                    .frame(width: 2)
                    .offset(x: -3)
                    .animation(.easeOut(duration: 0.12), value: lit)
                    .allowsHitTesting(false)
            }
            .offset(x: -6)
            .onHover { hovering = $0 }
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


// MARK: - Notice

/// `state.notice`: what the chat column says about a link that led nowhere.
struct DesktopNotice: Equatable {
    enum Kind: Equatable { case threadGone, botGone }
    var kind: Kind
    /// The bot shown instead (`thread.goneShowing`); nil: `thread.gone`.
    var botName: String?
    let id = UUID()
}

/// `ChatNotice` (ChatErrorBanner.tsx): px-5, a rounded-lg panel line with a
/// 40 % hairline, 13 pt secondary text.
struct DesktopChatNotice: View {
    @Environment(\.desktopTheme) private var theme
    let notice: DesktopNotice

    var body: some View {
        Group {
            switch notice.kind {
            case .botGone: Text("That bot is no longer here.")
            case .threadGone:
                if let name = notice.botName {
                    Text("That thread is no longer here. Showing \(name) instead.")
                } else {
                    Text("That thread is no longer here.")
                }
            }
        }
        .font(theme.font(13))
        // CSS's 1.5 line box (19.5 pt), not the face's own line
        .frame(minHeight: 19.5)
        .foregroundStyle(theme.inkSecondary)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.4), lineWidth: 1))
        .padding(.horizontal, 20)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.updatesFrequently)
        .accessibilityIdentifier("desktop-chat-notice")
    }
}
