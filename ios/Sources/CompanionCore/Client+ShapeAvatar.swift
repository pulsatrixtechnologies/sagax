// Shape avatar generate route (v2.1): POST /api/bots/:id/shape-avatar/generate.
// Soft: older servers may not mount it; callers fall back to local keyword match.
import Foundation

public struct ShapeAvatarGenerateReply: Decodable, Sendable {
    public var def: ShapeAvatarDef?
    public var source: String?
    public var error: String?
}

extension CompanionClient {
    /// `POST /api/bots/:id/shape-avatar/generate` `{ direction }` → validated def, or nil on miss.
    public func generateShapeAvatar(botId: String, direction: String) async throws -> ShapeAvatarDef {
        struct Body: Encodable { var direction: String }
        let bounded = String(direction.trimmingCharacters(in: .whitespacesAndNewlines).prefix(ShapeAvatarGenerate.directionMax))
        let reply: ShapeAvatarGenerateReply = try await send(
            makeRequest("POST", "/api/bots/\(botId)/shape-avatar/generate", encodedBody: Body(direction: bounded)),
            as: ShapeAvatarGenerateReply.self
        )
        if let message = reply.error, !message.isEmpty {
            throw APIError.transport(message)
        }
        guard let def = reply.def else {
            throw APIError.transport("Shape avatar generate returned no definition.")
        }
        switch ShapeAvatarValidator.check(def) {
        case let .ok(valid):
            return valid
        case let .error(message):
            throw APIError.transport(message)
        }
    }
}
