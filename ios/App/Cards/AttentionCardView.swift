import CompanionCore
import SwiftUI

/// What a bot's turn elsewhere left for the person (2026-11-05): a
/// hand-off, a thread another bot opened or a routine run ended with items
/// only the person can do. The desktop's `src/components/AttentionCard.tsx`,
/// for a phone.
///
/// 2026-11-05 (#2081, the owner: "there is a unified chat mode and you keep
/// putting threads everywhere"): it reads as the bot's own message, in the
/// bot's bubble, each item with its ticket; where it comes from is one small
/// grey line under it. With one conversation the person answers right here
/// (`reply`), their words going into the thread the bot asked in. "Open
/// thread" exists only with threads shown (`openThread` non-nil).
struct AttentionCardView: View {
    @Environment(\.themePalette) var themePalette
    let card: PersonAttentionCard
    let tint: Color
    /// Threads shown only: the thread the bot said it in.
    var openThread: ((ThreadRef) -> Void)? = nil
    var openRun: (() -> Void)? = nil
    /// One conversation: the person's answer, sent into the bot's thread.
    var reply: ((String) async throws -> Void)? = nil
    /// #3471: one conversation: skipped without an answer (the waiting work
    /// is told there is none). Nil hides the control.
    var skip: (() async -> Void)? = nil
    /// The message id, for the control's identifier.
    var messageId: String = ""

    @State private var answer = ""
    @State private var sending = false
    @State private var sent = false
    @State private var sendError: String?
    /// A skip in flight: hides the control while it is sent. The fold
    /// itself comes from the message (the session folds it at once and
    /// opens it again when the skip does not land).
    @State private var skipping = false

    private var title: String {
        switch card.kind {
        case "question": String(localized: "\(card.botName) has a question for you")
        case "failure": String(localized: "\(card.botName) needs a decision")
        default: String(localized: "\(card.botName) needs you")
        }
    }

    private var origin: String {
        if let routine = card.routineName, !routine.isEmpty { return String(localized: "From the routine \(routine)") }
        if let opener = card.openedBy { return String(localized: "From work \(opener.name) handed over") }
        return String(localized: "From \(card.threadTitle ?? card.botName)")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            // the bot's own bubble, as its replies are drawn
            let skippable = skip != nil && card.isWaiting && !sent && !skipping
            AttentionItemsView(items: card.items)
                .padding(.leading, Theme.Chat.bubblePaddingH)
                .padding(.trailing, skippable ? 30 : Theme.Chat.bubblePaddingH)
                .padding(.vertical, Theme.Chat.bubblePaddingV)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: Theme.Metric.bubbleRadius, style: .continuous).fill(BubbleColor.theirs)
                )
                // #3471: the one quiet × at the end of the top row
                .overlay(alignment: .topTrailing) {
                    if skippable {
                        CardSkipButton(ink: BubbleColor.theirsText.opacity(0.55), id: messageId) {
                            Task { await runSkip() }
                        }
                        .padding(.top, 2)
                        .padding(.trailing, 2)
                    }
                }
                .accessibilityIdentifier("attention-bubble")

            provenance

            if let fold = WaitingCardSkip.fold(card) {
                // closed without an answer: one quiet line
                WaitingCardFoldLine(fold: fold, ink: Theme.textSecondary, size: 11.5, id: messageId)
                    .padding(.leading, 2)
            } else if reply != nil, !sent, card.isWaiting {
                replyBox
            } else if sent || card.handledAt != nil {
                Text(String(localized: "Answered"))
                    .font(.system(size: 11.5, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .padding(.leading, 2)
                    .accessibilityIdentifier("attention-answered")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: title))
        .accessibilityIdentifier("attention-card")
    }

    /// The small grey line: where it comes from · Open thread (threads shown) · Open run.
    private var provenance: some View {
        HStack(spacing: 6) {
            Text(verbatim: origin)
                .lineLimit(1)
            if card.items.count > 1 {
                dot
                Text(String(localized: "\(card.items.count) items"))
            }
            if let openThread {
                dot
                Button {
                    Haptics.selection()
                    openThread(card.threadRef)
                } label: {
                    HStack(spacing: 2) {
                        Text(String(localized: "Open thread"))
                        Image(systemName: "arrow.right").font(.system(size: 9, weight: .semibold))
                    }
                    .foregroundStyle(Theme.readable(tint))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("attention-open-thread")
            }
            if card.routineRunId != nil, let openRun {
                dot
                Button {
                    Haptics.selection()
                    openRun()
                } label: {
                    HStack(spacing: 2) {
                        Text(String(localized: "Open run"))
                        Image(systemName: "arrow.right").font(.system(size: 9, weight: .semibold))
                    }
                    .foregroundStyle(Theme.readable(tint))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("attention-open-run")
            }
            Spacer(minLength: 0)
        }
        .font(.system(size: 11.5, weight: .medium))
        .foregroundStyle(Theme.textSecondary)
        .padding(.leading, 2)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("attention-provenance")
    }

    private var dot: some View {
        Text(verbatim: "·").accessibilityHidden(true)
    }

    /// The answer box under the message, one conversation: the person's words
    /// go into the thread the bot asked in.
    private var replyBox: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .bottom, spacing: 8) {
                TextField(String(localized: "Your answer"), text: $answer, axis: .vertical)
                    .lineLimit(1...6)
                    .font(.system(size: 15))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Theme.inset))
                    .disabled(sending)
                    .accessibilityIdentifier("attention-reply-field")
                Button {
                    Task { await send() }
                } label: {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Theme.readable(tint))
                        .frame(width: 34, height: 34)
                        .background(Circle().fill(tint.opacity(0.18)))
                }
                .buttonStyle(.plain)
                .disabled(answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || sending)
                .accessibilityLabel(Text("Send"))
                .accessibilityIdentifier("attention-reply-send")
            }
            if let sendError {
                Text(verbatim: sendError)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.danger)
            }
        }
        .padding(.top, 4)
        .accessibilityIdentifier("attention-reply")
    }

    private func runSkip() async {
        guard let skip, !skipping else { return }
        skipping = true
        defer { skipping = false }
        await skip()
    }

    private func send() async {
        let text = answer.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !sending, let reply else { return }
        sending = true
        sendError = nil
        defer { sending = false }
        do {
            try await reply(text)
            sent = true
        } catch {
            sendError = error.localizedDescription
        }
    }
}

/// The items, each with its ticket (shared with the routine run row): a
/// plain list inside the bot's bubble, never a card per item.
struct AttentionItemsView: View {
    @Environment(\.openURL) private var openURL
    let items: [PersonAttentionItem]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                HStack(alignment: .top, spacing: 8) {
                    MarkdownText(source: item.text, inert: true)
                        .foregroundStyle(BubbleColor.theirsText)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if let ticket = item.ticketId {
                        if let url = item.safeTicketURL {
                            Button {
                                Haptics.selection()
                                openURL(url)
                            } label: {
                                HStack(spacing: 3) {
                                    Text(String(localized: "Open ticket \(String(ticket))"))
                                    Image(systemName: "arrow.up.right.square").font(.system(size: 10, weight: .semibold))
                                }
                                .font(.system(size: 11.5, weight: .medium))
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(Capsule().strokeBorder(Theme.textSecondary.opacity(0.4), lineWidth: 0.5))
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(BubbleColor.theirsText)
                            .accessibilityIdentifier("attention-ticket-\(ticket)")
                        } else {
                            Text(verbatim: "#\(ticket)")
                                .font(.system(size: 12, weight: .medium).monospacedDigit())
                                .foregroundStyle(Theme.textSecondary)
                        }
                    }
                }
            }
        }
    }
}
