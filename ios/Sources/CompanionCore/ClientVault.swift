import Foundation

// The person's vault and security keys (Settings). Listings never carry a
// card number, a security code or a team secret. Reveal is a separate call
// the phone makes only after Face ID. Payments settings (default method and
// per-bot allowances) ride on the same list response.

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

/// What bots use first when they do not name a method. Never a PAN.
public struct PaymentMethodRefPublic: Codable, Equatable, Sendable {
    public var type: String
    public var cardId: String?
    public var wallet: String?

    public init(type: String, cardId: String? = nil, wallet: String? = nil) {
        self.type = type
        self.cardId = cardId
        self.wallet = wallet
    }

    public static func card(_ cardId: String) -> PaymentMethodRefPublic {
        PaymentMethodRefPublic(type: "card", cardId: cardId)
    }

    public static func wallet(_ wallet: String) -> PaymentMethodRefPublic {
        PaymentMethodRefPublic(type: "wallet", wallet: wallet)
    }
}

/// One bot's spending rules. Absent enabled means the bot may pay.
public struct BotPaymentAllowancePublic: Codable, Equatable, Sendable {
    public var enabled: Bool?
    public var perPurchaseLimit: String?
    public var perMonthLimit: String?
    public var merchants: [String]?

    public init(
        enabled: Bool? = nil,
        perPurchaseLimit: String? = nil,
        perMonthLimit: String? = nil,
        merchants: [String]? = nil
    ) {
        self.enabled = enabled
        self.perPurchaseLimit = perPurchaseLimit
        self.perMonthLimit = perMonthLimit
        self.merchants = merchants
    }

    /// Person autonomy: enabled absent = true.
    public var mayPay: Bool { enabled != false }
}

public struct PaymentsSettingsPublic: Codable, Equatable, Sendable {
    public var defaultMethod: PaymentMethodRefPublic?
    public var bots: [String: BotPaymentAllowancePublic]?

    public init(defaultMethod: PaymentMethodRefPublic? = nil, bots: [String: BotPaymentAllowancePublic]? = nil) {
        self.defaultMethod = defaultMethod
        self.bots = bots
    }

    public func allowance(for botId: String) -> BotPaymentAllowancePublic {
        bots?[botId] ?? BotPaymentAllowancePublic()
    }
}

/// A method the Payments screen can show or pick. Never a PAN.
public struct PaymentMethodPublic: Decodable, Equatable, Sendable, Identifiable {
    public var id: String
    public var type: String
    public var label: String
    public var detail: String
    public var brand: String?
    public var last4: String?
    public var wallet: String?
    public var isDefault: Bool
    public var ready: Bool?
}

/// PATCH /api/me/credentials/payments. Omitted fields stay; null clears.
public struct PaymentsSettingsPatch: Encodable, Equatable, Sendable {
    /// `.some(nil)` clears the default; `.none` leaves it alone.
    public var defaultMethod: PaymentMethodRefPublic??
    /// Bot id → allowance, or nil to remove that bot's row.
    public var bots: [String: BotPaymentAllowancePublic?]?

    public init(
        defaultMethod: PaymentMethodRefPublic?? = nil,
        bots: [String: BotPaymentAllowancePublic?]? = nil
    ) {
        self.defaultMethod = defaultMethod
        self.bots = bots
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        if let defaultMethod {
            if let value = defaultMethod {
                try container.encode(value, forKey: .defaultMethod)
            } else {
                try container.encodeNil(forKey: .defaultMethod)
            }
        }
        if let bots {
            var nested = container.nestedContainer(keyedBy: DynamicCodingKey.self, forKey: .bots)
            for (botId, allowance) in bots.sorted(by: { $0.key < $1.key }) {
                let key = DynamicCodingKey(stringValue: botId)
                if let allowance {
                    try nested.encode(allowance, forKey: key)
                } else {
                    try nested.encodeNil(forKey: key)
                }
            }
        }
    }

    private enum CodingKeys: String, CodingKey { case defaultMethod, bots }
}

private struct DynamicCodingKey: CodingKey {
    var stringValue: String
    var intValue: Int? { nil }
    init(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { return nil }
}

public struct PaymentsSettingsResponse: Decodable, Equatable, Sendable {
    public var payments: PaymentsSettingsPublic
    public var methods: [PaymentMethodPublic]
}

public struct VaultList: Decodable, Equatable, Sendable {
    public var items: [VaultItemPublic]
    public var purchases: [VaultPurchasePublic]
    public var history: [VaultPurchasePublic]
    public var wallets: [String: WalletLinkPublic]?
    public var payments: PaymentsSettingsPublic?
    public var methods: [PaymentMethodPublic]
    public var onePassword: OnePasswordStatusPublic?

    public init(from decoder: Decoder) throws {
        let row = try decoder.container(keyedBy: CodingKeys.self)
        items = try row.decode([VaultItemPublic].self, forKey: .items)
        purchases = try row.decodeIfPresent([VaultPurchasePublic].self, forKey: .purchases) ?? []
        history = try row.decodeIfPresent([VaultPurchasePublic].self, forKey: .history) ?? []
        wallets = try row.decodeIfPresent([String: WalletLinkPublic].self, forKey: .wallets)
        payments = try row.decodeIfPresent(PaymentsSettingsPublic.self, forKey: .payments)
        methods = try row.decodeIfPresent([PaymentMethodPublic].self, forKey: .methods) ?? []
        onePassword = try row.decodeIfPresent(OnePasswordStatusPublic.self, forKey: .onePassword)
    }

    private enum CodingKeys: String, CodingKey {
        case items, purchases, history, wallets, payments, methods, onePassword
    }
}

public struct VaultPurchasePublic: Decodable, Equatable, Sendable, Identifiable {
    public var id: String
    public var title: String
    public var line: String
    public var merchant: String
    public var amount: String?
    public var currency: String?
    public var status: String?
    public var cardName: String?
    public var cardLast4: String?
    public var wallet: String?
    public var orderRef: String?
    public var doneAt: Double?
    public var createdAt: Double?

    public init(from decoder: Decoder) throws {
        let row = try decoder.container(keyedBy: CodingKeys.self)
        id = try row.decode(String.self, forKey: .id)
        title = try row.decode(String.self, forKey: .title)
        line = try row.decode(String.self, forKey: .line)
        merchant = try row.decode(String.self, forKey: .merchant)
        amount = try row.decodeIfPresent(String.self, forKey: .amount)
        currency = try row.decodeIfPresent(String.self, forKey: .currency)
        status = try row.decodeIfPresent(String.self, forKey: .status)
        cardName = try row.decodeIfPresent(String.self, forKey: .cardName)
        cardLast4 = try row.decodeIfPresent(String.self, forKey: .cardLast4)
        wallet = try row.decodeIfPresent(String.self, forKey: .wallet)
        orderRef = try row.decodeIfPresent(String.self, forKey: .orderRef)
        doneAt = try row.decodeIfPresent(Double.self, forKey: .doneAt)
        createdAt = try row.decodeIfPresent(Double.self, forKey: .createdAt)
    }

    private enum CodingKeys: String, CodingKey {
        case id, title, line, merchant, amount, currency, status
        case cardName, cardLast4, wallet, orderRef, doneAt, createdAt
    }
}

public struct VaultReveal: Decodable, Equatable, Sendable {
    public var value: String
}

public struct SecurityKeyPublic: Decodable, Equatable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var createdAt: Double
    /// "multiDevice" for a passkey, else a hardware key (SecurityKeySettings.tsx).
    public var deviceType: String?
    public var lastUsedAt: Double?
    /// The address the key answers for.
    public var rpId: String?
}

public enum SecurityKeyStart: Equatable, Sendable {
    case ceremony(StepUpStart)
    case needsSignIn

    static func isReauth(_ body: Data) -> Bool {
        (try? JSONDecoder().decode(APIErrorCodeBody.self, from: body))?.code == "reauth_required"
    }
}

public struct SecurityKeysList: Decodable, Equatable, Sendable {
    public var keys: [SecurityKeyPublic]
    public var classes: [String]
    /// The first key needs a fresh sign-in (`reauth_required`, 2026-10-18).
    public var needsSignIn: Bool?
    /// This server's address for keys.
    public var rpId: String?
    public var unreadable: Bool?

    /// `keyHere`: one of the keys answers this server's address.
    public var keyHere: Bool {
        guard let rpId else { return !keys.isEmpty }
        return keys.contains { $0.rpId == rpId }
    }
}

public struct TeamBotVaultList: Decodable, Equatable, Sendable {
    public var items: [VaultItemPublic]
    public var botId: String
}

private struct PurchaseHistoryBody: Decodable {
    var purchases: [VaultPurchasePublic]
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
        try await send(beginSecurityKeyRequest(name: name), as: StepUpStart.self)
    }

    /// Settings > Security > Add a key: the ceremony to run, or the
    /// server's word that the first key needs a fresh sign-in
    /// (`reauth_required`, shown as the Sign in again row).
    func startSecurityKey(name: String) async throws -> SecurityKeyStart {
        let (data, response) = try await perform(beginSecurityKeyRequest(name: name))
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode),
           SecurityKeyStart.isReauth(data) {
            return .needsSignIn
        }
        try Self.check(response, data)
        return .ceremony(try JSONDecoder().decode(StepUpStart.self, from: data))
    }

    func beginSecurityKeyRequest(name: String) throws -> URLRequest {
        try makeRequest("POST", "/api/security-keys/register", body: ["name": name, "via": "page"])
    }

    func answerPurchase(id: String, decision: String) async throws {
        try await send(makeRequest("POST", "/api/me/credentials/purchases/\(id)/answer", body: ["decision": decision]))
    }

    /// Default method and per-bot allowances. Null defaultMethod clears it.
    func patchPayments(_ patch: PaymentsSettingsPatch) async throws -> PaymentsSettingsResponse {
        try await send(
            makeRequest("PATCH", "/api/me/credentials/payments", encodedBody: patch),
            as: PaymentsSettingsResponse.self
        )
    }

    /// Settled purchases (not pending), newest first on the server.
    func purchaseHistory() async throws -> [VaultPurchasePublic] {
        try await send(
            makeRequest("POST", "/api/me/credentials/purchases/history", body: [:]),
            as: PurchaseHistoryBody.self
        ).purchases
    }

    func securityKeys() async throws -> SecurityKeysList {
        try await send(makeRequest("GET", "/api/security-keys"), as: SecurityKeysList.self)
    }

    func deleteSecurityKey(id: String) async throws {
        try await send(makeRequest("DELETE", "/api/security-keys/\(id)", body: [:]))
    }
}
