import CompanionCore
import SwiftUI

struct WatchQuestionChoices: View {
    let card: OptionCard
    let send: (String) -> Void
    @State private var drafts: [Int: FormDraft] = [:]
    private var questions: [AskQuestion] { card.questions }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(questions.enumerated()), id: \.offset) { index, question in
                Text(question.question).font(.headline)
                ForEach(Array(question.options.enumerated()), id: \.offset) { position, option in
                    let key = question.key(option)
                    Button {
                        var draft = drafts[index] ?? FormDraft()
                        if question.allowsMultiple || question.isChecklist {
                            if draft.picked.contains(key) { draft.picked.removeAll { $0 == key } }
                            else { draft.picked.append(key) }
                        } else {
                            draft.picked = [key]
                        }
                        drafts[index] = draft
                        if questions.count == 1 && !question.allowsMultiple && !question.isChecklist,
                           let answer = formatted { send(answer) }
                    } label: {
                        HStack {
                            Text(drafts[index]?.picked.contains(key) == true ? "✓" : "\(position + 1)")
                                .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                            VStack(alignment: .leading) {
                                Text(option.label)
                                if let detail = option.detail, !detail.isEmpty { Text(detail).font(.caption2).foregroundStyle(.secondary) }
                            }
                        }
                    }.disabled(option.disabled == true)
                }
                if question.kind == .duration {
                    TextField("Hours", text: field(index, \.hours))
                    TextField("Minutes", text: field(index, \.minutes))
                } else if question.options.isEmpty || (question.kind == nil && card.pageTargetChoice == nil) {
                    TextField("Type your answer", text: field(index, \.value))
                }
            }
            if let checklist = questions.first, checklist.isChecklist {
                ForEach(checklist.actions ?? [], id: \.self) { action in
                    Button(action) { send(AskQuestionAnswer.checklistAnswer(questions, picked: drafts[0]?.picked ?? [], action: action)) }
                }
            } else if questions.count != 1 || questions[0].allowsMultiple || questions[0].options.isEmpty || drafts[0]?.value.isEmpty == false {
                Button("Send") { if let formatted { send(formatted) } }.disabled(formatted == nil)
            }
        }
        .onAppear {
            if let question = questions.first, question.isChecklist, drafts.isEmpty {
                let checked = Set(question.checked ?? [])
                drafts[0] = FormDraft(picked: question.options.filter { checked.contains($0.label) || checked.contains(question.key($0)) }.map(question.key))
            }
        }
    }

    private var formatted: String? {
        if card.pageTargetChoice != nil { return drafts[0]?.picked.first }
        if isFormCard(questions) { return AskQuestionAnswer.formAnswer(questions, drafts: drafts) }
        let answers = questions.enumerated().map { index, question in
            let draft = drafts[index] ?? FormDraft()
            return AskQuestionAnswer.answers(for: question, picked: Set(draft.picked), otherOpen: !draft.value.isEmpty, typed: draft.value)
        }
        guard answers.allSatisfy({ !$0.isEmpty }) else { return nil }
        return AskQuestionAnswer.format(questions: questions, answers: answers)
    }

    private func field(_ index: Int, _ path: WritableKeyPath<FormDraft, String>) -> Binding<String> {
        Binding {
            (drafts[index] ?? FormDraft())[keyPath: path]
        } set: { value in
            drafts[index, default: FormDraft()][keyPath: path] = value
        }
    }
}
