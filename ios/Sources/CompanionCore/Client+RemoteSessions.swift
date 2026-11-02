import Foundation

/// Bot remote hosts (unattended places) and temporary remote-support sessions.
public extension CompanionClient {
    /// `GET /api/bots/:id/remote-hosts`
    func botRemoteHosts(botId: String) async throws -> BotRemoteHostsAnswer {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try await send(makeRequest("GET", "/api/bots/\(botId)/remote-hosts"), as: BotRemoteHostsAnswer.self)
    }

    /// `POST /api/bots/:id/remote-hosts` `{ hostId }`
    @discardableResult
    func attachBotRemoteHost(botId: String, hostId: String) async throws -> [String] {
        guard Self.validRouteID(botId), Self.validRouteID(hostId) else { throw APIError.badURL }
        struct Body: Encodable { var hostId: String }
        struct Answer: Decodable { var remoteHosts: [String]? }
        let answer = try await send(
            makeRequest("POST", "/api/bots/\(botId)/remote-hosts", encodedBody: Body(hostId: hostId)),
            as: Answer.self
        )
        return answer.remoteHosts ?? []
    }

    /// `DELETE /api/bots/:id/remote-hosts/:hostId`
    @discardableResult
    func detachBotRemoteHost(botId: String, hostId: String) async throws -> [String] {
        guard Self.validRouteID(botId), Self.validRouteID(hostId) else { throw APIError.badURL }
        struct Answer: Decodable { var remoteHosts: [String]? }
        let answer = try await send(
            makeRequest("DELETE", "/api/bots/\(botId)/remote-hosts/\(hostId)"),
            as: Answer.self
        )
        return answer.remoteHosts ?? []
    }

    /// `POST /api/bots/:id/remote-hosts/:hostId/open`
    @discardableResult
    func openBotRemoteHost(botId: String, hostId: String) async throws -> String {
        guard Self.validRouteID(botId), Self.validRouteID(hostId) else { throw APIError.badURL }
        struct Answer: Decodable { var code: String? }
        let answer = try await send(
            makeRequest("POST", "/api/bots/\(botId)/remote-hosts/\(hostId)/open", body: [:]),
            as: Answer.self
        )
        return answer.code ?? ""
    }

    /// `GET /api/bots/:id/remote-sessions`
    func botRemoteSessions(botId: String) async throws -> [RemoteSessionView] {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try await send(
            makeRequest("GET", "/api/bots/\(botId)/remote-sessions"),
            as: RemoteSessionsAnswer.self
        ).sessions
    }

    /// `POST /api/bots/:id/remote-sessions/:id/close` (or the project's close route).
    func closeBotRemoteSession(botId: String, sessionId: String) async throws {
        guard Self.validRouteID(botId), Self.validRouteID(sessionId) else { throw APIError.badURL }
        try await send(makeRequest("POST", "/api/bots/\(botId)/remote-sessions/\(sessionId)/close", body: [:]))
    }

    /// Focus / open a temporary session for control.
    func focusBotRemoteSession(botId: String, sessionId: String) async throws {
        guard Self.validRouteID(botId), Self.validRouteID(sessionId) else { throw APIError.badURL }
        try await send(makeRequest("POST", "/api/bots/\(botId)/remote-sessions/\(sessionId)/focus", body: [:]))
    }
}
