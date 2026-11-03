// Settings > Organization on an organization server (matrix ST8, AU19), as
// the desktop's PerspicaxOrgSettings.tsx draws it: the organization card,
// Routines in my name (MyRoutineDelegation.tsx, src/lib/routine-delegation.ts),
// Sharing in the organization (OrgSharing.tsx), Allow full access
// (OrgFullAccessPolicy.tsx) and the commands waiting for an admin.
//
// Routes (server/perspicax/perspicax-org-routes.ts, server/index.ts):
// - GET /api/org: any signed-in person (CLIENT_ALLOW).
// - GET/POST /api/org/routine-delegation: the caller's own session.
// - GET /api/org/bots: any session, filtered per caller.
// - PATCH /api/org/settings, GET /api/org/approvals, POST
//   /api/org/bots/:id/force-stop|force-delete: an organization admin.
import Foundation

// MARK: - GET /api/org

public struct OrgInfo: Decodable, Hashable, Sendable {
    public struct Identity: Decodable, Hashable, Sendable {
        public var kind: String
        public var issuer: String?
    }

    public struct Org: Decodable, Hashable, Sendable {
        public var name: String
        public var identity: Identity?
    }

    public struct Link: Decodable, Hashable, Sendable {
        /// "ok", "missing" or "error".
        public var state: String
        public var syncedAt: Double?
        public var error: String?
    }

    public struct Settings: Decodable, Hashable, Sendable {
        public var orgKeyConfigured: Bool?
        public var allowFullAccess: Bool?
    }

    public var org: Org
    public var link: Link?
    /// "admin" or "member".
    public var viewerRole: String?
    public var settings: Settings?

    public var isPerspicax: Bool { org.identity?.kind == "perspicax" }
    public var isAdmin: Bool { viewerRole == "admin" }
    /// "Manage in Perspicax": the console of the issuer.
    public var consoleURL: URL? {
        guard let issuer = org.identity?.issuer, !issuer.isEmpty else { return nil }
        let trimmed = issuer.replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
        return URL(string: "\(trimmed)/console/")
    }
}

// MARK: - Routine delegation (AU19)

public struct RoutineDelegationStatus: Decodable, Hashable, Sendable {
    /// "active" or "none".
    public var state: String
    public var consentedAt: Double?
    public var renewedAt: Double?
    public var expiresAt: Double?
    public var suspended: Int
    public var manageUrl: String?
    public var principalId: String?

    public init(state: String, consentedAt: Double? = nil, renewedAt: Double? = nil, expiresAt: Double? = nil, suspended: Int = 0,
                manageUrl: String? = nil, principalId: String? = nil) {
        self.state = state
        self.consentedAt = consentedAt
        self.renewedAt = renewedAt
        self.expiresAt = expiresAt
        self.suspended = suspended
        self.manageUrl = manageUrl
        self.principalId = principalId
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        state = (try? c.decodeIfPresent(String.self, forKey: .state)) ?? "none"
        consentedAt = try? c.decodeIfPresent(Double.self, forKey: .consentedAt)
        renewedAt = try? c.decodeIfPresent(Double.self, forKey: .renewedAt)
        expiresAt = try? c.decodeIfPresent(Double.self, forKey: .expiresAt)
        suspended = (try? c.decodeIfPresent(Int.self, forKey: .suspended)) ?? 0
        manageUrl = try? c.decodeIfPresent(String.self, forKey: .manageUrl)
        principalId = try? c.decodeIfPresent(String.self, forKey: .principalId)
    }

    private enum CodingKeys: String, CodingKey { case state, consentedAt, renewedAt, expiresAt, suspended, manageUrl, principalId }

    public var active: Bool { state == "active" }
}

/// How a consent at Perspicax came back: the server's callback ends on
/// `/#routine-delegation=ok` or `/#routine-delegation-error=<code>`.
public enum RoutineDelegationReturn: Hashable, Sendable {
    case ok
    case error(String)

    /// The outcome a URL fragment carries (`parseRoutineDelegationHash`).
    public init?(fragment: String?) {
        guard var text = fragment else { return nil }
        if text.hasPrefix("#") { text.removeFirst() }
        if text == "routine-delegation=ok" { self = .ok; return }
        let prefix = "routine-delegation-error="
        guard text.hasPrefix(prefix) else { return nil }
        let code = String(text.dropFirst(prefix.count))
        guard (1...64).contains(code.count),
              code.unicodeScalars.allSatisfy({ CharacterSet.alphanumerics.contains($0) || $0 == "_" || $0 == "-" })
        else { return nil }
        self = .error(code)
    }

    /// The codes with a sentence of their own; any other is "generic".
    public static let knownCodes: Set<String> = ["routines_subject", "routines_scope", "routines_session", "rate_limited"]
}

public enum RoutineDelegation {
    /// Where "the consent already started once on its own" is remembered,
    /// per person (`AUTO_CONSENT_KEY` in src/lib/routine-delegation.ts).
    public static let autoConsentKey = "sagax.routineDelegation.autoConsent.v1"

    public static func autoConsentKey(for status: RoutineDelegationStatus) -> String {
        "\(autoConsentKey):\(status.principalId ?? status.manageUrl ?? "self")"
    }

    /// `ensureRoutineDelegation`: after a routine is created, a person whose
    /// routines may not act in their name yet is sent to the consent once.
    public static func shouldStart(_ status: RoutineDelegationStatus, alreadyAsked: Bool) -> Bool {
        !status.active && !alreadyAsked
    }
}

public struct RoutineDelegationStart: Hashable, Sendable {
    public var authorizationURL: URL
    /// The flow's binding cookies (`Set-Cookie` of the start), which the
    /// callback on the server must carry back.
    public var cookies: [HTTPCookie]
}

// MARK: - Sharing in the organization

public struct OrgBotGrant: Decodable, Hashable, Sendable {
    public var target: String
    public var level: String?
    public var label: String?
    public var kind: String?
}

public struct OrgBot: Decodable, Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var ownerPrincipalId: String?
    public var ownerName: String?
    public var section: String?
    public var grants: [OrgBotGrant]
    /// Absent when the server does not say.
    public var running: Bool?

    public init(id: String, name: String, ownerPrincipalId: String? = nil, ownerName: String? = nil, section: String? = nil,
                grants: [OrgBotGrant] = [], running: Bool? = nil) {
        self.id = id
        self.name = name
        self.ownerPrincipalId = ownerPrincipalId
        self.ownerName = ownerName
        self.section = section
        self.grants = grants
        self.running = running
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = (try? c.decodeIfPresent(String.self, forKey: .name)) ?? id
        ownerPrincipalId = try? c.decodeIfPresent(String.self, forKey: .ownerPrincipalId)
        ownerName = try? c.decodeIfPresent(String.self, forKey: .ownerName)
        section = try? c.decodeIfPresent(String.self, forKey: .section)
        grants = (try? c.decodeIfPresent([OrgBotGrant].self, forKey: .grants)) ?? []
        running = try? c.decodeIfPresent(Bool.self, forKey: .running)
    }

    private enum CodingKeys: String, CodingKey { case id, name, ownerPrincipalId, ownerName, section, grants, running }

    /// `ownerName || ownerPrincipalId`.
    public var owner: String { (ownerName?.isEmpty == false ? ownerName : nil) ?? ownerPrincipalId ?? "" }
}

public enum OrgSharing {
    /// The search and the grouping show above eight bots.
    public static let searchThreshold = 8

    /// Case-insensitive on the name, the owner and the section.
    public static func filter(_ bots: [OrgBot], query: String) -> [OrgBot] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return bots }
        return bots.filter { bot in
            [bot.name, bot.owner, bot.section ?? ""].contains { $0.lowercased().contains(needle) }
        }
    }

    /// Owner groups, sorted by owner name.
    public static func groupedByOwner(_ bots: [OrgBot]) -> [(owner: String, bots: [OrgBot])] {
        let groups = Dictionary(grouping: bots, by: \.owner)
        return groups.keys.sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }.map { ($0, groups[$0] ?? []) }
    }
}

// MARK: - Commands waiting for an admin

public struct OrgApproval: Decodable, Hashable, Sendable, Identifiable {
    public var botId: String
    public var botName: String?
    public var threadId: String
    public var requestId: String
    public var tool: String?
    public var summary: String?
    public var at: Double?

    public var id: String { "\(threadId):\(requestId)" }
}

// MARK: - Client

public extension CompanionClient {
    /// `GET /api/org`. A solo server answers 404 (`no_organization`).
    func organization() async throws -> OrgInfo {
        try await send(makeRequest("GET", "/api/org"), as: OrgInfo.self)
    }

    /// `GET /api/org/routine-delegation`.
    func routineDelegation() async throws -> RoutineDelegationStatus {
        try await send(makeRequest("GET", "/api/org/routine-delegation"), as: RoutineDelegationStatus.self)
    }

    /// `POST /api/org/routine-delegation`: the authorization address, and the
    /// binding cookie the callback must bring back.
    func startRoutineDelegation() async throws -> RoutineDelegationStart {
        struct Started: Decodable { var authorizationUrl: String }
        let request = try makeRequest("POST", "/api/org/routine-delegation", body: [:])
        let (data, response) = try await perform(request)
        try Self.check(response, data)
        guard let started = try? JSONDecoder().decode(Started.self, from: data), let url = URL(string: started.authorizationUrl) else {
            throw APIError.transport("The server did not start the authorization.")
        }
        var cookies: [HTTPCookie] = []
        if let http = response as? HTTPURLResponse, let origin = request.url {
            let fields = http.allHeaderFields.reduce(into: [String: String]()) { result, pair in
                if let key = pair.key as? String, let value = pair.value as? String { result[key] = value }
            }
            cookies = HTTPCookie.cookies(withResponseHeaderFields: fields, for: origin)
        }
        return RoutineDelegationStart(authorizationURL: url, cookies: cookies)
    }

    /// `GET /api/org/bots`.
    func organizationBots() async throws -> [OrgBot] {
        struct Answer: Decodable { var bots: [OrgBot] }
        return try await send(makeRequest("GET", "/api/org/bots"), as: Answer.self).bots
    }

    /// `GET /api/org/approvals` (admin).
    func organizationApprovals() async throws -> [OrgApproval] {
        struct Answer: Decodable { var approvals: [OrgApproval] }
        return try await send(makeRequest("GET", "/api/org/approvals"), as: Answer.self).approvals
    }

    /// `PATCH /api/org/settings {allowFullAccess}` (admin): the saved value.
    func setOrganizationFullAccess(_ allow: Bool) async throws -> Bool {
        struct Answer: Decodable { var settings: OrgInfo.Settings }
        let answer = try await send(makeRequest("PATCH", "/api/org/settings", body: ["allowFullAccess": allow]), as: Answer.self)
        return answer.settings.allowFullAccess ?? allow
    }

    /// `POST /api/org/bots/:id/force-stop` (admin).
    func forceStopOrganizationBot(id: String) async throws {
        try await send(makeRequest("POST", "/api/org/bots/\(id)/force-stop", body: [:]))
    }

    /// `POST /api/org/bots/:id/force-delete {confirm: <exact name>}` (admin).
    func forceDeleteOrganizationBot(id: String, name: String) async throws {
        try await send(makeRequest("POST", "/api/org/bots/\(id)/force-delete", body: ["confirm": name]))
    }
}
