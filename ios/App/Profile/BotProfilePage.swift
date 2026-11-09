// Bot profile page (reference app panel A, #2127): banner, overlapping mascot,
// the name with its title under it (never "Name · Title"), privacy line,
// pill tabs General / Knowledge / Settings. Replaces the Edit bot root as
// the destination of the panel's gear. In the iPad main column (desktop
// 2021a8785a, #2313) the header is the mascot hero card: an opaque top bar
// with X and Private / Shared that never scrolls, a wash of the mascot's
// colour, then the big mascot on a tinted stage, the name at 28 with the
// title under it, Play a move and Appearance.
import CompanionCore
import SwiftUI
import UIKit

enum BotProfileTab: String, CaseIterable, Hashable, Identifiable {
    case general, knowledge, appearance, stats, settings
    var id: String { rawValue }

    /// Visible pills, the desktop's BOT_PROFILE_TABS (#3017, G1): Settings
    /// is folded into General; Stats shows only where usage is reachable.
    static var visible: [BotProfileTab] { [.general, .knowledge, .appearance, .stats] }

    var title: LocalizedStringKey {
        switch self {
        case .general: "General"
        case .knowledge: "Knowledge"
        case .appearance: "Appearance"
        case .stats: "Stats"
        case .settings: "Settings"
        }
    }
}

struct BotProfilePage: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.desktopTheme) private var desktopTheme
    @EnvironmentObject private var session: Session
    let bot: Bot
    var startTab: BotProfileTab = .general
    let context: BotEditContext
    let actions: BotEditActions
    var slackURL: URL?
    var mailRow: BotInboundMailRow?
    /// iPad main column (#2136): X sits on the banner; no navigation back.
    var fillsMain = false
    /// Unfold Appearance in the page (an avatar click, Edit bot > Appearance):
    /// the desktop's `personaCategoryForSection(section) === "appearance"`.
    var openAppearance = false
    /// Told once the page has unfolded Appearance for `openAppearance`.
    var onAppearanceOpened: (() -> Void)?

    @State private var tab: BotProfileTab
    /// Advanced (overview, usage, history, archive, delete): closed until asked.
    @State private var advancedOpen = false
    @State private var modelLabel: String?
    @State private var rules: [CustomRuleRow]?
    @State private var appearanceOpen: Bool
    @StateObject private var owlHandle = OwlMascotHandle()

    init(
        bot: Bot,
        startTab: BotProfileTab = .general,
        context: BotEditContext,
        actions: BotEditActions,
        slackURL: URL? = nil,
        mailRow: BotInboundMailRow? = nil,
        fillsMain: Bool = false,
        openAppearance: Bool = false,
        onAppearanceOpened: (() -> Void)? = nil
    ) {
        self.bot = bot
        self.startTab = startTab
        self.context = context
        self.actions = actions
        self.slackURL = slackURL
        self.mailRow = mailRow
        self.fillsMain = fillsMain
        self.openAppearance = openAppearance
        self.onAppearanceOpened = onAppearanceOpened
        _appearanceOpen = State(initialValue: fillsMain && openAppearance)
        // Settings is no longer a tab (#2136); land on General.
        _tab = State(initialValue: startTab == .settings ? .general : startTab)
    }

    private var current: Bot { session.state.bot(bot.id) ?? bot }

    /// The mascot's face, read once through the session's transcript memo
    /// (#3017, L16) instead of walking the whole thread per mascot.
    private var mascotState: MausState { MausState.forChat(.bot(current), in: session) }

    /// The pills this pairing shows: Stats only where usage is reachable.
    private var visibleTabs: [BotProfileTab] {
        BotProfileTab.visible.filter { $0 != .stats || context.sections.contains(.usage) }
    }

    /// The bot's name alone; its title sits on the line under it.
    private var headline: String { current.name }

    private var titleLine: String? {
        let title = current.title.trimmingCharacters(in: .whitespacesAndNewlines)
        return title.isEmpty ? nil : title
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
        let shared = !(current.grants ?? []).isEmpty || !(current.directGrants ?? []).isEmpty
        return BotPrivacyLabel.text(
            visibility: current.visibility,
            sharedWithOthers: shared,
            organization: session.surfaceGate.organization
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            if fillsMain { topBar }
            ScrollView {
                VStack(spacing: 0) {
                    if fillsMain { bannerWash } else { banner }
                    VStack(spacing: 0) {
                        if fillsMain { heroHeader } else { identityBlock }
                        tabPills
                            .padding(.top, 16)
                            .padding(.bottom, 12)
                        tabBody
                            .padding(.bottom, 48)
                    }
                    // Main-column profile: one centred column like the desktop's (#2313).
                    // the desktop's 760 pt column (#3017, G14)
                    .frame(maxWidth: fillsMain ? 760 : .infinity)
                    .frame(maxWidth: .infinity)
                }
            }
            .scrollIndicators(.visible)
            // typing in the hero fields: drag the list to put the keyboard away (G17)
            .scrollDismissesKeyboard(.interactively)
        }
        .background(Theme.bg.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !fillsMain {
                ToolbarItem(placement: .topBarLeading) {
                    ProfileBackButton { actions.close() }
                }
            }
        }
        .navigationBarHidden(fillsMain)
        // One back button: ours, not the system one beside it.
        .navigationBarBackButtonHidden(true)
        .onAppear { unfoldAppearanceIfAsked(openAppearance) }
        .task(id: bot.id) { await loadSummaries() }
        .onValueChange(of: openAppearance) { unfoldAppearanceIfAsked($0) }
        // Keep children queryable for UITests (tabs, Settings disclosure).
        .accessibilityIdentifier("bot-profile-page")
    }

    // MARK: Header

    private var banner: some View {
        LinearGradient(
            colors: bannerColors,
            startPoint: .top,
            endPoint: .bottom
        )
        .frame(height: fillsMain ? 90 : 120)
        .frame(maxWidth: .infinity)
        .overlay(alignment: .bottomLeading) {
            BotMascotView(
                bot: current,
                size: 72,
                state: mascotState,
                // a still banner mascot: only the hero animates (#3017, L16)
                animated: false,
                owlHandle: owlHandle
            )
            .padding(.leading, 20)
            .offset(y: 28)
            .accessibilityIdentifier("bot-profile-mascot")
        }
        .accessibilityIdentifier("bot-profile-banner")
        .accessibilityHidden(true)
    }

    private var bannerColors: [Color] {
        // the desktop's `.bot-profile-banner` wash in the mascot's colour
        // (#3017, G13), over the phone's dark or light base
        let base = themePalette.isDark ? Color(hex: "#2A2A2A") : Color.white
        return [
            DesktopMemoryPage.mix(washColor, base, 0.58),
            DesktopMemoryPage.mix(washColor, base, 0.36),
        ]
    }

    private var identityBlock: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(verbatim: headline)
                .font(Theme.Font.profileName)
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(2)
                .accessibilityIdentifier("bot-profile-name")
            if let titleLine {
                Text(verbatim: titleLine)
                    .font(Theme.Profile.labelFont)
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(2)
                    .accessibilityIdentifier("bot-profile-title")
            }
            HStack(spacing: 6) {
                Image(systemName: "lock.fill")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
                Text(verbatim: privacy)
                    .font(Theme.Profile.labelFont)
                    .foregroundStyle(Theme.textSecondary)
            }
            .accessibilityIdentifier("bot-profile-privacy")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 20)
        .padding(.top, 36)
    }

    // MARK: Main-column header (#2313)

    /// The opaque bar over the scroll: X on the left, Private / Shared on the
    /// right, 36 pt circles centred like the sidebar head's.
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
            Spacer(minLength: 0)
            // the desktop's share button (#3017, G15): opens who uses and sees it
            Button {
                Haptics.selection()
                if context.sections.contains(.sharing) {
                    actions.openSection(.sharing)
                } else if context.sections.contains(.visibility) {
                    actions.openSection(.visibility)
                }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: privateBot ? "lock" : "person.2")
                        .font(.system(size: 12, weight: .regular))
                    Text(privateBot ? "Private" : "Shared")
                        .font(.system(size: 12, weight: .medium))
                }
                .foregroundStyle(desktopTheme.ink)
                .padding(.horizontal, 12)
                .frame(height: 36)
                .background(Capsule().fill(desktopTheme.elevated))
                .overlay(Capsule().strokeBorder(desktopTheme.hairlineWeak, lineWidth: 1))
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .disabled(!context.sections.contains(.sharing) && !context.sections.contains(.visibility))
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("bot-profile-visibility")
        }
        .padding(.horizontal, 12)
        .frame(height: 56)
        .frame(maxWidth: .infinity)
        .background(washTop.ignoresSafeArea(edges: .top))
        .zIndex(1)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("bot-profile-topbar")
    }

    /// `.bot-profile-banner`: the mascot's colour mixed into a pale base,
    /// 58 % at the top (the bar's colour), 36 % at the bottom.
    private var washColor: Color { MausPalette.color(current.color) }
    private var washBase: Color { themePalette.isDark ? Color(hex: "#F4F4F4") : .white }
    private var washTop: Color { DesktopMemoryPage.mix(washColor, washBase, 0.58) }

    private var bannerWash: some View {
        LinearGradient(
            colors: [washTop, DesktopMemoryPage.mix(washColor, washBase, 0.36)],
            startPoint: .top,
            endPoint: .bottom
        )
        .frame(height: 96)
        .frame(maxWidth: .infinity)
        .accessibilityIdentifier("bot-profile-banner")
        .accessibilityHidden(true)
    }

    /// The hero card over the banner's lower edge, then who sees the bot.
    private var heroHeader: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 28) {
                BotMascotView(
                    bot: current,
                    size: 150,
                    state: mascotState,
                    animated: true,
                    owlHandle: owlHandle
                )
                .frame(width: 170, height: 170)
                .contentShape(Rectangle())
                .onTapGesture { playMove() }
                .accessibilityIdentifier("bot-profile-mascot")
                // The name at 28 and the label under it, edited in place.
                BotProfileHeroIdentity(bot: current)
                VStack(spacing: 8) {
                    heroButton("sparkles", "Play a move", id: "bot-profile-play") { playMove() }
                    appearanceToggle
                }
                .fixedSize()
            }
            .padding(.horizontal, 28)
            .padding(.vertical, 20)
            .frame(minHeight: 210)
            .background(
                // Desktop MascotLookPreview: radial-gradient(120% 140% at 20% 50%,
                // 26% of the bot's colour in the panel, to the panel at 58%).
                RoundedRectangle(cornerRadius: 18, style: .continuous).fill(
                    EllipticalGradient(
                        colors: [DesktopMemoryPage.mix(washColor, desktopTheme.panel, 0.26), desktopTheme.panel],
                        center: UnitPoint(x: 0.2, y: 0.5),
                        startRadiusFraction: 0,
                        endRadiusFraction: 0.75
                    )
                )
            )
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(desktopTheme.hairlineWeak, lineWidth: 1)
            )
            // A picture dropped on the hero, or pasted from its menu, becomes the avatar.
            .botProfileHeroImageTarget(current)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("bot-profile-hero")
            // Who sees it, the owner, then the description typed in place.
            BotProfileHeroDetails(bot: current, audience: privacy)
            // Appearance unfolds here, in the page (never a sheet or a window).
            if appearanceOpen {
                PersonaAppearancePane(bot: current)
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                    .padding(.top, 4)
                    .accessibilityElement(children: .contain)
                    // The id the Edit bot page used, so its deep links still find it.
                    .accessibilityIdentifier("desktop-persona-window.page.appearance")
                    .transition(.opacity)
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("bot-profile.hero.appearance")
            }
        }
        .padding(.horizontal, 24)
        .padding(.top, -40)
    }

    private func heroButton(_ icon: String, _ title: LocalizedStringKey, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 12))
                Text(title).font(.system(size: 13))
            }
            .foregroundStyle(desktopTheme.ink)
            .padding(.horizontal, 14)
            .frame(height: 34)
            .frame(maxWidth: .infinity)
            .background(desktopTheme.control.opacity(0.7), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(desktopTheme.hairlineWeak, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(id)
    }

    /// Where Randomize was (#2313): unfolds the Appearance pane under the
    /// header, the chevron turning, the pill lit while it is open.
    private var appearanceToggle: some View {
        Button {
            Haptics.selection()
            withAnimation(.snappy(duration: 0.2)) { appearanceOpen.toggle() }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "paintpalette").font(.system(size: 12))
                Text("Appearance").font(.system(size: 13))
                Image(systemName: "chevron.down")
                    .font(.system(size: 11, weight: .semibold))
                    .rotationEffect(.degrees(appearanceOpen ? 180 : 0))
            }
            .foregroundStyle(desktopTheme.ink)
            .padding(.horizontal, 14)
            .frame(height: 34)
            .frame(maxWidth: .infinity)
            .background(
                appearanceOpen ? desktopTheme.raisedHover : desktopTheme.control.opacity(0.7),
                in: RoundedRectangle(cornerRadius: 12, style: .continuous)
            )
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(desktopTheme.hairlineWeak, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityValue(Text(appearanceOpen ? "Expanded" : "Collapsed"))
        .accessibilityAddTraits(appearanceOpen ? [.isSelected, .isButton] : .isButton)
        .accessibilityIdentifier("bot-profile.hero.appearance-toggle")
    }

    private func unfoldAppearanceIfAsked(_ asked: Bool) {
        guard asked, fillsMain else { return }
        withAnimation(.snappy(duration: 0.2)) { appearanceOpen = true }
        onAppearanceOpened?()
    }

    /// One move on the stage: a wing move for the owl, a Shapes move for a shape.
    private func playMove() {
        Haptics.selection()
        if let wing = OwlWingMove.allCases.randomElement() { owlHandle.flourish(wing) }
        if let shape = ShapeMove.allCases.randomElement() { owlHandle.shape(shape) }
    }

    @ViewBuilder
    private var tabPills: some View {
        if fillsMain { mainTabs } else { phoneTabPills }
    }

    /// The desktop's tab row (`data-bot-profile-tabs`): pills on the left
    /// edge of the column, the selected one on the hover fill.
    private var mainTabs: some View {
        HStack(spacing: 4) {
            ForEach(visibleTabs) { item in
                let on = tab == item
                Button {
                    Haptics.selection()
                    withAnimation(.snappy(duration: 0.2)) { tab = item }
                } label: {
                    Text(item.title)
                        .font(.system(size: 14))
                        .foregroundStyle(on ? desktopTheme.ink : desktopTheme.inkSecondary)
                        .padding(.horizontal, 14)
                        .frame(height: 32)
                        .background(Capsule().fill(on ? desktopTheme.hover : Color.clear))
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(item.title))
                .accessibilityAddTraits(on ? [.isSelected, .isButton] : .isButton)
                .accessibilityIdentifier("bot-profile-tab.\(item.rawValue)")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 24)
        .padding(.top, 4)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("bot-profile-tabs")
    }

    private var phoneTabPills: some View {
        HStack(spacing: 4) {
            ForEach(visibleTabs) { item in
                let on = tab == item
                Button {
                    Haptics.selection()
                    withAnimation(.snappy(duration: 0.2)) { tab = item }
                } label: {
                    Text(item.title)
                        .font(Theme.Font.body)
                        .foregroundStyle(on ? Theme.textPrimary : Theme.textSecondary)
                        .padding(.horizontal, 14)
                        .frame(height: 32)
                        .background(Capsule().fill(on ? Theme.cardRaised : Color.clear))
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(item.title))
                .accessibilityAddTraits(on ? [.isSelected, .isButton] : .isButton)
                .accessibilityIdentifier("bot-profile-tab.\(item.rawValue)")
            }
        }
        .padding(4)
        .background(Theme.card.opacity(0.55), in: Capsule())
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("bot-profile-tabs")
    }

    @ViewBuilder
    private var tabBody: some View {
        switch tab {
        case .general, .settings: generalBody
        case .knowledge: knowledgeBody
        case .appearance: appearanceBody
        case .stats: statsBody
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

    /// General, grouped like the desktop's profile (V6, #2612): a grey label
    /// over one card per group, rows split by hairlines, the same 24 pt
    /// margins for the labels and the cards. Technical pages and the
    /// destructive actions wait in Advanced, closed by default.
    private var generalBody: some View {
        VStack(alignment: .leading, spacing: 24) {
            group("Profile", rows: profileRows, id: "bot-profile-group.profile")
            group("Settings", rows: settingsRows, id: "bot-profile-group.settings")
            if showsSlack || mailRow != nil || !audienceRows.isEmpty { channelsGroup }
            group("Accounts", rows: accountRows, id: "bot-profile-group.accounts")
            group("More", rows: moreRows, id: "bot-profile-group.more")
            advancedDisclosure
        }
    }

    /// Phone only: the iPad hero edits the name, role and description in place.
    private var profileRows: [LinkRow] {
        guard !fillsMain else { return [] }
        let role = BotEditSummary.role(current)
        return [
            LinkRow(
                id: "bot-profile-settings.identity",
                title: "Identity",
                subtitle: role.isEmpty ? String(localized: "Name, role and description") : role,
                symbol: "person.text.rectangle"
            ) { actions.openPage(.identity) },
        ]
    }

    private var summaries: BotEditSummaries {
        BotEditSummaries(bot: current, rules: rules, routines: nil, modelLabel: modelLabel)
    }

    /// The desktop's General > Settings (persona-sections.ts TAB_GROUPS,
    /// #3017, G2): Personality, Model (where it works beside it), Before acting.
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
            rows.append(sectionRow(.model, subtitle: summaries.value(.model)))
        }
        if context.sections.contains(.worksOn) {
            rows.append(sectionRow(.worksOn))
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

    /// General > Accounts: the tools, apps and MCP servers it reaches.
    private var accountRows: [LinkRow] {
        context.sections.contains(.access) ? [sectionRow(.access, subtitle: summaries.value(.toolsApps))] : []
    }

    /// General > More: Rules, Voice, Advanced settings, Versions.
    private var moreRows: [LinkRow] {
        var rows: [LinkRow] = []
        if context.sections.contains(.permissions), let rules {
            let counts = BotEditSummary.ruleCounts(rules, botId: current.id)
            let total = counts.ask + counts.deny + counts.allow
            rows.append(LinkRow(
                id: "bot-profile-more.rules",
                title: "Rules",
                subtitle: total == 0 ? String(localized: "No rule") : String(localized: "\(total) rules"),
                symbol: "list.bullet.rectangle"
            ) {
                // iPad opens the Rules document page; the phone, the rules list
                if let openRules = actions.openRules { openRules() } else { actions.openSection(.permissions) }
            })
        }
        if context.sections.contains(.voice) {
            rows.append(sectionRow(.voice))
        }
        if context.sections.contains(.overview) {
            rows.append(LinkRow(
                id: "bot-profile-settings.overview",
                title: "Advanced settings",
                symbol: settingsSymbol(.overview)
            ) { actions.openSection(.overview) })
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

    private func sectionRow(_ section: DesktopPanelSection, subtitle: String? = nil) -> LinkRow {
        LinkRow(
            id: "bot-profile-settings.\(section.rawValue)",
            title: section.title,
            subtitle: subtitle,
            symbol: settingsSymbol(section)
        ) { actions.openSection(section) }
    }

    @ViewBuilder
    private func group(_ title: LocalizedStringKey?, rows: [LinkRow], id: String) -> some View {
        if !rows.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                if let title { groupLabel(title) }
                ProfileCard {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
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

    private func linkRow(_ row: LinkRow) -> some View {
        Button {
            Haptics.selection()
            row.action()
        } label: {
            ProfileRow(
                icon: ProfileRowIcon(systemImage: row.symbol, size: 16),
                title: Text(row.title),
                subtitle: row.subtitle.map { Text(verbatim: $0) },
                height: row.subtitle == nil ? Theme.Profile.singleRow : Theme.Profile.routineRow
            ) { ProfileChevronTrailing() }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(row.id)
    }

    /// Slack, the inbox, then who uses and who sees the bot.
    private var channelsGroup: some View {
        VStack(alignment: .leading, spacing: 8) {
            groupLabel("Channels")
            ProfileCard {
                // Slack shows only where it can be connected or opened; never
                // a detour through Access (#3017, G12)
                if showsSlack {
                channelRow(
                    title: "Slack",
                    subtitle: slackURL == nil ? String(localized: "Not connected") : String(localized: "Connected"),
                    systemImage: "number",
                    pill: slackURL == nil ? "Connect" : "Manage",
                    id: "bot-profile-channel.slack"
                ) {
                    if let slackURL {
                        UIApplication.shared.open(slackURL)
                    } else {
                        actions.openSection(.slack)
                    }
                }
                }
                if let mailRow {
                    if showsSlack { ProfileDivider() }
                    channelRow(
                        title: "Email",
                        subtitle: mailRow.address,
                        systemImage: "envelope",
                        pill: "Copy",
                        id: "bot-profile-channel.email"
                    ) {
                        UIPasteboard.general.string = mailRow.address
                        Haptics.selection()
                    }
                }
                ForEach(Array(audienceRows.enumerated()), id: \.element.id) { index, row in
                    if index > 0 || showsSlack || mailRow != nil { ProfileDivider() }
                    linkRow(row)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("bot-profile-group.channels")
    }

    private var showsSlack: Bool { slackURL != nil || context.sections.contains(.slack) }

    private var audienceRows: [LinkRow] {
        var rows: [LinkRow] = []
        if context.sections.contains(.sharing) { rows.append(sectionRow(.sharing)) }
        if context.sections.contains(.visibility) { rows.append(sectionRow(.visibility, subtitle: privacy)) }
        return rows
    }

    /// The technical pages moved to General > More and Stats (#3017, G1/G2);
    /// the fold keeps Archive and Delete only.
    private var advancedRows: [LinkRow] { [] }

    /// Advanced: the technical pages, then Archive and Delete when this
    /// pairing allows them (hidden, never greyed, otherwise).
    @ViewBuilder
    private var advancedDisclosure: some View {
        if !advancedRows.isEmpty || context.archive || context.delete {
            VStack(alignment: .leading, spacing: 8) {
                Button {
                    Haptics.selection()
                    withAnimation(.snappy(duration: 0.2)) { advancedOpen.toggle() }
                } label: {
                    HStack(spacing: 6) {
                        Text("Advanced")
                            .font(Theme.Font.label)
                            .foregroundStyle(Theme.textTertiary)
                        Image(systemName: "chevron.down")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(Theme.textTertiary)
                            .rotationEffect(.degrees(advancedOpen ? 0 : -90))
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, Theme.Profile.cardMargin + 4)
                    .frame(minHeight: 28)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityValue(Text(advancedOpen ? "Expanded" : "Collapsed"))
                .accessibilityAddTraits(advancedOpen ? [.isSelected, .isButton] : .isButton)
                // The id the Settings fold had, so UITests and deep links still find it.
                .accessibilityIdentifier("bot-profile-settings-toggle")
                if advancedOpen {
                    VStack(alignment: .leading, spacing: 16) {
                        if !advancedRows.isEmpty {
                            ProfileCard {
                                ForEach(Array(advancedRows.enumerated()), id: \.element.id) { index, row in
                                    if index > 0 { ProfileDivider() }
                                    linkRow(row)
                                }
                            }
                        }
                        dangerCard
                    }
                    .transition(.opacity)
                }
            }
        }
    }

    @ViewBuilder
    private var dangerCard: some View {
        if context.archive || context.delete {
            ProfileCard {
                if context.archive {
                    Button {
                        Haptics.selection()
                        actions.archive()
                    } label: {
                        ProfileRow(
                            icon: ProfileRowIcon(systemImage: "archivebox", size: 16),
                            title: Text("Archive…"),
                            titleColor: Theme.textPrimary,
                            height: Theme.Profile.singleRow
                        )
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("bot-profile-archive")
                }
                if context.archive, context.delete { ProfileDivider() }
                if context.delete {
                    Button {
                        Haptics.selection()
                        actions.delete()
                    } label: {
                        ProfileRow(
                            icon: ProfileRowIcon(systemImage: "trash", size: 16, color: Theme.danger),
                            title: Text("Delete bot…"),
                            titleColor: Theme.danger,
                            height: Theme.Profile.singleRow
                        )
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("bot-profile-delete")
                }
            }
        }
    }

    private func channelRow(
        title: LocalizedStringKey,
        subtitle: String,
        systemImage: String,
        pill: LocalizedStringKey,
        id: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            ProfileRow(
                icon: ProfileRowIcon(systemImage: systemImage, size: 16),
                title: Text(title),
                subtitle: Text(verbatim: subtitle),
                height: Theme.Profile.routineRow
            ) {
                Text(pill)
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                    .fixedSize()
                    .padding(.horizontal, 12)
                    .frame(height: 28)
                    .background(Theme.cardRaised, in: Capsule())
                    .padding(.trailing, Theme.Profile.textInset)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(id)
    }

    /// Recap lines: the model's catalog label, the approval rules.
    /// Both reads run together (#3017, L17/G8); the model line draws from
    /// the session's cached catalog first, so it never pops in on a re-open.
    private func loadSummaries() async {
        if let cached = session.cachedInstances { modelLabel = label(in: cached) }
        guard let client = session.settingsClient else { return }
        let botId = bot.id
        let wantsRules = context.sections.contains(.permissions)
        async let readRules: [CustomRuleRow]? = wantsRules ? (try? await client.customRules(botId: botId))?.rules : nil
        async let readInstances = session.refreshInstancesCache()
        let (loadedRules, instances) = await (readRules, readInstances)
        if wantsRules { rules = loadedRules }
        if let instances { modelLabel = label(in: instances) }
    }

    private func label(in instances: [Instance]) -> String? {
        let selection = current.modelSelection
        return instances.first { $0.instanceId == selection.instanceId }?
            .models.options.first { $0.id == selection.model }?.label
    }

    // MARK: Knowledge

    private var knowledgeRows: [LinkRow] {
        var rows: [LinkRow] = []
        // the desktop's Knowledge order (#3017, G3): Routines, Skills, then the folder's Memory
        rows.append(LinkRow(id: "bot-profile-knowledge.routines", title: "Routines", symbol: "clock.arrow.2.circlepath") {
            actions.openRoutines()
        })
        if context.sections.contains(.skills) {
            rows.append(LinkRow(id: "bot-profile-knowledge.skills", title: "Skills", symbol: "book") {
                actions.openSection(.skills)
            })
        }
        if context.sections.contains(.soul), !context.sections.contains(.model) {
            rows.append(LinkRow(
                id: "bot-profile-knowledge.instructions",
                title: "Instructions",
                subtitle: BotEditSummary.soulWritten(current) ? String(localized: "Written") : String(localized: "Not written yet"),
                symbol: "text.alignleft"
            ) { actions.openSection(.soul) })
        }
        if let openFolder = actions.openFolder {
            // iPad: the desktop's Folder, the workspace files with the Memory inside
            rows.append(LinkRow(id: "bot-profile-knowledge.folder", title: "Folder", symbol: "folder") {
                openFolder()
            })
        } else if context.sections.contains(.memory) {
            rows.append(LinkRow(id: "bot-profile-knowledge.memory", title: "Memory", symbol: "brain") {
                actions.openSection(.memory)
            })
        }
        return rows
    }

    private var knowledgeBody: some View {
        // The pill already says Knowledge: no label over the card.
        group(nil, rows: knowledgeRows, id: "bot-profile-group.knowledge")
    }

    // MARK: Appearance and Stats (#3017, G1/G13)

    /// iPad: the desktop's Appearance pane in the page. Phone: the mascot,
    /// colour and picture editor, one tap away.
    @ViewBuilder
    private var appearanceBody: some View {
        if fillsMain {
            PersonaAppearancePane(bot: current)
                .frame(maxWidth: .infinity, alignment: .topLeading)
                .padding(.horizontal, 24)
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("bot-profile.appearance")
        } else {
            group(nil, rows: [
                LinkRow(
                    id: "bot-profile-appearance.avatar",
                    title: "Mascot and colour",
                    subtitle: String(localized: "Mascot, colour and picture"),
                    symbol: "paintpalette"
                ) { actions.editAvatar() },
            ], id: "bot-profile-group.appearance")
        }
    }

    private var statsBody: some View {
        group(nil, rows: context.sections.contains(.usage) ? [sectionRow(.usage)] : [], id: "bot-profile-group.stats")
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
