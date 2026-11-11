// What waits for the person, pinned over the composer (#3415, #3471, the
// desktop's PinnedWaitingCard): every approval, question, question in words
// and proposal or offer of the bot, from every topic and its parallel
// tasks, oldest first, read from the server's one list (Session+Waiting).
// One item at a time with "1 of N"; answering or skipping one moves the
// card to the next. Each item is drawn by the card the transcript draws it
// with, answered in its own conversation, so an item settled in one place
// is settled in the other. While an item waits here the conversation draws
// no card for it (#3689, the owner's rule of #3681: one ask, one place);
// once settled, its record is back at its place (`ChatView.pinnedHeld`).
import SwiftUI
import CompanionCore

extension ChatView {
    /// The pinned card's items.
    var pinnedEntries: [PinnedWaitingEntry] { session.pinnedEntries(for: current) }

    /// The approvals among them (the field's placeholder says so).
    var dockApprovals: [PendingApproval] { pinnedEntries.compactMap(\.approval) }

    @ViewBuilder
    var approvalDock: some View {
        let entries = pinnedEntries
        if !entries.isEmpty {
            PinnedWaitingDock(chat: current, entries: entries)
                .transition(.slideUp(reduce: reduceMotion))
        }
    }
}

/// The pinned card's "n of N" over every item waiting.
struct PinnedPager {
    let index: Int
    let count: Int
    let go: (Int) -> Void
}

/// The stepper of the pinned card and the approval dock: the arrows and
/// "n of N".
struct PinnedStepper: View {
    let pager: PinnedPager
    let ink: Color

    var body: some View {
        HStack(spacing: 2) {
            Button {
                Haptics.selection()
                pager.go(max(0, pager.index - 1))
            } label: {
                Image(systemName: "chevron.left").frame(width: 28, height: 28)
            }
            .disabled(pager.index == 0)
            .accessibilityLabel(Text("Previous request"))
            .accessibilityIdentifier("approval-previous")
            Text("\(pager.index + 1) of \(pager.count)")
                .font(.system(size: 12.5).monospacedDigit())
                .accessibilityIdentifier("approval-position")
            Button {
                Haptics.selection()
                pager.go(min(pager.count - 1, pager.index + 1))
            } label: {
                Image(systemName: "chevron.right").frame(width: 28, height: 28)
            }
            .disabled(pager.index >= pager.count - 1)
            .accessibilityLabel(Text("Next request"))
            .accessibilityIdentifier("approval-next")
        }
        .buttonStyle(.plain)
        .font(.system(size: 13, weight: .semibold))
        .foregroundStyle(ink)
    }
}

struct PinnedWaitingDock: View {
    let chat: Chat
    let entries: [PinnedWaitingEntry]
    @EnvironmentObject private var session: Session
    @Environment(\.desktopChatText) private var desktop
    /// The item the person is on, by key, and where it sat: once it leaves
    /// (answered, skipped, expired) the one after it moves into its place.
    @State private var placeKey: String?
    @State private var placeAt = 0

    var body: some View {
        let index = PinnedWaiting.index(entries, key: placeKey, at: placeAt)
        let entry = entries[index]
        let pager = PinnedPager(index: index, count: entries.count) { to in
            guard entries.indices.contains(to) else { return }
            placeKey = entries[to].id
            placeAt = to
        }
        Group {
            if let pending = entry.approval {
                ApprovalDock(
                    chat: chat, approvals: [titled(pending)], pager: pager,
                    readOnlyPool: entries.compactMap(\.approval).map(titled)
                )
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 6) {
                        Text(verbatim: "?")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(Theme.readable(MausPalette.color(chat.color)))
                            .frame(width: 20, height: 20)
                            .background(Circle().fill(MausPalette.color(chat.color).opacity(0.15)))
                            .accessibilityHidden(true)
                        Text(verbatim: Self.waitingLine(entry.item.botName.isEmpty ? chat.name : entry.item.botName))
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textSecondary)
                            .lineLimit(1)
                            .accessibilityIdentifier("pinned-title")
                        Spacer(minLength: 0)
                        if entries.count > 1 { PinnedStepper(pager: pager, ink: Theme.textSecondary) }
                    }
                    .padding(.horizontal, 4)
                    item(entry)
                }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("pinned-waiting")
            }
        }
        .id(entry.id)
        .onAppear {
            // the captures open on one item of each kind
            if placeKey == nil, let at = session.previewPinnedAt { placeAt = at }
        }
    }

    /// "Ara is waiting for your answer".
    static func waitingLine(_ name: String) -> String {
        String(format: String(localized: "pinned.waiting", defaultValue: "%@ is waiting for your answer"), name)
    }

    /// The conversation the item sits in: its own topic or task, where its
    /// answer goes.
    private func itemChat(_ entry: PinnedWaitingEntry) -> Chat {
        guard case var .bot(bot) = chat, bot.threadId != entry.threadId else { return chat }
        bot.threadId = entry.threadId
        return .bot(bot)
    }

    /// An approval of a parallel task names that task.
    private func titled(_ pending: PendingApproval) -> PendingApproval {
        guard case let .bot(bot) = chat, let threadId = pending.threadId,
              let task = session.state.bot(bot.id)?.tasks?.first(where: { $0.threadId == threadId && $0.parallelOf != nil })
        else { return pending }
        var titled = pending
        titled.parallelTitle = task.title
        return titled
    }

    @ViewBuilder
    private func item(_ entry: PinnedWaitingEntry) -> some View {
        let place = itemChat(entry)
        let message = entry.message
        if message.card == nil, let card = InputRequestRules.card(message) {
            // a question in words: a "needs you" card or a parked teammate's
            AttentionCardView(
                card: card,
                tint: MausPalette.color(chat.color),
                reply: { text in try await session.answerAttention(card, text: text, message: message, in: place) },
                skip: { await session.skipAttention(message, in: place) },
                messageId: message.id
            )
        } else {
            OptionsKindRow(message: message, chat: place)
        }
    }
}
