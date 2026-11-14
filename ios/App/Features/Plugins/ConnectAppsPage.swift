// Connect apps on the phone (#203, #206, #207, #218; matrix DC35 to DC39):
// the desktop's Plugins panel, with the same routes and the same rows
// (`ConnectApps` in CompanionCore, a port of plugins-model.ts):
//
// - Connect apps (2026-10-27, the desktop's one page): "N connected >" and
//   the tabs Discover, Bots, Installed, Sources, Discover open (Providers
//   is no tab since 2026-10-29: its rows are a section of Installed).
//   One search over every tab (2026-10-29, CompanionCore
//   ConnectAppsSearch): plugins, skills, MCP servers, bots, templates and
//   marketplaces, grouped by kind, each opening its page, its card or its
//   tab; an empty field shows the tab's own content. Discover: one filter
//   button (the reference iOS app's marketplace) whose menu holds All, the
//   desktop's categories in its order and the type filter, a section per
//   category with View all, one row per app with Add or Connect (no Browse
//   Bots button: the Bots tab is its place). Bots: Browse Bots' whole catalogue
//   (BrowseBotsContent), its cards pushed on this stack. Installed: one line per thing, deduplicated, with a "..." menu;
//   the private skills when there are some, then the Providers: a pill per
//   service (All, Claude, Slack, My MCP servers), the engines' connectors,
//   the person's own MCP servers. Sources: the person's GitHub connection
//   and the marketplaces. Empty sections are hidden. There is no "Manage
//   plugins and skills" page any more: it repeated these tabs.
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
    @Published private(set) var tailscale: BotTailscaleView?
    @Published var busy: String?
    @Published var message: String?
    @Published var query = ""
    @Published var filter: ConnectAppFilter = .all
    @Published var type: ConnectAppTypeFilter = .any

    private var featured: [PluginListing] = []
    private var skills: [LibrarySkill] = []
    /// The desktop Capabilities window's Me scope (PluginsPanel.tsx
    /// `scopedItems`): the person's own things only, the marketplace plugins,
    /// the private skills and Tailscale; apps and servers are the
    /// workspace's (its Organization scope, or a bot's Access).
    @Published var personalScope = false

    /// The items the scope shows.
    var scopedItems: [ConnectAppItem] {
        guard personalScope else { return items }
        return items.filter { $0.key == tailscaleConnectAppKey || $0.kind == .plugin || $0.kind == .skill }
    }

    /// Discover: what can still be added (installed rows live in Installed).
    var sections: [ConnectApps.Section] {
        ConnectApps.sections(ConnectApps.discover(scopedItems), query: query, filter: filter, type: type, extraSources: marketplaces.map(\.name))
    }

    var summary: (count: Int, icons: [ConnectAppItem]) { ConnectApps.connected(items, extra: claudeConnectors) }

    func item(_ key: String) -> ConnectAppItem? { items.first { $0.key == key } }

    /// Manage > Installed: one entry per thing (CompanionCore InstalledEntries).
    var entries: [InstalledEntry] { ConnectApps.installedEntries(scopedItems, catalog: Set(featured.map(\.url))) }

    func load(_ session: Session) async {
        guard let client = session.settingsClient else { loading = false; return }
        async let servers = try? client.mcpServers()
        async let disabled = try? client.mcpDisabledTools()
        async let page = try? client.searchPlugins()
        async let skills = try? client.skillsLibrary()
        async let markets = try? client.marketplaces()
        async let tailscaleView = try? client.botTailscale()
        self.servers = await servers?.servers ?? []
        disabledTools = await disabled ?? [:]
        featured = await page?.featured ?? []
        self.skills = await skills ?? []
        marketplaces = await markets ?? []
        tailscale = await tailscaleView
        rebuild()
        loading = false
        // the claude.ai connectors count in "N connected"; that answer can
        // take a while, so the list does not wait for it
        if let harness = try? await client.harnessConnectors() {
            claudeConnectors = harness.claude.connectors.count
        }
    }

    private func rebuild() {
        let tailscaleRow: BotTailscaleRowState? = {
            // Always offer the row; a failed GET still shows Connect so the
            // person can open the page and see the error there.
            let description = String(localized: "Join your bot computer to your private tailnet.")
            if let view = tailscale {
                return BotTailscaleRowState(view: view, description: description)
            }
            return BotTailscaleRowState(description: description, connected: false)
        }()
        items = ConnectApps.items(ConnectAppSources(
            servers: servers.map { ConnectAppServer(name: $0.name, enabled: $0.enabled ?? true, url: $0.url, command: $0.command, auth: $0.auth, managedBy: $0.managedBy, source: $0.source) },
            featured: featured.map { ConnectAppFeatured(id: $0.id, name: $0.name, description: $0.description, url: $0.url, domain: $0.domain, auth: $0.auth, installed: $0.installed, iconUrl: $0.iconUrl) },
            skills: skills,
            marketplaces: marketplaces,
            tailscale: tailscaleRow
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

    /// The pill of a row or of a plugin's sheet: Add, Connect, or Authorize
    /// (an installed server whose sign-in lapsed signs in again). Tailscale
    /// opens its own page (caller pushes).
    func act(_ item: ConnectAppItem, alias: String?, session: Session) async {
        if item.key == tailscaleConnectAppKey { return }
        if ConnectAppPill.of(item) == .authorize {
            if let server = server(item.id) { await signIn(server, session: session) }
            return
        }
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

    /// Remove an installed entry: its plugin (which takes its servers and
    /// skills) and every server of it added by hand or from the catalog.
    func remove(_ entry: InstalledEntry, session: Session) async {
        let plugins = entry.members.filter { $0.kind == .plugin }
        let pluginKeys = Set(plugins.map(\.key))
        await run(entry.key, session) { client in
            for plugin in plugins {
                let parts = plugin.id.split(separator: "@", maxSplits: 1).map(String.init)
                if parts.count == 2 { try await client.setMarketplacePlugin(marketplace: parts[1], plugin: parts[0], installed: false) }
            }
            for server in entry.members where server.kind == .mcp && !(server.parent.map(pluginKeys.contains) ?? false) {
                try await client.removeMCPServer(name: server.id)
            }
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
    case detail(String)
    case skill(String)
    /// Connect apps > Mac hub (native Mac apps).
    case mac
    /// Connect apps > Mac > Messages setup.
    case macMessages
    case tailscale
    /// The published pages (the Pages tab's list).
    case pages
}

/// Drawn inside the iPad desktop's Capabilities window: the desktop's body
/// (underlined tabs, category chips, 44 pt tiles, pill buttons) instead of
/// the phone's segmented list.
private struct CapabilitiesDesktopKey: EnvironmentKey { static let defaultValue = false }
extension EnvironmentValues {
    var capabilitiesDesktop: Bool {
        get { self[CapabilitiesDesktopKey.self] }
        set { self[CapabilitiesDesktopKey.self] = newValue }
    }
}

/// The plugin a half sheet shows.
struct ConnectAppSheetKey: Identifiable, Hashable {
    let key: String
    var id: String { key }
}

/// The whole panel: the main view and what it pushes.
struct ConnectAppsPage: View {
    /// the tab to open on (Settings > My connections' links); nil: Discover
    var initialTab: ConnectAppsTab? = nil
    /// Drawn inside the iPad's desktop Capabilities window, which has its
    /// own title and close button: no navigation bar of its own.
    var embedded = false
    /// The desktop window's own search field, when embedded.
    var embeddedQuery: Binding<String>? = nil
    /// The desktop window's Me scope: the person's own capabilities only.
    var personalScope = false
    @Environment(\.desktopTheme) private var desktopTheme
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @StateObject private var model = ConnectAppsModel()
    @State private var path = NavigationPath()
    @Environment(\.dismiss) private var dismiss
    @Environment(\.settingsPop) private var settingsPop
    @Environment(\.scenePhase) private var scenePhase
    /// Browse Bots' catalogue, the Bots tab's and the search's.
    @StateObject private var bots = BrowseBotsModel()
    /// The Bots tab (and Discover's Browse Bots) shows where Browse Bots
    /// did: not on a pairing without the catalogue.
    private var botsShown: Bool {
        BotTemplatesEntry.destination(gate: session.surfaceGate) != nil
    }

    /// The plugin whose half sheet is open (the phone, #4103).
    @State private var sheetKey: ConnectAppSheetKey?

    var body: some View {
        NavigationStack(path: $path) {
            ConnectAppsMain(model: model, bots: bots, botsShown: botsShown, initialTab: initialTab, openBot: openBot, close: close, push: open)
                // the desktop window's body: the app's colour, not the stack's black
                .background { if embedded { desktopTheme.app.ignoresSafeArea() } }
                .navigationTitle(String(localized: "Connect apps"))
                .navigationBarTitleDisplayMode(.inline)
                // the window has its title; the phone draws the reference's bar
                .toolbar(.hidden, for: .navigationBar)
                .navigationDestination(for: ConnectAppsRoute.self) { route in
                    switch route {
                    case let .detail(key): ConnectAppDetail(model: model, key: key, push: open)
                    case let .skill(name): LibrarySkillPage(model: model, name: name)
                    case .mac: MacAppsPage { path.append($0) }
                    case .macMessages: MacMessagesSetupView()
                    case .tailscale:
                        TailscaleConnectPage {
                            Task { await model.load(session) }
                        }
                    case .pages: PublishedPagesPage()
                    }
                }
                // the Bots tab's cards, View all, publish, the imports
                .modifier(BrowseBotsPresenters(model: bots, open: openBot))
        }
        // A plugin opens as the reference's half sheet over the list; what it
        // pushes (a skill, the Mac hub) lands on the list's stack.
        .sheet(item: $sheetKey) { sheet in
            ConnectAppDetail(model: model, key: sheet.key, close: { sheetKey = nil }, push: open)
                .environmentObject(session)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.hidden)
                .sheetChromeCompat(Theme.bg, cornerRadius: CGFloat(PhoneSheetMetrics.sheetRadius))
        }
        .tint(Theme.textPrimary)
        .environment(\.capabilitiesDesktop, embedded)
        .onValueChange(of: embeddedQuery?.wrappedValue ?? "") { value in
            if embedded { model.query = value }
        }
        .task {
            model.personalScope = personalScope
            await model.load(session)
            #if DEBUG
            // `-parityConnectAppsDetail YES`: a plugin's half sheet, for the captures
            if UserDefaults.standard.bool(forKey: "parityConnectAppsDetail"),
               let item = model.items.first(where: { $0.installed && $0.kind != .skill }) ?? model.items.first(where: { $0.kind != .skill }) {
                open(.detail(item.key))
            }
            #endif
        }
        .onValueChange(of: personalScope) { model.personalScope = $0 }
        .task { if botsShown { await bots.load(session) } }
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

    private func close() {
        if let settingsPop { settingsPop() } else { dismiss() }
    }

    /// A plugin's page is a half sheet on the phone, a pushed page in the
    /// iPad's window; every other route is pushed on the list's stack.
    private func open(_ route: ConnectAppsRoute) {
        if case let .detail(key) = route, !embedded {
            sheetKey = ConnectAppSheetKey(key: key)
            return
        }
        if sheetKey != nil {
            sheetKey = nil
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { path.append(route) }
        } else {
            path.append(route)
        }
    }

    /// A bot opened from the Bots tab: Connect apps closes, its chat opens.
    private func openBot(_ bot: Bot) {
        if let settingsPop { settingsPop() } else { dismiss() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { session.openChat(threadId: bot.threadId) }
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
        } else if item.key == tailscaleConnectAppKey {
            TailscaleMarkTile(size: size)
        } else {
            PluginIconTile(key: item.domain.map { $0.split(separator: ".").dropLast().last.map(String.init) ?? $0 }, monogram: item.logo == nil ? nil : item.name, size: size)
        }
    }
}

/// Tailscale's own mark (the desktop's `TailscaleIcon`): nine dots in a
/// grid, the middle row and the bottom centre lit, the others faint, on a
/// dark tile.
struct TailscaleMarkTile: View {
    var size: CGFloat = 34

    var body: some View {
        Canvas { context, box in
            let step = box.width * 0.22
            let r = box.width * 0.075
            let lit: Set<Int> = [3, 4, 5, 7]
            for index in 0..<9 {
                let x = box.width / 2 + CGFloat(index % 3 - 1) * step
                let y = box.height / 2 + CGFloat(index / 3 - 1) * step
                context.fill(Path(ellipseIn: CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2)),
                             with: .color(Color.white.opacity(lit.contains(index) ? 1 : 0.35)))
            }
        }
        .frame(width: size, height: size)
        .background(Color(red: 0x24 / 255, green: 0x22 / 255, blue: 0x22 / 255), in: RoundedRectangle(cornerRadius: size * 0.25, style: .continuous))
        .accessibilityHidden(true)
    }
}

/// One row of the main view or Manage: icon, name, description, and the
/// button (Add, Connect) or the status.
struct ConnectAppRow: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.capabilitiesDesktop) private var desktop
    @Environment(\.desktopTheme) private var theme
    let item: ConnectAppItem
    let busy: Bool
    let act: () -> Void

    var body: some View {
        if desktop { desktopBody } else { phoneBody }
    }

    /// The desktop's row: a 44 pt tile, the name 13 semibold over the
    /// description 12 secondary, and the action as a raised pill.
    private var desktopBody: some View {
        HStack(spacing: 12) {
            ConnectAppIcon(item: item, size: 44)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: item.name)
                    .font(theme.font(13, .medium))
                    .foregroundStyle(theme.ink)
                    .lineLimit(1)
                if !item.description.isEmpty {
                    Text(verbatim: item.description)
                        .font(theme.font(12))
                        .foregroundStyle(theme.inkSecondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if busy {
                ProgressView().controlSize(.small)
            } else if let action = item.action {
                Button(action: act) {
                    Text(action == .add ? String(localized: "Add") : String(localized: "Connect"))
                        .font(theme.font(13, .medium))
                        .foregroundStyle(theme.ink)
                        .padding(.horizontal, 14)
                        .frame(height: 30)
                        .background(theme.raised, in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("connect-apps-action.\(item.key)")
            } else {
                Text(verbatim: ConnectAppsWords.status(item.status))
                    .font(theme.font(12))
                    .foregroundStyle(item.status == .connected ? theme.accent : theme.inkSecondary)
            }
        }
        // a cell of the desktop's two-column grid (CATEGORY_MODAL.grid): the
        // description truncates and the action sits beside it
        // PluginRow: rounded-2xl p-2.5 in a 414 pt cell
        .padding(10)
        .frame(maxWidth: 414, alignment: .leading)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("connect-apps-row.\(item.key)")
    }

    /// The reference's row (#4103): the 42 pt icon, the name over a muted
    /// line of two lines at most, the pill at the trailing margin.
    private var phoneBody: some View {
        HStack(spacing: 0) {
            ConnectAppIcon(item: item, size: CGFloat(PhoneSheetMetrics.icon))
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: item.name)
                    .font(Theme.font(CGFloat(PhoneSheetMetrics.nameSize)))
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                if !item.description.isEmpty {
                    Text(verbatim: item.description)
                        .font(Theme.font(CGFloat(PhoneSheetMetrics.lineSize)))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(PhoneSheetMetrics.lineLimit)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.leading, CGFloat(PhoneSheetMetrics.iconGap))
            Spacer(minLength: 12)
            if busy {
                ProgressView().controlSize(.small)
            } else {
                ConnectAppPillButton(pill: ConnectAppPill.of(item), action: act)
                    .accessibilityIdentifier(ConnectAppPill.of(item).acts ? "connect-apps-action.\(item.key)" : "connect-apps-status.\(item.key)")
            }
        }
        .padding(.vertical, CGFloat(PhoneSheetMetrics.rowPadding))
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("connect-apps-row.\(item.key)")
    }
}

/// The pill of a Connect apps row and of a plugin's sheet (#4103): Add or
/// Connect on the raised colour, Authorize in blue, a state muted.
struct ConnectAppPillButton: View {
    @Environment(\.themePalette) var themePalette
    let pill: ConnectAppPill
    var height = CGFloat(PhoneSheetMetrics.pillHeight)
    var minWidth: CGFloat = 0
    var textSize = CGFloat(PhoneSheetMetrics.pillTextSize)
    let action: () -> Void

    var body: some View {
        Button {
            Haptics.selection()
            action()
        } label: {
            Text(verbatim: title)
                .font(Theme.font(textSize, .medium))
                .foregroundStyle(ink)
                .lineLimit(1)
                .padding(.horizontal, CGFloat(PhoneSheetMetrics.pillPadding))
                .frame(minWidth: minWidth, minHeight: height)
                .background(fill, in: Capsule())
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        // a state is shown, not pressed
        .allowsHitTesting(pill.acts)
    }

    private var title: String {
        switch pill {
        case .add: String(localized: "Add")
        case .connect: String(localized: "Connect")
        case .authorize: String(localized: "Authorize")
        case let .status(status): ConnectAppsWords.status(status)
        }
    }

    private var ink: Color {
        switch pill {
        case .authorize: Theme.accentInk
        case .status: Theme.textTertiary
        default: Theme.textPrimary
        }
    }

    private var fill: Color {
        switch pill {
        case .authorize: Theme.accent
        case .status: Theme.cardRaised.opacity(0.6)
        default: Theme.cardRaised
        }
    }
}

// MARK: - Main view

struct ConnectAppsMain: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @ObservedObject var model: ConnectAppsModel
    /// Browse Bots' catalogue: the Bots tab and the search's bots.
    @ObservedObject var bots: BrowseBotsModel
    /// The Bots tab (BotTemplatesEntry).
    let botsShown: Bool
    /// A bot opened from Bots: Connect apps closes, its chat opens.
    let openBot: (Bot) -> Void
    /// The round X of the phone's bar.
    let close: () -> Void
    let push: (ConnectAppsRoute) -> Void
    /// The search's groups showing every hit.
    @State private var expandedResults: Set<ConnectAppsSearchGroup> = []
    @State private var tab: ConnectAppsTab
    @Environment(\.capabilitiesDesktop) private var desktop
    @Environment(\.desktopTheme) private var theme

    init(model: ConnectAppsModel, bots: BrowseBotsModel, botsShown: Bool, initialTab: ConnectAppsTab? = nil, openBot: @escaping (Bot) -> Void,
         close: @escaping () -> Void, push: @escaping (ConnectAppsRoute) -> Void) {
        _model = ObservedObject(wrappedValue: model)
        _bots = ObservedObject(wrappedValue: bots)
        self.botsShown = botsShown
        self.openBot = openBot
        self.close = close
        self.push = push
        _tab = State(initialValue: initialTab ?? ConnectAppsTab.launch)
    }

    /// Discover, Bots, Installed (Providers inside), Sources. Bots shows where
    /// Browse Bots did; Sources when the marketplaces can be read or changed from
    /// this pairing, or the person has a GitHub connection to manage.
    private var shownTabs: [ConnectAppsTab] {
        [.discover] + (botsShown ? [.bots] : []) + [.installed, .pages]
            + (session.canAdminister || !model.marketplaces.isEmpty || session.surfaceGate.allows(.myConnections) ? [.sources] : [])
    }

    /// The tab in front; Bots without the catalogue is Discover.
    private var current: ConnectAppsTab { tab == .bots && !botsShown ? .discover : tab }

    private var searching: Bool { !model.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        // one search on every tab: it looks everywhere (ConnectAppsSearch)
        Group {
            if desktop { list } else { phone }
        }
            .onValueChange(of: model.query) { _ in expandedResults = [] }
            #if DEBUG
            .onAppear {
                // `-parityConnectAppsQuery research`: the search, for the captures
                if let query = UserDefaults.standard.string(forKey: "parityConnectAppsQuery"), model.query.isEmpty { model.query = query }
            }
            #endif
    }

    private var list: some View {
        CapabilitiesList(desktop: desktop) {
            if desktop {
                if model.marketplaces.isEmpty {
                    // `mt-2 rounded-lg bg-inset px-3 py-2 text-[12px]` (18 line)
                    Text("No marketplace yet. Add one in Connect Apps > Sources.")
                        .font(theme.font(12))
                        .foregroundStyle(theme.inkSecondary)
                        .frame(minHeight: 18)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        // the title block's pr-12: it ends with the search field
                        .padding(.trailing, 16)
                        .padding(.top, 6)
                        .padding(.bottom, 6)
                }
                desktopTabs
            }
            if searching {
                // the tab's own filters stay above the results and narrow
                // its groups (Discover's are the phone's chips)
                switch current {
                case .discover: if desktop { Section { desktopChips } }
                case .bots: BrowseBotsFilters(model: bots)
                default: EmptyView()
                }
                results
            } else {
                switch current {
                case .discover: discover
                case .bots: BrowseBotsContent(model: bots, open: openBot, importRow: true)
                case .pages:
                    Section {
                        Button { push(.pages) } label: {
                            Label(String(localized: "Pages a bot proposed and you published"), systemImage: "doc.richtext")
                        }
                        .accessibilityIdentifier("connect-apps-pages")
                    }
                default: ConnectAppsManage(model: model, tab: $tab, push: push)
                }
            }
        }
        .refreshable {
            await model.load(session)
            if botsShown { await bots.load(session) }
        }
        .accessibilityIdentifier("connect-apps")
    }

    // MARK: The desktop's tabs and chips

    /// Underlined text tabs, the refresh at the right, a hairline under.
    private var desktopTabs: some View {
        VStack(spacing: 0) {
            HStack(spacing: 24) {
                ForEach(shownTabs, id: \.self) { item in
                    Button { tab = item } label: {
                        Text(verbatim: item.title)
                            .font(theme.font(13.5, current == item ? .medium : .regular))
                            .foregroundStyle(current == item ? theme.ink : theme.inkSecondary)
                            .padding(.vertical, 10)
                            .overlay(alignment: .bottom) {
                                if current == item { Rectangle().fill(theme.ink).frame(height: 2) }
                            }
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(current == item ? .isSelected : [])
                    .accessibilityIdentifier("connect-apps-tab.\(item.title)")
                }
                Spacer(minLength: 0)
                Button { Task { await model.load(session) } } label: {
                    DesktopIconView(icon: .refresh, size: 16).foregroundStyle(theme.inkSecondary)
                        .frame(width: 32, height: 32)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Refresh"))
            }
            Rectangle().fill(theme.hairlineWeak).frame(height: 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("connect-apps-tabs")
    }

    /// The category chips of Discover: All, then each category with apps.
    private var desktopChips: some View {
        let present = ConnectAppCategory.order.filter { category in
            model.items.contains { $0.category == category }
        }
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                desktopChip(String(localized: "All"), selected: model.filter == .all && model.type == .any) {
                    model.filter = .all
                    model.type = .any
                }
                ForEach(present, id: \.self) { category in
                    desktopChip(ConnectAppsWords.category(category), selected: model.filter == .category(category)) {
                        model.filter = model.filter == .category(category) ? .all : .category(category)
                    }
                }
            }
        }
        .padding(.vertical, 8)
    }

    private func desktopChip(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(verbatim: title)
                .font(theme.font(13, .medium))
                .foregroundStyle(selected ? theme.accentInk : theme.ink)
                .padding(.horizontal, 14)
                .frame(height: 28)
                .background(selected ? theme.accent : .clear, in: Capsule())
                .overlay(Capsule().strokeBorder(selected ? .clear : theme.hairline.opacity(0.5), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func sectionTitle(_ title: String) -> some View {
        Text(verbatim: title)
            .font(desktop ? theme.font(14, .semibold) : nil)
            .foregroundStyle(desktop ? theme.ink : Theme.textSecondary)
            .textCase(nil)
    }

    // MARK: The one search

    private var searchSections: [ConnectAppsSearchSection] {
        let sources = ConnectAppsSearchSources(
            apps: model.items,
            bots: botsShown ? bots.data?.entries ?? [] : [],
            templates: botsShown ? bots.templates : [],
            marketplaces: model.marketplaces
        )
        var filters = ConnectAppsSearchFilters()
        switch current {
        case .discover:
            filters.appFilter = model.filter
            filters.appType = model.type
        case .bots:
            filters.botCategory = bots.filter.category
            filters.showArchived = bots.filter.showArchived
        default:
            break
        }
        return ConnectAppsSearch.sections(query: model.query, sources: sources, filters: filters)
    }

    @ViewBuilder
    private var results: some View {
        let sections = searchSections
        if sections.isEmpty {
            Section {
                if model.loading || (botsShown && bots.data == nil && !bots.failed) {
                    HStack { Spacer(); ProgressView(); Spacer() }
                } else {
                    Text(String(localized: "Nothing matches")).foregroundStyle(Theme.textSecondary)
                }
            }
            .accessibilityIdentifier("connect-apps-search-empty")
        }
        ForEach(sections) { section in
            Section {
                let open = expandedResults.contains(section.group)
                ForEach(open ? section.hits : Array(section.hits.prefix(ConnectAppsSearch.preview))) { hit in
                    resultRow(hit)
                }
                if !open, section.hits.count > ConnectAppsSearch.preview {
                    Button(String(localized: "Show all (\(section.hits.count))")) { expandedResults.insert(section.group) }
                        .accessibilityIdentifier("connect-apps-search-show-all.\(section.group.rawValue)")
                }
            } header: {
                // the id on the title only: on the section it replaced each
                // result row's own id (connect-apps-row.<key>)
                sectionTitle(Self.groupTitle(section.group))
                    .accessibilityIdentifier("connect-apps-search.\(section.group.rawValue)")
            }
        }
    }

    static func groupTitle(_ group: ConnectAppsSearchGroup) -> String {
        switch group {
        case .plugins: String(localized: "Plugins")
        case .skills: String(localized: "Skills")
        case .servers: String(localized: "MCP servers")
        case .bots: String(localized: "Bots")
        case .templates: String(localized: "Templates")
        case .xai: XaiMarketplaceRules.label
        case .marketplaces: String(localized: "Marketplaces")
        }
    }

    /// An app, a server or a skill: its row (Add, Connect or its status) to
    /// its page. A bot or a template: Bots' row to its card. A marketplace:
    /// the Sources tab.
    @ViewBuilder
    private func resultRow(_ hit: ConnectAppsSearchHit) -> some View {
        switch hit.target {
        case let .app(key):
            if let item = hit.app {
                Button { open(item) } label: {
                    ConnectAppRow(item: item, busy: model.busy == item.key) { act(item) }
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier(key == tailscaleConnectAppKey ? "connect-apps-tailscale-row" : "connect-apps-app-\(key)")
            }
        case let .skill(name):
            if let item = hit.app {
                Button { push(.skill(name)) } label: {
                    ConnectAppRow(item: item, busy: false) {}
                }
                .buttonStyle(.plain)
            }
        case let .catalog(item):
            BrowseBotsItemRow(model: bots, item: item, open: openBot)
        case let .marketplace(name):
            Button {
                model.query = ""
                tab = .sources
            } label: {
                HStack(spacing: 12) {
                    PluginsGlyphTile(systemImage: "shippingbox", size: 34)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: name).font(.body.weight(.medium)).foregroundStyle(Theme.textPrimary).lineLimit(1)
                        if !hit.detail.isEmpty {
                            Text(verbatim: hit.detail).font(.footnote).foregroundStyle(Theme.textSecondary).lineLimit(1)
                        }
                    }
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.right")
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("connect-apps-search-market.\(name)")
        }
    }

    @ViewBuilder
    private var discover: some View {
        Section {
            desktopChips
        }
        if model.loading && model.items.isEmpty {
            Section { HStack { Spacer(); ProgressView(); Spacer() } }
        }
        ForEach(model.sections) { section in
            Section {
                ForEach(section.items) { item in
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
                sectionTitle(ConnectAppsWords.section(section.id))
            }
        }
        if !model.loading, model.sections.isEmpty {
            Section {
                Text(model.query.isEmpty && model.filter == .all && model.type == .any
                    ? String(localized: "Everything in the catalog is already installed.")
                    : String(localized: "Nothing matches"))
                    .foregroundStyle(Theme.textSecondary)
            }
        }
    }

    // MARK: The phone (#4103)

    /// The reference's Connect apps sheet: the bar (round X, the title, the
    /// count pill that opens what is connected), the chips that scroll
    /// sideways, the list, and the one search floating at the bottom.
    private var phone: some View {
        // one container, not a Group: a Group hands its insets to each
        // branch, so the first letter typed (Discover to the results)
        // rebuilt the search field and dropped the keyboard
        ZStack {
            if current == .discover && !searching { phoneDiscover } else { list }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            VStack(spacing: CGFloat(PhoneSheetMetrics.chipsTop)) {
                phoneBar
                phoneChips
            }
            .padding(.top, SettingsMetrics.headerInset)
            .padding(.bottom, 4)
            .background(Theme.bg.ignoresSafeArea(edges: .top))
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            SettingsSearchField(prompt: "Search across apps and skills", text: $model.query, identifier: "connect-apps-search",
                                height: CGFloat(PhoneSheetMetrics.searchHeight), textSize: CGFloat(PhoneSheetMetrics.searchTextSize))
                .padding(.horizontal, CGFloat(PhoneSheetMetrics.searchMargin))
                .padding(.bottom, CGFloat(PhoneSheetMetrics.searchBottom))
        }
        .background(Theme.bg.ignoresSafeArea())
    }

    private var phoneBar: some View {
        HStack(spacing: 0) {
            GlassCircleButton(systemImage: "xmark", size: .large, accessibilityLabel: "Close", action: close)
                .accessibilityIdentifier("connect-apps-done")
            // a narrow phone (and the longer French words) scales the
            // title and the count down a little rather than cutting them
            Text("Connect apps")
                .font(SettingsMetrics.rowFont)
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .padding(.leading, SettingsMetrics.titleGap)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 8)
            // what is connected (Installed, the Claude account's connectors
            // with them); pressed again, back to the catalog
            Button {
                Haptics.selection()
                model.query = ""
                tab = current == .installed ? .discover : .installed
            } label: {
                Text(String(localized: "\(model.summary.count) connected"))
                    .font(Theme.font(CGFloat(PhoneSheetMetrics.countSize)))
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                    .padding(.horizontal, CGFloat(PhoneSheetMetrics.countPadding))
                    .frame(height: GlassCircleButton.Size.large.rawValue)
                    .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .themeGlass(Capsule())
            .layoutPriority(1)
            .accessibilityAddTraits(current == .installed ? [.isSelected, .isButton] : .isButton)
            .accessibilityIdentifier("connect-apps-manage")
        }
        .padding(.horizontal, SettingsMetrics.headerInset)
    }

    /// All, the categories with apps, the types, then the lists that were
    /// tabs (ConnectAppsChip).
    private var phoneChips: some View {
        let chips = ConnectAppsChip.chips(
            items: model.items, marketplaces: model.marketplaces.map(\.name),
            bots: botsShown, sources: shownTabs.contains(.sources)
        )
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Theme.PhonePanel.chipGap) {
                ForEach(chips, id: \.self) { chip in
                    PhoneChip(title: Text(verbatim: Self.chipTitle(chip)), selected: isSelected(chip), id: "connect-apps-chip.\(chip.key)") {
                        choose(chip)
                    }
                }
            }
            .padding(.horizontal, CGFloat(PhoneSheetMetrics.appsMargin))
        }
        .accessibilityIdentifier("connect-apps-tabs")
    }

    static func chipTitle(_ chip: ConnectAppsChip) -> String {
        switch chip {
        case .all: String(localized: "All")
        case let .category(category): ConnectAppsWords.category(category)
        case let .type(type): ConnectAppsWords.type(type)
        case .bots: ConnectAppsTab.bots.title
        case .pages: ConnectAppsTab.pages.title
        case .sources: ConnectAppsTab.sources.title
        }
    }

    private func isSelected(_ chip: ConnectAppsChip) -> Bool {
        switch chip {
        case .all: current == .discover && model.filter == .all && model.type == .any
        case let .category(category): current == .discover && model.filter == .category(category)
        case let .type(type): current == .discover && model.type == type
        case .bots: current == .bots
        case .pages: current == .pages
        case .sources: current == .sources
        }
    }

    private func choose(_ chip: ConnectAppsChip) {
        switch chip {
        case .all:
            tab = .discover
            model.filter = .all
            model.type = .any
        case let .category(category):
            tab = .discover
            model.filter = model.filter == .category(category) ? .all : .category(category)
        case let .type(type):
            tab = .discover
            model.type = model.type == type ? .any : type
        case .bots: tab = .bots
        case .pages: tab = .pages
        case .sources: tab = .sources
        }
    }

    /// Discover as the reference lists it: a title and a chevron over each
    /// section, the rows on the page with no card.
    private var phoneDiscover: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                if model.loading && model.items.isEmpty {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                }
                ForEach(model.sections) { section in
                    phoneSectionTitle(section)
                    ForEach(section.items) { item in
                        Button { open(item) } label: {
                            ConnectAppRow(item: item, busy: model.busy == item.key) { act(item) }
                        }
                        .buttonStyle(.plain)
                    }
                }
                if !model.loading, model.sections.isEmpty {
                    Text(model.filter == .all && model.type == .any
                        ? String(localized: "Everything in the catalog is already installed.")
                        : String(localized: "Nothing matches"))
                        .font(SettingsMetrics.rowFont)
                        .foregroundStyle(Theme.textSecondary)
                        .padding(.top, CGFloat(PhoneSheetMetrics.sectionTop))
                }
            }
            .padding(.horizontal, CGFloat(PhoneSheetMetrics.appsMargin))
            .padding(.bottom, 16)
        }
        .refreshable {
            await model.load(session)
            if botsShown { await bots.load(session) }
        }
        .accessibilityIdentifier("connect-apps")
    }

    /// "Recommended for you >": the chevron (View all) shows when the
    /// section holds more than it lists.
    @ViewBuilder
    private func phoneSectionTitle(_ section: ConnectApps.Section) -> some View {
        let more = section.viewAll.flatMap { section.total > section.items.count ? $0 : nil }
        Button {
            guard let more else { return }
            Haptics.selection()
            switch more {
            case let .filter(filter): model.filter = filter
            case let .type(type): model.type = type
            }
        } label: {
            HStack(spacing: 8) {
                Text(verbatim: ConnectAppsWords.section(section.id))
                    .font(Theme.font(CGFloat(PhoneSheetMetrics.sectionSize)))
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                if more != nil { ProfileChevron() }
            }
            .padding(.top, CGFloat(PhoneSheetMetrics.sectionTop))
            .padding(.bottom, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        // a title without more keeps its full ink (no disabled dimming)
        .allowsHitTesting(more != nil)
        .accessibilityAddTraits(.isHeader)
        .accessibilityIdentifier(more == nil ? "" : "connect-apps-view-all")
    }

    private func open(_ item: ConnectAppItem) {
        if item.key == tailscaleConnectAppKey { push(.tailscale); return }
        if item.kind == .skill { push(.skill(item.id)) } else { push(.detail(item.key)) }
    }

    private func act(_ item: ConnectAppItem) {
        if item.key == tailscaleConnectAppKey { push(.tailscale); return }
        Task { await model.act(item, alias: nil, session: session) }
    }
}

// MARK: - Manage

/// The tabs of Connect apps, as the desktop names them.
enum ConnectAppsTab: Hashable, Identifiable {
    case installed, discover, bots, sources
    /// The desktop's Pages tab (2026-11-03, iPad lot 3): the pages a bot
    /// proposed and the person published.
    case pages

    var id: Self { self }

    var title: String {
        switch self {
        case .installed: String(localized: "Installed")
        case .discover: String(localized: "Discover")
        case .bots: String(localized: "Bots")
        case .sources: String(localized: "Sources")
        case .pages: String(localized: "Pages")
        }
    }

    /// Discover, or a DEBUG launch argument's tab (`-parityConnectAppsTab
    /// accounts`, for the parity captures).
    static var launch: ConnectAppsTab {
        #if DEBUG
        switch UserDefaults.standard.string(forKey: "parityConnectAppsTab") {
        case "bots": return .bots
        case "installed", "accounts", "providers": return .installed
        case "sources": return .sources
        default: return .discover
        }
        #else
        return .discover
        #endif
    }
}

/// Providers' pills: one service at a time.
enum ConnectAccountsService: Hashable {
    case all, claude, slack, servers

    var title: String {
        switch self {
        case .all: String(localized: "All")
        case .claude: "Claude"
        case .slack: "Slack"
        case .servers: String(localized: "My MCP servers")
        }
    }
}

/// Installed (Providers inside) and Sources: the sections each tab adds to the
/// Connect apps list (Discover and Bots are the main view's own).
struct ConnectAppsManage: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.capabilitiesDesktop) private var desktop
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @ObservedObject var model: ConnectAppsModel
    @Binding var tab: ConnectAppsTab
    let push: (ConnectAppsRoute) -> Void
    @State private var marketSource = ""
    @State private var marketRef = ""
    @State private var removingMarket: String?
    @State private var removing: InstalledEntry?
    @State private var service = ConnectAccountsService.all
    @State private var slackAvailable = false
    /// Installed's New skill (InstalledView.tsx `onNewSkill`): the person's
    /// own skill, in their library (`POST /api/me/skills-library`).
    @State private var creatingSkill = false

    var body: some View {
        Group {
            switch tab {
            case .installed: if desktop { desktopInstalled } else { installed }
            case .sources: sources
            case .discover, .bots, .pages: EmptyView()
            }
        }
        .confirmationDialog(
            String(localized: "Remove the \(removingMarket ?? "") marketplace?"),
            isPresented: Binding(get: { removingMarket != nil }, set: { if !$0 { removingMarket = nil } }),
            titleVisibility: .visible
        ) {
            Button(String(localized: "Remove"), role: .destructive) {
                if let name = removingMarket { Task { await model.removeMarketplace(name, session: session) } }
            }
        }
        .confirmationDialog(
            String(localized: "Remove \(removing?.name ?? "")? Its connectors and skills leave every bot."),
            isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
            titleVisibility: .visible
        ) {
            Button(String(localized: "Remove"), role: .destructive) {
                if let entry = removing { Task { await model.remove(entry, session: session) } }
            }
        }
    }

    // MARK: Installed on the desktop window (InstalledView.tsx)

    /// The phone's own Apple apps first, then the tools, the entries and
    /// Providers. "This Mac" belongs to the Mac app only.
    @ViewBuilder
    private var desktopInstalled: some View {
        let entries = model.entries
        let skills = ConnectApps.privateSkills(model.items)
        PhoneIntegrationsSection()
        Section {
            Button { creatingSkill = true } label: {
                HStack(spacing: 6) {
                    DesktopIconView(icon: .plus, size: 14)
                    Text("New skill").font(theme.font(12.5, .medium))
                }
                .foregroundStyle(theme.ink)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(theme.control, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("connect-apps-new-skill")
            .sheet(isPresented: $creatingSkill) {
                NewPersonalSkillSheet { await model.load(session) }
                    .environmentObject(session)
            }
            if entries.isEmpty && skills.isEmpty && !model.loading {
                HStack(spacing: 12) {
                    Text("Nothing installed yet. Find apps, plugins and skills in Discover.")
                        .font(theme.font(12.5)).foregroundStyle(theme.inkSecondary)
                    Spacer(minLength: 0)
                    Button { tab = .discover } label: {
                        Text("Discover").font(theme.font(12.5, .medium)).foregroundStyle(theme.accentText)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("connect-apps-go-discover")
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(theme.inset, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                // the tools row's mb-3
                .padding(.top, 12)
            }
        }
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
        if !entries.isEmpty || !skills.isEmpty {
            installedRows
        }
        // Providers, 1:1 with the desktop (AccountsView.tsx)
        DesktopProvidersSection(servers: session.surfaceGate.allows(.myConnections))
        if session.surfaceGate.allows(.myConnections) {
            Section { DesktopMyConnectionsSettings(part: .servers) }
        }
    }

    // MARK: Installed: one line per thing, then the private skills

    @ViewBuilder
    private var installed: some View {
        let entries = model.entries
        let skills = ConnectApps.privateSkills(model.items)
        if entries.isEmpty && skills.isEmpty && !model.loading {
            Section {
                Button(String(localized: "Nothing installed yet. Find apps, plugins and skills in Discover.")) { tab = .discover }
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        installedRows
        // What this iPhone can offer. The Mac's Messages setup is not shown here.
        PhoneIntegrationsSection()
        // Providers (2026-10-29): once a tab of their own, now the last
        // section of Installed. A provider listed is already installed.
        accounts
    }

    /// The entries, then the private skills.
    @ViewBuilder
    private var installedRows: some View {
        let entries = model.entries
        let skills = ConnectApps.privateSkills(model.items)
        if !entries.isEmpty {
            Section {
                ForEach(entries) { entry in
                    HStack(spacing: 12) {
                        Button {
                            if entry.primary.key == tailscaleConnectAppKey { push(.tailscale) }
                            else { push(.detail(entry.primary.key)) }
                        } label: {
                            // InstalledView.tsx InstalledRow on the desktop: a 36
                            // tile, the name 13 medium over what it brings 11.5
                            HStack(spacing: 12) {
                                ConnectAppIcon(item: icon(entry), size: desktop ? 36 : 34)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(verbatim: entry.name)
                                        .font(desktop ? theme.font(13, .medium) : .body)
                                        .foregroundStyle(desktop ? theme.ink : Theme.textPrimary).lineLimit(1)
                                    Text(verbatim: brings(entry.brings))
                                        .font(desktop ? theme.font(11.5) : .footnote)
                                        .foregroundStyle(desktop ? theme.inkSecondary : Theme.textSecondary).lineLimit(1)
                                }
                                Spacer(minLength: 8)
                                Text(verbatim: ConnectAppsWords.status(entry.status))
                                    .font(desktop ? theme.font(12) : .footnote)
                                    .foregroundStyle(entry.status == .connected ? (desktop ? theme.accent : Theme.success) : (desktop ? theme.inkSecondary : Theme.textSecondary))
                            }
                            .padding(.vertical, desktop ? 2 : 0)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        Menu {
                            if entry.members.contains(where: { $0.kind == .plugin || $0.kind == .mcp }) {
                                Button(String(localized: "Remove"), role: .destructive) { removing = entry }
                            }
                        } label: {
                            Image(systemName: "ellipsis")
                                .frame(width: 28, height: 28)
                                .foregroundStyle(Theme.textSecondary)
                        }
                        .accessibilityLabel(Text(String(localized: "More for \(entry.name)")))
                        .accessibilityIdentifier("connect-apps-entry-menu.\(entry.key)")
                    }
                    .accessibilityIdentifier("connect-apps-installed.\(entry.key)")
                }
            } header: {
                Text(String(localized: "Installed"))
            }
        }
        if !skills.isEmpty {
            Section {
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
        }
    }

    /// The entry's mark: the plugin's puzzle tile, or its neutral monogram when
    /// a server lends a logo (the logo itself is never drawn).
    private func icon(_ entry: InstalledEntry) -> ConnectAppItem {
        var item = entry.primary
        item.name = entry.name
        item.logo = entry.logo
        item.domain = entry.domain
        return item
    }

    /// "app + 2 connectors", "plugin (marketplace) · 3 skills".
    private func brings(_ brings: InstalledBrings) -> String {
        var counts: [String] = []
        if brings.connectors > 0 { counts.append(brings.connectors == 1 ? String(localized: "1 connector") : String(localized: "\(brings.connectors) connectors")) }
        if brings.skills > 0 { counts.append(brings.skills == 1 ? String(localized: "1 skill") : String(localized: "\(brings.skills) skills")) }
        if let plugin = brings.plugin {
            return ([String(localized: "plugin (\(plugin))")] + (brings.app ? ["app"] : []) + counts).joined(separator: " · ")
        }
        if brings.app { return (["app"] + counts).joined(separator: " + ") }
        return counts.isEmpty ? String(localized: "1 connector") : counts.joined(separator: " · ")
    }

    // MARK: Providers (in Installed): the engines' connectors, then the person's own

    /// All, Claude, Slack (when a bot has a Slack link), and the person's
    /// own MCP servers on an organization server (#218); fewer than two
    /// services, no pills. GitHub is in Sources.
    private var services: [ConnectAccountsService] {
        let shown: [ConnectAccountsService] = [.claude] + (slackAvailable ? [.slack] : []) + (session.surfaceGate.allows(.myConnections) ? [.servers] : [])
        return shown.count >= 2 ? [.all] + shown : []
    }

    @ViewBuilder
    private var accounts: some View {
        Section {} header: {
            Text(String(localized: "Providers"))
        }
        .accessibilityIdentifier("connect-apps-providers")
        if !services.isEmpty {
            Section {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(services, id: \.self) { option in
                            Button {
                                Haptics.selection()
                                service = option
                            } label: {
                                Text(verbatim: option.title)
                                    .font(.footnote.weight(.medium))
                                    .lineLimit(1)
                                    .padding(.horizontal, 12)
                                    .frame(height: 30)
                                    .foregroundStyle(service == option ? Theme.accentInk : Theme.textPrimary)
                                    .background(service == option ? Theme.accent : Theme.chip, in: Capsule())
                            }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(service == option ? .isSelected : [])
                            .accessibilityIdentifier("connect-apps-service.\(option)")
                        }
                    }
                }
            }
        }
        if service == .all || service == .claude {
            Section { ConnectAppsProviders() }
        }
        if service == .all || service == .servers, session.surfaceGate.allows(.myConnections) {
            // the large layout keeps its cards (a token field, Add an MCP server)
            if UIDevice.current.userInterfaceIdiom == .pad {
                Section { DesktopMyConnectionsSettings(part: .servers) }
            } else {
                YourConnectionsSection(part: .servers)
            }
        }
        if service == .all || service == .slack {
            SlackConnectionsSection { slackAvailable = $0 }
        }
    }

    // MARK: Sources: the marketplaces

    @ViewBuilder
    private var sources: some View {
        // the person's own GitHub (#218): every GitHub setting is in Sources
        if session.surfaceGate.allows(.myConnections) {
            if UIDevice.current.userInterfaceIdiom == .pad {
                Section { DesktopMyConnectionsSettings(part: .github) }
            } else {
                YourConnectionsSection(part: .github)
            }
        }
        Section {
            ForEach(model.marketplaces) { market in
                HStack(spacing: 10) {
                    if desktop {
                        Image(systemName: "shippingbox").font(.system(size: 14)).foregroundStyle(theme.ink).frame(width: 20)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: market.name)
                            .font(desktop ? theme.font(13, .semibold) : .body)
                            .foregroundStyle(desktop ? theme.ink : Theme.textPrimary)
                        Text(String(localized: "\(market.plugins.count) plugins, \(market.plugins.filter(\.installed).count) installed"))
                            .font(desktop ? theme.font(11.5) : .footnote)
                            .foregroundStyle(desktop ? theme.inkSecondary : Theme.textSecondary)
                    }
                    Spacer()
                    if model.busy == "market:\(market.name)" { ProgressView().controlSize(.small) }
                    // SourcesView.tsx: the row's own pills where the phone swipes
                    if desktop, session.canAdminister {
                        Button { Task { await model.refreshMarketplace(market.name, session: session) } } label: {
                            Text(String(localized: "Refresh")).font(theme.font(11.5, .medium)).foregroundStyle(theme.ink)
                                .padding(.horizontal, 10).frame(height: 26).background(theme.control, in: Capsule())
                        }
                        .buttonStyle(.plain)
                        if !market.plugins.contains(where: \.installed) {
                            Button { removingMarket = market.name } label: {
                                Text(String(localized: "Remove")).font(theme.font(11.5, .medium)).foregroundStyle(theme.danger)
                                    .padding(.horizontal, 10).frame(height: 26).background(theme.control, in: Capsule())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .swipeActions {
                    if session.canAdminister {
                        if !market.plugins.contains(where: \.installed) {
                            Button(String(localized: "Remove"), role: .destructive) { removingMarket = market.name }
                        }
                        Button(String(localized: "Refresh")) { Task { await model.refreshMarketplace(market.name, session: session) } }
                    }
                }
            }
            if session.canAdminister {
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
            }
        } header: {
            Text(String(localized: "Marketplaces"))
        } footer: {
            Text(String(localized: "Add a Claude Code plugin marketplace: a GitHub repository (owner/repo, optionally a branch), an https git address, or the address of its marketplace.json."))
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
    /// Set on the phone's half sheet: its round X.
    var close: (() -> Void)? = nil
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
        .safeAreaInset(edge: .top, spacing: 0) {
            if let close { sheetBar(close) }
        }
    }

    /// The half sheet's bar (#4103): the round X at the top left, the round
    /// "..." at the top right when there is something in it.
    private func sheetBar(_ close: @escaping () -> Void) -> some View {
        HStack(spacing: 0) {
            GlassCircleButton(systemImage: "xmark", size: .large, accessibilityLabel: "Close", action: close)
                .accessibilityIdentifier("connect-apps-detail-close")
            Spacer(minLength: 0)
            if let item = current, canUninstall(item) {
                Menu { moreMenu } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 17, weight: .medium))
                        .foregroundStyle(Theme.textPrimary)
                        .frame(width: GlassCircleButton.Size.large.rawValue, height: GlassCircleButton.Size.large.rawValue)
                        .contentShape(Circle())
                        .themeGlass(Circle())
                        .accessibilityLabel(Text("More"))
                }
                .accessibilityIdentifier("connect-apps-detail-more")
            }
        }
        .padding(.horizontal, CGFloat(PhoneSheetMetrics.sheetControlInset))
        .padding(.top, CGFloat(PhoneSheetMetrics.sheetControlInset))
    }

    @ViewBuilder private var moreMenu: some View {
        Button(role: .destructive) { confirmingUninstall = true } label: {
            Label(String(localized: "Uninstall"), systemImage: "trash")
        }
        .accessibilityIdentifier("connect-apps-uninstall")
    }

    /// The reference's plugin sheet (#4103): the icon in a rounded tile
    /// and the name centred, the description in muted ink, the state in
    /// one pill centred at the foot; the plugin's accounts, tools and
    /// details under the description, Uninstall in the "..." menu.
    private func content(_ item: ConnectAppItem) -> some View {
        ThemedList {
            Section {
                VStack(spacing: 0) {
                    // the icon is its own rounded tile: one tile, not one inside another
                    ConnectAppIcon(item: item, size: CGFloat(PhoneSheetMetrics.tile))
                        .padding(.top, close == nil ? 8 : CGFloat(PhoneSheetMetrics.tileTop) - CGFloat(PhoneSheetMetrics.sheetControlInset) - GlassCircleButton.Size.large.rawValue / 2)
                    Text(verbatim: item.name)
                        .font(Theme.font(CGFloat(PhoneSheetMetrics.sheetNameSize), .bold))
                        .foregroundStyle(Theme.textPrimary)
                        .multilineTextAlignment(.center)
                        .padding(.top, CGFloat(PhoneSheetMetrics.titleTop))
                    if !item.description.isEmpty {
                        Text(verbatim: item.description)
                            .font(Theme.font(CGFloat(PhoneSheetMetrics.descriptionSize)))
                            .lineSpacing(CGFloat(PhoneSheetMetrics.descriptionPitch - PhoneSheetMetrics.descriptionSize) - 1.4)
                            .foregroundStyle(Theme.textSecondary)
                            .multilineTextAlignment(.leading)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, CGFloat(PhoneSheetMetrics.descriptionTop))
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.horizontal, CGFloat(PhoneSheetMetrics.descriptionInset))
                .listRowInsets(EdgeInsets())
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
        }
        // the pill sits at the foot and the list ends above it: no row runs
        // under the pill
        .safeAreaInset(edge: .bottom, spacing: 0) { statePill(item).frame(maxWidth: .infinity).padding(.top, 8).background(Theme.bg) }
        .toolbar {
            // the iPad's pushed page keeps the menu in its bar
            if close == nil, canUninstall(item) {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu { moreMenu } label: {
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

    /// One pill centred at the foot: Add, Connect or Authorize to press,
    /// else where the plugin stands.
    @ViewBuilder
    private func statePill(_ item: ConnectAppItem) -> some View {
        Group {
            if model.busy == item.key {
                ProgressView().controlSize(.small)
                    .frame(minWidth: CGFloat(PhoneSheetMetrics.statePillWidth), minHeight: CGFloat(PhoneSheetMetrics.statePillHeight))
                    .background(Theme.cardRaised, in: Capsule())
            } else {
                ConnectAppPillButton(pill: ConnectAppPill.of(item), height: CGFloat(PhoneSheetMetrics.statePillHeight),
                                     minWidth: CGFloat(PhoneSheetMetrics.statePillWidth),
                                     textSize: CGFloat(PhoneSheetMetrics.statePillTextSize)) { act(item) }
            }
        }
        .padding(.bottom, CGFloat(PhoneSheetMetrics.statePillBottom) - 12)
        // an Authorize pill acts too: it is the sheet's one sign-in
        .accessibilityIdentifier(ConnectAppPill.of(item).acts ? "connect-apps-detail-action" : "connect-apps-detail-added")
    }

    private func act(_ item: ConnectAppItem) {
        Task { await model.act(item, alias: nil, session: session) }
    }

    private func canUninstall(_ item: ConnectAppItem) -> Bool {
        item.installed && item.kind != .featured && session.canAdminister
    }

    /// The server's sections, each one container (#4103, the desktop's
    /// #4154): Accounts only when an account applies (no "No sign-in
    /// needed" line), Tools unless the server has none (no "0 of 0").
    @ViewBuilder
    private func mcpSections(_ item: ConnectAppItem) -> some View {
        if let server = model.server(item.id) {
            if PluginSheetSections.showsAccount(server) {
                Section {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(verbatim: server.auth == "connected" ? (server.authIssuer ?? String(localized: "Signed in")) : String(localized: "default"))
                            Text(verbatim: accountLine(server)).font(.footnote).foregroundStyle(Theme.textSecondary)
                        }
                        Spacer()
                        // one sign-in on the sheet: the foot pill's Authorize
                        // when it has it, else this button (a server turned off)
                        if PluginSheetSections.accountSignsIn(server, pill: ConnectAppPill.of(item)) {
                            Button(String(localized: "Sign in")) { Task { await model.signIn(server, session: session) } }
                                .buttonStyle(.bordered)
                                .accessibilityIdentifier("connect-apps-sign-in")
                        }
                    }
                } header: {
                    Text(String(localized: "Accounts"))
                }
            }
            if session.canAdminister {
                Section {
                    Toggle(String(localized: "Turned on"), isOn: Binding(
                        get: { server.enabled ?? true },
                        set: { on in Task { await model.setServer(server.name, enabled: on, session: session) } }
                    ))
                    .disabled(server.managedBy != nil)
                }
            }
            if PluginSheetSections.showsTools(model.probes[server.name]) {
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
    /// The old way to Browse Bots' home: it now opens Connect apps on its
    /// Bots tab (`object`: a BotTemplatesDestination raw value).
    static let sagaxOpenBotTemplates = Notification.Name("sagax.openBotTemplates")
}


/// The Connect apps list: the phone's themed list, or the desktop window's
/// flat page (no row chrome, no separators, the window's own background).
struct CapabilitiesList<Content: View>: View {
    @Environment(\.desktopTheme) private var theme
    let desktop: Bool
    @ViewBuilder let content: () -> Content

    var body: some View {
        if desktop {
            // a plain stack (no list section gaps): the body's px-8
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    Group(content: content)
                }
                .padding(.horizontal, 32)
                .padding(.bottom, 28)
            }
            .background(theme.app)
        } else {
            ThemedList(content: content)
        }
    }
}


/// Installed's New skill (plugins/SkillPage.tsx, creating): the name (its
/// rule), the description and the instructions; Save writes the SKILL.md to
/// the person's own library.
struct NewPersonalSkillSheet: View {
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    let saved: () async -> Void
    @State private var name = ""
    @State private var description = ""
    @State private var instructions = ""
    @State private var busy = false
    @State private var error: String?

    private var canSave: Bool {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        return CompanionClient.isSkillName(trimmed) && !description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !busy
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(String(localized: "Name"), text: $name)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("new-skill-name")
                } footer: {
                    Text("Lowercase letters, digits and single hyphens, at most 64 characters.")
                }
                Section(String(localized: "Description")) {
                    TextField(String(localized: "Description"), text: $description, axis: .vertical)
                        .accessibilityIdentifier("new-skill-description")
                }
                Section(String(localized: "Instructions")) {
                    TextEditor(text: $instructions)
                        .frame(minHeight: 180)
                        .accessibilityIdentifier("new-skill-instructions")
                }
                if let error {
                    Section { Text(verbatim: error).foregroundStyle(Theme.danger) }
                }
            }
            .navigationTitle(Text("New skill"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(String(localized: "Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "Save")) { Task { await save() } }
                        .disabled(!canSave)
                        .accessibilityIdentifier("new-skill-save")
                }
            }
        }
    }

    private func save() async {
        guard let client = session.settingsClient else { return }
        busy = true
        defer { busy = false }
        do {
            try await client.createPersonalSkill(name: name.trimmingCharacters(in: .whitespaces), description: description, instructions: instructions)
            await saved()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
