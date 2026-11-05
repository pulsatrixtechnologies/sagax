import Foundation

// Client calls for the visual-parity screens, against routes the server
// already has. Which of them a paired phone may reach is the server's call
// (server/auth/request-auth.ts CLIENT_ALLOW for a server-paired phone,
// companion/src/routes.ts for the desktop sidecar); a refused route surfaces
// as `APIError.status` with the server's own sentence.
public extension CompanionClient {
    // MARK: Bots

    /// `DELETE /api/bots/:id`. The server lets an organization member delete
    /// only a bot they own; an admin any.
    func deleteBot(botId: String) async throws {
        try await send(deleteBotRequest(botId: botId))
    }

    /// `PATCH /api/bots/:id` with the fields set in `patch`.
    func patchBot(botId: String, patch: BotPatch) async throws -> Bot {
        try await send(patchBotRequest(botId: botId, patch: patch), as: BotResponse.self).bot
    }

    /// Pin or unpin on the home row.
    func setPinned(botId: String, pinned: Bool) async throws -> Bot {
        try await patchBot(botId: botId, patch: BotPatch(pinned: pinned))
    }

    /// `GET /api/bots/:id/soul`: the bot's standing instructions.
    func soul(botId: String) async throws -> BotSoul {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try await send(makeRequest("GET", "/api/bots/\(botId)/soul"), as: BotSoul.self)
    }

    /// `GET /api/bots/:id/command-allowlist`: the saved exact-command rules.
    func commandAllowlist(botId: String) async throws -> CommandAllowlist {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try await send(makeRequest("GET", "/api/bots/\(botId)/command-allowlist"), as: CommandAllowlist.self)
    }

    // MARK: Thread files

    /// `GET /api/threads/:id/files`: newest first.
    func threadFiles(threadId: String) async throws -> [ThreadFile] {
        guard Self.validRouteID(threadId) else { throw APIError.badURL }
        return try await send(makeRequest("GET", "/api/threads/\(threadId)/files"), as: ThreadFilesResponse.self).files
    }

    /// `POST /api/threads/:id/files/:fileId/pin`: pin or unpin a file in the
    /// Library tab. The server keeps it per conversation.
    func setThreadFilePin(threadId: String, fileId: String, pinned: Bool) async throws {
        guard Self.validRouteID(threadId), Self.validThreadFileID(fileId) else { throw APIError.badURL }
        try await send(makeRequest("POST", "/api/threads/\(threadId)/files/\(fileId)/pin", encodedBody: ThreadFilePinBody(pinned: pinned)))
    }

    // MARK: Artifacts

    /// `GET /api/bots/:id/artifacts`: the bot's artifacts the viewer may see.
    func botArtifacts(botId: String) async throws -> [BotArtifact] {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try await send(makeRequest("GET", "/api/bots/\(botId)/artifacts"), as: BotArtifactsResponse.self).artifacts
    }

    /// `GET /api/bots/:id/artifacts/:id`: the document and its last data.
    func botArtifactDocument(botId: String, artifactId: String) async throws -> BotArtifactDocument {
        guard Self.validRouteID(botId), Self.validRouteID(artifactId) else { throw APIError.badURL }
        let (data, response) = try await perform(makeRequest("GET", "/api/bots/\(botId)/artifacts/\(artifactId)"))
        try Self.check(response, data)
        guard let document = BotArtifactDocument.parse(data) else { throw APIError.transport("The artifact could not be read.") }
        return document
    }

    /// `PATCH /api/bots/:id/artifacts/:id` with `{ favorite }`: the Library's pin.
    func setBotArtifactPin(botId: String, artifactId: String, pinned: Bool) async throws {
        guard Self.validRouteID(botId), Self.validRouteID(artifactId) else { throw APIError.badURL }
        try await send(makeRequest("PATCH", "/api/bots/\(botId)/artifacts/\(artifactId)", encodedBody: ArtifactFavoriteBody(favorite: pinned)))
    }

    /// The authenticated request for one file's bytes. `preview` asks for an
    /// inline image (the server refuses it for anything else).
    func threadFileRequest(threadId: String, fileId: String, preview: Bool, thumb: Bool = false) throws -> URLRequest {
        guard Self.validRouteID(threadId), Self.validThreadFileID(fileId) else { throw APIError.badURL }
        // `thumb=1`: the server's small square PNG for a Library row (never the picture).
        return try makeRequest(
            "GET",
            "/api/threads/\(threadId)/files/\(fileId)",
            query: thumb ? [URLQueryItem(name: "thumb", value: "1")] : preview ? [URLQueryItem(name: "preview", value: "1")] : []
        )
    }

    /// A Library row's thumbnail: a 96 px square PNG the server draws under
    /// the file's own grant, so the full picture is never downloaded for it.
    func threadFileThumbData(threadId: String, fileId: String) async throws -> Data {
        let (data, response) = try await perform(threadFileRequest(threadId: threadId, fileId: fileId, preview: false, thumb: true))
        try Self.check(response, data)
        return data
    }

    /// A thumbnail's or a file's bytes.
    func threadFileData(threadId: String, fileId: String, preview: Bool = true) async throws -> Data {
        let (data, response) = try await perform(threadFileRequest(threadId: threadId, fileId: fileId, preview: preview))
        try Self.check(response, data)
        return data
    }

    // MARK: Account and settings

    /// `GET /api/auth/session`.
    func authSession() async throws -> AuthSession {
        try await send(makeRequest("GET", "/api/auth/session"), as: AuthSession.self)
    }

    /// `GET /api/usage` for the current month. `budgetPercent` is nil when
    /// the server sets no budget.
    func usage() async throws -> UsageSummary {
        try await send(makeRequest("GET", "/api/usage"), as: UsageSummary.self)
    }

    /// `GET /api/me/preferences` (organization servers).
    public func preferences() async throws -> UserPreferences {
        try await send(makeRequest("GET", "/api/me/preferences"), as: UserPreferences.self)
    }

    /// `PUT /api/me/preferences`: replaces the person's record with these keys.
    public func putPreferences(_ preferences: [String: String]) async throws -> UserPreferences {
        try await send(
            makeRequest("PUT", "/api/me/preferences", encodedBody: UserPreferencesBody(preferences: preferences)),
            as: UserPreferences.self
        )
    }

    /// `GET /api/me/server-environment`.
    func serverEnvironment() async throws -> ServerEnvironmentStatus {
        try await send(makeRequest("GET", "/api/me/server-environment"), as: ServerEnvironmentStatus.self)
    }

    /// `POST /api/me/server-environment/reset` with the required confirmation.
    /// Erases `/workspace`; callers confirm with the person first.
    func resetServerEnvironment() async throws -> ServerEnvironmentStatus {
        try await send(
            makeRequest("POST", "/api/me/server-environment/reset", encodedBody: ServerEnvironmentResetBody()),
            as: ServerEnvironmentStatus.self
        )
    }

    /// `POST /api/me/server-environment/power`. A 409 `confirm_running` returns nil.
    func powerServerEnvironment(_ action: ServerEnvironmentPowerAction, confirm: Bool = false) async throws -> ServerEnvironmentStatus? {
        do {
            return try await send(
                makeRequest("POST", "/api/me/server-environment/power",
                            encodedBody: ServerEnvironmentPowerBody(action: action.rawValue, confirm: confirm ? true : nil)),
                as: ServerEnvironmentStatus.self
            )
        } catch let APIError.status(code, _) where code == 409 {
            return nil
        }
    }

    /// `GET /api/desktop-viewer/sandbox/me` (password for noVNC).
    func sandboxViewer(control: Bool = false) async throws -> SandboxViewerConfig {
        let query = control ? [URLQueryItem(name: "control", value: "1")] : []
        return try await send(makeRequest("GET", "/api/desktop-viewer/sandbox/me", query: query), as: SandboxViewerConfig.self)
    }

    /// Native WebSocket to `/api/desktop-viewer/sandbox/me/websockify` (no Origin).
    func sandboxViewerSocketRequest(control: Bool = false) throws -> URLRequest {
        let query = control ? [URLQueryItem(name: "control", value: "1")] : []
        var request = try makeRequest("GET", "/api/desktop-viewer/sandbox/me/websockify", query: query)
        guard var components = URLComponents(url: request.url!, resolvingAgainstBaseURL: false) else { throw APIError.badURL }
        if components.scheme == "https" { components.scheme = "wss" }
        else { components.scheme = "ws" }
        request.url = components.url
        return request
    }

    /// `GET /api/mcp/servers`.
    func mcpServers() async throws -> MCPServersResponse {
        try await send(makeRequest("GET", "/api/mcp/servers"), as: MCPServersResponse.self)
    }

    // MARK: Routines

    /// One routine's run history, newest first. The server returns every
    /// run with the routines; the filter is local.
    func routineRuns(routineId: String) async throws -> [RoutineRun] {
        try await routines().runs.forRoutine(routineId)
    }

    // MARK: Request builders (tested without a network)

    func deleteBotRequest(botId: String) throws -> URLRequest {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try makeRequest("DELETE", "/api/bots/\(botId)")
    }

    func patchBotRequest(botId: String, patch: BotPatch) throws -> URLRequest {
        guard Self.validRouteID(botId), !patch.isEmpty else { throw APIError.badURL }
        return try makeRequest("PATCH", "/api/bots/\(botId)", encodedBody: patch)
    }
}

extension CompanionClient {
    /// The server's file ids are 24 lowercase hex characters.
    static func validThreadFileID(_ value: String) -> Bool {
        value.utf8.count == 24 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
}
