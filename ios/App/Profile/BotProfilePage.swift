// Bot profile page, the desktop's BotProfilePage (#2127, #2313, #3030) on
// iPhone and iPad: the mascot's colour wash, the bare mascot centred on it
// (a tap plays a move), the name with its title under it (never
// "Name · Title"), who sees it, the owner, the Primary badge and the
// description, all edited in place. A top bar that condenses on scroll
// (mascot 26, name 14), Private / Shared as a label, Share and the "…"
// menu (Archive, Delete) only where this pairing allows them (hidden, never
// greyed). Pill tabs General / Appearance / Knowledge / Analytics with a
// search beside them. The tabs follow the desktop's page (#3398 to #3403):
// General's Settings, Channels and Bot accounts cards with their controls
// in place, Knowledge's To review and Skills cards, and Analytics opening
// on the block of the reference.
import CompanionCore
import SwiftUI
import UIKit

enum BotProfileTab: String, CaseIterable, Hashable, Identifiable {
    case general, knowledge, appearance, stats, settings
    var id: String { rawValue }

    /// Visible pills, the desktop's BOT_PROFILE_TABS (#3017, G1): Settings
    /// is folded into General; Stats shows only where usage is reachable.
    static var visible: [BotProfileTab] { [.general, .appearance, .knowledge, .stats] }

    var title: LocalizedStringKey {
        switch self {
        case .general: "General"
        case .knowledge: "Knowledge"
        case .appearance: "Appearance"
        case .stats: "Analytics"
        case .settings: "Settings"
        }
    }
}

/// The desktop's Appearance pane on the phone: its own shell model, the way
/// the bot wizard hosts the engines sheet.
private struct PhoneAppearancePane: View {
    @Environment(\.themePalette) var themePalette
    @StateObject private var shell = DesktopShellModel()
    let bot: Bot

    var body: some View {
        PersonaAppearancePane(bot: bot)
            .environmentObject(shell)
            // the page's palette, light or dark, as the hero above it (#4041):
            // the desktop's default theme drew dark cards on a light page
            .environment(\.desktopTheme, DesktopTheme.of(themePalette))
    }
}

struct BotProfilePage: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.desktopTheme) private var desktopTheme
    @EnvironmentObject private var session: Session
    @ObservedObject private var interfaceMode = DesktopInterfaceMode.shared
    let bot: Bot
    var startTab: BotProfileTab = .general
    let context: BotEditContext
    let actions: BotEditActions
    var slackURL: URL?
    /// iPad main column (#2136): X sits on the banner; no navigation back.
    var fillsMain = false
    /// Open the Appearance tab (an avatar click, Edit bot > Appearance):
    /// the desktop's `personaCategoryForSection(section) === "appearance"`.
    var openAppearance = false
    /// Told once the page has opened Appearance for `openAppearance`.
    var onAppearanceOpened: (() -> Void)?

    @State private var tab: BotProfileTab
    @State private var modelLabel: String?
    @State private var ruleCount: Int?
    @State private var reach: ReachMeView?
    @State private var reachLoaded = false
    @State private var reachOpen = false
    @State private var mail: BotInboundMail?
    @State private var mailLoaded = false
    @State private var capabilities: BotCapabilityList?
    @State private var capabilitiesFailed = false
    @State private var condensed = false
    /// The name's lower edge and the bar's lower edge, both on screen
    /// (global): the bar condenses once the name passes under it (#4041).
    @State private var nameEdge: CGFloat = .greatestFiniteMagnitude
    @State private var barEdge: CGFloat = 0
    @State private var searching = false
    @State private var vaultItems: [VaultItemPublic] = []
    @State private var vaultError: String?
    @State private var vaultBusy = false
    @State private var accountsSheet: AccountsSheet?
    @StateObject private var skills: BotSkillsModel
    @Environment(\.botPanelOpenChat) private var panelOpenChat
    @State private var query = ""
    @FocusState private var searchFocused: Bool
    @StateObject private var owlHandle = OwlMascotHandle()

    init(
        bot: Bot,
        startTab: BotProfileTab = .general,
        context: BotEditContext,
        actions: BotEditActions,
        slackURL: URL? = nil,
        fillsMain: Bool = false,
        openAppearance: Bool = false,
        onAppearanceOpened: (() -> Void)? = nil
    ) {
        self.bot = bot
        self.startTab = startTab
        self.context = context
        self.actions = actions
        self.slackURL = slackURL
        self.fillsMain = fillsMain
        self.openAppearance = openAppearance
        self.onAppearanceOpened = onAppearanceOpened
        // Settings is no longer a tab (#2136); land on General.
        var start: BotProfileTab = openAppearance ? .appearance : (startTab == .settings ? .general : startTab)
        #if DEBUG
        // `-parityBotProfileTab knowledge` (the captures): open that tab
        if let raw = UserDefaults.standard.string(forKey: "parityBotProfileTab"), let asked = BotProfileTab(rawValue: raw) {
            start = asked
        }
        #endif
        _tab = State(initialValue: start)
        _skills = StateObject(wrappedValue: BotSkillsModel(botId: bot.id))
    }

    private var current: Bot { session.state.bot(bot.id) ?? bot }

    /// The mascot's face, read once through the session's transcript memo
    /// (#3017, L16) instead of walking the whole thread per mascot.
    private var mascotState: MausState { MausState.forChat(.bot(current), in: session) }

    /// The pills this pairing shows: Stats only where usage is reachable.
    private var visibleTabs: [BotProfileTab] {
        BotProfileTab.visible.filter { $0 != .stats || context.sections.contains(.usage) }
    }

    private var sharedWithOthers: Bool {
        !(current.grants ?? []).isEmpty || !(current.directGrants ?? []).isEmpty
    }

    private var privateBot: Bool {
        BotPrivacyLabel.isPrivateToViewer(
            visibility: current.visibility,
            sharedWithOthers: sharedWithOthers,
            organization: session.surfaceGate.organization
        )
    }

    private var privacy: String {
        BotPrivacyLabel.text(
            visibility: current.visibility,
            sharedWithOthers: sharedWithOthers,
            organization: session.surfaceGate.organization
        )
    }

    /// Share opens who uses it, else who sees it; hidden when neither is here.
    private var canShare: Bool { context.sections.contains(.sharing) || context.sections.contains(.visibility) }

    private func openShare() {
        Haptics.selection()
        actions.openSection(context.sections.contains(.sharing) ? .sharing : .visibility)
    }

    private var mascotSize: CGFloat { fillsMain ? 150 : 110 }

    var body: some View {
        ZStack(alignment: .top) {
            GeometryReader { viewport in
            ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 0) {
                    banner
                    VStack(spacing: 0) {
                        hero
                        tabRow
                            .padding(.top, 16)
                            .padding(.bottom, 12)
                            .id("bot-profile-anchor.tabs")
                        tabBody
                            .padding(.bottom, 48)
                    }
                    // the desktop's 760 pt column (#3017, G14)
                    .frame(maxWidth: fillsMain ? 760 : .infinity)
                    .frame(maxWidth: .infinity)
                }
                // The page is exactly as wide as the screen: a row wider
                // than it scrolls or stacks inside itself, it never widens
                // the whole page past both edges (#4041).
                .frame(width: viewport.size.width)
            }
            #if DEBUG
            // `-parityBotProfileScroll tabs|accounts|more` (the captures): scroll there once loaded
            .task {
                guard let anchor = UserDefaults.standard.string(forKey: "parityBotProfileScroll") else { return }
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                proxy.scrollTo("bot-profile-anchor.\(anchor)", anchor: .top)
            }
            #endif
            }
            .scrollIndicators(.visible)
            // typing in the hero fields: drag the list to put the keyboard away (G17)
            .scrollDismissesKeyboard(.interactively)
            }
            if fillsMain { topBar }
        }
        // the top of the safe area is the bar's lower edge (the iPad's own
        // bar is 56 under it)
        .overlay(alignment: .top) {
            GeometryReader { box in
                Color.clear.onValueChange(of: box.frame(in: .global).minY, initial: true) { top in
                    barEdge = top + (fillsMain ? 56 : 0)
                    condense()
                }
            }
            .frame(height: 0)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
        .background(Theme.bg.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !fillsMain {
                ToolbarItem(placement: .topBarLeading) {
                    ProfileBackButton { actions.close() }
                }
                ToolbarItem(placement: .principal) {
                    condensedTitle.opacity(condensed ? 1 : 0)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    headerActions
                }
            }
        }
        .toolbarBackground(condensed ? AnyShapeStyle(.bar) : AnyShapeStyle(bannerTop), for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .navigationBarHidden(fillsMain)
        // One back button: ours, not the system one beside it.
        .navigationBarBackButtonHidden(true)
        .onAppear { openAppearanceIfAsked(openAppearance) }
        .task(id: bot.id) { await loadSummaries() }
        .onValueChange(of: openAppearance) { openAppearanceIfAsked($0) }
        .onValueChange(of: query) { _ in followSearch() }
        .sheet(isPresented: $reachOpen, onDismiss: { Task { await loadReach() } }) {
            NavigationStack {
                ReachMeSettingsPage(startBotId: current.id)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { reachOpen = false }
                        }
                    }
            }
            .environmentObject(session)
        }
        .sheet(item: $accountsSheet, onDismiss: { Task { await loadCapabilities() } }) { sheet in
            accountsSheetView(sheet)
        }
        // Keep children queryable for UITests (tabs, groups).
        .accessibilityIdentifier("bot-profile-page")
    }

    // MARK: Header

    /// `.bot-profile-banner`: the mascot's colour mixed into the base,
    /// 58 % at the top (the bar's colour), 36 % at the bottom.
    private var washColor: Color { MausPalette.color(current.color) }
    private var washBase: Color {
        if fillsMain { return themePalette.isDark ? Color(hex: "#F4F4F4") : .white }
        return themePalette.isDark ? Color(hex: "#2A2A2A") : .white
    }
    private var bannerTop: Color { DesktopMemoryPage.mix(washColor, washBase, 0.58) }

    private var banner: some View {
        LinearGradient(
            colors: [bannerTop, DesktopMemoryPage.mix(washColor, washBase, 0.36)],
            startPoint: .top,
            endPoint: .bottom
        )
        // iPad: the bar floats over the wash, so the wash runs under it
        .frame(height: fillsMain ? 152 : 104)
        .frame(maxWidth: .infinity)
        .accessibilityIdentifier("bot-profile-banner")
        .accessibilityHidden(true)
    }

    /// The desktop's header: no card, the bare mascot over the banner's
    /// lower edge, the name and title centred under it, then the facts.
    private var hero: some View {
        VStack(spacing: 10) {
            BotMascotView(
                bot: current,
                size: mascotSize,
                state: mascotState,
                animated: true,
                owlHandle: owlHandle
            )
            .frame(width: mascotSize + 20, height: mascotSize + 20)
            .contentShape(Rectangle())
            .onTapGesture { playMove() }
            .accessibilityElement()
            .accessibilityLabel(Text("Play a move"))
            .accessibilityAddTraits(.isButton)
            .accessibilityIdentifier("bot-profile-mascot")
            BotProfileHeroIdentity(bot: current, centered: true)
                .background(
                    GeometryReader { geo in
                        Color.clear.onValueChange(of: geo.frame(in: .global).maxY, initial: true) { edge in
                            nameEdge = edge
                            condense()
                        }
                    }
                )
            BotProfileHeroDetails(bot: current, audience: privacy, centered: true)
        }
        .frame(maxWidth: .infinity)
        // The hero's inks follow the page's palette on the phone too (light or dark).
        .environment(\.desktopTheme, fillsMain ? desktopTheme : DesktopTheme.of(themePalette))
        .padding(.horizontal, 24)
        .padding(.top, -(mascotSize * 0.55))
        // A picture dropped on the hero, or pasted from its menu, becomes the avatar.
        .botProfileHeroImageTarget(current)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("bot-profile-hero")
    }

    /// The condensed title: mascot 26, name 14.
    private var condensedTitle: some View {
        HStack(spacing: 8) {
            BotMascotView(bot: current, size: 26, state: mascotState, animated: false)
                .frame(width: 26, height: 26)
            Text(verbatim: current.name)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(fillsMain ? desktopTheme.ink : Theme.textPrimary)
                .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("bot-profile-condensed-title")
    }

    /// Private / Shared (a label, never a button), Share, then the "…" menu.
    private var headerActions: some View {
        HStack(spacing: 8) {
            HStack(spacing: 5) {
                Image(systemName: privateBot ? "lock" : "person.2")
                    .font(.system(size: 11, weight: .regular))
                Text(privateBot ? "Private" : "Shared")
                    .font(.system(size: 12, weight: .medium))
                    .lineLimit(1)
                    .fixedSize()
            }
            .foregroundStyle(fillsMain ? desktopTheme.inkSecondary : Theme.textSecondary)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("bot-profile-visibility")
            if canShare {
                Button(action: openShare) {
                    Text("Share")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(fillsMain ? desktopTheme.ink : Theme.textPrimary)
                        .lineLimit(1)
                        .fixedSize()
                        .padding(.horizontal, 12)
                        .frame(height: fillsMain ? 36 : 30)
                        .background(Capsule().fill(fillsMain ? desktopTheme.elevated : Theme.cardRaised))
                        .overlay(Capsule().strokeBorder(fillsMain ? desktopTheme.hairlineWeak : Theme.hairline, lineWidth: 1))
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("bot-profile-share")
            }
            if context.archive || context.delete {
                Menu {
                    if context.archive {
                        Button {
                            Haptics.selection()
                            actions.archive()
                        } label: {
                            Label("Archive…", systemImage: "archivebox")
                        }
                        .accessibilityIdentifier("bot-profile-archive")
                    }
                    if context.delete {
                        Button(role: .destructive) {
                            Haptics.selection()
                            actions.delete()
                        } label: {
                            Label("Delete bot…", systemImage: "trash")
                        }
                        .accessibilityIdentifier("bot-profile-delete")
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(fillsMain ? desktopTheme.ink : Theme.textPrimary)
                        .frame(width: fillsMain ? 36 : 30, height: fillsMain ? 36 : 30)
                        .background(Circle().fill(fillsMain ? desktopTheme.elevated : Theme.cardRaised))
                        .overlay(Circle().strokeBorder(fillsMain ? desktopTheme.hairlineWeak : Theme.hairline, lineWidth: 1))
                        .contentShape(Circle())
                }
                .accessibilityLabel(Text("More actions"))
                .accessibilityIdentifier("bot-profile-actions")
            }
        }
    }

    /// iPad: the bar floats over the wash, clear until the name passes
    /// under it, then a material with a hairline and the condensed title.
    private var topBar: some View {
        HStack(spacing: 8) {
            Button {
                actions.close()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 15, weight: .regular))
                    .foregroundStyle(desktopTheme.ink)
                    .frame(width: 36, height: 36)
                    .background(Circle().fill(desktopTheme.elevated))
                    .overlay(Circle().strokeBorder(desktopTheme.hairlineWeak, lineWidth: 1))
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Close"))
            .accessibilityIdentifier("window-close")
            if condensed { condensedTitle.transition(.opacity) }
            Spacer(minLength: 0)
            headerActions
        }
        .padding(.horizontal, 12)
        .frame(height: 56)
        .frame(maxWidth: .infinity)
        .background {
            if condensed {
                Rectangle().fill(.bar)
                    .overlay(alignment: .bottom) { desktopTheme.hairlineWeak.frame(height: 1) }
                    .ignoresSafeArea(edges: .top)
            }
        }
        .zIndex(1)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("bot-profile-topbar")
    }

    /// The bar condenses (material, small mascot and name) once the name
    /// has passed under it. A preference read from inside the scroll never
    /// reached the page, so the bar kept the banner's colour over the
    /// content (#4041).
    private func condense() {
        let now = nameEdge < barEdge
        if now != condensed { withAnimation(.easeOut(duration: 0.15)) { condensed = now } }
    }

    private func openAppearanceIfAsked(_ asked: Bool) {
        guard asked else { return }
        withAnimation(.snappy(duration: 0.2)) { tab = .appearance }
        onAppearanceOpened?()
    }

    /// One move on the stage: a wing move for the owl, a Shapes move for a shape.
    private func playMove() {
        Haptics.selection()
        if let wing = OwlWingMove.allCases.randomElement() { owlHandle.flourish(wing) }
        if let shape = ShapeMove.allCases.randomElement() { owlHandle.shape(shape) }
    }

    // MARK: Tabs and search

    private var tabRow: some View {
        VStack(spacing: 10) {
            HStack(spacing: 8) {
                if fillsMain {
                    tabPills
                    Spacer(minLength: 0)
                } else {
                    // the phone: the pills never widen the column past its
                    // gutters (a longer tab name scrolls instead)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            tabPills
                            searchButton
                        }
                        .padding(.horizontal, Theme.Profile.cardMargin)
                    }
                    .fixedSize(horizontal: false, vertical: true)
                }
                if fillsMain { searchButton }
            }
            .frame(maxWidth: .infinity, alignment: fillsMain ? .leading : .center)
            .padding(.horizontal, fillsMain ? 24 : 0)
            if searching { searchField }
        }
    }

    private var tabPills: some View {
        HStack(spacing: 4) {
            ForEach(visibleTabs) { item in
                let on = tab == item
                Button {
                    Haptics.selection()
                    withAnimation(.snappy(duration: 0.2)) { tab = item }
                } label: {
                    Text(item.title)
                        .font(fillsMain ? .system(size: 14) : Theme.Font.body)
                        .foregroundStyle(on ? ink : inkSecondary)
                        .lineLimit(1)
                        .fixedSize()
                        .padding(.horizontal, fillsMain ? 14 : 12)
                        .frame(height: 32)
                        .background(Capsule().fill(on ? (fillsMain ? desktopTheme.hover : Theme.cardRaised) : Color.clear))
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                // a tab with nothing for the search dims to 40 %
                .opacity(tabMatches(item) ? 1 : 0.4)
                .accessibilityLabel(Text(item.title))
                .accessibilityAddTraits(on ? [.isSelected, .isButton] : .isButton)
                .accessibilityIdentifier("bot-profile-tab.\(item.rawValue)")
            }
        }
        .padding(fillsMain ? 0 : 4)
        .background(fillsMain ? Color.clear : Theme.card.opacity(0.55), in: Capsule())
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("bot-profile-tabs")
    }

    private var ink: Color { fillsMain ? desktopTheme.ink : Theme.textPrimary }
    private var inkSecondary: Color { fillsMain ? desktopTheme.inkSecondary : Theme.textSecondary }

    private var searchButton: some View {
        Button {
            Haptics.selection()
            withAnimation(.snappy(duration: 0.2)) {
                searching.toggle()
                if !searching { query = "" }
            }
            searchFocused = searching
        } label: {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 14, weight: .regular))
                .foregroundStyle(searching ? ink : inkSecondary)
                .frame(width: 32, height: 32)
                .background(Circle().fill(searching ? (fillsMain ? desktopTheme.hover : Theme.cardRaised) : Color.clear))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("Search the categories"))
        .accessibilityIdentifier("bot-profile-search")
    }

    private var searchField: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textTertiary)
            TextField("Search", text: $query)
                .font(Theme.Font.body)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .focused($searchFocused)
                .accessibilityLabel(Text("Search the categories"))
                .accessibilityIdentifier("bot-profile-search-field")
            if !query.isEmpty {
                Button {
                    query = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(Theme.textTertiary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Clear"))
            }
        }
        .padding(.horizontal, 12)
        .frame(height: 36)
        .background(Theme.card, in: Capsule())
        .padding(.horizontal, fillsMain ? 24 : Theme.Profile.cardMargin)
        .transition(.opacity)
    }

    private static func fold(_ text: String) -> String {
        text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
    }

    private var needle: String { Self.fold(query.trimmingCharacters(in: .whitespacesAndNewlines)) }

    /// The English key and the translated text, so either language finds it.
    private static func words(_ key: LocalizedStringKey) -> String {
        let source = key.sourceText
        return source + " " + String(localized: String.LocalizationValue(source))
    }

    private func hit(_ text: String) -> Bool {
        needle.isEmpty || Self.fold(text).contains(needle)
    }

    private func hit(_ row: LinkRow) -> Bool {
        hit(Self.words(row.title) + " " + (row.subtitle ?? ""))
    }

    private static let appearanceWords: [LocalizedStringKey] = ["Appearance", "Mascot", "Colour", "Picture", "Avatar", "Play a move"]
    private static let statsWords: [LocalizedStringKey] = [
        "Analytics", "Stats", "Messages", "Hours saved", "Top users", "Usage", "Turns", "Tokens", "Cost",
        "By account", "By model", "By source", "By person", "This month",
    ]

    private func tabMatches(_ item: BotProfileTab) -> Bool {
        guard !needle.isEmpty else { return true }
        switch item {
        case .general, .settings:
            return hit(Self.words("General")) || generalHasHits
        case .knowledge:
            return knowledgeHasHits
        case .appearance:
            return Self.appearanceWords.contains { hit(Self.words($0)) }
        case .stats:
            return Self.statsWords.contains { hit(Self.words($0)) }
        }
    }

    /// The current tab has nothing for the search: open the first that does.
    private func followSearch() {
        guard !needle.isEmpty, !tabMatches(tab),
              let first = visibleTabs.first(where: tabMatches) else { return }
        withAnimation(.snappy(duration: 0.2)) { tab = first }
    }

    private var noMatch: some View {
        Text("No match")
            .font(Theme.Font.body)
            .foregroundStyle(Theme.textSecondary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 32)
            .accessibilityIdentifier("bot-profile-search-empty")
    }

    @ViewBuilder
    private var tabBody: some View {
        if !tabMatches(tab) {
            noMatch
        } else {
            switch tab {
            case .general, .settings: generalBody
            case .knowledge: knowledgeBody
            case .appearance: appearanceBody
            case .stats: statsBody
            }
        }
    }

    // MARK: General

    /// One row of a grouped card: icon, title, an optional recap line, chevron.
    private struct LinkRow: Identifiable {
        let id: String
        let title: LocalizedStringKey
        var subtitle: String?
        let symbol: String
        let action: () -> Void
    }

    /// General as the desktop's section cards (#3398, #3403): Settings with
    /// its switch in place then the rows that open a page, Channels and Bot
    /// accounts with their controls in place, then More.
    private var generalBody: some View {
        VStack(alignment: .leading, spacing: 24) {
            settingsGroup
            channelsGroup
            accountsGroup
            group("More", rows: moreRows, id: "bot-profile-group.more")
        }
    }

    private var generalHasHits: Bool {
        settingsHit || settingsRows.contains(where: hit) || moreRows.contains(where: hit)
            || channelsHit || accountsHit
    }

    private var summaries: BotEditSummaries {
        BotEditSummaries(bot: current, rules: nil, routines: nil, modelLabel: modelLabel)
    }

    /// The desktop's General > Settings (persona-sections.ts TAB_GROUPS):
    /// Personality (summary and soul), Model (where it works inside),
    /// Before acting.
    private var settingsRows: [LinkRow] {
        var rows: [LinkRow] = []
        if context.sections.contains(.soul) {
            rows.append(LinkRow(
                id: "bot-profile-settings.soul",
                title: "Personality",
                subtitle: summaries.value(.personality),
                symbol: "face.smiling"
            ) { actions.openSection(.soul) })
        }
        if context.sections.contains(.model) {
            rows.append(LinkRow(
                id: "bot-profile-settings.model",
                title: "Model",
                subtitle: modelLabel ?? summaries.value(.model),
                symbol: settingsSymbol(.model)
            ) { actions.openSection(.model) })
        }
        if context.sections.contains(.permissions) {
            rows.append(LinkRow(
                id: "bot-profile-settings.permissions",
                title: "Before acting",
                subtitle: summaries.value(.approvals),
                symbol: settingsSymbol(.permissions)
            ) { actions.openSection(.permissions) })
        }
        return rows
    }

    private static let notifyTitle: LocalizedStringKey = "Notify me when this bot finishes or needs me"

    /// The Settings card's switch, in place (it left the Voice page).
    private var notifyHit: Bool { hit(Self.words(Self.notifyTitle)) || hit(Self.words("Notifications")) }

    private var settingsHit: Bool { hit(Self.words("Settings")) || notifyHit }

    @ViewBuilder
    private var settingsGroup: some View {
        let whole = hit(Self.words("Settings"))
        let rows = whole ? settingsRows : settingsRows.filter(hit)
        let notify = whole || notifyHit
        if notify || !rows.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                groupLabel("Settings")
                ProfileCard {
                    if notify { notifyRow }
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                        if index > 0 || notify { ProfileDivider() }
                        linkRow(row)
                    }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("bot-profile-group.settings")
        }
    }

    private var notifyRow: some View {
        HStack(spacing: 0) {
            ProfileRowIcon(systemImage: "bell", size: 16)
                .frame(width: Theme.Profile.iconColumn, alignment: .leading)
            Text(Self.notifyTitle)
                .font(Theme.Font.body)
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
            Toggle(isOn: Binding(get: { current.notifications }, set: { on in
                var patch = BotProfilePatch()
                patch.notifications = on
                let target = current
                Task { _ = await session.updateProfile(patch, for: target) }
            })) {
                Text(Self.notifyTitle)
            }
            .labelsHidden()
            .tint(Theme.toggleOn)
            .padding(.leading, 12)
            .padding(.trailing, Theme.Profile.textInset)
            .accessibilityIdentifier("bot-profile-settings.notifications")
        }
        .frame(minHeight: Theme.Profile.toggleRow)
    }

    /// General > More (the desktop's order): Shared with, Rules, When it
    /// acts alone, Voice, Advanced settings (advanced mode only), Versions.
    private var moreRows: [LinkRow] {
        var rows: [LinkRow] = []
        if canShare {
            rows.append(LinkRow(
                id: "bot-profile-more.sharing",
                title: "Shared with",
                subtitle: privacy,
                symbol: "person.2",
                action: openShare
            ))
        }
        rows.append(LinkRow(
            id: "bot-profile-more.rules",
            title: "Rules",
            subtitle: ruleCount.map { total in
                total == 0 ? String(localized: "No rule")
                    : total == 1 ? String(localized: "1 rule") : String(localized: "\(total) rules")
            },
            symbol: "list.bullet.rectangle"
        ) {
            if let openRules = actions.openRules { openRules() } else { actions.openSection(.permissions) }
        })
        if context.sections.contains(.permissions) {
            rows.append(LinkRow(
                id: "bot-profile-more.acts-alone",
                title: "When it acts alone",
                subtitle: String(localized: "Proactive, recipients, drafts"),
                symbol: "figure.walk"
            ) { openPermissions(.actsAlone) })
        }
        if context.sections.contains(.voice) {
            rows.append(sectionRow(.voice))
        }
        if context.sections.contains(.permissions), interfaceMode.advanced {
            rows.append(LinkRow(
                id: "bot-profile-settings.overview",
                title: "Advanced settings",
                subtitle: String(localized: "Limits, roles, tool access, hooks"),
                symbol: settingsSymbol(.overview)
            ) { openPermissions(.advanced) })
        }
        if context.sections.contains(.history) {
            rows.append(LinkRow(
                id: "bot-profile-settings.history",
                title: "Versions",
                symbol: settingsSymbol(.history)
            ) { actions.openSection(.history) })
        }
        return rows
    }

    /// A Permissions sub-page; a host without the route opens all of Permissions.
    private func openPermissions(_ part: BotPermissionsPart) {
        if let open = actions.openPermissions { open(part) } else { actions.openSection(.permissions) }
    }

    private func sectionRow(_ section: DesktopPanelSection, subtitle: String? = nil) -> LinkRow {
        LinkRow(
            id: "bot-profile-settings.\(section.rawValue)",
            title: section.title,
            subtitle: subtitle,
            symbol: settingsSymbol(section)
        ) { actions.openSection(section) }
    }

    /// A grouped card; the search keeps the rows that match (all of them
    /// when the group's own name matches) and hides an empty group.
    @ViewBuilder
    private func group(_ title: LocalizedStringKey?, rows: [LinkRow], id: String) -> some View {
        let shown = title.map { hit(Self.words($0)) } == true ? rows : rows.filter(hit)
        if !shown.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                if let title { groupLabel(title) }
                ProfileCard {
                    ForEach(Array(shown.enumerated()), id: \.element.id) { index, row in
                        if index > 0 { ProfileDivider() }
                        linkRow(row)
                    }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier(id)
        }
    }

    private func groupLabel(_ title: LocalizedStringKey) -> some View {
        Text(title)
            .font(Theme.Font.label)
            .foregroundStyle(Theme.textTertiary)
            .lineLimit(1)
            .padding(.horizontal, Theme.Profile.cardMargin + 4)
    }

    /// The desktop's one-line description under each General row; on the iPad
    /// main column the recap moves to the right as a value.
    private static let rowDescriptions: [String: String] = [
        "bot-profile-settings.soul": "What it knows, how it speaks, what it won't do",
        "bot-profile-settings.model": "Engine, fallback, where it runs, who pays",
        "bot-profile-settings.permissions": "What it does alone, what it asks",
        "bot-profile-more.sharing": "Who can talk to it, who sets it up",
        "bot-profile-more.rules": "When it wants to... it should...",
        "bot-profile-settings.voice": "Tone, speed, language",
        "bot-profile-settings.history": "Every settings change, restorable",
    ]

    private func linkRow(_ row: LinkRow) -> some View {
        let desc = fillsMain ? Self.rowDescriptions[row.id] : nil
        return Button {
            Haptics.selection()
            row.action()
        } label: {
            ProfileRow(
                icon: ProfileRowIcon(systemImage: row.symbol, size: 16),
                title: desc != nil && row.id == "bot-profile-settings.permissions" ? Text("Before it acts") : Text(row.title),
                subtitle: desc.map { Text(verbatim: String(localized: String.LocalizationValue($0))) }
                    ?? row.subtitle.map { Text(verbatim: $0) },
                height: (row.subtitle == nil && desc == nil) ? Theme.Profile.singleRow : Theme.Profile.routineRow
            ) {
                HStack(spacing: 8) {
                    if desc != nil, let value = row.subtitle {
                        Text(verbatim: value)
                            .font(Theme.Font.label)
                            .foregroundStyle(Theme.textSecondary)
                            .lineLimit(1)
                            .accessibilityIdentifier("\(row.id).value")
                    }
                    ProfileChevronTrailing()
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(row.id)
    }

    // MARK: Channels

    /// One channel line: what it is, its state, and a pill only when it does something.
    private struct ChannelLine: Identifiable {
        let id: String
        let title: LocalizedStringKey
        let subtitle: String
        let symbol: String
        var pill: LocalizedStringKey?
        var action: (() -> Void)?
    }

    private static func reachLabel(_ id: ReachChannelID) -> String {
        switch id {
        case .push: String(localized: "Phone notifications")
        case .sms: String(localized: "Text message")
        case .teams: String(localized: "Microsoft Teams")
        case .telegram: String(localized: "Telegram")
        case .whatsapp: String(localized: "WhatsApp")
        }
    }

    /// The desktop's Channels card: Slack (only where the server offers it),
    /// Email, Reach me. Messages stays off the phone and the iPad; sharing
    /// is under More and behind Share.
    private var channelLines: [ChannelLine] {
        var lines: [ChannelLine] = []
        // no Slack on this server: the row is hidden, not shown as unavailable
        if let slackURL {
            lines.append(ChannelLine(
                id: "bot-profile-channel.slack",
                title: "Slack",
                subtitle: String(localized: "Managed in Admin"),
                symbol: "number",
                pill: "Manage",
                action: { UIApplication.shared.open(slackURL) }
            ))
        }
        if mailLoaded, mail == nil || mail?.available == true {
            let address = mail?.address?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            lines.append(ChannelLine(
                id: "bot-profile-channel.email",
                title: "Email",
                subtitle: address.isEmpty ? String(localized: "No address yet") : address,
                symbol: "envelope",
                pill: address.isEmpty ? nil : "Copy",
                action: address.isEmpty ? nil : {
                    UIPasteboard.general.string = address
                    Haptics.selection()
                }
            ))
        }
        let on = (reach?.settings.channels ?? []).compactMap(ReachChannelID.init(rawValue:))
        lines.append(ChannelLine(
            id: "bot-profile-channel.reach-me",
            title: "Reach me",
            subtitle: on.isEmpty
                ? (reachLoaded ? String(localized: "Not connected") : " ")
                : on.map(Self.reachLabel).joined(separator: ", "),
            symbol: "bell.badge",
            pill: reachLoaded ? (on.isEmpty ? "Connect" : "Manage") : nil,
            action: reachLoaded ? { reachOpen = true } : nil
        ))
        return lines
    }

    private func hit(_ line: ChannelLine) -> Bool { hit(Self.words(line.title) + " " + line.subtitle) }

    private var channelsHit: Bool { hit(Self.words("Channels")) || channelLines.contains(where: hit) }

    /// The Channels card, always in place (the tablet's row that unfolded
    /// it is gone, #3403).
    @ViewBuilder
    private var channelsGroup: some View {
        let lines = hit(Self.words("Channels")) ? channelLines : channelLines.filter(hit)
        if !lines.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                groupLabel("Channels")
                ProfileCard {
                    ForEach(Array(lines.enumerated()), id: \.element.id) { index, line in
                        if index > 0 { ProfileDivider() }
                        channelRow(line)
                    }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("bot-profile-group.channels")
            .id("bot-profile-anchor.channels")
        }
    }

    private func pill(_ title: LocalizedStringKey) -> some View {
        ProfilePill(title: title, fillsMain: fillsMain)
            .padding(.trailing, Theme.Profile.textInset)
    }

    @ViewBuilder
    private func channelRow(_ line: ChannelLine) -> some View {
        let row = ProfileRow(
            icon: ProfileRowIcon(systemImage: line.symbol, size: 16),
            title: Text(line.title),
            subtitle: Text(verbatim: line.subtitle),
            height: Theme.Profile.routineRow
        ) {
            if let title = line.pill { pill(title) }
        }
        if let action = line.action {
            Button {
                Haptics.selection()
                action()
            } label: {
                row.contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier(line.id)
        } else {
            row
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier(line.id)
        }
    }

    // MARK: Bot accounts

    /// What the card lists (#3399): what this bot has, never a connector
    /// still to connect (that one stays in the apps page Add opens).
    private var accounts: [BotCapability] { BotAccountsCard.rows(capabilities?.items ?? []) }

    private static func accountName(_ item: BotCapability) -> String {
        let name = item.name.trimmingCharacters(in: .whitespacesAndNewlines)
        if !name.isEmpty { return name }
        return item.form == .role ? String(localized: "Removed Role") : String(localized: "Unnamed")
    }

    /// The desktop's state words (`bot-profile.accounts.state.*`).
    private static func stateWord(_ state: BotCapability.State) -> String {
        switch state {
        case .on: String(localized: "On")
        case .off: String(localized: "Off")
        case .toConnect: String(localized: "To connect")
        case .imposed: String(localized: "Set by the organization")
        case .notHeld: String(localized: "Role not held")
        case .notServed: String(localized: "Not served by this engine")
        case .reserved: String(localized: "Reserved name")
        case .unverifiable, .other: String(localized: "Cannot be checked")
        }
    }

    /// The shared vault of a team bot: a bot shared with someone, and a
    /// viewer who may change what it can reach (the desktop's teamVaultOffered).
    private var vaultOffered: Bool {
        sharedWithOthers && session.surfaceGate.allows(.botAccessEdit, bot: current)
    }

    private static func vaultLine(_ item: VaultItemPublic) -> String {
        let sites = item.domains.isEmpty ? String(localized: "No site") : item.domains.joined(separator: ", ")
        let line = String(localized: "Vault login") + " · " + sites
        return item.hasPassword ? line + " · " + String(localized: "password saved") : line
    }

    private var accountsHit: Bool {
        guard context.sections.contains(.access) else { return false }
        return hit(Self.words("Bot accounts")) || hit(Self.words("Accounts")) || hit(capabilities?.engine.label ?? "")
            || accounts.contains { hit(Self.accountName($0)) }
            || vaultItems.contains { hit($0.name) }
    }

    /// "+ Add": Apps, MCP servers (where this pairing reaches them) and the
    /// shared vault's login (where it is offered), each with its own page.
    private var addItems: [BotProfileAddItem] {
        BotAccountsCard.choices(mcpServers: session.surfaceGate.allows(.mcpServers), vault: vaultOffered).map { choice in
            switch choice {
            case .apps:
                BotProfileAddItem(id: "apps", title: "Apps", detail: "Connect an app as this bot", symbol: "square.grid.2x2") {
                    if let open = actions.openApps { open() } else { accountsSheet = .apps }
                }
            case .mcp:
                BotProfileAddItem(id: "mcp", title: "MCP servers", detail: "Add a server by its address", symbol: "server.rack") {
                    if let open = actions.openMcpServers { open() } else { accountsSheet = .mcp }
                }
            case .vault:
                BotProfileAddItem(id: "vault", title: "Vault login", detail: "A username and password this bot fills on its sites", symbol: "key") {
                    accountsSheet = .vault
                }
            }
        }
    }

    private var addMenu: some View { BotProfileAddMenu(items: addItems, identifier: "bot-profile-accounts.add") }

    /// General > Bot accounts, always in place: the engine, then each app
    /// or server the bot has with its state, then the shared vault's
    /// logins; "+ Add" at the right of the label, or in the empty row.
    @ViewBuilder
    private var accountsGroup: some View {
        if context.sections.contains(.access), accountsHit {
            let whole = hit(Self.words("Bot accounts")) || hit(Self.words("Accounts"))
            let shown = whole ? accounts : accounts.filter { hit(Self.accountName($0)) }
            let logins = whole ? vaultItems : vaultItems.filter { hit($0.name) }
            let empty = capabilities != nil && accounts.isEmpty && vaultItems.isEmpty
            VStack(alignment: .leading, spacing: 8) {
                BotProfileGroupLabel(title: "Bot accounts") {
                    if !empty { addMenu }
                }
                ProfileCard {
                    if capabilitiesFailed {
                        HStack(spacing: 8) {
                            Text("Couldn't load the accounts")
                                .font(Theme.Profile.labelFont)
                                .foregroundStyle(Theme.textSecondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            Button {
                                Task { await loadCapabilities() }
                            } label: {
                                pill("Try again")
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("bot-profile-accounts.retry")
                        }
                        .padding(.leading, Theme.Profile.textInset)
                        .frame(minHeight: Theme.Profile.singleRow)
                    } else if let capabilities {
                        if whole || hit(capabilities.engine.label) {
                            Button {
                                Haptics.selection()
                                actions.openSection(.access)
                            } label: {
                                ProfileRow(
                                    icon: ProfileRowIcon(systemImage: "cpu", size: 16),
                                    title: Text(verbatim: capabilities.engine.label),
                                    subtitle: Text("Engine"),
                                    height: Theme.Profile.routineRow
                                ) { pill("Manage") }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("bot-profile-accounts.engine")
                        }
                        ForEach(shown) { item in
                            ProfileDivider()
                            ProfileRow(
                                icon: ProfileRowIcon(systemImage: item.form == .mcp ? "server.rack" : "square.grid.2x2", size: 16),
                                title: Text(verbatim: Self.accountName(item)),
                                subtitle: Text(verbatim: Self.stateWord(item.state)),
                                height: Theme.Profile.routineRow
                            )
                            .accessibilityElement(children: .combine)
                            .accessibilityIdentifier("bot-profile-accounts.item.\(item.key)")
                        }
                        ForEach(logins) { login in
                            ProfileDivider()
                            ProfileRow(
                                icon: ProfileRowIcon(systemImage: "key", size: 16),
                                title: Text(verbatim: login.name),
                                subtitle: Text(verbatim: Self.vaultLine(login)),
                                height: Theme.Profile.routineRow
                            ) {
                                Button {
                                    Task { await removeVaultLogin(login) }
                                } label: {
                                    Image(systemName: "trash")
                                        .font(.system(size: 13))
                                        .foregroundStyle(Theme.textSecondary)
                                        .frame(width: 36, height: 28)
                                        .background(Capsule().fill(Theme.cardRaised))
                                }
                                .buttonStyle(.plain)
                                .disabled(vaultBusy)
                                .padding(.trailing, Theme.Profile.textInset)
                                .accessibilityLabel(Text(String(localized: "Remove \(login.name)")))
                                .accessibilityIdentifier("bot-profile-accounts.vault-remove.\(login.id)")
                            }
                            .accessibilityElement(children: .contain)
                            .accessibilityIdentifier("bot-profile-accounts.vault.\(login.id)")
                        }
                        if empty {
                            ProfileDivider()
                            ProfileRow(
                                icon: ProfileRowIcon(systemImage: "powerplug", size: 16),
                                title: Text("This bot has no accounts yet"),
                                subtitle: Text("An app or a server you add here becomes usable by this bot."),
                                height: Theme.Profile.routineRow,
                                subtitleLines: 2
                            ) {
                                addMenu.padding(.trailing, 12)
                            }
                            .accessibilityElement(children: .contain)
                            .accessibilityIdentifier("bot-profile-accounts.empty")
                        }
                        if let vaultError {
                            Text(verbatim: vaultError)
                                .font(Theme.Profile.labelFont)
                                .foregroundStyle(Theme.danger)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, Theme.Profile.textInset)
                                .padding(.vertical, 8)
                        }
                    } else {
                        Text("Loading accounts…")
                            .font(Theme.Profile.labelFont)
                            .foregroundStyle(Theme.textSecondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, Theme.Profile.textInset)
                            .frame(minHeight: Theme.Profile.singleRow)
                    }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("bot-profile-group.accounts")
            .id("bot-profile-anchor.accounts")
        }
    }

    /// What "+ Add" opens where the host has no page of its own (the phone).
    enum AccountsSheet: String, Identifiable {
        case apps, mcp, vault
        var id: String { rawValue }
    }

    @ViewBuilder
    private func accountsSheetView(_ sheet: AccountsSheet) -> some View {
        switch sheet {
        case .apps:
            ConnectAppsPage()
                .environmentObject(session)
        case .mcp:
            NavigationStack {
                McpServersList()
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) { Button("Done") { accountsSheet = nil } }
                    }
            }
            .environmentObject(session)
        case .vault:
            TeamVaultLoginSheet(bot: current) { Task { await loadVault() } }
                .environmentObject(session)
        }
    }

    // MARK: Loading

    /// Every recap line reads together (#3017, L17/G8); the model line
    /// draws from the session's cached catalog first.
    private func loadSummaries() async {
        if let cached = session.cachedInstances { modelLabel = label(in: cached) }
        guard let client = session.settingsClient else { return }
        let botId = bot.id
        async let readRules = try? await client.ruleSets(botId: botId)
        async let readMail = client.botInboundMailAnswer(botId: botId)
        async let readInstances = session.refreshInstancesCache()
        async let readReach: Void = loadReach()
        async let readCapabilities: Void = loadCapabilities()
        async let readVault: Void = loadVault()
        let (rules, mailAnswer, instances) = await (readRules, readMail, readInstances)
        ruleCount = rules?.enabledRuleCount ?? (ruleCount ?? 0)
        mail = mailAnswer
        mailLoaded = true
        if let instances { modelLabel = label(in: instances) }
        _ = await (readReach, readCapabilities, readVault)
    }

    private func loadReach() async {
        guard let client = session.settingsClient else { return }
        reach = try? await client.reachMe(botId: bot.id)
        reachLoaded = true
    }

    private func loadCapabilities() async {
        guard context.sections.contains(.access), let client = session.settingsClient else { return }
        capabilitiesFailed = false
        do {
            capabilities = try await client.botCapabilities(botId: bot.id)
        } catch {
            capabilitiesFailed = capabilities == nil
        }
    }

    /// The shared vault's logins (never a value), where it is offered.
    private func loadVault() async {
        guard vaultOffered, let client = session.settingsClient else { return }
        do {
            vaultItems = try await client.teamBotVaultItems(botId: bot.id).items
            vaultError = nil
        } catch {
            vaultError = error.localizedDescription
        }
    }

    private func removeVaultLogin(_ login: VaultItemPublic) async {
        guard let client = session.settingsClient else { return }
        vaultBusy = true
        defer { vaultBusy = false }
        do {
            try await client.deleteTeamBotVaultItem(botId: bot.id, id: login.id)
            await loadVault()
        } catch {
            vaultError = error.localizedDescription
        }
    }

    private func label(in instances: [Instance]) -> String? {
        let selection = current.modelSelection
        return instances.first { $0.instanceId == selection.instanceId }?
            .models.options.first { $0.id == selection.model }?.label
    }

    // MARK: Knowledge

    /// "Its work" after the two cards (#3400): Routines, the Folder (the
    /// workspace files), then the Memory page.
    private var knowledgeRows: [LinkRow] {
        var rows: [LinkRow] = []
        rows.append(LinkRow(id: "bot-profile-knowledge.routines", title: "Routines", symbol: "clock.arrow.2.circlepath") {
            actions.openRoutines()
        })
        if let openFolder = actions.openFolder {
            rows.append(LinkRow(id: "bot-profile-knowledge.folder", title: "Folder", symbol: "folder") {
                openFolder()
            })
        }
        // the iPad's Folder holds the Memory (the desktop's); the phone's
        // file list does not, so the Memory page sits under it there
        if context.sections.contains(.memory), !(fillsMain && actions.openFolder != nil) {
            rows.append(LinkRow(id: "bot-profile-knowledge.memory", title: "Memory", symbol: "brain") {
                actions.openSection(.memory)
            })
        }
        return rows
    }

    private static let reviewWords: [LocalizedStringKey] = ["To review", "Learned skills", "Proposal"]

    private var knowledgeWhole: Bool { hit(Self.words("Knowledge")) }

    private var reviewHit: Bool {
        knowledgeWhole || Self.reviewWords.contains { hit(Self.words($0)) }
            || skills.stagedItems.contains { hit($0.name + " " + ($0.gist ?? "")) }
    }

    private var skillsHit: Bool {
        knowledgeWhole || hit(Self.words("Skills"))
            || skills.skills.contains { hit(DisplayHygiene.skillTitle($0) + " " + $0.name) }
    }

    private var knowledgeHasHits: Bool {
        knowledgeWhole || knowledgeRows.contains(where: hit)
            || (context.sections.contains(.skills) && (reviewHit || skillsHit))
    }

    /// Knowledge as the desktop's (#3400): "To review" first, the Skills
    /// card in place, then the rows of its work.
    private var knowledgeBody: some View {
        VStack(alignment: .leading, spacing: 24) {
            if context.sections.contains(.skills) {
                if reviewHit {
                    BotReviewCard(model: skills, fillsMain: fillsMain, openChat: openChat)
                }
                if skillsHit {
                    BotSkillsCard(
                        bot: current,
                        model: skills,
                        matches: { hit($0) },
                        wholeCard: knowledgeWhole || hit(Self.words("Skills"))
                    )
                }
            }
            group(nil, rows: knowledgeWhole ? knowledgeRows : knowledgeRows.filter(hit), id: "bot-profile-group.knowledge")
        }
        .task(id: bot.id) {
            guard context.sections.contains(.skills) else { return }
            skills.client = session.profileClient
            await skills.refresh(first: true)
        }
    }

    /// "Open in chat": the chat sits under the profile; the phone's panel
    /// goes, the iPad's profile closes onto the bot's chat.
    private func openChat() {
        if let panelOpenChat { panelOpenChat() } else { actions.close() }
    }

    // MARK: Appearance and Analytics

    /// The desktop's Appearance pane in the page, on the iPad and the phone.
    @ViewBuilder
    private var appearanceBody: some View {
        Group {
            if fillsMain {
                PersonaAppearancePane(bot: current)
            } else {
                PhoneAppearancePane(bot: current)
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .padding(.horizontal, fillsMain ? 24 : Theme.Profile.cardMargin)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("bot-profile.appearance")
    }

    /// Analytics (#3401): the block of the reference first (range, Messages,
    /// Hours saved, Top users), then our breakdown and the Usage page.
    private var statsBody: some View {
        VStack(alignment: .leading, spacing: 24) {
            BotProfileAnalyticsBlock(bot: current, fillsMain: fillsMain)
            BotUsageBreakdownView(bot: current)
            group(nil, rows: context.sections.contains(.usage) ? [sectionRow(.usage)] : [], id: "bot-profile-group.stats")
        }
    }

    private func settingsSymbol(_ section: DesktopPanelSection) -> String {
        switch section {
        case .model: "cpu"
        case .access: "square.grid.2x2"
        case .worksOn: "desktopcomputer"
        case .permissions: "checkmark.shield"
        case .voice: "waveform"
        case .sharing: "person.2"
        case .visibility: "eye"
        case .history: "clock.arrow.circlepath"
        case .usage: "chart.bar"
        case .overview: "doc.text.magnifyingglass"
        default: "gearshape"
        }
    }
}
