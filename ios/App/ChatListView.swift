// The roster.
//
// Messages-shaped: a glass header, built-in and user-named sidebar sections,
// and a floating bar that keeps Updates, search, organization and new-bot
// actions within one thumb's reach while everything scrolls beneath the
// glass. Two densities, chosen in Settings: compact (the default) puts each
// bot and group on one line; comfortable keeps channels as tiles and bots as
// two-line rows with a "Threads" disclosure beneath each.
import SwiftUI
import CompanionCore

struct ChatListView: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @State private var query = ""
    /// Settings > Appearance > Tool calls, the desktop's switch.
    @ObservedObject private var toolCalls = ToolCallsSetting.shared
    @AppStorage(PrefKey.rosterDensity) private var rosterDensity = RosterDensity.default.rawValue
    @AppStorage(PrefKey.updatesButton) var showUpdatesButton = false
    @AppStorage(PrefKey.rosterChromeAtTop) private var storedChromeAtTop = false
    /// Search and + at the top (the Personalization switch "Search and + at
    /// top"). Never on an iPad: the avatar owns the top trailing corner
    /// there, so the chrome stays at the bottom as on the iPhone's default
    /// (owner, 2026-10-15). The Updates pill never follows it: when the
    /// "Updates button" switch is on, the pill is anchored to the bottom
    /// safe area in every state (owner, 2026-10-16).
    private var rosterChromeAtTop: Bool {
        storedChromeAtTop && UIDevice.current.userInterfaceIdiom != .pad
    }
    /// The avatar sits in the top trailing corner on an iPad (the phone UI
    /// in Slide Over, Split View or a narrow window): the window controls
    /// (close, minimize, tile) live in the top leading corner, and an avatar
    /// pushed after them read as part of them (owner, 2026-10-15). The iPhone
    /// keeps it leading, under the status bar.
    private var avatarAtTrailingCorner: Bool {
        UIDevice.current.userInterfaceIdiom == .pad
    }
    /// Driven so that making a bot can open it. Value-based navigation alone
    /// cannot push without a tap, and a new bot appearing silently at the
    /// bottom of the roster is a poor answer to pressing +.
    @State private var path = NavigationPath()
    @State private var searchHits: [SearchHit] = []
    @State private var searching = false
    @State private var searchOpen = false
    @State private var showingUpdates = false
    @State private var showingNewGroup = false
    @State private var showingNewSection = false
    /// WP10: the Automations page (AU1), from a long press on "+".
    @State private var showingAutomations = false
    /// A routine-run push: the run's detail over the roster (#1700).
    @State private var openedNotificationRun: OpenedRoutineRun?
    /// WP15: the Team map (TM1), from a long press on "+".
    @State private var showingTeamMap = false
    /// Connect apps and Templates as sheets (the iPhone list shows no places: they live in the avatar menu).
    @State private var showingConnectedApps = false
    /// The tab Connect apps opens on (Bots from the old Browse Bots link).
    @State private var connectAppsTab: ConnectAppsTab?
    @State private var showingTemplates = false
    /// What the account menu opens besides Settings.
    @State private var accountSheet: HomeAccountSheet?
    /// Settings > Experimental's switches, for the places (same object as iPad).
    @ObservedObject private var flags = DesktopSidebarFlags.shared
    /// The bot row menu's prompts (rename, archive, delete, Primary Bot).
    @StateObject private var botActions = BotRowActions()
    @ObservedObject private var people = PeopleDirectory.shared
    @State private var showingPlusMenu = false
    @State private var showingSearch = false
    /// The "+": the search sheet as New chat (bots and members).
    @State private var showingNewChat = false
    @AccessibilityFocusState private var chromeFocus: HomeChromeFocus?
    @State private var showingCreateBot = false
    /// The team a "New bot here" chose (NB3); nil from the + menu.
    @State private var createBotSection: String?
    @State private var showingSettings = false
    @AppStorage(CollapsedSections.key) private var collapsedRaw = "[]"
    @State private var expandedBots = Set<String>()
    @State private var collapsedFolders = Set<String>()
    @State private var creatingThreads = Set<String>()
    @State private var managingThreads: Chat?
    /// The shared thread and folder menus (Features/Threads) for every row.
    @StateObject private var threadActions = ThreadActions()
    /// The sidebar preferences that follow the person (Features/Sidebar):
    /// their sections, folds, order, hidden entries and the thread switch.
    @ObservedObject private var sidebarPrefs = SidebarPrefsModel.shared
    /// The section header menu's prompts.
    @StateObject private var sectionActions = SidebarSectionActions()
    /// WP11: the room row menu's prompts (rename, move, delete, copy).
    @StateObject private var roomActions = RoomActions()
    /// Bulk selection of bot rows and the "more unread" pills (Features/Sidebar).
    @StateObject private var selection = HomeSelectionModel()
    @State private var offscreenUnread = OffscreenUnread(above: 0, below: 0, nearestAbove: nil, nearestBelow: nil)
    @State private var rowFrames: [String: CGRect] = [:]
    @State private var rosterViewport: (top: CGFloat, bottom: CGFloat) = (0, 0)
    @FocusState private var searchFocused: Bool

    /// Space between the header's glass buttons and whatever the list
    /// starts with, so a first section title is never tucked under them.
    private static let listTopInset: CGFloat = 12
    /// Clear space above the floating bar once the list is scrolled to its
    /// end. The bar's own height is inset by `safeAreaInset`, so the last
    /// row stays fully visible and tappable whatever the bar measures.
    private static let listBottomMargin: CGFloat = 16

    var body: some View {
        NavigationStack(path: $path) {
            AnyView(homeContent)
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Chat.self) { ChatView(chat: $0) }
            // Show threads off on any device: the thread list sheet goes
            .onValueChange(of: sidebarPrefs.threads.allows(.threadList)) { allowed in
                if !allowed { managingThreads = nil }
            }
            .onValueChange(of: session.notificationChat) { chat in
                guard let chat else { return }
                showingAutomations = false
                path.append(chat)
                session.consumeNotificationChat()
            }
            .onValueChange(of: session.notificationRoutineRun) { opened in
                guard let opened else { return }
                showingAutomations = false
                openedNotificationRun = opened
                session.consumeNotificationRoutineRun()
            }
            .onValueChange(of: session.pendingChat) { chat in
                guard let chat else { return }
                path.append(chat)
                session.consumePendingChat()
            }
            .onValueChange(of: session.pendingInbox) { open in
                guard open else { return }
                showingUpdates = true
                session.consumePendingInbox()
            }
            .routineRunDetail(item: $openedNotificationRun) { opened in
                RoutineRunDetailView(run: opened.run, routine: opened.routine)
                    .environmentObject(session)
            }
            .task {
                if let chat = session.notificationChat {
                    path.append(chat)
                    session.consumeNotificationChat()
                }
                if let opened = session.notificationRoutineRun {
                    openedNotificationRun = opened
                    session.consumeNotificationRoutineRun()
                }
                if let chat = session.pendingChat {
                    path.append(chat)
                    session.consumePendingChat()
                }
            }
#if DEBUG
            // Preview-only routes let the screenshot harness reach screens
            // that normally require a paired computer and a tap.
            .task {
                if ProcessInfo.processInfo.arguments.contains("-open-new-section") {
                    showingNewSection = true
                }
                if ProcessInfo.processInfo.arguments.contains("-open-first"),
                   path.isEmpty, let first = chats.first {
                    path.append(first.chat)
                }
            }
#endif
            .sheet(isPresented: $showingUpdates) {
                UpdatesSheet { chat in
                    showingUpdates = false
                    path.append(chat)
                }
            }
            .sheet(isPresented: $showingNewSection) {
                NewSectionSheet()
            }
            .sheet(isPresented: $showingAutomations) {
                AutomationsSheet()
            }
            .sheet(isPresented: $showingTeamMap) {
                TeamMapSheet { chat in
                    showingTeamMap = false
                    path.append(chat)
                }
            }
            .sheet(isPresented: $showingConnectedApps) {
                // the desktop's Connect apps panel (#203, #218)
                ConnectAppsPage(initialTab: connectAppsTab)
                    .environmentObject(session)
            }
            .sheet(isPresented: $showingTemplates) {
                DesktopTemplatesSheet { showingTemplates = false }
                    .environmentObject(session)
            }
            // the old link to Browse Bots' home: Settings closes, Connect
            // apps opens on its Bots tab (the catalogue lives there now)
            .onReceive(NotificationCenter.default.publisher(for: .sagaxOpenBotTemplates)) { _ in
                showingConnectedApps = false
                showingSettings = false
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) {
                    connectAppsTab = .bots
                    showingConnectedApps = true
                }
            }
            .sheet(item: $accountSheet) { sheet in
                HomeAccountSheetView(sheet: sheet)
                    .environmentObject(session)
            }
            .sheet(isPresented: $botActions.newServerSection) {
                NewSectionSheet()
            }
            // the person sheet (RM21), from a room line, a row or a header
            .personSheetPresenter { chat in path.append(chat) }
            .sheet(item: $managingThreads) { chat in
                if sidebarPrefs.threads.allows(.threadList) {
                    TaskManagerView(chat: chat) { threadId in
                        guard let bot = session.state.bot(forThread: threadId) else { return }
                        managingThreads = nil
                        path.append(Chat.bot(bot))
                    }
                }
            }
            .environmentObject(threadActions)
            .threadActionsPresenter(threadActions)
            .environmentObject(sectionActions)
            .environmentObject(botActions)
            .environmentObject(selection)
            .botRowActionsPresenter(botActions)
            // its own host: alerts chained on one view after the thread
            // presenter's would never show
            .background { Color.clear.sidebarSectionActionsPresenter(sectionActions) }
            .environment(\.sidebarShowsThreads, sidebarPrefs.threads.allows(.sidebarTree))
            // a new message brings a hidden entry back; a first roster seeds
            // the person's own sections (organization server)
            .onValueChange(of: rosterSignature) { _ in
                sidebarPrefs.unhideNewMessages(session)
                sidebarPrefs.seedIfNeeded(session)
            }
            .roomActionsPresenter(roomActions)
            // a finished bot creation wizard opens the bot it made
            .onReceive(BotWizardPresenter.shared.$finishedBotId) { id in
                guard let id, let bot = session.state.bot(id) else { return }
                BotWizardPresenter.shared.finishedBotId = nil
                path.append(Chat.bot(bot))
            }
            .onValueChange(of: threadActions.created?.threadId) { threadId in
                guard let created = threadActions.created, threadId != nil else { return }
                threadActions.created = nil
                path.append(Chat.bot(created))
            }
            .task(id: query) {
                let expected = query
                guard expected.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2 else {
                    searchHits = []
                    searching = false
                    return
                }
                searching = true
                defer {
                    if query == expected { searching = false }
                }
                try? await Task.sleep(for: .milliseconds(250))
                guard !Task.isCancelled, query == expected else { return }
                let hits = await session.search(expected)
                guard !Task.isCancelled, query == expected else { return }
                searchHits = hits
            }
        }
    }

    private var legacyHome: some View {
            GeometryReader { _ in
            VStack(spacing: 0) {
                header
                if rosterChromeAtTop { bottomBar(includesUpdates: false) }
                StatusBanner()

                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        if query.isEmpty {
                            rosterSections
                        } else {
                            if !searchHits.isEmpty {
                                HStack {
                                    sectionLabel(Text("Messages"))
                                    Spacer()
                                    if searching { ProgressView().controlSize(.small) }
                                }
                                .padding(.top, 10)
                                .padding(.bottom, 4)

                                ForEach(searchHits) { hit in
                                    Button {
                                        Task {
                                            if let chat = await session.open(hit) {
                                                Haptics.selection()
                                                path.append(chat)
                                            }
                                        }
                                    } label: {
                                        SearchHitRow(hit: hit)
                                    }
                                    .buttonStyle(.plain)
                                    .padding(.horizontal, 16)
                                }
                                sectionLabel(Text(sidebarPrefs.threads.shown ? LocalizedStringKey("Threads") : LocalizedStringKey("Chats")))
                                    .padding(.top, 14)
                                    .padding(.bottom, 4)
                            } else if searching {
                                ProgressView()
                                    .controlSize(.small)
                                    .frame(maxWidth: .infinity)
                                    .padding(.top, 24)
                            }

                            botRows(chats)
                        }
                    }
                    .padding(.top, Self.listTopInset)
                    .padding(.bottom, Self.listBottomMargin)
                }
                .refreshable {
                    await session.refresh()
                    await sidebarPrefs.load(session)
                }
                .accessibilityIdentifier("roster-list")
                .overlay {
                    if rosterIsEmpty {
                        EmptyStateView(
                            query.isEmpty ? "No bots yet" : "Nothing matches",
                            systemImage: query.isEmpty ? "bubble.left.and.bubble.right" : "magnifyingglass",
                            description: Text(
                                query.isEmpty
                                    ? "Bots you create on your computer show up here."
                                    : "No thread matches \u{201C}\(query)\u{201D}."
                            )
                        )
                    }
                }
                // The list scrolls beneath the floating bar, and its end is
                // inset by the bar's measured height rather than a guess.
                // The Updates pill stays here even when search and + go to
                // the top (owner, 2026-10-16).
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    if rosterChromeAtTop {
                        updatesButton
                            .padding(.horizontal, 16)
                            .padding(.bottom, 8)
                            .bottomBarScrim()
                    } else {
                        bottomBar(includesUpdates: true)
                            .bottomBarScrim()
                    }
                }
            }
            // top-aligned: the roster fills downward from the header
            .frame(maxWidth: CompanionLayout.rosterWidth, maxHeight: .infinity, alignment: .top)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            // With search at the top, the keyboard it raises must not lift
            // the pill left alone at the bottom; with search in the bottom
            // bar, the bar still rides the keyboard so its field shows.
            .ignoresSafeArea(.keyboard, edges: rosterChromeAtTop ? .bottom : [])
            // a bot that stopped for you grows out of the island
            .overlay(alignment: .top) {
                if CompanionLayout.supportsIslandPresentation {
                    NeedsYouIsland(
                        update: session.state.updates.first { $0.kind == .needsYou }
                    ) { chat in path.append(chat) }
                }
            }
            }
    }

    // MARK: - Header

    /// The paired computer's profile on the left, one settings action on the
    /// right, and where you are in between. The avatar is identity, not a
    /// second hidden route to the same screen.
    private var header: some View {
        HStack(alignment: .center) {
            if avatarAtTrailingCorner {
                // balances the account button so the title stays centred
                Color.clear.frame(width: 44, height: 44)
            } else {
                legacyAccountButton
            }

            Spacer(minLength: 8)

            VStack(spacing: 2) {
                // the conversations, not threads, while Show threads is off
                Text(sidebarPrefs.threads.shown ? LocalizedStringKey("Threads") : LocalizedStringKey("Chats"))
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary)
                Text(headerSubtitle)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            if avatarAtTrailingCorner {
                legacyAccountButton
            } else {
                // balances the account button so the title stays centred
                Color.clear.frame(width: 44, height: 44)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 4)
        .padding(.bottom, 12)
    }

    /// The account menu, as on the standard home.
    private var legacyAccountButton: some View {
        Menu {
            HomeAccountMenuItems(select: selectAccount)
        } label: {
            ProfileAvatar(name: session.connection?.name ?? "You", size: 30)
                .frame(width: 44, height: 44)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .glassCapsule()
        .accessibilityLabel(Text("Account"))
        .accessibilityIdentifier("home-account")
    }

    private var headerSubtitle: String {
        let name = session.connection?.name ?? "Not paired"
        switch session.status {
        case .live: return "\(name) · connected"
        case .connecting: return "\(name) · connecting…"
        case .offline: return "\(name) · offline"
        case .unauthorized: return "\(name) · unpaired"
        case .unpaired: return "Not paired"
        }
    }

    // MARK: - Sidebar sections

    /// Every thread across every bot that needs the person right now — the
    /// same rule and order as the thread tree, so the inbox can never
    /// disagree with it.
    private var attention: [AttentionThread] {
        rosterAttentionThreads(session.state.bots, showThreads: sidebarPrefs.showThreads)
    }

    @ViewBuilder
    private var rosterSections: some View {
        let layout = self.layout
        if !attention.isEmpty {
            sectionLabel(Text("Inbox"))
                .padding(.top, 2)
                .padding(.bottom, 4)
            ForEach(attention) { entry in
                Button {
                    Haptics.selection()
                    openAttention(entry)
                } label: {
                    AttentionRow(entry: entry, followsDynamicType: density == .compact)
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 16)
            }
        }

        if let chief = layout.unsectionedChief {
            VStack(alignment: .leading, spacing: 0) {
                botRows(summaries(for: [chief]))
            }
            // In compact, a one-line row right under the attention rows
            // would read as one more of them: set it apart like a section.
            .padding(.top, density == .compact && !attention.isEmpty ? sectionSpacing : 0)
        }

        let pinned = summaries(for: layout.pinnedBots)
        if !pinned.isEmpty {
            sectionLabel(Text("Pinned"))
                // a compact row above it leaves little air of its own
                .padding(.top, density == .compact ? sectionSpacing : 2)
                .padding(.bottom, 4)
            botRows(pinned)
        }

        switch density {
        case .comfortable:
            channelsStrip(
                title: "Groups",
                rooms: layout.unsectionedChannels,
                showsCreate: true
            )

            if !layout.botChats.isEmpty {
                channelsStrip(title: "Bot threads", rooms: layout.botChats, showsCreate: false)
            }
        case .compact, .standard:
            compactRoomsSection(
                title: "Groups",
                rooms: layout.unsectionedChannels,
                showsCreate: true
            )

            if !layout.botChats.isEmpty {
                compactRoomsSection(title: "Bot threads", rooms: layout.botChats, showsCreate: false)
            }
        }

        let unsectioned = summaries(for: layout.unsectionedBots)
        if !unsectioned.isEmpty {
            sectionLabel(Text("Bots"))
                .padding(.top, sectionSpacing)
                .padding(.bottom, 4)
            botRows(unsectioned)
        }

        ForEach(layout.sections) { section in
            VStack(alignment: .leading, spacing: 0) {
                switch density {
                case .comfortable:
                    sectionLabel(Text(verbatim: HomeSectionTitle.display(section.name)))
                        .padding(.top, 18)
                        .padding(.bottom, section.chiefs.isEmpty && !section.channels.isEmpty ? 10 : 4)
                    if !section.chiefs.isEmpty {
                        botRows(summaries(for: section.chiefs))
                    }
                    if !section.channels.isEmpty {
                        channelTiles(section.channels, showsCreate: false)
                            .padding(.top, section.chiefs.isEmpty ? 0 : 8)
                            .padding(.bottom, section.bots.isEmpty ? 4 : 8)
                    }
                case .compact, .standard:
                    sectionLabel(Text(verbatim: HomeSectionTitle.display(section.name)))
                        .padding(.top, sectionSpacing)
                        .padding(.bottom, 4)
                    if !section.chiefs.isEmpty {
                        botRows(summaries(for: section.chiefs))
                    }
                    compactRoomRows(section.channels)
                }
                botRows(summaries(for: section.bots))
            }
        }
    }

    /// Between one section and the next title.
    private var sectionSpacing: CGFloat { density == .compact ? 14 : 18 }

    /// Groups as one-line rows under a title that carries the "+" the
    /// comfortable strip shows as a tile.
    @ViewBuilder
    private func compactRoomsSection(title: LocalizedStringKey, rooms: [Room], showsCreate: Bool) -> some View {
        HStack(spacing: 0) {
            sectionLabel(Text(title))
            Spacer(minLength: 0)
            if showsCreate {
                Button {
                    Haptics.selection()
                    showingNewGroup = true
                } label: {
                    Image(systemName: "plus")
                        .font(.body.weight(.medium))
                        .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.trailing, 6)
                .accessibilityLabel("New group")
                .accessibilityIdentifier("new-group")
            }
        }
        // the "+" grows with its title, and stops where the title does
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        // the "+" is a 44pt target; the title keeps the other titles' rhythm
        .frame(minHeight: showsCreate ? 44 : nil)
        .padding(.top, showsCreate ? 0 : sectionSpacing)
        .padding(.bottom, showsCreate ? 0 : 4)
        compactRoomRows(rooms)
    }

    /// In the order the tiles showed them, each stamped with its thread's
    /// last message the way `chatSummaries` stamps a row.
    private func compactRoomRows(_ rooms: [Room]) -> some View {
        let waiting = waitingChats
        return ForEach(rooms) { room in
            NavigationLink(value: Chat.room(room)) {
                CompactRoomRow(
                    room: room,
                    lastActivity: session.state.visibleTranscript(forThread: room.threadId).last?.at ?? 0,
                    waiting: waiting.contains(room.id)
                )
            }
            .buttonStyle(.plain)
            .contextMenu { chatMenu(.room(room)) }
            .accessibilityIdentifier("chat-row.\(room.id)")
        }
    }

    private func channelsStrip(title: LocalizedStringKey, rooms: [Room], showsCreate: Bool) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionLabel(Text(title))
            channelTiles(rooms, showsCreate: showsCreate)
        }
        .padding(.top, 2)
    }

    private func channelTiles(_ rooms: [Room], showsCreate: Bool) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(rooms) { room in
                    NavigationLink(value: Chat.room(room)) {
                        GroupTile(room: room)
                    }
                    .buttonStyle(.plain)
                }
                if showsCreate {
                    Button {
                        Haptics.selection()
                        showingNewGroup = true
                    } label: {
                        GroupTile(room: nil)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("New group")
                }
            }
            .padding(.horizontal, 16)
        }
    }

    @ViewBuilder
    private func botRows(_ rows: [ChatSummary]) -> some View {
        switch density {
        case .comfortable: comfortableRows(rows)
        case .compact, .standard: compactRows(rows)
        }
    }

    /// One line per bot, its threads beneath it once opened. Search results
    /// can include groups, which get their own one-line row.
    private func compactRows(_ rows: [ChatSummary]) -> some View {
        let waiting = waitingChats
        return ForEach(rows) { summary in
            switch summary.chat {
            case let .bot(bot):
                CompactBotEntry(
                    bot: bot,
                    lastActivity: summary.lastActivity,
                    hasPendingCard: waiting.contains(bot.id),
                    query: $query,
                    expanded: expandedBinding(bot.id),
                    collapsedFolders: $collapsedFolders,
                    creating: creatingBinding(bot.id),
                    openRow: {
                        path.append(session.returning(to: summary.chat))
                    },
                    open: { chat in path.append(chat) },
                    manage: { chat in managingThreads = chat }
                )
            case let .room(room):
                Button {
                    path.append(summary.chat)
                } label: {
                    CompactRoomRow(room: room, lastActivity: summary.lastActivity, waiting: waiting.contains(room.id))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("chat-row.\(room.id)")
            }
        }
    }

    private func expandedBinding(_ botID: String) -> Binding<Bool> {
        Binding(
            get: { expandedBots.contains(botID) },
            set: { value in
                if value { expandedBots.insert(botID) } else { expandedBots.remove(botID) }
            }
        )
    }

    private func creatingBinding(_ botID: String) -> Binding<Bool> {
        Binding(
            get: { creatingThreads.contains(botID) },
            set: { value in
                if value { creatingThreads.insert(botID) } else { creatingThreads.remove(botID) }
            }
        )
    }

    @ViewBuilder
    private func comfortableRows(_ rows: [ChatSummary]) -> some View {
        ForEach(Array(rows.enumerated()), id: \.element.id) { index, summary in
            VStack(spacing: 0) {
                Button {
                    path.append(session.returning(to: summary.chat))
                } label: {
                    ChatRow(
                        chat: summary.chat,
                        preview: summary.preview,
                        at: summary.lastActivity,
                        state: MausState.forChat(summary.chat, in: session.state),
                        waiting: waitingChats.contains(summary.chat.id),
                        last: index == rows.count - 1
                    )
                }
                .buttonStyle(.plain)
                .contextMenu { chatMenu(summary.chat) }
                .sidebarBotPinSwipe(summary.chat, session: session)
                .accessibilityIdentifier("chat-row.\(summary.chat.id)")
                if case let .bot(bot) = summary.chat, sidebarPrefs.threads.allows(.sidebarTree) {
                    BotThreadTree(
                        botID: bot.id, query: $query,
                        expanded: expandedBinding(bot.id),
                        collapsedFolders: $collapsedFolders,
                        creating: creatingBinding(bot.id)
                    ) { chat in
                        path.append(chat)
                    } manage: { chat in
                        managingThreads = chat
                    }
                }
            }
        }
    }

    // MARK: - Bottom bar

    private func bottomBar(includesUpdates: Bool) -> some View {
        GlassGroup(spacing: 8) {
            HStack(spacing: 8) {
                if searchOpen {
                    HStack(spacing: 8) {
                        Image(systemName: "magnifyingglass")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
                        TextField("Search threads", text: $query)
                            .font(.system(size: 17))
                            .submitLabel(.search)
                            .autocorrectionDisabled()
                            .focused($searchFocused)
                        if !query.isEmpty {
                            Button {
                                query = ""
                            } label: {
                                Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 16)
                    .frame(height: 52)
                    .glassCapsule()

                    Button("Cancel") {
                        query = ""
                        searchOpen = false
                        searchFocused = false
                    }
                    .font(.system(size: 17))
                    .foregroundStyle(Theme.textPrimary)
                    .padding(.horizontal, 16)
                    .frame(height: 52)
                    .glassCapsule()
                } else {
                    if includesUpdates {
                        ViewThatFits(in: .horizontal) {
                            expandedBottomActions
                            compactBottomActions
                        }
                    } else {
                        Spacer(minLength: 0)
                        searchButton
                        newMenuButton
                    }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
        .animation(.snappy(duration: 0.25), value: searchOpen)
    }

    private var expandedBottomActions: some View {
        HStack(spacing: 8) {
            updatesButton
                .frame(width: 180)
            searchButton
            newMenuButton
        }
    }

    private var compactBottomActions: some View {
        HStack(spacing: 8) {
            updatesButton
                .frame(minWidth: 148)
            searchButton
            newMenuButton
        }
    }

    /// New (the desktop's compose-to picker): the search sheet as New
    /// chat, with Create new Bot, Create group chat, the bots and, on an
    /// organization server, the members (owner, 2026-10-18).
    private var newMenuButton: some View {
        GlassCircleButton(systemImage: "plus", accessibilityLabel: "Create") {
            showingNewChat = true
        }
        .accessibilityFocused($chromeFocus, equals: .plus)
        .accessibilityIdentifier("home-plus")
    }

    private var updatesButton: some View {
        UpdatesPill(updates: session.state.updates) {
            Haptics.selection()
            showingUpdates = true
        }
        .frame(height: 52)
    }

    private var searchButton: some View {
        GlassCircleButton(systemImage: "magnifyingglass", accessibilityLabel: "Search") {
            searchOpen = true
            searchFocused = true
        }
    }

    /// The roster as the sidebar lays it out: the person's sections,
    /// hidden entries and order applied (CompanionCore `SidebarLayout`).
    private var layout: SidebarLayout { sidebarPrefs.layout(session) }

    /// Changes when a message or an unread mark arrives, or the roster's
    /// membership changes.
    private var rosterSignature: [String] { session.rosterSignature }

    /// The account menu's entries.
    private func selectAccount(_ item: AccountMenuItem) {
        Haptics.selection()
        switch item {
        case .settings: showingSettings = true
        case .teamMap: showingTeamMap = true
        case .automations: showingAutomations = true
        case .archivedBots: accountSheet = .archivedBots
        case .achievements: accountSheet = .achievements
        case .releaseNotes: accountSheet = .releaseNotes
        case .about: accountSheet = .about
        case .help: UIApplication.shared.open(SettingsLinks.helpCenter(french: false))
        }
    }

    /// New's entries: create, or open a bot's or a person's conversation.
    private func selectNew(_ item: NewMenuItem) {
        showingPlusMenu = false
        switch item {
        case .createBot:
            // 2026-10-27: Create a bot, the wizard's first screen; the full
            // form (this sheet), the imports and quick create stay there
            BotWizardPresenter.shared.open()
        case .createGroup:
            showingNewGroup = true
        case let .bot(id):
            if let bot = session.state.bot(id) { openChat(.bot(bot)) }
        case let .person(id):
            Task {
                if let chat = await PeopleDirectory.shared.openConversation(with: id, session: session) { path.append(chat) }
            }
        }
    }

    // MARK: - Data

    /// The reader's activity level, which the roster preview folds by.
    private var activity: ActivityDetail { toolCalls.detail }

    /// How much each row says, from Settings.
    private var density: RosterDensity { RosterDensity.shown(stored: rosterDensity) }

    private var chats: [ChatSummary] {
        let all = session.state.chatSummaries(activity: activity)
        guard !query.isEmpty else {
            // rooms live in the strip; the list is bots
            return all.filter { if case .bot = $0.chat { return true } else { return false } }
        }
        return all.filter {
            $0.chat.name.localizedCaseInsensitiveContains(query)
                || $0.chat.subtitle.localizedCaseInsensitiveContains(query)
                || $0.preview.localizedCaseInsensitiveContains(query)
                || matchesThread($0.chat)
        }
    }

    private func matchesThread(_ chat: Chat) -> Bool {
        guard case let .bot(bot) = chat else { return false }
        return !bot.threadGroups(matching: query, queuedThreadIds: session.state.queuedThreadIds).isEmpty
    }

    private func openAttention(_ entry: AttentionThread) {
        // one conversation (threads hidden): the gate every way into a
        // thread passes (Session.openChat): the conversation, brought to
        // that topic or with the thread beside it, never a switch
        if !sidebarPrefs.showThreads {
            session.openChat(threadId: entry.task.threadId)
            return
        }
        guard let bot = entry.destinationBot(in: session.state) else { return }
        path.append(Chat.bot(bot))
    }

    private func summaries(for bots: [Bot]) -> [ChatSummary] {
        let ids = Set(bots.map(\.id))
        return session.state.chatSummaries(activity: activity).filter { summary in
            if case let .bot(bot) = summary.chat { return ids.contains(bot.id) }
            return false
        }
    }

    private var waitingChats: Set<String> {
        Set(session.state.pendingApprovals.compactMap { session.state.chat(forThread: $0.threadId)?.id })
    }

    private var rosterIsEmpty: Bool {
        if query.isEmpty {
            return session.state.bots.allSatisfy { $0.hidden == true } && session.state.rooms.isEmpty
        }
        return chats.isEmpty && searchHits.isEmpty && !searching
    }

    private func sectionLabel(_ text: Text) -> some View {
        text
            .textCase(.uppercase)
            // Compact rows follow Dynamic Type, so their titles do too, but
            // only up to xxxLarge: beyond it these uppercase labels would
            // outweigh the names they head. Comfortable's never scale.
            .font(density == .compact ? .footnote.weight(.semibold) : .system(size: 13, weight: .semibold))
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            .tracking(0.4)
            .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
            .padding(.horizontal, 20)
    }
}

// MARK: - Rows and tiles

/// A room as a round tile: the first two members' mascots stacked, its name
/// beneath. `nil` is the "make one" tile.
struct GroupTile: View {
    @Environment(\.themePalette) var themePalette
    let room: Room?
    @EnvironmentObject private var session: Session

    var body: some View {
        VStack(spacing: 7) {
            ZStack {
                if let room {
                    Circle().fill(Theme.parity(Color.secondary, Theme.textSecondary).opacity(0.14))
                    GroupMascotView(members: memberBots(room), size: 52)
                    if room.unread {
                        Circle()
                            .fill(MausPalette.color("blue"))
                            .frame(width: 10, height: 10)
                            .overlay(Circle().stroke(Theme.parity(Color(uiColor: .systemBackground), Theme.bg), lineWidth: 2))
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                            .padding(3)
                    }
                } else {
                    Circle()
                        .strokeBorder(style: StrokeStyle(lineWidth: 1.5, dash: [4, 4]))
                        .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary).opacity(0.6))
                    Image(systemName: "plus")
                        .font(.system(size: 22, weight: .medium))
                        .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
                }
            }
            .frame(width: 64, height: 64)

            Text(room?.name ?? "New group")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(room == nil ? Theme.parity(Color.secondary, Theme.textSecondary) : Theme.textPrimary)
                .lineLimit(1)
        }
        .frame(width: 76)
        .contentShape(Rectangle())
    }

    private func memberBots(_ room: Room) -> [Bot] {
        room.memberIds.compactMap { session.state.bot($0) }
    }
}

/// One thread that needs the person, from any bot: title, status, and the
/// bot it belongs to, ready to jump straight there. Waiting outranks
/// working, which outranks queued and unread — the same order as the tree.
struct AttentionRow: View {
    @Environment(\.themePalette) var themePalette
    let entry: AttentionThread
    /// Compact's rows follow Dynamic Type, and these grow with them, in the
    /// proportions they have at the default size. Comfortable's rows keep
    /// fixed sizes, and so do these beside them.
    var followsDynamicType = false

    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .subheadline) private var scaledTitle: CGFloat = 15
    @ScaledMetric(relativeTo: .subheadline) private var scaledDetail: CGFloat = 12
    @ScaledMetric(relativeTo: .subheadline) private var scaledMarkWidth: CGFloat = 24

    /// The title's size, and the mark's beside it.
    private var titleSize: CGFloat { followsDynamicType ? scaledTitle : 15 }
    private var detailSize: CGFloat { followsDynamicType ? scaledDetail : 12 }
    private var markWidth: CGFloat { followsDynamicType ? scaledMarkWidth : 24 }
    /// A scaled title wraps at the accessibility sizes instead of being cut
    /// short, as compact's names and thread titles do there.
    private var titleWraps: Bool { followsDynamicType && typeSize.isAccessibilitySize }

    private var waiting: Bool { entry.task.activity == "waiting-on-you" }
    private var working: Bool { !waiting && (entry.task.busy == true || entry.task.activity == "working") }
    private var queued: Bool { !waiting && !working && entry.task.activity == "queued" }

    private var statusText: String {
        if waiting { return "Waiting on you" }
        if working { return "Working" }
        if queued { return "Queued" }
        return "Unread"
    }

    var body: some View {
        HStack(spacing: 12) {
            Group {
                if working {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: waiting ? "exclamationmark.circle.fill" : queued ? "clock" : "bell.badge.fill")
                        .font(.system(size: titleSize, weight: .medium))
                }
            }
            .foregroundStyle(waiting ? Theme.parity(Color.orange, Theme.warning) : queued ? Theme.parity(Color.secondary, Theme.textSecondary) : Theme.parity(Color.accentColor, Theme.accent))
            .frame(width: markWidth)

            VStack(alignment: .leading, spacing: 2) {
                // one conversation per bot (threads hidden): the bot's name is
                // the row, never a thread's title (there are no threads to the person)
                Text(verbatim: SidebarPrefsModel.shared.showThreads ? entry.task.displayTitle : entry.botName)
                    .font(.system(size: titleSize, weight: .medium))
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(titleWraps ? 3 : 1)
                    .fixedSize(horizontal: false, vertical: titleWraps)
                Text(SidebarPrefsModel.shared.showThreads ? "\(entry.botName) · \(statusText)" : statusText)
                    .font(.system(size: detailSize))
                    .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 8)
        .frame(minHeight: 44)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(entry.task.displayTitle), \(entry.botName), \(statusText)")
    }
}

struct ChatRow: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @ObservedObject private var people = PeopleDirectory.shared
    let chat: Chat
    let preview: String
    let at: Double
    var state: MausState = .idle
    var waiting = false
    var last = false

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            // the unread dot, in the bot's own colour, at the very edge
            ZStack {
                if chat.unread && !chat.busy {
                    Circle()
                        .fill(MausPalette.color(chat.color))
                        .frame(width: 10, height: 10)
                }
            }
            .frame(width: 22)
            .frame(maxHeight: .infinity)

            HStack(alignment: .top, spacing: 14) {
                ChatAvatarView(chat: chat, size: 52, state: state, animated: state.showsActivity)
                    // #985: a bot shared with the viewer wears its sharer's face
                    .overlay(alignment: .bottomTrailing) {
                        if let sharer { SharerBadge(sharer: sharer, avatarSize: 52) }
                    }
                    .padding(.top, 12)

                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(chat.name)
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(Theme.textPrimary)
                            .lineLimit(1)
                            .layoutPriority(1)

                        // the bot's job, the way the desktop shows it
                        if !chat.subtitle.isEmpty {
                            Text(chat.subtitle)
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
                                .lineLimit(1)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(Capsule().fill(Theme.parity(Color.secondary, Theme.textSecondary).opacity(0.15)))
                        }

                        Spacer(minLength: 4)

                        Text(RelativeStamp.list(at))
                            .font(.system(size: 15))
                            .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
                            .fixedSize()
                        Image(systemName: "chevron.right")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary).opacity(0.5))
                    }

                    HStack(alignment: .top, spacing: 8) {
                        // one line for every bot, so the rows keep one rhythm
                        Text(preview.isEmpty ? " " : preview)
                            .font(.system(size: 15))
                            .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
                            .lineLimit(1)

                        Spacer(minLength: 0)

                        if chat.busy {
                            ProgressView().controlSize(.mini).padding(.top, 3)
                        }
                    }

                    if waiting {
                        Label("Waiting on you", systemImage: "hand.raised.fill")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 9)
                            .padding(.vertical, 4)
                            .background(Capsule().fill(MausPalette.color(chat.color)))
                            .padding(.top, 4)
                    }
                }
                .padding(.vertical, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .overlay(alignment: .bottom) {
                    if !last { Divider() }
                }
            }
            .padding(.trailing, 16)
        }
        .padding(.leading, 6)
        .contentShape(Rectangle())
    }

    private var sharer: BotSharer? {
        guard case let .bot(bot) = chat else { return nil }
        return people.sharer(of: bot, session: session)
    }
}

/// The floating pill: who is doing what right now, at a glance.
struct UpdatesPill: View {
    @Environment(\.themePalette) var themePalette
    let updates: [ChatUpdate]
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if !updates.isEmpty {
                    MascotStack(chats: Array(updates.prefix(3).map(\.chat)))
                }
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 4) {
                        if let first = updates.first {
                            switch first.kind {
                            case .needsYou:
                                Image(systemName: "hand.raised.fill")
                                    .font(.system(size: 11, weight: .bold))
                                    .foregroundStyle(MausPalette.color(first.chat.color))
                                Text("\(first.chat.name) needs you")
                            case .working:
                                Text("\(first.chat.name) is working")
                            case .toReview:
                                Text("\(first.chat.name) has an update")
                            }
                        } else {
                            Text("All quiet")
                        }
                    }
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(updates.isEmpty ? Theme.parity(Color.secondary, Theme.textSecondary) : Theme.textPrimary)
                    .lineLimit(1)

                    Text(subline)
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.up")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
            }
            .padding(.leading, updates.isEmpty ? 16 : 7)
            .padding(.trailing, 12)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .glassCapsule()
        .accessibilityLabel("Updates")
        .accessibilityIdentifier("updates-button")
    }

    private var subline: String {
        guard let first = updates.first else { return "Nothing needs you" }
        let rest = updates.count - 1
        if rest == 0 { return first.line.isEmpty ? " " : first.line }
        return rest == 1 ? "1 more update" : "\(rest) more updates"
    }
}

/// Up to three mascots overlapping, the way a group of faces reads at a glance.
struct MascotStack: View {
    @Environment(\.themePalette) var themePalette
    let chats: [Chat]
    var size: CGFloat = 28
    var overlap: CGFloat = 12

    var body: some View {
        HStack(spacing: -overlap) {
            ForEach(Array(chats.enumerated()), id: \.offset) { _, chat in
                ChatAvatarView(chat: chat, size: size)
                    .padding(2)
                    .background(Circle().fill(Theme.parity(Color(uiColor: .systemBackground), Theme.bg)))
            }
        }
    }
}

/// Connection state, shown only when it is not "fine".
struct StatusBanner: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session

    var body: some View {
        Group {
            switch session.status {
            case .live, .unpaired:
                EmptyView()
            case .connecting:
                // After a live session (or any hydrated state), a brief drop is
                // a deploy restart: calm Reconnecting, never a hard error.
                let label = session.state.cursor != nil || !session.state.bots.isEmpty
                    ? String(localized: "Reconnecting…")
                    : String(localized: "Connecting…")
                banner(label, systemImage: "arrow.triangle.2.circlepath", tint: Theme.parity(Color.secondary, Theme.textSecondary))
            case let .offline(reason) where Self.isCalmReconnect(reason):
                banner(reason, systemImage: "arrow.triangle.2.circlepath", tint: Theme.parity(Color.secondary, Theme.textSecondary))
            case let .offline(reason):
                banner(reason, systemImage: "wifi.slash", tint: Theme.parity(Color.orange, Theme.warning))
            case .unauthorized:
                banner("This device was unpaired on the computer.", systemImage: "lock.slash", tint: Theme.parity(Color.red, Theme.danger))
            }
        }
        .animation(.default, value: session.status)
    }

    private static func isCalmReconnect(_ reason: String) -> Bool {
        let lower = reason.lowercased()
        return lower.contains("reconnecting") || lower.contains("reconnexion")
    }

    private func banner(_ text: String, systemImage: String, tint: Color) -> some View {
        Label(text, systemImage: systemImage)
            .font(.footnote)
            .foregroundStyle(tint)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .glassCapsule(interactive: false)
            .padding(.bottom, 8)
    }
}

struct SearchHitRow: View {
    @Environment(\.themePalette) var themePalette
    let hit: SearchHit

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: hit.role == .user ? "person.fill" : "bubble.left.fill")
                .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
                .frame(width: 26, height: 26)
                .background(Circle().fill(Theme.parity(Color.secondary, Theme.textSecondary).opacity(0.13)))

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(hit.name).font(.system(size: 15, weight: .semibold))
                    if let task = hit.task, !task.isEmpty {
                        Text(task).font(.system(size: 12)).foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
                    }
                    Spacer()
                    Text(RelativeStamp.list(hit.at))
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
                }
                Text(hit.snippet)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }
        }
        .padding(.vertical, 10)
        .contentShape(Rectangle())
    }
}

/// Timestamps the way a messaging app writes them.
enum RelativeStamp {
    /// Roster: time today, weekday this week, date beyond that.
    static func list(_ at: Double) -> String {
        guard at > 0 else { return "" }
        let date = Date(timeIntervalSince1970: at / 1000)
        let calendar = Calendar.current
        if calendar.isDateInToday(date) {
            return date.formatted(date: .omitted, time: .shortened)
        }
        if calendar.isDateInYesterday(date) { return String(localized: "Yesterday") }
        if let week = calendar.date(byAdding: .day, value: -6, to: Date()), date > week {
            return date.formatted(.dateTime.weekday(.wide))
        }
        return date.formatted(.dateTime.day().month(.abbreviated))
    }

    /// In a transcript: enough to place a gap in the conversation.
    static func separator(_ date: Date) -> String {
        let calendar = Calendar.current
        let time = date.formatted(date: .omitted, time: .shortened)
        if calendar.isDateInToday(date) { return String(localized: "Today \(time)") }
        if calendar.isDateInYesterday(date) { return String(localized: "Yesterday \(time)") }
        return "\(date.formatted(.dateTime.day().month(.abbreviated))) \(time)"
    }
}

// MARK: - Standard home (reference 01, 18)

extension ChatListView {
    @ViewBuilder
    var homeContent: some View {
        Group {
            if density == .standard {
                AnyView(standardHome)
            } else {
                AnyView(legacyHome)
            }
        }
        // Settings open full screen (owner, 2026-10-26): the home (avatar, search,
        // bottom bar, island) hides at once, with no animation, so nothing of
        // it crosses the Settings header. It comes back when Settings closes.
        .opacity(showingSettings ? 0 : 1)
        .allowsHitTesting(!showingSettings)
        .accessibilityHidden(showingSettings)
        .animation(nil, value: showingSettings)
        .overlay { AnyView(homeOverlays) }
        .task(id: session.connection?.id) {
            await session.loadAccount()
            await sidebarPrefs.load(session)
            await ToolCallsSetting.shared.load(session)
            await people.load(session)
            await AccountRowModel.shared.refresh(session)
            await flags.reload(session)
            await botActions.load(session)
        }
#if DEBUG
        .task {
            // capture only: bulk selection started on the first two bots
            guard ProcessInfo.processInfo.arguments.contains("-parity-select") else { return }
            for _ in 0..<40 where session.state.bots.count < 2 { try? await Task.sleep(nanoseconds: 250_000_000) }
            let ids = ["Aurora", "Liora"].compactMap { name in session.state.bots.first { $0.name == name }?.id }
            guard let first = ids.first else { return }
            selection.begin(first)
            ids.dropFirst().forEach { selection.toggle($0) }
            // capture only: Edit N bots open on that selection
            if ProcessInfo.processInfo.arguments.contains("-parity-bulk-edit") { selection.editing = true }
        }
        .task {
            switch ParityLaunch.current?.screen {
            case .homePlusMenu?: showingPlusMenu = true
            case .search?: showingSearch = true
            case .searchTyped?: showingSearch = true
            case .newChat?: showingNewChat = true
            case .newGroupChat?: showingNewGroup = true
            case .createBot?, .createBotImport?: showingCreateBot = true
            case .botWizard?: BotWizardPresenter.shared.open()
            case .settingsTop?, .settingsBottom?, .plugins?, .account?, .botComputer?, .appearance?: showingSettings = true
            default: break
            }
        }
#endif
    }

    /// The phone's own sections (Needs attention) fold on this phone; the
    /// others under the desktop's section ids, which follow the person.
    private var collapsedSections: Set<String> { CollapsedSections.decode(collapsedRaw) }

    private func isCollapsed(_ key: String) -> Bool {
        guard let id = HomeSectionKey.sectionID(for: key) else { return collapsedSections.contains(key) }
        return sidebarPrefs.isCollapsed(id)
    }

    private func toggleSection(_ key: String) {
        guard let id = HomeSectionKey.sectionID(for: key) else {
            var set = collapsedSections
            if set.contains(key) { set.remove(key) } else { set.insert(key) }
            collapsedRaw = CollapsedSections.encode(set)
            return
        }
        sidebarPrefs.toggleCollapsed(session, id)
    }

    // The home's sub-trees are type-erased: since the parity packages, their
    // concrete SwiftUI type nests deep enough that resolving it at launch
    // overflowed the main thread's stack on iPad (TestFlight build 6).
    /// A home overlay (Settings, Search, New bot, New group, the + menu)
    /// covers the home: the bottom chrome steps aside under it.
    private var homeOverlayOpen: Bool {
        showingSettings || showingSearch || showingNewChat || showingCreateBot || showingNewGroup || showingPlusMenu
    }

    private var standardHome: some View {
        let headerClearance = HomeMetrics.headerTop + HomeMetrics.headerHeight + 8
        // One structure whatever the switches say: the bottom bar is always
        // the scroll's bottom safe-area inset, never a row of the header, so
        // the Updates pill cannot migrate to the top or float mid-screen
        // (owner, 2026-10-16). With search and + at the top, the bar keeps the
        // pill alone; with neither, it is empty and takes no height.
        return standardHomeScroll(headerClearance: headerClearance)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                // Hidden, not removed, under an overlay: the inset
                // keeps its height, so nothing under it moves.
                AnyView(standardBottomBar)
                    .opacity(homeOverlayOpen ? 0 : 1)
                    .allowsHitTesting(!homeOverlayOpen)
                    .accessibilityHidden(homeOverlayOpen)
            }
        // Search and New bot focus a field as they open. They ignore the
        // keyboard themselves, but the home under them did not: its bottom
        // bar (Updates pill, search, +) rode the keyboard up the screen
        // (owner, 2026-10-15). The home has no field of its own, so it never
        // makes room for the keyboard.
        .ignoresSafeArea(.keyboard, edges: .bottom)
        .overlay(alignment: .top) {
            if CompanionLayout.supportsIslandPresentation {
                NeedsYouIsland(
                    update: session.state.updates.first { $0.kind == .needsYou }
                ) { chat in path.append(chat) }
            }
        }
    }

    private func standardHomeScroll(headerClearance: CGFloat) -> some View {
        ZStack(alignment: .top) {
            Theme.bg.skinTexture(Theme.palette.texture, ink: Theme.palette.textPrimary.uiColor).ignoresSafeArea()
            ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Color.clear.frame(height: headerClearance)
                    StatusBanner()
                        .frame(maxWidth: .infinity)
                    if session.isDemo { DemoBanner() }
                    if pinnedChats.isEmpty {
                        Color.clear.frame(height: 12)
                    } else {
                        // the lead's larger mascot (see `pinnedLead`) grows
                        // its cell upward by its overflow: lifted by as much,
                        // so the mascot's centre and its name keep their places
                        AnyView(pinnedGrid)
                            .padding(.top, HomeMetrics.pinnedTop - HomeMetrics.headerTop - HomeMetrics.headerHeight - 8
                                - (pinnedLead != nil ? HomeMetrics.pinnedSoloOverflow : 0))
                    }
                    AnyView(standardSections)
                }
                .padding(.bottom, 32)
            }
            .refreshable {
                await session.refresh()
                await sidebarPrefs.load(session)
                await AccountRowModel.shared.refresh(session)
            }
            .accessibilityIdentifier("roster-list")
            .coordinateSpace(name: Self.rosterSpace)
            .background {
                GeometryReader { box in
                    Color.clear.onPreferenceChange(HomeRowFramesKey.self) { frames in
                        rowFrames = frames
                        rosterViewport = (headerClearance, box.size.height)
                        updateOffscreenUnread()
                    }
                }
            }
            .overlay(alignment: .top) {
                if offscreenUnread.above > 0, let target = offscreenUnread.nearestAbove {
                    HomeUnreadPill(count: offscreenUnread.above, above: true) {
                        withAnimation { proxy.scrollTo(target, anchor: .center) }
                    }
                    .padding(.top, headerClearance + 4)
                    .transition(.opacity)
                }
            }
            .overlay(alignment: .bottom) {
                if offscreenUnread.below > 0, let target = offscreenUnread.nearestBelow {
                    HomeUnreadPill(count: offscreenUnread.below, above: false) {
                        withAnimation { proxy.scrollTo(target, anchor: .center) }
                    }
                    .padding(.bottom, 12)
                    .transition(.opacity)
                }
            }
            .onValueChange(of: unreadRowIds) { _ in updateOffscreenUnread() }
            .topScrollEdgeFade(height: headerClearance)
            .overlay {
                if rosterIsEmpty {
                    EmptyStateView(
                        "No bots yet",
                        systemImage: "bubble.left.and.bubble.right",
                        description: Text("Bots you create on your computer show up here.")
                    )
                }
            }
            }
            AnyView(standardHeader)
        }
    }

    // MARK: Header

    /// The avatar, taken out of the tree (not just hidden) while Settings is
    /// open: the account menu folds back into it, and that fold, drawn by the
    /// system, would otherwise cross the Settings header (owner, 2026-10-26).
    @ViewBuilder
    private var homeAccountButton: some View {
        if showingSettings {
            Color.clear.frame(width: Theme.Metric.glassLarge, height: Theme.Metric.glassLarge)
        } else {
            HomeAccountButton(select: selectAccount)
        }
    }

    /// The Grok Bot home (2026-11-01): the photo at the leading corner and
    /// the + at the trailing one; search joins the + only when "Search at
    /// top" is on. The iPad keeps the avatar at its trailing corner and
    /// everything else at the bottom.
    private var standardHeader: some View {
        VStack(spacing: Theme.Metric.controlGap) {
            HStack(spacing: Theme.Metric.controlGap) {
                if avatarAtTrailingCorner {
                    // the iPad: the window controls own the leading corner
                    Spacer(minLength: 0)
                    homeAccountButton
                } else {
                    homeAccountButton
                    Spacer(minLength: 0)
                    if rosterChromeAtTop {
                        GlassCircleButton(systemImage: "magnifyingglass", accessibilityLabel: "Search") {
                            showingSearch = true
                        }
                        .accessibilityFocused($chromeFocus, equals: .search)
                        .accessibilityIdentifier("home-search")
                    }
                    newMenuButton
                }
            }
        }
        .padding(.horizontal, Theme.Metric.screenEdge)
        .padding(.top, HomeMetrics.headerTop)
        .padding(.bottom, 8)
    }

    /// Search and + at the trailing edge (the iPad's bottom bar).
    private var standardChromeTrailing: some View {
        HStack(spacing: Theme.Metric.controlGap) {
            GlassCircleButton(systemImage: "magnifyingglass", accessibilityLabel: "Search") {
                showingSearch = true
            }
            .accessibilityFocused($chromeFocus, equals: .search)
            .accessibilityIdentifier("home-search")
            newMenuButton
        }
    }

    /// The bottom bar, as in Grok Bot: the apps button, then the Search
    /// pill within thumb's reach. With the "Updates button" switch on, the
    /// large Updates pill takes the middle and search shrinks to its circle;
    /// "Search at top" moves search only. The iPad keeps search and + here.
    @ViewBuilder
    private var standardBottomBar: some View {
        if selection.active {
            HomeSelectionBar(model: selection)
        } else {
            HStack(spacing: HomeMetrics.bottomGap) {
                HomeAppsButton(select: selectAccount, openApp: openHomeApp)
                if avatarAtTrailingCorner {
                    if showUpdatesButton { updatesButton.frame(maxWidth: .infinity) } else { Spacer(minLength: 0) }
                    standardChromeTrailing
                } else if showUpdatesButton {
                    updatesButton.frame(maxWidth: .infinity)
                    if !rosterChromeAtTop {
                        GlassCircleButton(systemImage: "magnifyingglass", accessibilityLabel: "Search") {
                            showingSearch = true
                        }
                        .accessibilityFocused($chromeFocus, equals: .search)
                        .accessibilityIdentifier("home-search")
                    }
                } else if !rosterChromeAtTop {
                    HomeSearchPill { showingSearch = true }
                        .accessibilityFocused($chromeFocus, equals: .search)
                } else {
                    Spacer(minLength: 0)
                }
            }
            .padding(.leading, HomeMetrics.bottomInset)
            .padding(.trailing, HomeMetrics.bottomInset)
            // Grok Bot sits the row 28 pt off the screen's bottom edge, a
            // little into the home indicator's band
            .padding(.bottom, avatarAtTrailingCorner ? 8 : 1)
            .offset(y: avatarAtTrailingCorner ? 0 : 6)
            .bottomBarScrim()
        }
    }

    /// The apps menu's own entries.
    private func openHomeApp(_ app: HomeApp) {
        Haptics.selection()
        switch app {
        case .updates: showingUpdates = true
        case .connectApps:
            connectAppsTab = nil
            showingConnectedApps = true
        case .templates: showingTemplates = true
        }
    }

    // MARK: Pinned

    /// The Primary Bot (when it has no section), pinned bots, then
    /// pinned groups.
    private var pinnedChats: [Chat] {
        let layout = self.layout
        var chats: [Chat] = []
        if let chief = layout.unsectionedChief { chats.append(.bot(chief)) }
        chats += layout.pinnedBots.sorted { $0.createdAt < $1.createdAt }.map(Chat.bot)
        let shown = Set((layout.sections.flatMap(\.channels) + layout.unsectionedChannels).map(\.id))
        chats += session.state.rooms.filter { $0.dm != true && $0.pinned == true && shown.contains($0.id) }.map(Chat.room)
        return chats
    }

    /// The chat drawn large and centred on its own row at the top, as the reference
    /// iOS app shows its one primary bot: the Primary Bot when it is
    /// pinned, else a lone pinned chat. Nil when several chats are pinned and
    /// none is the Primary Bot.
    private var pinnedLead: Chat? {
        let chats = pinnedChats
        if let primary = chats.first(where: { if case let .bot(bot) = $0 { return bot.chiefOfStaff == true }; return false }) {
            return primary
        }
        return chats.count == 1 ? chats.first : nil
    }

    /// The lead (see `pinnedLead`) alone on a centred row, then the other
    /// pins (Sagax pins several bots and groups; the reference design cannot) in rows of
    /// three 134 pt columns at the measured 85 pt (reference 01), each row
    /// centred. The rows span the whole width at every size and orientation.
    private var pinnedGrid: some View {
        let lead = pinnedLead
        let rest = pinnedChats.filter { $0.id != lead?.id }
        let rows = stride(from: 0, to: rest.count, by: 3).map { Array(rest[$0..<min($0 + 3, rest.count)]) }
        return VStack(spacing: 0) {
            if let lead {
                // The long-press menu stays on the cell. This button used to
                // grow to the width of the screen, so its preview filled the
                // iPhone and later entries (Share) were not offered.
                pinnedButton(lead, mascot: HomeMetrics.pinnedSoloMascot)
                    .fixedSize()
                    .frame(maxWidth: .infinity)
            }
            ForEach(rows.indices, id: \.self) { index in
                HStack(spacing: 0) {
                    ForEach(rows[index], id: \.id) { chat in
                        pinnedButton(chat, mascot: HomeMetrics.pinnedMascot)
                    }
                }
                .frame(maxWidth: .infinity)
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func pinnedButton(_ chat: Chat, mascot: CGFloat) -> some View {
        Button { openChat(chat) } label: {
            HomePinnedCell(chat: chat, state: MausState.forChat(chat, in: session.state), mascot: mascot)
        }
        .buttonStyle(.plain)
        .contextMenu { chatMenu(chat) }
        .sidebarBotPinSwipe(chat, session: session)
        .accessibilityIdentifier("pinned.\(chat.id)")
    }

    // MARK: Sections

    @ViewBuilder
    private var standardSections: some View {
        let layout = self.layout
        // Unread already shows as dots on the rows; this lists only what
        // waits on the person.
        let waitingOnYou = attention.filter { $0.task.activity == "waiting-on-you" }
        if !waitingOnYou.isEmpty {
            section(key: "__attention", title: String(localized: "Inbox")) {
                ForEach(waitingOnYou) { entry in
                    Button {
                        Haptics.selection()
                        openAttention(entry)
                    } label: {
                        AttentionRow(entry: entry)
                    }
                    .buttonStyle(.plain)
                    .padding(.horizontal, HomeMetrics.rowLeading)
                }
            }
        }

        ForEach(layout.sections) { sidebar in
            section(key: sidebar.name, title: HomeSectionTitle.display(sidebar.name), named: sidebar.name, layout: layout) {
                homeRows(chats: sidebar.chiefs.map(Chat.bot)
                    + sidebar.channels.filter { $0.pinned != true }.map(Chat.room)
                    + sidebar.bots.map(Chat.bot))
            }
        }

        let unsectioned = layout.unsectionedBots
        if !unsectioned.isEmpty {
            section(key: HomeSectionKey.bots, title: String(localized: "Bots"), layout: layout) {
                homeRows(chats: unsectioned.map(Chat.bot))
            }
        }

        let groups = layout.unsectionedChannels.filter { $0.pinned != true }
        if !groups.isEmpty {
            section(key: HomeSectionKey.groups, title: String(localized: "Group Chats"), layout: layout) {
                homeRows(chats: groups.map(Chat.room))
            }
        }

        if !layout.botChats.isEmpty {
            section(key: HomeSectionKey.botChats, title: String(localized: "Bot threads")) {
                homeRows(chats: layout.botChats.map(Chat.room))
            }
        }

        HomeHiddenEntries(rows: layout.hiddenRows, prefs: sidebarPrefs)
    }

    /// One collapsible home section. `named` is a section of the person's or
    /// the server's; `layout` (nil for Needs attention and Bot threads)
    /// adds the section menu (Features/Sidebar/SidebarSectionActions).
    private func section<Rows: View>(
        key: String, title: String, named: String? = nil, layout: SidebarLayout? = nil,
        @ViewBuilder rows: () -> Rows
    ) -> some View {
        let collapsed = isCollapsed(key)
        return VStack(alignment: .leading, spacing: 0) {
            HomeSectionHeader(title: title, collapsed: collapsed) { toggleSection(key) }
                .contextMenu {
                    if let layout, let id = HomeSectionKey.sectionID(for: key) {
                        SidebarSectionMenu(
                            name: named, sectionID: id, layout: layout, actions: sectionActions, prefs: sidebarPrefs,
                            newBotHere: { team in
                                Task { @MainActor in
                                    try? await Task.sleep(nanoseconds: 350_000_000)
                                    createBotSection = team
                                    showingCreateBot = true
                                }
                            }
                        )
                    }
                }
                .accessibilityIdentifier("section.\(key)")
            if !collapsed {
                rows()
            }
        }
    }

    /// Rows in the roster's order: unread first, then the most recent.
    private func homeRows(chats: [Chat]) -> some View {
        let ids = Set(chats.map(\.id))
        let ordered = session.state.chatSummaries(activity: activity).filter { ids.contains($0.chat.id) }.map(\.chat)
        let waiting = waitingChats
        let queued = session.state.queuedThreadIds
        return ForEach(ordered, id: \.id) { chat in
            let messages = session.state.visibleTranscript(forThread: chat.threadId)
            let status = rowStatus(chat, waiting: waiting.contains(chat.id), queued: queued)
            let botId: String? = { if case let .bot(bot) = chat { return bot.id }; return nil }()
            Button {
                if selection.active { if let botId { selection.toggle(botId) } } else { openChat(chat) }
            } label: {
                HomeChatRow(
                    chat: chat,
                    preview: rosterPreviewLine(messages, detail: activity),
                    stamp: RelativeStamp.list(messages.last?.at ?? 0),
                    status: status,
                    state: MausState.forChat(chat, in: session.state),
                    selection: selection.active && botId != nil ? .init(selected: botId.map(selection.contains) ?? false) : nil
                )
            }
            .buttonStyle(.plain)
            .id(chat.id)
            .reportsHomeRow(chat.id, space: Self.rosterSpace)
            .contextMenu {
                chatMenu(chat)
                if let botId, !selection.active {
                    Divider()
                    Button { selection.begin(botId) } label: {
                        Label(String(localized: "Select"), systemImage: "checkmark.circle")
                    }
                }
            }
            .sidebarBotPinSwipe(chat, session: session)
            .accessibilityIdentifier("chat-row.\(chat.id)")
        }
    }

    private func rowStatus(_ chat: Chat, waiting: Bool, queued: Set<String>) -> HomeRowStatus {
        switch chat {
        case let .bot(bot):
            let row = CompactBotRow(bot: bot, hasPendingCard: waiting, queuedThreadIds: queued, creatingThread: creatingThreads.contains(bot.id))
            return HomeRowStatus(waiting: row.showsWaiting, working: row.showsSpinner, threadCount: sidebarPrefs.threads.rowThreadCount(row.threadCount), unread: row.showsUnreadDot)
        case let .room(room):
            let busy = room.busyBotId != nil
            return HomeRowStatus(waiting: waiting, working: busy, threadCount: 0, unread: room.unread && !busy)
        }
    }

    static let rosterSpace = "roster-scroll"

    private var unreadRowIds: Set<String> {
        let waiting = waitingChats
        let queued = session.state.queuedThreadIds
        let chats = session.state.chatSummaries(activity: activity).map(\.chat)
        return Set(chats.filter { rowStatus($0, waiting: waiting.contains($0.id), queued: queued).unread }.map(\.id))
    }

    /// Rows scrolled out of the visible window that still wait on a read.
    private func updateOffscreenUnread() {
        let unread = unreadRowIds
        let (top, bottom) = rosterViewport
        let boxes = rowFrames.map { UnreadRowBox(id: $0.key, top: $0.value.minY, bottom: $0.value.maxY, unread: unread.contains($0.key)) }
        let next = OffscreenUnread.compute(rows: boxes, viewportTop: top, viewportBottom: bottom)
        if next != offscreenUnread { offscreenUnread = next }
    }

    /// The parity capture of a typed search.
    private static var paritySearchQuery: String {
        #if DEBUG
        if ParityLaunch.current?.screen == .searchTyped { return "ar" }
        #endif
        return ""
    }

    /// The X of search and New chat: the sheet goes and VoiceOver lands back
    /// on the button that opened it.
    private func closeSearch(returningFocusTo button: HomeChromeFocus) {
        showingSearch = false
        showingNewChat = false
        Task {
            try? await Task.sleep(nanoseconds: 450_000_000)
            chromeFocus = button
        }
    }

    private func openSearchResult(_ destination: SearchDestination) {
        switch destination {
        case let .chat(chat): path.append(session.returning(to: chat))
        case let .exact(chat): path.append(chat)
        }
    }

    private func openChat(_ chat: Chat) {
        Haptics.selection()
        path.append(session.returning(to: chat))
    }

    // MARK: Long press

    /// One builder for every density and the pinned row: the desktop's
    /// bot and room menus (Features/Sidebar/HomeMenus.swift, RoomActions).
    @ViewBuilder
    private func chatMenu(_ chat: Chat) -> some View {
        switch chat {
        case let .bot(bot):
            BotRowMenu(bot: bot)
        case let .room(room):
            let layout = self.layout
            RoomRowMenu(room: room, actions: roomActions, personalLayout: layout.personal ? layout : nil, sectionActions: sectionActions)
        }
    }

    // MARK: Overlays

    @ViewBuilder
    private var homeOverlays: some View {
        ZStack {
            if showingSettings {
                // Full screen on iPhone and iPad (owner, 2026-10-26): the whole
                // surface, with the X of SettingsView to close.
                SettingsView(close: {
                    showingSettings = false
                    Task { await flags.reload(session) }
                })
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .background(Theme.bg.ignoresSafeArea())
                // No slide: the home is gone at once, and Settings takes its
                // place whole, so no animation crosses another.
                .transition(.identity)
                .zIndex(1)
            }
            if showingCreateBot {
                CreateBotSheet(section: createBotSection, close: { showingCreateBot = false }) { bot in
                    showingCreateBot = false
                    path.append(Chat.bot(bot))
                }
                .transition(.move(edge: .bottom))
                .zIndex(2)
            }
            if showingNewGroup {
                NewGroupSheet(close: { showingNewGroup = false }) { room in
                    showingNewGroup = false
                    path.append(Chat.room(room))
                }
                .transition(.move(edge: .bottom))
                .zIndex(3)
            }
            if showingSearch {
                SearchSheet(initialQuery: Self.paritySearchQuery, close: { closeSearch(returningFocusTo: .search) }) { destination in
                    showingSearch = false
                    openSearchResult(destination)
                }
                .transition(.move(edge: .bottom))
                .zIndex(4)
            }
            if showingNewChat {
                SearchSheet(mode: .newChat, close: { closeSearch(returningFocusTo: .plus) }) { destination in
                    showingNewChat = false
                    openSearchResult(destination)
                } createBot: {
                    showingNewChat = false
                    BotWizardPresenter.shared.open()
                } createGroup: {
                    showingNewChat = false
                    showingNewGroup = true
                }
                .transition(.move(edge: .bottom))
                .zIndex(4)
            }
            if showingPlusMenu {
                HomePlusMenu(
                    groups: NewMenuLabels.groups(session),
                    title: { NewMenuLabels.title($0, session: session) },
                    select: selectNew
                ) {
                    withAnimation(.easeOut(duration: 0.18)) { showingPlusMenu = false }
                }
                .padding(.top, HomeMetrics.headerTop - 6)
                .zIndex(5)
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.9), value: showingSearch)
        .animation(.spring(response: 0.35, dampingFraction: 0.9), value: showingNewChat)
        .animation(.spring(response: 0.35, dampingFraction: 0.9), value: showingNewGroup)
        .animation(.spring(response: 0.35, dampingFraction: 0.9), value: showingCreateBot)
        .animation(.spring(response: 0.35, dampingFraction: 0.9), value: showingSettings)
    }
}

/// The home buttons VoiceOver returns to when a sheet they opened closes.
enum HomeChromeFocus: Hashable {
    case search, plus
}
