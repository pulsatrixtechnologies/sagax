// iPad lot 3 (2026-11-03): the desktop's command palette (⌘K, the round
// Search button), CommandPalette.tsx drawn in the shell instead of the
// phone's search sheet: a 600 pt card 14 % from the top on a 50 % dim, the
// field with its esc key, the sections (Recent, Conversations, Bots with
// ⌘1 to ⌘9, Messages, Navigation, Settings, Help) under their uppercase
// headings, the selected row in the accent, and the keyboard footer. The
// order and the ranking are CompanionCore's DesktopPalette.
import SwiftUI
import UIKit
import CompanionCore

/// What a palette row does.
enum DesktopPaletteAction: Sendable {
    case chat(Chat)
    case message(SearchHit)
    case newConversation, newBot, routines, teamMap, capabilities, shortcuts, releaseNotes, about
    case settings(DesktopSettingsSection?)
    case botSettings(Bot)
}

struct DesktopCommandPalette: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    @State private var query = DesktopCommandPalette.parityQuery
    @State private var hits: [SearchHit] = []
    @State private var searching = false
    @State private var cursor = 0
    @FocusState private var focused: Bool
    @AppStorage("sagax.palette.recent.v1") private var recentsRaw = ""
    let close: () -> Void

    private typealias Item = DesktopPaletteItem<DesktopPaletteAction>

    var body: some View {
        let sections = DesktopPalette.sections(items: items, query: query, recents: recents, messages: messageItems)
        let entries = sections.flatMap(\.items)
        GeometryReader { geometry in
            ZStack(alignment: .top) {
                Color.black.opacity(0.5)
                    .contentShape(Rectangle())
                    .onTapGesture(perform: close)
                    .accessibilityHidden(true)
                VStack(spacing: 0) {
                    field
                    Rectangle().fill(theme.hairline.opacity(0.4)).frame(height: 1)
                    ScrollViewReader { reader in
                        ScrollView {
                            LazyVStack(alignment: .leading, spacing: 0) {
                                if entries.isEmpty { empty }
                                ForEach(Array(sections.enumerated()), id: \.element.group) { offset, section in
                                    heading(section.group, first: offset == 0)
                                    ForEach(section.items) { item in
                                        let position = entries.firstIndex { $0.id == item.id && $0.group == item.group } ?? 0
                                        row(item, selected: position == min(cursor, max(entries.count - 1, 0)), recent: section.group == .recent)
                                            .id("\(item.group.rawValue):\(item.id)")
                                    }
                                }
                                if !query.isEmpty, searching, !entries.isEmpty {
                                    DesktopText(Text("Searching messages…"), size: 12, line: 16, color: \.inkSecondary)
                                        .padding(.horizontal, 12)
                                        .padding(.vertical, 8)
                                }
                            }
                            .padding(8)
                        }
                        .onValueChange(of: cursor) { value in
                            guard entries.indices.contains(value) else { return }
                            reader.scrollTo("\(entries[value].group.rawValue):\(entries[value].id)")
                        }
                    }
                    Rectangle().fill(theme.hairline.opacity(0.4)).frame(height: 1)
                    footer
                }
                .frame(width: min(600, geometry.size.width - 48))
                .frame(maxHeight: min(520, geometry.size.height * 0.72))
                .fixedSize(horizontal: false, vertical: true)
                .background(theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
                .shadow(color: .black.opacity(0.6), radius: 25, y: 25)
                .padding(.top, geometry.size.height * 0.14)
                // keyboard: arrows move, return opens, ⌘K and esc close
                .background {
                    Group {
                        Button("") { cursor = min(cursor + 1, max(entries.count - 1, 0)) }.keyboardShortcut(.downArrow, modifiers: [])
                        Button("") { cursor = max(cursor - 1, 0) }.keyboardShortcut(.upArrow, modifiers: [])
                        Button("") { if entries.indices.contains(cursor) { activate(entries[cursor]) } }.keyboardShortcut(.return, modifiers: [])
                        Button("", action: close).keyboardShortcut("k", modifiers: .command)
                        Button("", action: close).keyboardShortcut(.escape, modifiers: [])
                    }
                    .opacity(0)
                    .accessibilityHidden(true)
                }
            }
        }
        .ignoresSafeArea()
        .task(id: query) { await search() }
        .onValueChange(of: query) { _ in cursor = 0 }
        .onAppear { focused = !DesktopCommandPalette.parityNoKeyboard }
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
        .accessibilityIdentifier("desktop-palette")
    }

    // MARK: Pieces

    private var field: some View {
        HStack(spacing: 12) {
            DesktopIconView(icon: .search, size: 16)
                .foregroundStyle(theme.inkSecondary)
            TextField(text: $query, prompt: Text("Search bots, conversations, commands, messages…").foregroundColor(theme.inkSecondary)) {
                Text("Command palette")
            }
            .font(theme.font(14))
            .foregroundStyle(theme.ink)
            .tint(theme.focus)
            .focused($focused)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitLabel(.go)
            .onSubmit {
                let entries = DesktopPalette.sections(items: items, query: query, recents: recents, messages: messageItems).flatMap(\.items)
                if entries.indices.contains(cursor) { activate(entries[cursor]) }
            }
            .accessibilityIdentifier("desktop-palette-field")
            Button(action: close) { keycap("esc") }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Close"))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    @ViewBuilder
    private var empty: some View {
        VStack(spacing: 6) {
            if searching {
                DesktopText(Text("Searching messages…"), size: 13, line: 18, color: \.inkSecondary)
            } else {
                DesktopIconView(icon: .search, size: 20).foregroundStyle(theme.inkSecondary)
                DesktopText(query.isEmpty ? Text("Nothing to show yet") : Text("Nothing matches “\(query)”"), size: 13, line: 18)
                if !query.isEmpty {
                    DesktopText(Text("Try a bot name, a conversation or a command such as Settings."), size: 12, line: 16, color: \.inkSecondary)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 32)
    }

    private func heading(_ group: DesktopPaletteGroup, first: Bool) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if !first { Rectangle().fill(theme.hairline.opacity(0.3)).frame(height: 1).padding(.top, 4) }
            DesktopText(Text(verbatim: Self.label(group).uppercased()), size: 11, weight: .medium, line: 16.5, color: \.inkSecondary)
                .tracking(0.88)
                .padding(.horizontal, 12)
                .padding(.top, first ? 6 : 10)
                .padding(.bottom, 4)
        }
        .accessibilityAddTraits(.isHeader)
    }

    private func row(_ item: Item, selected: Bool, recent: Bool) -> some View {
        Button { activate(item) } label: {
            Group {
                if case let .message(hit) = item.action {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 8) {
                            DesktopIconView(icon: .messageSquare, size: 13).foregroundStyle(theme.inkSecondary)
                            Text(verbatim: hit.name).font(theme.font(13, .medium)).foregroundStyle(theme.ink)
                            if let task = hit.task { Text(verbatim: "· \(task)").font(theme.font(13)).foregroundStyle(theme.inkSecondary) }
                        }
                        .lineLimit(1)
                        .frame(height: 19.5)
                        snippet(hit)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    HStack(spacing: 12) {
                        DesktopIconView(icon: Self.icon(item), size: 16).foregroundStyle(theme.inkSecondary)
                        Text(verbatim: recent ? "\(Self.label(item.group)): \(item.label)" : item.label)
                            .font(theme.font(14)).foregroundStyle(theme.ink).lineLimit(1)
                            // the body's 1.5 line height
                            .frame(height: 21)
                        if let detail = item.detail, !recent {
                            Text(verbatim: detail).font(theme.font(12.5)).foregroundStyle(theme.inkSecondary).lineLimit(1)
                        }
                        Spacer(minLength: 0)
                        if !item.shortcut.isEmpty {
                            HStack(spacing: 4) { ForEach(item.shortcut, id: \.self) { keycap($0) } }
                                .padding(.leading, 12)
                        }
                    }
                }
            }
            // `px-3 py-2`, the 14/20 label: 36 pt rows (a message hit two
            // lines more); the selected row is the accent tint alone, as the
            // reference draws it
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(
                selected ? theme.accent.opacity(0.2) : .clear,
                in: RoundedRectangle(cornerRadius: 12, style: .continuous)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityIdentifier("desktop-palette.\(item.id)")
    }

    private func snippet(_ hit: SearchHit) -> some View {
        let text = hit.snippet
        let start = text.index(text.startIndex, offsetBy: min(max(hit.matchStart, 0), text.count))
        let end = text.index(start, offsetBy: min(max(hit.matchLength, 0), text.distance(from: start, to: text.endIndex)))
        var attributed = AttributedString(String(text[..<start]))
        var match = AttributedString(String(text[start..<end]))
        match.backgroundColor = theme.accent.opacity(0.25)
        match.foregroundColor = theme.ink
        attributed.append(match)
        attributed.append(AttributedString(String(text[end...])))
        return Text(attributed)
            .font(theme.font(12.5))
            .foregroundStyle(theme.inkSecondary)
            .lineSpacing(18.75 - UIFont.systemFont(ofSize: 12.5).lineHeight)
            .padding(.vertical, (18.75 - UIFont.systemFont(ofSize: 12.5).lineHeight) / 2)
            .lineLimit(2)
    }

    private func keycap(_ key: String) -> some View {
        Text(verbatim: key)
            .font(theme.font(11))
            .foregroundStyle(theme.inkSecondary)
            .padding(.horizontal, 6)
            .frame(minWidth: 20, minHeight: 18)
            .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(theme.hairline.opacity(0.4), lineWidth: 1))
    }

    private var footer: some View {
        HStack(spacing: 16) {
            HStack(spacing: 6) { keycap("↑"); keycap("↓"); Text("to move") }
            HStack(spacing: 6) { keycap("↵"); Text("to open") }
            Spacer(minLength: 0)
            HStack(spacing: 6) { keycap("⌘"); keycap("K"); Text("to open or close") }
        }
        .font(theme.font(11.5))
        .foregroundStyle(theme.inkSecondary)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    // MARK: Data

    private var recents: [String] { recentsRaw.split(separator: "\n").map(String.init) }

    private var items: [Item] {
        var out: [Item] = []
        let conversations = Self.label(.conversations)
        for room in session.state.rooms {
            out.append(Item(id: "room:\(room.id)", group: .conversations, label: PeopleDirectory.shared.name(.room(room), session: session),
                            words: [conversations], action: .chat(.room(room))))
        }
        let botsWord = Self.label(.bots)
        for (index, bot) in session.state.bots.filter({ $0.hidden != true }).enumerated() {
            out.append(Item(id: "bot:\(bot.id)", group: .bots, label: bot.name, detail: bot.title.isEmpty ? nil : bot.title,
                            words: [botsWord] + (bot.title.isEmpty ? [] : [bot.title]),
                            shortcut: index < 9 ? ["⌘", "\(index + 1)"] : [], action: .chat(.bot(bot))))
        }
        let gate = session.surfaceGate
        let nav = Self.label(.navigation)
        out.append(Item(id: "cmd:newConversation", group: .navigation, label: String(localized: "New conversation"), words: [nav],
                        shortcut: ["⌘", "N"], action: .newConversation))
        if gate.allows(.createBot) {
            out.append(Item(id: "cmd:newBot", group: .navigation, label: String(localized: "New bot"), words: [nav], action: .newBot))
        }
        let shortcuts = NavigationMenus.accountShortcuts(gate: gate, connected: session.connection != nil)
        if shortcuts.contains(.automations) {
            out.append(Item(id: "cmd:routines", group: .navigation, label: String(localized: "Routines"), words: [nav, "automations"], action: .routines))
        }
        if shortcuts.contains(.teamMap) {
            out.append(Item(id: "cmd:teamMap", group: .navigation, label: String(localized: "Team map"), words: [nav], action: .teamMap))
        }
        out.append(Item(id: "cmd:connectApps", group: .navigation, label: String(localized: "Plugins"), words: [nav, "plugins", "apps"], action: .capabilities))
        let settingsWord = Self.label(.settings)
        out.append(Item(id: "cmd:settings", group: .settings, label: String(localized: "Open settings"), words: [settingsWord],
                        shortcut: ["⌘", ","], action: .settings(nil)))
        // #2080 (L0): App (about) is a rail page; the centred About window
        // stays a separate palette entry under Help-adjacent Settings.
        for section in DesktopSettingsSection.available(for: gate) {
            out.append(Item(id: "settings:\(section.rawValue)", group: .settings, label: section.labelString,
                            words: [settingsWord] + section.keywords, action: .settings(section)))
        }
        out.append(Item(id: "settings:about-window", group: .settings, label: String(localized: "About"), words: [settingsWord, "version"], action: .about))
        if case let .bot(bot)? = model.selected {
            out.append(Item(id: "cmd:botSettings", group: .settings, label: String(localized: "\(bot.name) settings"), words: [settingsWord],
                            action: .botSettings(bot)))
        }
        let help = Self.label(.help)
        out.append(Item(id: "help:shortcuts", group: .help, label: String(localized: "Keyboard shortcuts"), words: [help, "keyboard", "clavier"],
                        shortcut: ["⌘", "/"], action: .shortcuts))
        out.append(Item(id: "help:releaseNotes", group: .help, label: String(localized: "Release notes"), words: [help], action: .releaseNotes))
        return out
    }

    private var messageItems: [Item] {
        hits.map { Item(id: "msg:\($0.threadId):\($0.messageId)", group: .messages, label: $0.name, detail: $0.task, action: .message($0)) }
    }

    private func search() async {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        hits = []
        guard !q.isEmpty else { searching = false; return }
        searching = true
        try? await Task.sleep(nanoseconds: 150_000_000)
        guard !Task.isCancelled else { return }
        let found = await session.searchMessages(q) ?? []
        guard !Task.isCancelled else { return }
        hits = Array(found.prefix(12))
        searching = false
    }

    private func activate(_ item: Item) {
        recentsRaw = DesktopPalette.remember(item.id, in: recents).joined(separator: "\n")
        close()
        switch item.action {
        case let .chat(chat): model.open(session.returning(to: chat))
        case let .message(hit):
            Task { if let chat = await session.open(hit) { model.open(chat) } }
        case .newConversation: model.menu = DesktopMenuRequest(kind: .new, anchor: .zero)
        case .newBot: model.modal = .newBot
        case .routines: model.show(.automations)
        case .teamMap: model.show(.teamMap)
        case .capabilities: model.modal = .plugins
        case let .settings(section):
            if let section { model.settingsSection = section }
            model.modal = .settings
        case .about: model.modal = .about
        case let .botSettings(bot):
            model.open(.bot(bot))
            model.showPanel(.activity)
        case .shortcuts: model.modal = .shortcuts
        case .releaseNotes: model.modal = .releaseNotes
        }
    }

    // MARK: Words

    static func label(_ group: DesktopPaletteGroup) -> String {
        switch group {
        case .recent: String(localized: "Recent")
        case .conversations: String(localized: "Conversations")
        case .bots: String(localized: "Bots")
        case .messages: String(localized: "Messages")
        case .navigation: String(localized: "Navigation")
        case .settings: String(localized: "Settings")
        case .help: String(localized: "Help")
        }
    }

    private static func icon(_ item: Item) -> DesktopIcon {
        switch item.action {
        case .chat(.room): .users
        case .chat(.bot): .bot
        case .message: .messageSquare
        case .newConversation: .squarePen
        case .newBot: .plus
        case .routines: .calendarDays
        case .teamMap: .network
        case .capabilities: .appsGrid
        case .settings, .botSettings: .settings
        case .about: .info
        case .shortcuts: .keyboard
        case .releaseNotes: .fileText
        }
    }

    #if DEBUG
    static var parityQuery: String { ParityLaunch.current?.iPadScreen == .searchPaletteQuery ? "sauvegarde" : "" }
    /// The parity captures draw the palette without raising the keyboard.
    static var parityNoKeyboard: Bool { ParityLaunch.current?.iPadScreen != nil }
    #else
    static let parityQuery = ""
    static let parityNoKeyboard = false
    #endif
}
