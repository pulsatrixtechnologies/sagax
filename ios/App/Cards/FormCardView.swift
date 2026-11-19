import CompanionCore
import SwiftUI

/// #4490: a question card a bot asks as a form (a row per question, each with
/// the control for its kind) or a checklist (items to tick, then the bot's
/// buttons). The desktop's `src/components/QuestionForm.tsx` in SwiftUI, on
/// the same sheet as every question card. The answer text is built by
/// `AskQuestionAnswer`, so the same input sends the same text as the Mac.
///
/// Pending, the card is NOT one tall transcript row: in the chat it is drawn
/// as several rows of the lazy stack (`FormCardPieces`), each of ordinary
/// height, sharing one background. This view is the whole card in one piece:
/// settled (short), and pending only where a card is not in the transcript's
/// lazy stack. Both read the same `FormCardState`.
struct FormCardView: View {
    @Environment(\.themePalette) private var themePalette
    @Environment(\.desktopChatText) private var desktop
    @ObservedObject private var state: FormCardState
    let chat: Chat
    let message: Message
    @ScaledMetric(relativeTo: .body) private var scale: CGFloat = 1

    init(chat: Chat, message: Message) {
        self.chat = chat
        self.message = message
        _state = ObservedObject(wrappedValue: FormCardStore.shared.state(chat: chat, message: message))
    }

    private var card: OptionCard? { message.card }
    private var questions: [AskQuestion] { card?.questions ?? [] }
    private var checklist: Bool { state.checklist }
    private var colors: QuestionSheetColors { formColors(desktop: desktop, scale: scale) }
    private var ink2: Color { colors.inkSecondary }

    private var contextLine: String? { FormCardPieces.contextLine(message) }

    var body: some View {
        if let card, !questions.isEmpty {
            if FormCardPieces.isSettled(message, state: state) {
                settledCard(card)
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    FormSegment(first: true, last: false) {
                        FormHeadContent(chat: chat, message: message, state: state)
                    }
                    if checklist {
                        ForEach(Array(questions[0].options.enumerated()), id: \.offset) { position, _ in
                            FormSegment(first: false, last: false) {
                                FormChecklistItem(state: state, index: position)
                            }
                        }
                    } else {
                        ForEach(Array(questions.indices), id: \.self) { index in
                            FormRowPiece(state: state, index: index)
                        }
                    }
                    FormSegment(first: false, last: true) {
                        FormFooterContent(chat: chat, message: message, state: state)
                    }
                }
                .accessibilityIdentifier("question-card-\(message.id)")
            }
        }
    }

    // MARK: settled

    private func settledCard(_ card: OptionCard) -> some View {
        let answer = card.answeredText ?? state.sent
        let fold = WaitingCardSkip.fold(card)
        let closed = fold != nil || (answer == nil && card.answered != nil && card.answered != "answer")
        let readable = fold != nil ? nil : answer
        let byQuestion = readable.map { AskQuestionAnswer.byQuestion($0, questions: questions) } ?? [:]
        let pressed = readable.flatMap { AskQuestionAnswer.action(in: $0) }
        return QuestionSheet(colors: colors, title: card.title) {
            if let contextLine {
                Text(contextLine)
                    .font(colors.font(13))
                    .foregroundStyle(colors.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if checklist {
                let only = questions[0]
                let given = byQuestion[only.question] ?? ""
                let picked = AskQuestionAnswer.picks(
                    in: given == AskQuestionAnswer.nothingPicked ? "" : given, labels: only.options.map(only.key)
                ).picked
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(only.options.enumerated()), id: \.offset) { position, option in
                        QuestionSheetRow(
                            colors: colors, index: position, label: option.label, detail: option.detail,
                            multi: true, on: picked.contains(only.key(option)), settled: true, quiet: true
                        ) {}
                    }
                }
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(questions.enumerated()).filter { _, question in
                        // #4910: a follow-up whose answer was never picked was not asked
                        question.when == nil || readable == nil || byQuestion[question.question] != nil
                    }, id: \.offset) { index, question in
                        let given = byQuestion[question.question]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                        let value = given == AskQuestionAnswer.leftEmpty ? "" : given
                        let label = Text(question.question)
                            .font(colors.font(13))
                            .foregroundStyle(ink2)
                        let answerText = Text(value.isEmpty ? String(localized: "Not answered") : shown(question, value))
                            .font(colors.font(13, .medium))
                            .foregroundStyle(value.isEmpty ? ink2 : colors.ink)
                        // at a large text size the answer goes under its question
                        Group {
                            if scale > 1.4 {
                                VStack(alignment: .leading, spacing: 2) {
                                    label.frame(maxWidth: .infinity, alignment: .leading)
                                    answerText.frame(maxWidth: .infinity, alignment: .leading)
                                }
                            } else {
                                HStack(alignment: .firstTextBaseline, spacing: 12) {
                                    label.frame(maxWidth: .infinity, alignment: .leading)
                                    answerText.multilineTextAlignment(.trailing).frame(maxWidth: 180, alignment: .trailing)
                                }
                            }
                        }
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                        .padding(.vertical, 6)
                        .overlay(alignment: .top) {
                            if index > 0 { Rectangle().fill(colors.ink.opacity(0.06)).frame(height: 1) }
                        }
                    }
                }
            }
            if let pressed {
                QuestionSheetNote(colors: colors, text: String(localized: "Chosen: \(pressed)"))
            }
            if closed {
                QuestionSheetNote(colors: colors, text: fold.map(WaitingCardWords.fold) ?? String(localized: "Closed without an answer"), closed: true)
            } else if answer == nil {
                QuestionSheetNote(colors: colors, text: String(localized: "Answered"))
            }
        }
        .accessibilityIdentifier("question-card-\(message.id)")
    }

    /// A settled row's answer as the person reads it.
    private func shown(_ question: AskQuestion, _ value: String) -> String {
        if question.kind == .duration, let parts = AskQuestionAnswer.durationParts(value) {
            if parts.hours == 0 { return String(localized: "\(parts.minutes) min") }
            return parts.minutes == 0
                ? String(localized: "\(parts.hours) h")
                : String(localized: "\(parts.hours) h \(parts.minutes) min")
        }
        guard question.kind?.isChoice == true else { return value }
        let split = AskQuestionAnswer.picks(in: value, labels: question.options.map(question.key))
        let labels = split.picked.compactMap { key in
            question.options.first { question.key($0) == key }.map { formOptionLabel(question, $0) }
        }
        return (labels + (split.rest.isEmpty ? [] : [split.rest])).joined(separator: ", ")
    }
}
