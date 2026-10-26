// Connect apps on the phone (#203, #206, #207, #218; matrix DC35 to DC39):
// the desktop's Plugins panel in its three views, with the same routes and
// the same rows (`ConnectApps` in CompanionCore, a port of plugins-model.ts):
//
// - Connect apps (main): search across apps and skills, one filter button
//   (Grok Bot iOS 1.14's marketplace) whose menu holds All, the desktop's
//   categories in its order and the type filter, a section per category
//   with View all, one row per app with Add or Connect, and "N connected >"
//   to Manage.
// - Manage: Plugins and skills (Installed, Private skills, Your connections
//   on an organization server, Advanced with the marketplaces) | Providers.
// - A plugin's page: its accounts, its tools with a switch each (applied to
//   every bot), its details, Uninstall; a private skill's page.
//
// The phone keeps its own presentation (a navigation stack of lists); the
// names, groupings and order are the desktop's. Writes the desktop gives an
// admin (MCP servers, marketplaces, the skills library) show only to an
// administering pairing; the MCP trust notice is gone (#197).
import CompanionCore
import SwiftUI
import UIKit

@MainActor
final class ConnectAppsModel: ObservableObject {
    @Published private(set) var items: [ConnectAppItem] = []
    @Published private(set) var loading = true
    @Published private(set) var servers: [MCPServerListing] = []
    @Published private(set) var disabledTools: [String: [String]] = [:]
    @Published private(set) var marketplaces: [Marketplace] = []
    @Published private(set) var probes: [String: MCPProbe] = [:]
    @Published private(set) var probing: Set<String> = []
    @Published private(set) var claudeConnectors = 0
    @Published var busy: String?
    @Published var message: String?
    @Published var query = ""
    @Published var filter: ConnectAppFilter = .all
    @Published var type: ConnectAppTypeFilter = .any

    private var featured: [PluginListing] = []
    private var skills: [LibrarySkill] = []

    var sections: [ConnectApps.Section] {
        ConnectApps.sections(items, query: query, filter: filter, type: type, extraSources: marketplaces.map(\.name))
    }

    var summary: (count: Int, icons: [ConnectAppItem]) { ConnectApps.connected(items, extra: claudeConnectors) }

    func item(_ key: String) -> ConnectAppItem? { items.first { $0.key == key } }

    func load(_ session: Session) async {
        guard let client = session.settingsClient else { loading = false; return }
        async let servers = try? client.mcpServers()
        async let disabled = try? client.mcpDisabledTools()
        async let page = try? client.searchPlugins()
        async let skills = try? client.skillsLibrary()
        async let markets = try? client.marketplaces()
        self.servers = await servers?.servers ?? []
        disabledTools = await disabled ?? [:]
        featured = await page?.featured ?? []
        self.skills = await skills ?? []
        marketplaces = await markets ?? []
        rebuild()
        loading = false
        // the claude.ai connectors count in "N connected"; that answer can
        // take a while, so the list does not wait for it
        if let harness = try? await client.harnessConnectors() {
            claudeConnectors = harness.claude.connectors.count
        }
    }

    private func rebuild() {
        items = ConnectApps.items(ConnectAppSources(
            servers: servers.map { ConnectAppServer(name: $0.name, enabled: $0.enabled ?? true, url: $0.url, command: $0.command, auth: $0.auth, managedBy: $0.managedBy, source: $0.source) },
            featured: featured.map { ConnectAppFeatured(id: $0.id, name: $0.name, description: $0.description, url: $0.url, domain: $0.domain, auth: $0.auth, installed: $0.installed, iconUrl: $0.iconUrl) },
            skills: skills, marketplaces: marketplaces
        ))
    }

    func server(_ name: String) -> MCPServerListing? { servers.first { $0.name == name } }
    func skill(_ name: String) -> LibrarySkill? { skills.first { $0.name == name } }

    // MARK: Actions

    private func run(_ key: String, _ session: Session, _ work: (CompanionClient) async throws -> Void) async {
        guard let client = session.settingsClient else { return }
        busy = key
        defer { busy = nil }
        do {
            try await work(client)
        } catch {
            message = error.localizedDescription
        }
        await load(session)
    }

    /// Add or Connect on a row.
    func act(_ item: ConnectAppItem, alias: String?, session: Session) async {
        switch item.kind {
        case .featured:
            await run(item.key, session) { client in
                let result = try await client.installPlugin(id: item.id, trust: false)
                if let url = result.authorizationUrl { _ = try? await WebSignIn.run(url: url) }
            }
        case .plugin:
            let parts = item.id.split(separator: "@", maxSplits: 1).map(String.init)
            guard parts.count == 2 else { return }
            await run(item.key, session) { try await $0.setMarketplacePlugin(marketplace: parts[1], plugin: parts[0], installed: true) }
        case .mcp, .skill:
            break
        }
    }

    func signIn(_ server: MCPServerListing, session: Session) async {
        await run("mcp:\(server.name)", session) { client in
            _ = try? await WebSignIn.run(url: try await client.startPluginSignIn(serverName: server.name))
        }
    }

    func listTools(_ server: String, session: Session) async {
        guard let client = session.settingsClient, !probing.contains(server) else { return }
        probing.insert(server)
        defer { probing.remove(server) }
        do { probes[server] = try await client.testMCPServer(name: server) } catch { message = error.localizedDescription }
    }

    func setTool(_ tool: String, enabled: Bool, server: String, session: Session) async {
        guard let client = session.settingsClient else { return }
        let next = MCPToolSwitch.toggled(disabledTools[server] ?? [], tool: tool, enabled: enabled)
        disabledTools[server] = next
        do { try await client.setMCPDisabledTools(name: server, disabledTools: next) } catch {
            message = error.localizedDescription
            disabledTools = (try? await client.mcpDisabledTools()) ?? disabledTools
        }
    }

    func setServer(_ name: String, enabled: Bool, session: Session) async {
        await run("mcp:\(name)", session) { try await $0.setMCPServer(name: name, enabled: enabled) }
    }

    func uninstall(_ item: ConnectAppItem, session: Session) async {
        switch item.kind {
        case .mcp:
            await run(item.key, session) { try await $0.removeMCPServer(name: item.id) }
        case .plugin:
            let parts = item.id.split(separator: "@", maxSplits: 1).map(String.init)
            guard parts.count == 2 else { return }
            await run(item.key, session) { try await $0.setMarketplacePlugin(marketplace: parts[1], plugin: parts[0], installed: false) }
        case .featured, .skill:
            break
        }
    }

    func setSkill(_ name: String, enabled: Bool, session: Session) async {
        await run("skill:\(name)", session) { try await $0.setLibrarySkill(name: name, enabled: enabled) }
    }

    func addMarketplace(_ source: String, ref: String, session: Session) async {
        await run("market:new", session) { try await $0.addMarketplace(source: source, ref: ref) }
    }

    func refreshMarketplace(_ name: String, session: Session) async {
        await run("market:\(name)", session) { try await $0.refreshMarketplace(name: name) }
    }

    func removeMarketplace(_ name: String, session: Session) async {
        await run("market:\(name)", session) { try await $0.removeMarketplace(name: name) }
    }
}

// MARK: - Routes

enum ConnectAppsRoute: Hashable {
    case manage
    case detail(String)
    case skill(String)
}

/// The whole panel: the main view and what it pushes.
struct ConnectAppsPage: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @StateObject private var model = ConnectAppsModel()
    @State private var path = NavigationPath()
    @Environment(\.dismiss) private var dismiss
    @Environment(\.settingsPop) private var settingsPop
    @Environment(\.scenePhase) private var scenePhase
    /// Settings > Experimental: whether Templates is on (Bot templates' target).
    @State private var features: ServerFeatures?

    /// "Bot templates" beside the search: where it leads, nil for no button.
    private var botTemplates: BotTemplatesDestination? {
        BotTemplatesEntry.destination(gate: session.surfaceGate, features: features)
    }

    var body: some View {
        NavigationStack(path: $path) {
            ConnectAppsMain(model: model, botTemplates: botTemplates.map { destination in
                {
                    // Connect apps closes, then Templates (or the new bot sheet) opens
                    if let settingsPop { settingsPop() } else { dismiss() }
                    NotificationCenter.default.post(name: .sagaxOpenBotTemplates, object: destination.rawValue)
                }
            }) { path.append($0) }
                .navigationTitle(String(localized: "Connect apps"))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(String(localized: "Done")) {
                            if let settingsPop { settingsPop() } else { dismiss() }
                        }
                        .accessibilityIdentifier("connect-apps-done")
                    }
                }
                .navigationDestination(for: ConnectAppsRoute.self) { route in
                    switch route {
                    case .manage: ConnectAppsManage(model: model) { path.append($0) }
                    case let .detail(key): ConnectAppDetail(model: model, key: key) { path.append($0) }
                    case let .skill(name): LibrarySkillPage(model: model, name: name)
                    }
                }
        }
        .tint(Theme.textPrimary)
        .task { await model.load(session) }
        .task { features = await session.configStatus()?.features }
        // back from an authorization page in the browser
        .onValueChange(of: scenePhase) { phase in
            if phase == .active { Task { await model.load(session) } }
        }
        .alert(String(localized: "Connect apps"), isPresented: Binding(get: { model.message != nil }, set: { if !$0 { model.message = nil } })) {
            Button(String(localized: "OK"), role: .cancel) {}
        } message: {
            Text(verbatim: model.message ?? "")
        }
    }
}

// MARK: - Shared row parts

enum ConnectAppsWords {
    /// "1 connector · 3 skills": what a marketplace plugin brought.
    static func includes(_ children: [ConnectAppItem]) -> String {
        let servers = children.filter { $0.kind == .mcp }.count
        let skills = children.filter { $0.kind == .skill }.count
        return [servers == 1 ? String(localized: "1 connector") : String(localized: "\(servers) connectors"),
                skills == 1 ? String(localized: "1 skill") : String(localized: "\(skills) skills")].joined(separator: " · ")
    }

    static func category(_ category: ConnectAppCategory) -> String {
        switch category {
        case .passwords: String(localized: "Password managers")
        case .productivity: String(localized: "Productivity")
        case .communication: String(localized: "Communication")
        case .design: String(localized: "Design")
        case .code: String(localized: "Code")
        case .data: String(localized: "Data")
        case .sales: String(localized: "Sales")
        case .finance: String(localized: "Finance")
        case .marketing: String(localized: "Marketing")
        case .research: String(localized: "Research")
        case .support: String(localized: "Support")
        case .other: String(localized: "Other")
        }
    }

    static func type(_ type: ConnectAppTypeFilter) -> String {
        switch type {
        case .any: String(localized: "All types")
        case .mcp: String(localized: "MCP servers")
        case .skills: String(localized: "Skills")
        case let .source(name): name
        }
    }

    static func section(_ id: ConnectApps.SectionID) -> String {
        switch id {
        case .results: String(localized: "Results")
        case .recommended: String(localized: "Recommended for you")
        case .mcp: String(localized: "Your MCP servers")
        case .skills: String(localized: "Skills")
        case let .category(category): Self.category(category)
        case let .source(name): name
        case let .type(type): Self.type(type)
        }
    }

    static func status(_ status: ConnectAppStatus) -> String {
        switch status {
        case .connected: String(localized: "Connected")
        case .needsAuth: String(localized: "Needs sign-in")
        case .pending: String(localized: "Finishing sign-in")
        case .off: String(localized: "Off")
        case .available: String(localized: "Available")
        }
    }

    static func source(_ source: String) -> String {
        switch source {
        case "manual": String(localized: "Added manually")
        case "catalog": String(localized: "Sagax plugin catalog")
        case "local": String(localized: "Created locally")
        default: source
        }
    }
}

struct ConnectAppIcon: View {
    let item: ConnectAppItem
    var size: CGFloat = 34

    var body: some View {
        if item.kind == .skill {
            PluginsGlyphTile(systemImage: "sparkles", size: size)
        } else {
            PluginIconTile(key: item.domain.map { $0.split(separator: ".").dropLast().last.map(String.init) ?? $0 }, remote: item.logo, size: size)
        }
    }
}

/// One row of the main view or Manage: icon, name, description, and the
/// button (Add, Connect) or the status.
struct ConnectAppRow: View {
    @Environment(\.themePalette) var themePalette
    let item: ConnectAppItem
    let busy: Bool
    let act: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            ConnectAppIcon(item: item)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: item.name)
                    .font(.body.weight(.medium))
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                if !item.description.isEmpty {
                    Text(verbatim: item.description)
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            if busy {
                ProgressView().controlSize(.small)
            } else if let action = item.action {
                Button(action: act) {
                    Text(action == .add ? String(localized: "Add") : String(localized: "Connect"))
                        .font(.footnote.weight(.semibold))
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("connect-apps-action.\(item.key)")
            } else {
                Text(verbatim: ConnectAppsWords.status(item.status))
                    .font(.footnote)
                    .foregroundStyle(item.status == .connected ? Theme.accentText : Theme.textSecondary)
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("connect-apps-row.\(item.key)")
    }
}

// MARK: - Main view

struct ConnectAppsMain: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @ObservedObject var model: ConnectAppsModel
    /// "Bot templates" (nil: no button), on the search's row of controls
    var botTemplates: (() -> Void)? = nil
    let push: (ConnectAppsRoute) -> Void
    @State private var expanded: Set<ConnectApps.SectionID> = []

    var body: some View {
        ThemedList {
            Section {
                connectedLink
                filterBar
                if let botTemplates {
                    // the desktop's button beside the search field: the
                    // phone's search sits in the bar, so it heads the list
                    Button(action: botTemplates) {
                        HStack(spacing: 8) {
                            Image(systemName: "square.grid.2x2")
                                .foregroundStyle(Theme.textSecondary)
                            Text(String(localized: "Bot templates"))
                                .foregroundStyle(Theme.textPrimary)
                            Spacer(minLength: 8)
                            Image(systemName: "arrow.up.forward")
                                .font(.footnote)
                                .foregroundStyle(Theme.textSecondary)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("connect-apps-bot-templates")
                }
            }
            if model.loading && model.items.isEmpty {
                Section { HStack { Spacer(); ProgressView(); Spacer() } }
            }
            ForEach(model.sections) { section in
                Section {
                    let shown = expanded.contains(section.id) || section.viewAll == nil ? section.items : Array(section.items.prefix(ConnectApps.sectionPreview))
                    ForEach(shown) { item in
                        Button { open(item) } label: {
                            ConnectAppRow(item: item, busy: model.busy == item.key) { act(item) }
                        }
                        .buttonStyle(.plain)
                    }
                    if let viewAll = section.viewAll, section.total > section.items.count {
                        Button(String(localized: "View all")) {
                            switch viewAll {
                            case let .filter(filter): model.filter = filter
                            case let .type(type): model.type = type
                            }
                        }
                        .accessibilityIdentifier("connect-apps-view-all")
                    }
                } header: {
                    Text(verbatim: ConnectAppsWords.section(section.id))
                }
            }
            if !model.loading, model.sections.isEmpty {
                Section { Text(String(localized: "Nothing matches")).foregroundStyle(Theme.textSecondary) }
            }
        }
        .searchable(text: $model.query, prompt: Text(String(localized: "Search across apps and skills")))
        .refreshable { await model.load(session) }
        .accessibilityIdentifier("connect-apps")
    }

    /// "N connected >" with up to four icons: opens Manage.
    private var connectedLink: some View {
        let summary = model.summary
        return Button { push(.manage) } label: {
            HStack(spacing: 8) {
                HStack(spacing: -8) {
                    ForEach(summary.icons) { ConnectAppIcon(item: $0, size: 24) }
                }
                Text(String(localized: "\(summary.count) connected"))
                    .foregroundStyle(Theme.textPrimary)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Theme.textTertiary)
            }
        }
        .accessibilityIdentifier("connect-apps-manage")
    }

    /// One filter button, as Grok Bot iOS 1.14's marketplace has it: a menu
    /// with All, every category in the desktop's order (main, then the
    /// rest), then the type filter. The label names what is picked; All
    /// clears both.
    private var filterBar: some View {
        HStack(spacing: 8) {
            Menu {
                filterButton(String(localized: "All"), selected: model.filter == .all && model.type == .any) {
                    model.filter = .all
                    model.type = .any
                }
                Section {
                    ForEach(ConnectAppCategory.order, id: \.self) { category in
                        filterButton(ConnectAppsWords.category(category), selected: model.filter == .category(category)) {
                            model.filter = model.filter == .category(category) ? .all : .category(category)
                        }
                    }
                }
                Section(String(localized: "Filter by type")) {
                    let types: [ConnectAppTypeFilter] = [.any, .mcp, .skills] + model.marketplaces.map { .source($0.name) }
                    ForEach(types, id: \.self) { type in
                        filterButton(ConnectAppsWords.type(type), selected: model.type == type) { model.type = type }
                    }
                }
            } label: {
                chipLabel(filterTitle, selected: model.filter != .all || model.type != .any, systemImage: "line.3.horizontal.decrease")
            }
            .accessibilityIdentifier("connect-apps-filter")
            Spacer(minLength: 0)
        }
        .padding(.vertical, 2)
    }

    /// "All", the category, the type, or both ("Design · MCP servers").
    private var filterTitle: String {
        var parts: [String] = []
        if case let .category(category) = model.filter { parts.append(ConnectAppsWords.category(category)) }
        if model.type != .any { parts.append(ConnectAppsWords.type(model.type)) }
        return parts.isEmpty ? String(localized: "All") : parts.joined(separator: " · ")
    }

    private func filterButton(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.selection()
            action()
        } label: {
            if selected { Label(title, systemImage: "checkmark") } else { Text(verbatim: title) }
        }
    }

    private func chipLabel(_ title: String, selected: Bool, systemImage: String? = nil) -> some View {
        HStack(spacing: 4) {
            if let systemImage { Image(systemName: systemImage).font(.caption2) }
            Text(verbatim: title).font(.footnote.weight(.medium)).lineLimit(1)
        }
        .padding(.horizontal, 12)
        .frame(height: 30)
        .foregroundStyle(selected ? Theme.accentInk : Theme.textPrimary)
        .background(selected ? Theme.accent : Theme.chip, in: Capsule())
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func open(_ item: ConnectAppItem) {
        if item.kind == .skill { push(.skill(item.id)) } else { push(.detail(item.key)) }
    }

    private func act(_ item: ConnectAppItem) {
        Task { await model.act(item, alias: nil, session: session) }
    }
}

// MARK: - Manage

struct ConnectAppsManage: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @ObservedObject var model: ConnectAppsModel
    let push: (ConnectAppsRoute) -> Void
    @State private var tab = Tab.plugins
    @State private var showAll = false
    @State private var marketSource = ""
    @State private var marketRef = ""
    @State private var removingMarket: String?

    enum Tab: Hashable { case plugins, providers }

    private static let installedPreview = 8

    private var tabs: some View {
        Picker(String(localized: "Manage"), selection: $tab) {
            Text(String(localized: "Plugins and skills")).tag(Tab.plugins)
            Text(String(localized: "Providers")).tag(Tab.providers)
        }
        .pickerStyle(.segmented)
        .accessibilityIdentifier("connect-apps-manage-tabs")
    }

    var body: some View {
        Group {
            switch tab {
            case .plugins:
                ThemedList {
                    Section { tabs }
                    plugins
                }
            case .providers:
                // the Claude connectors block draws its own rows and switch
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        tabs
                        ConnectAppsProviders()
                    }
                    .padding(16)
                }
                .background(Theme.bg.ignoresSafeArea())
            }
        }
        .navigationTitle(String(localized: "Manage plugins and skills"))
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog(
            String(localized: "Remove the \(removingMarket ?? "") marketplace?"),
            isPresented: Binding(get: { removingMarket != nil }, set: { if !$0 { removingMarket = nil } }),
            titleVisibility: .visible
        ) {
            Button(String(localized: "Remove"), role: .destructive) {
                if let name = removingMarket { Task { await model.removeMarketplace(name, session: session) } }
            }
        }
    }

    @ViewBuilder
    private var plugins: some View {
        let installed = ConnectApps.installed(model.items)
        Section {
            if installed.isEmpty {
                Text(String(localized: "Nothing is installed yet. Connect an app from Connect apps, or add an MCP server on your computer."))
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
            }
            ForEach(showAll ? installed : Array(installed.prefix(Self.installedPreview))) { item in
                Button { push(.detail(item.key)) } label: {
                    HStack(spacing: 12) {
                        ConnectAppIcon(item: item)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(verbatim: item.name).foregroundStyle(Theme.textPrimary).lineLimit(1)
                            Text(verbatim: countLine(item)).font(.footnote).foregroundStyle(Theme.textSecondary).lineLimit(1)
                        }
                        Spacer(minLength: 8)
                        Text(verbatim: item.status == .connected ? String(localized: "Connected") : (item.status == .off ? String(localized: "Off") : String(localized: "Not connected")))
                            .font(.footnote)
                            .foregroundStyle(item.status == .connected ? Theme.success : Theme.textSecondary)
                    }
                }
                .accessibilityIdentifier("connect-apps-installed.\(item.key)")
            }
            if installed.count > Self.installedPreview {
                Button(showAll ? String(localized: "Show fewer") : String(localized: "Show all \(installed.count) plugins")) { showAll.toggle() }
                    .accessibilityIdentifier("connect-apps-show-all")
            }
        } header: {
            Text(String(localized: "Installed"))
        }
        Section {
            let skills = ConnectApps.privateSkills(model.items)
            if skills.isEmpty {
                Text(String(localized: "No private skills yet. Create one, or add a marketplace plugin that brings some."))
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
            }
            ForEach(skills) { item in
                Button { push(.skill(item.id)) } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: item.name).foregroundStyle(Theme.textPrimary)
                        Text(verbatim: [String(localized: "Created locally"), item.description].filter { !$0.isEmpty }.joined(separator: " · "))
                            .font(.footnote)
                            .foregroundStyle(Theme.textSecondary)
                            .lineLimit(2)
                    }
                }
            }
        } header: {
            Text(String(localized: "Private skills"))
        }
        // Your connections (#218): the person's own, on an organization server
        if session.surfaceGate.allows(.myConnections) {
            YourConnectionsSection()
        }
        SlackConnectionsSection()
        if session.canAdminister {
            // Add manually and Paste config need a keyboard and secrets: they
            // stay on the computer; the marketplaces work from here.
            Section {
                ForEach(model.marketplaces) { market in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(verbatim: market.name)
                            Text(String(localized: "\(market.plugins.count) plugins, \(market.plugins.filter(\.installed).count) installed"))
                                .font(.footnote)
                                .foregroundStyle(Theme.textSecondary)
                        }
                        Spacer()
                        if model.busy == "market:\(market.name)" { ProgressView().controlSize(.small) }
                    }
                    .swipeActions {
                        if !market.plugins.contains(where: \.installed) {
                            Button(String(localized: "Remove"), role: .destructive) { removingMarket = market.name }
                        }
                        Button(String(localized: "Refresh")) { Task { await model.refreshMarketplace(market.name, session: session) } }
                    }
                }
                TextField(String(localized: "owner/repo or https://..."), text: $marketSource)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("connect-apps-market-source")
                TextField(String(localized: "Branch (optional)"), text: $marketRef)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Button(String(localized: "Add marketplace")) {
                    let source = marketSource.trimmingCharacters(in: .whitespacesAndNewlines)
                    let ref = marketRef.trimmingCharacters(in: .whitespacesAndNewlines)
                    marketSource = ""
                    marketRef = ""
                    Task { await model.addMarketplace(source, ref: ref, session: session) }
                }
                .disabled(marketSource.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.busy == "market:new")
            } header: {
                Text(String(localized: "Advanced") + " · " + String(localized: "Marketplaces"))
            } footer: {
                Text(String(localized: "Add a Claude Code plugin marketplace: a GitHub repository (owner/repo, optionally a branch), an https git address, or the address of its marketplace.json."))
            }
        }
    }

    private func countLine(_ item: ConnectAppItem) -> String {
        switch item.kind {
        case .plugin:
            return ConnectAppsWords.includes(model.items.filter { $0.parent == item.key })
        default:
            return String(localized: "1 connector")
        }
    }
}

/// Manage > Providers (#207): the claude.ai connectors of the person's
/// account; the other providers' connectors do not reach bots.
struct ConnectAppsProviders: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @StateObject private var harness = HarnessConnectorsModel()

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(String(localized: "The engine accounts on this installation, and the connectors each one brings to bots. A provider's connectors act as that account."))
                .font(.footnote)
                .foregroundStyle(Theme.textSecondary)
            if session.surfaceGate.allows(.harnessConnectors) {
                HarnessConnectorsSection(model: harness)
                    .task { await harness.load(session.settingsClient) }
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(String(localized: "Grok: its connectors do not reach bots in Sagax."))
                Text(String(localized: "Gemini: Google's extensions do not reach bots in Sagax."))
            }
            .font(.footnote)
            .foregroundStyle(Theme.textSecondary)
        }
    }
}

// MARK: - A plugin's page

struct ConnectAppDetail: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @ObservedObject var model: ConnectAppsModel
    let key: String
    let push: (ConnectAppsRoute) -> Void
    @State private var toolsOpen = false
    @State private var confirmingUninstall = false

    /// The page's item. A catalog entry ("featured:<id>") is rebuilt under
    /// its server's key once Add installs it: follow it there.
    private var current: ConnectAppItem? {
        if let item = model.item(key) { return item }
        if let folded = model.items.first(where: { $0.merged.contains(key) }) { return folded }
        guard key.hasPrefix("featured:") else { return nil }
        let id = String(key.dropFirst("featured:".count))
        return model.items.first { $0.kind != .featured && $0.id == id }
    }

    var body: some View {
        Group {
            if let item = current {
                content(item)
                    .navigationTitle(item.name)
            } else {
                ThemedList { Text(String(localized: "This plugin is no longer installed.")).foregroundStyle(Theme.textSecondary) }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
    }

    /// Grok Bot iOS 1.14's plugin sheet, on our pushed page: the icon, name
    /// and description centred on top, the cards under it, Added or Add in a
    /// floating capsule at the bottom and Uninstall in the "..." menu.
    private func content(_ item: ConnectAppItem) -> some View {
        ThemedList {
            Section {
                VStack(spacing: 8) {
                    ConnectAppIcon(item: item, size: 64)
                    Text(verbatim: item.name)
                        .font(.title3.weight(.semibold))
                        .multilineTextAlignment(.center)
                    if !item.description.isEmpty {
                        Text(verbatim: item.description)
                            .font(.footnote)
                            .foregroundStyle(Theme.textSecondary)
                            .multilineTextAlignment(.center)
                            .lineLimit(4)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 4)
                .listRowBackground(Color.clear)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("connect-apps-detail-header")
            }
            switch item.kind {
            case .mcp: mcpSections(item)
            case .plugin: pluginSections(item)
            case .featured, .skill: EmptyView()
            }
            Section {
                detailRow(String(localized: "Source"), ConnectAppsWords.source(item.source))
                if let version = item.version { detailRow(String(localized: "Version"), version) }
                if item.kind == .mcp, let server = model.server(item.id) {
                    detailRow(String(localized: "Transport"), server.isRemote ? (server.type == "sse" ? "SSE" : "HTTP") : "stdio")
                    detailRow(server.isRemote ? String(localized: "URL") : String(localized: "Command"), server.url ?? ([server.command ?? ""] + (server.args ?? [])).joined(separator: " "))
                }
            } header: {
                Text(String(localized: "Details"))
            }
            if item.action != nil || item.installed {
                // room for the floating capsule (50 + 8 below it)
                Color.clear.frame(height: 62).listRowBackground(Color.clear)
            }
        }
        .overlay(alignment: .bottom) { capsule(item) }
        .toolbar {
            if canUninstall(item) {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button(role: .destructive) { confirmingUninstall = true } label: {
                            Label(String(localized: "Uninstall"), systemImage: "trash")
                        }
                        .accessibilityIdentifier("connect-apps-uninstall")
                    } label: {
                        Image(systemName: "ellipsis")
                            .accessibilityLabel(Text("More"))
                    }
                    .accessibilityIdentifier("connect-apps-detail-more")
                }
            }
        }
        .confirmationDialog(String(localized: "Uninstall \(item.name)?"), isPresented: $confirmingUninstall, titleVisibility: .visible) {
            Button(String(localized: "Uninstall"), role: .destructive) {
                Task { await model.uninstall(item, session: session) }
            }
        }
    }

    private func act(_ item: ConnectAppItem) {
        Task { await model.act(item, alias: nil, session: session) }
    }

    private func canUninstall(_ item: ConnectAppItem) -> Bool {
        item.installed && item.kind != .featured && session.canAdminister
    }

    /// Added (installed, nothing to do) or the blue Add / Connect.
    @ViewBuilder
    private func capsule(_ item: ConnectAppItem) -> some View {
        if let action = item.action {
            Button {
                Haptics.selection()
                act(item)
            } label: {
                Group {
                    if model.busy == item.key {
                        ProgressView().controlSize(.small).tint(Theme.accentInk)
                    } else {
                        Text(action == .add ? String(localized: "Add") : String(localized: "Connect"))
                            .font(.body.weight(.semibold))
                            .foregroundStyle(Theme.accentInk)
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(height: 50)
                .background(Theme.accent, in: Capsule())
            }
            .buttonStyle(.plain)
            .disabled(model.busy == item.key)
            .padding(.horizontal, 20)
            .padding(.bottom, 8)
            .accessibilityIdentifier("connect-apps-detail-action")
        } else if item.installed {
            Label(String(localized: "Added"), systemImage: "checkmark")
                .font(.body.weight(.semibold))
                .foregroundStyle(Theme.textPrimary)
                .frame(maxWidth: .infinity)
                .frame(height: 50)
                .themeGlass(Capsule())
                .padding(.horizontal, 20)
                .padding(.bottom, 8)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("connect-apps-detail-added")
                // a status, not a button: taps reach the row under it
                .allowsHitTesting(false)
        }
    }

    @ViewBuilder
    private func mcpSections(_ item: ConnectAppItem) -> some View {
        if let server = model.server(item.id) {
            Section {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: server.auth == "connected" ? (server.authIssuer ?? String(localized: "Signed in")) : String(localized: "default"))
                        Text(verbatim: accountLine(server)).font(.footnote).foregroundStyle(Theme.textSecondary)
                    }
                    Spacer()
                    if ["required", "expired", "error"].contains(server.auth ?? "") {
                        Button(String(localized: "Sign in")) { Task { await model.signIn(server, session: session) } }
                            .buttonStyle(.bordered)
                            .accessibilityIdentifier("connect-apps-sign-in")
                    }
                }
                if session.canAdminister {
                    Toggle(String(localized: "Turned on"), isOn: Binding(
                        get: { server.enabled ?? true },
                        set: { on in Task { await model.setServer(server.name, enabled: on, session: session) } }
                    ))
                    .disabled(server.managedBy != nil)
                }
            } header: {
                Text(String(localized: "Accounts"))
            }
            Section {
                DisclosureGroup(isExpanded: $toolsOpen) {
                    toolList(server.name)
                } label: {
                    HStack {
                        Text(String(localized: "Tools"))
                        Spacer()
                        Text(verbatim: toolCount(server.name)).font(.footnote).foregroundStyle(Theme.textSecondary)
                    }
                }
                .onValueChange(of: toolsOpen) { open in
                    if open, model.probes[server.name] == nil { Task { await model.listTools(server.name, session: session) } }
                }
                .accessibilityIdentifier("connect-apps-tools")
            } footer: {
                Text(String(localized: "A tool turned off here is hidden from every bot. Each bot's Access settings can narrow the rest."))
            }
        }
    }

    @ViewBuilder
    private func toolList(_ server: String) -> some View {
        if let probe = model.probes[server] {
            if let error = probe.error, !probe.ok {
                Text(verbatim: error).font(.footnote).foregroundStyle(Theme.danger)
            }
            ForEach(probe.switches(disabled: model.disabledTools[server] ?? []), id: \.tool.name) { entry in
                Toggle(isOn: Binding(
                    get: { !(model.disabledTools[server] ?? []).contains(entry.tool.name) },
                    set: { on in Task { await model.setTool(entry.tool.name, enabled: on, server: server, session: session) } }
                )) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: entry.tool.name).font(.subheadline.monospaced())
                        if let description = entry.tool.description, !description.isEmpty {
                            Text(verbatim: description).font(.caption).foregroundStyle(Theme.textSecondary).lineLimit(2)
                        }
                    }
                }
                .disabled(!session.canAdminister)
                .accessibilityIdentifier("connect-apps-tool.\(entry.tool.name)")
            }
        } else if model.probing.contains(server) {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text(String(localized: "Asking the server for its tools...")).font(.footnote).foregroundStyle(Theme.textSecondary)
            }
        } else {
            Button(String(localized: "List the tools")) { Task { await model.listTools(server, session: session) } }
        }
    }

    private func toolCount(_ server: String) -> String {
        let disabled = model.disabledTools[server] ?? []
        if let probe = model.probes[server], probe.ok {
            let enabled = probe.tools.filter { !disabled.contains($0.name) }.count
            return String(localized: "\(enabled) of \(probe.tools.count) enabled")
        }
        return disabled.isEmpty ? String(localized: "All enabled") : String(localized: "\(disabled.count) turned off")
    }

    private func accountLine(_ server: MCPServerListing) -> String {
        if server.auth == "connected" { return String(localized: "Signed in") }
        if let error = server.authError, !error.isEmpty { return error }
        let keys = (server.isRemote ? server.headerKeys : server.envKeys) ?? []
        return keys.isEmpty ? String(localized: "No sign-in needed") : keys.joined(separator: ", ")
    }

    @ViewBuilder
    private func pluginSections(_ item: ConnectAppItem) -> some View {
        let children = model.items.filter { $0.parent == item.key }
        Section {
            if !children.isEmpty {
                Text(verbatim: ConnectAppsWords.includes(children))
                    .font(.subheadline)
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("connect-apps-includes-count")
            }
            if children.isEmpty {
                Text(String(localized: "This plugin added no MCP server and no skill that Sagax can use.")).foregroundStyle(Theme.textSecondary)
            }
            ForEach(children) { child in
                Button {
                    if child.kind == .skill { push(.skill(child.id)) } else { push(.detail(child.key)) }
                } label: {
                    ConnectAppRow(item: child, busy: false) {}
                }
                .buttonStyle(.plain)
            }
        } header: {
            Text(String(localized: "Includes"))
        } footer: {
            Text(String(localized: "Its MCP servers and skills are available to every bot. A server that runs a command starts off: test it, then turn it on. Skills start off until you read them."))
        }
    }

    private func detailRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(verbatim: label).foregroundStyle(Theme.textSecondary)
            Spacer(minLength: 12)
            Text(verbatim: value).multilineTextAlignment(.trailing).textSelection(.enabled)
        }
        .font(.subheadline)
    }
}

// MARK: - A private skill's page

struct LibrarySkillPage: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @ObservedObject var model: ConnectAppsModel
    let name: String
    @State private var text: String?
    @State private var confirmingDelete = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let skill = model.skill(name)
        ThemedList {
            Section {
                Text(verbatim: name).font(.headline)
                if let skill {
                    Text(verbatim: skill.source == "local-import" ? String(localized: "Created locally") : String(localized: "From \(skill.source)"))
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                    if !skill.description.isEmpty { Text(verbatim: skill.description).font(.subheadline) }
                    if session.canAdminister {
                        Toggle(String(localized: "Turned on"), isOn: Binding(
                            get: { skill.enabled },
                            set: { on in Task { await model.setSkill(name, enabled: on, session: session) } }
                        ))
                        .accessibilityIdentifier("connect-apps-skill-toggle")
                    }
                }
            } footer: {
                Text(String(localized: "Read it before turning it on: once on, bots it is assigned to follow it."))
            }
            Section {
                if let text {
                    Text(verbatim: text).font(.footnote.monospaced()).textSelection(.enabled)
                } else {
                    ProgressView()
                }
            } header: {
                Text(String(localized: "Instructions"))
            }
            if session.canAdminister, skill?.source == "local-import" {
                Section {
                    Button(String(localized: "Delete Skill"), role: .destructive) { confirmingDelete = true }
                }
            }
        }
        .navigationTitle(String(localized: "Private skill"))
        .navigationBarTitleDisplayMode(.inline)
        .task { text = (try? await session.settingsClient?.librarySkillText(name: name)) ?? "" }
        .confirmationDialog(String(localized: "Delete the skill \(name)? Bots it is assigned to stop using it."), isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button(String(localized: "Delete Skill"), role: .destructive) {
                Task {
                    if let client = session.settingsClient {
                        do { try await client.deleteLibrarySkill(name: name) } catch { model.message = error.localizedDescription }
                    }
                    await model.load(session)
                    dismiss()
                }
            }
        }
    }
}

extension Notification.Name {
    /// Connect apps' "Bot templates": the home opens Templates or the new
    /// bot sheet (`object`: a BotTemplatesDestination raw value).
    static let sagaxOpenBotTemplates = Notification.Name("sagax.openBotTemplates")
}
