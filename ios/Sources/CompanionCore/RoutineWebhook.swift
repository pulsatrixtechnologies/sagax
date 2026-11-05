// A webhook routine's own webhook, where the routine is (2026-10-29): its
// status and deliveries, the address a sender posts to, the key and the
// Authorization header, masked until the owner shows them, a curl example,
// and Regenerate. Desktop: src/components/routines/RoutineWebhookPanel.tsx.
//
// The key is never stored: it comes back from a reveal (a key made at server
// start, handed over once) or a rotation (a new key, the old one stops at
// once) and lives in the screen's memory only.
import Foundation

public enum RoutineWebhook {
    /// The routine's webhook (`routineId` on the trigger), nil when it has none.
    public static func webhook(for routineId: String?, in webhooks: [WebhookListing]) -> WebhookListing? {
        guard let routineId, !routineId.isEmpty else { return nil }
        return webhooks.first { $0.routineId == routineId }
    }

    /// Where a delivery posts: `{baseUrl}/hooks/{endpointId}`
    /// (server/triggers/webhook-ingress.ts), nil when the endpoint id is not one.
    public static func url(baseURL: String?, webhook: WebhookListing) -> String? {
        WebhookPublicURL.make(baseURL: baseURL, endpointId: webhook.endpointId, typed: false)
    }

    /// The key as listed: `whsec_••••` and its last four characters.
    public static func masked(tokenLast4: String?) -> String {
        "whsec_\u{2022}\u{2022}\u{2022}\u{2022}\(tokenLast4 ?? "")"
    }

    public static func header(_ key: String) -> String {
        "Authorization: Bearer \(key)"
    }

    /// The curl example: the key when it is on screen, else `<key>`.
    public static func curl(url: String, token: String?) -> String {
        "curl -X POST \(url) -H \"Authorization: Bearer \(token ?? "<key>")\" -H \"Content-Type: application/json\" -d '{\"text\":\"hello\"}'"
    }

    /// What the eye does without a key on screen: the key waiting since
    /// creation is handed over once; any other way to see one is a new key.
    public enum KeyAction: Equatable, Sendable {
        case reveal
        case rotate
    }

    public static func keyAction(_ webhook: WebhookListing) -> KeyAction {
        webhook.tokenPending ? .reveal : .rotate
    }

    /// The status line (`statusFor` in WebhooksPanel.tsx).
    public enum Status: Equatable, Sendable {
        case waiting
        case ready
        case active
        case paused
    }

    public static func status(_ webhook: WebhookListing) -> Status {
        if webhook.verificationPending { return .waiting }
        if webhook.verifiedAt != nil && !webhook.enabled { return .ready }
        return webhook.enabled ? .active : .paused
    }

    /// The body that gives a webhook routine made without one its webhook:
    /// the routine saved again as a webhook routine (the server binds it).
    public static let createBody: [String: Any] = ["schedule": ["type": "webhook"]]
}

/// What a reveal or a rotation returns: the webhook and, once, its key.
public struct WebhookKeyResponse: Decodable, Sendable {
    public var webhook: WebhookListing
    public var credential: WebhookCredential?
}

/// `WebhookCredential` (shared/webhooks.ts). Kept in memory only.
public struct WebhookCredential: Decodable, Hashable, Sendable {
    public var endpointUrl: String?
    public var token: String
    public var command: String?
}

public extension CompanionClient {
    /// `POST /api/webhooks/:id/reveal` (the key waiting since creation) or
    /// `/rotate` (a new key; the current one stops working at once).
    func webhookKey(id: String, action: RoutineWebhook.KeyAction) async throws -> WebhookKeyResponse {
        guard Self.validRouteID(id) else { throw APIError.badURL }
        let verb = action == .reveal ? "reveal" : "rotate"
        return try await send(try makeRequest("POST", "/api/webhooks/\(id)/\(verb)"), as: WebhookKeyResponse.self)
    }

    /// "Create its webhook": `PATCH /api/routines/:id` with
    /// `{ schedule: { type: "webhook" } }`; the server binds the webhook.
    func createRoutineWebhook(routineId: String) async throws -> Routine {
        guard Self.validRouteID(routineId) else { throw APIError.badURL }
        return try await send(
            try makeRequest("PATCH", "/api/routines/\(routineId)", body: RoutineWebhook.createBody),
            as: RoutineResponse.self
        ).routine
    }
}
