import Foundation

/// The answer of a path shown once. `code` is `exists` when saving would
/// replace a skill and the person has not agreed.
public struct ShownPathAnswer: Decodable, Sendable {
    public var ok: Bool?
    public var code: String?
    public var name: String?
    public var markdown: String?
    public var exists: Bool?
    public var refused: Bool?
    public var installed: String?
    public var replaced: Bool?
}

// The advanced bot panel's calls (WP16), the same requests the desktop's
// bot settings sections make. Which pairing may reach which is the
// sidecar's (`ALLOWED`, D1) and the server's (`CLIENT_ALLOW`) call; the app
// asks `SurfaceGate` first so it never offers a request that can only fail.
public extension CompanionClient {
    // MARK: Prompt preview and history

    /// `GET /api/bots/:id/system-prompt`.
    func systemPrompt(botId: String) async throws -> PromptPreview {
        try await send(botRequest("GET", botId, "/system-prompt"), as: PromptPreview.self)
    }

    /// `GET /api/bots/:id/history?limit=100`.
    func botHistory(botId: String, limit: Int = 100) async throws -> BotHistory {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try await send(
            makeRequest("GET", "/api/bots/\(botId)/history", query: [URLQueryItem(name: "limit", value: String(limit))]),
            as: BotHistory.self
        )
    }

    /// `POST /api/bots/:id/history/rollback {id, expectedRevision}`: puts
    /// back the instructions from before that change.
    func rollbackHistory(botId: String, rowId: String, expectedRevision: String) async throws {
        try await send(rollbackHistoryRequest(botId: botId, rowId: rowId, expectedRevision: expectedRevision))
    }

    func rollbackHistoryRequest(botId: String, rowId: String, expectedRevision: String) throws -> URLRequest {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try makeRequest("POST", "/api/bots/\(botId)/history/rollback",
                               encodedBody: HistoryRollbackBody(id: rowId, expectedRevision: expectedRevision))
    }

    // MARK: Skills

    /// `GET /api/bots/:id/skills`.
    func botSkills(botId: String) async throws -> BotSkills {
        try await send(botRequest("GET", botId, "/skills"), as: BotSkills.self)
    }

    /// `GET /api/bots/:id/skills/:name`: the SKILL.md text.
    func skillText(botId: String, name: String) async throws -> String? {
        try await send(skillRequest("GET", botId: botId, name: name), as: SkillText.self).text
    }

    /// `GET /api/bots/:id/skills/:name` as the person-UI editor payload.
    func skillEditor(botId: String, name: String) async throws -> SkillEditorPayload {
        try await send(skillRequest("GET", botId: botId, name: name), as: SkillEditorPayload.self)
    }

    /// `PUT /api/bots/:id/skills/:name`: person Save (re-signs the reviewed hash).
    func saveSkill(botId: String, name: String, newName: String, description: String, instructions: String) async throws {
        var request = try skillRequest("PUT", botId: botId, name: name)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "name": newName, "description": description, "instructions": instructions,
        ])
        try await send(request)
    }

    /// `POST /api/bots/:id/skills/:name/review {action}`: Accept or Revert.
    func reviewSkill(botId: String, name: String, action: String) async throws {
        guard Self.validRouteID(botId), SkillRules.validName(name) else { throw APIError.badURL }
        try await send(makeRequest("POST", "/api/bots/\(botId)/skills/\(name)/review", body: ["action": action]))
    }

    /// `PATCH /api/bots/:id/skills/:name {enabled}`.
    func setSkillEnabled(botId: String, name: String, enabled: Bool) async throws {
        var request = try skillRequest("PATCH", botId: botId, name: name)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["enabled": enabled])
        try await send(request)
    }

    /// `DELETE /api/bots/:id/skills/:name`.
    func removeSkill(botId: String, name: String) async throws {
        try await send(skillRequest("DELETE", botId: botId, name: name))
    }

    /// A path shown once. `refuse` writes nothing. `save` adds a disabled
    /// skill. `replace` replaces only that name, after the person agreed.
    func postShownPath(botId: String, mode: String, title: String, detail: String, lines: [String], replace: Bool) async throws -> ShownPathAnswer {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        let steps = lines.enumerated().map { index, line in ["id": "\(index + 1)", "kind": "note", "text": line] }
        var body: [String: Any] = ["mode": mode, "title": title, "description": detail, "steps": steps]
        if replace { body["replace"] = true }
        return try await send(makeRequest("POST", "/api/bots/\(botId)/shown-path", body: body), as: ShownPathAnswer.self)
    }

    /// `POST /api/bots/:id/skills {source}`: imported skills land disabled.
    /// Answers how many were installed.
    func importSkill(botId: String, source: String) async throws -> Int {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try await send(makeRequest("POST", "/api/bots/\(botId)/skills", body: ["source": source]), as: SkillImportResult.self).installed
    }

    func skillRequest(_ method: String, botId: String, name: String) throws -> URLRequest {
        guard Self.validRouteID(botId), SkillRules.validName(name) else { throw APIError.badURL }
        return try makeRequest(method, "/api/bots/\(botId)/skills/\(name)")
    }

    /// `GET /api/org-library/skills?botId=`: what the organization's packages offer.
    func orgOfferedSkills(botId: String) async throws -> OrgSkillsOffer {
        try await send(
            makeRequest("GET", "/api/org-library/skills", query: [URLQueryItem(name: "botId", value: botId)]),
            as: OrgSkillsOffer.self
        )
    }

    /// `POST /api/org-library/skills {botId, installId, name}`: puts it on
    /// this bot, switched on.
    func addOrgSkill(botId: String, skill: OfferedOrgSkill) async throws {
        try await send(makeRequest("POST", "/api/org-library/skills", body: [
            "botId": botId, "installId": skill.installId, "name": skill.name,
        ]))
    }

    // MARK: Memory

    /// `GET /api/bots/:id/memory`.
    func memoryOverview(botId: String) async throws -> MemoryOverview {
        try await send(botRequest("GET", botId, "/memory"), as: MemoryOverview.self)
    }

    /// `GET /api/bots/:id/memory/file?path=`.
    func memoryDoc(botId: String, path: String) async throws -> MemoryDoc {
        try await send(memoryFileRequest("GET", botId: botId, path: path), as: MemoryDoc.self)
    }

    /// `PUT /api/bots/:id/memory/file {path, text, expectedHash}`. A 409 with
    /// the file as it is now is the conflict the editor shows.
    func saveMemoryDoc(botId: String, path: String, text: String, expectedHash: String?) async throws -> MemorySaveResult {
        let (data, response) = try await perform(saveMemoryDocRequest(botId: botId, path: path, text: text, expectedHash: expectedHash))
        if (response as? HTTPURLResponse)?.statusCode == 409,
           let conflict = try? JSONDecoder().decode(MemoryConflictBody.self, from: data) {
            return .conflict(current: conflict.current, currentHash: conflict.currentHash)
        }
        try Self.check(response, data)
        let saved = try JSONDecoder().decode(MemoryDocAndOverview.self, from: data)
        return .saved(saved.doc, saved.overview)
    }

    func saveMemoryDocRequest(botId: String, path: String, text: String, expectedHash: String?) throws -> URLRequest {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try makeRequest("PUT", "/api/bots/\(botId)/memory/file",
                               encodedBody: MemorySaveBody(path: path, text: text, expectedHash: expectedHash))
    }

    /// `DELETE /api/bots/:id/memory/file?path=`: the journal can bring it back.
    func deleteMemoryDoc(botId: String, path: String) async throws -> MemoryOverview {
        try await send(memoryFileRequest("DELETE", botId: botId, path: path), as: MemoryOverviewEnvelope.self).overview
    }

    func memoryFileRequest(_ method: String, botId: String, path: String) throws -> URLRequest {
        guard Self.validRouteID(botId), !path.isEmpty else { throw APIError.badURL }
        return try makeRequest(method, "/api/bots/\(botId)/memory/file", query: [URLQueryItem(name: "path", value: path)])
    }

    /// `GET /api/bots/:id/memory/journal?limit=50`.
    func memoryJournal(botId: String, limit: Int = 50) async throws -> [MemoryJournalRow] {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try await send(
            makeRequest("GET", "/api/bots/\(botId)/memory/journal", query: [URLQueryItem(name: "limit", value: String(limit))]),
            as: MemoryJournalEnvelope.self
        ).entries
    }

    /// `POST /api/bots/:id/memory/journal/:entry/revert`.
    func revertMemoryChange(botId: String, entryId: String) async throws -> MemoryDocAndOverview {
        guard Self.validRouteID(botId), Self.validRouteID(entryId) else { throw APIError.badURL }
        return try await send(makeRequest("POST", "/api/bots/\(botId)/memory/journal/\(entryId)/revert"), as: MemoryDocAndOverview.self)
    }

    /// `GET /api/bots/:id/memory/upkeep`.
    func memoryUpkeep(botId: String) async throws -> MemoryUpkeepStatus {
        try await send(botRequest("GET", botId, "/memory/upkeep"), as: MemoryUpkeepStatus.self)
    }

    /// `POST /api/bots/:id/memory/tidy`.
    func tidyMemory(botId: String) async throws -> MemoryTidyResult {
        try await send(botRequest("POST", botId, "/memory/tidy"), as: MemoryTidyResult.self)
    }

    /// `POST /api/bots/:id/memory/reviewed {token}` (an OMB Cloud home):
    /// the owner accepts the memory as shown; 409 when it changed since.
    func markMemoryReviewed(botId: String, token: String) async throws {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        try await send(makeRequest("POST", "/api/bots/\(botId)/memory/reviewed", body: ["token": token]))
    }

    // MARK: Bot fields (memory switches, access, visibility)

    /// `PATCH /api/bots/:id` with the access and memory fields set in `patch`.
    func patchBotAccess(botId: String, patch: BotAccessPatch) async throws -> Bot {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try await send(makeRequest("PATCH", "/api/bots/\(botId)", encodedBody: patch), as: BotResponse.self).bot
    }

    /// `PATCH /api/bots/:id/runtime-settings {turnPayer}` (#1137): who pays
    /// for the bot's replies, "owner" or "speaker"; nil goes back to the
    /// default. The server's bot frame follows.
    func setBotTurnPayer(botId: String, turnPayer: String?) async throws {
        try await send(setBotTurnPayerRequest(botId: botId, turnPayer: turnPayer))
    }

    func setBotTurnPayerRequest(botId: String, turnPayer: String?) throws -> URLRequest {
        guard Self.validRouteID(botId), turnPayer == nil || turnPayer == "owner" || turnPayer == "speaker" else { throw APIError.badURL }
        return try makeRequest("PATCH", "/api/bots/\(botId)/runtime-settings", body: ["turnPayer": turnPayer.map { $0 as Any } ?? NSNull()])
    }

    /// `PATCH /api/bots/:id {mcpServers: null}`: back to every enabled server.
    func clearBotMcpServers(botId: String) async throws -> Bot {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try await send(makeRequest("PATCH", "/api/bots/\(botId)", body: ["mcpServers": NSNull()]), as: BotResponse.self).bot
    }

    /// `PATCH /api/bots/:id {visibility}`.
    func setVisibility(botId: String, visibility: BotVisibility) async throws -> Bot {
        try await send(setVisibilityRequest(botId: botId, visibility: visibility), as: BotResponse.self).bot
    }

    func setVisibilityRequest(botId: String, visibility: BotVisibility) throws -> URLRequest {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try makeRequest("PATCH", "/api/bots/\(botId)", encodedBody: VisibilityPatchBody(visibility: visibility))
    }

    /// `PATCH /api/groups/:id {resetAudience: true}`: an admin widens a room
    /// to what its bots allow.
    func resetRoomAudience(groupId: String) async throws {
        guard Self.validRouteID(groupId) else { throw APIError.badURL }
        try await send(makeRequest("PATCH", "/api/groups/\(groupId)", body: ["resetAudience": true]))
    }

    // MARK: Sharing and Perspicax

    /// `GET /api/bots/:id/grants`.
    func botGrants(botId: String) async throws -> BotGrants {
        try await send(botRequest("GET", botId, "/grants"), as: BotGrants.self)
    }

    /// `PUT /api/bots/:id/grants {target, level}`: add or change one.
    func putGrant(botId: String, target: String, level: GrantLevel) async throws -> BotGrants {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try await send(
            makeRequest("PUT", "/api/bots/\(botId)/grants", encodedBody: GrantPutBody(target: target, level: level)),
            as: BotGrants.self
        )
    }

    /// `DELETE /api/bots/:id/grants/:target`.
    func removeGrant(botId: String, target: String) async throws -> BotGrants {
        try await send(removeGrantRequest(botId: botId, target: target), as: BotGrants.self)
    }

    func removeGrantRequest(botId: String, target: String) throws -> URLRequest {
        guard Self.validRouteID(botId), !target.isEmpty,
              let escaped = target.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-_")))
        else { throw APIError.badURL }
        var request = try makeRequest("DELETE", "/api/bots/\(botId)/grants/x")
        // URLComponents would re-escape the percent; set the encoded path as is.
        guard let url = request.url, var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { throw APIError.badURL }
        components.percentEncodedPath = "/api/bots/\(botId)/grants/\(escaped)"
        request.url = components.url
        return request
    }

    /// `GET /api/org/directory`, with its teams.
    func orgShareDirectory() async throws -> OrgShareDirectory {
        try await send(makeRequest("GET", "/api/org/directory"), as: OrgShareDirectory.self)
    }

    /// `GET /api/bots/:id/slack-management`: the Admin link, or nil when
    /// none is offered (or the read fails: there is nothing to offer then).
    func slackManagementURL(botId: String) async -> URL? {
        guard let answer = try? await send(botRequest("GET", botId, "/slack-management"), as: SlackManagementAnswer.self) else { return nil }
        return SlackRules.managementURL(available: answer.available, managementUrl: answer.managementUrl)
    }

    /// `GET /api/bots/:id/inbound-mail`: the bot's own email address row,
    /// or nil when there is none to show (or the read fails).
    func botInboundMail(botId: String) async -> BotInboundMailRow? {
        guard let answer = try? await send(botRequest("GET", botId, "/inbound-mail"), as: BotInboundMail.self) else { return nil }
        return BotInboundMailRules.row(answer)
    }

    // MARK: Command allowlist

    /// `GET /api/bots/:id/command-allowlist?threadId=`: the rules and the
    /// open thread's provider and folder (the add form's context).
    func commandAllowlist(botId: String, threadId: String?) async throws -> CommandAllowlist {
        try await send(commandAllowlistRequest("GET", botId: botId, ruleId: nil, threadId: threadId), as: CommandAllowlist.self)
    }

    /// `DELETE /api/bots/:id/command-allowlist/:rule`: the list after.
    func removeCommandRule(botId: String, ruleId: String, threadId: String? = nil) async throws -> CommandAllowlist {
        try await send(commandAllowlistRequest("DELETE", botId: botId, ruleId: ruleId, threadId: threadId), as: CommandAllowlist.self)
    }

    /// `POST /api/bots/:id/command-allowlist {command, cwd, providerInstanceId}`.
    func addCommandRule(botId: String, command: String, cwd: String, providerInstanceId: String, threadId: String? = nil) async throws -> CommandAllowlist {
        var request = try commandAllowlistRequest("POST", botId: botId, ruleId: nil, threadId: threadId)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(CommandAllowAddBody(
            command: command, cwd: cwd.trimmingCharacters(in: .whitespacesAndNewlines), providerInstanceId: providerInstanceId))
        return try await send(request, as: CommandAllowlist.self)
    }

    func commandAllowlistRequest(_ method: String, botId: String, ruleId: String?, threadId: String?) throws -> URLRequest {
        guard Self.validRouteID(botId), ruleId.map(Self.validRouteID) ?? true, threadId.map(Self.validRouteID) ?? true else { throw APIError.badURL }
        return try makeRequest(
            method,
            "/api/bots/\(botId)/command-allowlist" + (ruleId.map { "/\($0)" } ?? ""),
            query: threadId.map { [URLQueryItem(name: "threadId", value: $0)] } ?? []
        )
    }

    // MARK: Duplicate

    /// The desktop's Duplicate: `POST /api/bots` (with the source's
    /// visibility when it is restricted), then `PATCH /api/bots/:id` with
    /// the copied profile. Answers the copy.
    func duplicateBot(_ source: Bot, soul: String?, computerFields: Bool, carryVisibility: Bool) async throws -> Bot {
        let visibility = carryVisibility && source.visibility?.restricted == true ? source.visibility : nil
        let created = try await send(makeRequest("POST", "/api/bots", encodedBody: DuplicateCreateBody(visibility: visibility)), as: BotResponse.self)
        guard Self.validRouteID(created.bot.id) else { throw APIError.badURL }
        let patch = BotDuplicatePatch(source: source, soul: soul, computerFields: computerFields)
        return try await send(makeRequest("PATCH", "/api/bots/\(created.bot.id)", encodedBody: patch), as: BotResponse.self).bot
    }

    // MARK: Helpers

    internal func botRequest(_ method: String, _ botId: String, _ suffix: String) throws -> URLRequest {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try makeRequest(method, "/api/bots/\(botId)\(suffix)")
    }
}
