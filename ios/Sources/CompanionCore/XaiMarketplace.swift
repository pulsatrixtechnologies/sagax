import Foundation

// The xAI Bot Marketplace as a template source of Browse Bots (desktop
// shared/xai-marketplace.ts, server/routes/xai-marketplace.ts). The server
// reads x.ai's public pages and keeps them a few hours; Refresh reads again.
// Adding a bot goes through the phone's agent import: the server reads the
// bot's page, makes the same package as the agent import and stages it
// (`POST /api/bots/import/agent { marketplace }`), so it arrives inert:
// skills off, routines paused, no key, token or sign-in.

/// One bot of the marketplace list, with the catalogue's look and category.
public struct XaiMarketplaceEntry: Decodable, Hashable, Identifiable, Sendable {
    public var slug: String
    public var name: String
    public var creator: String
    public var description: String
    public var categories: [String]
    public var look: BotCatalogLook
    public var category: String?
    public var url: String

    public var id: String { slug }

    public init(slug: String, name: String, creator: String, description: String, categories: [String] = [], look: BotCatalogLook = BotCatalogLook(), category: String? = nil, url: String = "") {
        self.slug = slug
        self.name = name
        self.creator = creator
        self.description = description
        self.categories = categories
        self.look = look
        self.category = category
        self.url = url
    }

    enum CodingKeys: String, CodingKey { case slug, name, creator, description, categories, look, category, url }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        slug = try c.decode(String.self, forKey: .slug)
        name = try c.decode(String.self, forKey: .name)
        creator = (try? c.decodeIfPresent(String.self, forKey: .creator)) ?? ""
        description = (try? c.decodeIfPresent(String.self, forKey: .description)) ?? ""
        categories = (try? c.decodeIfPresent([String].self, forKey: .categories)) ?? []
        // a look this build cannot read draws the default mascot, never fails the row
        look = (try? c.decodeIfPresent(BotCatalogLook.self, forKey: .look)) ?? BotCatalogLook()
        category = (try? c.decodeIfPresent(String.self, forKey: .category)) ?? nil
        url = (try? c.decodeIfPresent(String.self, forKey: .url)) ?? ""
    }
}

/// `GET /api/team-library/xai`.
public struct XaiMarketplaceList: Decodable, Sendable {
    public struct Stale: Decodable, Hashable, Sendable { public var code: String }
    public var label: String
    public var url: String
    public var bots: [XaiMarketplaceEntry]
    /// A refresh failed: these are the bots read earlier.
    public var stale: Stale?
}

public enum XaiMarketplaceRules {
    public static let label = "xAI Bot Marketplace"

    /// The line shown for a failure, by the server's code; anything else reads as out of reach.
    public static func errorText(code: String?) -> String {
        switch code {
        case "xai_format": String(localized: "The xAI Bot Marketplace changed its page, and Sagax cannot read its bots yet. The other templates are not affected.")
        case "xai_not_found": String(localized: "This bot is no longer on the xAI Bot Marketplace.")
        case "xai_blocked": String(localized: "x.ai refused to show the marketplace to Sagax. Open x.ai/bot/marketplace in your browser to check that it is up, then try Refresh.")
        default: String(localized: "The xAI Bot Marketplace could not be reached. Try Refresh in a moment.")
        }
    }
}

struct XaiMarketplaceStageBody: Encodable { var marketplace: String; var timeZone: String }

public extension CompanionClient {
    /// `GET /api/team-library/xai[?refresh=1]`: the marketplace's bots, kept a few hours on the server.
    func xaiMarketplace(refresh: Bool = false) async throws -> XaiMarketplaceList {
        try await send(makeRequest("GET", "/api/team-library/xai", query: refresh ? [URLQueryItem(name: "refresh", value: "1")] : []), as: XaiMarketplaceList.self)
    }

    /// `POST /api/bots/import/agent {marketplace, timeZone}`: that bot made into
    /// a package on the server and staged for this person, with what was left out.
    func stageXaiMarketplaceImport(slug: String, timeZone: String = TimeZone.current.identifier) async throws -> AgentImportStaged {
        try await send(makeRequest("POST", "/api/bots/import/agent", encodedBody: XaiMarketplaceStageBody(marketplace: slug, timeZone: timeZone)), as: AgentImportStaged.self)
    }
}

/// A Grok Bot link (shared/grok-import.ts): a share link
/// (https://x.ai/bot/<id>) or a marketplace page
/// (https://x.ai/bot/marketplace/bots/<slug>).
public enum GrokLink {
    private static func url(_ text: String) -> URL? {
        let raw = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let lowered = raw.lowercased()
        let full = lowered.hasPrefix("x.ai/") || lowered.hasPrefix("www.x.ai/") ? "https://\(raw)" : raw
        guard let url = URL(string: full), url.scheme == "https", url.user == nil, url.password == nil, url.port == nil,
              url.host == "x.ai" || url.host == "www.x.ai" else { return nil }
        return url
    }

    private static func parts(_ url: URL) -> [String] { url.path.split(separator: "/").map(String.init) }

    /// The slug of a marketplace page.
    public static func marketplaceSlug(_ text: String) -> String? {
        guard let url = url(text) else { return nil }
        let p = parts(url)
        guard p.count == 4, p[0] == "bot", p[1] == "marketplace", p[2] == "bots" else { return nil }
        let slug = p[3]
        guard slug.range(of: #"^[a-z0-9][a-z0-9-]{0,79}$"#, options: .regularExpression) != nil else { return nil }
        return slug
    }

    /// A share link's id.
    public static func shareId(_ text: String) -> String? {
        guard let url = url(text) else { return nil }
        let p = parts(url)
        guard p.count == 2, p[0] == "bot", p[1] != "marketplace",
              p[1].range(of: #"^[A-Za-z0-9_-]{21}$"#, options: .regularExpression) != nil else { return nil }
        return p[1]
    }

    public static func isLink(_ text: String) -> Bool { marketplaceSlug(text) != nil || shareId(text) != nil }
}
