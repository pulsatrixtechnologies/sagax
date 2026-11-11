// Issue #426: the approval card the iPhone and the iPad draw, as the desktop
// does (src/components/ApprovalCard.tsx, PendingApproval.tsx):
//
// - a teammate tool (coordinate_bots, ask_bot, delegate_bot, send_to_bot)
//   reads as "Quasar wants to write to 3 bots" or "... to Nova", the
//   recipients by name and face, the message quoted and cut near 240
//   characters with "See all";
// - the gate's subtitle "<tool> {json}" is arguments, never the visible line;
// - the held note is one quiet line, and the provider's own and the routine
//   gate's notes are not shown;
// - an answered or expired ask stays in the chat as a one-line receipt
//   ("Always allowed · Write to 3 bots") that opens on the request.
import Foundation

// MARK: - Teammate asks

public struct TeammateAsk: Hashable, Sendable {
    /// The tool without its server: coordinate_bots, ask_bot, delegate_bot
    /// or send_to_bot.
    public var tool: String
    /// The recipients as the bot named them: a teammate id or a name.
    public var recipients: [String]
    /// What the bot writes to them.
    public var message: String

    public static let tools: Set<String> = ["coordinate_bots", "ask_bot", "delegate_bot", "send_to_bot"]
    /// Where the quoted message is cut, "See all" showing the rest.
    public static let quoteLimit = 240
    /// A preview past this is read loosely (the gate cuts it there).
    public static let looseLimit = 2_000

    public init(tool: String, recipients: [String], message: String) {
        self.tool = tool
        self.recipients = recipients
        self.message = message
    }

    /// The tool's own name: `mcp__agents__ask_bot`, `agents__ask_bot` and
    /// `ask_bot` are one tool.
    public static func toolName(_ raw: String?) -> String? {
        guard let raw = raw?.trimmingCharacters(in: .whitespaces), !raw.isEmpty else { return nil }
        let name = raw.components(separatedBy: "__").last ?? raw
        return tools.contains(name) ? name : nil
    }

    /// The card's teammate ask, or nil for any other card. Its arguments
    /// are the tool input when the card carries it, else the gate's
    /// subtitle `<tool> {json}` without the tool id, else a loose read of a
    /// preview cut at 2,000 characters.
    public static func parse(_ card: OptionCard) -> TeammateAsk? {
        guard !ApprovalDockRules.isProposal(card) else { return nil }
        guard let tool = toolName(card.mcpTool) ?? toolName(card.tool) ?? gateTool(card.subtitle) else { return nil }
        if let input = card.toolInput, let ask = fromJSON(input, tool: tool) { return ask }
        let subtitle = card.subtitle.trimmingCharacters(in: .whitespacesAndNewlines)
        let arguments = GateArguments.split(subtitle, known: [card.tool, card.mcpTool])?.json ?? subtitle
        if let ask = fromJSON(arguments, tool: tool) { return ask }
        return loose(String(arguments.prefix(looseLimit)), tool: tool)
    }

    /// The tool a gate subtitle names first ("mcp__agents__ask_bot {...}").
    static func gateTool(_ subtitle: String) -> String? {
        GateArguments.split(subtitle.trimmingCharacters(in: .whitespacesAndNewlines)).flatMap { toolName($0.tool) }
    }

    static func fromJSON(_ text: String, tool: String) -> TeammateAsk? {
        guard let data = text.data(using: .utf8),
              let args = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        var recipients: [String] = []
        if let ids = args["bot_ids"] as? [Any] { recipients = ids.compactMap { $0 as? String } }
        if let id = args["bot_id"] as? String { recipients.append(id) }
        let message = (args["message"] as? String) ?? ""
        recipients = recipients.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        guard !recipients.isEmpty || !message.isEmpty else { return nil }
        return TeammateAsk(tool: tool, recipients: recipients, message: message)
    }

    /// A preview the gate cut mid-JSON: the ids and the message as far as
    /// they go.
    static func loose(_ text: String, tool: String) -> TeammateAsk? {
        var recipients: [String] = []
        if let list = firstMatch(#""bot_ids"\s*:\s*\[([^\]]*)"#, in: text) {
            recipients = matches(#""((?:[^"\\]|\\.)*)""#, in: list).map(unescape)
        }
        if let one = firstMatch(#""bot_id"\s*:\s*"((?:[^"\\]|\\.)*)""#, in: text) { recipients.append(unescape(one)) }
        let message = firstMatch(#""message"\s*:\s*"((?:[^"\\]|\\.)*)"?"#, in: text).map(unescape) ?? ""
        recipients = recipients.filter { !$0.isEmpty }
        guard !recipients.isEmpty || !message.isEmpty else { return nil }
        return TeammateAsk(tool: tool, recipients: recipients, message: message)
    }

    /// The quote: whitespace kept, cut on a word near 240 characters.
    public var quote: String { Self.cut(message, limit: Self.quoteLimit) }
    public var quoteIsCut: Bool { message.count > Self.quoteLimit }

    public static func cut(_ text: String, limit: Int) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count > limit else { return trimmed }
        var head = String(trimmed.prefix(limit))
        if let space = head.lastIndex(where: { $0.isWhitespace }), head.distance(from: head.startIndex, to: space) > limit * 3 / 4 {
            head = String(head[..<space])
        }
        return head.trimmingCharacters(in: .whitespacesAndNewlines) + "…"
    }

    private static func firstMatch(_ pattern: String, in text: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.dotMatchesLineSeparators]),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              match.numberOfRanges > 1, let range = Range(match.range(at: 1), in: text) else { return nil }
        return String(text[range])
    }

    private static func matches(_ pattern: String, in text: String) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
        return regex.matches(in: text, range: NSRange(text.startIndex..., in: text)).compactMap { match in
            Range(match.range(at: 1), in: text).map { String(text[$0]) }
        }
    }

    private static func unescape(_ raw: String) -> String {
        if let data = "\"\(raw)\"".data(using: .utf8), let value = try? JSONDecoder().decode(String.self, from: data) { return value }
        return raw.replacingOccurrences(of: "\\n", with: "\n").replacingOccurrences(of: "\\\"", with: "\"")
    }
}

// MARK: - The gate's subtitle

/// The gate writes `<tool> {json}` as a card's subtitle: arguments, never
/// the visible line (they go behind "See the full request").
public enum GateArguments {
    /// The tool id and its JSON when `subtitle` is `<tool> {json}`. The id
    /// is a server tool (`a__b`), one of `known`, or a teammate tool: a
    /// command such as `echo {a,b}` is never read as one.
    public static func split(_ subtitle: String, known: [String?] = []) -> (tool: String, json: String)? {
        guard let space = subtitle.firstIndex(of: " ") else { return nil }
        let tool = String(subtitle[..<space])
        let rest = subtitle[space...].trimmingCharacters(in: .whitespacesAndNewlines)
        guard !tool.isEmpty, !tool.contains("{"), rest.hasPrefix("{") || rest.hasPrefix("[") else { return nil }
        guard tool.contains("__") || known.contains(tool) || TeammateAsk.tools.contains(tool) else { return nil }
        return (tool, rest)
    }

    /// Arguments rather than words: JSON, or the gate's `<tool> {json}`.
    public static func isTechnical(_ card: OptionCard) -> Bool {
        let text = card.subtitle.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.hasPrefix("{") || text.hasPrefix("[") || split(text, known: [card.tool, card.mcpTool]) != nil
    }
}

// MARK: - The held note

public enum ApprovalHeldNote {
    /// The provider's own note and the routine gate's say nothing the
    /// title does not: never shown.
    public static let silent: Set<String> = ["approval.held.native", "approval.held.gate"]

    /// Whether the card shows its held note (one quiet line), pending or
    /// answered, as on the desktop (PendingApproval.tsx `heldNote`, issue #426).
    public static func shows(_ card: OptionCard) -> Bool {
        guard let held = card.held?.trimmingCharacters(in: .whitespacesAndNewlines), !held.isEmpty else { return false }
        if let code = card.heldCode, silent.contains(code) { return false }
        return true
    }
}

// MARK: - The receipt

/// The status pill of a settled tool ask (`approvalPill`).
public enum ApprovalPill: Hashable, Sendable {
    case expired, undone, alwaysAllowed, alwaysDenied, allowedOnce, declined
    /// #3471: skipped without an answer, never a refusal.
    case skipped

    public enum Tone: Hashable, Sendable { case success, danger, neutral }

    public static func of(_ card: OptionCard) -> ApprovalPill? {
        if card.skipped == true { return .skipped }
        if card.expired == true { return .expired }
        guard let answered = card.answered else { return nil }
        if card.undone == true { return .undone }
        if answered == "allow", card.ruleSaved?.behavior == "allow" { return .alwaysAllowed }
        if answered == "deny", card.ruleSaved?.behavior == "deny" { return .alwaysDenied }
        if answered == "allow", card.alwaysAllowed?.isEmpty == false { return .alwaysAllowed }
        if answered == "allow" { return .allowedOnce }
        return .declined
    }

    public var tone: Tone {
        switch self {
        case .alwaysAllowed, .allowedOnce: .success
        case .alwaysDenied, .declined: .danger
        case .expired, .undone, .skipped: .neutral
        }
    }
}

public enum ApprovalReceiptRules {
    /// A tool ask stays in the chat while it waits and, once a person
    /// answered it or it expired, as its receipt (`approvalCardStaysInChat`).
    /// One the engine closed on its own (nobody could answer it) or one
    /// put away leaves the transcript. A change that applied without a
    /// person (#1982) stays as its Undo receipt even when dismissed so it
    /// leaves the pending dock.
    public static func staysInChat(_ card: OptionCard) -> Bool {
        guard card.requestId != nil, card.tool != nil else { return false }
        if card.autoApplied == true, card.answered == "allow", card.held == nil { return true }
        if card.expired == true { return true }
        return card.dismissed != true && card.answered != "unavailable"
    }

    /// A settled approval draws as the one-line receipt (#3415: an answered
    /// card folds into one row, a proposal too).
    public static func isReceipt(_ card: OptionCard) -> Bool {
        card.isPermission && !card.isPending && staysInChat(card)
    }

    /// The server's "wants to" phrase when it is in the reader's language
    /// (#1089: the server words a card in its person's language).
    public static func plainAction(_ card: OptionCard, language: String?) -> String? {
        guard let plain = card.plain, let action = plain.action?.trimmingCharacters(in: .whitespacesAndNewlines), !action.isEmpty else { return nil }
        let wanted = (language ?? "en").lowercased().split(separator: "-").first.map(String.init) ?? "en"
        let worded = (plain.locale ?? "en").lowercased().split(separator: "-").first.map(String.init) ?? "en"
        return wanted == worded ? action : nil
    }
}
