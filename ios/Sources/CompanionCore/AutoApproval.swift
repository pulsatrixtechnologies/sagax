import Foundation

// 2026-10-28: an ask answered with no card, and the level a conversation
// really runs at, as the server reports them (shared/wire.ts,
// shared/auto-approval-reason.ts, shared/approval-mode.ts). The phone draws
// the same rules as the web: an approval nobody had to give by hand stays in
// a row's details, never on its line.

/// What answered a call's ask with no card (`tool.autoApproval`).
public struct ToolAutoApproval: Codable, Hashable, Sendable {
    public var source: String
    public var rule: String? = nil
    public init(source: String, rule: String? = nil) {
        self.source = source
        self.rule = rule
    }
}

/// The plain group a source reads as (shared/auto-approval-reason.ts).
public enum AutoApprovalReason: String, Hashable, Sendable {
    case full, level, rule, command, recipients, trusted, answered, other

    public static func of(source: String?) -> AutoApprovalReason {
        switch source {
        case "full-access", "owner-bypass": .full
        case "owner-auto", "own-environment", "web-search": .level
        case "allow-rule", "owner-rule", "custom-rule", "admin-rule": .rule
        case "command-allowlist": .command
        case "allowed-recipient", "reach-me": .recipients
        case "safety-read", "perspicax-read", "perspicax-lease", "sagax-internal", "own-read-only", "own-attachment", "own-computer-choice": .trusted
        case "email-draft-approval", "x-post-approval", "widget-approval": .answered
        default: .other
        }
    }
}

/// The person's own "Ask first" rule that kept a card (`OptionCardData.heldRule`).
public struct HeldRule: Codable, Hashable, Sendable {
    public var description: String
}

/// The custom rule that decided a card (`OptionCardData.customRule`), the
/// fields the phone reads.
public struct CardRuleNotice: Codable, Hashable, Sendable {
    public var when: String? = nil
    public var outcome: String? = nil
    public var org: Bool? = nil
}

/// The level a conversation really runs at, with why, when it is not the
/// bot's own setting (`WireBot.approvalApplied`).
public struct AppliedApprovalLevel: Codable, Hashable, Sendable {
    public var mode: String
    public var reason: String
    public init(mode: String, reason: String) {
        self.mode = mode
        self.reason = reason
    }
}

/// Which rule a waiting card names: the organization's or the person's.
public struct HeldByRule: Hashable, Sendable {
    public var org: Bool
    public var words: String?
}

public extension ApprovalReceiptRules {
    /// A settled ask nobody answered by hand at that moment (an Always allow
    /// saved or kept, the model reviewer under the person's rule): it reads
    /// as the call's ordinary step line (`quietApprovalReceipt`).
    static func isQuiet(_ card: OptionCard) -> Bool {
        guard card.answered == "allow", card.expired != true, card.undone != true else { return false }
        return card.ruleSaved?.behavior == "allow" || card.alwaysAllowed?.isEmpty == false || card.answeredBy?.via == "auto-review"
    }

    /// The "Ask first" rule a waiting card is held by, if any (`heldByRuleLine`).
    static func heldByRule(_ card: OptionCard) -> HeldByRule? {
        if let notice = card.customRule, notice.outcome == "held" || notice.outcome == "risk" {
            return HeldByRule(org: notice.org == true, words: notice.when)
        }
        if let rule = card.heldRule, !rule.description.isEmpty {
            return HeldByRule(org: false, words: rule.description)
        }
        return nil
    }
}

public extension Bot {
    /// The bot's own setting as Permissions shows it: `approvalSetting` from a
    /// server that sends it (never a conversation's level), else the record's.
    var approvalSettingMode: String? { approvalSetting ?? approvalMode }

    /// The level the open conversation really runs at, when it is not the
    /// bot's setting; nil when both are the same.
    var appliedLevelNote: AppliedApprovalLevel? {
        guard let applied = approvalApplied, applied.mode != approvalSettingMode else { return nil }
        return applied
    }
}

/// The words of the note: "This conversation runs at {level}: {reason}."
/// `lookup` answers a catalog key (the app's strings), nil when missing.
public enum AppliedLevelWords {
    public static func reasonKey(_ reason: String) -> String {
        switch reason {
        case "member-policy": "approvalApplied.reason.memberPolicy"
        case "engine-unsupported": "approvalApplied.reason.engineUnsupported"
        default: "approvalApplied.reason.\(reason)"
        }
    }

    public static func line(_ applied: AppliedApprovalLevel, words: StepWords) -> String {
        words.t("approvalApplied.line", [
            "level": words.t("approvalApplied.level.\(applied.mode)"),
            "reason": words.t(reasonKey(applied.reason)),
        ])
    }
}
