// iPad I-sync: the bot panel's Library tab (`bot-settings/LibraryTab.tsx`):
// the bot's files only, no Files | Skills sub-tabs (skills live on the
// Personas page). Plugins open from a link under the files.
// On the web the bot's plugins moved to Connect apps, scope "For <bot>"
// (`PluginsPanel.tsx`, `plugins/BotPluginCard.tsx`,
// `plugins/MarketplacesSection.tsx`); the web Library is Files | Skills with
// a link there. Capabilities (the bot's resolved list, `BotPanelCapabilities`
// below) opens from a link beside Plugins.
// The Plugins view mirrors that scope and needs a server pairing: the companion
// sidecar does not list `/api/bots/:id/plugins`, so a sidecar pairing shows
// Files and Skills only (`SurfaceFeature.botPlugins`).
//
// Each sub-tree is type-erased (`AnyView`), as in BotPanel.swift.
import SwiftUI
import CompanionCore

enum BotPanelLibraryView: String, CaseIterable, Identifiable {
    case files, skills, plugins
    var id: String { rawValue }

    var title: LocalizedStringKey {
        switch self {
        case .files: "Files"
        case .skills: "Skills"
        case .plugins: "Plugins"
        }
    }
}

struct BotPanelLibrary: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let bot: Bot
    let docked: Bool

    @State private var view: BotPanelLibraryView = .files

    /// panel-library-skills / -plugins: the reference opens that view.
    private static var parityView: BotPanelLibraryView {
        #if DEBUG
        switch ParityLaunch.current?.iPadScreen {
        case .panelLibrarySkills: return .skills
        case .panelLibraryPlugins: return .plugins
        default: return .files
        }
        #else
        return .files
        #endif
    }

    /// Files only; the tabs show only if a view is added back.
    private var views: [BotPanelLibraryView] { [.files] }
    @State private var showingPlugins = Self.parityView == .plugins
    @State private var showingCapabilities = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if views.count > 1 {
                AnyView(tabs)
                    .padding(.top, 8)
                    .padding(.leading, 17)
                    .padding(.trailing, 16)
            }
            AnyView(content)
                .padding(.top, 4)
            if BotCapabilityRules.reachable(gate: session.surfaceGate) {
                Button { showingCapabilities = true } label: {
                    Label("Capabilities", systemImage: "square.stack.3d.up")
                        .font(theme.font(12.5))
                        .foregroundStyle(theme.inkSecondary)
                        .padding(.horizontal, 8)
                        .frame(height: 26)
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .padding(.leading, 17)
                .accessibilityIdentifier("desktop-panel-library.open-capabilities")
            }
            if session.surfaceGate.allows(.botPlugins) {
                Button { showingPlugins = true } label: {
                    Label("Plugins", systemImage: "puzzlepiece.extension")
                        .font(theme.font(12.5))
                        .foregroundStyle(theme.inkSecondary)
                        .padding(.horizontal, 8)
                        .frame(height: 26)
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .padding(.leading, 17)
                .padding(.bottom, 16)
                .accessibilityIdentifier("desktop-panel-library.open-plugins")
            }
        }
        .sheet(isPresented: $showingPlugins) {
            NavigationStack { ScrollView { BotPanelPlugins(bot: bot).padding(16) }.navigationTitle(Text("Plugins")) }
        }
        .sheet(isPresented: $showingCapabilities) {
            NavigationStack { ScrollView { BotPanelCapabilities(bot: bot).id(bot.id).padding(16) }.navigationTitle(Text("Capabilities")) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-panel-library")
    }

    private var tabs: some View {
        HStack(spacing: 4) {
            ForEach(views) { item in
                let selected = view == item
                Button { view = item } label: {
                    Text(item.title)
                        .font(theme.font(12.5))
                        .foregroundStyle(selected ? theme.ink : theme.inkSecondary)
                        .padding(.horizontal, 8)
                        .frame(height: 26)
                        .background(selected ? theme.elevatedHover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
                .accessibilityIdentifier("desktop-panel-library.\(item.rawValue)")
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Library views"))
    }

    @ViewBuilder
    private var content: some View {
        switch view {
        case .files:
            AnyView(BotPanelFiles(bot: bot, docked: docked))
        case .skills:
            AnyView(BotPanelSkills(bot: bot))
                .padding(.top, 8)
                .padding(.leading, 17)
                .padding(.trailing, 16)
                .padding(.bottom, 24)
        case .plugins:
            AnyView(BotPanelPlugins(bot: bot))
                .padding(.top, 8)
                .padding(.leading, 17)
                .padding(.trailing, 16)
                .padding(.bottom, 24)
        }
    }
}

// MARK: - Plugins

@MainActor
final class BotPluginsModel: ObservableObject {
    @Published var view: BotPluginsView?
    @Published var error: String?
    @Published var busy: String?
    var client: CompanionClient?
    let botId: String

    init(botId: String) { self.botId = botId }

    func refresh() async {
        guard let client else { return }
        do {
            view = try await client.botPlugins(botId: botId)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    func run(_ key: String, _ work: @escaping (CompanionClient) async throws -> BotPluginsView) async -> Bool {
        guard let client, busy == nil else { return false }
        busy = key
        error = nil
        defer { busy = nil }
        do {
            view = try await work(client)
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }
}

/// A bot's plugins, as Connect apps shows them "For <bot>" on the web
/// (`PluginsPanel.tsx`, `plugins/BotPluginCard.tsx`,
/// `plugins/MarketplacesSection.tsx`): the intro, the notices, the
/// installed list (switch, Uninstall), then each marketplace with its
/// plugins (Install / Update) and the Add a marketplace field.
struct BotPanelPlugins: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let bot: Bot

    @StateObject private var model: BotPluginsModel
    @State private var source = ""

    init(bot: Bot) {
        self.bot = bot
        _model = StateObject(wrappedValue: BotPluginsModel(botId: bot.id))
    }

    var body: some View {
        AnyView(content)
            .task(id: bot.id) {
                model.client = session.profileClient
                await model.refresh()
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("desktop-panel-plugins")
    }

    @ViewBuilder
    private var content: some View {
        if let view = model.view {
            AnyView(loaded(view))
        } else if let error = model.error {
            Text(verbatim: error).font(theme.font(12.5)).foregroundStyle(theme.danger)
        } else {
            Text("Loading plugins…").font(theme.font(12.5)).foregroundStyle(theme.inkSecondary)
        }
    }

    private func loaded(_ view: BotPluginsView) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Claude Code plugins from a marketplace (owner/repo or an https git address). Their skills, commands and agents load in this bot's turns; hooks and the plugin's own MCP servers are left out because they would run on the server.")
                .font(theme.font(12.5))
                .lineSpacing(4)
                .foregroundStyle(theme.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
            if !view.engine.loadsPlugins {
                notice("Plugins load only when this bot runs on Claude Code.")
            }
            if !view.canChange {
                notice("Only the bot's owner, or someone who manages it, can change its plugins.")
            }
            AnyView(installed(view))
            AnyView(marketplaces(view))
            if let error = model.error {
                Text(verbatim: error).font(theme.font(12)).foregroundStyle(theme.danger)
            }
        }
    }

    private func notice(_ text: LocalizedStringKey) -> some View {
        Text(text)
            .font(theme.font(12))
            .foregroundStyle(theme.inkSecondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private func heading(_ text: LocalizedStringKey) -> some View {
        Text(text).font(theme.font(13, .medium)).foregroundStyle(theme.ink)
    }

    private func installed(_ view: BotPluginsView) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            heading("Installed")
            if view.plugins.isEmpty {
                Text("No plugin installed.").font(theme.font(12)).foregroundStyle(theme.inkSecondary)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(view.plugins.enumerated()), id: \.element.key) { index, plugin in
                        if index > 0 { Rectangle().fill(theme.hairline40).frame(height: 1) }
                        AnyView(installedRow(plugin, canChange: view.canChange))
                    }
                }
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline40, lineWidth: 1))
            }
        }
    }

    private func installedRow(_ plugin: BotPluginsView.Installed, canChange: Bool) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                (Text(verbatim: plugin.name).foregroundColor(theme.ink)
                 + Text(verbatim: "@\(plugin.marketplace)").foregroundColor(theme.inkSecondary)
                 + Text(verbatim: plugin.version.map { " \($0)" } ?? "").foregroundColor(theme.inkSecondary))
                    .font(Theme.mono(12.5))
                    .lineLimit(1)
                if let description = plugin.description, !description.isEmpty {
                    Text(verbatim: description).font(theme.font(11.5)).foregroundStyle(theme.inkSecondary).lineLimit(2)
                }
                if !plugin.removed.isEmpty {
                    Text("Left out: \(plugin.removed.joined(separator: ", "))").font(theme.font(11.5)).foregroundStyle(theme.inkSecondary)
                }
                if !plugin.declaredMcpServers.isEmpty {
                    Text("Declares MCP servers \(plugin.declaredMcpServers.joined(separator: ", ")): add them in Settings > My connections to use them.")
                        .font(theme.font(11.5)).foregroundStyle(theme.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if canChange {
                PanelSwitch(label: "Use \(plugin.name)", isOn: plugin.enabled, disabled: model.busy != nil) { enabled in
                    Task { _ = await model.run("toggle:\(plugin.key)") { try await $0.setBotPluginEnabled(botId: bot.id, key: plugin.key, enabled: enabled) } }
                }
                pillButton("Uninstall") {
                    Task { _ = await model.run("rm:\(plugin.key)") { try await $0.uninstallBotPlugin(botId: bot.id, key: plugin.key) } }
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    private func marketplaces(_ view: BotPluginsView) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            heading("Marketplaces")
            if view.policy.isList {
                let list = (view.policy.allow ?? []).joined(separator: ", ")
                Text("Your organization allows: \(list.isEmpty ? "-" : list)").font(theme.font(12)).foregroundStyle(theme.inkSecondary)
            }
            ForEach(view.marketplaces) { market in
                AnyView(marketplace(market, canChange: view.canChange))
            }
            if view.canChange {
                HStack(spacing: 8) {
                    PanelTextField(placeholder: "owner/repo or https://…", text: $source) { addMarketplace() }
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityLabel(Text("Add a marketplace"))
                    pillButton(model.busy == "add" ? "Adding…" : "Add a marketplace", primary: true,
                               disabled: source.trimmingCharacters(in: .whitespaces).isEmpty) { addMarketplace() }
                }
            }
        }
    }

    private func marketplace(_ market: BotPluginsView.Listing, canChange: Bool) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 1) {
                    (Text(verbatim: market.name).foregroundColor(theme.ink)
                     + Text(verbatim: " (\(market.source))").foregroundColor(theme.inkSecondary))
                        .font(theme.font(12.5))
                        .lineLimit(1)
                    if let description = market.description, !description.isEmpty {
                        Text(verbatim: description).font(theme.font(11.5)).foregroundStyle(theme.inkSecondary).lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if canChange {
                    pillButton("Update") {
                        Task { _ = await model.run("up:\(market.name)") { try await $0.updatePluginMarketplace(botId: bot.id, name: market.name) } }
                    }
                    pillButton("Remove") {
                        Task { _ = await model.run("rmm:\(market.name)") { try await $0.removePluginMarketplace(botId: bot.id, name: market.name) } }
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(theme.inset)
            if market.plugins.isEmpty {
                Text("No plugin in this marketplace.")
                    .font(theme.font(12)).foregroundStyle(theme.inkSecondary)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            ForEach(market.plugins) { plugin in
                Rectangle().fill(theme.hairline40).frame(height: 1)
                HStack(spacing: 8) {
                    VStack(alignment: .leading, spacing: 1) {
                        (Text(verbatim: plugin.name).foregroundColor(theme.ink)
                         + Text(verbatim: plugin.version.map { " \($0)" } ?? "").foregroundColor(theme.inkSecondary))
                            .font(Theme.mono(12.5))
                            .lineLimit(1)
                        if let description = plugin.description, !description.isEmpty {
                            Text(verbatim: description).font(theme.font(11.5)).foregroundStyle(theme.inkSecondary).lineLimit(2)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    if canChange {
                        let key = "in:\(market.name):\(plugin.name)"
                        pillButton(model.busy == key ? "Installing…" : plugin.installed ? "Update" : "Install", primary: !plugin.installed) {
                            Task { _ = await model.run(key) { try await $0.installBotPlugin(botId: bot.id, marketplace: market.name, plugin: plugin.name) } }
                        }
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline40, lineWidth: 1))
    }

    /// `.ui-button` (30 tall, px 13, a pill in `hover`) and `.ui-button-primary`
    /// (`ink` on `app`).
    private func pillButton(_ title: LocalizedStringKey, primary: Bool = false, disabled: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(theme.font(13))
                .foregroundStyle(primary ? theme.app : theme.ink)
                .lineLimit(1)
                .padding(.horizontal, 13)
                .frame(height: 30)
                .background(primary ? theme.ink : theme.hover, in: Capsule())
        }
        .buttonStyle(.plain)
        .disabled(disabled || model.busy != nil)
        .opacity(disabled || model.busy != nil ? 0.5 : 1)
    }

    private func addMarketplace() {
        let text = source.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        Task {
            if await model.run("add", { try await $0.addPluginMarketplace(botId: bot.id, source: text) }) { source = "" }
        }
    }
}

// MARK: - Capabilities (« Capacités »)

/// The bot's resolved list (`GET /api/bots/:id/capabilities`), shared by the
/// iPad panel and the iPhone Library: load, one switch at a time through the
/// route of its kind, a skill's text to read before it is turned on.
@MainActor
final class BotCapabilitiesModel: ObservableObject {
    struct Review: Identifiable {
        let item: BotCapability
        let toggle: BotCapabilityToggle
        let text: String
        var id: String { item.key }
    }

    @Published var list: BotCapabilityList?
    @Published var error: String?
    @Published var busy: String?
    @Published var review: Review?
    var client: CompanionClient?
    let botId: String
    /// The bot's own list of this installation's servers (nil: every server).
    var mcpServers: [String]?

    init(bot: Bot) {
        botId = bot.id
        mcpServers = bot.mcpServers
    }

    func refresh() async {
        guard let client else { return }
        do {
            list = try await client.botCapabilities(botId: botId)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    func set(_ item: BotCapability, on: Bool) {
        guard let toggle = item.toggle, let list, busy == nil, let client else { return }
        busy = item.key
        error = nil
        Task {
            defer { busy = nil }
            do {
                if toggle.needsReview(on: on) {
                    guard let text = try await client.capabilitySkillText(botId: botId, toggle: toggle), !text.isEmpty else {
                        error = String(localized: "The skill contents are unavailable; remove and import or learn it again.")
                        return
                    }
                    review = Review(item: item, toggle: toggle, text: text)
                    return
                }
                if let bot = try await client.setBotCapability(botId: botId, toggle: toggle, on: on, list: list, mcpServers: mcpServers) {
                    mcpServers = bot.mcpServers
                }
                await refresh()
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    /// The person read the skill: turn it on.
    func confirm(_ review: Review) {
        guard let list, busy == nil, let client else { return }
        busy = review.item.key
        Task {
            defer { busy = nil }
            do {
                try await client.setBotCapability(botId: botId, toggle: review.toggle, on: true, list: list, mcpServers: mcpServers)
                self.review = nil
                await refresh()
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

/// The words of a capability's form, scope, state and reason.
enum CapabilityText {
    /// Readable, never an id: a Role Perspicax no longer lists has no name.
    static func name(_ item: BotCapability) -> String {
        HumanID.readable(item.name, or: item.form == .role ? String(localized: "Unknown Role") : String(localized: "Unnamed"))
    }

    static func form(_ form: BotCapability.Form) -> LocalizedStringKey? {
        switch form {
        case .plugin: "Plugin"
        case .skill: "Skill"
        case .mcp: "MCP server"
        case .connector: "Connector"
        case .role: "Role"
        case .flow: "Flow"
        case .other: nil
        }
    }

    static func scope(_ scope: BotCapability.Scope) -> LocalizedStringKey? {
        switch scope {
        case .bot: "This bot"
        case .me: "Me"
        case .organization: "Organization"
        case .installation: "Installation"
        case .account: "Engine account"
        case .other: nil
        }
    }

    static func state(_ state: BotCapability.State) -> LocalizedStringKey {
        switch state {
        case .on: "On"
        case .off: "Off"
        case .toConnect: "To connect"
        case .imposed: "Imposed by the organization"
        case .notHeld: "Not held"
        case .notServed: "Not served by this engine"
        case .reserved: "Reserved name"
        case .unverifiable: "Unverifiable"
        case .other: "Unknown"
        }
    }

    static func reason(_ reason: String?) -> LocalizedStringKey? {
        switch reason {
        case "name_taken": "Another server already has this name"
        case "not_selected": "Left out of this bot's list"
        case "host_command": "A command server, never run on an organization's server"
        case "policy": "Not allowed by the organization"
        case "needs_github": "Needs GitHub"
        case "needs_token": "Needs a token"
        case "needs_sign_in": "Needs a sign-in"
        case "no_environment": "Needs an environment"
        case "private_address": "A private address, refused"
        case "library_off": "The skills library is off"
        case "not_assigned": "Not assigned to this bot"
        case "guard_off": "Held back by Perspicax"
        case "not_member": "The bot's owner is not an active member"
        case "not_installed": "Not installed yet"
        case "unknown_profile": "Perspicax no longer lists this Role"
        case "disabled": "Turned off where it is kept"
        default: nil
        }
    }

    /// Form · scope · source (version), as one line.
    static func detail(_ item: BotCapability) -> Text {
        var parts: [Text] = []
        if let form = form(item.form) { parts.append(Text(form)) }
        if let scope = scope(item.scope) { parts.append(Text(scope)) }
        let source = [item.sourceLabel, item.sourceVersion ?? ""].filter { !$0.isEmpty && !HumanID.isOpaque($0) }.joined(separator: " ")
        if !source.isEmpty { parts.append(Text(verbatim: source)) }
        return parts.dropFirst().reduce(parts.first ?? Text(verbatim: "")) { $0 + Text(verbatim: " · ") + $1 }
    }
}

/// A skill's text, read before the switch turns it on (as the Skills section).
struct CapabilitySkillReviewSheet: View {
    let review: BotCapabilitiesModel.Review
    let onCancel: () -> Void
    let onConfirm: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                Text(verbatim: review.text)
                    .font(.system(.footnote, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
            }
            .navigationTitle(Text(verbatim: CapabilityText.name(review.item)))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: onCancel) }
                ToolbarItem(placement: .confirmationAction) { Button("Turn on", action: onConfirm) }
            }
            .safeAreaInset(edge: .top) {
                Text("Review before turning on")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
            }
        }
    }
}

/// Bot > Capabilities on the iPad panel: one row per capability (name,
/// form, scope, state), its switch where `canToggle`, and the box
/// « What <bot> receives (engine: X) ».
struct BotPanelCapabilities: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let bot: Bot

    @StateObject private var model: BotCapabilitiesModel

    init(bot: Bot) {
        self.bot = bot
        _model = StateObject(wrappedValue: BotCapabilitiesModel(bot: bot))
    }

    var body: some View {
        AnyView(content)
            .task(id: bot.id) {
                model.client = session.profileClient
                await model.refresh()
            }
            .sheet(item: $model.review) { review in
                CapabilitySkillReviewSheet(review: review, onCancel: { model.review = nil }, onConfirm: { model.confirm(review) })
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("desktop-panel-capabilities")
    }

    @ViewBuilder
    private var content: some View {
        if let list = model.list {
            AnyView(loaded(list))
        } else if let error = model.error {
            Text(verbatim: error).font(theme.font(12.5)).foregroundStyle(theme.danger)
        } else {
            Text("Loading capabilities…").font(theme.font(12.5)).foregroundStyle(theme.inkSecondary)
        }
    }

    private func loaded(_ list: BotCapabilityList) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            AnyView(receipt(list))
            if list.items.isEmpty {
                Text("No capabilities on this bot yet.").font(theme.font(12)).foregroundStyle(theme.inkSecondary)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(list.items.enumerated()), id: \.element.key) { index, item in
                        if index > 0 { Rectangle().fill(theme.hairline40).frame(height: 1) }
                        AnyView(row(item))
                    }
                }
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline40, lineWidth: 1))
            }
            if let error = model.error {
                Text(verbatim: error).font(theme.font(12)).foregroundStyle(theme.danger)
            }
        }
    }

    private func receipt(_ list: BotCapabilityList) -> some View {
        let receipt = BotCapabilityReceipt(list)
        let botName = HumanID.readable(bot.name, or: String(localized: "This bot"))
        let engine = HumanID.readable(list.engine.label, or: String(localized: "Unknown"))
        return VStack(alignment: .leading, spacing: 6) {
            Text("What \(botName) receives (engine: \(engine))").font(theme.font(13, .medium)).foregroundStyle(theme.ink)
            receiptLine("Skills and commands", receipt.skillsAndCommands)
            receiptLine("Agents", receipt.agents)
            receiptLine("Servers and tools", receipt.servers)
            receiptLine("Not served", receipt.notServed)
            if let index = list.promptIndex, index.cuts {
                Text(index.incomplete ? "Plugin discovery is partial. Additional references may exist in enabled plugin folders." : "The skills index is full: \(index.omitted) skills left out of the prompt.")
                    .font(theme.font(12)).foregroundStyle(theme.inkSecondary)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private func receiptLine(_ title: LocalizedStringKey, _ names: [String]) -> some View {
        (Text(title).foregroundColor(theme.inkSecondary)
         + Text(verbatim: ": ").foregroundColor(theme.inkSecondary)
         + (names.isEmpty ? Text("Nothing") : Text(verbatim: names.joined(separator: ", "))).foregroundColor(theme.ink))
            .font(theme.font(12))
            .fixedSize(horizontal: false, vertical: true)
    }

    private func row(_ item: BotCapability) -> some View {
        let name = CapabilityText.name(item)
        return HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: name).font(theme.font(12.5, .medium)).foregroundStyle(theme.ink).lineLimit(1)
                CapabilityText.detail(item).font(theme.font(11.5)).foregroundStyle(theme.inkSecondary).lineLimit(1)
                (Text(CapabilityText.state(item.state))
                 + (CapabilityText.reason(item.reason).map { Text(verbatim: " · ") + Text($0) } ?? Text(verbatim: "")))
                    .font(theme.font(11.5))
                    .foregroundStyle(item.served ? theme.ink : theme.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                if item.updateAvailable {
                    Text("Update available").font(theme.font(11.5)).foregroundStyle(theme.inkSecondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if item.toggle != nil {
                PanelSwitch(label: "Use \(name)", isOn: item.enabled, disabled: model.busy != nil) { on in model.set(item, on: on) }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }
}
