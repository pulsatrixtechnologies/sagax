import CompanionCore
import SwiftUI

/// The question card: what the bot actually asked, and its own answers.
///
/// A structured ask (Claude's `AskUserQuestion`) reaches the harness through
/// the permission channel, so before this it drew the ordinary card — a flat
/// row of buttons over "which model should this bot run on?". One tap could
/// not say WHICH question it answered, so a multi-question ask had nothing
/// tappable at all and the phone could only watch it time out.
///
/// The desktop's `src/components/QuestionCard.tsx`, in SwiftUI, drawn with
/// the shared `QuestionSheet` (JC's capture, 2026-10-20): the question in
/// bold, one lettered row per option, an "Other" row that opens a field, a
/// tab per question for a set. One question with one pick answers in one
/// tap; a set or a choose-several question has a quiet send.
/// The answer text is built by `AskQuestionAnswer.format`, so an answer given
/// here is byte-for-byte the one the Mac would have sent.
struct QuestionCardView: View {
    @Environment(\.themePalette) var themePalette
    let chat: Chat
    let message: Message
    @EnvironmentObject private var session: Session

    /// Per question: the option labels ticked, and the free-text reply.
    @State private var picked: [Int: Set<String>] = [:]
    @State private var custom: [Int: String] = [:]
    @State private var other: Set<Int> = []
    @State private var active = 0
    @State private var answering = false
    /// The harness settles the card, but only after a round trip. Holding the
    /// sent answer closes the window where the buttons are still live.
    @State private var sent: String?
    @FocusState private var otherFocused: Bool
    /// iPad desktop shell: QuestionCard.tsx's card (card fill, accent ring
    /// at 40 %, radius 16, 16 in, at most 840 wide).
    @Environment(\.desktopChatText) private var desktop

    private var card: OptionCard? { message.card }
    private var questions: [AskQuestion] { card?.questions ?? [] }

    private var index: Int { min(active, max(questions.count - 1, 0)) }
    private var current: AskQuestion? { questions.indices.contains(index) ? questions[index] : nil }

    /// An open "Other" field with nothing in it is not an answer.
    private func answers(for position: Int) -> [String] {
        var chosen = Array(picked[position] ?? []).sorted()
        if other.contains(position) {
            let typed = (custom[position] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if !typed.isEmpty { chosen.append(typed) }
        }
        return chosen
    }

    private func isAnswered(_ position: Int) -> Bool { !answers(for: position).isEmpty }
    private var complete: Bool { questions.indices.allSatisfy(isAnswered) }
    private var answeredCount: Int { questions.indices.filter(isAnswered).count }
    private var settled: Bool { (card?.answered != nil) || sent != nil }

    private var colors: QuestionSheetColors { QuestionSheetColors(desktop: desktop) }

    var body: some View {
        if let card, !questions.isEmpty {
            if settled {
                settledCard(card)
            } else if let current {
                pendingCard(card, current)
            }
        }
    }

    /// The question is the title when there is one; a set is named by its bot.
    private var named: String { String(localized: "\(chat.name) has a question") }

    private func pendingCard(_ card: OptionCard, _ current: AskQuestion) -> some View {
        let single = questions.count == 1
        let oneTap = single && !current.allowsMultiple && !current.options.isEmpty
        return QuestionSheet(
            colors: colors,
            title: single ? current.question : named,
            meta: single ? nil : String(localized: "\(answeredCount) of \(questions.count)")
        ) {
            if card.questionRequest?.origin == "output" {
                Text("Agent-composed question")
                    .font(colors.font(12))
                    .foregroundStyle(colors.inkSecondary)
            }
            if !single {
                tabs
                Text(current.question)
                    .font(colors.font(13.5))
                    .foregroundStyle(colors.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if current.allowsMultiple {
                Text("Choose all that apply")
                    .font(colors.font(12))
                    .foregroundStyle(colors.inkSecondary)
            }
            VStack(alignment: .leading, spacing: 2) {
                ForEach(Array(current.options.enumerated()), id: \.offset) { position, option in
                    QuestionSheetRow(
                        colors: colors, index: position, label: option.label, detail: option.detail,
                        multi: current.allowsMultiple,
                        on: picked[index]?.contains(option.label) == true,
                        disabled: answering
                    ) { choose(option.label, in: current, oneTap: oneTap) }
                }
                if !current.options.isEmpty {
                    QuestionSheetRow(
                        colors: colors, index: current.options.count, label: String(localized: "Other answer"),
                        multi: current.allowsMultiple, on: other.contains(index), disabled: answering
                    ) { toggleOther(current) }
                }
            }
            if current.options.isEmpty || other.contains(index) {
                QuestionSheetField(
                    colors: colors,
                    placeholder: current.options.isEmpty ? "Type your answer" : "Type your own answer",
                    text: binding(forCustom: index),
                    focus: $otherFocused,
                    canSend: complete && !answering,
                    send: send
                )
            }
            if !oneTap && (current.allowsMultiple || !single) {
                QuestionSheetSend(colors: colors, label: single ? "Submit answer" : "Submit answers", enabled: complete && !answering, action: send)
            }
            if QuestionIgnore.canIgnore(card) {
                QuestionIgnoreControl(colors: colors, expiresAt: card.expiresAt, disabled: answering, action: ignore)
                    .accessibilityIdentifier("question-ignore-\(message.id)")
            }
        }
        .accessibilityIdentifier("question-card-\(message.id)")
    }

    private var tabs: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(Array(questions.enumerated()), id: \.offset) { position, question in
                    Button {
                        Haptics.selection()
                        active = position
                    } label: {
                        HStack(spacing: 4) {
                            if isAnswered(position) {
                                Image(systemName: "checkmark")
                                    .font(.system(size: 10, weight: .bold))
                            }
                            Text(question.tabLabel(position: position + 1))
                                .font(colors.font(13, .medium))
                        }
                        .padding(.horizontal, 12)
                        .frame(height: 28)
                        .background(Capsule().fill(position == index ? colors.ink.opacity(0.08) : Color.clear))
                        .foregroundStyle(position == index ? colors.ink : colors.inkSecondary)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    /// The answered card: each question with what was chosen marked and the
    /// rest dimmed, an answer in words under its rows.
    private func settledCard(_ card: OptionCard) -> some View {
        let answer = card.answeredText ?? sent
        let skipped = QuestionIgnore.isSkip(answer)
        let closed = skipped || (answer == nil && card.answered != nil && card.answered != "answer")
        let readable = skipped ? nil : answer
        let read = readable.map { AskQuestionAnswer.byQuestion($0, questions: questions) } ?? [:]
        let single = questions.count == 1
        let parts = questions.map { question in
            AskQuestionAnswer.picks(in: read[question.question] ?? "", labels: question.options.map(\.label))
        }
        let unreadable = answer != nil && parts.allSatisfy { $0.picked.isEmpty && $0.rest.isEmpty }
        return QuestionSheet(colors: colors, title: single ? questions[0].question : named) {
            ForEach(Array(questions.enumerated()), id: \.offset) { position, question in
                VStack(alignment: .leading, spacing: 6) {
                    if !single {
                        Text(question.question)
                            .font(colors.font(13.5, .medium))
                            .foregroundStyle(colors.ink)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(Array(question.options.enumerated()), id: \.offset) { row, option in
                            QuestionSheetRow(
                                colors: colors, index: row, label: option.label, detail: option.detail,
                                multi: question.allowsMultiple, on: parts[position].picked.contains(option.label), settled: true
                            ) {}
                        }
                    }
                    if !parts[position].rest.isEmpty {
                        QuestionSheetNote(colors: colors, text: parts[position].rest)
                    }
                }
            }
            if unreadable, let readable {
                QuestionSheetNote(colors: colors, text: AskQuestionAnswer.withoutPreamble(readable))
            }
            if closed {
                QuestionSheetNote(colors: colors, text: String(localized: "Closed without an answer"), closed: true)
            } else if answer == nil {
                QuestionSheetNote(colors: colors, text: String(localized: "Answered"))
            }
        }
        .accessibilityIdentifier("question-card-\(message.id)")
    }

    private func binding(forCustom position: Int) -> Binding<String> {
        Binding(get: { custom[position] ?? "" }, set: { custom[position] = $0 })
    }

    private func choose(_ label: String, in question: AskQuestion, oneTap: Bool = false) {
        guard !settled else { return }
        var chosen = picked[index] ?? []
        if question.allowsMultiple {
            if chosen.contains(label) { chosen.remove(label) } else { chosen.insert(label) }
            picked[index] = chosen
            return
        }
        // Single-select is a radio group: picking replaces, and picking an
        // option means the free-text answer was not the one they wanted.
        picked[index] = [label]
        other.remove(index)
        custom[index] = nil
        otherFocused = false
        // One question, one pick: the tap is the whole answer.
        if oneTap { send(); return }
        // Move to the next question they still owe an answer to. The last one
        // stays put so the submit button is under the thumb that just chose.
        if let next = questions.indices.first(where: { $0 != index && !isAnswered($0) }) {
            active = next
        }
    }

    private func toggleOther(_ question: AskQuestion) {
        guard !settled else { return }
        if other.contains(index) {
            other.remove(index)
            otherFocused = false
            return
        }
        other.insert(index)
        if !question.allowsMultiple { picked[index] = [] }
        otherFocused = true
    }

    private func ignore() {
        guard !settled, let card, let requestId = card.requestId, QuestionIgnore.canIgnore(card) else { return }
        sent = QuestionIgnore.answer
        answering = true
        otherFocused = false
        Task {
            await session.answer(
                threadId: chat.threadId,
                requestId: requestId,
                choice: QuestionIgnore.answer,
                isPermission: false
            )
            answering = false
        }
    }

    private func send() {
        guard !settled, complete, let card, let requestId = card.requestId else { return }
        let answer = AskQuestionAnswer.format(
            questions: questions,
            answers: questions.indices.map(answers(for:))
        )
        guard !answer.isEmpty else { return }
        sent = answer
        answering = true
        otherFocused = false
        Task {
            // A question only ever answers with text; the harness rejects an
            // allow/deny on one, so this never takes the permission path.
            await session.answer(
                threadId: chat.threadId,
                requestId: requestId,
                choice: answer,
                isPermission: false
            )
            answering = false
        }
    }
}
