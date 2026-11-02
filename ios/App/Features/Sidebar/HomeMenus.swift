// The home's menus on a phone, drawn from CompanionCore's `NavigationMenus`
// so every density offers the desktop's entries in the desktop's order:
// the bot row (long press on a row or a pinned face), the account menu
// (the photo, top left), New (the "+"), and the places at the foot of the
// list. The room row and the section header menus live beside their
// prompts (Features/Room/RoomActions.swift, SidebarSectionActions.swift).
import CompanionCore
import SwiftUI
import UIKit

// MARK: - Bot row prompts

/// The bot row menu's prompts and the facts its plan needs, mounted once by
/// the home (`botRowActionsPresenter`).
@MainActor
final class BotRowActions: ObservableObject {
    /// The viewer as the server knows them, for the Primary Bot entries.
    @Published var viewerId: String?
    @Published var renaming: Bot?
    @Published var renameDraft = ""
    @Published var archiving: Bot?
    @Published var deleting: Bot?
    @Published var replacingPrimary: Bot?
    /// Share: the bot whose Shared with page is open.
    @Published var sharing: Bot?
    /// Move to ▸ Create section on a server: the New section sheet.
    @Published var newServerSection = false
    @Published private(set) var notice: String?

    func load(_ session: Session) async {
        guard let config = await session.configStatus() else { return }
        viewerId = PrimaryBotRules.viewerId(config: config)
    }

    func startRename(_ bot: Bot) {
        renameDraft = bot.name
        afterMenu { self.renaming = bot }
    }

    func startArchive(_ bot: Bot) { afterMenu { self.archiving = bot } }
    func startDelete(_ bot: Bot) { afterMenu { self.deleting = bot } }
    func startShare(_ bot: Bot) { afterMenu { self.sharing = bot } }
    func startReplacePrimary(_ bot: Bot) { afterMenu { self.replacingPrimary = bot } }
    func startNewServerSection() { afterMenu { self.newServerSection = true } }

    func makePrimary(_ bot: Bot, _ session: Session) {
        Task {
            await PrimaryBotActions.make(bot.id, session: session, done: { self.flash($0) }, working: .constant(false))
        }
    }

    func confirmArchive(_ session: Session) {
        guard let bot = archiving else { return }
        archiving = nil
        Task {
            if await session.setArchived(bot, archived: true) {
                flash(String(localized: "\(bot.name) archived"))
            }
        }
    }

    func confirmDelete(_ session: Session) {
        guard let bot = deleting else { return }
        deleting = nil
        Task { await session.deleteBot(bot) }
    }

    func commitRename(_ session: Session) {
        guard let bot = renaming else { return }
        renaming = nil
        let draft = renameDraft
        Task { await session.renameBot(bot, to: draft) }
    }

    func flash(_ text: String) {
        withAnimation { notice = text }
        Task {
            try? await Task.sleep(nanoseconds: 1_800_000_000)
            withAnimation { if notice == text { notice = nil } }
        }
    }

    /// A prompt asked for from a context menu waits for the menu to close.
    private func afterMenu(_ present: @escaping @MainActor () -> Void) {
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 350_000_000)
            present()
        }
    }
}

struct BotRowActionsPresenter: ViewModifier {
    @ObservedObject var actions: BotRowActions
    @EnvironmentObject private var session: Session

    func body(content: Content) -> some View {
        content
            .alert(String(localized: "Rename Bot"), isPresented: Binding(
                get: { actions.renaming != nil },
                set: { if !$0 { actions.renaming = nil } }
            )) {
                TextField(String(localized: "Name"), text: $actions.renameDraft)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("bot-rename-field")
                Button(String(localized: "Cancel"), role: .cancel) { actions.renaming = nil }
                Button(String(localized: "Save")) { actions.commitRename(session) }
                    .accessibilityIdentifier("bot-rename-save")
            }
            .confirmationDialog(
                actions.archiving.map { String(localized: "Archive \($0.name)?") } ?? "",
                isPresented: Binding(
                    get: { actions.archiving != nil },
                    set: { if !$0 { actions.archiving = nil } }
                ),
                titleVisibility: .visible
            ) {
                Button(String(localized: "Archive")) { actions.confirmArchive(session) }
                    .accessibilityIdentifier("bot-archive-confirm")
                Button(String(localized: "Cancel"), role: .cancel) { actions.archiving = nil }
            } message: {
                if let bot = actions.archiving {
                    Text(String(localized: "\(bot.name) leaves the sidebar, but every conversation is kept. You can restore it any time from Archived bots."))
                }
            }
            .confirmationDialog(
                actions.deleting.map { String(localized: "Delete \($0.name)?") } ?? "",
                isPresented: Binding(
                    get: { actions.deleting != nil },
                    set: { if !$0 { actions.deleting = nil } }
                ),
                titleVisibility: .visible
            ) {
                Button(String(localized: "Delete"), role: .destructive) { actions.confirmDelete(session) }
                    .accessibilityIdentifier("bot-delete-confirm")
                Button(String(localized: "Cancel"), role: .cancel) { actions.deleting = nil }
            } message: {
                Text(String(localized: "The bot and its conversations will be deleted. This cannot be undone."))
            }
            .sheet(item: $actions.replacingPrimary) { bot in
                PrimaryBotPicker(currentId: bot.id, viewerId: actions.viewerId ?? "local-owner") { actions.flash($0) }
                    .environmentObject(session)
            }
            .fullScreenCover(item: $actions.sharing) { bot in
                PhoneBotPanel(bot: bot, section: .sharing)
                    .environmentObject(session)
            }
            .overlay(alignment: .bottom) {
                if let notice = actions.notice {
                    Text(verbatim: notice)
                        .font(.subheadline.weight(.medium))
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(.regularMaterial, in: Capsule())
                        .padding(.bottom, 24)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                        .accessibilityIdentifier("bot-action-notice")
                }
            }
    }
}

extension View {
    func botRowActionsPresenter(_ actions: BotRowActions) -> some View {
        modifier(BotRowActionsPresenter(actions: actions))
    }
}

// MARK: - Bot row menu

/// One bot's long-press menu, in every density: `BotContextMenu`'s
/// entries in its order (NavigationMenus.bot).
struct BotRowMenu: View {
    let bot: Bot
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var threadActions: ThreadActions
    @EnvironmentObject private var sectionActions: SidebarSectionActions
    @EnvironmentObject private var botActions: BotRowActions
    @ObservedObject private var prefs = SidebarPrefsModel.shared

    var body: some View {
        let live = session.state.bot(bot.id) ?? bot
        let layout = prefs.layout(session)
        let plan = NavigationMenus.bot(live, BotMenuContext(
            gate: session.surfaceGate,
            showThreads: prefs.showThreads,
            canMoveToSection: layout.personal || session.canAdminister,
            viewerId: botActions.viewerId,
            activeBotCount: session.state.bots.filter { $0.hidden != true }.count
        ))
        ForEach(Array(plan.groups.enumerated()), id: \.offset) { index, group in
            if index > 0 { Divider() }
            ForEach(group, id: \.self) { item in
                entry(item, live, plan: plan, layout: layout)
            }
        }
    }

    @ViewBuilder
    private func entry(_ item: BotMenuItem, _ bot: Bot, plan: BotMenuPlan, layout: SidebarLayout) -> some View {
        switch item {
        case .newThread:
            Button {
                Task {
                    if let created = await session.createRosterThread(for: bot) { threadActions.created = created }
                }
            } label: { Label(String(localized: "New thread"), systemImage: "square.and.pencil") }
            Button {
                Task {
                    if let created = await session.createRosterThread(for: bot, confidential: true) { threadActions.created = created }
                }
            } label: { Label(String(localized: "New confidential thread"), systemImage: ConfidentialBanner.symbol) }
        case .newFolder:
            Button { threadActions.newFolder(for: bot) } label: {
                Label(String(localized: "New folder"), systemImage: "folder.badge.plus")
            }
        case .pin, .unpin:
            Button {
                Task { await session.setPinned(bot, pinned: item == .pin) }
            } label: {
                Label(item == .pin ? String(localized: "Pin") : String(localized: "Unpin"),
                      systemImage: item == .pin ? "pin" : "pin.slash")
            }
        case .moveTo:
            BotMoveToMenu(bot: bot, layout: layout)
        case .markUnread:
            Button { threadActions.markUnread(bot, session: session) } label: {
                Label(String(localized: "Mark as Unread"), systemImage: "bell.badge")
            }
        case .rename:
            Button { botActions.startRename(bot) } label: {
                Label(String(localized: "Rename Bot"), systemImage: "pencil")
            }
        case .share:
            Button { botActions.startShare(bot) } label: {
                Label(String(localized: "Share"), systemImage: "person.badge.plus")
            }
            .accessibilityIdentifier("bot-row-share")
        case .copyConversationId:
            Button { threadActions.copyConversationId(bot) } label: {
                Label(String(localized: "Copy conversation ID"), systemImage: "doc.on.doc")
            }
        case .hide:
            Button { prefs.hide(session, .bot, bot.id) } label: {
                Label(String(localized: "Hide from sidebar"), systemImage: "eye.slash")
            }
        case .archive:
            Button { botActions.startArchive(bot) } label: {
                switch plan.archiveBlock {
                case .primary?:
                    Label { Text(String(localized: "Archive")); Text(String(localized: "Choose another Primary Bot first")) } icon: { Image(systemName: "archivebox") }
                case .lastActive?:
                    Label { Text(String(localized: "Archive")); Text(String(localized: "Keep at least one active bot")) } icon: { Image(systemName: "archivebox") }
                case nil:
                    Label(String(localized: "Archive"), systemImage: "archivebox")
                }
            }
            .disabled(!plan.enables(.archive))
        case .delete:
            Button(role: .destructive) { botActions.startDelete(bot) } label: {
                Label(String(localized: "Delete"), systemImage: "trash")
            }
        case .makePrimary:
            Button { botActions.makePrimary(bot, session) } label: {
                Label(String(localized: "Make primary bot"), systemImage: "star")
            }
        case .replacePrimary:
            Button { botActions.startReplacePrimary(bot) } label: {
                Label(String(localized: "Replace with different Bot"), systemImage: "arrow.left.arrow.right")
            }
        }
    }
}

/// Move to ▸ the sections (a check on the current one), Unassigned, then
/// Create section (`MoveToSectionItem`).
struct BotMoveToMenu: View {
    let bot: Bot
    let layout: SidebarLayout
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var sectionActions: SidebarSectionActions
    @EnvironmentObject private var botActions: BotRowActions
    @ObservedObject private var prefs = SidebarPrefsModel.shared

    var body: some View {
        let key = PersonalSections.itemKey(bot: bot.id)
        let current = layout.personal
            ? ((prefs.personal ?? .empty).section(of: key) ?? "")
            : (bot.section?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "")
        Menu {
            ForEach(layout.sectionNames, id: \.self) { name in
                Button {
                    if name != current { assign(name, key: key, current: current) }
                } label: {
                    if name == current { Label(name, systemImage: "checkmark") } else { Text(verbatim: name) }
                }
            }
            Button {
                if !current.isEmpty { assign("", key: key, current: current) }
            } label: {
                if current.isEmpty {
                    Label(String(localized: "Unassigned"), systemImage: "checkmark")
                } else {
                    Text(String(localized: "Unassigned"))
                }
            }
            Divider()
            Button {
                if layout.personal { sectionActions.startNew(assigning: key) } else { botActions.startNewServerSection() }
            } label: {
                Label(String(localized: "Create section"), systemImage: "folder.badge.plus")
            }
        } label: {
            Label(String(localized: "Move to"), systemImage: "folder")
        }
    }

    private func assign(_ name: String, key: String, current: String) {
        if layout.personal {
            sectionActions.error = prefs.assignPersonal(session, key: key, to: name)
        } else if name.isEmpty {
            Task { _ = await session.setServerSectionBots(current, add: [], remove: [bot.id]) }
        } else {
            Task { _ = await session.assignSection(name: name, botIds: [bot.id]) }
        }
    }
}

// MARK: - Account menu

/// The photo's menu (`SidebarProfileMenu`): Archived bots, Settings,
/// Team map, Automations, Memory, Achievements, About, Help Center.
struct HomeAccountMenuItems: View {
    let select: (AccountMenuItem) -> Void
    @EnvironmentObject private var session: Session
    @ObservedObject private var achievements = AchievementStore.shared
    @ObservedObject private var routines = AccountRowModel.shared

    var body: some View {
        let groups = NavigationMenus.account(
            gate: session.surfaceGate,
            hasArchivedBots: !session.surfaceGate.restorableArchivedBots(session.state.bots).isEmpty,
            achievementsReady: session.connection != nil && achievements.status != .unavailable,
            connected: session.connection != nil
        )
        // the desktop row's name, title and points (#194)
        Section { } header: { AccountMenuHeader() }
        ForEach(Array(groups.enumerated()), id: \.offset) { index, group in
            if index > 0 { Divider() }
            ForEach(group, id: \.self) { item in
                Button { select(item) } label: {
                    if item == .automations, routines.activeRoutines > 0 {
                        // the routines badge's count, where the menu opens them
                        Label(Self.title(item) + " (\(routines.activeRoutines))", systemImage: Self.symbol(item))
                    } else {
                        Label(Self.title(item), systemImage: Self.symbol(item))
                    }
                }
                .accessibilityIdentifier("account-menu.\(item.rawValue)")
            }
        }
    }

    static func title(_ item: AccountMenuItem) -> String {
        switch item {
        case .archivedBots: String(localized: "Archived bots")
        case .settings: String(localized: "Settings")
        case .teamMap: String(localized: "Team map")
        case .automations: String(localized: "Automations")
        case .memory: String(localized: "Memory")
        case .achievements: String(localized: "Achievements")
        case .releaseNotes: String(localized: "Release notes")
        case .about: String(localized: "About")
        case .help: String(localized: "Help Center")
        }
    }

    static func symbol(_ item: AccountMenuItem) -> String {
        switch item {
        case .archivedBots: "archivebox"
        case .settings: "gearshape"
        case .teamMap: "point.3.connected.trianglepath.dotted"
        case .automations: "calendar"
        case .memory: "text.book.closed"
        case .achievements: "trophy"
        case .releaseNotes: "scroll"
        case .about: "info.circle"
        case .help: "questionmark.circle"
        }
    }
}

/// What the account menu opens besides Settings, each in its own sheet.
enum HomeAccountSheet: String, Identifiable {
    case archivedBots, achievements, releaseNotes, about
    var id: String { rawValue }
}

struct HomeAccountSheetView: View {
    let sheet: HomeAccountSheet
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                switch sheet {
                case .archivedBots: AnyView(ArchivedBotsView())
                case .achievements: AnyView(AchievementsPage())
                case .releaseNotes: AnyView(ReleaseNotesPage())
                case .about: AnyView(AboutPage())
                }
            }
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "Done")) { dismiss() }
                        .accessibilityIdentifier("account-sheet-done")
                }
            }
        }
    }
}

/// Archived bots (the desktop's dialog): each one restores or is deleted.
struct ArchivedBotsView: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @State private var deleting: Bot?

    private var archived: [Bot] {
        // an admin restores every archived bot, a member their own (2026-10-26)
        session.surfaceGate.restorableArchivedBots(session.state.bots).sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
    }

    var body: some View {
        ThemedList {
            if archived.isEmpty {
                Text(String(localized: "No archived bots."))
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("archived-empty")
            }
            ForEach(archived) { bot in
                HStack(spacing: 12) {
                    BotMascotView(bot: bot, size: 32, state: .idle, animated: false, sidebarTapReact: true)
                        .accessibilityHidden(true)
                    Text(verbatim: bot.name)
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    Button(String(localized: "Restore")) {
                        Task {
                            if await session.setArchived(bot, archived: false) { Haptics.success() }
                        }
                    }
                    .buttonStyle(.borderless)
                    .accessibilityIdentifier("archived-restore.\(bot.id)")
                }
                .swipeActions {
                    if session.surfaceGate.allows(.botOwnerExtras, bot: bot) {
                        Button(String(localized: "Delete"), role: .destructive) { deleting = bot }
                    }
                }
            }
        }
        .navigationTitle(String(localized: "Archived bots"))
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog(
            deleting.map { String(localized: "Delete \($0.name)?") } ?? "",
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            titleVisibility: .visible
        ) {
            Button(String(localized: "Delete"), role: .destructive) {
                if let bot = deleting { Task { await session.deleteBot(bot) } }
                deleting = nil
            }
            Button(String(localized: "Cancel"), role: .cancel) { deleting = nil }
        } message: {
            Text(String(localized: "The bot and its conversations will be deleted. This cannot be undone."))
        }
    }
}

// MARK: - New

/// New's labels: the bot's or the person's name for theirs.
@MainActor
enum NewMenuLabels {
    static func title(_ item: NewMenuItem, session: Session) -> String {
        switch item {
        case .createBot: String(localized: "Create new Bot")
        case .createGroup: String(localized: "Create group chat")
        case let .bot(id): session.state.bot(id)?.name ?? id
        case let .person(id): PeopleDirectory.shared.directory?.people.first { $0.principalId == id }?.name ?? id
        }
    }

    static func identifier(_ item: NewMenuItem) -> String {
        switch item {
        case .createBot: "plus-menu.new-bot"
        case .createGroup: "plus-menu.new-group"
        case let .bot(id): "plus-menu.bot.\(id)"
        case let .person(id): "plus-menu.person.\(id)"
        }
    }

    /// The organization's active people the viewer may write to (the
    /// same list as Message a person).
    static func people(_ session: Session) -> [String] {
        (PeopleDirectory.shared.directory?.messageable(viewer: session.roomViewer.actorId, query: "") ?? []).map(\.principalId)
    }

    static func groups(_ session: Session) -> [[NewMenuItem]] {
        NavigationMenus.new(gate: session.surfaceGate, bots: session.state.bots, people: people(session))
    }
}

/// The same entries as a system menu (the compact and comfortable homes'
/// "+").
struct NewMenuItems: View {
    let select: (NewMenuItem) -> Void
    @EnvironmentObject private var session: Session
    @ObservedObject private var people = PeopleDirectory.shared

    var body: some View {
        let groups = NewMenuLabels.groups(session)
        ForEach(Array(groups.enumerated()), id: \.offset) { index, group in
            if index > 0 { Divider() }
            ForEach(group, id: \.self) { item in
                Button { select(item) } label: {
                    switch item {
                    case .createBot: Label(NewMenuLabels.title(item, session: session), systemImage: "square.and.pencil")
                    case .createGroup: Label(NewMenuLabels.title(item, session: session), systemImage: "person.2")
                    default: Text(verbatim: NewMenuLabels.title(item, session: session))
                    }
                }
                .accessibilityIdentifier(NewMenuLabels.identifier(item))
            }
        }
    }
}
