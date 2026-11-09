// What the Updates pill opens: the active bots, grouped by what they need.
//
// Needs you first, with the answer right there — the phone exists so that
// a stopped bot on the laptop can be un-stopped from wherever you are.
// Then what is working, then what finished while you were not looking.
import SwiftUI
import CompanionCore

struct UpdatesSheet: View {
    @Environment(\.themePalette) var themePalette
    let open: (Chat) -> Void
    @EnvironmentObject private var session: Session
    /// The working lines move with the live text (#3017 L02).
    @ObservedObject private var live = RosterLiveStore.shared
    @Environment(\.dismiss) private var dismiss

    private var updates: [ChatUpdate] { session.state.updates }
    /// The Today box (#2689): every bot's waiting cards, proposals and
    /// questions, with their age, from the server's one list.
    @State private var today: [TodayItem] = []

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Updates")
                        .font(.system(size: 22, weight: .bold))
                    Spacer()
                    Text(updates.isEmpty ? "All quiet" : "\(updates.count) active")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
                }
                .padding(.horizontal, 20)
                .padding(.top, 22)
                .padding(.bottom, 6)

                todaySection

                if updates.isEmpty && today.isEmpty {
                    EmptyStateView(
                        "Nothing needs you",
                        systemImage: "checkmark.circle",
                        description: Text("When a bot stops for an answer, is mid-task, or finishes something, it shows up here.")
                    )
                    .padding(.top, 24)
                } else if !updates.isEmpty {
                    section("Needs you", tint: nil, kind: .needsYou)
                    section("Working", tint: nil, kind: .working)
                    section("To review", tint: nil, kind: .toReview)
                }
            }
            .padding(.bottom, 24)
        }
        .background(Theme.parity(Color(uiColor: .systemBackground), Theme.bg).ignoresSafeArea())
        .task { await loadToday() }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .sheetChromeCompat()
    }

    private func loadToday() async {
        guard let client = session.settingsClient else { return }
        if let payload = try? await client.todayInbox() { today = TodayInbox.rows(payload) }
    }

    @ViewBuilder
    private var todaySection: some View {
        let rows = today.compactMap { item in session.state.bot(forThread: item.threadId).map { (item, Chat.bot($0)) } }
        if !rows.isEmpty {
            Text("Today")
                .textCase(.uppercase)
                .font(.system(size: 12, weight: .bold))
                .tracking(0.5)
                .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
                .padding(.horizontal, 20)
                .padding(.top, 14)
                .padding(.bottom, 2)
            ForEach(rows, id: \.0.id) { item, chat in
                TodayRow(item: item, chat: chat) { open(chat) }
            }
        }
    }

    @ViewBuilder
    private func section(_ title: LocalizedStringKey, tint: Color?, kind: ChatUpdate.Kind) -> some View {
        // one conversation per bot (threads hidden): one row per bot, the
        // newest thing of its conversation, never a row per thread
        let hidden = !SidebarPrefsModel.shared.showThreads
        var seenChats = Set<String>()
        let items = updates.filter { $0.kind == kind }.filter { update in
            guard hidden, case .bot = update.chat else { return true }
            return seenChats.insert(update.chat.id).inserted
        }
        if !items.isEmpty {
            let color = kind == .needsYou ? MausPalette.color(items[0].chat.color) : Theme.parity(Color.secondary, Theme.textSecondary)
            Text(title)
                .textCase(.uppercase)
                .font(.system(size: 12, weight: .bold))
                .tracking(0.5)
                .foregroundStyle(color)
                .padding(.horizontal, 20)
                .padding(.top, 14)
                .padding(.bottom, 2)

            ForEach(items) { update in
                UpdateRow(update: update) { open(update.chat) }
            }
        }
    }
}

/// One Today row: the bot, what it waits on, and for how long.
private struct TodayRow: View {
    let item: TodayItem
    let chat: Chat
    let open: () -> Void
    @EnvironmentObject private var session: Session

    private var what: String {
        switch item.kind {
        case "attention": String(localized: "Needs you")
        case "question": String(localized: "Question")
        case "proposal": String(localized: "Proposal")
        default: String(localized: "Permission")
        }
    }

    var body: some View {
        Button(action: open) {
            HStack(alignment: .top, spacing: 12) {
                ChatAvatarView(chat: chat, size: 40, state: MausState.forChat(chat, in: session))
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.botName)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.textPrimary)
                    Text([what, item.routineName ?? item.threadTitle].compactMap { $0 }.joined(separator: " · "))
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                Text(BotAdvancedWording.ago(item.at))
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
                    .padding(.top, 2)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("today-\(item.key)")
    }
}

private struct UpdateRow: View {
    @Environment(\.themePalette) var themePalette
    let update: ChatUpdate
    let open: () -> Void
    @EnvironmentObject private var session: Session
    @State private var answering = false

    var body: some View {
        Button(action: open) {
            HStack(alignment: .top, spacing: 12) {
                ChatAvatarView(chat: update.chat, size: 40, state: MausState.forChat(update.chat, in: session))

                VStack(alignment: .leading, spacing: 3) {
                    Text(update.chat.name)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.textPrimary)
                    // the thread's title only when threads are a thing on this phone
                    if SidebarPrefsModel.shared.showThreads {
                        Text(update.chat.threadTitle)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
                            .lineLimit(1)
                    }
                    // #2909: a decision gives its whole context before any pick
                    let text = update.kind == .needsYou ? update.context : update.line
                    Text(text.isEmpty ? " " : text)
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
                        .lineLimit(update.kind == .needsYou ? 12 : 1)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: update.kind == .needsYou)

                    if update.kind == .needsYou, let card = update.card, card.isPending {
                        if card.skillRequest != nil {
                            Label("Open the chat to review SKILL.md", systemImage: "doc.text.magnifyingglass")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
                                .padding(.top, 6)
                        } else {
                            // The answers, as pills, from the one rule every
                            // compact surface shares — never a choice
                            // invented here.
                            // #2909: short whole labels, the full answer sent;
                            // answers that cannot be shown whole: Open, to the card
                            let options = update.answerOptions
                            if let labels = update.answerLabels {
                            HStack(spacing: 8) {
                                ForEach(Array(zip(labels, options)), id: \.1) { label, option in
                                    Button {
                                        Haptics.selection()
                                        answering = true
                                        Task {
                                            await session.answer(chat: update.chat, card: card, choice: option)
                                            answering = false
                                        }
                                    } label: {
                                        Text(label)
                                            .font(.system(size: 13, weight: .semibold))
                                            .lineLimit(1)
                                            .fixedSize()
                                            .foregroundStyle(CardStyle.isRefusal(option) ? Theme.textPrimary : .white)
                                            .padding(.horizontal, 14)
                                            .frame(height: 32)
                                            .background(
                                                Capsule().fill(
                                                    CardStyle.isRefusal(option)
                                                        ? Theme.parity(Color.secondary, Theme.textSecondary).opacity(0.18)
                                                        : MausPalette.color(update.chat.color)
                                                )
                                            )
                                    }
                                    .buttonStyle(.plain)
                                    .disabled(answering)
                                    .accessibilityLabel(option)
                                }
                            }
                            .padding(.top, 6)
                            } else if !options.isEmpty {
                                Button(action: open) {
                                    Text(String(localized: "Open"))
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundStyle(.white)
                                        .padding(.horizontal, 14)
                                        .frame(height: 32)
                                        .background(Capsule().fill(MausPalette.color(update.chat.color)))
                                }
                                .buttonStyle(.plain)
                                .padding(.top, 6)
                                .accessibilityIdentifier("update-open-\(update.chat.threadId)")
                            }
                        }
                    }
                }

                Spacer(minLength: 0)

                switch update.kind {
                case .needsYou:
                    EmptyView()
                case .working:
                    ProgressView().controlSize(.small).padding(.top, 10)
                case .toReview:
                    HStack(spacing: 6) {
                        Circle().fill(MausPalette.color(update.chat.color)).frame(width: 10, height: 10)
                        Image(systemName: "chevron.right")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary).opacity(0.5))
                    }
                    .padding(.top, 12)
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("update-\(update.chat.threadId)")
    }
}

/// One definition of "the refusal", shared by every place a card's options
/// are drawn as buttons, so the tints cannot drift apart.
enum CardStyle {
    static func isRefusal(_ option: String) -> Bool {
        OptionCard.isRefusal(option)
    }
}
