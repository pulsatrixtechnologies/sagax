import Foundation

// The person's own photo, as `GET /api/auth/session` names it (`avatarUrl`).
//
// On an organization server that is the person's Perspicax avatar, served by
// the Sagax server itself at a versioned route
// (`/api/people/<principal>/avatar?v=<version>`, server/people/viewer-identity.ts):
// the server reads the image through its Perspicax link, so the phone only
// ever asks its own server, with the bearer it already holds. No Perspicax
// token, address or `picture` claim is used here. The version changes with
// the image, so the versioned path is also the cache key: a new photo is a
// new key, the old bytes are simply never asked for again.
//
// A personal computer names no photo (it has no Perspicax link); a stored
// `/api/attachments/<name>` picture is accepted for a server that keeps one.
// Anything else (an absolute URL, another route, a path with dot segments)
// is not a photo the phone will request: the account falls back to its
// initial.
public struct AccountAvatar: Hashable, Sendable {
    public enum Route: Hashable, Sendable {
        /// `/api/people/<id>/avatar?v=<version>`: a Perspicax avatar.
        case person(id: String, version: String)
        /// `/api/attachments/<name>`: a stored picture.
        case attachment(name: String)
    }

    public let route: Route

    public init?(_ raw: String?) {
        guard let raw = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty,
              raw.count <= 512, raw.hasPrefix("/"), !raw.hasPrefix("//")
        else { return nil }
        if raw.hasPrefix("/api/attachments/") {
            guard CompanionClient.validAvatarPath(raw) else { return nil }
            route = .attachment(name: String(raw.dropFirst("/api/attachments/".count)))
            return
        }
        // /api/people/<id>/avatar?v=<version>, nothing more.
        let parts = raw.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
        guard parts.count == 2 else { return nil }
        let segments = parts[0].split(separator: "/", omittingEmptySubsequences: false)
        guard segments.count == 5, segments[0].isEmpty, segments[1] == "api", segments[2] == "people",
              segments[4] == "avatar", Self.isToken(segments[3], max: 80)
        else { return nil }
        let query = parts[1].split(separator: "&", omittingEmptySubsequences: false)
        guard query.count == 1, query[0].hasPrefix("v=") else { return nil }
        let version = query[0].dropFirst(2)
        guard Self.isToken(version, max: 64) else { return nil }
        route = .person(id: String(segments[3]), version: String(version))
    }

    /// The route on the phone's own server.
    public var path: String {
        switch route {
        case let .person(id, _): "/api/people/\(id)/avatar"
        case let .attachment(name): "/api/attachments/\(name)"
        }
    }

    public var queryItems: [URLQueryItem] {
        switch route {
        case let .person(_, version): [URLQueryItem(name: "v", value: version)]
        case .attachment: []
        }
    }

    /// Stable for one image: the version is part of it.
    public var cacheKey: String {
        switch route {
        case let .person(id, version): "person/\(id)/\(version)"
        case let .attachment(name): "attachment/\(name)"
        }
    }

    /// `[A-Za-z0-9_-]{1,max}`: the server's own id and version alphabet.
    private static func isToken<S: StringProtocol>(_ value: S, max: Int) -> Bool {
        !value.isEmpty && value.count <= max && value.utf8.allSatisfy { byte in
            (48...57).contains(byte) || (65...90).contains(byte) || (97...122).contains(byte) || byte == 45 || byte == 95
        }
    }
}

extension CompanionClient {
    /// The person's photo bytes from this server, with this client's bearer
    /// (the same auth every other call uses). Throws on a refusal or a body
    /// that is not a PNG, JPEG, GIF or WebP image.
    public func accountAvatar(_ avatar: AccountAvatar) async throws -> Data {
        let request = try makeRequest("GET", avatar.path, query: avatar.queryItems)
        let (data, response) = try await perform(request)
        try Self.check(response, data)
        guard AccountAvatar.isImage(data) else {
            throw APIError.transport("The computer sent a photo this app couldn't read.")
        }
        return data
    }
}

extension AccountAvatar {
    /// The image signatures the server serves (PNG and JPEG from Perspicax;
    /// GIF and WebP for a stored picture).
    static func isImage(_ data: Data) -> Bool {
        let bytes = [UInt8](data.prefix(12))
        if bytes.starts(with: [0x89, 0x50, 0x4E, 0x47]) { return true }
        if bytes.starts(with: [0xFF, 0xD8, 0xFF]) { return true }
        if bytes.starts(with: Array("GIF8".utf8)) { return true }
        return bytes.count == 12 && bytes.starts(with: Array("RIFF".utf8)) && Array(bytes[8..<12]) == Array("WEBP".utf8)
    }
}

// MARK: - The person's own photo (PUT/DELETE /api/me/avatar, 2026-10-16)

/// What the server answers after the person's own photo changed: the new
/// versioned route of their photo, nil once removed.
public struct OwnAvatarAnswer: Decodable, Equatable, Sendable {
    public var ok: Bool
    public var avatarUrl: String?
    public var avatar: AccountAvatar? { AccountAvatar(avatarUrl) }
}

/// Why the server refused the person's own photo (`code` of the answer).
public enum OwnAvatarRefusal: String, Sendable {
    case sessionOnly = "avatar_session_only"
    case signInAgain = "avatar_sign_in_again"
    case type = "avatar_type"
    case unreadable = "avatar_unreadable"
    case tooLarge = "avatar_too_large"
    case rejected = "avatar_rejected"
    case outdated = "avatar_perspicax_outdated"
    case unreachable = "avatar_unreachable"
}

public struct OwnAvatarError: Error, Equatable, Sendable {
    public let refusal: OwnAvatarRefusal?
    public let status: Int?
}

extension CompanionClient {
    /// The largest image this app sends: the 256 px square it cropped.
    public static let ownAvatarMaxBytes = 256 * 1024

    /// Set the signed-in person's own photo on an organization server: the
    /// 256 px square, PNG or JPEG. The server writes it to Perspicax as them.
    public func setOwnAvatar(_ data: Data, mime: String) async throws -> OwnAvatarAnswer {
        guard mime == "image/png" || mime == "image/jpeg", data.count <= Self.ownAvatarMaxBytes, AccountAvatar.isImage(data) else {
            throw OwnAvatarError(refusal: .type, status: nil)
        }
        var request = try makeRequest("PUT", "/api/me/avatar")
        request.setValue(mime, forHTTPHeaderField: "Content-Type")
        request.httpBody = data
        return try await ownAvatarCall(request)
    }

    /// Remove the signed-in person's own photo (back to the initial).
    public func removeOwnAvatar() async throws -> OwnAvatarAnswer {
        try await ownAvatarCall(try makeRequest("DELETE", "/api/me/avatar"))
    }

    private func ownAvatarCall(_ request: URLRequest) async throws -> OwnAvatarAnswer {
        let (data, response) = try await perform(request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            struct Refusal: Decodable { var code: String? }
            let code = (try? JSONDecoder().decode(Refusal.self, from: data))?.code
            throw OwnAvatarError(refusal: code.flatMap(OwnAvatarRefusal.init(rawValue:)), status: status)
        }
        guard let answer = try? JSONDecoder().decode(OwnAvatarAnswer.self, from: data), answer.ok else {
            throw OwnAvatarError(refusal: .unreachable, status: status)
        }
        return answer
    }
}
