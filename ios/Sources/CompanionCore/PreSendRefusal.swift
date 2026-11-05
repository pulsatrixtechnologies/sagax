import Foundation

/// A turn the engine refused before any prompt reached the model (#2013,
/// shared/presend-refusal.ts): the engine was not ready, its configuration
/// conflicts with the bot's, its sign-in expired, or its account is at its
/// limit or out of credit. None of these is a red card in the chat: the
/// composer says it in one line (SendState.swift), and stored rows of these
/// kinds are not drawn in a 1:1 chat (a room draws a quiet line).
public enum PreSendRefusalKind: String, Sendable, Equatable {
    /// Usage limit or credit: the composer locks (send-state engine_limit).
    case engineLimit = "engine_limit"
    /// The engine's sign-in expired or was refused.
    case signedOut = "signed_out"
    /// The engine's own configuration conflicts with the bot's selection.
    case configConflict = "config_conflict"
    /// The engine could not start or confirm its setup.
    case engineNotReady = "engine_not_ready"
}

public enum PreSendRefusal {
    private static func regex(_ pattern: String) -> NSRegularExpression {
        // swiftlint:disable:next force_try
        try! NSRegularExpression(pattern: pattern, options: [.caseInsensitive])
    }

    // shared/engine-limit-words.ts
    static let usageLimit = regex(#"\busage limits?\b|\breached (?:your|its) (?:(?:weekly|daily|monthly|session|5-hour|plan|subscription) )?limits?\b|\bhit your (?:(?!rate\b)[\w'’-]+ ){0,3}(?:limit|budget)\b|\b(?:weekly|daily|monthly|subscription|usage|session|5-hour) limit reached\b|\bout of (?:usage(?: credits)?|extra usage|credits)\b"#)
    static let outOfCredits = regex(#"\bpayment required\b|\b(?:http|status) 402\b|\binsufficient (?:account )?(?:funds|balance|credits?)\b|\b(?:credit|account) balance is too low\b|\busage balance (?:is |has been )?(?:used up|exhausted)\b|\bout of credits?\b|\bno credits? (?:left|remaining)\b|\bused all (?:available |of (?:your|its) )?credits\b"#)

    // shared/presend-refusal.ts
    static let noPromptSent = regex(#"\bNo prompt was sent\.?\s*$"#)
    static let configConflict = regex(#"\bMCP (?:server|connection)s? outside the (?:selected configuration|bot's selection)\b|\bnative MCP (?:entries|connections)\b"#)
    static let notReady = regex(#"\brejected its configuration as invalid\b|\bCould not read Codex configuration\b|\bcould not turn its shell off\b|\bcould not confirm (?:its|the) selected (?:MCP configuration|MCP catalog|model)\b"#)
    static let signedOut = regex(#"\bsign(?:ed)?[- ]?(?:in|out)\b.*\b(?:expired|refused|again|required)\b|\b(?:log|sign) in again\b|\bnot (?:signed|logged) in\b|\bauthentication required\b|\b401\b|\bunauthorized\b|\bmissing bearer\b|\bre-?authenticate\b"#)

    static func matches(_ expression: NSRegularExpression, _ text: String) -> Bool {
        expression.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
    }

    /// Whether a failed turn's cause is the engine account's limit or credit
    /// (shared/engine-limit-words.ts `isEngineLimitWords`).
    public static func isEngineLimitWords(_ cause: String) -> Bool {
        matches(usageLimit, cause) || matches(outOfCredits, cause)
    }

    /// What kind of pre-send refusal a failed turn's cause is, or nil when
    /// the turn failed after the model started (that stays a row).
    public static func kind(cause: String, setup: Bool = false, claudeUpdate: Bool = false, limitResetsAt: Double? = nil) -> PreSendRefusalKind? {
        let words = cause.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !words.isEmpty else { return nil }
        if limitResetsAt != nil || isEngineLimitWords(words) { return .engineLimit }
        if matches(configConflict, words) { return .configConflict }
        if setup && matches(signedOut, words) { return .signedOut }
        if setup || claudeUpdate { return .engineNotReady }
        if matches(notReady, words) || matches(noPromptSent, words) { return .engineNotReady }
        return nil
    }

    /// The kind of a stored failed-turn row, or nil for any other row and
    /// for a failed turn that carries a place (it stays as it is).
    public static func kind(of message: Message) -> PreSendRefusalKind? {
        guard ErrorRowRules.isError(message), let tool = message.tool, !tool.hasPlace else { return nil }
        return kind(cause: ErrorRowRules.text(message), setup: tool.setup == true,
                    claudeUpdate: tool.claudeUpdate == true, limitResetsAt: tool.limitResetsAt)
    }
}
