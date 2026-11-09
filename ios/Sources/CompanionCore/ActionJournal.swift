import Foundation

// The Journal of the signed-in person's own bots (chantier Confiance,
// 2026-10-26): every action, allowed, asked, refused, failed or expired, with
// what decided it. The wire contract is shared/action-journal.ts; the filters
// and counts below are `filterJournal`, `journalCounts` and `ruleTestChanged`
// of that file. Never an id on screen: `key`, `threadId`, `requestId` and
// `ruleId` route and select, nothing more.

// MARK: - Tolerant enums

/// What happened to the action. An outcome this build does not know decodes
/// as `.unknown` instead of failing the whole list.
public enum JournalOutcome: String, Codable, CaseIterable, Equatable, Sendable {
    case allowed, asked, denied, failed, expired
    case unknown

    /// The five outcomes the chips count.
    public static let known: [JournalOutcome] = [.allowed, .asked, .denied, .failed, .expired]

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = JournalOutcome(rawValue: raw) ?? .unknown
    }
}

/// What decided it, in the person's terms.
public enum JournalDecider: String, Codable, CaseIterable, Equatable, Sendable {
    case customRule = "custom-rule"
    case orgRule = "org-rule"
    case alwaysAllow = "always-allow"
    case adminRule = "admin-rule"
    case level
    case fullAccess = "full-access"
    case grant
    case `default`
    case reviewer
    case safety
    case sagax
    case person
    case expired
    case error
    case noCard = "no-card"
    case unknown

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = JournalDecider(rawValue: raw) ?? .unknown
    }
}

/// What a rule under test would have done to a past action.
public enum RuleTestEffect: String, Codable, Equatable, Sendable {
    case allowed, asked, denied
    case cardStays = "card-stays"
    case unknown

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = RuleTestEffect(rawValue: raw) ?? .unknown
    }
}

// MARK: - Wire models

/// The tool guard's verdict on an agent tool call.
public struct JournalGuard: Codable, Equatable, Sendable {
    public var allow: Bool
    public var reason: String
    /// shadow (the default: recorded only), enforce, off
    public var mode: String
    public var scope: String?

    public init(allow: Bool, reason: String = "", mode: String = "shadow", scope: String? = nil) {
        self.allow = allow
        self.reason = reason
        self.mode = mode
        self.scope = scope
    }

    private enum CodingKeys: String, CodingKey { case allow, reason, mode, scope }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        allow = (try? c.decode(Bool.self, forKey: .allow)) ?? true
        reason = (try? c.decodeIfPresent(String.self, forKey: .reason)) ?? ""
        mode = (try? c.decodeIfPresent(String.self, forKey: .mode)) ?? "shadow"
        scope = try? c.decodeIfPresent(String.self, forKey: .scope)
    }

    /// The guard would have refused, but only recorded it (observation).
    public var wouldHaveRefusedInObservation: Bool { !allow && mode == "shadow" }
    public var refused: Bool { !allow && mode == "enforce" }
}

public struct JournalEntry: Codable, Equatable, Sendable, Identifiable {
    public var key: String
    public var at: String
    public var botId: String
    public var botName: String
    public var threadId: String
    public var requestId: String?
    public var tool: String
    public var summary: String?
    public var outcome: JournalOutcome
    public var decider: JournalDecider
    public var source: String?
    public var askedBy: JournalDecider?
    public var askedSource: String?
    public var ruleText: String?
    public var ruleBehavior: CustomRuleBehavior?
    public var ruleId: String?
    public var reason: String?
    public var answeredBy: String?
    public var unattended: Bool?
    public var ran: String?
    public var guardVerdict: JournalGuard?
    public var replayable: Bool?

    public var id: String { key }

    private enum CodingKeys: String, CodingKey {
        case key, at, botId, botName, threadId, requestId, tool, summary, outcome, decider, source
        case askedBy, askedSource, ruleText, ruleBehavior, ruleId, reason, answeredBy, unattended, ran
        case guardVerdict = "guard"
        case replayable
    }

    public init(
        key: String, at: String, botId: String = "", botName: String = "", threadId: String = "", requestId: String? = nil,
        tool: String = "", summary: String? = nil, outcome: JournalOutcome, decider: JournalDecider,
        source: String? = nil, askedBy: JournalDecider? = nil, askedSource: String? = nil, ruleText: String? = nil,
        ruleBehavior: CustomRuleBehavior? = nil, ruleId: String? = nil, reason: String? = nil, answeredBy: String? = nil,
        unattended: Bool? = nil, ran: String? = nil, guardVerdict: JournalGuard? = nil, replayable: Bool? = nil
    ) {
        self.key = key
        self.at = at
        self.botId = botId
        self.botName = botName
        self.threadId = threadId
        self.requestId = requestId
        self.tool = tool
        self.summary = summary
        self.outcome = outcome
        self.decider = decider
        self.source = source
        self.askedBy = askedBy
        self.askedSource = askedSource
        self.ruleText = ruleText
        self.ruleBehavior = ruleBehavior
        self.ruleId = ruleId
        self.reason = reason
        self.answeredBy = answeredBy
        self.unattended = unattended
        self.ran = ran
        self.guardVerdict = guardVerdict
        self.replayable = replayable
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        key = try c.decode(String.self, forKey: .key)
        at = (try? c.decode(String.self, forKey: .at)) ?? ""
        botId = (try? c.decode(String.self, forKey: .botId)) ?? ""
        botName = (try? c.decode(String.self, forKey: .botName)) ?? ""
        threadId = (try? c.decode(String.self, forKey: .threadId)) ?? ""
        requestId = try? c.decodeIfPresent(String.self, forKey: .requestId)
        tool = (try? c.decode(String.self, forKey: .tool)) ?? ""
        summary = try? c.decodeIfPresent(String.self, forKey: .summary)
        outcome = (try? c.decode(JournalOutcome.self, forKey: .outcome)) ?? .unknown
        decider = (try? c.decode(JournalDecider.self, forKey: .decider)) ?? .unknown
        source = try? c.decodeIfPresent(String.self, forKey: .source)
        askedBy = try? c.decodeIfPresent(JournalDecider.self, forKey: .askedBy)
        askedSource = try? c.decodeIfPresent(String.self, forKey: .askedSource)
        ruleText = try? c.decodeIfPresent(String.self, forKey: .ruleText)
        ruleBehavior = try? c.decodeIfPresent(CustomRuleBehavior.self, forKey: .ruleBehavior)
        ruleId = try? c.decodeIfPresent(String.self, forKey: .ruleId)
        reason = try? c.decodeIfPresent(String.self, forKey: .reason)
        answeredBy = try? c.decodeIfPresent(String.self, forKey: .answeredBy)
        unattended = try? c.decodeIfPresent(Bool.self, forKey: .unattended)
        ran = try? c.decodeIfPresent(String.self, forKey: .ran)
        guardVerdict = try? c.decodeIfPresent(JournalGuard.self, forKey: .guardVerdict)
        replayable = try? c.decodeIfPresent(Bool.self, forKey: .replayable)
    }
}

public struct JournalPayload: Codable, Equatable, Sendable {
    public var entries: [JournalEntry]
    public var days: Int
    public var truncated: Bool?

    public init(entries: [JournalEntry], days: Int, truncated: Bool? = nil) {
        self.entries = entries
        self.days = days
        self.truncated = truncated
    }

    private enum CodingKeys: String, CodingKey { case entries, days, truncated }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        entries = (try? c.decode([JournalEntry].self, forKey: .entries)) ?? []
        days = (try? c.decode(Int.self, forKey: .days)) ?? ActionJournal.defaultDays
        truncated = try? c.decodeIfPresent(Bool.self, forKey: .truncated)
    }
}

/// A rule to replay: a saved one (its id) or a draft not saved yet.
public struct RuleTestDraft: Encodable, Equatable, Sendable {
    public var id: String?
    public var when: String
    public var behavior: CustomRuleBehavior
    public var botId: String?
    public var riskScope: [CustomRuleRisk]

    public init(id: String? = nil, when: String, behavior: CustomRuleBehavior, botId: String?, riskScope: [CustomRuleRisk] = []) {
        self.id = id
        self.when = when
        self.behavior = behavior
        self.botId = botId
        self.riskScope = riskScope
    }

    private enum CodingKeys: String, CodingKey { case id, when, behavior, botId, riskScope }

    /// `botId` is sent even when nil (all the person's bots), as `null`.
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(id, forKey: .id)
        try c.encode(when, forKey: .when)
        try c.encode(behavior, forKey: .behavior)
        if let botId { try c.encode(botId, forKey: .botId) } else { try c.encodeNil(forKey: .botId) }
        try c.encode(riskScope, forKey: .riskScope)
    }
}

public struct RuleTestHit: Decodable, Equatable, Sendable, Identifiable {
    public var key: String
    public var at: String
    public var botName: String
    public var tool: String
    public var summary: String?
    public var actual: JournalOutcome
    public var would: RuleTestEffect
    public var changed: Bool
    public var missing: [CustomRuleRisk]
    public var approximate: Bool

    public var id: String { key }

    public init(key: String, at: String, botName: String = "", tool: String = "", summary: String? = nil, actual: JournalOutcome, would: RuleTestEffect, changed: Bool? = nil, missing: [CustomRuleRisk] = [], approximate: Bool = false) {
        self.key = key
        self.at = at
        self.botName = botName
        self.tool = tool
        self.summary = summary
        self.actual = actual
        self.would = would
        self.changed = changed ?? ActionJournal.ruleTestChanged(actual: actual, would: would)
        self.missing = missing
        self.approximate = approximate
    }

    private enum CodingKeys: String, CodingKey { case key, at, botName, tool, summary, actual, would, changed, missing, approximate }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        key = try c.decode(String.self, forKey: .key)
        at = (try? c.decode(String.self, forKey: .at)) ?? ""
        botName = (try? c.decode(String.self, forKey: .botName)) ?? ""
        tool = (try? c.decode(String.self, forKey: .tool)) ?? ""
        summary = try? c.decodeIfPresent(String.self, forKey: .summary)
        actual = (try? c.decode(JournalOutcome.self, forKey: .actual)) ?? .unknown
        would = (try? c.decode(RuleTestEffect.self, forKey: .would)) ?? .unknown
        changed = (try? c.decode(Bool.self, forKey: .changed)) ?? ActionJournal.ruleTestChanged(actual: actual, would: would)
        missing = ((try? c.decode([String].self, forKey: .missing)) ?? []).compactMap(CustomRuleRisk.init(rawValue:))
        approximate = (try? c.decodeIfPresent(Bool.self, forKey: .approximate)) ?? false
    }
}

public struct RuleTestCounts: Decodable, Equatable, Sendable {
    public var allowed: Int
    public var asked: Int
    public var denied: Int
    public var cardStays: Int
    public var changed: Int

    public init(allowed: Int = 0, asked: Int = 0, denied: Int = 0, cardStays: Int = 0, changed: Int = 0) {
        self.allowed = allowed
        self.asked = asked
        self.denied = denied
        self.cardStays = cardStays
        self.changed = changed
    }

    private enum CodingKeys: String, CodingKey { case allowed, asked, denied, cardStays, changed }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        allowed = (try? c.decode(Int.self, forKey: .allowed)) ?? 0
        asked = (try? c.decode(Int.self, forKey: .asked)) ?? 0
        denied = (try? c.decode(Int.self, forKey: .denied)) ?? 0
        cardStays = (try? c.decode(Int.self, forKey: .cardStays)) ?? 0
        changed = (try? c.decode(Int.self, forKey: .changed)) ?? 0
    }
}

public struct RuleTestResult: Decodable, Equatable, Sendable {
    public var days: Int
    public var scanned: Int
    public var matched: Int
    public var counts: RuleTestCounts
    public var hits: [RuleTestHit]
    public var unreadable: Bool

    public init(days: Int = ActionJournal.ruleTestDays, scanned: Int = 0, matched: Int = 0, counts: RuleTestCounts = RuleTestCounts(), hits: [RuleTestHit] = [], unreadable: Bool = false) {
        self.days = days
        self.scanned = scanned
        self.matched = matched
        self.counts = counts
        self.hits = hits
        self.unreadable = unreadable
    }

    private enum CodingKeys: String, CodingKey { case days, scanned, matched, counts, hits, unreadable }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        days = (try? c.decode(Int.self, forKey: .days)) ?? ActionJournal.ruleTestDays
        scanned = (try? c.decode(Int.self, forKey: .scanned)) ?? 0
        matched = (try? c.decode(Int.self, forKey: .matched)) ?? 0
        counts = (try? c.decode(RuleTestCounts.self, forKey: .counts)) ?? RuleTestCounts()
        hits = (try? c.decode([RuleTestHit].self, forKey: .hits)) ?? []
        unreadable = (try? c.decodeIfPresent(Bool.self, forKey: .unreadable)) ?? false
    }
}

// MARK: - Pure logic

public struct JournalFilter: Equatable, Sendable {
    /// nil is every outcome.
    public var outcome: JournalOutcome?
    /// nil is every bot.
    public var bot: String?
    public var query: String

    public init(outcome: JournalOutcome? = nil, bot: String? = nil, query: String = "") {
        self.outcome = outcome
        self.bot = bot
        self.query = query
    }
}

public struct JournalCounts: Equatable, Sendable {
    public var allowed = 0
    public var asked = 0
    public var denied = 0
    public var failed = 0
    public var expired = 0

    public init() {}

    public var total: Int { allowed + asked + denied + failed + expired }

    public func count(_ outcome: JournalOutcome?) -> Int {
        switch outcome {
        case nil: total
        case .allowed: allowed
        case .asked: asked
        case .denied: denied
        case .failed: failed
        case .expired: expired
        case .unknown: 0
        }
    }
}

/// A decider's label: an English key and an optional argument, so the
/// screen localizes the key and fills the `%@` with the rule's own words.
public struct JournalDeciderLabel: Equatable, Sendable {
    public var key: String
    public var argument: String?
}

public enum ActionJournal {
    public static let days = [7, 30]
    public static let defaultDays = 7
    public static let ruleTestDays = 7
    public static let deletedBot = "Deleted bot"

    // MARK: filters

    /// The rows that match an outcome, a bot and a free-text search (bot,
    /// tool, summary, rule, who answered), newest first.
    public static func filter(_ entries: [JournalEntry], _ filter: JournalFilter) -> [JournalEntry] {
        let needle = filter.query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return entries
            .filter { filter.outcome == nil || $0.outcome == filter.outcome }
            .filter { filter.bot == nil || $0.botId == filter.bot }
            .filter { entry in
                needle.isEmpty || [entry.botName, entry.tool, entry.summary, entry.ruleText, entry.answeredBy, title(tool: entry.tool)]
                    .contains { ($0 ?? "").lowercased().contains(needle) }
            }
            .sorted { a, b in
                if a.at != b.at { return a.at > b.at }
                return a.key < b.key
            }
    }

    public static func counts(_ entries: [JournalEntry]) -> JournalCounts {
        var counts = JournalCounts()
        for entry in entries {
            switch entry.outcome {
            case .allowed: counts.allowed += 1
            case .asked: counts.asked += 1
            case .denied: counts.denied += 1
            case .failed: counts.failed += 1
            case .expired: counts.expired += 1
            case .unknown: break
            }
        }
        return counts
    }

    /// The bots seen in the list, by name, for the bot filter. A bot whose
    /// name is an id (or empty) shows as "Deleted bot".
    public static func bots(_ entries: [JournalEntry]) -> [(id: String, name: String)] {
        var seen: [String: String] = [:]
        for entry in entries where !entry.botId.isEmpty && seen[entry.botId] == nil {
            seen[entry.botId] = botName(entry)
        }
        return seen.map { (id: $0.key, name: $0.value) }.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    /// Whether the rule's effect differs from what really happened.
    public static func ruleTestChanged(actual: JournalOutcome, would: RuleTestEffect) -> Bool {
        switch would {
        case .cardStays, .unknown: false
        case .denied: actual != .denied
        case .allowed: actual != .allowed
        case .asked: actual == .allowed || actual == .failed
        }
    }

    // MARK: words

    private static let uuid = try! NSRegularExpression(pattern: "\\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\b", options: [.caseInsensitive])
    private static let longHex = try! NSRegularExpression(pattern: "\\b[0-9a-f]{16,}\\b", options: [.caseInsensitive])
    private static let prefixed = try! NSRegularExpression(pattern: "\\b(?:pr|thr|req|msg|bot)_[A-Za-z0-9-]{8,}\\b", options: [])

    /// A line with every raw identifier taken out (a UUID, a long hash, a
    /// prefixed id): `withoutIds` of src/lib/approvals-inbox.ts.
    public static func withoutIds(_ text: String) -> String {
        var out = text
        for regex in [uuid, longHex, prefixed] {
            out = regex.stringByReplacingMatches(in: out, range: NSRange(out.startIndex..., in: out), withTemplate: "\u{2026}")
        }
        return out.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }

    /// Whether `value` is an id a person cannot read (the app's HumanID).
    public static func isOpaqueID(_ value: String) -> Bool {
        let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let range = NSRange(text.startIndex..., in: text)
        return opaque.firstMatch(in: text, range: range) != nil
    }

    private static let opaque = try! NSRegularExpression(
        pattern: "^(?:(?i:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{20,}|[a-z]{1,12}[-_](?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|(?=[0-9a-z]*[0-9])[0-9a-z]{20,}))|(?=[A-Za-z0-9]*[0-9])(?=[A-Za-z0-9]*[a-z])(?=[A-Za-z0-9]*[A-Z])[A-Za-z0-9]{16,})$",
        options: []
    )

    /// The bot's name, or "Deleted bot" when the server only had an id.
    public static func botName(_ entry: JournalEntry) -> String {
        botName(entry.botName)
    }

    public static func botName(_ name: String) -> String {
        let text = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty || isOpaqueID(text) ? deletedBot : text
    }

    /// The one-line summary with ids removed; nil when nothing readable is left.
    public static func summary(_ entry: JournalEntry) -> String? {
        readable(entry.summary)
    }

    /// Any server text that may carry an id, made readable. Nil when empty.
    public static func readable(_ text: String?) -> String? {
        guard let text else { return nil }
        let clean = withoutIds(text)
        return clean.isEmpty || clean == "\u{2026}" ? nil : clean
    }

    /// The action in words, from the engine's tool name. An English key the
    /// screen localizes, or the tool's own words when unknown.
    public static func title(tool: String) -> String {
        let name = tool.trimmingCharacters(in: .whitespacesAndNewlines)
        switch name.lowercased() {
        case "bash", "shell", "exec", "command", "run_command": return "Run a command"
        case "read", "view": return "Read a file"
        case "write", "edit", "multiedit", "notebookedit", "apply_patch": return "Change a file"
        case "glob", "grep", "ls", "search": return "Search files"
        case "webfetch", "websearch", "browser": return "Use the web"
        case "task", "agent": return "Start a helper"
        case "": return "An action"
        default: break
        }
        var words = name
        if words.lowercased().hasPrefix("mcp__") { words = String(words.dropFirst(5)) }
        let spaced = words
            .replacingOccurrences(of: "__", with: " ")
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "-", with: " ")
            .replacingOccurrences(of: ".", with: " ")
        let text = withoutIds(spaced)
        guard let first = text.first else { return "An action" }
        return first.uppercased() + text.dropFirst()
    }

    /// "Decided by": what decided it, with the rule's own words.
    public static func deciderLabel(_ decider: JournalDecider, source: String? = nil, ruleText: String? = nil, answeredBy: String? = nil) -> JournalDeciderLabel {
        let rule = readable(ruleText)
        switch decider {
        case .customRule:
            return rule.map { JournalDeciderLabel(key: "Your rule: %@", argument: $0) } ?? JournalDeciderLabel(key: "One of your rules")
        case .orgRule:
            return rule.map { JournalDeciderLabel(key: "Organization rule: %@", argument: $0) } ?? JournalDeciderLabel(key: "An organization rule")
        case .alwaysAllow:
            return rule.map { JournalDeciderLabel(key: "Always allow: %@", argument: $0) } ?? JournalDeciderLabel(key: "An Always allow rule")
        case .adminRule:
            return rule.map { JournalDeciderLabel(key: "Admin rule: %@", argument: $0) } ?? JournalDeciderLabel(key: "An admin rule")
        case .level: return JournalDeciderLabel(key: "The bot's approval level")
        case .fullAccess: return JournalDeciderLabel(key: "Full access")
        case .grant: return JournalDeciderLabel(key: "A tool access grant")
        case .default: return JournalDeciderLabel(key: "Allowed by default")
        case .reviewer:
            return rule.map { JournalDeciderLabel(key: "Automatic review, rule: %@", argument: $0) } ?? JournalDeciderLabel(key: "Automatic review")
        case .safety: return JournalDeciderLabel(key: "A safety hold")
        case .sagax: return JournalDeciderLabel(key: "Sagax's own allowance")
        case .person:
            let who = readable(answeredBy)
            if let who, who.lowercased() != "you" { return JournalDeciderLabel(key: "Answered by %@", argument: who) }
            return JournalDeciderLabel(key: "You answered")
        case .expired: return JournalDeciderLabel(key: "Nobody answered in time")
        case .error: return JournalDeciderLabel(key: "Something broke")
        case .noCard: return JournalDeciderLabel(key: "Run without a card at this level")
        case .unknown:
            if let source = readable(source), !isOpaqueID(source) { return JournalDeciderLabel(key: "Decided by: %@", argument: source) }
            return JournalDeciderLabel(key: "Not known")
        }
    }

    public static func deciderLabel(_ entry: JournalEntry) -> JournalDeciderLabel {
        deciderLabel(entry.decider, source: entry.source, ruleText: entry.ruleText, answeredBy: entry.answeredBy)
    }

    /// The tool guard's line for the detail, when one applies.
    public static func guardNote(_ verdict: JournalGuard?) -> String? {
        guard let verdict else { return nil }
        if verdict.wouldHaveRefusedInObservation { return "The guard would have refused (observation mode)" }
        if verdict.refused { return "The guard refused" }
        if verdict.mode == "off" { return "The guard is off" }
        return verdict.allow ? "The guard allowed" : nil
    }

    // MARK: dates

    public static func date(_ iso: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: iso) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: iso)
    }
}

// MARK: - Tool access grants of the person themselves

public struct MyToolGrant: Decodable, Equatable, Sendable, Identifiable {
    public enum State: String, Decodable, Sendable {
        case active, expired, revoked, unknown
        public init(from decoder: Decoder) throws {
            let raw = try decoder.singleValueContainer().decode(String.self)
            self = State(rawValue: raw) ?? .unknown
        }
    }

    public var id: String
    public var scope: String
    public var grantedAt: Double
    /// ms since 1970
    public var expiresAt: Double?
    public var revokedAt: Double?
    public var state: State

    public var area: String { String(scope.split(separator: ":").first ?? "") }
    public var tier: String { scope.split(separator: ":").dropFirst().first.map(String.init) ?? "write" }

    private enum CodingKeys: String, CodingKey { case id, scope, grantedAt, expiresAt, revokedAt, state }

    public init(id: String, scope: String, grantedAt: Double = 0, expiresAt: Double? = nil, revokedAt: Double? = nil, state: State = .active) {
        self.id = id
        self.scope = scope
        self.grantedAt = grantedAt
        self.expiresAt = expiresAt
        self.revokedAt = revokedAt
        self.state = state
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        scope = (try? c.decode(String.self, forKey: .scope)) ?? ""
        grantedAt = (try? c.decode(Double.self, forKey: .grantedAt)) ?? 0
        expiresAt = try? c.decodeIfPresent(Double.self, forKey: .expiresAt)
        revokedAt = try? c.decodeIfPresent(Double.self, forKey: .revokedAt)
        state = (try? c.decode(State.self, forKey: .state)) ?? .unknown
    }
}

public struct MyToolGrants: Decodable, Equatable, Sendable {
    public var grants: [MyToolGrant]
    public var adminOnlyAreas: [String]
    public var mayGrantAdmin: Bool

    public init(grants: [MyToolGrant] = [], adminOnlyAreas: [String] = [], mayGrantAdmin: Bool = false) {
        self.grants = grants
        self.adminOnlyAreas = adminOnlyAreas
        self.mayGrantAdmin = mayGrantAdmin
    }

    private enum CodingKeys: String, CodingKey { case grants, adminOnlyAreas, mayGrantAdmin }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        grants = (try? c.decode([MyToolGrant].self, forKey: .grants)) ?? []
        adminOnlyAreas = (try? c.decode([String].self, forKey: .adminOnlyAreas)) ?? []
        mayGrantAdmin = (try? c.decodeIfPresent(Bool.self, forKey: .mayGrantAdmin)) ?? false
    }

    /// Active first, then newest.
    public var sorted: [MyToolGrant] {
        let rank: (MyToolGrant.State) -> Int = { $0 == .active ? 0 : $0 == .expired ? 1 : 2 }
        return grants.sorted { rank($0.state) != rank($1.state) ? rank($0.state) < rank($1.state) : $0.grantedAt > $1.grantedAt }
    }
}

public enum MyToolGrantForm {
    public static let tiers = ["read", "write", "admin"]
    public static let maxAdminDays = 30

    public struct Request: Equatable, Sendable {
        public var scope: String
        public var expiresAt: Double?
    }

    public enum Failure: String, Error, Equatable, Sendable {
        case badArea = "Name the area with letters, digits and dashes."
        case badDays = "Days: a whole number from 1 to 365."
        case adminDays = "An admin-tier access needs an end, 30 days at most."
    }

    /// The scope and the end (ms) a draft sends, or why it cannot be sent.
    public static func request(area: String, tier: String, days: String, now: Date = Date()) -> Result<Request, Failure> {
        let name = area.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !name.isEmpty, name.range(of: "^[a-z0-9-]+$", options: .regularExpression) != nil else { return .failure(.badArea) }
        guard tiers.contains(tier) else { return .failure(.badArea) }
        let text = days.trimmingCharacters(in: .whitespacesAndNewlines)
        var count: Int?
        if !text.isEmpty {
            guard let n = Int(text), n >= 1, n <= 365 else { return .failure(.badDays) }
            count = n
        }
        if tier == "admin", count == nil || count! > maxAdminDays { return .failure(.adminDays) }
        let end = count.map { now.timeIntervalSince1970 * 1000 + Double($0) * 86_400_000 }
        return .success(Request(scope: "\(name):\(tier)", expiresAt: end))
    }
}

// MARK: - Client

public extension CompanionClient {
    /// `GET /api/approvals/journal?days=7|30`.
    func actionJournal(days: Int) async throws -> JournalPayload {
        let window = ActionJournal.days.contains(days) ? days : ActionJournal.defaultDays
        return try await send(makeRequest("GET", "/api/approvals/journal", query: [URLQueryItem(name: "days", value: String(window))]), as: JournalPayload.self)
    }

    /// `POST /api/approvals/journal/test` `{rule}`: the rule replayed on the
    /// last seven days. A saved rule's draft carries its `id`.
    func testRule(_ draft: RuleTestDraft) async throws -> RuleTestResult {
        struct Body: Encodable { var rule: RuleTestDraft }
        return try await send(makeRequest("POST", "/api/approvals/journal/test", encodedBody: Body(rule: draft)), as: RuleTestResult.self)
    }

    /// `GET /api/me/tool-grants`.
    func myToolGrants() async throws -> MyToolGrants {
        try await send(makeRequest("GET", "/api/me/tool-grants"), as: MyToolGrants.self)
    }

    /// `POST /api/me/tool-grants` `{scope, expiresAt?}`.
    func grantMyToolAccess(scope: String, expiresAt: Double?) async throws {
        var body: [String: Any] = ["scope": scope]
        if let expiresAt { body["expiresAt"] = expiresAt }
        try await send(makeRequest("POST", "/api/me/tool-grants", body: body))
    }

    /// `POST /api/me/tool-grants/<id>/revoke`.
    func revokeMyToolGrant(id: String) async throws {
        guard Self.validRouteID(id) else { throw APIError.badURL }
        try await send(makeRequest("POST", "/api/me/tool-grants/\(id)/revoke"))
    }

    /// `GET /api/bots/<id>/tool-grants`: a bot's own grants (`BotToolAccess.tsx`).
    func botToolGrants(botId: String) async throws -> MyToolGrants {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try await send(makeRequest("GET", "/api/bots/\(botId)/tool-grants"), as: MyToolGrants.self)
    }

    /// `POST /api/bots/<id>/tool-grants` `{scope, expiresAt?}`.
    func grantBotToolAccess(botId: String, scope: String, expiresAt: Double?) async throws {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        var body: [String: Any] = ["scope": scope]
        if let expiresAt { body["expiresAt"] = expiresAt }
        try await send(makeRequest("POST", "/api/bots/\(botId)/tool-grants", body: body))
    }

    /// `POST /api/bots/<id>/tool-grants/<grantId>/revoke`.
    func revokeBotToolGrant(botId: String, id: String) async throws {
        guard Self.validRouteID(botId), Self.validRouteID(id) else { throw APIError.badURL }
        try await send(makeRequest("POST", "/api/bots/\(botId)/tool-grants/\(id)/revoke"))
    }
}
