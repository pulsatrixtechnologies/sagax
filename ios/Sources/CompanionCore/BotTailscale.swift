// Connect apps > Tailscale: the person's bot computer joins their private
// tailnet after a tailnet admin approves it. Port of shared/bot-tailscale.ts
// and /api/me/tailscale*. Secrets never come back in answers.
import Foundation

public enum BotTailscalePhase: String, Hashable, Sendable, Codable {
    case disconnected, ready, joining
    case pendingApproval = "pending_approval"
    case connected, error
}

public enum BotTailscaleCredKind: String, Hashable, Sendable, Codable {
    case authKey, oauth
}

public enum BotTailscaleKeyKind: String, Hashable, Sendable, Codable {
    case ephemeral, reusable
}

public enum BotTailscaleComputerPlace: String, Hashable, Sendable, Codable {
    case sandbox, cloud, desktop, other
}

public struct BotTailscaleComputerOption: Hashable, Sendable, Codable, Identifiable {
    public var id: String
    public var label: String
    public var place: BotTailscaleComputerPlace

    public init(id: String, label: String, place: BotTailscaleComputerPlace) {
        self.id = id
        self.label = label
        self.place = place
    }
}

public struct BotTailscaleDeviceView: Hashable, Sendable, Codable {
    public var name: String
    public var addresses: [String]
    public var pendingApproval: Bool
    public var nodeId: String?

    public init(name: String, addresses: [String], pendingApproval: Bool, nodeId: String? = nil) {
        self.name = name
        self.addresses = addresses
        self.pendingApproval = pendingApproval
        self.nodeId = nodeId
    }

    private enum CodingKeys: String, CodingKey {
        case name, addresses, pendingApproval, nodeId
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decode(String.self, forKey: .name)
        addresses = try c.decodeIfPresent([String].self, forKey: .addresses) ?? []
        pendingApproval = try c.decodeIfPresent(Bool.self, forKey: .pendingApproval) ?? false
        nodeId = try c.decodeIfPresent(String.self, forKey: .nodeId)
    }
}

public struct BotTailscaleCredentialView: Hashable, Sendable, Codable {
    public var kind: BotTailscaleCredKind
    public var hint: String
    public var tags: [String]

    public init(kind: BotTailscaleCredKind, hint: String, tags: [String] = ["tag:sagax"]) {
        self.kind = kind
        self.hint = hint
        self.tags = tags
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = try c.decode(BotTailscaleCredKind.self, forKey: .kind)
        hint = try c.decode(String.self, forKey: .hint)
        tags = try c.decodeIfPresent([String].self, forKey: .tags) ?? ["tag:sagax"]
    }

    private enum CodingKeys: String, CodingKey { case kind, hint, tags }
}

public struct BotTailscaleView: Hashable, Sendable, Codable {
    public var phase: BotTailscalePhase
    public var credentials: BotTailscaleCredentialView?
    public var computer: BotTailscaleComputerOption?
    public var keyKind: BotTailscaleKeyKind?
    public var device: BotTailscaleDeviceView?
    public var error: String?
    public var computers: [BotTailscaleComputerOption]

    public init(
        phase: BotTailscalePhase = .disconnected,
        credentials: BotTailscaleCredentialView? = nil,
        computer: BotTailscaleComputerOption? = nil,
        keyKind: BotTailscaleKeyKind? = nil,
        device: BotTailscaleDeviceView? = nil,
        error: String? = nil,
        computers: [BotTailscaleComputerOption] = []
    ) {
        self.phase = phase
        self.credentials = credentials
        self.computer = computer
        self.keyKind = keyKind
        self.device = device
        self.error = error
        self.computers = computers
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        phase = try c.decodeIfPresent(BotTailscalePhase.self, forKey: .phase) ?? .disconnected
        credentials = try c.decodeIfPresent(BotTailscaleCredentialView.self, forKey: .credentials)
        computer = try c.decodeIfPresent(BotTailscaleComputerOption.self, forKey: .computer)
        keyKind = try c.decodeIfPresent(BotTailscaleKeyKind.self, forKey: .keyKind)
        device = try c.decodeIfPresent(BotTailscaleDeviceView.self, forKey: .device)
        error = try c.decodeIfPresent(String.self, forKey: .error)
        computers = try c.decodeIfPresent([BotTailscaleComputerOption].self, forKey: .computers) ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case phase, credentials, computer, keyKind, device, error, computers
    }

    /// True while the UI should poll for admin approval.
    public var shouldPoll: Bool { phase == .pendingApproval || phase == .joining }
}

public enum BotTailscaleSetup: Equatable, Sendable {
    case authKey(String)
    case oauth(clientId: String, clientSecret: String)
}

public extension CompanionClient {
    /// `GET /api/me/tailscale`
    func botTailscale() async throws -> BotTailscaleView {
        try await send(makeRequest("GET", "/api/me/tailscale"), as: BotTailscaleView.self)
    }

    /// `POST /api/me/tailscale/setup`
    func setupBotTailscale(_ setup: BotTailscaleSetup) async throws -> BotTailscaleView {
        let body: [String: Any]
        switch setup {
        case let .authKey(key):
            body = ["mode": "authKey", "authKey": key]
        case let .oauth(clientId, clientSecret):
            body = ["mode": "oauth", "clientId": clientId, "clientSecret": clientSecret]
        }
        return try await send(makeRequest("POST", "/api/me/tailscale/setup", body: body), as: BotTailscaleView.self)
    }

    /// `POST /api/me/tailscale/join`
    func joinBotTailscale(computerId: String, keyKind: BotTailscaleKeyKind = .ephemeral) async throws -> BotTailscaleView {
        try await send(
            makeRequest("POST", "/api/me/tailscale/join", body: [
                "computerId": computerId,
                "keyKind": keyKind.rawValue,
            ]),
            as: BotTailscaleView.self
        )
    }

    /// `POST /api/me/tailscale/refresh`
    func refreshBotTailscale() async throws -> BotTailscaleView {
        try await send(makeRequest("POST", "/api/me/tailscale/refresh", body: [:]), as: BotTailscaleView.self)
    }

    /// `POST /api/me/tailscale/disconnect`
    func disconnectBotTailscale() async throws -> BotTailscaleView {
        try await send(makeRequest("POST", "/api/me/tailscale/disconnect", body: [:]), as: BotTailscaleView.self)
    }

    /// `DELETE /api/me/tailscale` (forget sealed credentials)
    func clearBotTailscale() async throws -> BotTailscaleView {
        try await send(makeRequest("DELETE", "/api/me/tailscale"), as: BotTailscaleView.self)
    }
}

/// Row key for the synthetic Tailscale Connect apps entry (desktop `TAILSCALE_KEY`).
public let tailscaleConnectAppKey = "tailscale:tailscale"

public struct BotTailscaleRowState: Hashable, Sendable {
    public var description: String
    public var connected: Bool
    public var pending: Bool

    public init(description: String, connected: Bool, pending: Bool = false) {
        self.description = description
        self.connected = connected
        self.pending = pending
    }

    public init(view: BotTailscaleView, description: String) {
        self.description = description
        self.connected = view.phase == .connected
        self.pending = view.phase == .pendingApproval || view.phase == .joining
    }
}
