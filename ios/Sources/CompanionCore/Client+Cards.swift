// The interactive cards' requests (feature parity package WP2): the approval
// dock's answers, the option card's dismiss, the credential card's resume and
// dismiss, and a parallel task's Stop. Each path is the one the desktop
// renderer calls and passes both gates (companion `ALLOWED`, server
// `CLIENT_ALLOW`); the server still decides who may (owner, admin) in its
// handlers.
import Foundation

extension CompanionClient {
    /// One dock answer: `always` keeps a provider's allow for its session,
    /// `rememberCommand` saves the exact command (owner or admin).
    @discardableResult
    public func respond(threadId: String, decision: ApprovalDecision) async throws -> String? {
        var body: [String: Any] = ["requestId": decision.requestId, "behavior": decision.behavior]
        if let message = decision.message { body["message"] = message }
        if let hash = decision.reviewedSha256 { body["reviewedSha256"] = hash }
        if decision.always { body["always"] = true }
        if decision.rememberCommand { body["rememberCommand"] = true }
        if let rule = decision.rule { body["rule"] = rule }
        if let stepUp = decision.stepUp { body["stepUp"] = stepUp }
        let (data, response) = try await perform(try makeRequest("POST", "/api/threads/\(threadId)/respond", body: body))
        try Self.checkStepUp(response, data)
        struct Outcome: Decodable { let outcome: String? }
        return (try? JSONDecoder().decode(Outcome.self, from: data))?.outcome
    }

    /// A first-run option card put away (`PATCH /api/bots/:id/cards/:m`).
    public func dismissCard(botId: String, messageId: String) async throws {
        try await send(try makeRequest("PATCH", "/api/bots/\(botId)/cards/\(messageId)", body: ["dismissed": true]))
    }

    /// Stop one parallel task (`POST /api/bots/:id/parallel/:t/stop`).
    public func stopParallelTask(botId: String, threadId: String) async throws {
        guard Self.validRouteID(botId), Self.validRouteID(threadId) else { throw APIError.badURL }
        try await send(try makeRequest("POST", "/api/bots/\(botId)/parallel/\(threadId)/stop", body: [:]))
    }

    /// Stop a room's running turn (the dock's "Cancel turn" in a room).
    public func cancelRoomTurn(groupId: String) async throws {
        guard Self.validRouteID(groupId) else { throw APIError.badURL }
        try await send(try makeRequest("POST", "/api/groups/\(groupId)/interrupt", body: [:]))
    }

    // MARK: Credential card

    /// The task waiting on a credential: resume it after the key was saved
    /// or declined and resuming failed ("Try again").
    public func resumeSecretCard(botId: String, messageId: String, threadId: String) async throws {
        try await send(try makeRequest(
            "POST", "/api/bots/\(botId)/secret-cards/\(messageId)/resume", body: ["threadId": threadId]
        ))
    }

    /// "Not now": continue without the credential.
    public func dismissSecretCard(botId: String, messageId: String, threadId: String) async throws {
        try await send(try makeRequest(
            "POST", "/api/bots/\(botId)/secret-cards/\(messageId)/dismiss", body: ["threadId": threadId]
        ))
    }
}
