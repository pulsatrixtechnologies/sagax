// Connect apps (#203, #206, #207, #218; matrix DC35 to DC39): the desktop
// Plugins panel's one list of MCP servers the person added, the reviewed
// plugin catalog, library skills and marketplace plugins, read as rows of
// one kind. A port of src/lib/plugins-model.ts: pure functions, so the
// phone's main view, Manage and the detail page sort, search and section
// exactly as the desktop does.
//
// Routes (the desktop's own): GET/PATCH /api/mcp/servers ({ disabledTools }),
// POST /api/mcp/servers/:name/test, GET /api/plugins/search (featured), GET
// /api/skills-library (and :name), GET /api/marketplaces.
import Foundation

public enum ConnectAppKind: String, Hashable, Sendable {
    case mcp, featured, skill, plugin
}

/// The chips: All, then the main categories in the reference order, then
/// the ones under More.
public enum ConnectAppCategory: String, CaseIterable, Hashable, Sendable {
    case passwords, productivity, communication, design, code
    case data, sales, finance, marketing, research, support, other

    public static let main: [ConnectAppCategory] = [.passwords, .productivity, .communication, .design, .code]
    public static let more: [ConnectAppCategory] = [.data, .sales, .finance, .marketing, .research, .support, .other]
    public static let order: [ConnectAppCategory] = main + more

    /// `TAG_RULES`, first rule first.
    private static let rules: [(ConnectAppCategory, String)] = [
        (.passwords, #"\bpassword"#),
        (.support, #"\b(support|help ?desk|ticketing|customer service)\b"#),
        (.sales, #"\b(crm|sales|e-?commerce|commerce|leads?)\b"#),
        (.finance, #"\b(finance|financial|accounting|payments?|banking|invoic\w*|billing|tax|crypto\w*)\b"#),
        (.marketing, #"\b(marketing|advertising|ads|seo)\b"#),
        (.communication, #"\b(communication|email|e-mail|mail|messaging|chat|social|sms|phone|video conferencing|meetings?)\b"#),
        (.design, #"\b(design|creative|drawing|whiteboard\w*)\b"#),
        (.code, #"\b(developer|development|devops|code|coding|engineering|monitoring|deployment|hosting|infrastructure|cloud)\b"#),
        (.data, #"\b(analytics|data|databases?|business intelligence|bi|spreadsheets?)\b"#),
        (.research, #"\b(research|search|knowledge|news|education|learning|documentation|science|reference)\b"#),
        (.productivity, #"\b(productivity|project management|tasks?|documents?|files?|storage|notes?|calendar|scheduling|collaboration|workflows?|automation|forms?)\b"#),
    ]

    /// `categoryFromTags`: the category of the first tag a rule knows,
    /// `other` when none does. Never guessed from the name.
    public static func fromTags(_ tags: [String?]?) -> ConnectAppCategory {
        for tag in tags ?? [] {
            let text = (tag ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            guard !text.isEmpty else { continue }
            for (category, rule) in rules where text.range(of: rule, options: .regularExpression) != nil {
                return category
            }
        }
        return .other
    }
}

/// A chip of the main view: everything or one category.
public enum ConnectAppFilter: Hashable, Sendable {
    case all
    case category(ConnectAppCategory)
}

/// The small type filter at the end of the chip row.
public enum ConnectAppTypeFilter: Hashable, Sendable {
    case any, mcp, skills
    case source(String)
}

public enum ConnectAppStatus: String, Hashable, Sendable {
    case connected
    case needsAuth = "needs_auth"
    case pending, off, available
}

public enum ConnectAppAction: String, Hashable, Sendable {
    case add, connect
}

public struct ConnectAppItem: Hashable, Sendable, Identifiable {
    /// `<kind>:<id>`, unique across the list.
    public var key: String
    public var kind: ConnectAppKind
    public var id: String
    public var name: String
    public var description: String
    public var logo: String?
    public var domain: String?
    public var category: ConnectAppCategory
    /// Added or connected on this installation.
    public var installed: Bool
    public var status: ConnectAppStatus
    /// Add, Connect, or nothing (installed: the row opens the detail page).
    public var action: ConnectAppAction?
    /// "manual", "catalog", "local" or a marketplace name.
    public var source: String
    /// The row this one shows under (the marketplace plugin that brought it).
    public var parent: String?
    public var version: String?
    public var recommended = false
    /// The rows of other sources folded into this one (the same app).
    public var merged: [String] = []

    public init(
        key: String, kind: ConnectAppKind, id: String, name: String, description: String,
        logo: String? = nil, domain: String? = nil, category: ConnectAppCategory = .other,
        installed: Bool, status: ConnectAppStatus, action: ConnectAppAction?, source: String,
        parent: String? = nil, version: String? = nil, recommended: Bool = false, merged: [String] = []
    ) {
        self.key = key; self.kind = kind; self.id = id; self.name = name; self.description = description
        self.logo = logo; self.domain = domain; self.category = category; self.installed = installed
        self.status = status; self.action = action; self.source = source; self.parent = parent
        self.version = version; self.recommended = recommended; self.merged = merged
    }
}

// MARK: - Sources

/// A row of `GET /api/mcp/servers` as the list reads it.
public struct ConnectAppServer: Hashable, Sendable {
    public var name: String
    public var enabled: Bool
    public var url: String?
    public var command: String?
    public var auth: String?
    public var managedBy: String?
    public var source: String?

    public init(name: String, enabled: Bool = true, url: String? = nil, command: String? = nil, auth: String? = nil, managedBy: String? = nil, source: String? = nil) {
        self.name = name; self.enabled = enabled; self.url = url; self.command = command
        self.auth = auth; self.managedBy = managedBy; self.source = source
    }
}

/// A reviewed catalog entry (`featured` of `GET /api/plugins/search`).
public struct ConnectAppFeatured: Hashable, Sendable {
    public var id: String
    public var name: String
    public var description: String
    public var url: String
    public var domain: String
    public var auth: String
    public var installed: Bool
    public var site: String?
    public var category: String?
    public var iconUrl: String?

    public init(id: String, name: String, description: String = "", url: String, domain: String = "", auth: String = "none", installed: Bool = false, site: String? = nil, category: String? = nil, iconUrl: String? = nil) {
        self.id = id; self.name = name; self.description = description; self.url = url; self.domain = domain
        self.auth = auth; self.installed = installed; self.site = site; self.category = category; self.iconUrl = iconUrl
    }
}

/// A skill of the library (`GET /api/skills-library`).
public struct LibrarySkill: Decodable, Hashable, Sendable, Identifiable {
    public var name: String
    public var description: String
    public var source: String
    public var enabled: Bool
    public var id: String { name }

    public init(name: String, description: String = "", source: String = "local-import", enabled: Bool = true) {
        self.name = name; self.description = description; self.source = source; self.enabled = enabled
    }

    private enum CodingKeys: String, CodingKey { case name, description, source, enabled }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        name = try values.decode(String.self, forKey: .name)
        description = (try? values.decodeIfPresent(String.self, forKey: .description)) ?? ""
        source = (try? values.decodeIfPresent(String.self, forKey: .source)) ?? "local-import"
        enabled = (try? values.decodeIfPresent(Bool.self, forKey: .enabled)) ?? true
    }
}

/// A marketplace and its plugins (`GET /api/marketplaces`).
public struct Marketplace: Decodable, Hashable, Sendable, Identifiable {
    public struct Plugin: Decodable, Hashable, Sendable {
        public var name: String
        public var description: String?
        public var version: String?
        public var category: String?
        public var installed: Bool
        public var servers: [String]
        public var skills: [String]

        public init(name: String, description: String? = nil, version: String? = nil, category: String? = nil, installed: Bool = false, servers: [String] = [], skills: [String] = []) {
            self.name = name; self.description = description; self.version = version; self.category = category
            self.installed = installed; self.servers = servers; self.skills = skills
        }

        private enum CodingKeys: String, CodingKey { case name, description, version, category, installed, servers, skills }

        public init(from decoder: Decoder) throws {
            let values = try decoder.container(keyedBy: CodingKeys.self)
            name = try values.decode(String.self, forKey: .name)
            description = try? values.decodeIfPresent(String.self, forKey: .description)
            version = try? values.decodeIfPresent(String.self, forKey: .version)
            category = try? values.decodeIfPresent(String.self, forKey: .category)
            installed = (try? values.decodeIfPresent(Bool.self, forKey: .installed)) ?? false
            servers = (try? values.decodeIfPresent([String].self, forKey: .servers)) ?? []
            skills = (try? values.decodeIfPresent([String].self, forKey: .skills)) ?? []
        }
    }

    public var name: String
    public var source: String
    public var ref: String?
    public var plugins: [Plugin]
    public var id: String { name }

    public init(name: String, source: String = "", ref: String? = nil, plugins: [Plugin] = []) {
        self.name = name; self.source = source; self.ref = ref; self.plugins = plugins
    }

    private enum CodingKeys: String, CodingKey { case name, source, ref, plugins }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        name = try values.decode(String.self, forKey: .name)
        source = (try? values.decodeIfPresent(String.self, forKey: .source)) ?? name
        ref = try? values.decodeIfPresent(String.self, forKey: .ref)
        plugins = (try? values.decodeIfPresent([Lossy<Plugin>].self, forKey: .plugins))?.compactMap(\.value) ?? []
    }
}

public struct ConnectAppSources: Sendable {
    public var servers: [ConnectAppServer]
    public var featured: [ConnectAppFeatured]
    public var skills: [LibrarySkill]
    public var marketplaces: [Marketplace]

    public init(servers: [ConnectAppServer] = [], featured: [ConnectAppFeatured] = [], skills: [LibrarySkill] = [], marketplaces: [Marketplace] = []) {
        self.servers = servers
        self.featured = featured; self.skills = skills; self.marketplaces = marketplaces
    }
}

// MARK: - The list

public enum ConnectApps {
    public static let sectionPreview = 6

    public static func marketplacePluginKey(_ marketplace: String, _ plugin: String) -> String { "plugin:\(plugin)@\(marketplace)" }

    /// `appKey`: one app's key across sources ("Asana", "asana", "Asana MCP").
    public static func appKey(_ name: String) -> String {
        var text = name.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US_POSIX")).lowercased()
        text = text.replacingOccurrences(of: #"\((?:mcp|beta)\)|\bmcp\b|\bserver\b"#, with: "", options: .regularExpression)
        return text.replacingOccurrences(of: "[^a-z0-9]", with: "", options: .regularExpression)
    }

    static func host(_ url: String?) -> String? {
        guard let url, let host = URL(string: url)?.host, !host.isEmpty else { return nil }
        return host
    }

    /// `buildPluginItems`: every row, deduplicated.
    public static func items(_ sources: ConnectAppSources) -> [ConnectAppItem] {
        var items: [ConnectAppItem] = []
        var serverParent: [String: String] = [:]
        var skillParent: [String: String] = [:]
        for market in sources.marketplaces {
            for plugin in market.plugins where plugin.installed {
                let key = marketplacePluginKey(market.name, plugin.name)
                for server in plugin.servers { serverParent[server] = key }
                for skill in plugin.skills { skillParent[skill] = key }
            }
        }
        var serverURLs = Set<String>()
        for server in sources.servers {
            if let url = server.url { serverURLs.insert(url) }
            let needsAuth = ["required", "expired", "error"].contains(server.auth ?? "")
            items.append(ConnectAppItem(
                key: "mcp:\(server.name)", kind: .mcp, id: server.name, name: server.name,
                description: server.url ?? server.command ?? "", domain: host(server.url),
                installed: true,
                status: !server.enabled || server.managedBy != nil ? .off : (needsAuth ? .needsAuth : .connected),
                action: nil, source: server.source ?? "manual",
                parent: server.source != nil ? serverParent[server.name] : nil
            ))
        }
        for listing in sources.featured where !listing.installed && !serverURLs.contains(listing.url) {
            items.append(ConnectAppItem(
                key: "featured:\(listing.id)", kind: .featured, id: listing.id, name: listing.name,
                description: listing.description, logo: listing.iconUrl, domain: listing.site ?? listing.domain,
                category: ConnectAppCategory.fromTags([listing.category]),
                installed: false, status: .available, action: listing.auth == "oauth" ? .connect : .add,
                source: "catalog", recommended: true
            ))
        }
        for skill in sources.skills {
            let local = skill.source == "local-import"
            items.append(ConnectAppItem(
                key: "skill:\(skill.name)", kind: .skill, id: skill.name, name: skill.name, description: skill.description,
                installed: true, status: skill.enabled ? .connected : .off, action: nil,
                source: local ? "local" : skill.source,
                parent: local ? nil : skillParent[skill.name]
            ))
        }
        for market in sources.marketplaces {
            for plugin in market.plugins {
                items.append(ConnectAppItem(
                    key: marketplacePluginKey(market.name, plugin.name), kind: .plugin, id: "\(plugin.name)@\(market.name)",
                    name: plugin.name, description: plugin.description ?? "",
                    category: ConnectAppCategory.fromTags([plugin.category]),
                    installed: plugin.installed, status: plugin.installed ? .connected : .available,
                    action: plugin.installed ? nil : .add, source: market.name, version: plugin.version
                ))
            }
        }
        return mergeSameApps(items)
    }

    private static func mergeable(_ item: ConnectAppItem) -> Bool {
        item.parent == nil && (item.kind == .featured || item.kind == .mcp)
    }

    /// `mergeSameApps`: one row per app; what is installed always shows,
    /// otherwise the best way to connect it here.
    public static func mergeSameApps(_ items: [ConnectAppItem]) -> [ConnectAppItem] {
        var groups: [String: [ConnectAppItem]] = [:]
        var order: [String] = []
        for item in items where mergeable(item) {
            let key = appKey(item.name)
            guard !key.isEmpty else { continue }
            if groups[key] == nil { order.append(key) }
            groups[key, default: []].append(item)
        }
        var replaced: [String: ConnectAppItem?] = [:]
        for key in order {
            let group = groups[key] ?? []
            let logo = group.first { $0.logo != nil }?.logo
            let domain = group.first { $0.kind != .mcp && $0.domain != nil }?.domain ?? group.first { $0.domain != nil }?.domain
            let category = group.first { $0.category != .other }?.category ?? .other
            let recommended = group.contains { $0.recommended }
            let installed = group.filter(\.installed)
            func rank(_ item: ConnectAppItem) -> Int {
                switch item.kind {
                case .featured: 1
                default: 3
                }
            }
            let keep: [ConnectAppItem] = installed.isEmpty
                ? [group.enumerated().min { (rank($0.element), $0.offset) < (rank($1.element), $1.offset) }!.element]
                : installed
            let keepKeys = Set(keep.map(\.key))
            for item in group {
                guard keepKeys.contains(item.key) else {
                    replaced[item.key] = .some(nil)
                    continue
                }
                var next = item
                next.logo = item.logo ?? logo
                next.domain = domain ?? item.domain
                if item.category == .other { next.category = category }
                if recommended { next.recommended = true }
                next.merged = group.filter { $0.key != item.key }.map(\.key)
                replaced[item.key] = .some(next)
            }
        }
        var out: [ConnectAppItem] = []
        for item in items {
            if let entry = replaced[item.key] {
                if let next = entry { out.append(next) }
            } else {
                out.append(item)
            }
        }
        return out
    }

    public static func matches(_ item: ConnectAppItem, query: String) -> Bool {
        let words = query.lowercased().split(whereSeparator: \.isWhitespace)
        guard !words.isEmpty else { return true }
        let text = "\(item.name) \(item.id) \(item.description) \(item.domain ?? "") \(item.source)".lowercased()
        return words.allSatisfy { text.contains($0) }
    }

    public static func matches(_ item: ConnectAppItem, filter: ConnectAppFilter) -> Bool {
        guard case let .category(category) = filter else { return true }
        return item.kind != .skill && item.category == category
    }

    public static func matches(_ item: ConnectAppItem, type: ConnectAppTypeFilter) -> Bool {
        switch type {
        case .any: true
        case .mcp: item.kind == .mcp || item.kind == .featured
        case .skills: item.kind == .skill
        case let .source(source): item.source == source && item.parent == nil
        }
    }

    private static func installedThenName(_ a: ConnectAppItem, _ b: ConnectAppItem) -> Bool {
        if a.installed != b.installed { return a.installed }
        return a.name.localizedCompare(b.name) == .orderedAscending
    }

    /// A server the person added that is one of the catalog's apps counts
    /// with the apps.
    private static func catalogued(_ item: ConnectAppItem) -> Bool {
        item.kind == .featured || (item.kind == .mcp && !item.merged.isEmpty)
    }

    public enum SectionID: Hashable, Sendable {
        case results, recommended, mcp, skills
        case category(ConnectAppCategory)
        case source(String)
        case type(ConnectAppTypeFilter)
    }

    public struct Section: Hashable, Sendable, Identifiable {
        public var id: SectionID
        /// What View all selects.
        public var viewAll: ViewAll?
        public var items: [ConnectAppItem]
        public var total: Int
    }

    public enum ViewAll: Hashable, Sendable {
        case filter(ConnectAppFilter)
        case type(ConnectAppTypeFilter)
    }

    /// `mainSections`: with a search, a chip or a type, one list of matches;
    /// otherwise a short preview per category, each with View all.
    public static func sections(_ items: [ConnectAppItem], query: String, filter: ConnectAppFilter = .all, type: ConnectAppTypeFilter = .any, extraSources: [String] = []) -> [Section] {
        let visible = items.filter { matches($0, query: query) && matches($0, filter: filter) && matches($0, type: type) }
        if !query.trimmingCharacters(in: .whitespaces).isEmpty {
            let sorted = visible.sorted(by: installedThenName)
            return [Section(id: .results, viewAll: nil, items: sorted, total: sorted.count)]
        }
        if filter != .all || type != .any {
            let sorted = visible.sorted(by: installedThenName)
            let id: SectionID
            if case let .category(category) = filter { id = .category(category) } else { id = .type(type) }
            return [Section(id: id, viewAll: nil, items: sorted, total: sorted.count)]
        }
        var out: [Section] = []
        func preview(_ id: SectionID, _ viewAll: ViewAll?, _ list: [ConnectAppItem]) {
            if !list.isEmpty { out.append(Section(id: id, viewAll: viewAll, items: Array(list.prefix(sectionPreview)), total: list.count)) }
        }
        preview(.recommended, nil, visible.filter { $0.recommended && !$0.installed })
        for source in extraSources {
            preview(.source(source), .type(.source(source)), visible.filter { $0.source == source && $0.parent == nil }.sorted(by: installedThenName))
        }
        for category in ConnectAppCategory.order where category != .other {
            preview(.category(category), .filter(.category(category)), visible.filter { catalogued($0) && $0.category == category }.sorted(by: installedThenName))
        }
        preview(.mcp, .type(.mcp), visible.filter { $0.kind == .mcp }.sorted(by: installedThenName))
        preview(.skills, .type(.skills), visible.filter { $0.kind == .skill }.sorted(by: installedThenName))
        preview(.category(.other), .filter(.category(.other)), visible.filter { catalogued($0) && $0.category == .other }.sorted(by: installedThenName))
        return out
    }

    /// `installedPlugins`: Manage's Installed grid (skills have their own
    /// list; what a plugin brought shows under it).
    public static func installed(_ items: [ConnectAppItem]) -> [ConnectAppItem] {
        items.filter { $0.installed && $0.kind != .skill && $0.parent == nil }
            .sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
    }

    /// `connectedSummary`: the header's "N connected" and up to four icons.
    public static func connected(_ items: [ConnectAppItem], extra: Int = 0) -> (count: Int, icons: [ConnectAppItem]) {
        let connected = installed(items).filter { $0.status == .connected }
        return (connected.count + max(0, extra), Array(connected.prefix(4)))
    }

    /// The private skills of Manage: made on this computer.
    public static func privateSkills(_ items: [ConnectAppItem]) -> [ConnectAppItem] {
        items.filter { $0.kind == .skill && $0.source == "local" }
            .sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
    }
}

// MARK: - A server's tools (detail page)

/// `POST /api/mcp/servers/:name/test`: whether it answered, and its tools.
public struct MCPProbe: Decodable, Hashable, Sendable {
    public struct Tool: Decodable, Hashable, Sendable, Identifiable {
        public var name: String
        public var description: String?
        public var id: String { name }
    }

    public var ok: Bool
    public var tools: [Tool]
    public var total: Int?
    public var error: String?

    private enum CodingKeys: String, CodingKey { case ok, tools, total, error }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        ok = (try? values.decodeIfPresent(Bool.self, forKey: .ok)) ?? false
        tools = (try? values.decodeIfPresent([Lossy<Tool>].self, forKey: .tools))?.compactMap(\.value) ?? []
        total = try? values.decodeIfPresent(Int.self, forKey: .total)
        error = try? values.decodeIfPresent(String.self, forKey: .error)
    }

    /// Each tool with its switch: on unless listed in `disabledTools`.
    public func switches(disabled: [String]) -> [(tool: Tool, enabled: Bool)] {
        let off = Set(disabled)
        return tools.map { ($0, !off.contains($0.name)) }
    }
}

public enum MCPToolSwitch {
    /// The `disabledTools` value after one switch, sorted as the desktop sends it.
    public static func toggled(_ disabled: [String], tool: String, enabled: Bool) -> [String] {
        var set = Set(disabled)
        if enabled { set.remove(tool) } else { set.insert(tool) }
        return set.sorted()
    }
}

// MARK: - Client

private struct SkillsLibraryList: Decodable { var skills: [Lossy<LibrarySkill>]? }
private struct MarketplaceList: Decodable { var marketplaces: [Lossy<Marketplace>]? }
private struct LibrarySkillTextBody: Decodable { var text: String? }
private struct ServerTools: Decodable {
    struct Server: Decodable { var name: String; var disabledTools: [String]? }
    var servers: [Lossy<Server>]?
}

public extension CompanionClient {
    /// `GET /api/skills-library`: empty when the library is off (404).
    func skillsLibrary() async throws -> [LibrarySkill] {
        do {
            return (try await send(makeRequest("GET", "/api/skills-library"), as: SkillsLibraryList.self).skills ?? []).compactMap(\.value)
        } catch let APIError.status(code, _) where code == 404 || code == 403 {
            return []
        }
    }

    /// `GET /api/skills-library/:name`: the SKILL.md text.
    func librarySkillText(name: String) async throws -> String {
        try await send(makeRequest("GET", "/api/skills-library/\(name)"), as: LibrarySkillTextBody.self).text ?? ""
    }

    /// `PATCH /api/skills-library/:name { enabled }`: Turn on / Turn off.
    func setLibrarySkill(name: String, enabled: Bool) async throws {
        _ = try await perform(makeRequest("PATCH", "/api/skills-library/\(name)", body: ["enabled": enabled]))
    }

    /// `PUT /api/skills-library/:name`: Save (owner or admin).
    func saveLibrarySkill(name: String, newName: String, description: String, instructions: String) async throws {
        _ = try await perform(makeRequest("PUT", "/api/skills-library/\(name)", body: [
            "name": newName, "description": description, "instructions": instructions,
        ]))
    }

    /// `DELETE /api/skills-library/:name`.
    func deleteLibrarySkill(name: String) async throws {
        _ = try await perform(makeRequest("DELETE", "/api/skills-library/\(name)"))
    }

    /// `GET /api/marketplaces`: empty for a person who may not manage them.
    func marketplaces() async throws -> [Marketplace] {
        do {
            return (try await send(makeRequest("GET", "/api/marketplaces"), as: MarketplaceList.self).marketplaces ?? []).compactMap(\.value)
        } catch let APIError.status(code, _) where code == 404 || code == 403 {
            return []
        }
    }

    /// `POST /api/marketplaces { source, ref? }`.
    func addMarketplace(source: String, ref: String?) async throws {
        var body: [String: Any] = ["source": source]
        if let ref, !ref.isEmpty { body["ref"] = ref }
        _ = try await perform(makeRequest("POST", "/api/marketplaces", body: body))
    }

    func refreshMarketplace(name: String) async throws {
        _ = try await perform(makeRequest("POST", "/api/marketplaces/\(name)/refresh"))
    }

    func removeMarketplace(name: String) async throws {
        _ = try await perform(makeRequest("DELETE", "/api/marketplaces/\(name)"))
    }

    /// `POST` adds a marketplace plugin, `DELETE` uninstalls what it added.
    func setMarketplacePlugin(marketplace: String, plugin: String, installed: Bool) async throws {
        _ = try await perform(makeRequest(installed ? "POST" : "DELETE", "/api/marketplaces/\(marketplace)/plugins/\(plugin)"))
    }

    /// `POST /api/mcp/servers/:name/test`.
    func testMCPServer(name: String) async throws -> MCPProbe {
        try await send(makeRequest("POST", "/api/mcp/servers/\(name)/test"), as: MCPProbe.self)
    }

    /// `PATCH /api/mcp/servers/:name { disabledTools }` (#203): the per-tool
    /// switches, applied to every bot.
    func setMCPDisabledTools(name: String, disabledTools: [String]) async throws {
        _ = try await perform(makeRequest("PATCH", "/api/mcp/servers/\(name)", body: ["disabledTools": disabledTools]))
    }

    /// `PATCH /api/mcp/servers/:name { enabled }`.
    func setMCPServer(name: String, enabled: Bool) async throws {
        _ = try await perform(makeRequest("PATCH", "/api/mcp/servers/\(name)", body: ["enabled": enabled]))
    }

    /// `DELETE /api/mcp/servers/:name`: Uninstall.
    func removeMCPServer(name: String) async throws {
        _ = try await perform(makeRequest("DELETE", "/api/mcp/servers/\(name)"))
    }

    /// Each server's `disabledTools`, from `GET /api/mcp/servers`.
    func mcpDisabledTools() async throws -> [String: [String]] {
        let list = try await send(makeRequest("GET", "/api/mcp/servers"), as: ServerTools.self)
        var out: [String: [String]] = [:]
        for server in (list.servers ?? []).compactMap(\.value) { out[server.name] = server.disabledTools ?? [] }
        return out
    }
}
