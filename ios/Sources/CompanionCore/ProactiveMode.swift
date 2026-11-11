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

/// #3465: the choice card (`proactiveChoice`) on the phone and the tablet,
/// as the desktop's `ProactiveChoiceCard.tsx` (#3457): « Oui » (options[0])
/// writes the choice with the bot that proposed it and the watches its
/// switches keep on; « Pas maintenant » (options[1]) is kept in the ledger;
/// « Ne plus proposer » goes to the card's feedback route (`choice: never`)
/// and is final for bots. Answered, the card folds to one quiet row.
public extension ProactiveProposalRules {
    /// A choice card: its yes turns a watch domain on.
    static func isChoice(_ card: OptionCard) -> Bool {
        card.proactiveProposal != nil && card.proactiveChoice != nil
    }

    /// The third answer's label (the desktop's `suggestionFeedback.never`).
    static var neverLabel: String { String(localized: "Never suggest again") }

    /// « Ne plus proposer » was given (the card's feedback).
    static func saidNever(_ card: OptionCard) -> Bool {
        card.feedback == "never"
    }

    /// Answered or expired: the card is one quiet row (its receipt).
    static func isFolded(_ card: OptionCard) -> Bool {
        card.answered != nil || card.expired == true
    }

    /// The receipt's mark: the yes was given (not expired).
    static func receiptAccepted(_ card: OptionCard) -> Bool {
        card.expired != true && card.answered.map { accepts(card, answer: $0) } == true
    }

    /// The watches the yes keeps on (desktop `watchesKeptOn`): each switch
    /// the person moved, else the card's own mark. Nil when the card carries
    /// no watch (the server then keeps its default).
    static func watchesOn(_ card: OptionCard, switches: [String: Bool]) -> [String]? {
        guard let watches = card.proactiveChoice?.watches, !watches.isEmpty else { return nil }
        return watches.filter { switches[$0.id] ?? $0.on }.map(\.id)
    }

    /// A yes with every watch off would turn on nothing: it cannot be sent.
    static func canSayYes(_ card: OptionCard, switches: [String: Bool]) -> Bool {
        watchesOn(card, switches: switches).map { !$0.isEmpty } ?? true
    }

    /// A watch's tool in words, the desktop's `watchToolLabel`: a bare
    /// connector tool reads as the action it does in its product ("View
    /// tickets in Acme"), in the card's language, never its name (which
    /// stays in the accessibility hint).
    static func toolWords(_ tool: String, words: StepWords) -> String {
        let id = tool.contains("__") ? tool : "mcp__perspicax__\(tool)"
        let parsed = StepLabel.parseToolId(id)
        guard let server = parsed.server else {
            return StepLabel.capitalize(VisibleRoles.toolWords(tool))
        }
        let reading = ApprovalReading.describe(id, input: nil, words: words, verb: { key, vars in words.t(key, vars) })
        let action = reading.action ?? parsed.name.replacingOccurrences(of: #"_+"#, with: " ", options: .regularExpression)
        // the bot's own servers are the bot itself: never "in Sagax ..."
        let phrase = reading.product.map { server.hasPrefix("sagax-") ? action : words.t("approval.phrase.inProduct", ["action": action, "product": $0]) } ?? action
        return StepLabel.capitalize(phrase.trimmingCharacters(in: .whitespaces))
    }

    /// #3465: the answer the card holds once the request ends. Kept by the
    /// server, the card folds to its receipt; lost (offline, a conflict),
    /// it comes back so the person can answer again.
    static func heldAnswer(_ option: String, kept: Bool) -> String? {
        kept ? option : nil
    }
}

/// The choice card's payload (`proactiveChoice` of `shared/wire.ts`):
/// labels on screen, ids for the route. Decoding is forgiving.
public struct ProactiveChoiceCardData: Codable, Hashable, Sendable {
    public struct Watch: Codable, Hashable, Sendable, Identifiable {
        public var id: String
        public var label: String
        /// Already in words, in the card's language.
        public var cadence: String
        /// Whether the yes turns it on.
        public var on: Bool
        public var tools: [String]

        public init(id: String, label: String, cadence: String, on: Bool, tools: [String] = []) {
            self.id = id
            self.label = label
            self.cadence = cadence
            self.on = on
            self.tools = tools
        }

        private enum CodingKeys: String, CodingKey { case id, label, cadence, on, tools }

        public init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            id = try container.decode(String.self, forKey: .id)
            label = (try? container.decodeIfPresent(String.self, forKey: .label)) ?? ""
            cadence = (try? container.decodeIfPresent(String.self, forKey: .cadence)) ?? ""
            on = (try? container.decodeIfPresent(Bool.self, forKey: .on)) ?? false
            tools = (try? container.decodeIfPresent([String].self, forKey: .tools)) ?? []
        }
    }

    public var domain: String
    public var label: String
    public var botName: String
    public var watches: [Watch]

    public init(domain: String, label: String, botName: String, watches: [Watch]) {
        self.domain = domain
        self.label = label
        self.botName = botName
        self.watches = watches
    }

    private enum CodingKeys: String, CodingKey { case domain, label, botName, watches }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        domain = (try? container.decodeIfPresent(String.self, forKey: .domain)) ?? ""
        label = (try? container.decodeIfPresent(String.self, forKey: .label)) ?? ""
        botName = (try? container.decodeIfPresent(String.self, forKey: .botName)) ?? ""
        watches = (try? container.decodeIfPresent([Lossy<Watch>].self, forKey: .watches))?.compactMap(\.value) ?? []
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
