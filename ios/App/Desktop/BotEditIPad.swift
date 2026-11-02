// Edit bot on the iPad (lots 2 and 3, 2026-11-01): the same Grok-style
// tree as the iPhone (`BotEditTree`) in the desktop's cards. Name, Role,
// Description, Appearance, Voice calls and More voice options sit on the
// root; Instructions, Skills, Memory, Model, Approvals, Tools and apps,
// Routines, Sharing and Advanced are one tap away. A section opens the
// desktop's own section view (`BotPanelMore`). Search stays on the iPad
// first page (the phone root dropped it).
import CompanionCore
import SwiftUI

struct BotEditIPadSheet: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    let bot: Bot
    let slackURL: URL?

    /// The tree's pages open under the first one, outermost first.
    @State private var pages: [BotEditPageID] = []
    @State private var routinesOpen = false
    @State private var query = ""
    @State private var rules: [CustomRuleRow]?
    @State private var routines: [Routine]?
    @State private var confirmingArchive = false
    @State private var confirmingDelete = false

    private var current: Bot { session.state.bot(bot.id) ?? bot }
    private var context: BotEditContext { BotEditContext(gate: session.surfaceGate, bot: current, slack: slackURL != nil) }
    private var page: BotEditPageID { pages.last ?? .root }
    private var summaries: BotEditSummaries { BotEditSummaries(bot: current, rules: rules, routines: routines) }

    private var title: LocalizedStringKey {
        if let section = model.panelSection { return section.title }
        if routinesOpen { return "Routines" }
        return page.title
    }

    private var canGoBack: Bool { model.panelSection != nil || routinesOpen || !pages.isEmpty }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                if canGoBack {
                    DesktopRoundButton(systemImage: "chevron.left", label: "Back") { back() }
                        .accessibilityIdentifier("desktop-panel-back")
                }
                Text(title)
                    .font(theme.font(15, .semibold))
                    .foregroundStyle(theme.ink)
                Spacer(minLength: 0)
                DesktopRoundButton(systemImage: "xmark", label: "Close") { model.personaOpen = false }
                    .keyboardShortcut(.escape, modifiers: [])
                    .accessibilityIdentifier("desktop-persona-close")
            }
            .padding(.horizontal, 12)
            .frame(height: 52)
            ScrollViewReader { proxy in
                ScrollView {
                    AnyView(content)
                        .frame(maxWidth: 640, alignment: .topLeading)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 4)
                    Color.clear.frame(height: 1).id("persona-end")
                }
                .scrollDismissesKeyboard(.interactively)
                .task {
                    #if DEBUG
                    if UserDefaults.standard.bool(forKey: "parityBotEditBottom") {
                        try? await Task.sleep(nanoseconds: 900_000_000)
                        proxy.scrollTo("persona-end", anchor: .bottom)
                    }
                    #endif
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(theme.app)
        .onAppear {
            follow(model.panelSection)
            #if DEBUG
            applyParityRoute()
            #endif
        }
        .onValueChange(of: model.panelSection) { follow($0) }
        .task(id: bot.id) {
            routines = await session.loadRoutines().routines
            if context.sections.contains(.permissions), let client = session.settingsClient {
                rules = (try? await client.customRules(botId: bot.id))?.rules
            }
        }
        .confirmationDialog(Text("Archive \(current.name)?"), isPresented: $confirmingArchive, titleVisibility: .visible) {
            Button("Archive") {
                let target = current
                Task {
                    if await session.setArchived(target, archived: true) {
                        model.personaOpen = false
                        model.togglePanel()
                    }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Its conversations are kept. Archived bots in the account menu brings it back.")
        }
        .confirmationDialog(Text("Delete \(current.name)?"), isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                let target = current
                Task {
                    if await session.deleteBot(target) {
                        model.personaOpen = false
                        if model.panelOpen { model.togglePanel() }
                    }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(String(localized: "The bot and its conversations will be deleted. This cannot be undone."))
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-persona-editor")
    }

    @ViewBuilder
    private var content: some View {
        if model.panelSection != nil {
            BotPanelMore(bot: current, slackURL: slackURL)
        } else if routinesOpen {
            BotPanelRoutines(bot: current)
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
        } else {
            VStack(spacing: 0) {
                // Search retired on the phone Edit root (lot 2); iPad keeps it
                // above the same Grok-style tree.
                if page == .root { searchField }
                if page == .root, !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    results
                } else {
                    cards(page)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier(page == .root ? "desktop-panel-more" : "desktop-edit.\(page.rawValue)")
        }
    }

    // MARK: Pages

    private func cards(_ page: BotEditPageID) -> some View {
        let cards = BotEditTree.cards(page, context)
        return VStack(spacing: 0) {
            ForEach(Array(cards.enumerated()), id: \.offset) { index, card in
                if index > 0 { Color.clear.frame(height: card.first?.destructive == true ? 20 : 16) }
                switch card.first {
                case .name?:
                    PhoneBotIdentityFields(bot: current) { editAvatar() }
                case .callVoice?:
                    ProfileSectionLabel(text: "Voice calls", margin: 0)
                    PhoneBotCallVoiceCard(bot: current)
                case .voiceAlerts?:
                    // iPad still opens the voice section; the phone uses a disclosure.
                    VStack(spacing: 0) {
                        ForEach(card, id: \.self) { row($0) }
                    }
                    .padding(1)
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairlineWeak, lineWidth: 1))
                default:
                    VStack(spacing: 0) {
                        ForEach(Array(card.enumerated()), id: \.element) { position, item in
                            if position > 0 { Rectangle().fill(theme.hairlineWeak).frame(height: 1) }
                            row(item)
                        }
                    }
                    .padding(1)
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairlineWeak, lineWidth: 1))
                }
                if let footer = footer(card) {
                    Text(footer)
                        .font(theme.font(12))
                        .foregroundStyle(theme.inkSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 4)
                        .padding(.top, 6)
                }
            }
        }
    }

    private func footer(_ card: [BotEditItem]) -> LocalizedStringKey? {
        switch card.first {
        case .name?: "Shown in rosters, on the phone and to other bots. Standing instructions go in Instructions."
        case .archive?: "Its conversations are kept. Archived bots in the account menu brings it back."
        case .delete?: "The bot and its conversations will be deleted. This cannot be undone."
        default: nil
        }
    }

    private func row(_ item: BotEditItem) -> some View {
        let value = summaries.value(item)
        let destructive = item.destructive
        return Button { open(item) } label: {
            HStack(spacing: 10) {
                Text(item.title)
                    .font(theme.font(13))
                    .foregroundStyle(destructive ? theme.danger : theme.ink)
                    .lineLimit(1)
                Spacer(minLength: 12)
                if let value {
                    Text(verbatim: value)
                        .font(theme.font(12.5))
                        .foregroundStyle(theme.inkSecondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                if !destructive {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10.5, weight: .medium))
                        .foregroundStyle(theme.inkSecondary)
                }
            }
            .padding(.horizontal, 12)
            .frame(height: 39.5)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityValue(Text(verbatim: value ?? ""))
        .accessibilityIdentifier(item.section.map { "desktop-panel-row.\($0.rawValue)" } ?? "desktop-edit-row.\(item.rawValue)")
    }

    // MARK: Search

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 12.5))
                .foregroundStyle(theme.inkSecondary)
            TextField("", text: $query, prompt: Text("Search").foregroundColor(theme.inkSecondary))
                .font(theme.font(13))
                .foregroundStyle(theme.ink)
                .tint(theme.focus)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityLabel(Text("Search settings"))
        }
        .padding(.horizontal, 10)
        .frame(height: 33.5)
        .background(theme.elevated, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairlineWeak, lineWidth: 1))
        .padding(.bottom, 16)
    }

    /// The sections whose name or keywords hold the query, each opened
    /// through its page.
    private var results: some View {
        let shown = context.sections.sorted { $0.rawValue < $1.rawValue }
            .filter { $0.matches(query, label: $0.localizedTitle) }
            .compactMap(BotEditTree.item(for:))
        return VStack(spacing: 0) {
            if shown.isEmpty {
                Text("Nothing matches “\(query.trimmingCharacters(in: .whitespacesAndNewlines))”")
                    .font(theme.font(12.5))
                    .foregroundStyle(theme.inkSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(shown.enumerated()), id: \.element) { index, item in
                        if index > 0 { Rectangle().fill(theme.hairlineWeak).frame(height: 1) }
                        row(item)
                    }
                }
                .padding(1)
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairlineWeak, lineWidth: 1))
            }
        }
    }

    // MARK: Navigation

    private func open(_ item: BotEditItem) {
        switch item {
        case .archive: confirmingArchive = true
        case .delete: confirmingDelete = true
        case .routines: routinesOpen = true
        case .avatar: editAvatar()
        default:
            if let next = item.opens {
                pages = BotEditTree.path(to: item, context).map { $0 + [next] } ?? [next]
            } else if let section = item.section {
                pages = BotEditTree.path(to: section, context) ?? []
                query = ""
                model.panelSection = section
            }
        }
    }

    private func back() {
        if model.panelSection != nil {
            model.panelSection = nil
        } else if routinesOpen {
            routinesOpen = false
        } else if !pages.isEmpty {
            pages.removeLast()
        }
    }

    /// A section opened from outside (a suggestion, Share): its page under it.
    private func follow(_ section: DesktopPanelSection?) {
        guard let section, let path = BotEditTree.path(to: section, context), pages != path else { return }
        pages = path
    }

    /// The avatar editor sits on the panel, under this sheet.
    private func editAvatar() {
        model.personaOpen = false
        withAnimation(.easeOut(duration: 0.15)) { model.avatarEditorOpen = true }
    }

    #if DEBUG
    /// `-parityBotEditRoute <page>` opens a tree page (a section has its
    /// own `panel-more-<section>` surface).
    private func applyParityRoute() {
        guard ParityLaunch.current != nil, let route = UserDefaults.standard.string(forKey: "parityBotEditRoute") else { return }
        if route == "routines" { routinesOpen = true; return }
        guard let page = BotEditPageID(rawValue: route), page != .root else { return }
        pages = [page]
    }
    #endif
}
