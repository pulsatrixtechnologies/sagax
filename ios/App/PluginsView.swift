// Plugins (iOS parity 15): the reviewed catalog (Featured), the team's own
// servers and connected apps (Team plugins), search across the catalog and
// the MCP Registry, and adding a plugin from the phone, its sign-in
// included: the server's OAuth start runs in ASWebAuthenticationSession and
// comes back to sagax://oauth-done. Geometry: measure-settings.md §5.
// Under them, Connections (WP9): Connected apps, MCP servers and the
// person's claude.ai connectors (Features/Plugins/), each where the pairing
// may reach it (SurfaceGate).
import AuthenticationServices
import CompanionCore
import SwiftUI
import UIKit

@MainActor
final class PluginsModel: ObservableObject {
    @Published private(set) var featured: [PluginListing] = []
    @Published private(set) var results: [PluginListing] = []
    @Published private(set) var installed = InstalledPlugins()
    @Published private(set) var loaded = false
    @Published private(set) var registryAvailable = true
    @Published private(set) var busy: Set<String> = []
    @Published var query = ""
    @Published var filter: PluginFilter = .all
    @Published var message: String?

    private var nextCursor: String?
    private var searchTask: Task<Void, Never>?

    func load(_ client: CompanionClient?) async {
        guard let client else { return }
        async let page = try? client.searchPlugins(query: query)
        async let installed = try? client.installedPlugins()
        if let page = await page {
            featured = page.featured
            results = page.results
            nextCursor = page.nextCursor
            registryAvailable = page.registryAvailable
        }
        if let installed = await installed { self.installed = installed }
        loaded = true
    }

    /// Typing searches after a short pause.
    func search(_ client: CompanionClient?) {
        searchTask?.cancel()
        searchTask = Task {
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled, let client else { return }
            if let page = try? await client.searchPlugins(query: query), !Task.isCancelled {
                featured = page.featured
                results = page.results
                nextCursor = page.nextCursor
                registryAvailable = page.registryAvailable
            }
        }
    }

    func loadMore(_ client: CompanionClient?) async {
        guard let client, let cursor = nextCursor else { return }
        nextCursor = nil
        if let page = try? await client.searchPlugins(query: query, cursor: cursor) {
            results += page.results.filter { new in !results.contains { $0.id == new.id } }
            nextCursor = page.nextCursor
        }
    }

    func isInstalled(_ listing: PluginListing) -> Bool {
        listing.installed || installed.installedURLs.contains(listing.url)
    }

    /// The team's own: installed servers that are not catalog entries, and
    /// connected apps.
    var team: [InstalledPlugin] {
        let catalogURLs = Set(featured.map(\.url))
        return installed.plugins.filter { plugin in
            guard plugin.catalogId == nil else { return false }
            if let url = plugin.url { return !catalogURLs.contains(url) }
            return true
        }
    }

    var visibleFeatured: [PluginListing] { featured.filter { filter.admits(installed: isInstalled($0)) } }
    var visibleResults: [PluginListing] { results.filter { filter.admits(installed: isInstalled($0)) } }
    var visibleTeam: [InstalledPlugin] { team.filter { filter.admits(installed: $0.isReady) } }

    // MARK: Adding

    func add(_ listing: PluginListing, trust: Bool, client: CompanionClient?) async {
        guard let client, !busy.contains(listing.id) else { return }
        if listing.needsHeaders {
            message = String(localized: "This server needs a key in its headers: add it on your computer, in Settings > MCP servers.")
            return
        }
        busy.insert(listing.id)
        defer { busy.remove(listing.id) }
        do {
            let result = try await client.installPlugin(id: listing.id, trust: trust)
            if let url = result.authorizationUrl {
                await signIn(at: url)
            } else if result.needsSignIn {
                message = result.signInError ?? String(localized: "The plugin was added; finish its sign-in on your computer.")
            }
        } catch {
            message = error.localizedDescription
        }
        await refreshInstalled(client)
    }

    func signIn(_ plugin: InstalledPlugin, client: CompanionClient?) async {
        guard let client, case let .mcp(name, _, _, _, _, _, _) = plugin, !busy.contains(plugin.id) else { return }
        busy.insert(plugin.id)
        defer { busy.remove(plugin.id) }
        do {
            await signIn(at: try await client.startPluginSignIn(serverName: name))
        } catch {
            message = error.localizedDescription
        }
        await refreshInstalled(client)
    }

    private func signIn(at url: URL) async {
        do {
            let callback = try await WebSignIn.run(url: url)
            if case let .failed(reason) = PluginSignIn.outcome(of: callback) {
                message = reason.map { String(localized: "The sign-in did not finish: \($0)") } ?? String(localized: "The sign-in did not finish.")
            }
        } catch WebSignIn.Failure.cancelled {
            // The person closed the sheet: the plugin stays added, unsigned.
        } catch {
            message = error.localizedDescription
        }
    }

    private func refreshInstalled(_ client: CompanionClient) async {
        if let installed = try? await client.installedPlugins() { self.installed = installed }
        if let page = try? await client.searchPlugins(query: query) {
            featured = page.featured
            results = page.results
        }
    }
}

/// ASWebAuthenticationSession, awaited.
@MainActor
enum WebSignIn {
    enum Failure: Error { case cancelled, noCallback }

    private final class Anchor: NSObject, ASWebAuthenticationPresentationContextProviding {
        func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
            MainActor.assumeIsolated {
                let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
                return scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor()
            }
        }
    }

    private static let anchor = Anchor()
    private static var current: ASWebAuthenticationSession?

    static func run(url: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: PluginSignIn.callbackScheme) { callback, error in
                Task { @MainActor in current = nil }
                if let callback { continuation.resume(returning: callback); return }
                if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                    continuation.resume(throwing: Failure.cancelled)
                } else {
                    continuation.resume(throwing: error ?? Failure.noCallback)
                }
            }
            session.presentationContextProvider = anchor
            session.prefersEphemeralWebBrowserSession = false
            current = session
            if !session.start() {
                current = nil
                continuation.resume(throwing: Failure.noCallback)
            }
        }
    }
}

// MARK: - Screen

struct PluginsView: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var settings: SettingsModel
    @StateObject private var model = PluginsModel()
    @State private var trusting: PluginListing?
    @State private var showingAll: PluginsListKind?

    private var background: Color { Theme.bg }
    private var searching: Bool { !model.query.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        ZStack(alignment: .top) {
            background.ignoresSafeArea()
            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    Color.clear.frame(height: 142.8)
                    content
                    Color.clear.frame(height: 40)
                }
            }
            .scrollDismissesKeyboard(.immediately)
            .topScrollEdgeFade(height: 128, background: background)
            header
        }
        .overlay {
            if let showingAll {
                Group {
                    switch showingAll {
                    case .featured, .team: PluginsListView(kind: showingAll, model: model)
                    case .mcpServers: McpServersList()
                    case .harnessConnectors: HarnessConnectorsView()
                    }
                }
                .environment(\.settingsPop, { self.showingAll = nil })
                .transition(.move(edge: .trailing))
            }
        }
        .animation(.spring(response: 0.34, dampingFraction: 0.92), value: showingAll)
        .task {
            await model.load(session.settingsClient)
            settings.setInstalledCount(model.installed.count)
        }
        .onValueChange(of: model.query) { _ in model.search(session.settingsClient) }
        .onValueChange(of: model.installed.count) { settings.setInstalledCount($0) }
        .confirmationDialog("Add a community server?", isPresented: Binding(get: { trusting != nil }, set: { if !$0 { trusting = nil } }), titleVisibility: .visible) {
            Button("Add") {
                if let listing = trusting { Task { await model.add(listing, trust: true, client: session.settingsClient) } }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("It is not reviewed by Sagax. Its address is \(trusting?.domain ?? ""). Add it only if you trust who runs it.")
        }
        .alert("Plugins", isPresented: Binding(get: { model.message != nil }, set: { if !$0 { model.message = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(verbatim: model.message ?? "")
        }
    }

    // MARK: Header

    @Environment(\.dismiss) private var dismiss
    @Environment(\.settingsPop) private var settingsPop

    private var header: some View {
        VStack(spacing: 9.67) {
            HStack(spacing: 0) {
                GlassCircleButton(systemImage: "chevron.left", size: .sheet, accessibilityLabel: "Back", glyphOffset: CGSize(width: 1, height: 0)) {
                    if let settingsPop { settingsPop() } else { dismiss() }
                }
                    .accessibilityIdentifier("settings-back")
                Text("Plugins")
                    .font(Theme.Font.headerTitle)
                    .tracking(SettingsMetrics.tracking135)
                    .foregroundStyle(Theme.textPrimary)
                    .padding(.leading, SettingsMetrics.titleGap)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 8)
                installedCapsule
            }
            HStack(spacing: 8) {
                SettingsSearchField(prompt: "Search plugins", text: $model.query, identifier: "plugins-search")
                filterButton
            }
        }
        .padding(.horizontal, SettingsMetrics.headerInset)
        .padding(.top, SettingsMetrics.headerInset)
    }

    private var installedCapsule: some View {
        Button {
            Haptics.selection()
            model.filter = .installed
        } label: {
            HStack(spacing: 0) {
                ZStack(alignment: .leading) {
                    ForEach(Array(model.installed.plugins.prefix(3).enumerated()), id: \.offset) { index, plugin in
                        PluginIconTile(installed: plugin, size: 19, circle: true)
                            .offset(x: CGFloat(index) * 12.67)
                    }
                }
                .frame(width: model.installed.plugins.isEmpty ? 0 : 19 + CGFloat(min(3, model.installed.plugins.count) - 1) * 12.67, alignment: .leading)
                .padding(.trailing, model.installed.plugins.isEmpty ? 0 : 8)
                Text("\(model.installed.count) installed")
                    .font(Theme.Font.headerTitle)
                    .tracking(SettingsMetrics.tracking135)
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                    .accessibilityIdentifier("plugins-installed-count")
            }
            .padding(.leading, 14)
            .padding(.trailing, 14.7)
            .frame(height: 42.33)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .themeGlass(Capsule())
        .accessibilityIdentifier("plugins-installed")
    }

    private var filterButton: some View {
        Menu {
            Picker("Show", selection: $model.filter) {
                Text("All").tag(PluginFilter.all)
                Text("Installed").tag(PluginFilter.installed)
                Text("Not installed").tag(PluginFilter.notInstalled)
            }
        } label: {
            // Three centred bars, 17.33 / 11 / 4 pt wide on a 5.9 pt pitch.
            VStack(spacing: 4) {
                ForEach([17.33, 11, 4] as [CGFloat], id: \.self) { width in
                    Capsule().frame(width: width, height: 2)
                }
            }
            .foregroundStyle(model.filter == .all ? Theme.textPrimary : Theme.blue)
            .offset(y: -0.2)
            .frame(width: 42, height: 42)
                .contentShape(Circle())
        }
        .themeGlass(Circle())
        .accessibilityLabel("Filter")
        .accessibilityIdentifier("plugins-filter")
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        if !model.loaded {
            ProgressView().tint(Theme.textSecondary).padding(.top, 30)
        } else if searching {
            let rows = model.visibleFeatured + model.visibleResults
            PluginsSectionHeader(title: "Results")
            if rows.isEmpty {
                PluginsEmptyLine(text: model.registryAvailable ? "No plugin matches." : "No plugin matches. The community registry is unreachable right now.")
            }
            ForEach(rows) { listing in listingRow(listing) }
        } else {
            PluginsSectionHeader(title: "Featured") { showingAll = .featured }
            if model.visibleFeatured.isEmpty { PluginsEmptyLine(text: "Nothing here with this filter.") }
            ForEach(model.visibleFeatured.prefix(4)) { listing in listingRow(listing) }
            PluginsSectionHeader(title: "Team plugins") { showingAll = .team }
                .padding(.top, 8)
            if model.visibleTeam.isEmpty { PluginsEmptyLine(text: "Servers and apps added on your computer show up here.") }
            ForEach(model.visibleTeam.prefix(3)) { plugin in teamRow(plugin) }
            connections
        }
    }

    /// The desktop Plugins window's other doors (WP9): its Connected apps
    /// and MCP servers tabs, and the person's own claude.ai connectors.
    /// Each row shows only where the pairing may reach it (SurfaceGate).
    @ViewBuilder
    private var connections: some View {
        let gate = session.surfaceGate
        let mcp = gate.allows(.mcpServers)
        let claude = gate.allows(.harnessConnectors)
        if mcp || claude {
            PluginsSectionHeader(title: "Connections")
                .padding(.top, 8)
            SettingsCard {
                if mcp {
                    SettingsRow(title: "MCP servers", systemImage: "server.rack", accessory: .chevron, identifier: "plugins-mcp-servers") {
                        showingAll = .mcpServers
                    }
                }
                if claude {
                    if mcp { CardHairline(leadingInset: SettingsMetrics.rowInset) }
                    SettingsRow(title: "Provided by Claude", systemImage: "powerplug", accessory: .chevron, identifier: "plugins-harness-connectors") {
                        showingAll = .harnessConnectors
                    }
                }
            }
        }
    }

    func listingRow(_ listing: PluginListing) -> some View {
        PluginListingRow(listing: listing, installed: model.isInstalled(listing), busy: model.busy.contains(listing.id)) {
            if listing.isCommunity { trusting = listing } else {
                Task { await model.add(listing, trust: false, client: session.settingsClient) }
            }
        }
    }

    func teamRow(_ plugin: InstalledPlugin) -> some View {
        PluginTeamRow(plugin: plugin, busy: model.busy.contains(plugin.id)) {
            Task { await model.signIn(plugin, client: session.settingsClient) }
        }
    }
}

enum PluginsListKind: Hashable { case featured, team, mcpServers, harnessConnectors }

/// "View all": every featured entry, or every team plugin.
struct PluginsListView: View {
    @Environment(\.themePalette) var themePalette
    let kind: PluginsListKind
    @ObservedObject var model: PluginsModel
    @EnvironmentObject private var session: Session

    var body: some View {
        SettingsPage(title: kind == .featured ? "Featured" : "Team plugins", contentTop: 80) {
            switch kind {
            case .mcpServers, .harnessConnectors:
                EmptyView()
            case .featured:
                ForEach(model.visibleFeatured) { listing in
                    PluginListingRow(listing: listing, installed: model.isInstalled(listing), busy: model.busy.contains(listing.id)) {
                        Task { await model.add(listing, trust: false, client: session.settingsClient) }
                    }
                }
            case .team:
                if model.visibleTeam.isEmpty { PluginsEmptyLine(text: "Servers and apps added on your computer show up here.") }
                ForEach(model.visibleTeam) { plugin in
                    PluginTeamRow(plugin: plugin, busy: model.busy.contains(plugin.id)) {
                        Task { await model.signIn(plugin, client: session.settingsClient) }
                    }
                }
            }
        }
    }
}

// MARK: - Rows

private struct PluginsSectionHeader: View {
    @Environment(\.themePalette) var themePalette
    let title: LocalizedStringKey
    var viewAll: (() -> Void)?

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .font(Theme.Font.label)
                .foregroundStyle(Theme.parity(Color(hex: 0x575658), Theme.placeholder))
            Spacer()
            if let viewAll {
                Button("View all") {
                    Haptics.selection()
                    viewAll()
                }
                .font(Theme.Font.label)
                .foregroundStyle(Theme.parity(Color(hex: 0x97969C), Theme.textSecondary))
                .buttonStyle(.plain)
            }
        }
        .padding(.leading, 21.7)
        .padding(.trailing, 22)
        .padding(.bottom, 12)
    }
}

private struct PluginsEmptyLine: View {
    @Environment(\.themePalette) var themePalette
    let text: LocalizedStringKey

    var body: some View {
        Text(text)
            .font(Theme.Font.label)
            .foregroundStyle(Theme.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 21.7)
            .padding(.vertical, 14)
    }
}

/// Tile, name and description, and the Add / Added pill.
private struct PluginRowLayout<Icon: View, Pill: View>: View {
    @Environment(\.themePalette) var themePalette
    let name: String
    let description: String
    let identifier: String
    @ViewBuilder let icon: () -> Icon
    @ViewBuilder let pill: () -> Pill

    var body: some View {
        HStack(spacing: 0) {
            icon()
            VStack(alignment: .leading, spacing: 2.6) {
                Text(verbatim: name)
                    .font(Theme.Font.rowTitle)
                    .tracking(SettingsMetrics.tracking135)
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                if !description.isEmpty {
                    Text(verbatim: description)
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.textSecondary)
                        .lineSpacing(0.87)
                        .lineLimit(2)
                        .truncationMode(.tail)
                }
            }
            .padding(.leading, 14)
            Spacer(minLength: 12)
            pill()
        }
        .padding(.leading, 21)
        .padding(.trailing, 21)
        .padding(.vertical, 15.25)
        .frame(minHeight: 69)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(identifier)
    }
}

private struct PluginListingRow: View {
    @Environment(\.themePalette) var themePalette
    let listing: PluginListing
    let installed: Bool
    let busy: Bool
    let add: () -> Void

    var body: some View {
        PluginRowLayout(
            name: listing.name,
            description: listing.reviewed ? listing.description : [listing.description, listing.domain].filter { !$0.isEmpty }.joined(separator: " · "),
            identifier: "plugin-row.\(listing.id)"
        ) {
            PluginIconTile(key: listing.icon, remote: listing.iconUrl, size: 38.5)
        } pill: {
            PluginPill(installed: installed, busy: busy, action: add)
                .accessibilityIdentifier("plugin-add.\(listing.id)")
        }
    }
}

private struct PluginTeamRow: View {
    @Environment(\.themePalette) var themePalette
    let plugin: InstalledPlugin
    let busy: Bool
    let signIn: () -> Void

    var body: some View {
        PluginRowLayout(name: plugin.name, description: plugin.domain ?? "", identifier: "plugin-team.\(plugin.id)") {
            PluginIconTile(installed: plugin, size: 38.5)
        } pill: {
            PluginPill(installed: plugin.isReady, busy: busy, action: signIn)
                .accessibilityIdentifier("plugin-add.\(plugin.id)")
        }
    }
}

/// "Add" (44.67 x 32.67) or "Added" (58 x 32.67): #2B2B2D, no rim.
private struct PluginPill: View {
    @Environment(\.themePalette) var themePalette
    let installed: Bool
    let busy: Bool
    let action: () -> Void

    var body: some View {
        Button {
            Haptics.selection()
            action()
        } label: {
            Group {
                if busy {
                    ProgressView().controlSize(.small).tint(Theme.textPrimary)
                } else {
                    Text(installed ? "Added" : "Add")
                        .font(Theme.Font.labelMedium)
                        .foregroundStyle(installed ? Theme.addedText : Theme.textPrimary)
                        .lineLimit(1)
                        .fixedSize()
                }
            }
            .padding(.horizontal, 12.3)
            .frame(minWidth: 44.67)
            .frame(height: 32.67)
            .background(Theme.pill, in: Capsule())
        }
        .buttonStyle(.plain)
        // Black and Dim keep the measured, dimmed "Added"; the other skins
        // keep it readable (a disabled plain button fades its label below
        // 3:1 on a light pill) and refuse the tap instead.
        .disabled(Theme.keepsReference && (installed || busy))
        .allowsHitTesting(!(installed || busy))
        .accessibilityAddTraits(installed || busy ? .isStaticText : [])
    }
}
