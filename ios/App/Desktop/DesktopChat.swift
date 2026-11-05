// iPad I3 (first version): the desktop chat in the shell's content column.
// It is the phone's `ChatView` (transcript, cards, composer state, sending:
// one implementation), told by `\.desktopChat` to wear the desktop's chrome:
// the floating bot pill centred at the top with the round Export and panel
// buttons on the right (`ChatView.tsx` header), the transcript in a column
// of at most 960, bubbles capped at 560, and the composer pill (attach,
// field, model chip, dictation, voice) docked 16 pt above the bottom.
// Measured in desktop-1366x1024-03-main.json.
import SwiftUI
import UIKit
import CompanionCore

/// What the shell tells a chat drawn in its content column.
struct DesktopChatChrome {
    /// The bot panel is open (its own top bar then holds Export and Close).
    var panelOpen: Bool
    /// The panel is docked beside the chat (1024 pt and wider).
    var panelDocked: Bool
    /// The Inspector is open beside the chat.
    var inspectorOpen = false
    var togglePanel: () -> Void
    var showPanel: (BotPanelTab) -> Void
    /// The command allowlist, in the panel's Advanced > Permissions.
    var showAllowlist: () -> Void = {}
    var toggleInspector: () -> Void = {}
    var openModelPicker: () -> Void = {}
    /// Settings > Models and voice, where an engine is connected.
    var openEngines: () -> Void = {}
    /// `/loop status`: the Automations page (`showRoutines`, the list).
    var openRoutines: (String) -> Void = { _ in }
    /// The in-app notice (ChatNotice in ChatView.tsx's banner stack).
    var notice: DesktopNotice? = nil
}

private struct DesktopChatKey: EnvironmentKey {
    static let defaultValue: DesktopChatChrome? = nil
}

private struct DesktopBubbleCapKey: EnvironmentKey {
    static let defaultValue: CGFloat? = nil
}

extension EnvironmentValues {
    /// Set by the desktop shell; nil on the iPhone (and the iPad's phone UI).
    var desktopChat: DesktopChatChrome? {
        get { self[DesktopChatKey.self] }
        set { self[DesktopChatKey.self] = newValue }
    }

    /// The desktop's bubble cap (`min(80 %, 560)`); nil keeps the phone's.
    var desktopBubbleCap: CGFloat? {
        get { self[DesktopBubbleCapKey.self] }
        set { self[DesktopBubbleCapKey.self] = newValue }
    }
}

// MARK: - Column

/// The content column's chat: ChatView in its own navigation stack (its
/// computer and profile pushes), with the desktop chrome on.
struct DesktopChatColumn: View {
    @EnvironmentObject private var model: DesktopShellModel
    @Environment(\.desktopTheme) private var theme
    let chat: Chat
    /// The Inspector beside (or over) the chat.
    @State private var inspectorOpen = DesktopChatColumn.parityInspector

    static let inspectorWidth: CGFloat = 460

    var body: some View {
        GeometryReader { geometry in
            // The window is this column plus the sidebar (and a docked panel):
            // the Inspector docks from 1024, as the bot panel does.
            let window = geometry.size.width + DesktopShellRules.sidebarWidth + (model.panelOpen && model.panelDocked ? model.panelWidth : 0)
            let docksInspector = inspectorOpen && window >= DesktopShellRules.dockMinWidth
            let chatWidth = geometry.size.width - (docksInspector ? Self.inspectorWidth : 0)
            HStack(spacing: 0) {
                chatStack(width: chatWidth, totalWidth: geometry.size.width)
                    .frame(width: chatWidth)
                if docksInspector {
                    AnyView(DesktopInspectorPanel(threadId: chat.threadId) { toggleInspector() })
                        .frame(width: Self.inspectorWidth)
                        .transition(.move(edge: .trailing))
                }
            }
            .overlay(alignment: .trailing) {
                if inspectorOpen && !docksInspector {
                    // below 1024 the Inspector covers the whole window row
                    // (InspectorPanel.tsx `max-lg:absolute inset-0`)
                    AnyView(DesktopInspectorPanel(threadId: chat.threadId) { toggleInspector() })
                        .frame(width: window)
                        .transition(.move(edge: .trailing))
                }
            }
        }
        .onValueChange(of: model.panelOpen) { open in
            if open { inspectorOpen = false }
        }
        .onValueChange(of: model.inspectorRequest) { _ in
            if !inspectorOpen { toggleInspector() }
        }
    }

    private func toggleInspector() {
        withAnimation(.easeOut(duration: 0.2)) {
            inspectorOpen.toggle()
            if inspectorOpen, model.panelOpen { model.togglePanel() }
        }
    }

    private func chatStack(width: CGFloat, totalWidth: CGFloat) -> some View {
        // the transcript column: px-5 inside the content, at most 960. The
        // bot's ongoing activities are in the panel's Details (#483), not
        // in a rail beside the chat.
        let column = min(DesktopShellRules.chatColumn, width - 40)
        let stack = NavigationStack {
            AnyView(ChatView(chat: chat))
        }
        .environment(\.desktopChatText, theme)
        .environment(\.desktopBubbleCap, DesktopChatMetrics.bubbleCap(column: column))
        .environment(\.desktopWideCap, DesktopChatMetrics.wideCap(column: column))
        .environment(\.desktopChat, DesktopChatChrome(
            panelOpen: model.panelOpen && (chat.isBot || chat.opensGroupPanel),
            // the shell docks the panel at 1024: this column is then
            // the window less the sidebar and the panel
            panelDocked: model.panelOpen && model.panelDocked,
            inspectorOpen: inspectorOpen,
            togglePanel: { model.togglePanel() },
            showPanel: { tab in model.showPanel(tab) },
            showAllowlist: { model.showPersona(.permissions) },
            toggleInspector: { toggleInspector() },
            openModelPicker: { model.modelPickerOpen = true },
            openEngines: {
                model.settingsSection = .engines
                model.modal = .settings
            },
            openRoutines: { _ in model.page = .automations },
            notice: model.notice
        ))
        return stack
    }

    #if DEBUG
    static var parityInspector: Bool { ParityLaunch.current?.iPadScreen == .inspector }
    #else
    static let parityInspector = false
    #endif
}

// MARK: - ChatView's desktop chrome

extension ChatView {
    /// The header slot: the desktop's floating pill and buttons, or the
    /// phone's top bar (and the find bar on both).
    var chatHeaderSlot: some View {
        Group {
            if let desktop = desktopChat {
                // the find bar opens under the header (ChatView.tsx), 20 in
                AnyView(VStack(spacing: 0) {
                    DesktopChatHeader(chat: current, chrome: desktop, export: exportConversation, copyMarkdown: copyConversationMarkdown, devPods: devPodsAvailable ? { openDevPods() } : nil, devPodsOpen: showingDevPods) {
                        // a group's pill toggles its docked panel (GroupPanel.swift)
                        if current.opensGroupPanel { desktop.togglePanel() } else { openProfile() }
                    }
                        .frame(height: 52, alignment: .top)
                    if finder.isOpen && session.surfaceGate.allows(.findInConversation) {
                        ChatFindBar(model: finder, threadId: threadId)
                            .padding(.horizontal, 20)
                            .transition(.opacity)
                    }
                })
                .chatFindShortcut { openFind() }
            } else {
                AnyView(headerOrFindBar)
            }
        }
    }

    /// The composer slot: the desktop pill, or the phone's composer.
    var composerSlot: some View {
        // The only part of the chat that observes the draft: typing
        // re-renders the composer, never the transcript.
        ObservingView(model: draftModel) {
            Group {
                if session.account?.canWrite(in: threadId) == false {
                    AnyView(ReadOnlyConversationNote(chat: current) { selectedThreadId = $0 })
                } else if desktopChat != nil {
                    AnyView(desktopComposer)
                } else {
                    AnyView(composer)
                }
            }
        }
    }

    /// Behind the transcript: the desktop's glow, or the phone's ground.
    var chatBackground: some View {
        Group {
            if desktopChat != nil {
                AnyView(DesktopAppGlow())
            } else {
                AnyView(Theme.bg.skinTexture(Theme.palette.texture, ink: Theme.palette.textPrimary.uiColor).ignoresSafeArea())
            }
        }
    }

    /// The desktop field's placeholder ("Message Ara").
    var desktopPrompt: String {
        if sendingMessage { return String(localized: "Sending…") }
        if dictation.isListening { return String(localized: "Listening…") }
        // Composer.tsx: an open approval stays open while the person writes
        if !dockApprovals.isEmpty { return String(localized: "Answer the approval above, or write something else: it stays open") }
        let name = PeopleDirectory.shared.name(current, session: session)
        // composer-placeholder.ts: a group says who answers
        // ("Message Peer Managers · Ara responds")
        if case let .room(room) = current, room.peopleDm != true {
            if current.busy { return String(localized: "Write a message…") }
            return String(localized: "Message \(name) · \(desktopRoomHint(room))")
        }
        return String(localized: "Message \(name)")
    }

    /// `groupComposerHint` (src/lib/group-routing.ts).
    func desktopRoomHint(_ room: Room) -> String {
        if room.dm == true { return String(localized: "continue the conversation") }
        let value = RoomResponder.effective(room)
        switch value.kind {
        case "everyone": return String(localized: "everyone responds")
        case "mentions": return String(localized: "@ to bring a bot in")
        case "auto" where roomJevOn: return String(localized: "Jev picks who responds")
        default:
            let id = value.kind == "auto" ? (value.fallbackBotId ?? room.memberIds.first) : value.botId
            let lead = id.flatMap { session.state.bot($0)?.name } ?? String(localized: "Lead")
            return String(localized: "\(lead) responds")
        }
    }

    /// Export conversation > Copy as Markdown.
    func copyConversationMarkdown() {
        Task {
            if let url = await session.export(threadId: current.threadId, format: "markdown"),
               let text = try? String(contentsOf: url, encoding: .utf8) {
                PlatformBridge.copyToPasteboard(text)
            }
        }
    }

    /// Export conversation > Download as .md: the file, to the share sheet.
    func exportConversation() {
        Task {
            if let url = await session.export(threadId: current.threadId, format: "markdown") {
                shareFile = ShareFile(url: url)
            }
        }
    }

    /// The desktop composer: the pill (Desktop/DesktopComposer.swift) in a
    /// dock as wide as the transcript column, 16 pt above the bottom; its
    /// "/" and @ popups float above it.
    var desktopComposer: some View {
        VStack(spacing: 6) {
            composerAccessories
            AnyView(DesktopComposerPill(
                draft: draftBinding,
                prompt: desktopPrompt,
                focused: $composerFocused,
                canSend: canSend,
                blocked: activeSendBlock?.blocksSend == true,
                busy: preparingAttachments || sendingMessage,
                listening: dictation.isListening,
                inputLocked: dictation.isListening || dictation.isStarting || preparingAttachments || sendingMessage
                    || activeSendBlock?.locksComposer == true,
                bot: current.isBot ? session.state.bot(current.id)?.projected(forThread: threadId) : nil,
                room: { if case let .room(room) = current, room.dm != true { return room } else { return nil } }(),
                popup: desktopComposerPopup,
                attachPhotos: { showingPhotoPicker = true },
                attachFiles: { showingFileImporter = true },
                more: {
                    dictation.stop()
                    composerFocused = false
                    withAnimation(.snappy(duration: 0.28)) { showingPlus.toggle() }
                },
                openModel: { desktopChat?.openModelPicker() },
                openAllowlist: { desktopChat?.showAllowlist() },
                toggleDictation: {
                    composerFocused = false
                    dictation.toggle(capturing: draft)
                },
                send: { submit() },
                voice: startVoiceMode,
                hardwareReturn: { submit() },
                draftChanged: { old, new in draftChanged(from: old, to: new) }
            ))
            // ⌘I, ⌘L, ⌘D (DesktopKeyCommands): the field, a quote of the
            // selected text, dictation
            .onReceive(NotificationCenter.default.publisher(for: DesktopComposerCommand.notification)) { note in
                switch DesktopComposerCommand.from(note) {
                case .focus: composerFocused = true
                case .quote:
                    if let selection = DesktopComposerCommand.selectedText() {
                        draft = DesktopComposerCommand.quoted(selection, into: draft)
                    }
                    composerFocused = true
                case .dictate:
                    composerFocused = false
                    dictation.toggle(capturing: draft)
                case nil: break
                }
            }
        }
        // the dock is `px-4` (the transcript `px-5`), both at most 960
        .frame(maxWidth: DesktopShellRules.chatColumn)
        .padding(.horizontal, 16)
        .padding(.bottom, 16)
        .frame(maxWidth: .infinity)
        .task(id: commandLoadKey) { await loadCommands() }
        .task(id: heldSends.isEmpty) {
            if !heldSends.isEmpty { await power.load(botIds: [], threadId: nil, groupId: nil, session: session) }
        }
    }

    /// The "/" menu or the @ / # suggestions, for the pill to float.
    var desktopComposerPopup: AnyView? {
        let menuItems = slashMenuItems
        if slashContext != nil, !menuItems.isEmpty || power.loadingCommands {
            return AnyView(ComposerCommandMenuView(
                items: menuItems,
                loading: power.loadingCommands,
                accent: desktopChatText?.accent ?? MausPalette.color(current.color),
                refresh: commandTargets.contains { power.commands(botId: $0.member.id, threadId: threadId, groupId: current.isBot ? nil : current.id)?.available == true }
                    ? { Task { await loadCommands(refresh: true) } } : nil,
                close: closeCommandMenu,
                pick: pickCommand
            ))
        }
        let suggestions = suggestionItems
        if !suggestions.isEmpty {
            return AnyView(SuggestionStrip(items: suggestions, pick: pickSuggestion))
        }
        return nil
    }
}

/// Cuts the transcript under the open find bar: the header's 52 pt and
/// the bar's 37, as the desktop's column lays the bar out before the
/// scroll view (its header still floats over the glow above).
struct DesktopFindClip: ViewModifier {
    let open: Bool

    func body(content: Content) -> some View {
        if open {
            content.mask(alignment: .top) {
                VStack(spacing: 0) {
                    Color.clear.frame(height: 52 + 37)
                    Color.black
                }
            }
        } else {
            content
        }
    }
}

// MARK: - Header

/// The bot pill (41 tall, radius full, card fill, hairline ring, mascot 24,
/// name 14 medium) centred at y 7.5, and 36 pt round buttons 20 pt from the
/// trailing edge at y 10: Export, then the panel toggle. With the panel
/// docked open, the panel's own top bar holds them.
/// The chat header (ChatView.tsx `content-topbar`, measured in
/// desktop-1376x1032-03-main.json): the bot pill centred (`BotHeaderPill`:
/// mascot 24, the name 14/20 medium, a 14 pt chevron in the tertiary ink
/// that turns while the panel is open; the pill opens and closes the panel,
/// ⌘.), and at the right, 8 apart: one round "More options" (36) for the
/// conversation (Copy as Markdown, Export ›, Inspector), the thread picker
/// while threads show in the header, Dev pods, and the round New topic (32)
/// while threads are off. While the docked panel is open its top bar holds
/// the same menu.
struct DesktopChatHeader: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let chat: Chat
    let chrome: DesktopChatChrome
    let export: () -> Void
    let copyMarkdown: () -> Void
    /// Development context pods (Settings > Experimental): the button shows
    /// while the conversation looks like development work.
    var devPods: (() -> Void)? = nil
    var devPodsOpen = false
    let openProfile: () -> Void
    @State private var moreOpen = DesktopChatHeader.parityExport
    @State private var exportOpen = false
    /// Appearance > Inspector button (off by default, as on the desktop).
    @AppStorage(DesktopInspectorButton.key) private var showInspector = false
    @EnvironmentObject private var model: DesktopShellModel
    @ObservedObject private var prefs = SidebarPrefsModel.shared
    @State private var threadsOpen = DesktopChatHeader.parityThreads
    @Environment(\.openWindow) private var openWindow

    private var panelOpen: Bool { chrome.panelOpen }

    var body: some View {
        ZStack(alignment: .top) {
            Button(action: openProfile) {
                HStack(spacing: 8) {
                    // a group wears the desktop's GroupAvatarStack (SplitWorkspace.tsx)
                    if case let .room(room) = chat, PeopleDirectory.shared.peer(room, session: session) == nil {
                        DesktopGroupAvatarStack(members: room.memberIds.compactMap { session.state.bot($0) }, size: 24)
                    } else {
                        ChatAvatarView(chat: chat, size: 24, state: MausState.forChat(chat, in: session.state), background: theme.chrome)
                            .frame(width: 24, height: 24)
                    }
                    Text(verbatim: PeopleDirectory.shared.name(chat, session: session))
                        .font(theme.font(14, .medium))
                        .foregroundStyle(theme.ink)
                        .lineLimit(1)
                    if ConfidentialBanner.shows(for: chat) {
                        ConfidentialMark()
                    }
                    do {
                        DesktopIconView(icon: .chevronRight, size: 14, strokeWidth: 2)
                            .foregroundStyle(theme.inkTertiary)
                            .rotationEffect(.degrees(panelOpen ? 90 : 0))
                            .animation(.easeOut(duration: 0.16), value: panelOpen)
                    }
                }
                .padding(.leading, 8)
                .padding(.trailing, 12)
                .frame(height: 41)
                .background(theme.elevated, in: Capsule())
                .overlay(Capsule().strokeBorder(theme.hairlineWeak, lineWidth: 0.5))
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
            .keyboardShortcut(".", modifiers: .command)
            .frame(maxWidth: 360)
            .padding(.top, 7.5)
            .accessibilityLabel(Text(chat.isBot
                ? (panelOpen ? "Close \(chat.name)'s panel" : "Open \(chat.name)'s panel")
                : LocalizedStringKey(chat.name)))
            .accessibilityIdentifier("desktop-chat-pill")

            if !(chrome.panelOpen && chrome.panelDocked) {
                HStack(spacing: 8) {
                    Spacer(minLength: 0)
                    DesktopRoundButton(systemImage: "ellipsis", label: "More options", active: moreOpen, icon: .ellipsis) {
                        exportOpen = false
                        moreOpen.toggle()
                    }
                    .overlay(alignment: .topTrailing) {
                        if moreOpen { moreMenu }
                    }
                    .zIndex(1)
                    .accessibilityIdentifier("desktop-chat-more")
                    if case let .bot(bot) = chat, DesktopSidebarState.headerThreads(model: model, prefs: prefs) {
                        DesktopThreadPickerButton(bot: bot, open: $threadsOpen)
                    }
                    if let devPods {
                        DesktopRoundButton(systemImage: "sidebar.squares.right", label: "devPods.toggle.show", active: devPodsOpen, action: devPods)
                            .accessibilityIdentifier("desktop-dev-pods-toggle")
                    }
                    if case let .bot(bot) = chat, !DesktopSidebarState.threadsOn(model: model, prefs: prefs) {
                        DesktopNewTopicButton(bot: bot)
                    }
                }
                .padding(.top, 10)
                .padding(.trailing, 20)
            } else if case let .bot(bot) = chat, !DesktopSidebarState.threadsOn(model: model, prefs: prefs) {
                // the docked panel's bar holds the menu; New topic stays here
                HStack { Spacer(minLength: 0); DesktopNewTopicButton(bot: bot) }
                    .padding(.top, 10)
                    .padding(.trailing, 20)
            }
        }
        .frame(maxWidth: .infinity)
    }

    /// The Inspector row: an admin's, or the bot's owner on an organization server.
    private var inspectorAllowed: Bool {
        guard showInspector, case let .bot(bot) = chat else { return false }
        return session.surfaceGate.allows(.inspector, bot: session.state.bot(bot.id) ?? bot)
    }
}

extension DesktopChatHeader {
    /// `ExportTranscriptMenu`: Copy as Markdown, Export › (Download as .md),
    /// Split right and Split down, then the Inspector. 4 pt under the
    /// button, its trailing edge aligned; Export's submenu opens to its
    /// left. The desktop splits its own window (#1504); iPadOS opens the
    /// conversation in a second window scene beside this one, its own
    /// multi-window split (DesktopConversationWindow).
    var moreMenu: some View {
        VStack(alignment: .leading, spacing: 2) {
            menuRow(DesktopLucide.copy, Text("Copy as Markdown")) {
                moreOpen = false
                copyMarkdown()
            }
            menuRow(DesktopLucide.share, Text("Export"), chevron: true, active: exportOpen) {
                exportOpen.toggle()
            }
            .overlay(alignment: .topLeading) {
                if exportOpen { exportSubmenu }
            }
            .zIndex(1)
            if DesktopConversationWindow.supportsScenes {
                Rectangle().fill(theme.border).frame(height: 0.5).padding(.horizontal, 8).padding(.vertical, 4)
                menuRow(DesktopLucide.columns2, Text("Split right")) {
                    moreOpen = false
                    DesktopConversationWindow.open(chat, edge: .right, openWindow: openWindow)
                }
                .accessibilityIdentifier("desktop-split-right")
                menuRow(DesktopLucide.rows2, Text("Split down")) {
                    moreOpen = false
                    DesktopConversationWindow.open(chat, edge: .bottom, openWindow: openWindow)
                }
                .accessibilityIdentifier("desktop-split-down")
            }
            if inspectorAllowed {
                Rectangle().fill(theme.border).frame(height: 0.5).padding(.horizontal, 8).padding(.vertical, 4)
                menuRow(nil, Text("Inspector"), checked: chrome.inspectorOpen, icon: .activity) {
                    moreOpen = false
                    chrome.toggleInspector()
                }
            }
        }
        .padding(6)
        .frame(width: 240, alignment: .leading)
        .background(theme.elevated, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        // the reference draws its 0.5 px border as one point (two pixels)
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.border, lineWidth: 1))
        .fixedSize()
        // 4 pt under the 36 pt button, its trailing edge on the button's
        .offset(y: 40)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-export-menu")
    }

    private var exportSubmenu: some View {
        VStack(alignment: .leading, spacing: 2) {
            menuRow(DesktopLucide.download, Text("Download as .md")) {
                exportOpen = false
                moreOpen = false
                export()
            }
        }
        .padding(6)
        .frame(width: 218, alignment: .leading)
        .background(theme.elevated, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.border, lineWidth: 0.5))
        .fixedSize()
        // beside the Export row, to its left (the menu sits at the window's edge)
        .offset(x: -(218 + 12 + 4), y: -6)
    }

    /// `flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] leading-[18px]`, 30 tall.
    private func menuRow(_ glyph: [String]?, _ title: Text, chevron: Bool = false, active: Bool = false,
                         checked: Bool? = nil, icon: DesktopIcon? = nil, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if let glyph { DesktopLucideGlyph(paths: glyph, size: 16) }
                else if let icon { DesktopIconView(icon: icon, size: 16) }
                title.font(theme.font(13)).lineLimit(1)
                Spacer(minLength: 0)
                if chevron { DesktopIconView(icon: .chevronRight, size: 14).foregroundStyle(theme.inkTertiary) }
                if let checked { DesktopIconView(icon: .check, size: 14).foregroundStyle(theme.accent).opacity(checked ? 1 : 0) }
            }
            .foregroundStyle(theme.ink)
            .padding(.horizontal, 8)
            .frame(height: 30)
            .background(active ? theme.hover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
    }

    #if DEBUG
    static var parityExport: Bool { ParityLaunch.current?.iPadScreen == .chatExportMenu }
    static var parityThreads: Bool { ParityLaunch.current?.iPadScreen == .chatThreads }
    #else
    static let parityExport = false
    static let parityThreads = false
    #endif
}

/// `NewTopicButton` (ChatView.tsx), while threads are off: a 32 pt circle,
/// the hairline ring on the elevated fill, a 15 pt square-pen in the
/// secondary ink. A fresh empty draft over the live topic; nothing is
/// deleted, the server makes the topic with its first message.
struct DesktopNewTopicButton: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let bot: Bot
    @State private var hovering = false

    var body: some View {
        Button {
            session.startNewTopic(bot)
        } label: {
            DesktopIconView(icon: .squarePen, size: 15)
                .foregroundStyle(hovering ? theme.ink : theme.inkSecondary)
                .frame(width: 32, height: 32)
                .background(hovering ? theme.elevatedHover : theme.elevated, in: Circle())
                .overlay(Circle().strokeBorder(theme.hairlineWeak, lineWidth: 0.5))
                // 44 pt for a finger
                .frame(width: 44, height: 44)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .padding(-6)
        .onHover { hovering = $0 }
        .accessibilityLabel(Text("Start a new topic with \(bot.name)"))
        .accessibilityIdentifier("desktop-new-topic")
    }
}

/// A 36 pt round chrome button: card fill, hairline ring, 18 pt glyph.
struct DesktopRoundButton: View {
    @Environment(\.desktopTheme) private var theme
    let systemImage: String
    let label: LocalizedStringKey
    var active = false
    /// The renderer's own lucide glyph (18 pt, stroke 1.75) instead of the symbol.
    var icon: DesktopIcon? = nil
    /// Or a lucide glyph's paths (DesktopLucide).
    var lucide: [String]? = nil
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            glyph
                .foregroundStyle(theme.ink)
                .frame(width: 36, height: 36)
                .background(active ? theme.elevatedHover : theme.elevated, in: Circle())
                .overlay(Circle().strokeBorder(theme.hairlineWeak, lineWidth: 1))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityLabel(Text(label))
    }

    @ViewBuilder
    private var glyph: some View {
        if let lucide {
            DesktopLucideGlyph(paths: lucide, size: 18, strokeWidth: 1.75)
        } else if let icon {
            DesktopIconView(icon: icon, size: 18, strokeWidth: 1.75)
        } else {
            Image(systemName: systemImage).font(.system(size: 15, weight: .regular))
        }
    }
}

/// The engines' model catalogue, read once per pairing for the composer chips.
@MainActor
final class DesktopModelCatalog {
    static let shared = DesktopModelCatalog()
    private var cached: (connection: String?, instances: [Instance])?

    func instances(_ session: Session, reload: Bool = false) async -> [Instance] {
        let connection = session.connection?.id
        if !reload, let cached, cached.connection == connection, !cached.instances.isEmpty { return cached.instances }
        // quietly: a chip that cannot load stays hidden, never an alert
        guard !session.isDemo, let client = session.profileClient else { return [] }
        let loaded = (try? await client.instances()) ?? []
        cached = (connection, loaded)
        return loaded
    }
}

/// A conversation this device may read but not write in (a guest on a
/// Cloud home, in a conversation it did not start; cloud-guest.ts): the
/// "Read-only" pill and "New conversation" in place of the composer, as the
/// desktop's NewConversationInstead, instead of a send that fails.
struct ReadOnlyConversationNote: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    let chat: Chat
    let opened: (String) -> Void
    @State private var starting = false

    var body: some View {
        VStack(spacing: 10) {
            Label("Read-only", systemImage: "lock.fill")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .padding(.horizontal, 12).padding(.vertical, 5)
                .background(Capsule().fill(Color.secondary.opacity(0.15)))
                .accessibilityIdentifier("chat-read-only")
            Text("You can only write in conversations you started on this Cloud.")
                .font(.footnote)
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
            if case let .bot(bot) = chat {
                Button {
                    starting = true
                    Task {
                        if let created = await session.createTask(for: bot, title: nil, confidential: false) {
                            await session.loadAccount()
                            opened(created.threadId)
                        }
                        starting = false
                    }
                } label: {
                    Text("New conversation")
                }
                .buttonStyle(.bordered).buttonBorderShape(.capsule)
                .disabled(starting)
                .accessibilityIdentifier("chat-read-only-new")
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 24)
        .padding(.top, 8)
        .padding(.bottom, 30)
        // a conversation this device just opened is not in the answer it
        // had: ask again once before saying no (useCanWriteIn)
        .task(id: chat.threadId) { await session.loadAccount() }
    }
}

// MARK: - Split right / Split down

/// The desktop's Split right and Split down (ExportTranscriptMenu.tsx
/// `onSplit`, src/lib/split-view.ts) put this conversation in a new section
/// of its window. iPadOS splits by windows: the conversation opens in a
/// second window scene, placed beside this one where the system can
/// (Split View, Stage Manager), as the bot's computer window does
/// (DesktopComputerWindow). iPadOS decides the arrangement: right and down
/// both ask for a window beside this one.
enum DesktopConversationWindow {
    enum Edge: String { case right, bottom }

    /// The scene's id (`WindowGroup(id:for:)`); its value is `bot:<id>` or `room:<id>`.
    static let sceneId = "conversation-window"

    @MainActor
    static var supportsScenes: Bool { UIApplication.shared.supportsMultipleScenes || ParityMode.isActive }

    static func value(for chat: Chat) -> String {
        switch chat {
        case let .bot(bot): return "bot:\(bot.id)"
        case let .room(room): return "room:\(room.id)"
        }
    }

    @MainActor
    static func open(_ chat: Chat, edge: Edge, openWindow: OpenWindowAction) {
        guard UIApplication.shared.supportsMultipleScenes else { return }
        openWindow(id: sceneId, value: value(for: chat))
    }
}

/// The conversation's own window: the desktop chat column, its header and
/// composer, on the app ground; the bot panel and the Inspector work in it
/// as in the main window.
struct DesktopConversationWindowScene: View {
    @Environment(\.themePalette) private var themePalette
    @EnvironmentObject private var session: Session
    @StateObject private var model = DesktopShellModel()
    let value: String

    private var chat: Chat? {
        let parts = value.split(separator: ":", maxSplits: 1).map(String.init)
        guard parts.count == 2 else { return nil }
        if parts[0] == "bot", let bot = session.state.bot(parts[1]) { return .bot(bot) }
        if parts[0] == "room", let room = session.state.rooms.first(where: { $0.id == parts[1] }) { return .room(room) }
        return nil
    }

    var body: some View {
        let theme = DesktopTheme.of(themePalette)
        ZStack {
            theme.app.ignoresSafeArea()
            if let chat {
                DesktopChatColumn(chat: chat)
                    .accessibilityIdentifier("desktop-conversation-window")
            }
        }
        .environmentObject(model)
        .environment(\.desktopTheme, theme)
        .preferredColorScheme(theme.dark ? .dark : .light)
    }
}

// MARK: - A group's banners

/// GroupView.tsx under its header (a band, not a float): the group usage
/// notice (ChatUsageNotices.tsx `GroupCostNotice`, dismissed for good) and
/// the group instructions line (the bulletin: a pin and its first line, or
/// "Add group instructions…"; tapped, an editor that saves on leaving it).
struct DesktopRoomBanners: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let room: Room
    @AppStorage("sagax.notice.dismissed.group-cost") private var costDismissed = false
    @State private var editing = false
    @State private var draft = ""
    @FocusState private var focused: Bool

    /// `showsGroupCostNotice`: a group of two bots or more.
    static func showsCostNotice(_ room: Room) -> Bool {
        room.dm != true && room.peopleDm != true && room.memberIds.count > 1
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if !costDismissed && Self.showsCostNotice(room) {
                HStack(alignment: .top, spacing: 8) {
                    Text("Group conversations use more: every bot in the group reads the whole thread. For a simple question, chat with a single bot instead.")
                        .font(theme.font(13))
                        // CSS's 1.5 line box (19.5 pt), not the face's own line
                        .lineSpacing(max(0, 19.5 - theme.uiFont(13).lineHeight))
                        .frame(minHeight: 19.5)
                        .foregroundStyle(theme.inkSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                    Button { costDismissed = true } label: {
                        DesktopIconView(icon: .x, size: 13)
                            .foregroundStyle(theme.inkSecondary)
                            .frame(width: 17, height: 17)
                            .frame(width: 32, height: 32)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .padding(-7.5)
                    .accessibilityLabel(Text("Dismiss the group conversation usage notice"))
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.4), lineWidth: 1))
                .padding(.bottom, 8)
                .accessibilityIdentifier("desktop-group-cost-notice")
            }
            if room.peopleDm != true { bulletin }
        }
        .padding(.horizontal, 20)
    }

    private var editable: Bool { session.roomAccess(room).editable }

    @ViewBuilder
    private var bulletin: some View {
        if editing {
            TextEditor(text: $draft)
                .font(theme.font(13))
                .foregroundStyle(theme.ink)
                .scrollContentBackground(.hidden)
                .focused($focused)
                .frame(height: 4 * 21)
                .padding(8)
                .background(theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.4), lineWidth: 1))
                .padding(.bottom, 4)
                .onAppear { focused = true }
                .onValueChange(of: focused) { if !$0 { save() } }
                .accessibilityLabel(Text("Group instructions: every bot in this group follows them (who does what, tone, goals, a task checklist…)"))
        } else {
            Button {
                guard editable else { return }
                draft = room.bulletin
                editing = true
            } label: {
                HStack(spacing: 8) {
                    DesktopIconView(icon: .pin, size: 12).foregroundStyle(theme.inkSecondary)
                    Group {
                        if let first = room.bulletin.split(separator: "\n").first, !first.isEmpty {
                            Text(verbatim: String(first)).foregroundStyle(theme.inkSecondary)
                        } else {
                            Text("Add group instructions…").foregroundStyle(theme.inkTertiary)
                        }
                    }
                    .font(theme.font(12.5))
                    .lineLimit(1)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 8)
                // `py-1.5` around a 12.5 pt line at 1.5 (18.75)
                .frame(height: 30.75)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
            .disabled(!editable)
            .padding(.bottom, 4)
            .accessibilityHint(Text("Group instructions: shared instructions for every bot here"))
            .accessibilityIdentifier("desktop-group-bulletin")
        }
    }

    private func save() {
        editing = false
        guard draft != room.bulletin else { return }
        let text = draft
        Task { _ = await session.patchRoom(room, RoomPatch(bulletin: text)) }
    }
}
