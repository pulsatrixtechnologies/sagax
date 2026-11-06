// Bot profile page (Grok Bot panel A, #2127): banner, overlapping mascot,
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
    case general, knowledge, settings
    var id: String { rawValue }

    /// Visible pills (#2136): Settings is folded into General.
    static var visible: [BotProfileTab] { [.general, .knowledge] }

    var title: LocalizedStringKey {
        switch self {
        case .general: "General"
        case .knowledge: "Knowledge"
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

    @State private var tab: BotProfileTab
    @State private var settingsOpen = false
    @StateObject private var owlHandle = OwlMascotHandle()

    init(
        bot: Bot,
        startTab: BotProfileTab = .general,
        context: BotEditContext,
        actions: BotEditActions,
        slackURL: URL? = nil,
        mailRow: BotInboundMailRow? = nil,
        fillsMain: Bool = false
    ) {
        self.bot = bot
        self.startTab = startTab
        self.context = context
        self.actions = actions
        self.slackURL = slackURL
        self.mailRow = mailRow
        self.fillsMain = fillsMain
        // Settings is no longer a tab (#2136); land on General.
        _tab = State(initialValue: startTab == .settings ? .general : startTab)
        _settingsOpen = State(initialValue: startTab == .settings)
    }

    private var current: Bot { session.state.bot(bot.id) ?? bot }

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
                    .frame(maxWidth: fillsMain ? 1100 : .infinity)
                    .frame(maxWidth: .infinity)
                }
            }
            .scrollIndicators(.visible)
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
        // Keep children queryable for UITests (tabs, Settings disclosure).
        .accessibilityIdentifier("bot-profile-page")
    }

    // MARK: Header

    private var banner: some View {
        // Quiet grey gradient like Grok Bot (`bot-profile-banner`, #2141),
        // not the mascot's colour.
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
                state: MausState.forChat(.bot(current), in: session.state),
                animated: true,
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
        // light-dark(#ececec, #3a3a3a) → light-dark(#e0e0e0, #2a2a2a)
        if themePalette.isDark {
            return [
                Color(red: 0x3a / 255, green: 0x3a / 255, blue: 0x3a / 255),
                Color(red: 0x2a / 255, green: 0x2a / 255, blue: 0x2a / 255),
            ]
        }
        return [
            Color(red: 0xec / 255, green: 0xec / 255, blue: 0xec / 255),
            Color(red: 0xe0 / 255, green: 0xe0 / 255, blue: 0xe0 / 255),
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
                    state: MausState.forChat(.bot(current), in: session.state),
                    animated: true,
                    owlHandle: owlHandle
                )
                .frame(width: 170, height: 170)
                .contentShape(Rectangle())
                .onTapGesture { playMove() }
                .accessibilityIdentifier("bot-profile-mascot")
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: headline)
                        .font(.system(size: 28, weight: .regular))
                        .foregroundStyle(desktopTheme.ink)
                        .lineLimit(2)
                        .accessibilityIdentifier("bot-profile-name")
                    if let titleLine {
                        Text(verbatim: titleLine)
                            .font(.system(size: 15))
                            .foregroundStyle(desktopTheme.inkSecondary)
                            .lineLimit(2)
                            .accessibilityIdentifier("bot-profile-title")
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                VStack(spacing: 8) {
                    heroButton("sparkles", "Play a move", id: "bot-profile-play") { playMove() }
                    heroButton("paintpalette", "Appearance", id: "bot-profile-appearance") { actions.editAvatar() }
                }
                .fixedSize()
            }
            .padding(.horizontal, 28)
            .padding(.vertical, 20)
            .frame(height: 210)
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
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("bot-profile-hero")
            HStack(spacing: 6) {
                Image(systemName: "lock")
                    .font(.system(size: 12))
                Text(verbatim: privacy)
                    .font(.system(size: 13.5))
            }
            .foregroundStyle(desktopTheme.inkSecondary)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("bot-profile-privacy")
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

    /// One move on the stage: a wing move for the owl, a Shapes move for a shape.
    private func playMove() {
        Haptics.selection()
        if let wing = OwlWingMove.allCases.randomElement() { owlHandle.flourish(wing) }
        if let shape = ShapeMove.allCases.randomElement() { owlHandle.shape(shape) }
    }

    private var tabPills: some View {
        HStack(spacing: 4) {
            ForEach(BotProfileTab.visible) { item in
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
        }
    }

    // MARK: General

    private var generalBody: some View {
        VStack(alignment: .leading, spacing: 16) {
            channelsCard
            accountsCard
            // Settings folded under General (#2136): nothing removed.
            settingsDisclosure
        }
        .padding(.horizontal, Theme.Profile.cardMargin)
    }

    private var settingsDisclosure: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                Haptics.selection()
                withAnimation(.snappy(duration: 0.2)) { settingsOpen.toggle() }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: settingsOpen ? "chevron.down" : "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.textTertiary)
                        .frame(width: 14)
                    Text("Settings")
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.textTertiary)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 4)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("bot-profile-settings-toggle")
            .accessibilityAddTraits(settingsOpen ? [.isSelected, .isButton] : .isButton)
            if settingsOpen {
                settingsBody
                    .padding(.horizontal, -Theme.Profile.cardMargin)
            }
        }
    }

    private var channelsCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Channels")
                .font(Theme.Font.label)
                .foregroundStyle(Theme.textTertiary)
                .padding(.horizontal, 4)
            ProfileCard {
                channelRow(
                    title: "Slack",
                    subtitle: slackURL == nil ? String(localized: "Not connected") : String(localized: "Connected"),
                    systemImage: "number",
                    pill: slackURL == nil ? "Connect" : "Manage",
                    id: "bot-profile-channel.slack"
                ) {
                    if let slackURL {
                        UIApplication.shared.open(slackURL)
                    } else if context.sections.contains(.slack) {
                        actions.openSection(.slack)
                    } else {
                        actions.openSection(.access)
                    }
                }
                if let mailRow {
                    ProfileDivider()
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
            }
        }
    }

    private var accountsCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Bot accounts")
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textTertiary)
                Spacer()
                Button {
                    Haptics.selection()
                    actions.openSection(.model)
                } label: {
                    Text("Add")
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.textPrimary)
                        .padding(.horizontal, 12)
                        .frame(height: 28)
                        .background(Theme.cardRaised, in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("bot-profile-accounts-add")
            }
            .padding(.horizontal, 4)
            ProfileCard {
                Button {
                    Haptics.selection()
                    actions.openSection(.model)
                } label: {
                    ProfileRow(
                        icon: ProfileRowIcon(systemImage: "cpu", size: 16),
                        title: Text("Model"),
                        subtitle: Text(verbatim: current.modelSelection.model),
                        height: Theme.Profile.routineRow
                    ) { ProfileChevronTrailing() }
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("bot-profile-account.model")
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
                    .padding(.horizontal, 12)
                    .frame(height: 28)
                    .background(Theme.cardRaised, in: Capsule())
                    .padding(.trailing, Theme.Profile.textInset)
            }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(id)
    }

    // MARK: Knowledge

    private var knowledgeBody: some View {
        VStack(alignment: .leading, spacing: 8) {
            knowledgeRow("Skills", systemImage: "book", id: "bot-profile-knowledge.skills") {
                actions.openSection(.skills)
            }
            knowledgeRow("Instructions", systemImage: "text.alignleft", id: "bot-profile-knowledge.instructions") {
                actions.openSection(.soul)
            }
            if context.sections.contains(.memory) {
                knowledgeRow("Memory", systemImage: "brain", id: "bot-profile-knowledge.memory") {
                    actions.openSection(.memory)
                }
            }
        }
        .padding(.horizontal, Theme.Profile.cardMargin)
    }

    private func knowledgeRow(
        _ title: LocalizedStringKey,
        systemImage: String,
        id: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: {
            Haptics.selection()
            action()
        }) {
            ProfileCard {
                ProfileRow(
                    icon: ProfileRowIcon(systemImage: systemImage, size: 16),
                    title: Text(title),
                    height: Theme.Profile.singleRow
                ) { ProfileChevronTrailing() }
            }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(id)
    }

    // MARK: Settings

    /// Progressive disclosure: every remaining persona section, nothing removed.
    private var settingsBody: some View {
        // Set.filter yields a Set; ForEach needs a RandomAccessCollection in
        // CaseIterable order so Settings stays stable across rebuilds.
        let items = DesktopPanelSection.allCases.filter { section in
            guard context.sections.contains(section) else { return false }
            switch section {
            case .soul, .skills, .memory, .slack, .overview: return false
            default: return true
            }
        }
        return VStack(spacing: 8) {
            ForEach(items, id: \.self) { section in
                Button {
                    Haptics.selection()
                    actions.openSection(section)
                } label: {
                    ProfileCard {
                        ProfileRow(
                            icon: ProfileRowIcon(systemImage: settingsSymbol(section), size: 16),
                            title: Text(section.title),
                            height: Theme.Profile.singleRow
                        ) { ProfileChevronTrailing() }
                    }
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("bot-profile-settings.\(section.rawValue)")
            }
            // Destructive actions stay reachable (nothing removed).
            ProfileCard {
                Button {
                    Haptics.selection()
                    actions.archive()
                } label: {
                    ProfileRow(
                        title: Text("Archive…"),
                        titleColor: Theme.textPrimary,
                        height: Theme.Profile.singleRow
                    )
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("bot-profile-archive")
                ProfileDivider(leading: Theme.Profile.textInset)
                Button {
                    Haptics.selection()
                    actions.delete()
                } label: {
                    ProfileRow(
                        title: Text("Delete bot…"),
                        titleColor: Theme.danger,
                        height: Theme.Profile.singleRow
                    )
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("bot-profile-delete")
            }
        }
        .padding(.horizontal, Theme.Profile.cardMargin)
    }

    private func settingsSymbol(_ section: DesktopPanelSection) -> String {
        switch section {
        case .model: "cpu"
        case .access, .worksOn: "desktopcomputer"
        case .permissions: "checkmark.shield"
        case .voice: "waveform"
        case .visibility, .sharing: "person.2"
        case .history: "clock.arrow.circlepath"
        case .usage: "chart.bar"
        default: "gearshape"
        }
    }
}

