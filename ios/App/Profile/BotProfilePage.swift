// Bot profile page (Grok Bot panel A, #2127): banner, overlapping mascot,
// "Name · Title", privacy line, pill tabs General / Knowledge / Settings.
// Replaces the Edit bot root as the destination of the panel's gear.
import CompanionCore
import SwiftUI
import UIKit

enum BotProfileTab: String, CaseIterable, Hashable, Identifiable {
    case general, knowledge, settings
    var id: String { rawValue }

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

    @State private var tab: BotProfileTab
    @StateObject private var owlHandle = OwlMascotHandle()

    init(
        bot: Bot,
        startTab: BotProfileTab = .general,
        context: BotEditContext,
        actions: BotEditActions,
        slackURL: URL? = nil,
        mailRow: BotInboundMailRow? = nil
    ) {
        self.bot = bot
        self.startTab = startTab
        self.context = context
        self.actions = actions
        self.slackURL = slackURL
        self.mailRow = mailRow
        _tab = State(initialValue: startTab)
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
                identityBlock
                tabPills
                    .padding(.top, 16)
                    .padding(.bottom, 12)
                tabBody
                    .padding(.bottom, 48)
            }
        }
        .scrollIndicators(.visible)
        .background(Theme.bg.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                ProfileBackButton { actions.close() }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("bot-profile-page")
    }

    // MARK: Header

    private var banner: some View {
        LinearGradient(
            colors: [
                Theme.cardRaised,
                Theme.card,
                Theme.bg,
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .frame(height: 120)
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
        .accessibilityHidden(true)
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
            ForEach(BotProfileTab.allCases) { item in
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
                .accessibilityAddTraits(on ? [.isSelected, .isButton] : .isButton)
                .accessibilityIdentifier("bot-profile-tab.\(item.rawValue)")
            }
        }
        .padding(4)
        .background(Theme.card.opacity(0.55), in: Capsule())
        .frame(maxWidth: .infinity)
        .accessibilityIdentifier("bot-profile-tabs")
    }

    @ViewBuilder
    private var tabBody: some View {
        switch tab {
        case .general: generalBody
        case .knowledge: knowledgeBody
        case .settings: settingsBody
        }
    }

    // MARK: General

    private var generalBody: some View {
        VStack(alignment: .leading, spacing: 16) {
            channelsCard
            accountsCard
        }
        .padding(.horizontal, Theme.Profile.cardMargin)
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

