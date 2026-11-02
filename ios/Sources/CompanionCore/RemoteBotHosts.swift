import Foundation

/// Enrolled unattended host as the bot Computer place picker shows it
/// (`shared/remote-unattended-host.ts`, `shared/remote-bot-hosts.ts`).
public struct UnattendedHostRow: Codable, Equatable, Sendable, Identifiable {
    public var id: String { hostId }
    public var hostId: String
    public var hostname: String?
    public var state: String

    public init(hostId: String, hostname: String?, state: String) {
        self.hostId = hostId
        self.hostname = hostname
        self.state = state
    }
}

public struct BotRemoteHostsAnswer: Decodable, Equatable, Sendable {
    public var available: Bool
    public var hosts: [UnattendedHostRow]
    public var catalog: [UnattendedHostRow]
    public var attached: [String]

    public init(available: Bool = false, hosts: [UnattendedHostRow] = [], catalog: [UnattendedHostRow] = [], attached: [String] = []) {
        self.available = available
        self.hosts = hosts
        self.catalog = catalog
        self.attached = attached
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        available = try container.decodeIfPresent(Bool.self, forKey: .available) ?? false
        hosts = try container.decodeIfPresent([UnattendedHostRow].self, forKey: .hosts) ?? []
        catalog = try container.decodeIfPresent([UnattendedHostRow].self, forKey: .catalog) ?? []
        attached = try container.decodeIfPresent([String].self, forKey: .attached) ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case available, hosts, catalog, attached
    }
}

/// One temporary (attended) remote-support session for Details.
public struct RemoteSessionView: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var code: String
    public var state: String
    public var os: String?
    public var endAt: String?
    public var hostname: String?
    public var user: String?
    public var createdAt: Double?

    public init(id: String, code: String, state: String, os: String? = nil, endAt: String? = nil, hostname: String? = nil, user: String? = nil, createdAt: Double? = nil) {
        self.id = id
        self.code = code
        self.state = state
        self.os = os
        self.endAt = endAt
        self.hostname = hostname
        self.user = user
        self.createdAt = createdAt
    }
}

public struct RemoteSessionsAnswer: Decodable, Equatable, Sendable {
    public var sessions: [RemoteSessionView]

    public init(sessions: [RemoteSessionView] = []) {
        self.sessions = sessions
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        sessions = try container.decodeIfPresent([RemoteSessionView].self, forKey: .sessions) ?? []
    }

    private enum CodingKeys: String, CodingKey { case sessions }
}

public struct RemoteHostPlace: Equatable, Sendable, Identifiable {
    public var id: String { hostId }
    public var hostId: String
    public var label: String
    public var state: String
    public var attached: Bool
}

public enum RemoteBotHostsLogic {
    /// Readable label only; never the opaque `h_…` id.
    public static func label(hostname: String?, fallback: String = "Remote") -> String {
        let name = hostname?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return name.isEmpty ? fallback : name
    }

    public static func placeKey(hostId: String) -> String { "host:\(hostId)" }

    public static func parsePlaceKey(_ key: String) -> String? {
        guard key.hasPrefix("host:") else { return nil }
        let id = String(key.dropFirst(5))
        return id.hasPrefix("h_") ? id : nil
    }

    /// Catalog enrolled hosts plus attached non-revoked ones, for the Computer picker.
    public static func places(attached: [String], catalog: [UnattendedHostRow], fallback: String = "Remote") -> [RemoteHostPlace] {
        let want = Set(attached)
        var seen = Set<String>()
        var out: [RemoteHostPlace] = []
        for row in catalog {
            if row.state == "revoked" { continue }
            let isAttached = want.contains(row.hostId)
            if !isAttached && row.state != "enrolled" { continue }
            if seen.contains(row.hostId) { continue }
            seen.insert(row.hostId)
            out.append(RemoteHostPlace(
                hostId: row.hostId,
                label: label(hostname: row.hostname, fallback: fallback),
                state: row.state,
                attached: isAttached
            ))
        }
        return out
    }

    /// Connected temporary sessions that do not belong to an attached unattended host.
    public static func temporarySessions(_ sessions: [RemoteSessionView], attachedHosts: [UnattendedHostRow]) -> [RemoteSessionView] {
        let names = Set(attachedHosts.compactMap { $0.hostname?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }.filter { !$0.isEmpty })
        return sessions.filter { row in
            guard row.state == "connected" else { return false }
            let name = row.hostname?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
            if !name.isEmpty && names.contains(name) { return false }
            return true
        }
    }

    public static func sessionTitle(_ view: RemoteSessionView) -> String {
        label(hostname: view.hostname, fallback: view.code)
    }
}
