import Foundation

// The person's vault and security keys (Settings). Listings never carry a
// card number, a security code or a team secret. Reveal is a separate call
// the phone makes only after Face ID.

public struct VaultCardPublic: Decodable, Equatable, Sendable {
    public var brand: String
    public var last4: String
    public var expMonth: Int
    public var expYear: Int
    public var holder: String
}

public struct VaultAddressPublic: Decodable, Equatable, Sendable {
    public var recipient: String
    public var line1: String
    public var city: String
    public var country: String
}

public struct VaultItemPublic: Decodable, Equatable, Sendable, Identifiable {
    public var id: String
    public var kind: String
    public var name: String
    public var domains: [String]
    public var hasPassword: Bool
    public var hasNotes: Bool
    public var card: VaultCardPublic?
    public var address: VaultAddressPublic?
    /// "1password" for a 1Password reference (allowed once only, review of #954).
    public var source: String?
    /// 2026-10-29: an API key is saved (shown like a password).
    public var hasApiKey: Bool?

    /// The secret the owner may show here: a password or a key of their own vault.
    public var revealField: String? {
        guard source != "1password" else { return nil }
        if hasPassword { return "password" }
        if hasApiKey == true { return "apiKey" }
        return nil
    }

    /// What the row shows. Never a number. */
    public var subtitle: String {
        if let card { return "\(card.brand) · \(card.last4)" }
        if let address { return "\(address.city), \(address.country)" }
        if !domains.isEmpty { return domains.joined(separator: ", ") }
        return kind
    }
}

public struct VaultList: Decodable, Equatable, Sendable {
    public var items: [VaultItemPublic]
    public var purchases: [VaultPurchasePublic]
    public var wallets: [String: WalletLinkPublic]?
    public var onePassword: OnePasswordStatusPublic?

    public init(from decoder: Decoder) throws {
        let row = try decoder.container(keyedBy: CodingKeys.self)
        items = try row.decode([VaultItemPublic].self, forKey: .items)
        purchases = try row.decodeIfPresent([VaultPurchasePublic].self, forKey: .purchases) ?? []
        wallets = try row.decodeIfPresent([String: WalletLinkPublic].self, forKey: .wallets)
        onePassword = try row.decodeIfPresent(OnePasswordStatusPublic.self, forKey: .onePassword)
    }

    private enum CodingKeys: String, CodingKey { case items, purchases, wallets, onePassword }
}

public struct VaultPurchasePublic: Decodable, Equatable, Sendable, Identifiable {
    public var id: String
    public var title: String
    public var line: String
    public var merchant: String
}

public struct VaultReveal: Decodable, Equatable, Sendable {
    public var value: String
}

public struct SecurityKeyPublic: Decodable, Equatable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var createdAt: Double
}

public struct SecurityKeysList: Decodable, Equatable, Sendable {
    public var keys: [SecurityKeyPublic]
    public var classes: [String]
}

public struct TeamBotVaultList: Decodable, Equatable, Sendable {
    public var items: [VaultItemPublic]
    public var botId: String
}

public extension CompanionClient {
    func vaultItems() async throws -> VaultList {
        try await send(makeRequest("POST", "/api/me/credentials/list", body: [:]), as: VaultList.self)
    }

    /// Shared logins of a team bot (managers only). Listings never carry a value.
    func teamBotVaultItems(botId: String) async throws -> TeamBotVaultList {
        try await send(makeRequest("POST", "/api/bots/\(botId)/credentials/list", body: [:]), as: TeamBotVaultList.self)
    }

    func revealVaultItem(id: String, field: String) async throws -> VaultReveal {
        try await send(makeRequest("POST", "/api/me/credentials/\(id)/reveal", body: ["field": field]), as: VaultReveal.self)
    }

    func deleteVaultItem(id: String) async throws {
        try await send(makeRequest("DELETE", "/api/me/credentials/\(id)"))
    }

    /// A card the person types. The number goes to the server once.
    func addVaultCard(name: String, holder: String, pan: String, cvv: String, expMonth: Int, expYear: Int) async throws {
        let body: [String: Any] = [
            "kind": "card", "name": name, "domains": [String](),
            "card": ["holder": holder, "pan": pan, "cvv": cvv, "expMonth": expMonth, "expYear": expYear],
        ]
        try await send(makeRequest("POST", "/api/me/credentials", body: body))
    }

    /// Start adding a security key. The ceremony page is the server's.
    func beginSecurityKey(name: String) async throws -> StepUpStart {
        try await send(makeRequest("POST", "/api/security-keys/register", body: ["name": name, "via": "page"]), as: StepUpStart.self)
    }

    func answerPurchase(id: String, decision: String) async throws {
        try await send(makeRequest("POST", "/api/me/credentials/purchases/\(id)/answer", body: ["decision": decision]))
    }

    func securityKeys() async throws -> SecurityKeysList {
        try await send(makeRequest("GET", "/api/security-keys"), as: SecurityKeysList.self)
    }

    func deleteSecurityKey(id: String) async throws {
        try await send(makeRequest("DELETE", "/api/security-keys/\(id)", body: [:]))
    }
}
