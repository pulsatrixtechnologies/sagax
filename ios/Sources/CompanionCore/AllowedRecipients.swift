import Foundation

// Allowed recipients (shared/allowed-recipients.ts, the editor half).
// The phone reads an entry the same way the desktop does before it PATCHes
// `allowedRecipients`. The server still checks the list. This file does not
// decide whether a send skips its card.

public struct RecipientEntry: Equatable, Sendable {
    public enum Kind: String, Equatable, Sendable { case bot, email, phone }
    public var kind: Kind
    public var value: String
    public var key: String { "\(kind.rawValue):\(value)" }
}

public struct RecipientLabel: Equatable, Sendable {
    public var text: String
    /// A bot id, kept for the tooltip. Never drawn as the label.
    public var title: String?
    public var deleted: Bool
}

public enum AllowedRecipients {
    public static let maximum = 200

    /// An address as it is compared, or nil.
    public static func normalizeEmail(_ raw: String) -> String? {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard value.count <= 254, value.range(of: #"^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$"#, options: .regularExpression) != nil else { return nil }
        return value
    }

    /// A number as it is compared: `+` and its digits. Ten digits with no
    /// country code read as North American (+1).
    public static func normalizePhone(_ raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.range(of: #"^\+?[\d\s().-]{7,24}$"#, options: .regularExpression) != nil else { return nil }
        var digits = ""
        for scalar in trimmed.unicodeScalars where scalar.value >= 48 && scalar.value <= 57 {
            digits.append(Character(scalar))
        }
        if !trimmed.hasPrefix("+"), digits.count == 10 { digits = "1" + digits }
        guard (7...15).contains(digits.count) else { return nil }
        return "+" + digits
    }

    /// One entry, typed (`email:a@b.c`) or bare (an address, a number).
    public static func parse(_ raw: String) -> RecipientEntry? {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if let match = text.range(of: #"^(bot|email|phone):(.*)$"#, options: [.regularExpression, .caseInsensitive]) {
            let whole = String(text[match])
            let parts = whole.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
            guard parts.count == 2, let kind = RecipientEntry.Kind(rawValue: parts[0].lowercased()) else { return nil }
            let rest = parts[1].trimmingCharacters(in: .whitespacesAndNewlines)
            switch kind {
            case .bot:
                guard rest.range(of: #"^[\w-]{1,128}$"#, options: .regularExpression) != nil else { return nil }
                // `\w` in the desktop's check is ASCII. Reject anything else.
                guard rest.unicodeScalars.allSatisfy({ scalar in
                    (scalar.value >= 48 && scalar.value <= 57) || (scalar.value >= 65 && scalar.value <= 90)
                        || (scalar.value >= 97 && scalar.value <= 122) || scalar == "_" || scalar == "-"
                }) else { return nil }
                return RecipientEntry(kind: .bot, value: rest)
            case .email:
                guard let value = normalizeEmail(rest) else { return nil }
                return RecipientEntry(kind: .email, value: value)
            case .phone:
                guard let value = normalizePhone(rest) else { return nil }
                return RecipientEntry(kind: .phone, value: value)
            }
        }
        if let email = normalizeEmail(text) { return RecipientEntry(kind: .email, value: email) }
        if let phone = normalizePhone(text) { return RecipientEntry(kind: .phone, value: phone) }
        return nil
    }

    /// The stored list, deduplicated, or nil when one entry is not a recipient.
    public static func normalize(_ values: [String]) -> [String]? {
        var out: [String] = []
        for raw in values {
            guard let entry = parse(raw) else { return nil }
            if !out.contains(entry.key) { out.append(entry.key) }
        }
        return out.count > maximum ? nil : out
    }

    public enum Add: Equatable, Sendable {
        case invalid
        case unchanged
        case next([String])
    }

    /// The text field: an address or a number. A bot is chosen from the list,
    /// not typed (AllowedRecipientsRow.add).
    public static func addingPerson(_ raw: String, to list: [String]) -> Add {
        guard let entry = parse(raw), entry.kind != .bot else { return .invalid }
        if list.contains(entry.key) { return .unchanged }
        let next = list + [entry.key]
        return next.count > maximum ? .invalid : .next(next)
    }

    public static func addingBot(id: String, to list: [String]) -> [String]? {
        guard parse("bot:\(id)")?.kind == .bot else { return nil }
        let key = "bot:\(id)"
        if list.contains(key) { return list }
        let next = list + [key]
        return next.count > maximum ? nil : next
    }

    /// How one entry reads. A bot by its name, never its id.
    public static func label(_ key: String, botName: (String) -> String?) -> RecipientLabel {
        guard let entry = parse(key) else { return RecipientLabel(text: "Deleted bot", title: key, deleted: true) }
        if entry.kind != .bot { return RecipientLabel(text: entry.value, title: nil, deleted: false) }
        if let name = botName(entry.value) { return RecipientLabel(text: name, title: entry.value, deleted: false) }
        return RecipientLabel(text: "Deleted bot", title: entry.value, deleted: true)
    }

    public static func failureText(apiCode: String?, serverMessage: String?) -> String {
        if apiCode == "invalid_recipients" { return "Enter an email address or a phone number." }
        if let serverMessage, serverMessage.range(of: #"allowedRecipients must be|invalid_recipients"#, options: .regularExpression) != nil {
            return "Enter an email address or a phone number."
        }
        if apiCode == "standing_grants_off" {
            return "Your organization requires an approval each time: this list is paused."
        }
        return serverMessage ?? "Couldn't save that recipient."
    }
}
