// /api/messages on the solo Mac (Connect apps > Mac > Messages).
import Foundation

extension CompanionClient {
    /// `GET /api/messages`: setup status and live permission checks.
    /// A 404 (org server, non-Mac, or old host) becomes an unavailable status.
    public func messagesSetup() async throws -> MessagesSetupStatus {
        do {
            return try await send(makeRequest("GET", "/api/messages"), as: MessagesSetupStatus.self)
        } catch let APIError.status(code, _) where code == 404 {
            return MessagesSetupStatus(
                available: false,
                onThisMac: false,
                reason: .organizationServer,
                useMessages: false,
                permissions: MessagesSetupPermissions(fullDiskAccess: .unsupported, automation: .unsupported)
            )
        }
    }

    /// `PUT /api/messages` `{ useMessages }`. Off until the person turns it on.
    @discardableResult
    public func setMessagesEnabled(_ useMessages: Bool) async throws -> MessagesSetupStatus {
        struct Body: Encodable { var useMessages: Bool }
        return try await send(
            makeRequest("PUT", "/api/messages", encodedBody: Body(useMessages: useMessages)),
            as: MessagesSetupStatus.self
        )
    }

    /// `POST /api/messages/test`: conversation name count only (never bodies).
    public func testMessagesSetup() async throws -> MessagesSetupTestResult {
        try await send(
            makeRequest("POST", "/api/messages/test", encodedBody: EmptyJSONBody()),
            as: MessagesSetupTestResult.self
        )
    }

    /// `POST /api/messages/permissions/open` `{ pane }`. Opens System Settings on the Mac host.
    @discardableResult
    public func openMessagesPermissionPane(_ pane: MessagesPrivacyPane) async throws -> Bool {
        struct Body: Encodable { var pane: String }
        struct Answer: Decodable { var opened: Bool? }
        let answer = try await send(
            makeRequest("POST", "/api/messages/permissions/open", encodedBody: Body(pane: pane.rawValue)),
            as: Answer.self
        )
        return answer.opened == true
    }
}
