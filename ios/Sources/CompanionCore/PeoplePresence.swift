// People on an organization server, the desktop changes of 2026-10-08 (matrix
// section 14, DC9 and DC10):
//
// - presence (#167, src/lib/presence.ts, shared/presence.ts): online, away or
//   offline for each person of the directory, from `GET /api/org/presence`,
//   then `presence.changed` frames. A frame with `audience` is the viewer's
//   own real state; the public one about the viewer is skipped, so a person
//   who hides their presence still sees their own dot.
// - labels (#172, src/lib/person-labels.ts, shared/person-label.ts): a free
//   one-line tag beside a person's name, drawn like a bot's label, from
//   `GET /api/people/labels`, then `person.label` frames (null clears).
//
// Both routes are in CLIENT_ALLOW and answer only on an organization server;
// anywhere else nothing here is drawn.
import Foundation

// MARK: - Presence

public enum PresenceState: String, Codable, Hashable, Sendable {
    case online, away, offline
}

/// One row of `GET /api/org/presence` or of a `presence.changed` frame.
public struct PresenceRow: Decodable, Hashable, Sendable {
    public var principalId: String
    public var state: PresenceState
    /// Milliseconds since 1970; nil when unknown or hidden.
    public var lastSeenAt: Double?
    /// The viewer's own row: they turned off "Show when I am online".
    public var hidden: Bool

    public init(principalId: String, state: PresenceState, lastSeenAt: Double? = nil, hidden: Bool = false) {
        self.principalId = principalId
        self.state = state
        self.lastSeenAt = lastSeenAt
        self.hidden = hidden
    }

    private enum CodingKeys: String, CodingKey { case principalId, state, lastSeenAt, hidden }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        principalId = try values.decode(String.self, forKey: .principalId)
        state = try values.decode(PresenceState.self, forKey: .state)
        let seen = try? values.decodeIfPresent(Double.self, forKey: .lastSeenAt)
        lastSeenAt = seen.flatMap { $0.isFinite ? $0 : nil }
        hidden = (try? values.decodeIfPresent(Bool.self, forKey: .hidden)) == true
    }
}

public struct PresenceEntry: Hashable, Sendable {
    public var state: PresenceState
    public var lastSeenAt: Double?
    public var hidden: Bool

    public init(state: PresenceState, lastSeenAt: Double? = nil, hidden: Bool = false) {
        self.state = state
        self.lastSeenAt = lastSeenAt
        self.hidden = hidden
    }
}

/// How long ago someone was last seen, for "Offline, last seen 2 h ago".
public enum PresenceLastSeen: Hashable, Sendable {
    case justNow
    case minutes(Int)
    case hours(Int)
    case days(Int)

    /// `lastSeenAgo` (src/lib/presence.ts).
    public static func ago(_ at: Double, now: Double) -> PresenceLastSeen {
        let minutes = max(0, Int(((now - at) / 60_000).rounded(.down)))
        if minutes < 1 { return .justNow }
        if minutes < 60 { return .minutes(minutes) }
        let hours = minutes / 60
        if hours < 24 { return .hours(hours) }
        return .days(hours / 24)
    }
}

/// Everyone's presence as the viewer reads it.
public struct PresenceBook: Hashable, Sendable {
    /// Set once the list answered: before that (and off an organization
    /// server) no dot is drawn.
    public private(set) var enabled = false
    public private(set) var selfId: String?
    public private(set) var entries: [String: PresenceEntry] = [:]

    public init() {}

    static func key(_ id: String) -> String { id.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }

    /// `applyPresenceList`: everything replaced by the server's list.
    public mutating func applyList(_ rows: [PresenceRow]) {
        var next: [String: PresenceEntry] = [:]
        for row in rows {
            next[Self.key(row.principalId)] = PresenceEntry(state: row.state, lastSeenAt: row.lastSeenAt, hidden: row.hidden)
        }
        enabled = true
        entries = next
    }

    /// `applyPresenceFrame`. Returns whether anything changed.
    @discardableResult
    public mutating func applyFrame(audience: String?, rows: [PresenceRow]) -> Bool {
        guard enabled else { return false }
        let own = audience != nil
        if let audience { selfId = Self.key(audience) }
        var changed = false
        for row in rows {
            let id = Self.key(row.principalId)
            if !own, let selfId, id == selfId { continue }
            let entry = PresenceEntry(state: row.state, lastSeenAt: row.lastSeenAt, hidden: row.hidden)
            if entries[id] != entry { changed = true }
            entries[id] = entry
        }
        return changed
    }

    /// Nil where there is none: not enabled, or not a person of the
    /// directory (a team, a service account).
    public func entry(_ principalId: String?) -> PresenceEntry? {
        guard enabled, let principalId else { return nil }
        return entries[Self.key(principalId)]
    }

    public mutating func reset() {
        enabled = false
        selfId = nil
        entries = [:]
    }
}

/// `POST /api/presence/heartbeat`: what an open app sends about every minute.
public struct PresenceHeartbeat: Encodable, Hashable, Sendable {
    public var pageId: String
    /// The server knows "desktop" and "web"; a phone reports as a web page
    /// until a "phone" kind exists.
    public var kind: String
    public var idleMs: Int

    public init(pageId: String, kind: String = "web", idleMs: Int) {
        self.pageId = pageId
        self.kind = kind
        self.idleMs = idleMs
    }

    /// A page id the route accepts (`[A-Za-z0-9_-]{8,64}`).
    public static func newPageId() -> String {
        "ios" + UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
    }

    public static let interval: TimeInterval = 60
}

private struct PresenceList: Decodable {
    var people: [Lossy<PresenceRow>]?
}

public extension CompanionClient {
    /// `GET /api/org/presence`: every active person of the directory.
    func presence() async throws -> [PresenceRow] {
        let list = try await send(makeRequest("GET", "/api/org/presence"), as: PresenceList.self)
        return (list.people ?? []).compactMap(\.value)
    }

    func presenceHeartbeatRequest(_ beat: PresenceHeartbeat) throws -> URLRequest {
        try makeRequest("POST", "/api/presence/heartbeat", encodedBody: beat)
    }

    /// `POST /api/presence/heartbeat`; answers the viewer's own row.
    @discardableResult
    func presenceHeartbeat(_ beat: PresenceHeartbeat) async throws -> PresenceRow {
        try await send(presenceHeartbeatRequest(beat), as: PresenceRow.self)
    }
}

// MARK: - Labels

public enum PersonLabel {
    /// `PERSON_LABEL_MAX`.
    public static let maxLength = 40

    public enum Problem: String, Error, Hashable, Sendable {
        case tooLong = "label_too_long"
        case oneLine = "label_one_line"
    }

    /// `normalizePersonLabel`: the trimmed text, nil to clear it, or why it
    /// does not fit. Characters are counted as the desktop counts them
    /// (code points), so an accent or an emoji is not cut short.
    public static func normalize(_ raw: String?) -> Result<String?, Problem> {
        guard let raw else { return .success(nil) }
        let label = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !label.isEmpty else { return .success(nil) }
        for scalar in label.unicodeScalars {
            let code = scalar.value
            if code < 0x20 || (0x7F...0x9F).contains(code) || code == 0x2028 || code == 0x2029 { return .failure(.oneLine) }
        }
        if label.unicodeScalars.count > maxLength { return .failure(.tooLong) }
        return .success(label)
    }

    /// `canEditPersonLabel`: the person, an organization admin, or a manager
    /// of one of the person's teams.
    public static func canEdit(personId: String, viewerId: String?, viewerAdmin: Bool, managedTeamIds: [String], personTeamIds: [String]) -> Bool {
        if let viewerId, PresenceBook.key(viewerId) == PresenceBook.key(personId) { return true }
        if viewerAdmin { return true }
        let managed = Set(managedTeamIds)
        return personTeamIds.contains { managed.contains($0) }
    }
}

/// Everyone's label, by principal id (any case).
public struct PersonLabelBook: Hashable, Sendable {
    public private(set) var labels: [String: String] = [:]

    public init(_ labels: [String: String] = [:]) {
        for (id, label) in labels { set(id, label) }
    }

    public func label(_ principalId: String?) -> String? {
        guard let principalId else { return nil }
        return labels[PresenceBook.key(principalId)]
    }

    /// A `person.label` frame or a save: nil or blank clears it.
    public mutating func set(_ principalId: String, _ label: String?) {
        let key = PresenceBook.key(principalId)
        if let label, !label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            labels[key] = label
        } else {
            labels.removeValue(forKey: key)
        }
    }
}

private struct PersonLabelList: Decodable {
    var labels: [String: String]?
}

private struct PersonLabelSaved: Decodable {
    var principalId: String
    var label: String?
}

public extension CompanionClient {
    /// `GET /api/people/labels`.
    func personLabels() async throws -> [String: String] {
        try await send(makeRequest("GET", "/api/people/labels"), as: PersonLabelList.self).labels ?? [:]
    }

    func setPersonLabelRequest(principalId: String, label: String?) throws -> URLRequest {
        struct Body: Encodable {
            let label: String?
            func encode(to encoder: Encoder) throws {
                var container = encoder.container(keyedBy: Key.self)
                try container.encode(label, forKey: .label)
            }
            enum Key: String, CodingKey { case label }
        }
        // URLComponents encodes the path; principal ids hold no "/"
        return try makeRequest("PUT", "/api/people/\(principalId)/label", encodedBody: Body(label: label))
    }

    /// `PUT /api/people/<id>/label`; nil clears it. Answers the stored label.
    func setPersonLabel(principalId: String, label: String?) async throws -> String? {
        try await send(setPersonLabelRequest(principalId: principalId, label: label), as: PersonLabelSaved.self).label
    }
}

// MARK: - A colleague's public card (src/lib/public-achievements.ts)

/// What a person shows the others of their achievements: their points (when
/// "Show my points" is on), their title (when "Show my title" is on), and the
/// unlocked list for the person panel's Achievements tab (#2117). The server
/// leaves out what they hid, for everyone.
public struct PublicAchievementCard: Decodable, Hashable, Sendable {
    public var points: Int?
    public var level: Int?
    public var title: String?
    /// Unlocked achievements only; an older payload without the list is empty.
    public var unlocked: [AchievementUnlock]

    public init(points: Int? = nil, level: Int? = nil, title: String? = nil, unlocked: [AchievementUnlock] = []) {
        self.points = points
        self.level = level
        self.title = title
        self.unlocked = unlocked
    }

    private enum CodingKeys: String, CodingKey { case points, level, title, unlocked }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        let points = try? values.decodeIfPresent(Int.self, forKey: .points)
        let level = try? values.decodeIfPresent(Int.self, forKey: .level)
        // points count only with their level, as the desktop reads them
        self.points = level == nil ? nil : points
        self.level = points == nil ? nil : level
        let title = try? values.decodeIfPresent(String.self, forKey: .title)
        self.title = (title?.isEmpty ?? true) ? nil : title
        unlocked = (try? values.decodeIfPresent([AchievementUnlock].self, forKey: .unlocked)) ?? []
    }

    /// The title's name in the catalog, nil when unknown.
    public var titleName: AchievementText? {
        guard let title else { return nil }
        for reward in AchievementDefinition.catalog.flatMap(\.rewards) {
            if case let .title(id, name) = reward, id == title { return name }
        }
        return nil
    }

    /// Whether the card carries anything the person panel can draw.
    public var isEmpty: Bool { points == nil && title == nil && unlocked.isEmpty }
}

private struct PublicAchievementList: Decodable {
    var points: [String: Lossy<PublicAchievementCard>]?
}

public extension CompanionClient {
    /// `GET /api/achievements/public?ids=`: one colleague's card, nil when
    /// they share nothing.
    func publicAchievementCard(principalId: String) async throws -> PublicAchievementCard? {
        let request = try makeRequest("GET", "/api/achievements/public", query: [URLQueryItem(name: "ids", value: principalId)])
        let list = try await send(request, as: PublicAchievementList.self)
        return list.points?[principalId]?.value
    }
}
