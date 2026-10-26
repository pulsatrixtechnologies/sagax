import Foundation

// Client calls for the Settings sheet, Account, Bot Computer and Plugins
// (iOS parity 12, 14, 15, 16, 21). Routes and payloads:
// docs/ios-companion.md "Visual parity routes". Which of them a paired phone
// may reach is the server's call; a refusal surfaces as `APIError.status`
// with the server's own sentence.
public extension CompanionClient {
    // MARK: Account

    /// `GET /api/auth/session`, read for the account card.
    func accountIdentity() async throws -> AccountIdentity {
        try await send(makeRequest("GET", "/api/auth/session"), as: AccountIdentity.self)
    }

    /// `DELETE /api/me` with the confirmation. A personal computer answers
    /// 400 `personal_server`; an organization server whose Perspicax cannot
    /// delete accounts yet answers 501 `perspicax_deletion_unavailable`; one
    /// that needs the person to sign in again first (2026-10-18) answers 409
    /// `reauth_required`: `beginAccountReauth()`, the sheet, then again.
    func deleteAccount() async throws -> AccountDeletionOutcome {
        let (data, response) = try await perform(deleteAccountRequest())
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            let body = try? JSONDecoder().decode(APIErrorWithCode.self, from: data)
            switch (http.statusCode, body?.code) {
            case (400, "personal_server"): return .personalServer
            case (501, _), (_, "perspicax_deletion_unavailable"): return .unavailable(body?.error)
            case (409, "reauth_required"): return .reauthRequired(body?.error)
            default: throw APIError.status(code: http.statusCode, message: body?.error)
            }
        }
        return .deleted
    }

    /// `POST /api/me/reauth` `{ "client": "phone" }` (2026-10-18): the
    /// address the authentication sheet opens so the person signs in again
    /// at Perspicax right before deleting their account. Only that one path,
    /// on https or on this connection's own host.
    func beginAccountReauth() async throws -> URL {
        struct Started: Decodable { var url: String? }
        let started = try await send(accountReauthRequest(), as: Started.self)
        guard let url = started.url.flatMap(URL.init(string:)), Self.isAccountReauthURL(url, base: connection.baseURL) else {
            throw APIError.transport("The server did not start the sign-in again.")
        }
        return url
    }

    /// The start the server may hand out: its sign-in again path, on https,
    /// or on the paired address itself.
    static func isAccountReauthURL(_ url: URL, base: URL?) -> Bool {
        guard url.path == "/auth/oidc/reauth", url.user == nil, url.password == nil, url.fragment == nil else { return false }
        if url.scheme == "https" { return true }
        return url.scheme == "http" && base?.scheme == "http" && url.host == base?.host && url.port == base?.port
    }

    /// Whether the sheet's return address says the person signed in again
    /// (`sagax://account-reauth?status=ok`), or the refusal code.
    static func accountReauthOutcome(_ callback: URL?) -> AccountReauthOutcome {
        guard let callback, callback.scheme == "sagax", callback.host == "account-reauth",
              let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems
        else { return .failed(nil) }
        if items.first(where: { $0.name == "status" })?.value == "ok" { return .signedIn }
        return .failed(items.first(where: { $0.name == "error" })?.value)
    }

    // MARK: Bot settings

    /// `GET /api/settings/bot`.
    func botSettings() async throws -> BotSettingsResponse {
        try await send(makeRequest("GET", "/api/settings/bot"), as: BotSettingsResponse.self)
    }

    /// `PUT /api/settings/bot` with only the fields set.
    func updateBotSettings(_ patch: BotSettingsPatch) async throws -> BotSettingsResponse {
        try await send(updateBotSettingsRequest(patch), as: BotSettingsResponse.self)
    }

    /// `GET /api/auto-review/rules`.
    func autoReviewRules() async throws -> AutoReviewRules {
        try await send(makeRequest("GET", "/api/auto-review/rules"), as: AutoReviewRules.self)
    }

    /// `DELETE /api/auto-review/rules/:id`: the list without that rule.
    func deleteAutoReviewRule(id: String) async throws -> AutoReviewRules {
        try await send(deleteAutoReviewRuleRequest(id: id), as: AutoReviewRules.self)
    }

    // MARK: Bot computer

    /// `GET /api/computer/status`.
    func computerStatus() async throws -> ComputerStatus {
        try await send(makeRequest("GET", "/api/computer/status"), as: ComputerStatus.self)
    }

    /// `POST /api/computer/update`: rebuilds from the latest image, keeps files.
    func updateComputer() async throws -> ComputerStatus {
        try await send(makeRequest("POST", "/api/computer/update", encodedBody: EmptyJSONBody()), as: ComputerStatus.self)
    }

    /// `POST /api/computer/reset` with the required confirmation.
    func resetComputer() async throws -> ComputerStatus {
        try await send(makeRequest("POST", "/api/computer/reset", encodedBody: ConfirmBody()), as: ComputerStatus.self)
    }

    // MARK: Plugins

    /// `GET /api/plugins/search?q=&cursor=`.
    func searchPlugins(query: String = "", cursor: String? = nil) async throws -> PluginSearchPage {
        try await send(searchPluginsRequest(query: query, cursor: cursor), as: PluginSearchPage.self)
    }

    /// `GET /api/plugins/installed`.
    func installedPlugins() async throws -> InstalledPlugins {
        try await send(makeRequest("GET", "/api/plugins/installed"), as: InstalledPlugins.self)
    }

    /// `POST /api/plugins/install`. With a sign-in to run, the answer carries
    /// the authorization URL for `returnTo`.
    func installPlugin(id: String, trust: Bool = false, returnTo: String? = PluginSignIn.returnTo) async throws -> PluginInstallResult {
        try await send(installPluginRequest(id: id, trust: trust, returnTo: returnTo), as: PluginInstallResult.self)
    }

    /// `POST /api/mcp/servers/:name/oauth/start` for a server already added.
    func startPluginSignIn(serverName: String) async throws -> URL {
        struct Started: Decodable { var authorizationUrl: String? }
        let started = try await send(startPluginSignInRequest(serverName: serverName), as: Started.self)
        guard let url = started.authorizationUrl.flatMap(URL.init(string:)) else { throw APIError.transport("The server did not start a sign-in.") }
        return url
    }

    // MARK: Request builders (tested without a network)

    func deleteAccountRequest() throws -> URLRequest {
        try makeRequest("DELETE", "/api/me", encodedBody: ConfirmBody())
    }

    func accountReauthRequest() throws -> URLRequest {
        try makeRequest("POST", "/api/me/reauth", encodedBody: AccountReauthBody())
    }

    func updateBotSettingsRequest(_ patch: BotSettingsPatch) throws -> URLRequest {
        guard !patch.isEmpty else { throw APIError.badURL }
        return try makeRequest("PUT", "/api/settings/bot", encodedBody: patch)
    }

    func deleteAutoReviewRuleRequest(id: String) throws -> URLRequest {
        // `cmd.<botId>.<ruleId>`: word characters, dashes and dots only.
        guard !id.isEmpty, id.count <= 300,
              id.unicodeScalars.allSatisfy({ CharacterSet.alphanumerics.contains($0) || "._-".unicodeScalars.contains($0) })
        else { throw APIError.badURL }
        return try makeRequest("DELETE", "/api/auto-review/rules/\(id)")
    }

    func searchPluginsRequest(query: String, cursor: String?) throws -> URLRequest {
        var items: [URLQueryItem] = []
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { items.append(URLQueryItem(name: "q", value: String(trimmed.prefix(100)))) }
        if let cursor, !cursor.isEmpty { items.append(URLQueryItem(name: "cursor", value: cursor)) }
        return try makeRequest("GET", "/api/plugins/search", query: items)
    }

    func installPluginRequest(id: String, trust: Bool, returnTo: String?) throws -> URLRequest {
        guard !id.isEmpty, id.count <= 300 else { throw APIError.badURL }
        let origin = returnTo == nil ? nil : PluginSignIn.callbackOrigin(for: connection)
        return try makeRequest("POST", "/api/plugins/install", encodedBody: PluginInstallBody(
            id: id, trust: trust ? true : nil, returnTo: returnTo, callbackOrigin: origin
        ))
    }

    func startPluginSignInRequest(serverName: String) throws -> URLRequest {
        guard Self.validRouteID(serverName) else { throw APIError.badURL }
        return try makeRequest("POST", "/api/mcp/servers/\(serverName)/oauth/start", encodedBody: OAuthStartBody(
            returnTo: PluginSignIn.returnTo, callbackOrigin: PluginSignIn.callbackOrigin(for: connection)
        ))
    }

    // MARK: Approval rules and allowed recipients

    /// `GET /api/custom-rules?botId=`.
    func customRules(botId: String) async throws -> CustomRuleList {
        let (data, response) = try await perform(try customRulesRequest(botId: botId))
        try Self.finishGrant(response, data, recipients: false)
        return try JSONDecoder().decode(CustomRuleList.self, from: data)
    }

    /// `POST /api/custom-rules`. `botId` nil is every bot this person owns.
    func createCustomRule(when: String, behavior: CustomRuleBehavior, botId: String?, riskScope: [CustomRuleRisk], stepUp: String? = nil) async throws {
        let (data, response) = try await perform(try createCustomRuleRequest(when: when, behavior: behavior, botId: botId, riskScope: riskScope, stepUp: stepUp))
        try Self.finishGrant(response, data, recipients: false)
    }

    /// `PATCH /api/custom-rules/:id` with the fields the form saves.
    func saveCustomRule(id: String, when: String, behavior: CustomRuleBehavior, allBots: Bool, botId: String, riskScope: [CustomRuleRisk], stepUp: String? = nil) async throws {
        let (data, response) = try await perform(try saveCustomRuleRequest(id: id, when: when, behavior: behavior, allBots: allBots, botId: botId, riskScope: riskScope, stepUp: stepUp))
        try Self.finishGrant(response, data, recipients: false)
    }

    /// `PATCH /api/custom-rules/:id` `{enabled}`.
    func setCustomRuleEnabled(id: String, enabled: Bool, stepUp: String? = nil) async throws {
        let (data, response) = try await perform(try setCustomRuleEnabledRequest(id: id, enabled: enabled, stepUp: stepUp))
        try Self.finishGrant(response, data, recipients: false)
    }

    /// `DELETE /api/custom-rules/:id`.
    func deleteCustomRule(id: String, stepUp: String? = nil) async throws {
        let (data, response) = try await perform(try deleteCustomRuleRequest(id: id, stepUp: stepUp))
        try Self.finishGrant(response, data, recipients: false)
    }

    /// `PATCH /api/bots/:id` `{allowedRecipients}`. Adding someone is a
    /// standing grant: the server may ask for the person's key.
    func patchAllowedRecipients(botId: String, recipients: [String], stepUp: String? = nil) async throws -> Bot {
        let (data, response) = try await perform(try patchAllowedRecipientsRequest(botId: botId, recipients: recipients, stepUp: stepUp))
        try Self.finishGrant(response, data, recipients: true)
        do {
            return try JSONDecoder().decode(BotResponse.self, from: data).bot
        } catch {
            throw APIError.transport("The computer sent something this app couldn't read.")
        }
    }

    func customRulesRequest(botId: String) throws -> URLRequest {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try makeRequest("GET", "/api/custom-rules", query: [URLQueryItem(name: "botId", value: botId)])
    }

    func createCustomRuleRequest(when: String, behavior: CustomRuleBehavior, botId: String?, riskScope: [CustomRuleRisk], stepUp: String?) throws -> URLRequest {
        let trimmed = when.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= CustomRuleEditor.maximumText else { throw APIError.badURL }
        if let botId { guard Self.validRouteID(botId) else { throw APIError.badURL } }
        var body: [String: Any] = [
            "when": trimmed,
            "behavior": behavior.rawValue,
            "botId": botId ?? NSNull(),
            "riskScope": (behavior == .allow ? riskScope : []).map(\.rawValue),
        ]
        if let stepUp, !stepUp.isEmpty { body["stepUp"] = stepUp }
        return try makeRequest("POST", "/api/custom-rules", body: body)
    }

    func saveCustomRuleRequest(id: String, when: String, behavior: CustomRuleBehavior, allBots: Bool, botId: String, riskScope: [CustomRuleRisk], stepUp: String?) throws -> URLRequest {
        guard Self.validRouteID(id), Self.validRouteID(botId) else { throw APIError.badURL }
        let trimmed = when.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= CustomRuleEditor.maximumText else { throw APIError.badURL }
        var body: [String: Any] = [
            "when": trimmed,
            "behavior": behavior.rawValue,
            "botId": allBots ? NSNull() : botId,
            "riskScope": (behavior == .allow ? riskScope : []).map(\.rawValue),
        ]
        if let stepUp, !stepUp.isEmpty { body["stepUp"] = stepUp }
        return try makeRequest("PATCH", "/api/custom-rules/\(id)", body: body)
    }

    func setCustomRuleEnabledRequest(id: String, enabled: Bool, stepUp: String?) throws -> URLRequest {
        guard Self.validRouteID(id) else { throw APIError.badURL }
        var body: [String: Any] = ["enabled": enabled]
        if let stepUp, !stepUp.isEmpty { body["stepUp"] = stepUp }
        return try makeRequest("PATCH", "/api/custom-rules/\(id)", body: body)
    }

    func deleteCustomRuleRequest(id: String, stepUp: String?) throws -> URLRequest {
        guard Self.validRouteID(id) else { throw APIError.badURL }
        if let stepUp, !stepUp.isEmpty {
            return try makeRequest("DELETE", "/api/custom-rules/\(id)", body: ["stepUp": stepUp])
        }
        return try makeRequest("DELETE", "/api/custom-rules/\(id)")
    }

    func patchAllowedRecipientsRequest(botId: String, recipients: [String], stepUp: String?) throws -> URLRequest {
        guard Self.validRouteID(botId), let normalized = AllowedRecipients.normalize(recipients) else { throw APIError.badURL }
        var body: [String: Any] = ["allowedRecipients": normalized]
        if let stepUp, !stepUp.isEmpty { body["stepUp"] = stepUp }
        return try makeRequest("PATCH", "/api/bots/\(botId)", body: body)
    }

    /// A step-up refusal stays `StepUpRequired`. Any other refusal keeps the
    /// server's `code`, so the screen can say the desktop's sentence.
    static func finishGrant(_ response: URLResponse, _ data: Data, recipients: Bool) throws {
        do {
            try checkStepUp(response, data)
        } catch let refusal as StepUpRequired {
            throw refusal
        } catch {
            let body = try? JSONDecoder().decode(GrantErrorBody.self, from: data)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            throw ApprovalGrantError.status(code: status, apiCode: body?.code, message: body?.error, recipients: recipients)
        }
    }
}

private struct GrantErrorBody: Decodable {
    var code: String?
    var error: String?
}
