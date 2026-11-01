import Foundation

/// A bot's proactive mode (`shared/proactive-mode.ts`): a per-bot on/off
/// switch. When on, the bot wakes on an email, a calendar entry, a failed
/// run, a mention of the bot, or a webhook, and acts at its usual approval
/// level and rules. Before a write from a wake, a dry run is recorded on
/// the wake; then ordinary approval runs it. The proactive layer adds no
/// extra approval card. Absent on the wire is the default (`.proactive`);
/// legacy propose / read-auto / follow-rules read as `.proactive`; an
/// unknown value reads as off, like the server.
public enum ProactiveMode: String, CaseIterable, Hashable, Sendable {
    case off
    case proactive

    public static let defaultMode: ProactiveMode = .proactive

    public static func of(_ raw: String?) -> ProactiveMode {
        guard let raw else { return defaultMode }
        if raw == "off" { return .off }
        if raw == "proactive" { return .proactive }
        if raw == "propose" || raw == "read-auto" || raw == "follow-rules" { return .proactive }
        return .off
    }

    /// The desktop's labels (`botPanel.permissions.proactive.*`).
    public var label: String {
        switch self {
        case .off: String(localized: "Off")
        case .proactive: String(localized: "On")
        }
    }

    public var hint: String {
        switch self {
        case .off: String(localized: "No proactive behavior. Routines still run on their schedule or when a trigger fires.")
        case .proactive: String(localized: "It wakes on an email, a calendar entry, a failed run, a mention of the bot, or a webhook, and acts at this bot's approval level and rules. Before a write from a wake, a dry run is recorded, then ordinary approval runs it. No extra approval card from the proactive layer.")
        }
    }
}

/// A proactive proposal card (`OptionCardData.proactiveProposal`,
/// `shared/proactive-proposal.ts`): options[0] accepts, options[1]
/// declines; the answer goes to `POST /api/bots/:id/proactive/:proposalId`.
/// Kept so leftover cards from older modes can still be answered.
public enum ProactiveProposalRules {
    public static func isProposal(_ card: OptionCard) -> Bool {
        card.proactiveProposal != nil
    }

    /// Whether the picked option is the card's yes (its first option).
    public static func accepts(_ card: OptionCard, answer: String) -> Bool {
        guard let yes = card.options.first?.trimmingCharacters(in: .whitespacesAndNewlines), !yes.isEmpty else { return false }
        return answer.trimmingCharacters(in: .whitespacesAndNewlines) == yes
    }

    /// Answered: the server marked the pick on the card.
    public static func isSettled(_ card: OptionCard) -> Bool {
        card.proactiveProposal != nil && card.answered != nil
    }
}

/// The proposal a card carries (only its id crosses the wire).
public struct ProactiveProposalRef: Codable, Hashable, Sendable {
    public var id: String
    public init(id: String) { self.id = id }
}
