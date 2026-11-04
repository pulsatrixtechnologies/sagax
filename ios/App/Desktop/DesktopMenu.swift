// iPad I2: the desktop sidebar's menus. One list of entries per menu (a bot
// row's Actions, a room row, a section header, the account, New), drawn two
// ways: as the desktop's own popover (`BotContextMenu`, `TeamMenuItems`,
// `SidebarProfileMenu` in Sidebar.tsx: 228 wide, radius 12, the elevated
// fill, 30 pt rows of 13/18 with a 16 pt icon) when a pointer clicks a row's
// "⋯", the account row or New; and as iPadOS's context menu for a long press
// or a right click, with the same entries in the same order.
//
// The entries reuse the phone's feature logic: the WP5 thread and folder
// actions (`ThreadActions`), the WP6 sidebar preferences and section prompts
// (`SidebarPrefsModel`, `SidebarSectionActions`), the WP11 room prompts
// (`RoomActions`) and the session's pin, profile and section calls. What the
// pairing may not do is left out (`SurfaceGate`), never drawn disabled.
import SwiftUI
import UIKit
import CompanionCore

// MARK: - Entries

struct DesktopMenuEntry: Identifiable {
    enum Kind {
        case action(@MainActor () -> Void)
        case submenu([DesktopMenuEntry])
        case divider
    }

    var id: String
    var title: String = ""
    var icon: DesktopIcon?
    var danger = false
    var disabled = false
    /// A keycap hint at the trailing edge ("⌘ /").
    var shortcut: String?
    var kind: Kind

    static func divider(_ id: String) -> DesktopMenuEntry { DesktopMenuEntry(id: "divider.\(id)", kind: .divider) }

    var isDivider: Bool {
        if case .divider = kind { return true }
        return false
    }
}

/// What the shell's popover shows and where (shell coordinates).
struct DesktopMenuRequest: Equatable {
    enum Kind: Equatable {
        case bot(String)
        case room(String)
        case section(String)
        case profile
        case new
    }

    var kind: Kind
    /// The menu's top-left (a row's "⋯": its bottom-left; a right click:
    /// the pointer), or its bottom-left when `opensUp`.
    var anchor: CGPoint
    var opensUp = false
}

/// The desktop popover's metrics, by menu (the DOM dumps 08, 10 and 11).
enum DesktopMenuStyle {
    case standard, section, profile, new

    var width: CGFloat {
        switch self {
        case .standard: 228
        case .section: 220
        case .profile: 228 // min-w-[228px] (SidebarProfileMenu.tsx), measured on 11
        case .new: 240
        }
    }

    var rowHeight: CGFloat { self == .profile ? 32 : 30 }
    var iconSize: CGFloat {
        switch self {
        case .profile: 18
        case .section: 14
        default: 16
        }
    }

    /// A divider's own height: `mx-2 my-1 h-[0.5px]` between entries; the
    /// account menu draws it inside the next item's block, one 2 pt gap less.
    var dividerHeight: CGFloat { self == .profile ? 6.5 : 8.5 }
    /// The icon's box (`size-5` in the account menu).
    var iconBox: CGFloat { self == .profile ? 20 : iconSize }

    /// The popover's height for `entries`: 6 pt padding and a 1 pt border
    /// each side, 2 pt between entries, a divider 8.5 pt.
    func height(_ entries: [DesktopMenuEntry]) -> CGFloat {
        let body = entries.reduce(CGFloat(0)) { $0 + ($1.isDivider ? dividerHeight : rowHeight) }
        return body + CGFloat(max(0, entries.count - 1)) * 2 + 14
    }
}

// MARK: - Popover

/// The desktop's menu panel.
struct DesktopMenuPanel: View {
    @Environment(\.desktopTheme) private var theme
    let entries: [DesktopMenuEntry]
    let style: DesktopMenuStyle
    let dismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(entries) { entry in
                row(entry)
            }
        }
        // p-1.5 inside the 1 pt border
        .padding(7)
        .frame(width: style.width, alignment: .leading)
        .background(theme.elevated, in: RoundedRectangle(cornerRadius: max(theme.radiusXl, 0), style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: max(theme.radiusXl, 0), style: .continuous)
                .strokeBorder(theme.border, lineWidth: 1)
        )
        .shadow(color: .black.opacity(theme.dark ? 0.45 : 0.16), radius: 16, y: 8)
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
        .accessibilityIdentifier("desktop-menu")
    }

    @ViewBuilder
    private func row(_ entry: DesktopMenuEntry) -> some View {
        switch entry.kind {
        case .divider:
            // my-1 around the line; the account menu's sits in the next
            // item's block (one gap less below it)
            Rectangle().fill(theme.border).frame(height: 0.5)
                .padding(.horizontal, 8)
                .padding(.top, 4)
                .padding(.bottom, style.dividerHeight - 4.5)
        case let .action(perform):
            Button {
                dismiss()
                perform()
            } label: {
                label(entry, chevron: false)
            }
            .buttonStyle(DesktopMenuRowStyle(radius: 6))
            .disabled(entry.disabled)
            .accessibilityIdentifier("desktop-menu.\(entry.id)")
        case let .submenu(children):
            Menu {
                DesktopMenuItems(entries: children, after: dismiss)
            } label: {
                label(entry, chevron: true)
            }
            .buttonStyle(DesktopMenuRowStyle(radius: 6))
            .disabled(entry.disabled || children.isEmpty)
            .accessibilityIdentifier("desktop-menu.\(entry.id)")
        }
    }

    private func label(_ entry: DesktopMenuEntry, chevron: Bool) -> some View {
        let tint = entry.danger ? theme.danger : theme.ink
        return HStack(spacing: 8) {
            if let icon = entry.icon {
                DesktopIconView(icon: icon, size: style.iconSize)
                    .frame(width: style.iconBox, height: style.iconBox)
            }
            DesktopLineText(text: entry.title, size: 13, color: tint, lineHeight: 18)
            Spacer(minLength: 0)
            if let shortcut = entry.shortcut {
                DesktopLineText(text: shortcut, size: 11, color: theme.inkSecondary, lineHeight: 11)
                    .padding(.horizontal, 6)
                    .frame(height: 17)
                    .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
            }
            if chevron {
                DesktopIconView(icon: .chevronRight, size: 14)
                    .foregroundStyle(theme.inkSecondary)
            }
        }
        .foregroundStyle(tint)
        .padding(.horizontal, 8)
        .frame(height: style.rowHeight)
        .frame(maxWidth: .infinity, alignment: .leading)
        .opacity(entry.disabled ? 0.4 : 1)
        .contentShape(Rectangle())
    }
}

/// `hover:bg-hover` on a menu row.
struct DesktopMenuRowStyle: ButtonStyle {
    @Environment(\.desktopTheme) private var theme
    var radius: CGFloat
    @State private var hovering = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                (hovering || configuration.isPressed) ? theme.hover : .clear,
                in: RoundedRectangle(cornerRadius: radius, style: .continuous)
            )
            .onHover { hovering = $0 }
    }
}

/// The same entries as a system menu (a context menu or a submenu).
struct DesktopMenuItems: View {
    let entries: [DesktopMenuEntry]
    var after: () -> Void = {}

    var body: some View {
        ForEach(entries) { entry in
            switch entry.kind {
            case .divider:
                Divider()
            case let .action(perform):
                Button(role: entry.danger ? .destructive : nil) {
                    after()
                    perform()
                } label: {
                    if let icon = entry.icon {
                        Label(entry.title, systemImage: icon.symbol)
                    } else {
                        Text(verbatim: entry.title)
                    }
                }
                .disabled(entry.disabled)
            case let .submenu(children):
                Menu {
                    DesktopMenuItems(entries: children, after: after)
                } label: {
                    if let icon = entry.icon {
                        Label(entry.title, systemImage: icon.symbol)
                    } else {
                        Text(verbatim: entry.title)
                    }
                }
                .disabled(entry.disabled || children.isEmpty)
            }
        }
    }
}

/// The shell's layer for the open popover: a tap outside closes it.
struct DesktopMenuLayer: View {
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    @ObservedObject private var prefs = SidebarPrefsModel.shared

    var body: some View {
        GeometryReader { geometry in
            if model.menu?.kind == .new {
                // New is the inline "To:" picker over the main column
                let left = model.sidebarWidth
                let right = model.panelOpen && model.panelDocked && model.selected.map({ if case .bot = $0 { true } else { false } }) == true
                    ? model.panelWidth : 0
                AnyView(DesktopComposePicker(width: max(0, geometry.size.width - left - right), height: geometry.size.height))
                    .offset(x: left)
            } else if let request = model.menu {
                let menus = DesktopSidebarMenus(session: session, model: model, prefs: prefs)
                let (entries, style) = menus.entries(for: request.kind)
                if !entries.isEmpty {
                    let size = CGSize(width: style.width, height: style.height(entries))
                    let origin = Self.origin(request, size: size, in: geometry.size)
                    ZStack(alignment: .topLeading) {
                        Color.black.opacity(0.001)
                            .contentShape(Rectangle())
                            .onTapGesture { model.menu = nil }
                            .accessibilityHidden(true)
                        DesktopMenuPanel(entries: entries, style: style) { model.menu = nil }
                            .offset(x: origin.x, y: origin.y)
                        // Esc closes it, as on the desktop
                        Button("") { model.menu = nil }
                            .keyboardShortcut(.cancelAction)
                            .opacity(0)
                            .accessibilityHidden(true)
                    }
                }
            }
        }
        .ignoresSafeArea()
    }

    /// Kept 8 pt inside the window, as `BotContextMenu` clamps it.
    static func origin(_ request: DesktopMenuRequest, size: CGSize, in bounds: CGSize) -> CGPoint {
        let y = request.opensUp ? request.anchor.y - size.height : request.anchor.y
        return CGPoint(
            x: max(8, min(request.anchor.x, bounds.width - size.width - 8)),
            y: max(8, min(y, bounds.height - size.height - 8))
        )
    }
}

// MARK: - The menus

/// The entries of every sidebar menu, from the session and the gate.
@MainActor
struct DesktopSidebarMenus {
    let session: Session
    let model: DesktopShellModel
    let prefs: SidebarPrefsModel

    private var gate: SurfaceGate { session.surfaceGate }

    func entries(for kind: DesktopMenuRequest.Kind) -> ([DesktopMenuEntry], DesktopMenuStyle) {
        switch kind {
        case let .bot(id):
            guard let bot = session.state.bot(id) else { return ([], .standard) }
            return (self.bot(bot), .standard)
        case let .room(id):
            guard let room = session.state.rooms.first(where: { $0.id == id }) else { return ([], .standard) }
            return (self.room(room), .standard)
        case let .section(id):
            return (section(id), .section)
        case .profile:
            return (profile(), .profile)
        case .new:
            return (new(), .new)
        }
    }

    // MARK: Bot row (BotContextMenu)

    func bot(_ bot: Bot) -> [DesktopMenuEntry] {
        var out: [DesktopMenuEntry] = []
        // New thread and New folder left the bot row (#182): they live in
        // the thread list, the chat header's or the sidebar tree's.
        // "Put on the desktop" floats the bot in its own window
        // (DesktopFloatingBots: an iPadOS scene Stage Manager floats).
        let copyId = DesktopMenuEntry(id: "copy-id", title: String(localized: "Copy conversation ID"), icon: .clipboardCopy, kind: .action {
            model.threadActions.copyConversationId(bot)
        })
        // BotContextMenu.tsx (2026-11-03 reference): New topic (threads
        // off), Pin, Move to ›, Select, then Rename the bot, Edit bot, Share, Make
        // primary bot, then Hide from sidebar, Archive, Delete.
        // New thread (threads on) or New topic comes first, then a line
        // (`divider("d-new")`)
        if DesktopSidebarState.threadsOn(model: model, prefs: prefs) {
            out.append(DesktopMenuEntry(id: "new-thread", title: String(localized: "New thread"), icon: .plus, kind: .action {
                Task {
                    if let created = await session.createRosterThread(for: bot) { model.open(.bot(created)) }
                }
            }))
        } else {
            out.append(DesktopMenuEntry(id: "new-topic", title: String(localized: "New topic"), icon: .plus, kind: .action {
                model.open(session.returning(to: .bot(bot)))
                session.startNewTopic(bot)
            }))
        }
        if gate.scope != .sidecar { out.append(.divider("d-new")) }
        out.append(pinBot(bot))
        if gate.scope == .sidecar {
            // Sidecar keeps Pin (the reference design). Electron remoteClient omits it.
            if let move = moveBot(bot) { out.append(move) }
            out.append(DesktopMenuEntry(id: "edit-profile", title: String(localized: "Edit profile"), icon: .pencil, kind: .action {
                model.open(.bot(bot))
                model.panelOpen = true
            }))
            out.append(copyId)
            return out
        }
        if let move = moveBot(bot) { out.append(move) }
        // sidebar.select.start: the multi-select starts with this bot
        out.append(DesktopMenuEntry(id: "select", title: String(localized: "Select"), icon: .listChecks, kind: .action {
            model.selection.start(with: bot.id)
        }))
        out.append(.divider("d1"))
        out.append(DesktopMenuEntry(id: "rename", title: String(localized: "Rename the bot"), icon: .pencil, kind: .action {
            model.renameDraft = bot.name
            model.renamingBot = bot
        }))
        if gate.allows(.botOwnerExtras, bot: bot) {
            out.append(DesktopMenuEntry(id: "edit-bot", title: String(localized: "Edit bot"), icon: .squarePen, kind: .action {
                model.open(session.returning(to: .bot(bot)))
                model.showPersona()
            }))
        }
        out.append(DesktopMenuEntry(id: "share", title: String(localized: "Share"), icon: .share, kind: .action {
            model.sharingBotLink = URL(string: "sagax://bot/\(bot.id)")
        }))
        out += primaryEntries(bot)
        let floating = DesktopFloatingBots.shared.isFloating(bot.id)
        out.append(DesktopMenuEntry(
            id: floating ? "remove-from-desktop" : "put-on-desktop",
            title: floating ? String(localized: "Remove from the desktop") : String(localized: "Put on the desktop"),
            icon: .pictureInPicture,
            kind: .action { DesktopFloatingBots.shared.toggle(bot.id, model: model, session: session) }
        ))
        out.append(.divider("d2"))
        out.append(DesktopMenuEntry(id: "hide", title: String(localized: "Hide from sidebar"), icon: .eyeOff, kind: .action {
            prefs.hide(session, .bot, bot.id)
        }))
        if gate.allows(.botOwnerExtras, bot: bot) {
            let block = DesktopBotArchive.block(bot, in: session.state.bots)
            out.append(DesktopMenuEntry(id: "archive", title: String(localized: "Archive"), icon: .archive, disabled: block != nil, kind: .action {
                model.archivingBot = bot
            }))
            out.append(DesktopMenuEntry(id: "delete", title: String(localized: "Delete"), icon: .trash, danger: true, kind: .action {
                model.deletingBot = bot
            }))
        }
        return out
    }

    /// The Primary Bot (one per person): its own menu hands the role to
    /// another of the viewer's bots, the viewer's other bots take it.
    private func primaryEntries(_ bot: Bot) -> [DesktopMenuEntry] {
        switch PrimaryBotRules.menuAction(for: bot, viewerId: DesktopSidebarFlags.shared.viewerId) {
        case .make:
            return [DesktopMenuEntry(id: "make-primary", title: String(localized: "Make primary bot"), icon: .star, kind: .action {
                Task { await PrimaryBotActions.make(bot.id, session: session, done: { _ in }, working: .constant(false)) }
            })]
        case .replace:
            return [DesktopMenuEntry(id: "replace-primary", title: String(localized: "Replace with different Bot"), icon: .arrowLeftRight, kind: .action {
                model.replacingPrimary = bot
            })]
        case nil:
            return []
        }
    }

    private func pinBot(_ bot: Bot) -> DesktopMenuEntry {
        DesktopMenuEntry(
            id: "pin", title: bot.pinned == true ? String(localized: "Unpin") : String(localized: "Pin"),
            icon: bot.pinned == true ? .pinOff : .pin,
            kind: .action { Task { await session.setPinned(bot, pinned: bot.pinned != true) } }
        )
    }

    /// "Move to": the person's own sections on an organization server, the
    /// server's teams for a pairing that may file bots.
    private func moveBot(_ bot: Bot) -> DesktopMenuEntry? {
        let layout = prefs.layout(session)
        let title = String(localized: "Move to")
        if layout.personal {
            let key = PersonalSections.itemKey(bot: bot.id)
            let current = (prefs.personal ?? .empty).section(of: key)
            var children = layout.sectionNames.filter { $0 != current }.map { name in
                DesktopMenuEntry(id: "move.\(name)", title: name, kind: .action {
                    model.sectionActions.error = prefs.assignPersonal(session, key: key, to: name)
                })
            }
            if current != nil {
                children.append(DesktopMenuEntry(id: "move.general", title: String(localized: "Move to Unassigned"), icon: .folderInput, kind: .action {
                    model.sectionActions.error = prefs.assignPersonal(session, key: key, to: "")
                }))
            }
            children.append(DesktopMenuEntry(id: "move.new", title: String(localized: "New section…"), icon: .folderPlus, kind: .action {
                model.sectionActions.startNew(assigning: key)
            }))
            return DesktopMenuEntry(id: "move", title: title, icon: .folderPlus, kind: .submenu(children))
        }
        guard session.canAdminister || gate.scope == .sidecar else { return nil }
        let current = bot.section?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        var children = layout.sectionNames.filter { $0 != current }.map { name in
            DesktopMenuEntry(id: "move.\(name)", title: name, kind: .action {
                Task { await session.assignSection(name: name, botIds: [bot.id]) }
            })
        }
        if !current.isEmpty, gate.allows(.sectionManagement) {
            children.append(DesktopMenuEntry(id: "move.general", title: String(localized: "Move to Unassigned"), icon: .folderInput, kind: .action {
                Task { _ = await session.setServerSectionBots(current, add: [], remove: [bot.id]) }
            }))
        }
        return DesktopMenuEntry(id: "move", title: title, icon: .folderPlus, kind: .submenu(children))
    }

    // MARK: Room row (RoomContextMenu)

    func room(_ room: Room) -> [DesktopMenuEntry] {
        var out: [DesktopMenuEntry] = []
        let access = session.roomAccess(room)
        let actions = model.roomActions
        if session.groupPinsSupported, gate.scope != .sidecar {
            out.append(DesktopMenuEntry(
                id: "pin", title: room.pinned == true ? String(localized: "Unpin") : String(localized: "Pin"),
                icon: room.pinned == true ? .pinOff : .pin,
                kind: .action { Task { await session.setPinned(room, pinned: room.pinned != true) } }
            ))
        }
        if access.editable {
            out.append(DesktopMenuEntry(id: "rename", title: String(localized: "Rename group chat"), icon: .pencil, kind: .action {
                actions.startRename(room)
            }))
        }
        let layout = prefs.layout(session)
        if layout.personal, room.dm != true, room.peopleDm != true {
            let key = PersonalSections.itemKey(group: room.id)
            let current = (prefs.personal ?? .empty).section(of: key)
            var children = layout.sectionNames.filter { $0 != current }.map { name in
                DesktopMenuEntry(id: "move.\(name)", title: name, kind: .action {
                    model.sectionActions.error = prefs.assignPersonal(session, key: key, to: name)
                })
            }
            if current != nil {
                children.append(DesktopMenuEntry(id: "move.general", title: String(localized: "Move to Unassigned"), icon: .folderInput, kind: .action {
                    model.sectionActions.error = prefs.assignPersonal(session, key: key, to: "")
                }))
            }
            out.append(DesktopMenuEntry(id: "move", title: String(localized: "Move to"), icon: .folderPlus, kind: .submenu(children)))
        } else if !layout.personal, access.canMoveSection {
            let current = room.section?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            var children = RoomSections.names(session.state).filter { $0 != current }.map { name in
                DesktopMenuEntry(id: "move.\(name)", title: name, kind: .action { actions.move(room, to: name, session) })
            }
            children.append(DesktopMenuEntry(id: "move.new", title: String(localized: "New section"), icon: .folderPlus, kind: .action {
                actions.sectionDraft = ""
                actions.newSectionFor = room
            }))
            if !current.isEmpty {
                children.append(DesktopMenuEntry(id: "move.none", title: String(localized: "Remove from section"), danger: true, kind: .action {
                    actions.move(room, to: "", session)
                }))
            }
            out.append(DesktopMenuEntry(id: "move", title: String(localized: "Move to"), icon: .folderPlus, kind: .submenu(children)))
        }
        out.append(DesktopMenuEntry(id: "copy-id", title: String(localized: "Copy conversation ID"), icon: .clipboardCopy, kind: .action {
            actions.copyConversationId(room)
        }))
        if room.peopleDm == true {
            // #219: a conversation with a person closes, never hides
            out.append(DesktopMenuEntry(id: "close", title: String(localized: "Close"), icon: .x, kind: .action {
                prefs.hide(session, room: room)
            }))
        } else {
            out.append(DesktopMenuEntry(id: "hide", title: String(localized: "Hide from sidebar"), icon: .eyeOff, kind: .action {
                prefs.hide(session, room: room)
            }))
        }
        if access.canDelete {
            out.append(.divider("delete"))
            out.append(DesktopMenuEntry(id: "delete", title: String(localized: "Delete group chat"), icon: .trash, danger: true, kind: .action {
                actions.deleting = room
            }))
        }
        return out
    }

    // MARK: Section header (TeamMenuItems, OrgSectionMenu)

    func section(_ id: String) -> [DesktopMenuEntry] {
        let layout = prefs.layout(session)
        let actions = model.sectionActions
        let name = SidebarSectionID.userName(id)
        var out: [DesktopMenuEntry] = []
        if layout.personal {
            out.append(DesktopMenuEntry(id: "new", title: String(localized: "New section…"), icon: .plus, kind: .action { actions.startNew() }))
            if let name {
                out.append(DesktopMenuEntry(id: "rename", title: String(localized: "Rename…"), icon: .pencil, kind: .action {
                    actions.startRename(name, personal: true)
                }))
            }
        } else if let name, gate.allows(.sectionManagement) {
            out.append(DesktopMenuEntry(id: "add-bots", title: String(localized: "Add bots"), icon: .users, kind: .action {
                actions.startEditingBots(name)
            }))
            out.append(DesktopMenuEntry(id: "rename", title: String(localized: "Rename team"), icon: .pencil, kind: .action {
                actions.startRename(name, personal: false)
            }))
            out.append(DesktopMenuEntry(id: "share", title: String(localized: "Share team…"), icon: .share, kind: .action {
                model.sharingTeam = name
            }))
        }
        // A team's menu is Add bots, Rename, Share, Delete (TeamMenuItems);
        // a person's own sections also move up and down (the org menu).
        var moves: [DesktopMenuEntry] = []
        if let name, layout.personal, layout.canMove(name, by: -1) {
            moves.append(DesktopMenuEntry(id: "up", title: String(localized: "Move up"), icon: .arrowUp, kind: .action {
                prefs.moveSection(session, name, by: -1)
            }))
        }
        if let name, layout.personal, layout.canMove(name, by: 1) {
            moves.append(DesktopMenuEntry(id: "down", title: String(localized: "Move down"), icon: .arrowDown, kind: .action {
                prefs.moveSection(session, name, by: 1)
            }))
        }
        let delete: DesktopMenuEntry?
        if let name, layout.personal {
            delete = DesktopMenuEntry(id: "delete", title: String(localized: "Delete section"), icon: .trash, danger: true, kind: .action {
                actions.startDelete(.personal(name))
            })
        } else if let name, gate.allows(.sectionManagement) {
            delete = DesktopMenuEntry(id: "delete", title: String(localized: "Delete team"), icon: .trash, danger: true, kind: .action {
                actions.startDelete(.server(name))
            })
        } else {
            delete = nil
        }
        if let delete { out.append(delete) }
        if !moves.isEmpty {
            if !out.isEmpty { out.append(.divider("moves")) }
            out += moves
        }
        return out
    }

    // MARK: Account (SidebarProfileMenu)

    /// SidebarProfileMenu.tsx `accountMenuItems` (2026-10-28): Usage ›,
    /// Get Sagax on mobile, Help › (Keyboard shortcuts, Release notes,
    /// About), Settings, Tools › (Automations, Memory, Team map,
    /// Achievements, and Browse Bots while Templates is on), then the
    /// archived bots. The desktop's update row and its account switching
    /// are the Mac app's (the iPad updates through the App Store).
    func profile() -> [DesktopMenuEntry] {
        var out: [DesktopMenuEntry] = []
        if DesktopSettingsSection.available(for: gate).contains(.usage) {
            out.append(DesktopMenuEntry(id: "usage", title: String(localized: "Usage"), icon: .gauge, kind: .submenu([
                DesktopMenuEntry(id: "view-usage", title: String(localized: "View usage"), kind: .action {
                    model.settingsSection = .usage
                    model.modal = .settings
                }),
            ])))
        }
        // The desktop's phone row: here it opens Pair devices, where another
        // phone or iPad pairs with the same computer.
        if DesktopSettingsSection.available(for: gate).contains(.companion) {
            out.append(DesktopMenuEntry(id: "phone", title: String(localized: "Get Sagax on mobile"), icon: .smartphone, kind: .action {
                model.settingsSection = .companion
                model.modal = .settings
            }))
        }
        out.append(DesktopMenuEntry(id: "help", title: String(localized: "Help"), icon: .bookOpen, kind: .submenu([
            DesktopMenuEntry(id: "shortcuts", title: String(localized: "Keyboard shortcuts"), icon: .keyboard, shortcut: "⌘ /", kind: .action {
                model.modal = .shortcuts
            }),
            DesktopMenuEntry(id: "releaseNotes", title: String(localized: "Release notes"), icon: .fileText, kind: .action {
                model.modal = .releaseNotes
            }),
            DesktopMenuEntry(id: "about", title: String(localized: "About"), icon: .info, kind: .action {
                model.modal = .about
            }),
        ])))
        out.append(DesktopMenuEntry(id: "settings", title: String(localized: "Settings"), icon: .settings, kind: .action {
            model.modal = .settings
        }))
        var tools: [DesktopMenuEntry] = []
        let shortcuts = NavigationMenus.accountShortcuts(gate: gate, connected: session.connection != nil)
        if shortcuts.contains(.automations) {
            tools.append(DesktopMenuEntry(id: "automations", title: String(localized: "Automations"), icon: .calendarDays, kind: .action {
                model.show(.automations)
            }))
        }
        if shortcuts.contains(.memory) {
            tools.append(DesktopMenuEntry(id: "memory", title: String(localized: "Memory"), icon: .brain, kind: .action {
                model.show(.memory)
            }))
        }
        if shortcuts.contains(.teamMap) {
            tools.append(DesktopMenuEntry(id: "teamMap", title: String(localized: "Team map"), icon: .network, kind: .action {
                model.show(.teamMap)
            }))
        }
        if AchievementStore.shared.status == .ready {
            tools.append(DesktopMenuEntry(id: "achievements", title: String(localized: "Achievements"), icon: .trophy, kind: .action {
                model.modal = .achievements
            }))
        }
        // Browse Bots (Templates, Experimental features)
        if DesktopSidebarFlags.shared.features?.templates == true, gate.allows(.browseBots) {
            tools.append(DesktopMenuEntry(id: "templates", title: String(localized: "Browse Bots"), icon: .library, kind: .action {
                model.modal = .templates
            }))
        }
        if !tools.isEmpty {
            out.append(DesktopMenuEntry(id: "tools", title: String(localized: "Tools"), icon: .wrench, kind: .submenu(tools)))
        }
        // an admin restores every archived bot, a member their own (2026-10-26)
        let archived = DesktopBotArchive.archived(session.state.bots).filter { gate.allows(.botOwnerExtras, bot: $0) }
        if !archived.isEmpty {
            // Archived bots (the desktop's account place): each one restores.
            let children = archived.map { bot in
                DesktopMenuEntry(id: "restore.\(bot.id)", title: String(localized: "Restore \(bot.name)"), kind: .action {
                    Task { await DesktopBotArchiving.set(bot, archived: false, session: session, model: model) }
                })
            }
            out.append(.divider("archived"))
            out.append(DesktopMenuEntry(id: "archived", title: String(localized: "Archived bots"), icon: .archive, kind: .submenu(children)))
        }
        return out
    }

    // MARK: New (⌘N)

    /// New: create a bot or a group chat, or open one of the first nine
    /// bots (⌘1 to ⌘9), as the desktop's compose-to picker lists them.
    func new() -> [DesktopMenuEntry] {
        var out: [DesktopMenuEntry] = []
        if gate.allows(.createBot) {
            // Lot 7: Create New Bot (quick create) first.
            out.append(DesktopMenuEntry(id: "new-bot", title: String(localized: "Create new Bot"), icon: .plus, kind: .action {
                model.modal = .newBot
            }))
        }
        out.append(DesktopMenuEntry(id: "new-group", title: String(localized: "Create group chat"), icon: .users, kind: .action {
            model.modal = .newGroup
        }))
        let bots = session.state.bots.filter { $0.hidden != true }.prefix(9)
        if !bots.isEmpty { out.append(.divider("bots")) }
        for (index, bot) in bots.enumerated() {
            out.append(DesktopMenuEntry(id: "bot.\(bot.id)", title: bot.name, shortcut: "⌘\(index + 1)", kind: .action {
                model.jump(to: index, in: session)
            }))
        }
        return out
    }
}
