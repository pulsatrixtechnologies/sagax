import Foundation

// 2026-10-21 (parité R10, lignes 82 et AP9): a bot's sign-in request card
// (secret target "vaultLogin", src/components/VaultRequestCard.tsx) answered
// on the phone: the person's saved logins for that site, and their
// 1Password items for it when 1Password is on their computer. The phone
// never receives a value; it sends a choice (a saved login, or a 1Password
// item by reference) and Allow once or Always. Names, vaults and sites only.

/// What a vault request card carries (shared/credential-vault.ts
/// VaultRequestCardData). The principal stays on the server's side.
public struct VaultRequestPublic: Codable, Hashable, Sendable {
    public var name: String?
    public var domain: String?
    public var itemId: String?
    public var itemName: String?
    public var mode: String?
    public var signedInSelf: Bool?
    public var onePassword: Bool?

    public init(name: String? = nil, domain: String? = nil, itemId: String? = nil, itemName: String? = nil, mode: String? = nil, signedInSelf: Bool? = nil, onePassword: Bool? = nil) {
        self.name = name
        self.domain = domain
        self.itemId = itemId
        self.itemName = itemName
        self.mode = mode
        self.signedInSelf = signedInSelf
        self.onePassword = onePassword
    }

    /// The site the card names: the address, else the name the bot asked for.
    public var site: String { domain ?? name ?? "" }
}

public enum VaultLoginCard {
    public static let target = "vaultLogin"

    public static func isVaultLogin(_ secret: SecretRequestCardData) -> Bool {
        secret.target == target && secret.vault != nil
    }
}

/// One 1Password item a card offers for its site. The ids stay off the
/// screen: the row shows the item's name and its vault.
public struct VaultCardOnePasswordItem: Decodable, Hashable, Sendable, Identifiable {
    public var vaultId: String
    public var itemId: String
    public var title: String
    public var vaultName: String
    public var domains: [String]

    public var id: String { "op:\(vaultId):\(itemId)" }
    public var label: String { vaultName.isEmpty ? title : "\(title) · \(vaultName)" }
}

public struct VaultCardOnePasswordList: Decodable, Equatable, Sendable {
    public var available: Bool
    public var items: [VaultCardOnePasswordItem]

    public init(from decoder: Decoder) throws {
        let row = try decoder.container(keyedBy: CodingKeys.self)
        available = try row.decodeIfPresent(Bool.self, forKey: .available) ?? false
        items = try row.decodeIfPresent([VaultCardOnePasswordItem].self, forKey: .items) ?? []
    }

    private enum CodingKeys: String, CodingKey { case available, items }
}

public enum VaultLoginMatching {
    /// Whether an item's sites name the requested host itself (review of
    /// #954: the card preselects only these, never another subdomain).
    public static func exactHost(_ domains: [String], request: VaultRequestPublic) -> Bool {
        guard let wanted = request.domain?.lowercased(), !wanted.isEmpty else { return false }
        return domains.contains { $0.lowercased() == wanted }
    }

    /// The choice a card starts on: a saved login of that exact host, else a
    /// 1Password item of that exact host, else none (the person picks).
    public static func preselected(saved: [VaultItemPublic], onePassword: [VaultCardOnePasswordItem], request: VaultRequestPublic) -> String? {
        if let item = saved.first(where: { exactHost($0.domains, request: request) }) { return item.id }
        return onePassword.first(where: { exactHost($0.domains, request: request) })?.id
    }

    /// The last two labels of a host (`login.example.test` is
    /// `example.test`): the card's "same site" suggestions only.
    public static func site(of domain: String) -> String {
        let host = domain.lowercased().split(separator: ":").first.map(String.init) ?? ""
        let labels = host.split(separator: ".")
        return labels.suffix(2).joined(separator: ".")
    }

    /// Saved logins and API keys for the card's site (exact first, then the
    /// same site) or named like the request. Never a note, a card, an address.
    public static func matching(_ items: [VaultItemPublic], request: VaultRequestPublic) -> [VaultItemPublic] {
        let usable = items.filter { $0.kind == "login" || $0.kind == "apiKey" }
        let domain = request.domain?.lowercased()
        let name = request.name?.trimmingCharacters(in: .whitespaces).lowercased() ?? ""
        let direct = usable.filter { item in
            (domain.map { wanted in item.domains.contains { $0.lowercased() == wanted || ($0.hasPrefix("*.") && wanted.hasSuffix(String($0.dropFirst(1)).lowercased())) } } ?? false)
                || (!name.isEmpty && item.name.lowercased().contains(name))
        }
        guard let domain else { return direct }
        let wanted = site(of: domain)
        let related = usable.filter { item in
            !direct.contains(item) && item.domains.contains { site(of: $0.replacingOccurrences(of: "*.", with: "")) == wanted }
        }
        return direct + related
    }
}

public extension CompanionClient {
    /// The 1Password items of the card's site, when 1Password is on the
    /// person's computer.
    func vaultCardOnePassword(botId: String, messageId: String, threadId: String) async throws -> VaultCardOnePasswordList {
        try await send(makeRequest("POST", "/api/bots/\(botId)/vault-cards/\(messageId)/onepassword", body: ["threadId": threadId]), as: VaultCardOnePasswordList.self)
    }

    /// Allow a saved login, once (this conversation, 15 minutes) or always.
    func grantVaultCard(botId: String, messageId: String, threadId: String, itemId: String, always: Bool) async throws {
        try await send(makeRequest("POST", "/api/bots/\(botId)/vault-cards/\(messageId)/grant", body: ["threadId": threadId, "itemId": itemId, "mode": always ? "always" : "once"]))
    }

    /// Allow a 1Password item, by reference: its value stays in 1Password
    /// until the bot fills it on the person's computer.
    func grantVaultCardFromOnePassword(botId: String, messageId: String, threadId: String, item: VaultCardOnePasswordItem, always: Bool) async throws {
        let body: [String: Any] = ["threadId": threadId, "mode": always ? "always" : "once", "onePassword": ["vaultId": item.vaultId, "itemId": item.itemId]]
        try await send(makeRequest("POST", "/api/bots/\(botId)/vault-cards/\(messageId)/grant", body: body))
    }

    /// Refuse: the bot goes on without signing in.
    func dismissVaultCard(botId: String, messageId: String, threadId: String) async throws {
        try await send(makeRequest("POST", "/api/bots/\(botId)/vault-cards/\(messageId)/dismiss", body: ["threadId": threadId]))
    }
}
