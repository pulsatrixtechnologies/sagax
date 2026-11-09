// The Edit bot pages' own routes (iPad parity round 4): what the desktop's
// Model, Permissions and Access pages read and write that the iPad had no
// call for.
//
//   GET/PATCH /api/bots/:id/runtime-settings  { settings: { automaticRecovery } }
//   GET/PUT   /api/bots/:id/lifecycle-hooks   { enabled, events }
//   PATCH     /api/approval-rules/:id         { behavior?, description? }
//   GET/PUT   /api/bots/:id/background-brief  { settings, apps, notice? }
import Foundation

/// `GET /api/bots/:id/runtime-settings` `settings.automaticRecovery`.
public struct BotRuntimeSettings: Decodable, Hashable, Sendable {
    public var automaticRecovery: BotAutomaticRecovery?
    /// Maximum running 1:1 conversations for this bot (1 to 16).
    public var maxConcurrentThreads: Int?

    public init(automaticRecovery: BotAutomaticRecovery? = nil, maxConcurrentThreads: Int? = nil) {
        self.automaticRecovery = automaticRecovery
        self.maxConcurrentThreads = maxConcurrentThreads
    }
}

/// `GET /api/bots/:id/lifecycle-hooks`.
public struct BotLifecycleHooks: Decodable, Hashable, Sendable {
    public var enabled: Bool
    /// The plugin hooks' events; empty: no plugin hook installed.
    public var events: [String]

    public init(enabled: Bool, events: [String]) {
        self.enabled = enabled
        self.events = events
    }

    private enum CodingKeys: String, CodingKey { case enabled, events }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        enabled = try container.decodeIfPresent(Bool.self, forKey: .enabled) ?? false
        // `events` may be names or { event, ... } records on newer servers
        if let names = try? container.decodeIfPresent([String].self, forKey: .events) {
            events = names
        } else if let records = try? container.decodeIfPresent([[String: AnyCodableValue]].self, forKey: .events) {
            events = records.compactMap { $0["event"]?.string ?? $0["name"]?.string }
        } else {
            events = []
        }
    }
}

/// A JSON value read loosely (the lifecycle hooks' event records).
public enum AnyCodableValue: Decodable, Hashable, Sendable {
    case string(String), number(Double), bool(Bool), other

    public var string: String? { if case let .string(value) = self { value } else { nil } }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else { self = .other }
    }
}

/// `GET /api/bots/:id/background-brief`: its settings and how many apps
/// are connected (none: `notice` "no_apps", the queue stays empty).
public struct BotBackgroundBrief: Decodable, Hashable, Sendable {
    public struct Settings: Codable, Hashable, Sendable {
        public var enabled: Bool
        public var everyHours: Double?
        public var subjects: [String]?
        /// HH:MM in `timeZone`.
        public var at: String?
        public var timeZone: String?

        public init(enabled: Bool, everyHours: Double? = nil, subjects: [String]? = nil, at: String? = nil, timeZone: String? = nil) {
            self.enabled = enabled
            self.everyHours = everyHours
            self.subjects = subjects
            self.at = at
            self.timeZone = timeZone
        }
    }

    public var settings: Settings
    public var apps: Int
    public var notice: String?

    public init(settings: Settings, apps: Int, notice: String? = nil) {
        self.settings = settings
        self.apps = apps
        self.notice = notice
    }

    private enum CodingKeys: String, CodingKey { case settings, apps, notice }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        settings = try container.decode(Settings.self, forKey: .settings)
        apps = try container.decodeIfPresent(Int.self, forKey: .apps) ?? 0
        notice = try container.decodeIfPresent(String.self, forKey: .notice)
    }
}

public extension CompanionClient {
    private struct RuntimeSettingsBody: Decodable { let settings: BotRuntimeSettings }

    func botRuntimeSettings(botId: String) async throws -> BotRuntimeSettings {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try await send(makeRequest("GET", "/api/bots/\(botId)/runtime-settings"), as: RuntimeSettingsBody.self).settings
    }

    /// `PATCH {automaticRecovery}`: on with its backup, or off.
    func setBotAutomaticRecovery(botId: String, _ recovery: BotAutomaticRecovery) async throws -> BotRuntimeSettings {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        var body: [String: Any] = ["enabled": recovery.enabled]
        if let backup = recovery.backup, !backup.model.isEmpty {
            body["backup"] = ["instanceId": backup.instanceId, "model": backup.model]
        }
        return try await send(makeRequest("PATCH", "/api/bots/\(botId)/runtime-settings", body: ["automaticRecovery": body]),
                              as: RuntimeSettingsBody.self).settings
    }

    /// `PATCH {maxConcurrentThreads}` (BotParallelSettings.tsx): 1 to 16.
    func setBotMaxConcurrentThreads(botId: String, _ value: Int) async throws {
        guard Self.validRouteID(botId), (1...16).contains(value) else { throw APIError.badURL }
        try await send(makeRequest("PATCH", "/api/bots/\(botId)/runtime-settings", body: ["maxConcurrentThreads": value]))
    }

    func botLifecycleHooks(botId: String) async throws -> BotLifecycleHooks {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try await send(makeRequest("GET", "/api/bots/\(botId)/lifecycle-hooks"), as: BotLifecycleHooks.self)
    }

    func setBotLifecycleHooks(botId: String, enabled: Bool) async throws -> BotLifecycleHooks {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try await send(makeRequest("PUT", "/api/bots/\(botId)/lifecycle-hooks", body: ["enabled": enabled]), as: BotLifecycleHooks.self)
    }

    /// `PATCH /api/approval-rules/:id`: the rule's behavior ("allow", "deny",
    /// "ask") or its description.
    func updateApprovalRule(id: String, behavior: String? = nil, description: String? = nil) async throws {
        guard Self.validRouteID(id) else { throw APIError.badURL }
        var body: [String: Any] = [:]
        if let behavior { body["behavior"] = behavior }
        if let description { body["description"] = description }
        try await send(makeRequest("PATCH", "/api/approval-rules/\(id)", body: body))
    }

    func botBackgroundBrief(botId: String) async throws -> BotBackgroundBrief {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try await send(makeRequest("GET", "/api/bots/\(botId)/background-brief"), as: BotBackgroundBrief.self)
    }

    /// `POST /api/bots/:id/background-brief/pass {costUsd: 0}`: read the
    /// connected apps once (409 brief_not_due while it is off or too soon).
    func runBotBackgroundBriefPass(botId: String) async throws {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        try await send(makeRequest("POST", "/api/bots/\(botId)/background-brief/pass", body: ["costUsd": 0]))
    }

    /// `PUT {enabled?, at?, timeZone?}`; answers the saved settings.
    func setBotBackgroundBrief(botId: String, enabled: Bool? = nil, at: String? = nil, timeZone: String? = nil) async throws -> BotBackgroundBrief.Settings {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        struct Body: Decodable { let settings: BotBackgroundBrief.Settings }
        var body: [String: Any] = [:]
        if let enabled { body["enabled"] = enabled }
        if let at { body["at"] = at }
        if let timeZone { body["timeZone"] = timeZone }
        return try await send(makeRequest("PUT", "/api/bots/\(botId)/background-brief", body: body), as: Body.self).settings
    }
}
