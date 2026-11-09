// A bot's rule sets (`src/lib/rule-sets.ts`, `server/routes/bot-rules.ts`):
// RULES.md is the first set (id "rules"), every other set is
// rules/<slug>.md, with an order, a name and an on/off switch.
//
//   GET    /api/bots/:id/rules                 RulesListing
//   POST   /api/bots/:id/rules/sets            { name }          -> listing + set
//   PATCH  /api/bots/:id/rules/sets/:set       { name?, enabled? }
//   DELETE /api/bots/:id/rules/sets/:set
//   PUT    /api/bots/:id/rules/order           { ids }
//   PUT    /api/bots/:id/rules/sets/:set/text  { text, expectedHash } (409 { current, currentHash })
import Foundation

/// One rule set as the server sends it.
public struct RuleSetWire: Decodable, Hashable, Identifiable, Sendable {
    public var id: String
    /// nil: the default set (RULES.md), shown as "Rules".
    public var name: String?
    public var enabled: Bool
    public var text: String
    public var hash: String
    public var lines: Int
    public var bytes: Int
    public var over: Bool
    public var loads: Bool

    public init(id: String, name: String?, enabled: Bool, text: String, hash: String = "", lines: Int = 0, bytes: Int = 0, over: Bool = false, loads: Bool = true) {
        self.id = id
        self.name = name
        self.enabled = enabled
        self.text = text
        self.hash = hash
        self.lines = lines
        self.bytes = bytes
        self.over = over
        self.loads = loads
    }

    private enum CodingKeys: String, CodingKey { case id, name, enabled, text, hash, lines, bytes, over, loads }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decodeIfPresent(String.self, forKey: .name)
        enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled) ?? true
        text = try c.decodeIfPresent(String.self, forKey: .text) ?? ""
        hash = try c.decodeIfPresent(String.self, forKey: .hash) ?? ""
        lines = try c.decodeIfPresent(Int.self, forKey: .lines) ?? 0
        bytes = try c.decodeIfPresent(Int.self, forKey: .bytes) ?? 0
        over = try c.decodeIfPresent(Bool.self, forKey: .over) ?? false
        loads = try c.decodeIfPresent(Bool.self, forKey: .loads) ?? enabled
    }

    /// The rules this set holds, as the desktop counts them (`rowValues.ts`):
    /// non-empty lines that are not headings.
    public var ruleCount: Int {
        text.split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty && !$0.hasPrefix("#") }
            .count
    }
}

/// `GET /api/bots/:id/rules`.
public struct RulesListing: Decodable, Hashable, Sendable {
    public var sets: [RuleSetWire]
    public var maxSets: Int
    public var maxNameLength: Int

    public init(sets: [RuleSetWire], maxSets: Int = 20, maxNameLength: Int = 60) {
        self.sets = sets
        self.maxSets = maxSets
        self.maxNameLength = maxNameLength
    }

    private enum CodingKeys: String, CodingKey { case sets, maxSets, maxNameLength }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        sets = try c.decodeIfPresent([RuleSetWire].self, forKey: .sets) ?? []
        maxSets = try c.decodeIfPresent(Int.self, forKey: .maxSets) ?? 20
        maxNameLength = try c.decodeIfPresent(Int.self, forKey: .maxNameLength) ?? 60
    }

    /// The rules of the sets that are on (the Rules row's count).
    public var enabledRuleCount: Int {
        sets.filter(\.enabled).reduce(0) { $0 + $1.ruleCount }
    }
}

/// The outcome of a text save: saved, or the file changed meanwhile.
public enum RuleSetSaveResult: Sendable {
    case saved(RulesListing)
    case conflict(current: String, currentHash: String)
}

extension CompanionClient {
    private func rulesBase(_ botId: String) throws -> String {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return "/api/bots/\(botId)/rules"
    }

    private func ruleSetPath(_ botId: String, _ setId: String) throws -> String {
        guard Self.validRouteID(setId) else { throw APIError.badURL }
        return try rulesBase(botId) + "/sets/\(setId)"
    }

    public func ruleSets(botId: String) async throws -> RulesListing {
        try await send(makeRequest("GET", rulesBase(botId)), as: RulesListing.self)
    }

    public func createRuleSet(botId: String, name: String) async throws -> RulesListing {
        try await send(makeRequest("POST", rulesBase(botId) + "/sets", body: ["name": name]), as: RulesListing.self)
    }

    public func renameRuleSet(botId: String, setId: String, name: String) async throws -> RulesListing {
        try await send(makeRequest("PATCH", ruleSetPath(botId, setId), body: ["name": name]), as: RulesListing.self)
    }

    public func setRuleSetEnabled(botId: String, setId: String, enabled: Bool) async throws -> RulesListing {
        try await send(makeRequest("PATCH", ruleSetPath(botId, setId), body: ["enabled": enabled]), as: RulesListing.self)
    }

    public func deleteRuleSet(botId: String, setId: String) async throws -> RulesListing {
        try await send(makeRequest("DELETE", ruleSetPath(botId, setId)), as: RulesListing.self)
    }

    public func reorderRuleSets(botId: String, ids: [String]) async throws -> RulesListing {
        try await send(makeRequest("PUT", rulesBase(botId) + "/order", body: ["ids": ids]), as: RulesListing.self)
    }

    /// Save a set's text; `expectedHash` nil overwrites whatever is there.
    public func saveRuleSetText(botId: String, setId: String, text: String, expectedHash: String?) async throws -> RuleSetSaveResult {
        var body: [String: Any] = ["text": text]
        if let expectedHash { body["expectedHash"] = expectedHash }
        let (data, response) = try await perform(makeRequest("PUT", ruleSetPath(botId, setId) + "/text", body: body))
        if (response as? HTTPURLResponse)?.statusCode == 409,
           let conflict = try? JSONDecoder().decode(RuleSetConflictBody.self, from: data),
           let current = conflict.current {
            return .conflict(current: current, currentHash: conflict.currentHash ?? "")
        }
        try Self.check(response, data)
        do {
            return .saved(try JSONDecoder().decode(RulesListing.self, from: data))
        } catch {
            throw APIError.transport("The computer sent something this app couldn't read.")
        }
    }
}

private struct RuleSetConflictBody: Decodable {
    var current: String?
    var currentHash: String?
}
