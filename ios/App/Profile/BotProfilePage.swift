// Bot profile page (Grok Bot panel A, #2127): banner, overlapping mascot,
// "Name · Title", privacy line, pill tabs General / Knowledge / Settings.
// Replaces the Edit bot root as the destination of the panel's gear.
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

    private var headline: String {
        let title = current.title.trimmingCharacters(in: .whitespacesAndNewlines)
        if title.isEmpty { return current.name }
        return "\(current.name) · \(title)"
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
        ScrollView {
            VStack(spacing: 0) {
                banner
                VStack(spacing: 0) {
                    identityBlock
                    tabPills
                        .padding(.top, 16)
                        .padding(.bottom, 12)
                    tabBody
                        .padding(.bottom, 48)
                }
                // Main-column profile: content column ~622 pt like Grok Bot (#2141).
                .frame(maxWidth: fillsMain ? 622 : .infinity)
                .frame(maxWidth: .infinity)
            }
        }
        .scrollIndicators(.visible)
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

