import Foundation

/// Structured questions raised by a provider's own "ask the human" tool —
/// Claude's built-in `AskUserQuestion`.
///
/// A port of `shared/ask-question.ts`. The desktop re-reads that tool's input
/// into these questions and puts them on the card; the phone renders them and
/// sends back the same answer text the desktop would, so a question answered
/// here is indistinguishable from one answered on the Mac.
///
/// Decoding is deliberately forgiving. These payloads are bot-authored and
/// arrive inside a transcript: a question whose shape surprises us must cost
/// one card, never the whole conversation.

public struct AskQuestionOption: Codable, Hashable, Sendable {
    public var label: String
    /// The model's one-line gloss under the label. Named `detail` because
    /// `description` is Swift's own printing hook.
    public var detail: String?
    /// Stable id the answer carries when it differs from the visible label
    /// (page-target choice #2048: sagax_page, …). Absent: the label is the answer.
    public var id: String?
    /// Optional icon key the sheet knows (lucide name → SF Symbol on iOS).
    public var icon: String?
    /// Greyed row the person cannot pick (unavailable target with a reason).
    public var disabled: Bool?

    private enum CodingKeys: String, CodingKey {
        case label
        case detail = "description"
        case id
        case icon
        case disabled
    }

    public init(label: String, detail: String? = nil, id: String? = nil, icon: String? = nil, disabled: Bool? = nil) {
        self.label = label
        self.detail = detail
        self.id = id
        self.icon = icon
        self.disabled = disabled
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        label = try container.decode(String.self, forKey: .label)
        detail = try container.decodeIfPresent(String.self, forKey: .detail)
        id = try container.decodeIfPresent(String.self, forKey: .id)
        icon = try container.decodeIfPresent(String.self, forKey: .icon)
        disabled = try container.decodeIfPresent(Bool.self, forKey: .disabled)
    }
}

/// #4490: the control a form row draws, one per kind of answer
/// (`ANSWER_KINDS` in `shared/ask-question.ts`).
public enum AnswerKind: String, Codable, Hashable, Sendable {
    case choice, multi
    case yesNo = "yes_no"
    case duration, time, date, number, text
    case longText = "long_text"

    /// The kinds answered among options; the others take none.
    public var isChoice: Bool { self == .choice || self == .multi || self == .yesNo }
}

/// #4910: the earlier choice row a follow-up hangs under and the answer it
/// was written for (`when` of `shared/ask-question.ts`).
public struct AskWhen: Codable, Hashable, Sendable {
    public var question: String
    public var option: String

    public init(question: String, option: String) {
        self.question = question
        self.option = option
    }
}

public struct AskQuestion: Codable, Hashable, Sendable {
    public var question: String
    /// The short tab label the model gave this question ("Schedule", "Model").
    public var header: String?
    public var multiSelect: Bool?
    public var options: [AskQuestionOption]
    /// #4490: the row's control in a form. Nil: an engine's own question,
    /// drawn as before. A kind this build does not know decodes as nil.
    public var kind: AnswerKind?
    /// #4490: a form row the person may leave empty.
    public var optional: Bool?
    /// #4490: a checklist's rows the bot proposes checked (option ids or labels).
    public var checked: [String]?
    /// #4490: a checklist's buttons; the one pressed is sent with the picks.
    public var actions: [String]?
    /// #4910: a follow-up row shown only under the answer that needs it: the
    /// text of an earlier choice row and one of its option ids (or labels).
    /// Never picked, never sent.
    public var when: AskWhen?

    public init(
        question: String, header: String? = nil, multiSelect: Bool? = nil, options: [AskQuestionOption],
        kind: AnswerKind? = nil, optional: Bool? = nil, checked: [String]? = nil, actions: [String]? = nil,
        when: AskWhen? = nil
    ) {
        self.question = question
        self.header = header
        self.multiSelect = multiSelect
        self.options = options
        self.kind = kind
        self.optional = optional
        self.checked = checked
        self.actions = actions
        self.when = when
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        question = try container.decode(String.self, forKey: .question)
        header = try container.decodeIfPresent(String.self, forKey: .header)
        multiSelect = try container.decodeIfPresent(Bool.self, forKey: .multiSelect)
        // A question with no options is still answerable — the card always
        // offers free text — so a missing list is empty, not a failure.
        options = try container.decodeIfPresent([AskQuestionOption].self, forKey: .options) ?? []
        kind = (try? container.decodeIfPresent(String.self, forKey: .kind)).flatMap { $0 }.flatMap(AnswerKind.init(rawValue:))
        optional = try? container.decodeIfPresent(Bool.self, forKey: .optional)
        checked = try? container.decodeIfPresent([String].self, forKey: .checked)
        actions = try? container.decodeIfPresent([String].self, forKey: .actions)
        when = (try? container.decodeIfPresent(AskWhen.self, forKey: .when)).flatMap { $0 }
    }

    /// What the tab shows. The model names most questions; a numbered
    /// fallback keeps the tabs distinguishable when it does not.
    public func tabLabel(position: Int) -> String {
        if let header, !header.isEmpty { return header }
        return "Question \(position)"
    }

    public var allowsMultiple: Bool { multiSelect == true || kind == .multi }

    /// #4490: a single row with buttons: a list to tick, not a form.
    public var isChecklist: Bool { !(actions ?? []).isEmpty }
    public var isOptional: Bool { optional == true }

    /// The key an option is answered with: its id, else its label.
    public func key(_ option: AskQuestionOption) -> String {
        let id = option.id?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return id.isEmpty ? option.label : id
    }
}

/// #4490: a card drawn as rows with their controls (a form or a checklist)
/// rather than an engine's own question set (`isFormCard`).
public func isFormCard(_ questions: [AskQuestion]) -> Bool {
    questions.contains { $0.kind != nil || $0.isChecklist }
}

/// #4910: the row a follow-up hangs under (`followUpParent` of
/// `shared/ask-question.ts`). A row with `when` hangs under the earlier
/// choice row it names and shows only under that answer. A card written
/// before `when` existed carries an optional text row right after a choice
/// row: it hangs under that row, always shown. Nil: a step of its own.
public func followUpParent(_ questions: [AskQuestion], _ index: Int) -> (parent: Int, conditional: Bool)? {
    guard questions.indices.contains(index) else { return nil }
    let row = questions[index]
    if let when = row.when {
        for at in 0..<index {
            let candidate = questions[at]
            if candidate.question == when.question || candidate.header == when.question, !candidate.options.isEmpty {
                return (at, true)
            }
        }
        return nil
    }
    let inWords = row.kind == .text || row.kind == .longText
    if index > 0, row.isOptional, inWords {
        let previous = questions[index - 1]
        if let kind = previous.kind, kind.isChoice, !previous.isChecklist { return (index - 1, false) }
    }
    return nil
}

/// #4910: which rows are on screen given what each row has picked (option
/// keys). A follow-up shows when its parent shows and, if conditional, the
/// parent holds the answer it was written for (`formRowsShown`).
public func formRowsShown(_ questions: [AskQuestion], picksOf: (Int) -> [String]) -> [Bool] {
    var shown: [Bool] = []
    for (index, row) in questions.enumerated() {
        guard let link = followUpParent(questions, index) else { shown.append(true); continue }
        if !shown[link.parent] { shown.append(false); continue }
        guard link.conditional, let when = row.when else { shown.append(true); continue }
        let parent = questions[link.parent]
        let wanted = Set(parent.options.filter { parent.key($0) == when.option || $0.label == when.option }.map(parent.key))
        shown.append(picksOf(link.parent).contains { wanted.contains($0) })
    }
    return shown
}

/// #4490: what one form row holds while it is being filled in: the picks of
/// a choice, or the words, date, time or number typed, or a duration's hours
/// and minutes (as typed).
public struct FormDraft: Equatable, Sendable {
    public var picked: [String]
    public var value: String
    public var hours: String
    public var minutes: String

    public init(picked: [String] = [], value: String = "", hours: String = "", minutes: String = "") {
        self.picked = picked
        self.value = value
        self.hours = hours
        self.minutes = minutes
    }
}

public struct QuestionRequestCardData: Codable, Hashable, Sendable {
    public var version: Int
    public var questions: [AskQuestion]
    /// Where the ask came from: a tool call (nil) or a block the harness
    /// parsed out of model-authored output ("output"). Badge data only —
    /// it never changes how a card is answered.
    public var origin: String?

    public init(version: Int = 1, questions: [AskQuestion], origin: String? = nil) {
        self.version = version
        self.questions = questions
        self.origin = origin
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = try container.decodeIfPresent(Int.self, forKey: .version) ?? 1
        questions = try container.decodeIfPresent([AskQuestion].self, forKey: .questions) ?? []
        origin = try container.decodeIfPresent(String.self, forKey: .origin)
    }
}

/// The answer text, byte-for-byte what `shared/ask-question.ts` produces.
///
/// It reaches the model as the tool's own result, so it has to stand on its
/// own: name each question, then what was picked for it.
public enum AskQuestionAnswer {
    /// The lead-in exists for the model — the answer is delivered on the
    /// permission contract's deny channel, so it has to say what it is. The
    /// card strips it back off when it shows a person what they sent.
    public static let preamble = "The user answered your questions."

    /// What one question is answered with: the picked options, then the
    /// typed words. An open "Other" field with nothing in it is not an
    /// answer. #4468: a question with no options is answered in words only;
    /// its field is always drawn, so its text counts without an "Other" row.
    public static func answers(
        for question: AskQuestion, picked: Set<String>, otherOpen: Bool, typed: String
    ) -> [String] {
        var chosen = Array(picked).sorted()
        if otherOpen || question.options.isEmpty {
            let words = typed.trimmingCharacters(in: .whitespacesAndNewlines)
            if !words.isEmpty { chosen.append(words) }
        }
        return chosen
    }

    /// #4490: the line that carries a checklist's pressed button.
    public static let actionQuestion = "Action"
    /// #4490: a checklist sent with no row checked.
    public static let nothingPicked = "(none)"
    /// #4490: an optional form row the person left empty (not "not asked").
    public static let leftEmpty = "(left empty)"
    private static let jsonPrefix = "\(preamble)\n\nAnswers (JSON):\n"

    /// `formatQuestionAnswers` of `shared/ask-question.ts`. `action` is the
    /// checklist button pressed: its own last block, and a checklist sent
    /// with nothing checked still says "(none)".
    public static func format(questions: [AskQuestion], answers: [[String]], action: String? = nil) -> String {
        var pairs: [(String, String)] = []
        for (index, question) in questions.enumerated() {
            let picked = (index < answers.count ? answers[index] : [])
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
            if picked.isEmpty && !((action?.isEmpty == false) && question.isChecklist) { continue }
            pairs.append((question.question, picked.isEmpty ? nothingPicked : picked.joined(separator: ", ")))
        }
        if let action, !action.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            pairs.append((actionQuestion, action.trimmingCharacters(in: .whitespacesAndNewlines)))
        }
        guard !pairs.isEmpty else { return "" }
        // Newlines can contain Q:/A: headers; JSON keeps them as answer text.
        if pairs.contains(where: { hasLineBreak($0.0) || hasLineBreak($0.1) }) {
            let body = pairs.map { "[\(jsonString($0.0)),\(jsonString($0.1))]" }.joined(separator: ",")
            return "\(jsonPrefix)[\(body)]"
        }
        return "\(preamble)\n\n\(pairs.map { "Q: \($0.0)\nA: \($0.1)" }.joined(separator: "\n\n"))"
    }

    private static func hasLineBreak(_ value: String) -> Bool {
        value.unicodeScalars.contains { $0 == "\n" || $0 == "\r" }
    }

    /// JSON.stringify of a string, exactly (no escaped slash, \u00xx lowercase).
    static func jsonString(_ value: String) -> String {
        var out = "\""
        for scalar in value.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            case "\u{08}": out += "\\b"
            case "\u{0C}": out += "\\f"
            default:
                if scalar.value < 0x20 { out += String(format: "\\u%04x", scalar.value) } else { out.unicodeScalars.append(scalar) }
            }
        }
        return out + "\""
    }

    /// A duration's total minutes, or nil when nothing was typed (or it is
    /// not more than zero).
    public static func durationMinutes(_ draft: FormDraft) -> Int? {
        func number(_ text: String) -> Double? {
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? 0 : Double(trimmed)
        }
        guard let hours = number(draft.hours), let minutes = number(draft.minutes),
              hours.isFinite, minutes.isFinite, hours >= 0, minutes >= 0 else { return nil }
        let total = (hours * 60 + minutes).rounded(.toNearestOrAwayFromZero)
        return total > 0 && total < 1e9 ? Int(total) : nil
    }

    /// What one form row sends: its picks, or the one value typed.
    public static func rowAnswer(_ question: AskQuestion, _ draft: FormDraft) -> [String] {
        switch question.kind {
        case .choice, .multi, .yesNo: return draft.picked
        case .duration: return durationMinutes(draft).map { ["\($0) min"] } ?? []
        default:
            let value = draft.value.trimmingCharacters(in: .whitespacesAndNewlines)
            return value.isEmpty ? [] : [value]
        }
    }

    /// #4910: which rows a form draws, from what its drafts have picked.
    public static func shownRows(_ questions: [AskQuestion], drafts: [Int: FormDraft]) -> [Bool] {
        formRowsShown(questions) { drafts[$0]?.picked ?? [] }
    }

    /// How many rows still owe an answer (an optional row never does, nor a
    /// follow-up whose answer was not given).
    public static func owed(_ questions: [AskQuestion], drafts: [Int: FormDraft]) -> Int {
        let shown = shownRows(questions, drafts: drafts)
        return questions.enumerated().filter { index, question in
            shown[index] && !question.isOptional && rowAnswer(question, drafts[index] ?? FormDraft()).isEmpty
        }.count
    }

    /// The answer a form sends: an optional row left empty says so. Nil
    /// while a required row is still owed.
    public static func formAnswer(_ questions: [AskQuestion], drafts: [Int: FormDraft]) -> String? {
        guard owed(questions, drafts: drafts) == 0 else { return nil }
        let shown = shownRows(questions, drafts: drafts)
        let rows = questions.enumerated().map { index, question -> [String] in
            if !shown[index] { return [] }
            let row = rowAnswer(question, drafts[index] ?? FormDraft())
            return row.isEmpty ? [leftEmpty] : row
        }
        return format(questions: questions, answers: rows)
    }

    /// A checklist's answer: the ticked items and the button pressed.
    public static func checklistAnswer(_ questions: [AskQuestion], picked: [String], action: String) -> String {
        format(questions: questions, answers: [picked], action: action)
    }

    /// "90 min" read back as hours and minutes for a settled row; nil when
    /// the value is not a duration.
    public static func durationParts(_ value: String) -> (hours: Int, minutes: Int)? {
        let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.hasSuffix(" min"), let total = Int(text.dropLast(4)), total >= 0,
              String(total) == String(text.dropLast(4)) else { return nil }
        return (total / 60, total % 60)
    }

    /// The checklist button an answer was sent with.
    public static func action(in answer: String) -> String? {
        let value = pairs(in: answer).first { $0.0 == actionQuestion }?.1.trimmingCharacters(in: .whitespacesAndNewlines)
        return (value?.isEmpty == false) ? value : nil
    }

    /// Every Q/A pair in an answer, in order: the blocks, or the JSON form.
    static func pairs(in answer: String) -> [(String, String)] {
        if answer.hasPrefix(jsonPrefix) {
            let data = Data(answer.dropFirst(jsonPrefix.count).utf8)
            guard let list = (try? JSONSerialization.jsonObject(with: data)) as? [[String]] else { return [] }
            return list.compactMap { $0.count == 2 ? ($0[0], $0[1]) : nil }
        }
        var result: [(String, String)] = []
        for block in withoutPreamble(answer).components(separatedBy: "\n\nQ: ") {
            let text = block.hasPrefix("Q: ") ? String(block.dropFirst(3)) : block
            guard let split = text.range(of: "\nA: ") else { continue }
            result.append((String(text[..<split.lowerBound]), String(text[split.upperBound...])))
        }
        return result
    }

    /// The answer read back per question ("Q: …\nA: …" blocks), keyed by
    /// the question text. An answer without blocks reads as the only
    /// question's answer.
    public static func byQuestion(_ answer: String, questions: [AskQuestion]) -> [String: String] {
        let body = withoutPreamble(answer)
        var found: [String: String] = [:]
        for (question, value) in pairs(in: answer) where questions.contains(where: { $0.question == question }) {
            found[question] = value
        }
        if found.isEmpty, questions.count == 1, !body.hasPrefix("Q: "), !answer.hasPrefix(jsonPrefix) {
            found[questions[0].question] = body
        }
        return found
    }

    /// Which labels an answer names, and what is left over (an answer in
    /// words). Several picks are joined with ", " and a label may hold a
    /// comma, so the longest labels match first, each as a whole segment.
    /// The same rule as `picksInAnswer` (src/components/QuestionSheet.tsx).
    public static func picks(in value: String, labels: [String]) -> (picked: [String], rest: String) {
        let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return ([], "") }
        if labels.contains(text) { return ([text], "") }
        var remaining = ", \(text), "
        var picked: Set<String> = []
        for label in labels.sorted(by: { $0.count > $1.count }) {
            let needle = ", \(label), "
            guard let range = remaining.range(of: needle) else { continue }
            picked.insert(label)
            remaining.replaceSubrange(range, with: ", ")
        }
        var rest = remaining
        while rest.hasPrefix(", ") { rest.removeFirst(2) }
        while rest.hasSuffix(", ") { rest.removeLast(2) }
        return (labels.filter { picked.contains($0) }, rest.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    /// The same answer without the model-facing lead-in, for a settled card.
    public static func withoutPreamble(_ answer: String) -> String {
        let lead = "\(preamble)\n\n"
        guard answer.hasPrefix(lead) else { return answer }
        return String(answer.dropFirst(lead.count))
    }
}
