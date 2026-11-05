// claude.ai artifact cards (#2018). Ported from `shared/claude-chat-blocks.ts`
// (claudeArtifactUrl, parseArtifactConsent) plus the `/api/claude-artifacts/*`
// routes. Artifact content is untrusted data: plain text only, never HTML.
import Foundation

public enum ClaudeArtifacts {
    /// The canonical https://claude.ai/[code/]artifact/<id>, or nil.
    public static func canonicalUrl(_ value: String?) -> String? {
        guard let value, let url = URL(string: value.trimmingCharacters(in: .whitespacesAndNewlines)) else { return nil }
        guard url.scheme == "https", url.user == nil, url.password == nil else { return nil }
        let host = url.host?.lowercased()
        guard host == "claude.ai" || host == "www.claude.ai" else { return nil }
        let pattern = #"^/(code/)?artifact/([A-Za-z0-9-]{8,64})/?$"#
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: url.path, range: NSRange(url.path.startIndex..., in: url.path)),
              let id = Range(match.range(at: 2), in: url.path)
        else { return nil }
        let code = Range(match.range(at: 1), in: url.path).map { _ in "code/" } ?? ""
        return "https://claude.ai/\(code)artifact/\(url.path[id])"
    }

    /// Every canonical artifact link in a paragraph (bare or markdown), in order.
    public static func urls(in text: String) -> [String] {
        var out: [String] = []
        func add(_ raw: String) {
            if let url = canonicalUrl(raw.trimmingCharacters(in: CharacterSet(charactersIn: ".,;:!?)"))), !out.contains(url) { out.append(url) }
        }
        guard let regex = try? NSRegularExpression(pattern: #"https://(?:www\.)?claude\.ai/(?:code/)?artifact/[A-Za-z0-9-]+/?"#, options: .caseInsensitive) else { return out }
        for match in regex.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
            if let r = Range(match.range, in: text) { add(String(text[r])) }
        }
        return out
    }

    /// The paragraph is only the link (bare or `[label](url)`).
    public static func isStandaloneParagraph(_ text: String, url expected: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if canonicalUrl(trimmed) == expected { return true }
        let md = #"^\[[^\]]*]\((https://[^)\s]+)\)$"#
        guard let regex = try? NSRegularExpression(pattern: md),
              let match = regex.firstMatch(in: trimmed, range: NSRange(trimmed.startIndex..., in: trimmed)),
              let r = Range(match.range(at: 1), in: trimmed)
        else { return false }
        return canonicalUrl(String(trimmed[r])) == expected
    }

    /// ```artifact fence {"blocked":"other_account","url","account"?}.
    public static func parseConsent(_ code: String) -> ClaudeArtifactConsent? {
        guard let data = code.trimmingCharacters(in: .whitespacesAndNewlines).data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              object["blocked"] as? String == "other_account",
              let url = canonicalUrl(object["url"] as? String)
        else { return nil }
        var account: String?
        if let raw = (object["account"] as? String)?.trimmingCharacters(in: .whitespaces),
           raw.range(of: #"^[^\s@]{1,64}@[^\s@]{1,190}$"#, options: .regularExpression) != nil { account = raw }
        return ClaudeArtifactConsent(url: url, account: account)
    }

    /// The bot message that asks for a copy under the person's own account.
    public static func copyMessage(url: String) -> String {
        "Publie une copie de \(url) depuis ton compte avec claude_artifact. Tu ne peux pas lire cette page (autre compte claude.ai) : publie depuis un fichier HTML de ton workspace (ou un collage), puis donne la nouvelle URL pour mettre à jour les références."
    }

    /// Parses the server's ISO time (with or without fractions).
    public static func date(_ iso: String?) -> Date? {
        guard let iso else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return withFraction.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
    }
}

public struct ClaudeArtifactConsent: Equatable, Sendable {
    public var url: String
    public var account: String?
}

public struct ClaudeArtifactSummary: Decodable, Equatable, Sendable {
    public var url: String
    public var title: String?
    public var icon: String?
    public var owned: Bool?
    public var updatedAt: String?
    public var summary: String?
    public var blocked: String?
    public var account: String?
}

public struct ClaudeArtifactReply: Decodable, Equatable, Sendable {
    public var author: String?
    public var text: String
    public var createdAt: String?
}

public struct ClaudeArtifactThread: Decodable, Equatable, Identifiable, Sendable {
    public var id: String
    public var status: String
    public var author: String?
    public var text: String
    public var createdAt: String?
    public var replies: [ClaudeArtifactReply]

    public var isOpen: Bool { status != "resolved" }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        status = (try? c.decode(String.self, forKey: .status)) ?? "open"
        author = try? c.decodeIfPresent(String.self, forKey: .author)
        text = (try? c.decode(String.self, forKey: .text)) ?? ""
        createdAt = try? c.decodeIfPresent(String.self, forKey: .createdAt)
        replies = (try? c.decode([ClaudeArtifactReply].self, forKey: .replies)) ?? []
    }

    private enum CodingKeys: String, CodingKey { case id, status, author, text, createdAt, replies }
}

private struct ClaudeArtifactThreads: Decodable { var threads: [ClaudeArtifactThread] }

public extension CompanionClient {
    /// `GET /api/claude-artifacts/summary`: 409 when the person has no Claude login.
    func claudeArtifactSummary(url: String) async throws -> ClaudeArtifactSummary {
        try await send(makeRequest("GET", "/api/claude-artifacts/summary", query: [URLQueryItem(name: "url", value: url)]), as: ClaudeArtifactSummary.self)
    }

    func claudeArtifactComments(url: String) async throws -> [ClaudeArtifactThread] {
        try await send(makeRequest("GET", "/api/claude-artifacts/comments", query: [URLQueryItem(name: "url", value: url)]), as: ClaudeArtifactThreads.self).threads
    }

    func claudeArtifactReply(url: String, threadId: String, text: String) async throws {
        try await send(makeRequest("POST", "/api/claude-artifacts/comments/reply", body: ["url": url, "threadId": threadId, "text": text]))
    }

    func claudeArtifactResolve(url: String, threadId: String) async throws {
        try await send(makeRequest("POST", "/api/claude-artifacts/comments/resolve", body: ["url": url, "threadId": threadId]))
    }
}
