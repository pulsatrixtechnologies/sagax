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

    private enum CodingKeys: String, CodingKey {
        case label
        case detail = "description"
    }

    public init(label: String, detail: String? = nil) {
        self.label = label
        self.detail = detail
    }
}

public struct AskQuestion: Codable, Hashable, Sendable {
    public var question: String
    /// The short tab label the model gave this question ("Schedule", "Model").
    public var header: String?
    public var multiSelect: Bool?
    public var options: [AskQuestionOption]

    public init(question: String, header: String? = nil, multiSelect: Bool? = nil, options: [AskQuestionOption]) {
        self.question = question
        self.header = header
        self.multiSelect = multiSelect
        self.options = options
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        question = try container.decode(String.self, forKey: .question)
        header = try container.decodeIfPresent(String.self, forKey: .header)
        multiSelect = try container.decodeIfPresent(Bool.self, forKey: .multiSelect)
        // A question with no options is still answerable — the card always
        // offers free text — so a missing list is empty, not a failure.
        options = try container.decodeIfPresent([AskQuestionOption].self, forKey: .options) ?? []
    }

    /// What the tab shows. The model names most questions; a numbered
    /// fallback keeps the tabs distinguishable when it does not.
    public func tabLabel(position: Int) -> String {
        if let header, !header.isEmpty { return header }
        return "Question \(position)"
    }

    public var allowsMultiple: Bool { multiSelect == true }
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

    public static func format(questions: [AskQuestion], answers: [[String]]) -> String {
        var blocks: [String] = []
        for (index, question) in questions.enumerated() {
            let picked = (index < answers.count ? answers[index] : [])
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
            guard !picked.isEmpty else { continue }
            blocks.append("Q: \(question.question)\nA: \(picked.joined(separator: ", "))")
        }
        guard !blocks.isEmpty else { return "" }
        return "\(preamble)\n\n\(blocks.joined(separator: "\n\n"))"
    }

    /// The answer read back per question ("Q: …\nA: …" blocks), keyed by
    /// the question text. An answer without blocks reads as the only
    /// question's answer.
    public static func byQuestion(_ answer: String, questions: [AskQuestion]) -> [String: String] {
        let body = withoutPreamble(answer)
        var found: [String: String] = [:]
        for block in body.components(separatedBy: "\n\nQ: ") {
            let text = block.hasPrefix("Q: ") ? String(block.dropFirst(3)) : block
            guard let split = text.range(of: "\nA: ") else { continue }
            let question = String(text[..<split.lowerBound])
            if questions.contains(where: { $0.question == question }) {
                found[question] = String(text[split.upperBound...])
            }
        }
        if found.isEmpty, questions.count == 1, !body.hasPrefix("Q: ") {
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
