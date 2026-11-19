import Foundation

/// One structured fact of a question card (`ask_choice` `facts`, the wire
/// name of `shared/ask-question.ts` `AskFact`): a label and its value, drawn
/// as a row of a compact two-column table above the card's sentence. `record`
/// makes the value the tappable chip of that record (a ticket number).
///
/// Decoding is forgiving like the rest of the card: a row that lacks a label
/// or a value is dropped by `AskFact.shown`, a record that does not validate
/// is read as plain text, so one odd row never costs the whole card.
public struct AskFact: Codable, Hashable, Sendable {
    public var label: String
    public var value: String
    public var record: RecordRef?

    public init(label: String, value: String, record: RecordRef? = nil) {
        self.label = label
        self.value = value
        self.record = record
    }

    private enum CodingKeys: String, CodingKey { case label, value, record }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        label = (try? container.decodeIfPresent(String.self, forKey: .label)) ?? ""
        value = (try? container.decodeIfPresent(String.self, forKey: .value)) ?? ""
        let ref = try? container.decodeIfPresent(RecordRef.self, forKey: .record)
        if let ref, RecordLinks.validName(ref.product), RecordLinks.validName(ref.kind), RecordLinks.validId(ref.id) {
            record = ref
        } else {
            record = nil
        }
    }

    /// The most rows a card draws (the server caps the same).
    public static let maxRows = 12

    /// The rows worth drawing: trimmed, both halves present, capped.
    public static func shown(_ facts: [AskFact]?) -> [AskFact] {
        let rows = (facts ?? []).compactMap { fact -> AskFact? in
            let label = fact.label.trimmingCharacters(in: .whitespacesAndNewlines)
            let value = fact.value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !label.isEmpty, !value.isEmpty else { return nil }
            return AskFact(label: label, value: value, record: fact.record)
        }
        return Array(rows.prefix(maxRows))
    }
}
