import Foundation

// A bot's capabilities (« Capacités »): the one resolved list of what a bot
// receives on top of its engine, read from `GET /api/bots/:id/capabilities`
// (server/routes/bot-capabilities.ts, contract `shared/capabilities.ts`).
// The desktop's Bot > Capabilities, Connect apps > Installed, the Perspicax
// console and this app read the same list.
//
// Decoding is tolerant: a field or a value this build does not know never
// breaks the list (an unknown form, scope or state reads as `.other`, an
// unknown receipt stays `.unknown` and grants no received part, a row that
// does not decode is dropped). `key` and `botId` are never shown.
// The switches call the routes the app already uses: a plugin of the bot
// (`PATCH /api/bots/:id/plugins/:key`), a server of this installation (the
// bot's own list, `PATCH /api/bots/:id {mcpServers}`), a Perspicax Role
// (`PUT /api/bots/:id/perspicax`), a skill (`PATCH /api/bots/:id/skills/:name`,
// `PATCH /api/skills-library/:name`, `PUT /api/bots/:id/skills-library`).

public struct BotCapabilityList: Decodable, Hashable, Sendable {
    public struct Engine: Decodable, Hashable, Sendable {
        public var kind: String
        public var label: String

        public init(kind: String, label: String) { self.kind = kind; self.label = label }

        private enum CodingKeys: String, CodingKey { case kind, label }
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            kind = (try? c.decode(String.self, forKey: .kind)) ?? ""
            label = (try? c.decode(String.self, forKey: .label)) ?? ""
        }
    }

    /// The skills index of the prompt (#1748): bytes and count, caps, omitted.
    public struct PromptIndex: Decodable, Hashable, Sendable {
        public var bytes: Int
        public var maxBytes: Int
        public var skills: Int
        public var maxSkills: Int
        public var omitted: Int
        public var incomplete: Bool

        private enum CodingKeys: String, CodingKey { case bytes, maxBytes, skills, maxSkills, omitted, incomplete }
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            func int(_ key: CodingKeys) -> Int { (try? c.decode(Int.self, forKey: key)) ?? 0 }
            bytes = int(.bytes); maxBytes = int(.maxBytes); skills = int(.skills); maxSkills = int(.maxSkills); omitted = int(.omitted)
            incomplete = (try? c.decode(Bool.self, forKey: .incomplete)) ?? false
        }

        /// The index left skills out: the screens say so.
        public var cuts: Bool { incomplete || omitted > 0 || bytes > maxBytes || skills > maxSkills }
    }

    public var engine: Engine
    public var items: [BotCapability]
    public var promptIndex: PromptIndex?

    private enum CodingKeys: String, CodingKey { case engine, items, promptIndex }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        engine = (try? c.decode(Engine.self, forKey: .engine)) ?? Engine(kind: "", label: "")
        items = ((try? c.decode([Lossy<BotCapability>].self, forKey: .items)) ?? []).compactMap(\.value)
        promptIndex = try? c.decodeIfPresent(PromptIndex.self, forKey: .promptIndex)
    }
}

public struct BotCapability: Decodable, Hashable, Identifiable, Sendable {
    public enum Form: String, Hashable, Sendable { case plugin, skill, mcp, connector, role, flow, other }
    public enum Scope: String, Hashable, Sendable { case bot, me, organization, installation, account, other }
    public enum State: String, Hashable, Sendable {
        case on, off, toConnect = "to_connect", imposed, notHeld = "not_held", notServed = "not_served", reserved, unverifiable, other
    }
    public enum Receipt: String, Hashable, Sendable { case native, prompt, mounted, proxied, none, unknown }

    /// What the bot's engine receives of this capability (`EngineReceipt`).
    public struct EngineReceipt: Decodable, Hashable, Sendable {
        public var skills: Receipt?
        public var commands: Receipt?
        public var agents: Receipt?
        public var mcp: Receipt?
        public var tools: Receipt?
        public var nothing: Bool

        public init(skills: Receipt? = nil, commands: Receipt? = nil, agents: Receipt? = nil, mcp: Receipt? = nil, tools: Receipt? = nil, nothing: Bool) {
            self.skills = skills; self.commands = commands; self.agents = agents; self.mcp = mcp; self.tools = tools; self.nothing = nothing
        }

        private enum CodingKeys: String, CodingKey { case skills, commands, agents, mcp, tools, nothing }
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            // Keep future values unknown. This app cannot claim which
            // instructions or tools that mode actually supplies.
            func part(_ key: CodingKeys) -> Receipt? {
                guard let raw = try? c.decode(String.self, forKey: key) else { return nil }
                return Receipt(rawValue: raw) ?? .unknown
            }
            skills = part(.skills); commands = part(.commands); agents = part(.agents); mcp = part(.mcp); tools = part(.tools)
            let received = [skills, commands, agents, mcp, tools].contains { Self.received($0) }
            nothing = ((try? c.decode(Bool.self, forKey: .nothing)) ?? false) || !received
        }

        private static func received(_ part: Receipt?) -> Bool { part != nil && part != Receipt.none && part != .unknown }
        func gets(_ part: Receipt?) -> Bool { Self.received(part) }
        /// Skills or commands reach the engine.
        public var skillsOrCommands: Bool { gets(skills) || gets(commands) }
        public var agentsReceived: Bool { gets(agents) }
        /// An MCP server or its tools reach the engine.
        public var serversOrTools: Bool { gets(mcp) || gets(tools) }
    }

    public struct Brings: Decodable, Hashable, Sendable {
        public var skills: [String]
        public var commands: [String]
        public var agents: [String]
        public var mcpServers: [String]

        private enum CodingKeys: String, CodingKey { case skills, commands, agents, mcpServers }
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            func list(_ key: CodingKeys) -> [String] { (try? c.decode([String].self, forKey: key)) ?? [] }
            skills = list(.skills); commands = list(.commands); agents = list(.agents); mcpServers = list(.mcpServers)
        }
    }

    /// Stable, never shown (ex. "plugin:bot:name@market").
    public var key: String
    public var form: Form
    /// Readable. Empty for a Role Perspicax no longer lists: the screens
    /// name it as such, never by its id.
    public var name: String
    public var description: String?
    public var sourceLabel: String
    public var sourceVersion: String?
    public var scope: Scope
    public var state: State
    public var enabled: Bool
    public var canToggle: Bool
    public var updateAvailable: Bool
    public var brings: Brings?
    public var engine: EngineReceipt
    /// `connect.reason`: sign_in, token, github, environment, account, key.
    public var connectReason: String?
    /// Why it is off, to connect or not served (`CapabilityReason`).
    public var reason: String?
    public var installedBy: String?
    public var id: String { key }

    private struct Source: Decodable { var label: String?; var version: String? }
    private struct Connect: Decodable { var reason: String? }
    private enum CodingKeys: String, CodingKey {
        case key, form, name, description, source, scope, state, enabled, canToggle, updateAvailable, brings, engine, connect, reason, installedBy
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        key = try c.decode(String.self, forKey: .key)
        func raw(_ key: CodingKeys) -> String { (try? c.decode(String.self, forKey: key)) ?? "" }
        form = Form(rawValue: raw(.form)) ?? .other
        scope = Scope(rawValue: raw(.scope)) ?? .other
        state = State(rawValue: raw(.state)) ?? .other
        name = raw(.name)
        description = (try? c.decode(String.self, forKey: .description)).flatMap { $0.isEmpty ? nil : $0 }
        let source = try? c.decode(Source.self, forKey: .source)
        sourceLabel = source?.label ?? ""
        sourceVersion = source?.version.flatMap { $0.isEmpty ? nil : $0 }
        enabled = (try? c.decode(Bool.self, forKey: .enabled)) ?? false
        canToggle = (try? c.decode(Bool.self, forKey: .canToggle)) ?? false
        updateAvailable = (try? c.decode(Bool.self, forKey: .updateAvailable)) ?? false
        brings = try? c.decode(Brings.self, forKey: .brings)
        engine = (try? c.decode(EngineReceipt.self, forKey: .engine)) ?? EngineReceipt(nothing: true)
        connectReason = (try? c.decode(Connect.self, forKey: .connect))?.reason
        reason = try? c.decode(String.self, forKey: .reason)
        installedBy = try? c.decode(String.self, forKey: .installedBy)
    }

    /// Served to this bot: on (or imposed) and its engine receives something.
    public var served: Bool { (state == .on || state == .imposed) && !engine.nothing }

    /// What the switch does, from the key's form and scope; nil when the
    /// row has no switch this app can drive.
    public var toggle: BotCapabilityToggle? {
        guard canToggle else { return nil }
        let parts = key.split(separator: ":", maxSplits: 2, omittingEmptySubsequences: false).map(String.init)
        guard parts.count == 3, !parts[2].isEmpty else { return nil }
        switch (parts[0], parts[1]) {
        case ("plugin", "bot"): return BotPluginRules.validKey(parts[2]) ? .plugin(key: parts[2]) : nil
        // a server the installation turned off: the bot's list cannot bring it back
        case ("mcp", "installation"): return reason == "disabled" ? nil : .installationServer(name: parts[2])
        case ("role", "bot"): return .role(id: parts[2])
        case ("skill", "bot"), ("skill", "organization"): return SkillRules.validName(parts[2]) ? .skill(name: parts[2]) : nil
        // a library skill assigned while the library is off: the library
        // routes answer 404 until it is on again, so there is no switch
        case ("skill", "installation"): return SkillRules.validName(parts[2]) && reason != "library_off" ? .librarySkill(name: parts[2]) : nil
        default: return nil
        }
    }
}

public enum BotCapabilityToggle: Hashable, Sendable {
    case plugin(key: String)
    case installationServer(name: String)
    case role(id: String)
    case skill(name: String)
    case librarySkill(name: String)

    /// Switching on a skill shows its text first, as the Skills section
    /// does: an import is not necessarily reviewed.
    public func needsReview(on: Bool) -> Bool {
        guard on else { return false }
        switch self {
        case .skill, .librarySkill: return true
        default: return false
        }
    }
}

/// The box « What <bot> receives (engine: X) »: the names that reach the
/// engine, grouped, and what it does not receive.
public struct BotCapabilityReceipt: Hashable, Sendable {
    public var skillsAndCommands: [String]
    public var agents: [String]
    public var servers: [String]
    public var notServed: [String]

    public init(_ list: BotCapabilityList) {
        let named = list.items.filter { !$0.name.isEmpty }
        skillsAndCommands = named.filter { $0.served && $0.engine.skillsOrCommands }.map(\.name)
        agents = named.filter { $0.served && $0.engine.agentsReceived }.map(\.name)
        servers = named.filter { $0.served && $0.engine.serversOrTools }.map(\.name)
        notServed = named.filter { $0.state == .notServed }.map(\.name)
    }

    public var isEmpty: Bool { skillsAndCommands.isEmpty && agents.isEmpty && servers.isEmpty && notServed.isEmpty }
}

public enum BotCapabilityRules {
    /// The pairings that reach the route: a server (an admin session, or a
    /// member of an organization), never the companion sidecar. The same
    /// gate as the bot's plugins.
    public static func reachable(gate: SurfaceGate) -> Bool {
        gate.allows(.botPlugins)
    }

    /// The bot's own list of this installation's servers after one switch.
    /// A bot without its own list mounts every server of the installation:
    /// the edit starts from all the names the list knows (a server the
    /// installation turned off stays off whatever the bot's list says).
    public static func mcpServersAfter(_ current: [String]?, list: BotCapabilityList, name: String, on: Bool) -> [String] {
        var base = current ?? installationServerNames(list)
        if on {
            if !base.contains(name) { base.append(name) }
        } else {
            base.removeAll { $0 == name }
        }
        return base
    }

    /// Every server of this installation the list names: its own rows and
    /// the servers a plugin "Everyone" folds into its row.
    public static func installationServerNames(_ list: BotCapabilityList) -> [String] {
        var names: [String] = []
        for item in list.items where item.scope == .installation && item.state != .reserved {
            if item.form == .mcp, item.key.hasPrefix("mcp:installation:") {
                names.append(String(item.key.dropFirst("mcp:installation:".count)))
            } else if item.form == .plugin {
                names.append(contentsOf: item.brings?.mcpServers ?? [])
            }
        }
        var seen = Set<String>()
        return names.filter { seen.insert($0).inserted }
    }

    /// The bot's Perspicax Roles after switching one off (a Role on the bot
    /// is on; its switch takes it off the bot).
    public static func rolesAfter(_ list: BotCapabilityList, removing id: String) -> [String] {
        list.items.compactMap { item -> String? in
            guard item.form == .role, item.key.hasPrefix("role:bot:") else { return nil }
            let role = String(item.key.dropFirst("role:bot:".count))
            return role == id ? nil : role
        }
    }
}

private struct AssignedSkillsBody: Decodable { var assignedSkills: [String]? }
private struct LibrarySkillTextAnswer: Decodable { var text: String? }

public extension CompanionClient {
    /// `GET /api/bots/:id/capabilities[?engine=<instanceId>]`.
    func botCapabilitiesRequest(botId: String, engine: String? = nil) throws -> URLRequest {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        let query = engine.map { [URLQueryItem(name: "engine", value: $0)] } ?? []
        return try makeRequest("GET", "/api/bots/\(botId)/capabilities", query: query)
    }

    func botCapabilities(botId: String, engine: String? = nil) async throws -> BotCapabilityList {
        try await send(botCapabilitiesRequest(botId: botId, engine: engine), as: BotCapabilityList.self)
    }

    /// `GET /api/bots/:id/skills`: the library skills assigned to the bot.
    func botAssignedSkills(botId: String) async throws -> [String] {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try await send(makeRequest("GET", "/api/bots/\(botId)/skills"), as: AssignedSkillsBody.self).assignedSkills ?? []
    }

    func setBotLibrarySkillsRequest(botId: String, skills: [String]) throws -> URLRequest {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try makeRequest("PUT", "/api/bots/\(botId)/skills-library", body: ["skills": skills])
    }

    /// `PUT /api/bots/:id/skills-library {skills}`: the library skills of the bot.
    func setBotLibrarySkills(botId: String, skills: [String]) async throws {
        try await send(setBotLibrarySkillsRequest(botId: botId, skills: skills))
    }

    /// The SKILL.md a switch shows before it turns a skill on.
    func capabilitySkillText(botId: String, toggle: BotCapabilityToggle) async throws -> String? {
        switch toggle {
        case let .skill(name): return try await skillText(botId: botId, name: name)
        case let .librarySkill(name):
            guard SkillRules.validName(name) else { throw APIError.badURL }
            return try await send(makeRequest("GET", "/api/skills-library/\(name)"), as: LibrarySkillTextAnswer.self).text
        default: return nil
        }
    }

    /// One switch of the list, through the route the app already uses for
    /// that kind. `mcpServers` is the bot's own list of servers (nil: every
    /// server); the answer is the bot when the route returns it.
    @discardableResult
    func setBotCapability(botId: String, toggle: BotCapabilityToggle, on: Bool, list: BotCapabilityList, mcpServers: [String]?) async throws -> Bot? {
        switch toggle {
        case let .plugin(key):
            _ = try await setBotPluginEnabled(botId: botId, key: key, enabled: on)
        case let .installationServer(name):
            let next = BotCapabilityRules.mcpServersAfter(mcpServers, list: list, name: name, on: on)
            return try await patchBotFields(botId: botId, patch: ["mcpServers": .strings(next)])
        case let .role(id):
            // a Role on the bot is on: its switch only takes it off
            guard !on else { return nil }
            _ = try await setBotPerspicax(botId: botId, profiles: BotCapabilityRules.rolesAfter(list, removing: id))
        case let .skill(name):
            try await setSkillEnabled(botId: botId, name: name, enabled: on)
        case let .librarySkill(name):
            if on {
                // shared by every bot it is assigned to: its review state
                try await setLibrarySkill(name: name, enabled: true)
            } else {
                // off for this bot only: no longer assigned to it
                let current = try await botAssignedSkills(botId: botId)
                try await setBotLibrarySkills(botId: botId, skills: current.filter { $0 != name })
            }
        }
        return nil
    }
}
