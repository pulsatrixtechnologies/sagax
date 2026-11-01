// The iPhone bot panel's Library tab as the current desktop draws it
// (`bot-settings/LibraryTab.tsx`): the bot's files only, no sub-tabs. Skills
// live on the Personas page; the bot's Claude Code plugins open from a link
// under the files where the pairing forwards them
// (`BotLibraryView.pluginsLink`, CompanionCore). The bot's resolved
// capabilities list (`PhoneBotCapabilities` below) lives inside that Plugins
// sheet (Installed), not as its own Library button: the bot panel stays
// Details, Library and Computer (JC, 2026-11-01).
import CompanionCore
import SwiftUI

struct PhoneBotLibrary: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    let bot: Bot
    let start: BotLibraryChip
    let onShowInChat: (ThreadFile) -> Void
    var onShowLink: ((BotLink) -> Void)? = nil

    @State private var view: BotLibraryView = .files
    @State private var showingPlugins = false

    private var views: [BotLibraryView] { BotLibraryView.visible(gate: session.surfaceGate) }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if views.count > 1 {
                AnyView(switcher)
            }
            switch views.contains(view) ? view : .files {
            case .files: AnyView(ThreadFilesView(bot: bot, start: start, onShowInChat: onShowInChat, onShowLink: onShowLink))
            case .skills: AnyView(PhoneLibrarySkills(bot: bot))
            case .plugins: AnyView(PhoneBotPlugins(bot: bot))
            }
            if BotLibraryView.pluginsLink(gate: session.surfaceGate) || BotCapabilityRules.reachable(gate: session.surfaceGate) {
                Button { showingPlugins = true } label: {
                    Label("Plugins", systemImage: "puzzlepiece.extension")
                        .font(Theme.Profile.labelFont)
                        .foregroundStyle(Theme.textSecondary)
                }
                .buttonStyle(.plain)
                .padding(.horizontal, Theme.Profile.cardMargin)
                .accessibilityIdentifier("library-open-plugins")
            }
        }
        .sheet(isPresented: $showingPlugins) {
            NavigationStack { ScrollView { PhoneBotPlugins(bot: bot).padding(.vertical, 16) }.navigationTitle(Text("Plugins")) }
        }
    }

    private var switcher: some View {
        HStack(spacing: 6) {
            ForEach(views, id: \.self) { item in
                let selected = item == view
                Button {
                    Haptics.selection()
                    view = item
                } label: {
                    Text(Self.title(item))
                        .font(Theme.Profile.labelFont.weight(.medium))
                        .foregroundStyle(selected ? Theme.textPrimary : Theme.textSecondary)
                        .padding(.horizontal, 12)
                        .frame(height: 30)
                        .background(selected ? Theme.cardRaised : Color.clear, in: Capsule())
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
                .accessibilityIdentifier("library-view.\(item.rawValue)")
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Theme.Profile.cardMargin)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Library views"))
    }

    static func title(_ view: BotLibraryView) -> LocalizedStringKey {
        switch view {
        case .files: "Files"
        case .skills: "Skills"
        case .plugins: "Plugins"
        }
    }
}

/// Library > Skills: the phone's skills list (the same as More > Skills,
/// as the desktop mounts one `SkillsSection` in both).
private struct PhoneLibrarySkills: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    @StateObject private var model: BotSkillsModel

    init(bot: Bot) {
        self.bot = bot
        _model = StateObject(wrappedValue: BotSkillsModel(botId: bot.id))
    }

    var body: some View {
        ThemedList { BotSkillsSection(bot: bot, model: model) }
            .frame(height: 560)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Metric.cardRadius, style: .continuous))
            .padding(.horizontal, Theme.Profile.cardMargin - 16)
            .sheet(item: $model.reviewing) { sheet in SkillReviewSheet(sheet: sheet, model: model) }
            .sheet(item: $model.viewing) { sheet in SkillTextSheet(sheet: sheet, model: model) }
            .sheet(isPresented: $model.showingPath) {
                if let client = model.client {
                    ShownPathSheet(botId: bot.id, client: client) { Task { await model.refresh() } }
                }
            }
            .accessibilityIdentifier("library-skills")
    }
}

/// A bot's plugins, as Connect apps shows them "For <bot>" on the web
/// (`PluginsPanel.tsx`, `plugins/BotPluginCard.tsx`): the plugins on this bot, each
/// switched on or off or removed, then the marketplaces it reads with their
/// plugins to install, and a field to add one. A person who may not change
/// them reads the list.
struct PhoneBotPlugins: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    let bot: Bot

    @State private var listing: BotPluginsListing?
    @State private var problem: String?
    @State private var busy: String?
    @State private var source = ""

    private var canChange: Bool { listing?.canChange == true }

    private var showsPlugins: Bool { BotLibraryView.pluginsLink(gate: session.surfaceGate) }

    var body: some View {
        VStack(spacing: 0) {
            // Resolved list for this bot (Plugins > Installed on the web).
            if BotCapabilityRules.reachable(gate: session.surfaceGate) {
                PhoneBotCapabilities(bot: bot).id(bot.id)
                    .padding(.bottom, Theme.Profile.cardGap)
            }
            if showsPlugins {
                if let listing {
                    if !listing.loadsPlugins {
                        ProfileFooter(text: "This bot's engine does not load Claude Code plugins.")
                            .padding(.bottom, 12)
                    }
                    ProfileSectionLabel(text: "Installed")
                    ProfileCard {
                        if listing.plugins.isEmpty {
                            quiet(Text("No plugins on this bot yet."))
                        }
                        ForEach(Array(listing.plugins.enumerated()), id: \.element.id) { index, plugin in
                            if index > 0 { ProfileDivider(leading: Theme.Profile.textInset) }
                            installedRow(plugin)
                        }
                    }
                    ForEach(listing.marketplaces) { market in
                        ProfileSectionLabel(text: LocalizedStringKey(market.name))
                            .padding(.top, Theme.Profile.cardGap + 4)
                        ProfileCard {
                            ForEach(Array(market.plugins.enumerated()), id: \.element.id) { index, plugin in
                                if index > 0 { ProfileDivider(leading: Theme.Profile.textInset) }
                                marketRow(market, plugin)
                            }
                            if market.plugins.isEmpty { quiet(Text("This marketplace lists no plugins.")) }
                            if canChange {
                                ProfileDivider(leading: Theme.Profile.textInset)
                                Button(role: .destructive) {
                                    run("market:\(market.name)") { client in try await client.removeBotPluginMarketplace(botId: bot.id, name: market.name) }
                                } label: {
                                    Text("Remove marketplace")
                                        .font(Theme.Font.body)
                                        .foregroundStyle(Theme.destructiveMenu)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .padding(.leading, Theme.Profile.textInset)
                                        .frame(height: Theme.Profile.row)
                                }
                                .buttonStyle(.plain)
                                .disabled(busy != nil)
                            }
                        }
                    }
                    if canChange {
                        ProfileSectionLabel(text: "Add a marketplace")
                            .padding(.top, Theme.Profile.cardGap + 4)
                        ProfileCard {
                            HStack(spacing: 8) {
                                TextField(String(localized: "owner/repo, https://github.com/…"), text: $source)
                                    .font(Theme.Font.body)
                                    .textInputAutocapitalization(.never)
                                    .autocorrectionDisabled()
                                    .accessibilityIdentifier("plugins-source")
                                Button(String(localized: "Add")) {
                                    let text = source.trimmingCharacters(in: .whitespacesAndNewlines)
                                    run("add") { client in
                                        let next = try await client.addBotPluginMarketplace(botId: bot.id, source: text)
                                        source = ""
                                        return next
                                    }
                                }
                                .disabled(busy != nil || source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                            }
                            .padding(.horizontal, Theme.Profile.textInset)
                            .frame(minHeight: Theme.Profile.row)
                        }
                    }
                } else if let problem {
                    ProfileCard { quiet(Text(verbatim: problem)) }
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(30)
                }
                if let problem, listing != nil {
                    ProfileFooter(text: LocalizedStringKey(problem))
                }
            }
        }
        .task(id: bot.id) {
            guard showsPlugins else { return }
            await load()
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("library-plugins")
    }

    private func quiet(_ text: Text) -> some View {
        text.font(Theme.Profile.labelFont)
            .foregroundStyle(Theme.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Theme.Profile.textInset)
            .padding(.vertical, 14)
    }

    private func installedRow(_ plugin: BotInstalledPlugin) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: plugin.name).font(Theme.Font.body).foregroundStyle(Theme.textPrimary).lineLimit(1)
                Text(verbatim: [plugin.marketplace, plugin.version].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(Theme.Profile.labelFont).foregroundStyle(Theme.textSecondary).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Toggle("", isOn: Binding(get: { plugin.enabled }, set: { on in
                run(plugin.key) { client in try await client.setBotPlugin(botId: bot.id, key: plugin.key, enabled: on) }
            }))
            .labelsHidden()
            .tint(Theme.toggleOn)
            .disabled(!canChange || busy != nil)
            .accessibilityLabel(Text(verbatim: plugin.name))
        }
        .padding(.horizontal, Theme.Profile.textInset)
        .frame(minHeight: Theme.Profile.routineRow)
        .contextMenu {
            if canChange {
                Button(String(localized: "Uninstall"), systemImage: "trash", role: .destructive) {
                    run(plugin.key) { client in try await client.setBotPlugin(botId: bot.id, key: plugin.key, enabled: nil) }
                }
            }
        }
        .accessibilityIdentifier("plugin.\(plugin.key)")
    }

    private func marketRow(_ market: BotPluginMarketplace, _ plugin: BotPluginMarketplace.Plugin) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: plugin.name).font(Theme.Font.body).foregroundStyle(Theme.textPrimary).lineLimit(1)
                if let description = plugin.description, !description.isEmpty {
                    Text(verbatim: description).font(Theme.Profile.labelFont).foregroundStyle(Theme.textSecondary).lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if plugin.installed {
                Text("Installed").font(Theme.Profile.labelFont).foregroundStyle(Theme.textTertiary)
            } else if canChange {
                if busy == "install:\(market.name)/\(plugin.name)" {
                    ProgressView().controlSize(.small)
                } else {
                    Button(String(localized: "Install")) {
                        run("install:\(market.name)/\(plugin.name)") { client in
                            try await client.installBotPlugin(botId: bot.id, marketplace: market.name, plugin: plugin.name)
                        }
                    }
                    .disabled(busy != nil)
                }
            }
        }
        .padding(.horizontal, Theme.Profile.textInset)
        .frame(minHeight: Theme.Profile.routineRow)
    }

    private func load() async {
        guard let client = session.profileClient else { return }
        do {
            listing = try await client.botPlugins(botId: bot.id)
            problem = nil
        } catch {
            problem = error.localizedDescription
        }
    }

    private func run(_ key: String, _ action: @escaping (CompanionClient) async throws -> BotPluginsListing) {
        guard busy == nil, let client = session.profileClient else { return }
        busy = key
        Task {
            defer { busy = nil }
            do {
                listing = try await action(client)
                problem = nil
            } catch {
                problem = error.localizedDescription
            }
        }
    }
}

/// Bot > Capabilities on the iPhone: the bot's resolved list
/// (`BotCapabilitiesModel`, shared with the iPad panel), the box « What
/// <bot> receives (engine: X) », then one row per capability (name, form,
/// scope, state) with its switch where `canToggle`.
struct PhoneBotCapabilities: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    let bot: Bot

    @StateObject private var model: BotCapabilitiesModel

    init(bot: Bot) {
        self.bot = bot
        _model = StateObject(wrappedValue: BotCapabilitiesModel(bot: bot))
    }

    var body: some View {
        VStack(spacing: 0) {
            if let list = model.list {
                let receipt = BotCapabilityReceipt(list)
                let botName = HumanID.readable(bot.name, or: String(localized: "This bot"))
                let engine = HumanID.readable(list.engine.label, or: String(localized: "Unknown"))
                ProfileSectionLabel(text: "What \(botName) receives (engine: \(engine))")
                ProfileCard {
                    receiptLine("Skills and commands", receipt.skillsAndCommands)
                    ProfileDivider(leading: Theme.Profile.textInset)
                    receiptLine("Agents", receipt.agents)
                    ProfileDivider(leading: Theme.Profile.textInset)
                    receiptLine("Servers and tools", receipt.servers)
                    ProfileDivider(leading: Theme.Profile.textInset)
                    receiptLine("Not served", receipt.notServed)
                }
                if let index = list.promptIndex, index.cuts {
                    ProfileFooter(text: index.incomplete ? "Plugin discovery is partial. Additional references may exist in enabled plugin folders." : "Prompt budgets omit \(index.omitted) whole instruction files.")
                }
                ProfileSectionLabel(text: "Capabilities")
                    .padding(.top, Theme.Profile.cardGap + 4)
                ProfileCard {
                    if list.items.isEmpty {
                        quiet(Text("No capabilities on this bot yet."))
                    }
                    ForEach(Array(list.items.enumerated()), id: \.element.id) { index, item in
                        if index > 0 { ProfileDivider(leading: Theme.Profile.textInset) }
                        row(item)
                    }
                }
            } else if let problem = model.error {
                ProfileCard { quiet(Text(verbatim: problem)) }
            } else {
                ProgressView().frame(maxWidth: .infinity).padding(30)
            }
            if let problem = model.error, model.list != nil {
                ProfileCard { quiet(Text(verbatim: problem)) }
                    .padding(.top, 12)
            }
        }
        .task(id: bot.id) {
            model.client = session.profileClient
            await model.refresh()
        }
        .sheet(item: $model.review) { review in
            CapabilitySkillReviewSheet(review: review, onCancel: { model.review = nil }, onConfirm: { model.confirm(review) })
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("library-capabilities")
    }

    private func quiet(_ text: Text) -> some View {
        text.font(Theme.Profile.labelFont)
            .foregroundStyle(Theme.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Theme.Profile.textInset)
            .padding(.vertical, 14)
    }

    private func receiptLine(_ title: LocalizedStringKey, _ names: [String]) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(Theme.Profile.labelFont).foregroundStyle(Theme.textSecondary)
            (names.isEmpty ? Text("Nothing") : Text(verbatim: names.joined(separator: ", ")))
                .font(Theme.Font.body)
                .foregroundStyle(names.isEmpty ? Theme.textTertiary : Theme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Theme.Profile.textInset)
        .padding(.vertical, 10)
        .accessibilityElement(children: .combine)
    }

    private func row(_ item: BotCapability) -> some View {
        let name = CapabilityText.name(item)
        return HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: name).font(Theme.Font.body).foregroundStyle(Theme.textPrimary).lineLimit(1)
                CapabilityText.detail(item).font(Theme.Profile.labelFont).foregroundStyle(Theme.textSecondary).lineLimit(1)
                if let index = item.promptIndex {
                    Text("Prompt: \(index.skills)/\(index.maxSkills) files, \(index.bytes)/\(index.maxBytes) bytes; \(index.omitted) omitted")
                        .font(Theme.Profile.labelFont).foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let pack = item.sourcePack, let label = item.signedPackLabel {
                    HStack(spacing: 6) {
                        Text(verbatim: label).font(Theme.Profile.labelFont).foregroundStyle(Theme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                        Button { PlatformBridge.copyToPasteboard(pack) } label: {
                            Image(systemName: "doc.on.doc").font(Theme.Profile.labelFont)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(Theme.textSecondary)
                        .accessibilityLabel("Copy the pack digest")
                    }
                }
                (Text(CapabilityText.state(item.state))
                 + (CapabilityText.reason(item.reason).map { Text(verbatim: " · ") + Text($0) } ?? Text(verbatim: "")))
                    .font(Theme.Profile.labelFont)
                    .foregroundStyle(item.served ? Theme.textPrimary : Theme.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
                if item.updateAvailable {
                    Text("Update available").font(Theme.Profile.labelFont).foregroundStyle(Theme.textTertiary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if item.toggle != nil {
                Toggle("", isOn: Binding(get: { item.enabled }, set: { on in model.set(item, on: on) }))
                    .labelsHidden()
                    .tint(Theme.toggleOn)
                    .disabled(model.busy != nil)
                    .accessibilityLabel(Text("Use \(name)"))
            }
        }
        .padding(.horizontal, Theme.Profile.textInset)
        .padding(.vertical, 8)
        .frame(minHeight: Theme.Profile.routineRow)
        .accessibilityIdentifier("capability.\(item.form.rawValue)")
    }
}
