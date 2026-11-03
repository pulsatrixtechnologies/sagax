// iPad I2b: the sidebar's New as the desktop draws it now
// (src/components/ComposeToPicker.tsx): an inline "To:" picker over the top
// of the main column, not a menu. The band (48 pt, the app colour, a
// hairline under it) holds "To:", the search field and Close; under it, at
// 12, 8, the list (at most 440 by 440, rounded 12, the menu colour): Create
// new Bot, Create group chat, then the person's own bots, ⌘1 to ⌘9 on the
// first nine rows. Create group chat turns the same list into a member
// picker (chips in the band) and creates the group. On an organization
// server the people one may write to follow the bots (`composePeople`): a
// person row opens the direct conversation with them, as on the desktop.
//
// Measured in desktop-<W>x<H>-12-sidebar-new-menu and -13-new-group.
import SwiftUI
import UIKit
import CompanionCore

struct DesktopComposePicker: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    @ObservedObject private var prefs = SidebarPrefsModel.shared
    @ObservedObject private var flags = DesktopSidebarFlags.shared
    @ObservedObject private var directory = PeopleDirectory.shared
    let width: CGFloat
    let height: CGFloat
    @State private var query = ""
    @State private var mode: DesktopComposeTo.Mode = .browse
    @State private var picked: [String] = []
    @State private var cursor = 0
    @State private var working = false
    @FocusState private var focused: Bool

    private var bots: [Bot] {
        DesktopComposeTo.bots(session.state.bots, viewerId: flags.viewerId, query: query)
    }

    /// The people the desktop's browse mode lists under the bots.
    private var people: [OrgDirectoryPerson] {
        guard session.surfaceGate.allows(.people) else { return [] }
        return directory.directory?.messageable(viewer: session.roomViewer.actorId, query: query) ?? []
    }

    private var rows: [DesktopComposeTo.Row] {
        DesktopComposeTo.rows(mode: mode, bots: bots, canCreateBots: session.surfaceGate.allows(.createBot), people: people, query: query)
    }

    var body: some View {
        let rows = rows
        let active = rows.isEmpty ? 0 : min(cursor, rows.count - 1)
        return ZStack(alignment: .topLeading) {
            VStack(spacing: 0) {
                AnyView(band)
                Rectangle().fill(theme.hairline.opacity(0.4)).frame(height: 1)
            }
            AnyView(list(rows, active: active))
                .padding(.leading, 12)
                .padding(.top, 57)
            // Esc: group mode back to browse, else close; ↑ ↓ move the row
            Group {
                Button("") { escape() }.keyboardShortcut(.cancelAction)
                Button("") { cursor = DesktopComposeTo.move(cursor, by: 1, count: self.rows.count) }
                    .keyboardShortcut(.downArrow, modifiers: [])
                Button("") { cursor = DesktopComposeTo.move(cursor, by: -1, count: self.rows.count) }
                    .keyboardShortcut(.upArrow, modifiers: [])
            }
            .opacity(0)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
        .frame(width: width, alignment: .topLeading)
        .onAppear {
            // the desktop's autoFocus; the parity captures keep the
            // simulator's software keyboard away
            if !ParityMode.isActive { focused = true }
            if model.composeGroupMode {
                model.composeGroupMode = false
                mode = .group
            }
            #if DEBUG
            if let preset = model.parityComposePreset {
                mode = preset.group ? .group : .browse
                cursor = preset.cursor
            }
            #endif
            model.composeActivate = { index in
                let rows = self.rows
                if rows.indices.contains(index) { activate(rows[index]) }
            }
        }
        .onDisappear { model.composeActivate = nil }
        // the people rows: the directory is asked once per pairing
        .task(id: session.connection?.id) { await directory.load(session) }
        .onValueChange(of: query) { _ in cursor = 0 }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-compose")
    }

    // MARK: Band

    private var band: some View {
        HStack(spacing: 12) {
            DesktopLineText(text: String(localized: "To:"), size: 15, color: theme.inkSecondary, lineHeight: 22.5)
            HStack(spacing: 6) {
                if mode == .group {
                    ForEach(picked, id: \.self) { id in
                        if let bot = session.state.bot(id) { chip(bot) }
                    }
                }
                TextField(
                    "",
                    text: $query,
                    prompt: Text(mode == .group ? "Search bots" : "Search or create Bots").foregroundColor(theme.inkSecondary)
                )
                .font(theme.font(15))
                .foregroundStyle(theme.ink)
                .tint(theme.accent)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($focused)
                .onSubmit { if let row = rowsAt(cursor) { activate(row) } }
                .accessibilityLabel(Text(mode == .group ? "Choose bots for the group chat" : "Search or create Bots"))
                .accessibilityIdentifier("desktop-compose-field")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button { model.menu = nil } label: {
                DesktopIconView(icon: .x, size: 18)
                    .foregroundStyle(theme.inkSecondary)
                    .frame(width: 32, height: 32)
                    .contentShape(Rectangle())
            }
            .buttonStyle(DesktopComposeHoverStyle(radius: 8))
            .accessibilityLabel(Text("Close"))
            .accessibilityIdentifier("desktop-compose-close")
        }
        .padding(.horizontal, 16)
        .frame(height: 48)
        .background(theme.app)
    }

    private func chip(_ bot: Bot) -> some View {
        HStack(spacing: 4) {
            BotMascotView(bot: bot, size: 18, state: .idle, animated: false)
                .frame(width: 18, height: 18)
            Text(verbatim: bot.name)
                .font(theme.font(13))
                .foregroundStyle(theme.ink)
                .lineLimit(1)
                .frame(maxWidth: 128, alignment: .leading)
            Button { toggle(bot.id) } label: {
                DesktopIconView(icon: .x, size: 12)
                    .foregroundStyle(theme.inkSecondary)
                    .frame(width: 20, height: 20)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Remove \(bot.name)"))
        }
        .padding(.leading, 4)
        .padding(.trailing, 4)
        .padding(.vertical, 2)
        .background(theme.raised, in: Capsule())
    }

    // MARK: List

    private func list(_ rows: [DesktopComposeTo.Row], active: Int) -> some View {
        let listWidth = min(440, width - 24)
        let content = VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                AnyView(rowView(row, index: index, selected: index == active))
            }
            if !query.trimmingCharacters(in: .whitespaces).isEmpty, bots.isEmpty, mode == .group || people.isEmpty {
                Text("Nothing matches “\(query.trimmingCharacters(in: .whitespaces))”")
                    .font(theme.font(13))
                    .foregroundStyle(theme.inkSecondary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.vertical, 6)
        return ScrollView { content }
            .scrollIndicators(.never)
            .frame(width: listWidth)
            .frame(maxHeight: min(440, height * 0.7))
            .fixedSize(horizontal: false, vertical: true)
            .background(theme.menu, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
            .shadow(color: .black.opacity(0.5), radius: 25, y: 25)
            .accessibilityIdentifier("desktop-compose-list")
    }

    @ViewBuilder
    private func rowView(_ row: DesktopComposeTo.Row, index: Int, selected: Bool) -> some View {
        let shortcut = index < 9 ? index + 1 : nil
        switch row {
        case .createBot:
            actionRow(icon: .plus, title: String(localized: "Create new Bot"), shortcut: shortcut, selected: selected,
                      disabled: false, id: "create-bot") { activate(row) }
        case .createBotWizard:
            actionRow(icon: .wand, title: String(localized: "Create a bot with the wizard"), shortcut: shortcut, selected: selected,
                      disabled: false, id: "create-bot-wizard") { activate(row) }
        case .createGroup:
            actionRow(icon: .users, title: groupLabel, shortcut: shortcut, selected: selected,
                      disabled: mode == .group && picked.isEmpty, id: "create-group") { activate(row) }
        case let .bot(id):
            if let bot = session.state.bot(id) { botRow(bot, shortcut: shortcut, selected: selected) { activate(row) } }
        case let .person(id):
            if let person = directory.directory?.person(id) { personRow(person, shortcut: shortcut, selected: selected) { activate(row) } }
        }
    }

    private func personRow(_ person: OrgDirectoryPerson, shortcut: Int?, selected: Bool, action: @escaping () -> Void) -> some View {
        let name = People.displayName(person)
        return Button(action: action) {
            HStack(spacing: 12) {
                PersonAvatar(initials: People.initials(name), size: 28, presenceId: person.principalId)
                    .frame(width: 28, height: 28)
                DesktopLineText(text: name, size: 14, color: theme.ink, lineHeight: 21)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if selected {
                    Text("Open chat").font(theme.font(13)).foregroundStyle(theme.inkSecondary)
                } else if let shortcut {
                    DesktopComposeKey(number: shortcut)
                }
            }
            .padding(.horizontal, 12)
            .frame(height: 44)
            .background(selected ? theme.raised.opacity(0.8) : .clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(DesktopComposeRowStyle())
        .accessibilityLabel(Text(verbatim: name))
        .accessibilityHint(Text("Opens your direct conversation"))
        .accessibilityIdentifier("desktop-compose.person.\(person.principalId)")
    }

    private var groupLabel: String {
        guard mode == .group, !picked.isEmpty else { return String(localized: "Create group chat") }
        return picked.count == 1
            ? String(localized: "Create group chat · 1 bot")
            : String(localized: "Create group chat · \(picked.count) bots")
    }

    private func actionRow(
        icon: DesktopIcon, title: String, shortcut: Int?, selected: Bool, disabled: Bool, id: String, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                DesktopIconView(icon: icon, size: 16)
                    .foregroundStyle(theme.inkSecondary)
                DesktopLineText(text: title, size: 14, color: theme.ink, lineHeight: 21)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let shortcut { DesktopComposeKey(number: shortcut) }
            }
            .padding(.horizontal, 12)
            .frame(height: 37)
            .background(selected ? theme.raised.opacity(0.8) : .clear)
            .opacity(disabled ? 0.4 : 1)
            .contentShape(Rectangle())
        }
        .buttonStyle(DesktopComposeRowStyle())
        .disabled(disabled)
        .accessibilityIdentifier("desktop-compose.\(id)")
    }

    private func botRow(_ bot: Bot, shortcut: Int?, selected: Bool, action: @escaping () -> Void) -> some View {
        let member = picked.contains(bot.id)
        let hint: LocalizedStringKey = mode == .group
            ? (member ? "Remove" : "Add")
            : (DesktopSidebarState.threadsOn(model: model, prefs: prefs) ? "New thread" : "Open chat")
        return Button(action: action) {
            HStack(spacing: 12) {
                ChatAvatarView(chat: .bot(bot), size: 28, state: .idle, background: theme.menu)
                    .frame(width: 28, height: 28)
                DesktopLineText(text: bot.name, size: 14, color: theme.ink, lineHeight: 21)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if mode == .group, member, !selected {
                    DesktopIconView(icon: .check, size: 14).foregroundStyle(theme.inkSecondary)
                }
                if selected {
                    Text(hint).font(theme.font(13)).foregroundStyle(theme.inkSecondary)
                } else if let shortcut {
                    DesktopComposeKey(number: shortcut)
                }
            }
            .padding(.horizontal, 12)
            .frame(height: 44)
            .background(selected ? theme.raised.opacity(0.8) : .clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(DesktopComposeRowStyle())
        .accessibilityValue(Text(member ? "Added" : ""))
        .accessibilityIdentifier("desktop-compose.bot.\(bot.id)")
    }

    // MARK: Actions

    private func rowsAt(_ index: Int) -> DesktopComposeTo.Row? {
        let rows = rows
        return rows.isEmpty ? nil : rows[min(index, rows.count - 1)]
    }

    private func toggle(_ id: String) {
        if let at = picked.firstIndex(of: id) { picked.remove(at: at) } else { picked.append(id) }
        query = ""
    }

    private func escape() {
        if mode == .group {
            mode = .browse
            picked = []
            query = ""
            cursor = 0
        } else {
            model.menu = nil
        }
    }

    private func activate(_ row: DesktopComposeTo.Row) {
        switch row {
        case .createBot:
            // Lot 7: Create New Bot (quick create) first.
            model.menu = nil
            model.modal = .newBot
        case .createBotWizard:
            model.menu = nil
            BotWizardPresenter.shared.open(startMode: .guided)
        case .createGroup:
            if mode == .browse {
                mode = .group
                query = ""
                cursor = 0
                return
            }
            guard !picked.isEmpty, !working else { return }
            working = true
            let members = picked
            Task {
                let room = await session.createRoom(name: nil, memberIds: members)
                working = false
                if let room {
                    model.menu = nil
                    model.open(.room(room))
                }
            }
        case let .bot(id):
            guard let bot = session.state.bot(id) else { return }
            if mode == .group {
                toggle(id)
                cursor = 0
                return
            }
            model.menu = nil
            if DesktopSidebarState.threadsOn(model: model, prefs: prefs) {
                Task {
                    if let created = await session.createRosterThread(for: bot) {
                        model.openThreadLists.insert(bot.id)
                        model.open(.bot(created))
                    }
                }
            } else {
                model.open(session.returning(to: .bot(bot)))
            }
        case let .person(id):
            guard !working else { return }
            working = true
            Task {
                let chat = await PeopleDirectory.shared.openConversation(with: id, session: session)
                working = false
                if let chat {
                    model.menu = nil
                    model.open(chat)
                }
            }
        }
    }
}

/// `KeyHint`: ⌘ and the number in a 17 pt keycap (radius 6, hairline/50).
struct DesktopComposeKey: View {
    @Environment(\.desktopTheme) private var theme
    let number: Int

    var body: some View {
        HStack(spacing: 2) {
            DesktopIconView(icon: .command, size: 11)
            DesktopLineText(text: "\(number)", size: 11, color: theme.inkSecondary, lineHeight: 11)
        }
        .foregroundStyle(theme.inkSecondary)
        .padding(.horizontal, 6)
        .frame(height: 17)
        .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
        .accessibilityHidden(true)
    }
}

/// `hover:bg-raised/60` on a picker row.
struct DesktopComposeRowStyle: ButtonStyle {
    @Environment(\.desktopTheme) private var theme
    @State private var hovering = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background((hovering || configuration.isPressed) ? theme.raised.opacity(0.6) : .clear)
            .onHover { hovering = $0 }
    }
}

/// `hover:bg-raised` on the band's Close.
struct DesktopComposeHoverStyle: ButtonStyle {
    @Environment(\.desktopTheme) private var theme
    var radius: CGFloat
    @State private var hovering = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background((hovering || configuration.isPressed) ? theme.raised : .clear,
                        in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .onHover { hovering = $0 }
    }
}
