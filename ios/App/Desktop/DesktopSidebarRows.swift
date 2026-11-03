// iPad I2: the desktop sidebar's rows (`BotListItem`, `GroupListItem`,
// `SidebarThreadRow` and the pinned tiles in Sidebar.tsx), per density:
//
// - comfortable: 259 x 54 (py 8), avatar 36 at x 16, the name 14/20 medium
//   at x 60 (no title chip: the title is read out with the name), the
//   preview 13/18 under it; 36 pt kept on the right for "⋯".
// - compact: 259 x 40 (py 6), avatar 28, the name only (the quiet rows).
// - icons: 63 x 48 (py 6), the avatar 36 centred; a group 52 tall.
//
// Show threads moves the text 16 pt right (pl-6) for the disclosure and,
// on hover, reserves room for New thread, New folder and "⋯".
import SwiftUI
import UIKit
import CompanionCore

extension Chat {
    /// The bot's title (its label), as the desktop's chip shows it.
    var desktopTitle: String? {
        guard case let .bot(bot) = self else { return nil }
        let title = bot.title.trimmingCharacters(in: .whitespacesAndNewlines)
        return title.isEmpty ? nil : title
    }

    /// Waiting on the person, working, or idle (the row's dot and line).
    var desktopStatus: RosterRowStatus {
        switch self {
        case let .bot(bot): bot.rosterStatus(hasPendingCard: false)
        case let .room(room): room.busyBotId != nil ? .working : .idle
        }
    }

    /// One thread is the bot itself: the disclosure earns its place once
    /// there is a list (a second thread or a folder).
    var desktopHasThreadList: Bool {
        guard case let .bot(bot) = self else { return false }
        return (bot.tasks?.filter { !$0.isHiddenFromPerson }.count ?? 1) > 1 || !(bot.projects ?? []).isEmpty
    }
}

// MARK: - Pinned tiles

/// 95 x 115 tiles, 4 pt apart and centred (12 between lines), 12 pt under
/// the head: a 64 pt mascot, the name 12/16, the title tag 11.5/17; the
/// selected one a 16 pt card (7% ink over the rail). In the rail, one column
/// of 80 x 46 tiles with a 36 pt avatar.
struct DesktopPinnedTiles: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var model: DesktopShellModel
    let chats: [Chat]

    var body: some View {
        if chats.isEmpty {
            EmptyView()
        } else if model.density == .icons {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(chats, id: \.id) { chat in
                    DesktopPinnedTile(chat: chat, rail: true)
                }
            }
            .padding(.vertical, 6)
            .padding(.bottom, 8)
        } else {
            let count = min(chats.count, 3)
            let columns = Array(repeating: GridItem(.fixed(95), spacing: 4), count: count)
            LazyVGrid(columns: columns, spacing: 12) {
                ForEach(chats, id: \.id) { chat in
                    DesktopPinnedTile(chat: chat, rail: false)
                }
            }
            .frame(maxWidth: .infinity)
            // Chrome lays the centred grid on the next device pixel
            .offset(x: 0.5)
            // pt-3, then pb-1.5 and mb-4 before the first section
            .padding(.top, 12)
            .padding(.bottom, 22)
        }
    }
}

struct DesktopPinnedTile: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    @ObservedObject private var prefs = SidebarPrefsModel.shared
    let chat: Chat
    let rail: Bool
    @State private var hovering = false

    var body: some View {
        let selected = model.selected?.id == chat.id
        let menu = DesktopSidebarMenus(session: session, model: model, prefs: prefs).entries(for: menuKind).0
        Button { model.open(session.returning(to: chat)) } label: {
            VStack(spacing: rail ? 6 : 3) {
                ChatAvatarView(chat: chat, size: rail ? 36 : 64, state: .idle, background: theme.sidebar)
                    .frame(width: rail ? 36 : 64, height: rail ? 36 : 64)
                if !rail {
                    DesktopLineText(text: PeopleDirectory.shared.name(chat, session: session), size: 12,
                                 color: theme.sidebarInk, lineHeight: 16, centered: true)
                        .frame(width: 87, height: 16)
                    if let title = chat.desktopTitle {
                        DesktopTitleChip(text: title)
                    }
                }
            }
            .padding(.top, 6)
            .padding(.bottom, 4)
            .frame(width: rail ? 80 : 95, height: rail ? nil : 115, alignment: .top)
            .background(
                rail
                    ? (selected ? theme.sidebarSelected : (hovering ? theme.sidebarHover : .clear))
                    // the selected tile: 7% of the rail's ink over the rail
                    // (--color-sidebar-card), the hover wash at 60% on hover
                    : (selected ? theme.sidebarInk.opacity(0.07) : (hovering ? theme.sidebarHover.opacity(0.6) : .clear)),
                // rounded-2xl: the selected tile is a 16 pt card
                in: RoundedRectangle(cornerRadius: rail ? theme.radiusXl : 16, style: .continuous)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .contextMenu { DesktopMenuItems(entries: menu) }
        .onDrag { NSItemProvider(object: "bot:\(chat.id)" as NSString) }
        .sidebarBotPinSwipe(chat, session: session)
        .accessibilityLabel(Text(verbatim: PeopleDirectory.shared.name(chat, session: session)))
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("desktop-pinned.\(chat.id)")
    }

    private var menuKind: DesktopMenuRequest.Kind {
        switch chat {
        case let .bot(bot): .bot(bot.id)
        case let .room(room): .room(room.id)
        }
    }
}

/// The title under a pinned tile's name: a faint filled tag (11.5, a faint
/// outline; LabelTag size "small", rounded-[5px] px-1). Rows draw no title.
/// `BotRoleTag` (LabelTag.tsx): 11/16 in the secondary ink, px-1 py-px,
/// a 0.5 pt outline at 10 % sidebar ink on a 2.2 % fill, radius 4; it
/// shrinks to its text and truncates before the name does.
struct DesktopRoleTag: View {
    @Environment(\.desktopTheme) private var theme
    let text: String

    var body: some View {
        DesktopLineText(text: text, size: 11, color: theme.sidebarInkSecondary, lineHeight: 16, tracking: 0.055)
            .padding(.horizontal, 4)
            .padding(.vertical, 1)
            .background(theme.sidebarInk.opacity(0.022), in: RoundedRectangle(cornerRadius: 4, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).strokeBorder(theme.sidebarInk.opacity(0.1), lineWidth: 0.5))
            .fixedSize(horizontal: false, vertical: true)
            .layoutPriority(1)
            .accessibilityHidden(true)
    }
}

struct DesktopTitleChip: View {
    @Environment(\.desktopTheme) private var theme
    let text: String
    var size: CGFloat = 11.5
    var maxWidth: CGFloat = 87
    var alignment: Alignment = .center

    var body: some View {
        DesktopLineText(text: text, size: size, color: theme.sidebarInkSecondary, lineHeight: 17)
            // px-1 inside the 1 pt outline, 19 tall
            .padding(.horizontal, 5)
            .frame(height: 19)
            .background(theme.sidebarInk.opacity(0.02), in: RoundedRectangle(cornerRadius: 5, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 5, style: .continuous).strokeBorder(theme.sidebarInk.opacity(0.055), lineWidth: 1))
            .frame(maxWidth: maxWidth, alignment: alignment)
            .fixedSize(horizontal: false, vertical: true)
    }
}

// MARK: - Row and its threads

/// A row, then (Show threads on, open) its thread list.
struct DesktopSidebarRowGroup: View {
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    @ObservedObject private var prefs = SidebarPrefsModel.shared
    let chat: Chat
    let preview: String
    let sectionId: String

    var body: some View {
        let threads = DesktopSidebarState.showThreads(model: model, prefs: prefs)
        let open = threads && model.density != .icons && chat.desktopHasThreadList && model.openThreadLists.contains(chat.id)
        VStack(alignment: .leading, spacing: 2) {
            AnyView(DesktopSidebarRow(chat: chat, preview: preview, showThreads: threads, threadsOpen: open))
            if open, case let .bot(bot) = chat {
                AnyView(DesktopThreadList(botId: bot.id))
            }
        }
    }
}

struct DesktopSidebarRow: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    @ObservedObject private var prefs = SidebarPrefsModel.shared
    let chat: Chat
    let preview: String
    let showThreads: Bool
    let threadsOpen: Bool

    private var density: DesktopSidebarDensity { model.density }
    private var isRoom: Bool { if case .room = chat { true } else { false } }
    /// Electron `touch:` / `pointer: coarse` shows ⋯. iPad has no hover;
    /// Mac (Designed for iPad) keeps hover-only.
    private var showsTouchRowActions: Bool {
        UIDevice.current.userInterfaceIdiom == .pad && !ProcessInfo.processInfo.isiOSAppOnMac
    }

    var body: some View {
        let selected = model.selected?.id == chat.id
        let hovered = model.hoveredRow == chat.id
        let menu = DesktopSidebarMenus(session: session, model: model, prefs: prefs).entries(for: menuKind).0
        return ZStack(alignment: .leading) {
            Button { open() } label: {
                content(selected: selected, hovered: hovered)
            }
            .buttonStyle(.plain)
            // the drag on the view that owns the context menu, so a long
            // press that moves lifts the row (iPadOS hands the menu's preview
            // to the drag)
            .contextMenu { DesktopMenuItems(entries: menu) }
            .onDrag { NSItemProvider(object: (isRoom ? "room:\(chat.id)" : "bot:\(chat.id)") as NSString) }
            .sidebarBotPinSwipe(chat, session: session)
            .accessibilityAddTraits(selected ? .isSelected : [])
            .accessibilityIdentifier("desktop-row.\(chat.id)")
            if density != .icons {
                if showThreads, chat.desktopHasThreadList { disclosure }
                if hovered || showsTouchRowActions, !menu.isEmpty { hoverActions(menu: menu) }
            }
        }
        // Unfolded, the selected thread below carries the one highlight
        // (the web's Sidebar.tsx rule): no second stacked block on the bot.
        .background(
            selected && !(showThreads && threadsOpen) ? theme.sidebarSelected : (hovered ? theme.sidebarHover : .clear),
            in: RoundedRectangle(cornerRadius: theme.radiusLg, style: .continuous)
        )
        .onHover { inside in
            if inside { model.hoveredRow = chat.id } else if model.hoveredRow == chat.id { model.hoveredRow = nil }
        }
    }

    private var menuKind: DesktopMenuRequest.Kind {
        switch chat {
        case let .bot(bot): .bot(bot.id)
        case let .room(room): .room(room.id)
        }
    }

    private func open() {
        model.open(session.returning(to: chat))
    }

    // MARK: Content

    @ViewBuilder
    private func content(selected: Bool, hovered: Bool) -> some View {
        switch density {
        case .icons:
            iconsContent
        case .compact, .comfortable:
            textContent(selected: selected, hovered: hovered)
        }
    }

    private var iconsContent: some View {
        avatar(size: 36)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity)
            .overlay(alignment: .bottomTrailing) {
                if chat.unread, !chat.busy {
                    Circle().fill(theme.accent)
                        .overlay(Circle().strokeBorder(theme.panel, lineWidth: 1))
                        .frame(width: 8, height: 8)
                        .padding(6)
                }
            }
            .contentShape(Rectangle())
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: accessibilityName))
    }

    private func textContent(selected: Bool, hovered: Bool) -> some View {
        let compact = density == .compact
        // comfortable: the reference window's 44 pt portrait at x 4 (pl-1),
        // 6 pt before the name, rows 56 tall (py-1.5)
        let avatarSize: CGFloat = compact ? 28 : 44
        let leading: CGFloat = showThreads ? 24 : (compact ? 8 : 4)
        // pr-9, or pr-[5.75rem] with the thread controls on hover; a group
        // row keeps pr-2
        let trailing: CGFloat = isRoom ? 8 : (showThreads && hovered ? 92 : 36)
        let status = chat.desktopStatus
        let unread = chat.unread && !chat.busy
        let quietStatus = status != .idle
        // compact with Show threads: gap-1.5 py-1
        return HStack(spacing: compact && !showThreads ? 8 : 6) {
            avatar(size: avatarSize)
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 6) {
                    if case let .bot(bot) = chat, bot.pinned == true {
                        DesktopIconView(icon: .pin, size: 12)
                            .foregroundStyle(theme.sidebarInkSecondary)
                    }
                    DesktopLineText(text: PeopleDirectory.shared.name(chat, session: session), size: 14,
                                 weight: .medium, color: theme.sidebarInk, lineHeight: 20)
                        .layoutPriority(2)
                    // BotRoleTag: the bot's role beside its name, 6 pt after it
                    if let title = chat.desktopTitle, !title.isEmpty {
                        DesktopRoleTag(text: title)
                    }
                    Spacer(minLength: 0)
                    if selected, !threadsOpen, !hovered, let time = lastTime {
                        Text(verbatim: time)
                            .font(theme.font(12))
                            .foregroundStyle(theme.sidebarInkSecondary)
                    }
                    if unread, threadsOpen || (compact && !quietStatus) {
                        Circle().fill(theme.accent).frame(width: 6, height: 6)
                    }
                }
                .frame(height: 20)
                if !threadsOpen, !compact || quietStatus {
                    HStack(spacing: 0) {
                        statusLine(status)
                        Spacer(minLength: 0)
                        if unread {
                            Circle().fill(theme.accent).frame(width: 8, height: 8)
                                .padding(.leading, 8)
                                .accessibilityLabel(Text("Unread"))
                        }
                    }
                    .frame(height: 18)
                }
            }
        }
        .padding(.leading, leading)
        .padding(.trailing, trailing)
        .padding(.vertical, compact ? (showThreads ? 4 : 6) : 6)
        .frame(maxWidth: .infinity, minHeight: compact ? (showThreads ? 36 : 40) : 56, alignment: .leading)
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private func statusLine(_ status: RosterRowStatus) -> some View {
        switch status {
        case .waitingOnYou:
            DesktopLineText(text: String(localized: "Waiting on you"), size: 13, color: theme.sidebarInkSecondary, lineHeight: 18)
        case .working:
            DesktopWorkingDots()
                .accessibilityLabel(Text("Working"))
        case .idle:
            DesktopLineText(text: preview, size: 13, color: theme.sidebarInkSecondary, lineHeight: 18)
        }
    }

    /// `max-w-[46%]` of the name line.
    private var lastTime: String? {
        guard let at = session.state.visibleTranscript(forThread: chat.threadId).last?.at, at > 0 else { return nil }
        return Date(timeIntervalSince1970: at / 1000).formatted(date: .omitted, time: .shortened)
    }

    private var accessibilityName: String {
        var name = PeopleDirectory.shared.name(chat, session: session)
        // the role tag is read out with the name
        if let title = chat.desktopTitle { name += ", " + title }
        if let sharer { name += ", " + String(localized: "Shared by \(sharer.name)") }
        if case let .room(room) = chat, let presence = PeopleDirectory.shared.presence(of: room, session: session) {
            name += ", " + PresenceDot.words(presence)
        }
        if chat.unread { name += ", " + String(localized: "Unread") }
        return name
    }

    @ViewBuilder
    private func avatar(size: CGFloat) -> some View {
        let status = chat.desktopStatus
        Group {
            if case let .room(room) = chat, PeopleDirectory.shared.peer(room, session: session) == nil {
                DesktopStackedMauses(members: room.memberIds.compactMap { session.state.bot($0) }, density: density)
            } else {
                ChatAvatarView(chat: chat, size: size, state: MausState.forChat(chat, in: session.state), background: theme.sidebar)
                    .frame(width: size, height: size)
            }
        }
        // #985: a bot shared with the viewer wears its sharer's face at the
        // bottom right, and its activity dot moves to the top right
        .overlay(alignment: .bottomTrailing) {
            if let sharer {
                SharerBadge(sharer: sharer, avatarSize: size, ring: theme.sidebar)
            }
        }
        .overlay(alignment: sharer == nil ? .bottomTrailing : .topTrailing) {
            if status != .idle {
                // presence dot: green while working, amber while waiting
                Circle()
                    .fill(status == .working ? theme.success : theme.warning)
                    .frame(width: density == .icons ? 12 : 10, height: density == .icons ? 12 : 10)
                    .overlay(Circle().strokeBorder(theme.sidebar, lineWidth: 2))
                    .offset(x: 2, y: sharer == nil ? 2 : -2)
            }
        }
    }

    private var sharer: BotSharer? {
        guard case let .bot(bot) = chat else { return nil }
        return PeopleDirectory.shared.sharer(of: bot, session: session)
    }

    // MARK: Hover controls

    /// The disclosure at x 2 (left-0.5), 20 pt, a 13 pt chevron.
    private var disclosure: some View {
        Button {
            withAnimation(.snappy(duration: 0.2)) {
                if model.openThreadLists.contains(chat.id) { model.openThreadLists.remove(chat.id) } else { model.openThreadLists.insert(chat.id) }
            }
        } label: {
            DesktopIconView(icon: .chevronRight, size: 13)
                .rotationEffect(.degrees(threadsOpen ? 90 : 0))
                .foregroundStyle(theme.inkSecondary)
                .frame(width: 20, height: 20)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.leading, 2)
        .accessibilityLabel(Text(threadsOpen ? "Collapse \(name)" : "Expand \(name)"))
        .accessibilityIdentifier("desktop-row-threads.\(chat.id)")
    }

    private var name: String { PeopleDirectory.shared.name(chat, session: session) }

    /// New thread, New folder (Show threads on) and "⋯", 28 pt each, on hover.
    private func hoverActions(menu: [DesktopMenuEntry]) -> some View {
        HStack(spacing: 0) {
            Spacer(minLength: 0)
            if showThreads, case let .bot(bot) = chat {
                hoverButton(.plus, label: "New thread", id: "new-thread") {
                    Task {
                        if let created = await session.createRosterThread(for: bot) {
                            model.openThreadLists.insert(bot.id)
                            model.open(.bot(created))
                        }
                    }
                }
                if session.surfaceGate.allows(.threadFolders, bot: bot) {
                    hoverButton(.folderPlus, label: "New folder", id: "new-folder") {
                        model.openThreadLists.insert(bot.id)
                        model.threadActions.newFolder(for: bot)
                    }
                }
            }
            GeometryReader { geometry in
                hoverButton(.ellipsis, label: "Actions for \(name)", id: "actions", size: 15) {
                    let frame = geometry.frame(in: .named(desktopShellSpace))
                    model.menu = DesktopMenuRequest(kind: menuKind, anchor: CGPoint(x: frame.minX, y: frame.maxY))
                }
            }
            .frame(width: 28, height: 28)
        }
        .padding(.trailing, 4)
    }

    private func hoverButton(_ icon: DesktopIcon, label: LocalizedStringKey, id: String, size: CGFloat = 14, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            DesktopIconView(icon: icon, size: size)
                .foregroundStyle(theme.inkSecondary)
                .frame(width: 28, height: 28)
                .contentShape(Rectangle())
        }
        .buttonStyle(DesktopHoverSquareStyle())
        .accessibilityLabel(Text(label))
        .accessibilityIdentifier("desktop-row-\(id).\(chat.id)")
    }
}

/// `hover:bg-raised` on a row's small buttons.
struct DesktopHoverSquareStyle: ButtonStyle {
    @Environment(\.desktopTheme) private var theme
    @State private var hovering = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background((hovering || configuration.isPressed) ? theme.raised : .clear, in: RoundedRectangle(cornerRadius: 4, style: .continuous))
            .onHover { hovering = $0 }
    }
}

/// The three typing dots of a working row (`WorkingDots size 3.5`).
struct DesktopWorkingDots: View {
    @Environment(\.desktopTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var visible = false

    var body: some View {
        // Three steps a second (it woke five times a second), paused off
        // screen, in the background and under Reduce Motion, where the
        // first dot stays lit.
        let moving = visible && !reduceMotion && scenePhase == .active
        TimelineView(.animation(minimumInterval: 1.0 / 3, paused: !moving)) { context in
            let phase = moving ? Int(context.date.timeIntervalSinceReferenceDate * 3) % 3 : 0
            HStack(spacing: 3) {
                ForEach(0..<3, id: \.self) { index in
                    Circle()
                        .fill(theme.sidebarInkSecondary)
                        .frame(width: 3.5, height: 3.5)
                        .opacity(index == phase ? 1 : 0.4)
                }
            }
        }
        .frame(height: 18)
        .onAppear { visible = true }
        .onDisappear { visible = false }
    }
}

/// A group's member stack (`StackedMauses`): one face, or up to three
/// overlapping faces in the row's avatar footprint (comfortable 36 with
/// faces 20, compact 28 with 16, icons 40 with 22).
struct DesktopStackedMauses: View {
    let members: [Bot]
    let density: DesktopSidebarDensity

    var body: some View {
        let slot: CGFloat = density == .icons ? 40 : (density == .compact ? 28 : 44)
        let face: CGFloat = density == .icons ? 22 : (density == .compact ? 16 : 24)
        let single: CGFloat = density == .icons ? 44 : (density == .compact ? 28 : 44)
        ZStack(alignment: .topLeading) {
            if members.count <= 1 {
                if let bot = members.first {
                    BotMascotView(bot: bot, size: single, state: .happy, animated: false, sidebarTapReact: true)
                        .frame(width: slot, height: slot)
                }
            } else {
                let shown = Array(members.prefix(3))
                // the faces' positions in the DOM dumps (03, 04, 05)
                let three: [CGPoint] = density == .icons
                    ? [CGPoint(x: 0, y: 0), CGPoint(x: 0, y: 11), CGPoint(x: 18, y: 11)]
                    : density == .compact
                        ? [CGPoint(x: 0, y: 1), CGPoint(x: 0, y: 5), CGPoint(x: 12, y: 5)]
                        : [CGPoint(x: 0, y: 0), CGPoint(x: 0, y: 9), CGPoint(x: 16, y: 9)]
                let spots: [CGPoint] = shown.count == 2
                    ? [CGPoint(x: 0, y: 2), CGPoint(x: slot - face, y: slot - face)]
                    : three
                ForEach(Array(shown.enumerated()), id: \.offset) { index, bot in
                    BotMascotView(bot: bot, size: face, state: .idle, animated: false, sidebarTapReact: true)
                        .frame(width: face, height: face)
                        .offset(x: spots[index].x, y: spots[index].y)
                }
            }
        }
        .frame(width: slot, height: slot, alignment: .topLeading)
    }
}

// MARK: - Threads

/// The thread tree under an open bot (`BotThreadList`): unfiled threads,
/// then each folder with its threads; 32 pt rows (28 compact), 13 medium,
/// the current one semibold on the selected fill. The thread and folder
/// menus are WP5's.
struct DesktopThreadList: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    let botId: String

    var body: some View {
        if let bot = session.state.bot(botId) {
            let groups = bot.threadGroups(queuedThreadIds: session.state.queuedThreadIds, includingEmptyFolders: true)
            VStack(alignment: .leading, spacing: 2) {
                ForEach(groups) { group in
                    if let folder = group.project {
                        folderRow(folder, bot: bot, count: group.tasks.count)
                        if !model.foldedFolders.contains("\(bot.id):\(folder.id)") {
                            ForEach(group.tasks, id: \.threadId) { task in
                                DesktopThreadRow(task: task, bot: bot, indent: 12)
                            }
                        }
                    } else {
                        ForEach(group.tasks, id: \.threadId) { task in
                            DesktopThreadRow(task: task, bot: bot, indent: 0)
                        }
                    }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("desktop-threads.\(bot.id)")
        }
    }

    private func folderRow(_ folder: BotProject, bot: Bot, count: Int) -> some View {
        let key = "\(bot.id):\(folder.id)"
        let folded = model.foldedFolders.contains(key)
        return Button {
            withAnimation(.snappy(duration: 0.2)) {
                if folded { model.foldedFolders.remove(key) } else { model.foldedFolders.insert(key) }
            }
        } label: {
            HStack(spacing: 6) {
                DesktopIconView(icon: .chevronRight, size: 12)
                    .rotationEffect(.degrees(folded ? 0 : 90))
                if let emoji = folder.emoji, !emoji.isEmpty {
                    Text(verbatim: emoji).font(.system(size: 12))
                } else {
                    DesktopIconView(icon: .folderInput, size: 13)
                }
                Text(verbatim: folder.name)
                    .font(theme.font(13, .medium))
                    .lineLimit(1)
                Text(verbatim: "\(count)")
                    .font(theme.font(11))
                    .opacity(0.7)
                Spacer(minLength: 0)
            }
            .foregroundStyle(theme.sidebarInkSecondary)
            .padding(.leading, 24)
            .padding(.trailing, 8)
            .frame(height: 30)
            .contentShape(Rectangle())
        }
        .buttonStyle(DesktopSidebarRowButtonStyle())
        .folderMenu(folder, of: bot, actions: model.threadActions, session: session)
        .accessibilityIdentifier("desktop-folder.\(bot.id).\(folder.id)")
    }
}

struct DesktopThreadRow: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    let task: BotTask
    let bot: Bot
    let indent: CGFloat
    @State private var hovering = false

    var body: some View {
        let current = model.selected?.threadId == task.threadId
        let compact = model.density == .compact
        let actions = model.threadActions
        return HStack(spacing: 0) {
            Button {
                if let projected = bot.projected(forThread: task.threadId) { model.open(.bot(projected)) }
            } label: {
                HStack(spacing: 8) {
                    Text(verbatim: task.displayTitle)
                        .font(theme.font(13, current || task.unread == true ? .semibold : .medium))
                        .foregroundStyle(current || task.unread == true ? theme.sidebarInk : theme.sidebarInkSecondary)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    if task.isConfidential {
                        ConfidentialMark(showsLabel: !compact)
                    }
                    if task.pinned == true {
                        DesktopIconView(icon: .pin, size: 11).foregroundStyle(theme.sidebarInkSecondary)
                    }
                    if task.activity == "waiting-on-you" {
                        Text("Waiting").font(theme.font(10, .medium)).foregroundStyle(theme.warning)
                    } else if task.isWorking {
                        let selection = task.modelSelection ?? bot.modelSelection
                        if UltracodeEffort.isUltracode(selection.effort) {
                            Circle()
                                .fill(Color(red: 0.49, green: 0.23, blue: 0.93))
                                .frame(width: 8, height: 8)
                                .accessibilityLabel(Text("Ultracode"))
                        } else {
                            ProgressView().controlSize(.mini).tint(theme.success)
                        }
                    }
                    if task.unread == true {
                        Circle().fill(theme.accent).frame(width: 6, height: 6)
                    }
                }
                .padding(.leading, 24 + indent)
                .padding(.trailing, 4)
                .frame(minHeight: compact ? 28 : 32)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Menu {
                ThreadMenu(
                    task: task,
                    plan: actions.plan(for: task, owner: .bot(bot), in: session),
                    folders: bot.folders,
                    regenerating: actions.regenerating.contains(task.threadId)
                ) { action in
                    actions.perform(action, on: ThreadTarget(task: task, owner: actions.liveOwner(.bot(bot), in: session)), session: session)
                }
            } label: {
                DesktopIconView(icon: .ellipsis, size: 14)
                    .foregroundStyle(theme.sidebarInkSecondary)
                    .frame(width: 24, height: 24)
                    .contentShape(Rectangle())
            }
            .opacity(hovering ? 1 : 0)
            .padding(.trailing, 2)
            .accessibilityLabel(Text("Thread actions"))
            .accessibilityIdentifier("desktop-thread-actions.\(task.threadId)")
        }
        .background(
            current ? theme.sidebarSelected : (hovering ? theme.sidebarHover : .clear),
            in: RoundedRectangle(cornerRadius: theme.radiusLg, style: .continuous)
        )
        .onHover { hovering = $0 }
        .threadMenu(task, owner: .bot(bot), actions: actions, session: session)
        .accessibilityIdentifier("desktop-thread.\(task.threadId)")
    }
}
