// Settings > Providers > Cloud coding agents (CloudAgentProvidersSettings.tsx,
// src/lib/cloud-agent-providers.ts): the person's own keys for Cursor,
// Claude Code and Codex cloud agents, encrypted on the server and never read
// back (the last four characters only).
import Foundation

public struct CloudAgentProviderRow: Codable, Hashable, Identifiable, Sendable {
    public var provider: String
    public var label: String
    public var configured: Bool
    public var last4: String?
    public var id: String { provider }

    public init(provider: String, label: String, configured: Bool, last4: String? = nil) {
        self.provider = provider
        self.label = label
        self.configured = configured
        self.last4 = last4
    }

    /// The row's summary (`cloudAgentProviders.summary.*`): any key saved.
    public static func anyConfigured(_ rows: [CloudAgentProviderRow]) -> Bool { rows.contains(where: \.configured) }
}

public extension CompanionClient {
    private struct CloudAgentAnswer: Decodable { let providers: [CloudAgentProviderRow]? }

    static func validCloudAgent(_ provider: String) -> Bool { ["cursor", "claude", "codex"].contains(provider) }

    func cloudAgentProvidersRequest() throws -> URLRequest { try makeRequest("GET", "/api/me/cloud-agent-providers") }

    func cloudAgentProviders() async throws -> [CloudAgentProviderRow] {
        try await send(cloudAgentProvidersRequest(), as: CloudAgentAnswer.self).providers ?? []
    }

    func saveCloudAgentProviderRequest(_ provider: String, token: String) throws -> URLRequest {
        guard Self.validCloudAgent(provider) else { throw APIError.badURL }
        return try makeRequest("PUT", "/api/me/cloud-agent-providers/\(provider)", body: ["token": token])
    }

    func saveCloudAgentProvider(_ provider: String, token: String) async throws {
        let (data, response) = try await perform(saveCloudAgentProviderRequest(provider, token: token))
        try Self.check(response, data)
    }

    func removeCloudAgentProvider(_ provider: String) async throws {
        guard Self.validCloudAgent(provider) else { throw APIError.badURL }
        let (data, response) = try await perform(try makeRequest("DELETE", "/api/me/cloud-agent-providers/\(provider)"))
        try Self.check(response, data)
    }

    func testCloudAgentProviderRequest(_ provider: String, token: String?) throws -> URLRequest {
        guard Self.validCloudAgent(provider) else { throw APIError.badURL }
        let trimmed = token?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return try makeRequest("POST", "/api/me/cloud-agent-providers/\(provider)/test", body: trimmed.isEmpty ? [:] : ["token": trimmed])
    }

    func testCloudAgentProvider(_ provider: String, token: String?) async throws {
        let (data, response) = try await perform(testCloudAgentProviderRequest(provider, token: token))
        try Self.check(response, data)
    }
}
