import Foundation

// Plugins on the phone (iOS parity matrix rows PL7, PL8, PL9): the desktop's
// MCP servers tab read-only (McpServersPanel.tsx) and the person's own
// claude.ai connectors (HarnessConnectorsSection.tsx), so the phone decides
// exactly what the desktop decides. Which pairing sees what is SurfaceGate's.

// MARK: - The person's claude.ai connectors (PL7)

public struct HarnessConnectorsAnswer: Decodable, Hashable, Sendable {
    public struct Connector: Decodable, Hashable, Identifiable, Sendable {
        public var name: String
        /// connected, needs_auth, failed, unknown.
        public var status: String
        public var id: String { name }
    }

    public struct Claude: Decodable, Hashable, Sendable {
        public var available: Bool
        /// disabled, managed_policy, no_engine, not_signed_in, not_operator, key, unknown.
        public var reason: String?
        public var connectors: [Connector]

        public init(from decoder: Decoder) throws {
            let values = try decoder.container(keyedBy: CodingKeys.self)
            available = try values.decodeIfPresent(Bool.self, forKey: .available) ?? false
            reason = try values.decodeIfPresent(String.self, forKey: .reason)
            connectors = try values.decodeIfPresent([Connector].self, forKey: .connectors) ?? []
        }

        private enum CodingKeys: String, CodingKey { case available, reason, connectors }
    }

    public struct Codex: Decodable, Hashable, Sendable {
        public var available: Bool
    }

    public var manageUrl: String
    public var canManage: Bool
    public var enabled: Bool
    public var claude: Claude
    public var codex: Codex

    /// Where "Manage on claude.ai" goes: the server's address when it is an
    /// https page, the connectors page otherwise.
    public var manageLink: URL {
        if let url = URL(string: manageUrl), url.scheme == "https", url.host != nil { return url }
        return URL(string: "https://claude.ai/customize/connectors")!
    }
}

// MARK: - MCP servers (PL8, PL9)

/// `GET /api/mcp/servers/:name/oauth/status`.
public struct MCPSignInStatus: Decodable, Hashable, Sendable {
    public var auth: String?
    public var pending: Bool?
    public var authError: String?
}

/// What the line under a URL server says (`McpAuthLine`).
public enum MCPAuthLine: Hashable, Sendable {
    case connected(issuer: String)
    case error(detail: String?)
    case required(issuer: String, detail: String?)
    case expired(detail: String?)
}

public enum MCPServerRules {
    /// The desktop waits ten minutes for a sign-in, polling every two seconds.
    public static let signInWait: TimeInterval = 10 * 60
    public static let signInPoll: TimeInterval = 2

    public static func authLine(_ server: MCPServerListing) -> MCPAuthLine? {
        guard let url = server.url, let auth = server.auth, auth != "none" else { return nil }
        let issuer = server.authIssuer ?? URL(string: url)?.host ?? url
        switch auth {
        case "connected": return .connected(issuer: issuer)
        case "error": return .error(detail: server.authError)
        case "expired": return .expired(detail: server.authError)
        default: return .required(issuer: issuer, detail: server.authError)
        }
    }

    /// Sign in (required) or Sign in again (expired), only for a URL server.
    public static func needsSignIn(_ server: MCPServerListing) -> Bool {
        server.isRemote && (server.auth == "required" || server.auth == "expired")
    }

    /// The monospaced line: the address, or the command and its arguments.
    public static func detailLine(_ server: MCPServerListing) -> String {
        if let url = server.url { return url }
        return ([server.command ?? ""] + (server.args ?? [])).joined(separator: " ")
    }

    /// The waiting ends when the server connects or stops waiting itself.
    public enum Poll: Hashable, Sendable { case keepWaiting, connected, stopped(error: String?) }
    public static func poll(_ status: MCPSignInStatus) -> Poll {
        if status.auth == "connected" { return .connected }
        if status.pending != true { return .stopped(error: status.authError) }
        return .keepWaiting
    }
}

// MARK: - Client

public extension CompanionClient {
    /// `GET /api/me/harness-connectors[?refresh=1]` (PL7). Asking Claude Code
    /// can take a while: the desktop waits up to 90 seconds.
    func harnessConnectors(refresh: Bool = false) async throws -> HarnessConnectorsAnswer {
        try await send(harnessConnectorsRequest(refresh: refresh), as: HarnessConnectorsAnswer.self)
    }

    /// `PUT /api/harness-connectors/settings {claudeAi}`: admin only.
    func setHarnessConnectorsEnabled(_ enabled: Bool) async throws {
        try await send(makeRequest("PUT", "/api/harness-connectors/settings", body: ["claudeAi": enabled]))
    }

    /// `GET /api/mcp/servers[?reprobe=1]` (PL8).
    func mcpServers(reprobe: Bool) async throws -> MCPServersResponse {
        try await send(
            makeRequest("GET", "/api/mcp/servers", query: reprobe ? [URLQueryItem(name: "reprobe", value: "1")] : []),
            as: MCPServersResponse.self
        )
    }

    /// `GET /api/mcp/servers/:name/oauth/status` (PL9).
    func mcpSignInStatus(serverName: String) async throws -> MCPSignInStatus {
        guard Self.validRouteID(serverName) else { throw APIError.badURL }
        return try await send(makeRequest("GET", "/api/mcp/servers/\(serverName)/oauth/status"), as: MCPSignInStatus.self)
    }

    // MARK: Request builders (tested without a network)

    func harnessConnectorsRequest(refresh: Bool) throws -> URLRequest {
        var request = try makeRequest("GET", "/api/me/harness-connectors", query: refresh ? [URLQueryItem(name: "refresh", value: "1")] : [])
        request.timeoutInterval = 90
        return request
    }
}
