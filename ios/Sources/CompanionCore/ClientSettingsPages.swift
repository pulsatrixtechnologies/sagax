// iPad lot 2b (2026-11-03): the routes the desktop's Settings pages read
// that the iPad had no call for. Settings > Security (security-keys
// classes, the person's approval rules, their tool access) and Settings >
// Import (preference lines for the primary bot).
import Foundation

/// One of the person's saved Always allow / Always deny rules
/// (`GET /api/approval-rules`, OwnerRuleRow).
public struct OwnerApprovalRule: Decodable, Equatable, Identifiable, Sendable {
    public var id: String
    public var botId: String?
    public var tool: String
    public var behavior: String
    public var description: String
    public var botName: String?
}

/// Access the person gave themselves beyond the defaults (`GET /api/me/tool-grants`).
public struct OwnToolGrant: Decodable, Equatable, Identifiable, Sendable {
    public var id: String
    public var scope: String
    public var state: String
    /// Milliseconds since 1970.
    public var expiresAt: Double?
}

/// One line of a preference import's preview (`POST /api/me/preference-import/preview`).
public struct PreferenceImportLine: Decodable, Equatable, Identifiable, Sendable {
    public var id: String
    public var text: String
    /// "add", "same" or "conflict".
    public var kind: String
    public var existing: String?
}

/// `STEP_UP_CLASSES` (shared/step-up.ts), in the desktop's order.
public enum StepUpClass: String, CaseIterable, Sendable {
    case destructive, irreversible, money
    case externalSend = "external-send"
    case alwaysGrant = "always-grant"
    case publishPage = "publish-page"
    case ruleChange = "rule-change"
}

public extension CompanionClient {
    func approvalRules() async throws -> [OwnerApprovalRule] {
        struct Body: Decodable { var rules: [OwnerApprovalRule] }
        return try await send(makeRequest("GET", "/api/approval-rules"), as: Body.self).rules
    }

    func deleteApprovalRule(id: String) async throws {
        try await send(makeRequest("DELETE", "/api/approval-rules/\(id)"))
    }

    func ownToolGrants() async throws -> [OwnToolGrant] {
        struct Body: Decodable { var grants: [OwnToolGrant] }
        return try await send(makeRequest("GET", "/api/me/tool-grants"), as: Body.self).grants
    }

    func revokeOwnToolGrant(id: String) async throws {
        try await send(makeRequest("POST", "/api/me/tool-grants/\(id)/revoke", body: [:]))
    }

    /// `PUT /api/security-keys/classes`: the approvals that ask for a key.
    func setSecurityKeyClasses(_ classes: [String]) async throws -> SecurityKeysList {
        try await send(makeRequest("PUT", "/api/security-keys/classes", body: ["classes": classes]), as: SecurityKeysList.self)
    }

    func previewPreferenceImport(botId: String, text: String) async throws -> [PreferenceImportLine] {
        struct Body: Decodable { var lines: [PreferenceImportLine] }
        return try await send(makeRequest("POST", "/api/me/preference-import/preview", body: ["botId": botId, "text": text]), as: Body.self).lines
    }

    func applyPreferenceImport(botId: String, text: String, accept: [String]) async throws {
        try await send(makeRequest("POST", "/api/me/preference-import/apply", body: ["botId": botId, "text": text, "accept": accept]))
    }
}
