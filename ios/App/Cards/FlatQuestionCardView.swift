import CompanionCore
import SwiftUI

/// A bot's flat ask (ask_person, a first-run quiz, a question in a room or a
/// bot-to-bot thread): the desktop's `OptionCard.tsx` on the shared
/// `QuestionSheet`. A tap on a row is the answer; the "Other" row opens a
/// field. Once answered the card stays with the pick marked.
/// Permission asks and proposals keep `CardView`.
struct FlatQuestionCardView: View {
    let chat: Chat
    let message: Message
    @EnvironmentObject private var session: Session
    @Environment(\.desktopChatText) private var desktop
    @State private var answering = false
    @State private var other = false
    @State private var custom = ""
    /// The server settles the card after a round trip; the answer sent is
    /// held here so a second tap in that gap sends nothing.
    @State private var sent: String?
    @FocusState private var fieldFocused: Bool

    /// Which cards this view draws: a live ask (the first-run quiz, which has
    /// no request, keeps `CardView`), no tool, no proposal (the same rule as
    /// `isPersistentQuestionCard` in shared/ask-question.ts).
    static func draws(_ card: OptionCard) -> Bool {
        // a proactive proposal (2026-10-30): its two choices, no Other row
        if ProactiveProposalRules.isProposal(card) { return true }
        return card.requestId != nil && card.tool == nil && card.questions.isEmpty && card.skillRequest == nil && card.routineRequest == nil
            && card.profileRequest == nil && card.modelRequest == nil && card.ruleRequest == nil && card.teamSetupRequest == nil
            && card.tighteningRequest == nil && card.held == nil && card.adminApproval != true
    }

    private var hidden: Bool {
        OptionCardRules.hidesOnboardingCard(message, in: session.state.visibleTranscript(forThread: chat.threadId))
    }

    var body: some View {
        if let card = message.card, !hidden {
            let colors = QuestionSheetColors(desktop: desktop)
            let proposal = ProactiveProposalRules.isProposal(card)
            let settled = ((card.requestId != nil || proposal) && card.answered != nil) || sent != nil
            let skipped = QuestionIgnore.isSkip(card.answeredText) || QuestionIgnore.isSkip(sent)
            let closed = skipped || (card.answered != nil && card.answeredText == nil && (card.answered == "deny" || card.answered == "unavailable"))
            let given = settled && !closed ? (card.answeredText ?? sent ?? (card.answered == "answer" || card.answered == "allow" ? "" : card.answered ?? "")) : ""
            let reading = AskQuestionAnswer.picks(in: given, labels: card.options)
            // no X: a waiting live question is answered, never silently
            // dismissed (canDismissOptionCard in OptionCard.tsx)
            QuestionSheet(colors: colors, title: card.title) {
                if !card.subtitle.isEmpty {
                    Text(card.subtitle)
                        .font(colors.font(13))
                        .foregroundStyle(colors.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(card.options.enumerated()), id: \.offset) { position, option in
                        QuestionSheetRow(
                            colors: colors, index: position, label: option,
                            on: settled ? reading.picked.contains(option) : false,
                            settled: settled, disabled: answering
                        ) { answer(card, option) }
                    }
                    if !settled && !proposal {
                        QuestionSheetRow(
                            colors: colors, index: card.options.count, label: String(localized: "Other answer"),
                            on: other, disabled: answering
                        ) {
                            other.toggle()
                            fieldFocused = other
                        }
                    }
                }
                if !settled && !proposal && (other || card.options.isEmpty) {
                    QuestionSheetField(
                        colors: colors,
                        placeholder: "Type your own answer",
                        text: $custom,
                        focus: $fieldFocused,
                        canSend: !custom.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !answering
                    ) { answer(card, custom) }
                }
                if !settled && QuestionIgnore.canIgnore(card) {
                    QuestionIgnoreControl(colors: colors, expiresAt: card.expiresAt, disabled: answering, action: { ignore(card) })
                        .accessibilityIdentifier("question-ignore-\(message.id)")
                }
                if closed {
                    QuestionSheetNote(colors: colors, text: String(localized: "Closed without an answer"), closed: true)
                } else if settled && (!reading.rest.isEmpty || (reading.picked.isEmpty && given.isEmpty)) {
                    QuestionSheetNote(colors: colors, text: reading.rest.isEmpty ? String(localized: "Answered") : reading.rest)
                }
            }
            .accessibilityIdentifier("flat-question-\(message.id)")
        }
    }

    private func ignore(_ card: OptionCard) {
        guard sent == nil, !answering, let requestId = card.requestId, QuestionIgnore.canIgnore(card) else { return }
        sent = QuestionIgnore.answer
        answering = true
        fieldFocused = false
        Task {
            await session.answer(threadId: chat.threadId, requestId: requestId, choice: QuestionIgnore.answer, isPermission: false)
            answering = false
        }
    }

    private func answer(_ card: OptionCard, _ choice: String) {
        let text = choice.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !answering, sent == nil else { return }
        sent = text
        answering = true
        fieldFocused = false
        Task {
            await session.answer(chat: chat, card: card, choice: text)
            answering = false
        }
    }

}
