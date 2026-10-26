import Foundation

// Wire models for the Settings sheet (iOS parity 12/14), Account (16), Bot
// Computer (21) and Plugins (15). Each type names the route it mirrors; the
// shapes are the ones docs/ios-companion.md "Visual parity routes" documents
// and server/routes/*.ts return.

// MARK: - GET /api/auth/session (the account card)

/// Who the account card shows. A server-paired phone gets the person's name
/// and email (organization server); through the companion sidecar a personal
/// computer answers its owner's `name` and `computerName`, never an email.
public struct AccountIdentity: Decodable, Equatable, Sendable {
    public var kind: String
    public var name: String?
    public var email: String?
    public var computerName: String?
    public var avatarUrl: String?
    public var scopes: [String]

    public init(kind: String = "session", name: String? = nil, email: String? = nil, computerName: String? = nil, avatarUrl: String? = nil, scopes: [String] = []) {
        self.kind = kind
        self.name = name
        self.email = email
        self.computerName = computerName
        self.avatarUrl = avatarUrl
        self.scopes = scopes
    }

    /// The photo this phone may request from its own server, or nil.
    public var avatar: AccountAvatar? { AccountAvatar(avatarUrl) }

    private enum CodingKeys: String, CodingKey { case kind, name, email, computerName, avatarUrl, scopes, label }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        kind = (try? values.decodeIfPresent(String.self, forKey: .kind)) ?? "session"
        func text(_ key: CodingKeys) -> String? {
            guard let raw = try? values.decodeIfPresent(String.self, forKey: key) else { return nil }
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
        name = text(.name)
        email = text(.email)
        computerName = text(.computerName)
        avatarUrl = text(.avatarUrl)
        scopes = (try? values.decodeIfPresent([String].self, forKey: .scopes)) ?? []
    }

    /// The card's first line: the person, else the computer's owner, else
    /// the connection's own name (`fallback`).
    public func displayName(fallback: String) -> String {
        name ?? email ?? fallback
    }

    /// The card's second line: the email on an organization server, the
    /// computer's name on a personal one.
    public var detail: String? {
        if let email, email != name { return email }
        return computerName
    }
}

// MARK: - GET/PUT /api/settings/bot

public struct BotSettings: Codable, Equatable, Sendable {
    public var autoReviewDefault: Bool
    /// An IANA zone, or nil for the server's own.
    public var timeZone: String?
    public var timeZoneAuto: Bool

    public init(autoReviewDefault: Bool = false, timeZone: String? = nil, timeZoneAuto: Bool = false) {
        self.autoReviewDefault = autoReviewDefault
        self.timeZone = timeZone
        self.timeZoneAuto = timeZoneAuto
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        autoReviewDefault = (try? values.decodeIfPresent(Bool.self, forKey: .autoReviewDefault)) ?? false
        timeZone = try? values.decodeIfPresent(String.self, forKey: .timeZone)
        timeZoneAuto = (try? values.decodeIfPresent(Bool.self, forKey: .timeZoneAuto)) ?? false
    }

    private enum CodingKeys: String, CodingKey { case autoReviewDefault, timeZone, timeZoneAuto }
}

public struct BotSettingsResponse: Decodable, Equatable, Sendable {
    public var settings: BotSettings
    /// "server" (personal computer, or the console) or "person".
    public var scope: String?
    public var hostTimeZone: String?
    public var effectiveTimeZone: String?

    /// What the Time Zone row shows.
    public var displayTimeZone: String? { settings.timeZone ?? effectiveTimeZone ?? hostTimeZone }
}

/// A partial `PUT /api/settings/bot`: only the fields set are sent.
public struct BotSettingsPatch: Encodable, Equatable, Sendable {
    public var autoReviewDefault: Bool?
    public var timeZone: String?
    public var timeZoneAuto: Bool?

    public init(autoReviewDefault: Bool? = nil, timeZone: String? = nil, timeZoneAuto: Bool? = nil) {
        self.autoReviewDefault = autoReviewDefault
        self.timeZone = timeZone
        self.timeZoneAuto = timeZoneAuto
    }

    public var isEmpty: Bool { autoReviewDefault == nil && timeZone == nil && timeZoneAuto == nil }
}

// MARK: - GET /api/auto-review/rules

public struct AutoReviewRule: Decodable, Hashable, Identifiable, Sendable {
    public var id: String
    public var scope: String
    public var botId: String?
    public var botName: String?
    public var command: String
    public var cwd: String
    public var providerInstanceId: String?
}

public struct AutoReviewRules: Decodable, Equatable, Sendable {
    public var rules: [AutoReviewRule]
    public var global: [AutoReviewRule]
    public var total: Int

    public init(rules: [AutoReviewRule] = [], global: [AutoReviewRule] = [], total: Int = 0) {
        self.rules = rules
        self.global = global
        self.total = total
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        rules = try values.decodeIfPresent([AutoReviewRule].self, forKey: .rules) ?? []
        global = try values.decodeIfPresent([AutoReviewRule].self, forKey: .global) ?? []
        total = try values.decodeIfPresent(Int.self, forKey: .total) ?? (rules.count + global.count)
    }

    private enum CodingKeys: String, CodingKey { case rules, global, total }

    /// Server-wide rules first, then each bot's.
    public var all: [AutoReviewRule] { global + rules }
}

// MARK: - /api/computer/status|update|reset

public struct ComputerStatus: Decodable, Equatable, Sendable {
    public enum Kind: String, Decodable, Sendable { case orgSandbox = "org-sandbox", local, unknown
        public init(from decoder: Decoder) throws {
            self = Kind(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
        }
    }

    public enum DiskState: String, Decodable, Sendable { case normal, almostFull, full
        public init(from decoder: Decoder) throws {
            self = DiskState(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .normal
        }
    }

    public var kind: Kind
    public var configured: Bool
    public var state: String
    public var diskState: DiskState
    public var workspaceBytes: Double?
    public var limitBytes: Double?
    public var version: String?
    public var problem: String?
    /// The cluster is waking. Absent on an older computer.
    public var waking: Waking?

    public struct Waking: Decodable, Equatable, Sendable {
        public var since: Double
        public var elapsedMs: Double
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        kind = (try? values.decodeIfPresent(Kind.self, forKey: .kind)) ?? .unknown
        configured = (try? values.decodeIfPresent(Bool.self, forKey: .configured)) ?? false
        state = (try? values.decodeIfPresent(String.self, forKey: .state)) ?? "unknown"
        diskState = (try? values.decodeIfPresent(DiskState.self, forKey: .diskState)) ?? .normal
        workspaceBytes = try? values.decodeIfPresent(Double.self, forKey: .workspaceBytes)
        limitBytes = try? values.decodeIfPresent(Double.self, forKey: .limitBytes)
        version = try? values.decodeIfPresent(String.self, forKey: .version)
        problem = try? values.decodeIfPresent(String.self, forKey: .problem)
        waking = try? values.decodeIfPresent(Waking.self, forKey: .waking)
    }

    private enum CodingKeys: String, CodingKey { case kind, configured, state, diskState, workspaceBytes, limitBytes, version, problem, waking }
}

struct ConfirmBody: Encodable {
    let confirm = true
}

struct EmptyJSONBody: Encodable {}

// MARK: - /api/plugins

/// One plugin a person can add: a reviewed catalog entry (`featured`) or a
/// community server from the MCP Registry.
public struct PluginListing: Decodable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var description: String
    public var url: String
    public var domain: String
    /// "oauth" | "api-key" | "none" | "headers" | "unknown".
    public var auth: String
    public var source: String
    public var reviewed: Bool
    /// A key for a bundled glyph tile (`shared/plugin-catalog.json` `icon`).
    public var icon: String?
    public var iconUrl: String?
    public var installed: Bool

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        name = try values.decodeIfPresent(String.self, forKey: .name) ?? id
        description = try values.decodeIfPresent(String.self, forKey: .description) ?? ""
        url = try values.decodeIfPresent(String.self, forKey: .url) ?? ""
        domain = try values.decodeIfPresent(String.self, forKey: .domain) ?? ""
        auth = try values.decodeIfPresent(String.self, forKey: .auth) ?? "unknown"
        source = try values.decodeIfPresent(String.self, forKey: .source) ?? "featured"
        reviewed = try values.decodeIfPresent(Bool.self, forKey: .reviewed) ?? false
        icon = try values.decodeIfPresent(String.self, forKey: .icon)
        iconUrl = try values.decodeIfPresent(String.self, forKey: .iconUrl)
        installed = try values.decodeIfPresent(Bool.self, forKey: .installed) ?? false
    }

    private enum CodingKeys: String, CodingKey { case id, name, description, url, domain, auth, source, reviewed, icon, iconUrl, installed }

    /// A header key the phone cannot type: the server refuses these from the phone.
    public var needsHeaders: Bool { auth == "headers" || auth == "api-key" }
    /// Community entries ask for an explicit trust confirmation.
    public var isCommunity: Bool { id.hasPrefix("registry:") }
}

public struct PluginSearchPage: Decodable, Equatable, Sendable {
    public var featured: [PluginListing]
    public var results: [PluginListing]
    public var nextCursor: String?
    public var registryAvailable: Bool

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        featured = try values.decodeIfPresent([PluginListing].self, forKey: .featured) ?? []
        results = try values.decodeIfPresent([PluginListing].self, forKey: .results) ?? []
        nextCursor = try values.decodeIfPresent(String.self, forKey: .nextCursor)
        registryAvailable = try values.decodeIfPresent(Bool.self, forKey: .registryAvailable) ?? false
    }

    private enum CodingKeys: String, CodingKey { case featured, results, nextCursor, registryAvailable }
}

/// An installed plugin: an MCP server.
public enum InstalledPlugin: Decodable, Hashable, Identifiable, Sendable {
    case mcp(name: String, url: String, domain: String, enabled: Bool, auth: String, icon: String?, catalogId: String?)

    public var id: String {
        switch self {
        case let .mcp(name, _, _, _, _, _, _): "mcp:\(name)"
        }
    }

    public var name: String {
        switch self {
        case let .mcp(name, _, _, _, _, _, _): name
        }
    }

    public var domain: String? {
        switch self {
        case let .mcp(_, _, domain, _, _, _, _): domain
        }
    }

    public var iconKey: String? {
        switch self {
        case let .mcp(_, _, _, _, _, icon, _): icon
        }
    }

    public var catalogId: String? {
        if case let .mcp(_, _, _, _, _, _, catalogId) = self { return catalogId }
        return nil
    }

    public var url: String? {
        if case let .mcp(_, url, _, _, _, _, _) = self { return url }
        return nil
    }

    /// Ready to use: an MCP server that needs no sign-in now.
    public var isReady: Bool {
        switch self {
        case let .mcp(_, _, _, enabled, auth, _, _): enabled && auth != "required" && auth != "expired"
        }
    }

    /// An MCP server whose sign-in is pending: the row offers it.
    public var needsSignIn: Bool {
        if case let .mcp(_, _, _, _, auth, _, _) = self { return auth == "required" || auth == "expired" }
        return false
    }

    private enum CodingKeys: String, CodingKey { case kind, name, url, domain, enabled, auth, icon, catalogId }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        let url = try values.decodeIfPresent(String.self, forKey: .url) ?? ""
        self = .mcp(
            name: try values.decode(String.self, forKey: .name),
            url: url,
            domain: try values.decodeIfPresent(String.self, forKey: .domain) ?? (URL(string: url)?.host ?? ""),
            enabled: try values.decodeIfPresent(Bool.self, forKey: .enabled) ?? true,
            auth: try values.decodeIfPresent(String.self, forKey: .auth) ?? "none",
            icon: try values.decodeIfPresent(String.self, forKey: .icon),
            catalogId: try values.decodeIfPresent(String.self, forKey: .catalogId)
        )
    }
}

public struct InstalledPlugins: Decodable, Equatable, Sendable {
    public var plugins: [InstalledPlugin]
    public var count: Int

    public init(plugins: [InstalledPlugin] = [], count: Int = 0) {
        self.plugins = plugins
        self.count = count
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        // One unreadable entry must not hide the rest.
        let rows = try values.decodeIfPresent([Lossy<InstalledPlugin>].self, forKey: .plugins) ?? []
        plugins = rows.compactMap(\.value)
        count = try values.decodeIfPresent(Int.self, forKey: .count) ?? plugins.count
    }

    private enum CodingKeys: String, CodingKey { case plugins, count }

    /// Installed MCP server addresses, to mark catalog rows "Added".
    public var installedURLs: Set<String> { Set(plugins.compactMap(\.url)) }
}

struct PluginInstallBody: Encodable {
    var id: String
    var trust: Bool?
    var returnTo: String?
    var callbackOrigin: String?
}

struct OAuthStartBody: Encodable {
    var returnTo: String
    var callbackOrigin: String?
}

/// `POST /api/plugins/install` (and the OAuth start): the server name it
/// was added under and, when a sign-in is needed, where to send the person.
public struct PluginInstallResult: Decodable, Equatable, Sendable {
    public var name: String?
    public var alreadyInstalled: Bool
    public var auth: String?
    public var authorizationUrl: URL?
    /// The server could not start the sign-in (for instance 409
    /// `callback_unreachable`): its own sentence.
    public var signInError: String?

    private enum CodingKeys: String, CodingKey { case name, alreadyInstalled, auth, authorizationUrl, signIn }
    private struct SignIn: Decodable { var error: String? }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        name = try values.decodeIfPresent(String.self, forKey: .name)
        alreadyInstalled = try values.decodeIfPresent(Bool.self, forKey: .alreadyInstalled) ?? false
        auth = try values.decodeIfPresent(String.self, forKey: .auth)
        authorizationUrl = (try values.decodeIfPresent(String.self, forKey: .authorizationUrl)).flatMap(URL.init(string:))
        signInError = (try? values.decodeIfPresent(SignIn.self, forKey: .signIn))??.error
    }

    /// A sign-in the phone has to run before the plugin works.
    public var needsSignIn: Bool { auth == "required" || auth == "expired" }
}

// MARK: - Plugin screen logic

public enum PluginFilter: String, CaseIterable, Sendable {
    case all, installed, notInstalled

    public func admits(installed: Bool) -> Bool {
        switch self {
        case .all: true
        case .installed: installed
        case .notInstalled: !installed
        }
    }
}

public enum PluginSignIn {
    /// The app address the server sends the sign-in sheet back to.
    public static let returnTo = "sagax://oauth-done"
    public static let callbackScheme = "sagax"

    /// The origin the phone reached a personal computer on, when the server
    /// can send an OAuth callback there: https, or http on a tailnet name.
    /// A server-paired phone sends none (the server uses its public address).
    public static func callbackOrigin(for connection: Connection) -> String? {
        guard !connection.pairedWithServer, let base = connection.baseURL,
              let scheme = base.scheme?.lowercased(), let host = base.host?.lowercased()
        else { return nil }
        guard scheme == "https" || (scheme == "http" && host.hasSuffix(".ts.net")) else { return nil }
        var components = URLComponents()
        components.scheme = scheme
        components.host = base.host
        components.port = base.port
        return components.url?.absoluteString
    }

    /// What `sagax://oauth-done?status=ok|error&server=...&error=...` says.
    public enum Outcome: Equatable, Sendable {
        case ok(server: String?)
        case failed(String?)
    }

    public static func outcome(of url: URL) -> Outcome {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func value(_ name: String) -> String? { items.first { $0.name == name }?.value }
        if value("status") == "ok" { return .ok(server: value("server")) }
        return .failed(value("error"))
    }
}

// MARK: - DELETE /api/me

public enum AccountDeletionOutcome: Equatable, Sendable {
    /// The account and its data are gone.
    case deleted
    /// 400 `personal_server`: nothing to delete there; forget the pairing.
    case personalServer
    /// 501 `perspicax_deletion_unavailable`: the organization must do it.
    case unavailable(String?)
    /// 409 `reauth_required` (2026-10-18): sign in again at Perspicax
    /// (`beginAccountReauth()`), then delete again. Nothing was deleted.
    case reauthRequired(String?)
}

/// How the sign-in again of an account deletion ended in the sheet.
public enum AccountReauthOutcome: Equatable, Sendable {
    case signedIn
    /// The server's refusal code (`reauth_subject`, `reauth_stale`, ...), if any.
    case failed(String?)
}

struct AccountReauthBody: Encodable {
    let client = "phone"
}

struct APIErrorWithCode: Decodable {
    var error: String?
    var code: String?
}
