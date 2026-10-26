import Foundation

// Wire models for the visual-parity screens (profile, settings, plugins,
// bot computer). Kept apart from Models.swift so the parity work and the
// mascot port can land independently. Each type mirrors one existing server
// route; the route and the shape it answers are named on the type.

// MARK: - PATCH /api/bots/:id

/// The generic bot edit. Only the fields set are sent; JSON `null` is never
/// written, so an absent field always means "leave it alone".
///
/// What a paired phone may change is decided by the server: a client
/// session gets display fields (`pinned`, `color`), an organization member
/// their own bot's identity (`name`, `title`, `soul`). Mascot fields live in
/// `BotProfilePatch`.
public struct BotPatch: Encodable, Equatable, Sendable {
    public var pinned: Bool?
    public var color: String?
    public var notifications: Bool?
    public var soul: String?
    public var title: String?
    public var name: String?
    /// The character and its look; a client session may set it (display field).
    public var mascotLook: MascotLook?
    /// The owl's special edition.
    public var mascotSkin: MascotSkin?
    /// Archived (`hidden`): out of the sidebar, every conversation kept;
    /// restored by sending false (the desktop's Archive and Archived bots).
    public var hidden: Bool?

    public init(
        pinned: Bool? = nil,
        color: String? = nil,
        notifications: Bool? = nil,
        soul: String? = nil,
        title: String? = nil,
        name: String? = nil,
        mascotLook: MascotLook? = nil,
        mascotSkin: MascotSkin? = nil,
        hidden: Bool? = nil
    ) {
        self.pinned = pinned
        self.color = color
        self.notifications = notifications
        self.soul = soul
        self.title = title
        self.name = name
        self.mascotLook = mascotLook
        self.mascotSkin = mascotSkin
        self.hidden = hidden
    }

    public var isEmpty: Bool {
        pinned == nil && color == nil && notifications == nil && soul == nil && title == nil && name == nil
            && mascotLook == nil && mascotSkin == nil && hidden == nil
    }
}

/// `DELETE /api/bots/:id` answers `{ ok: true }` (or the lifecycle's own body).
public struct DeletedBot: Decodable, Equatable, Sendable {
    public var ok: Bool?
}

// MARK: - GET /api/bots/:id/soul

public struct BotSoul: Decodable, Equatable, Sendable {
    public var soul: String
    public var revision: String?
    public var bytes: Int?
    public var limit: Int?
    /// True when the SOUL.md on disk no longer matches the stored text.
    public var drift: Bool?
    /// Where SOUL.md is mirrored on the computer (the panel's footnote).
    public var file: String?

    private enum CodingKeys: String, CodingKey { case soul, revision, bytes, limit, drift, file }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        soul = try values.decodeIfPresent(String.self, forKey: .soul) ?? ""
        // The revision is a string today; tolerate a number from an older server.
        if let text = try? values.decodeIfPresent(String.self, forKey: .revision) {
            revision = text
        } else if let number = try? values.decodeIfPresent(Double.self, forKey: .revision) {
            revision = String(format: "%.0f", number)
        } else {
            revision = nil
        }
        bytes = try values.decodeIfPresent(Int.self, forKey: .bytes)
        limit = try values.decodeIfPresent(Int.self, forKey: .limit)
        drift = try values.decodeIfPresent(Bool.self, forKey: .drift)
        file = try? values.decodeIfPresent(String.self, forKey: .file)
    }

    /// The first non-empty line, for search subtitles.
    public var lead: String? {
        soul.split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .first { !$0.isEmpty }
            .map { $0.hasPrefix("#") ? $0.drop(while: { $0 == "#" }).trimmingCharacters(in: .whitespaces) : $0 }
    }
}

// MARK: - GET /api/threads/:id/files

/// One file of a conversation: an upload, a bot attachment, a linked file or
/// one a tool wrote. `id` is opaque; bytes come from
/// `/api/threads/:threadId/files/:id` (`preview=1` for an image thumbnail).
public struct ThreadFile: Decodable, Hashable, Identifiable, Sendable {
    public enum Source: String, Decodable, Sendable {
        case upload, attachment, link, written, unknown

        public init(from decoder: Decoder) throws {
            let raw = try decoder.singleValueContainer().decode(String.self)
            self = Source(rawValue: raw) ?? .unknown
        }
    }

    public var id: String
    public var messageId: String
    public var source: Source
    public var name: String
    public var mime: String?
    public var at: Double
    public var size: Int?
    public var available: Bool
    /// Where the message named it (a host path, a URL or a bare name).
    public var path: String
    /// The resolved absolute path on the computer, while it is available.
    public var localPath: String?

    private enum CodingKeys: String, CodingKey { case id, messageId, source, name, mime, at, size, available, path, localPath }

    public init(id: String, messageId: String = "", source: Source, name: String, mime: String? = nil, at: Double, size: Int? = nil, available: Bool = true, path: String = "", localPath: String? = nil) {
        self.id = id
        self.messageId = messageId
        self.source = source
        self.name = name
        self.mime = mime
        self.at = at
        self.size = size
        self.available = available
        self.path = path
        self.localPath = localPath
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        messageId = try values.decodeIfPresent(String.self, forKey: .messageId) ?? ""
        source = try values.decodeIfPresent(Source.self, forKey: .source) ?? .unknown
        name = try values.decodeIfPresent(String.self, forKey: .name) ?? ""
        mime = try values.decodeIfPresent(String.self, forKey: .mime)
        at = try values.decodeIfPresent(Double.self, forKey: .at) ?? 0
        size = try values.decodeIfPresent(Int.self, forKey: .size)
        available = try values.decodeIfPresent(Bool.self, forKey: .available) ?? false
        path = try values.decodeIfPresent(String.self, forKey: .path) ?? ""
        localPath = try values.decodeIfPresent(String.self, forKey: .localPath)
    }

    /// Media tab when true, Files tab otherwise. Falls back to the extension
    /// when the server did not record a type.
    public var isImage: Bool {
        if let mime { return mime.lowercased().hasPrefix("image/") }
        let ext = (name as NSString).pathExtension.lowercased()
        return ["png", "jpg", "jpeg", "gif", "webp", "heic"].contains(ext)
    }
}

struct ThreadFilesResponse: Decodable {
    var files: [ThreadFile]
}

// MARK: - GET /api/auth/session

/// Who this phone is signed in as. A server-paired phone gets `session`;
/// loopback is the desktop itself. Organization servers add the person.
public struct AuthSession: Decodable, Equatable, Sendable {
    public var kind: String
    public var id: String?
    public var label: String?
    public var scopes: [String]
    public var expiresAt: Double?
    public var environmentId: String?
    public var email: String?
    public var owner: String?
    public var name: String?
    public var principalId: String?
    public var role: String?
    /// The person's photo, when the server knows one: the versioned
    /// `/api/people/<id>/avatar?v=` route of their Perspicax avatar on an
    /// organization server (or a stored `/api/attachments/...` picture).
    /// Read through `avatar`; never an address to fetch as is.
    public var avatarUrl: String?
    /// `perspicax` on an organization server: the name and email are
    /// Perspicax's, and the person changes their own photo through
    /// PUT /api/me/avatar (2026-10-16).
    public var profileManagedBy: String?

    /// Whether this person may change their own photo from the phone.
    public var ownPhotoEditable: Bool { profileManagedBy == "perspicax" && kind == "session" && principalId != nil }

    /// The photo this phone may request from its own server, or nil.
    public var avatar: AccountAvatar? { AccountAvatar(avatarUrl) }

    private enum CodingKeys: String, CodingKey {
        case kind, id, label, scopes, expiresAt, environmentId, email, owner, name, principalId, role, avatarUrl, profileManagedBy
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        kind = try values.decodeIfPresent(String.self, forKey: .kind) ?? "session"
        id = try values.decodeIfPresent(String.self, forKey: .id)
        label = try values.decodeIfPresent(String.self, forKey: .label)
        scopes = try values.decodeIfPresent([String].self, forKey: .scopes) ?? []
        expiresAt = try values.decodeIfPresent(Double.self, forKey: .expiresAt)
        environmentId = try values.decodeIfPresent(String.self, forKey: .environmentId)
        email = try values.decodeIfPresent(String.self, forKey: .email)
        // `owner` is a name on an OMB Cloud home; ignore any other shape.
        owner = try? values.decodeIfPresent(String.self, forKey: .owner)
        name = try? values.decodeIfPresent(String.self, forKey: .name)
        principalId = try? values.decodeIfPresent(String.self, forKey: .principalId)
        role = try? values.decodeIfPresent(String.self, forKey: .role)
        // Only the server's own `avatarUrl`: an id_token `picture` names an
        // address on Perspicax, which the phone never calls.
        let avatar = try? values.decodeIfPresent(String.self, forKey: .avatarUrl)
        avatarUrl = avatar.flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 }
        profileManagedBy = try? values.decodeIfPresent(String.self, forKey: .profileManagedBy)
    }

    public var isAdmin: Bool { scopes.contains("admin") }
}

// MARK: - GET /api/usage

/// The settings "Usage %" row reads `budget.percent`; the row hides when the
/// server has no budget (null).
public struct UsageSummary: Decodable, Equatable, Sendable {
    public struct Budget: Decodable, Equatable, Sendable {
        public var month: String?
        public var monthlyUsd: Double?
        public var spentUsd: Double?
        public var percent: Int
        public var warnAtPercent: Int?
        public var warn: Bool?
        public var exceeded: Bool?
    }

    public var from: String?
    public var to: String?
    public var budget: Budget?

    /// Nil hides the row.
    public var budgetPercent: Int? { budget?.percent }
}

// MARK: - GET/PUT /api/me/preferences

/// A person's synced preferences on an organization server. Values are the
/// strings the desktop stores under the same keys (`omb-language`, ...).
public struct UserPreferences: Codable, Equatable, Sendable {
    public var stored: Bool
    public var preferences: [String: String]
    public var updatedAt: Double?

    public init(stored: Bool = false, preferences: [String: String] = [:], updatedAt: Double? = nil) {
        self.stored = stored
        self.preferences = preferences
        self.updatedAt = updatedAt
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        stored = try values.decodeIfPresent(Bool.self, forKey: .stored) ?? false
        preferences = try values.decodeIfPresent([String: String].self, forKey: .preferences) ?? [:]
        updatedAt = try values.decodeIfPresent(Double.self, forKey: .updatedAt)
    }

    public static let languageKey = "omb-language"
}

struct UserPreferencesBody: Encodable {
    var preferences: [String: String]
}

/// `PATCH /api/me/preferences`: the keys to set and the keys to remove.
struct UserPreferencesPatch: Encodable {
    var set: [String: String]
    var remove: [String]
}

// MARK: - GET /api/me/server-environment

/// The person's own server environment (organization servers). `configured`
/// false means the server has no provisioner.
public struct ServerEnvironmentStatus: Decodable, Equatable, Sendable {
    public struct Limits: Decodable, Equatable, Sendable {
        public var workspaceBytes: Double?
        public var memoryBytes: Double?
        public var cpus: Double?
    }

    public var configured: Bool
    public var state: String?
    public var lastUsedAt: Double?
    public var workspaceBytes: Double?
    public var overQuota: Bool?
    public var limits: Limits?
    public var idleMinutes: Int?
    public var pendingDeletionAt: Double?
    public var error: String?

    public init(
        configured: Bool,
        state: String? = nil,
        lastUsedAt: Double? = nil,
        workspaceBytes: Double? = nil,
        overQuota: Bool? = nil,
        limits: Limits? = nil,
        idleMinutes: Int? = nil,
        pendingDeletionAt: Double? = nil,
        error: String? = nil
    ) {
        self.configured = configured
        self.state = state
        self.lastUsedAt = lastUsedAt
        self.workspaceBytes = workspaceBytes
        self.overQuota = overQuota
        self.limits = limits
        self.idleMinutes = idleMinutes
        self.pendingDeletionAt = pendingDeletionAt
        self.error = error
    }

    /// "Disk space" on the Bot Computer screen.
    public enum DiskSpace: String, Sendable { case normal, almostFull, full, unknown }

    public var diskSpace: DiskSpace {
        if overQuota == true { return .full }
        guard let used = workspaceBytes, let cap = limits?.workspaceBytes, cap > 0 else {
            return configured && state != nil ? .normal : .unknown
        }
        let ratio = used / cap
        if ratio >= 1 { return .full }
        if ratio >= 0.9 { return .almostFull }
        return .normal
    }
}

struct ServerEnvironmentResetBody: Encodable {
    let confirm = true
}

public enum ServerEnvironmentPowerAction: String, Sendable {
    case start, shutdown, pause, resume
}

struct ServerEnvironmentPowerBody: Encodable {
    var action: String
    var confirm: Bool?

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(action, forKey: .action)
        if let confirm { try c.encode(confirm, forKey: .confirm) }
    }

    private enum CodingKeys: String, CodingKey { case action, confirm }
}

/// `GET /api/desktop-viewer/sandbox/me` (SandboxDesktopView).
public struct SandboxViewerConfig: Decodable, Equatable, Sendable {
    public var password: String?
    public var viewOnly: Bool?
}

// MARK: - GET /api/mcp/servers

public struct MCPServerListing: Decodable, Hashable, Identifiable, Sendable {
    public var name: String
    /// Where it came from: absent for one added by hand, else the marketplace
    /// that installed it (#206).
    public var source: String? = nil
    public var type: String?
    public var url: String?
    public var command: String?
    public var enabled: Bool?
    /// OAuth state for a remote server: "none", "required", "connected", ...
    public var auth: String?
    /// Set when an organization policy keeps this server from bots.
    public var managedBy: String?
    /// A command server's arguments, and the names (never the values) of
    /// its saved environment variables.
    public var args: [String]? = nil
    public var envKeys: [String]? = nil
    /// A URL server's saved header names (never the values).
    public var headerKeys: [String]? = nil
    /// Why the last sign-in or refresh failed, in the server's words.
    public var authError: String? = nil
    /// Who signs the person in (a host), when the server knows.
    public var authIssuer: String? = nil

    public var id: String { name }
    public var isRemote: Bool { url != nil }
}

public struct MCPServersResponse: Decodable, Equatable, Sendable {
    public struct Managed: Decodable, Equatable, Sendable {
        public var organizationName: String
    }

    public var servers: [MCPServerListing]
    public var managed: Managed?
}

// MARK: - GET /api/bots/:id/command-allowlist

public struct CommandAllowlistRule: Decodable, Hashable, Identifiable, Sendable {
    public var id: String
    public var command: String
    public var cwd: String
    public var providerInstanceId: String
}

public struct CommandAllowlist: Decodable, Equatable, Sendable {
    public struct Context: Decodable, Equatable, Sendable {
        public var providerInstanceId: String
        public var cwd: String?
    }

    public var rules: [CommandAllowlistRule]
    public var context: Context?
    public var supported: Bool

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        rules = try values.decodeIfPresent([CommandAllowlistRule].self, forKey: .rules) ?? []
        context = try values.decodeIfPresent(Context.self, forKey: .context)
        supported = try values.decodeIfPresent(Bool.self, forKey: .supported) ?? false
    }

    private enum CodingKeys: String, CodingKey { case rules, context, supported }
}

// MARK: - Routine runs

public extension Array where Element == RoutineRun {
    /// Run history for one routine, newest first.
    func forRoutine(_ routineId: String) -> [RoutineRun] {
        filter { $0.routineId == routineId }
            .sorted { ($0.startedAt ?? $0.scheduledFor) > ($1.startedAt ?? $1.scheduledFor) }
    }
}
