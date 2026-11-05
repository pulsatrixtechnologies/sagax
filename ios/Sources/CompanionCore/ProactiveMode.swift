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

/// Built-in publish targets for `bot.pageTargetDefault` (#2048). Empty id
/// means ask each time (clear). Labels match desktop `pageTarget.*.name`
/// and are looked up in Localizable.xcstrings (en / fr / pt-BR).
public struct PageTargetDefaultChoice: Hashable, Sendable {
    public var id: String

    public var label: String { Self.label(for: id) }

    public static let all: [PageTargetDefaultChoice] = [
        PageTargetDefaultChoice(id: ""),
        PageTargetDefaultChoice(id: "sagax_page"),
        PageTargetDefaultChoice(id: "sagax_artifact"),
        PageTargetDefaultChoice(id: "claude_artifact"),
    ]

    public static func label(for id: String) -> String {
        switch id {
        case "": return String(localized: "Ask each time")
        case "sagax_page": return String(localized: "Sagax page")
        case "sagax_artifact": return String(localized: "Sagax artifact")
        case "claude_artifact": return String(localized: "Claude artifact")
        default: return id
        }
    }

    /// One-line help under the Publish target control.
    public static func summary(for id: String?) -> String {
        guard let id, !id.isEmpty else {
            return String(localized: "Ask each time when several targets are available.")
        }
        return String(localized: "Always \(label(for: id)).")
    }
}

/// Localize page-target choice card copy (#2048), mirroring desktop
/// `page-target-copy.ts` / `localizedPageTargetQuestions`.
public enum PageTargetCopy {
    public static var question: String {
        String(localized: "Where should I publish this?")
    }

    public static var alwaysUse: String {
        String(localized: "Always use this choice")
    }

    public static func name(id: String, fallback: String) -> String {
        switch id {
        case "sagax_page": return String(localized: "Sagax page")
        case "sagax_artifact": return String(localized: "Sagax artifact")
        case "claude_artifact": return String(localized: "Claude artifact")
        default: return fallback
        }
    }

    public static func detail(id: String, fallback: String) -> String {
        switch id {
        case "sagax_page":
            return String(localized: "Shareable link the person publishes; others can open it outside Sagax.")
        case "sagax_artifact":
            return String(localized: "Kept inside Sagax for this person; can refresh itself, no public link.")
        case "claude_artifact":
            return String(localized: "Official claude.ai artifact through the person's own Claude account.")
        default:
            return fallback
        }
    }

    /// Rewrite ask-question rows when the card is a page-target choice.
    public static func localizeQuestions(_ questions: [AskQuestion], targets: [PageTargetChoiceTarget]) -> [AskQuestion] {
        guard !targets.isEmpty else { return questions }
        let byId = Dictionary(uniqueKeysWithValues: targets.map { ($0.id, $0) })
        return questions.map { question in
            var next = question
            next.question = Self.question
            next.options = question.options.map { option in
                let id = (option.id ?? option.label).trimmingCharacters(in: .whitespacesAndNewlines)
                guard let target = byId[id] else { return option }
                var row = option
                row.id = id
                row.label = name(id: id, fallback: target.name)
                let fallback = option.detail ?? target.name
                row.detail = detail(id: id, fallback: fallback)
                if row.icon == nil { row.icon = target.icon }
                return row
            }
            return next
        }
    }
}
