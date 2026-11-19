// The model menu (desktop ModelMenu.tsx, #477, #478, #518): Auto, the
// bot's model, the model in use, the person's favorites, then one row per
// provider that opens its models; in Simple mode one "All models ›" row
// opens the providers. Only the models that can run a turn are listed; the
// one in use stays, saying it does not respond. A search lists every
// provider's matches flat. Every model row carries a star.
//
// The favorites and the Simple or Advanced choice are the person's synced
// preferences on an organization server (`sagax.modelFavorites.v1`,
// `sagax.interfaceMode.v1`); elsewhere the favorites stay on this device.
// A pick runs this thread and becomes the bot's model (#261).
import SwiftUI
import CompanionCore

@MainActor
final class ModelFavoritesStore: ObservableObject {
    static let shared = ModelFavoritesStore()
    @Published private(set) var keys: [String] = ModelFavorites.parse(UserDefaults.standard.string(forKey: ModelFavorites.preferenceKey))
    /// The providers pinned to the menu (at most 3), as stored; the menu reads the effective ones.
    @Published private(set) var pins: [String] = ModelProviderPins.parse(UserDefaults.standard.string(forKey: ModelProviderPins.preferenceKey))
    /// The person's record on an organization server; nil keeps them on this device.
    private var synced = false

    /// Reads the server's record when there is one; answers the stored
    /// Simple or Advanced choice, if any.
    func load(_ session: Session) async -> String? {
        guard let record = try? await session.settingsClient?.sidebarPreferenceRecord() else {
            synced = false
            return UserDefaults.standard.string(forKey: ModelMenu.interfaceModeKey)
        }
        synced = true
        if let raw = record.preferences[ModelFavorites.preferenceKey] {
            keys = ModelFavorites.parse(raw)
            UserDefaults.standard.set(raw, forKey: ModelFavorites.preferenceKey)
        }
        if let raw = record.preferences[ModelProviderPins.preferenceKey] {
            pins = ModelProviderPins.parse(raw)
            UserDefaults.standard.set(raw, forKey: ModelProviderPins.preferenceKey)
        }
        return record.preferences[ModelMenu.interfaceModeKey] ?? UserDefaults.standard.string(forKey: ModelMenu.interfaceModeKey)
    }

    fileprivate func setPins(_ next: [String], session: Session) {
        pins = next
        let raw = ModelProviderPins.serialize(next)
        UserDefaults.standard.set(raw, forKey: ModelProviderPins.preferenceKey)
        guard synced, let client = session.settingsClient else { return }
        Task { _ = try? await client.saveSidebarPreferences([ModelProviderPins.preferenceKey: raw]) }
    }

    func toggle(_ key: String, session: Session) {
        keys = ModelFavorites.toggled(keys, key)
        let raw = ModelFavorites.serialize(keys)
        UserDefaults.standard.set(raw, forKey: ModelFavorites.preferenceKey)
        guard synced, let client = session.settingsClient else { return }
        Task { _ = try? await client.saveSidebarPreferences([ModelFavorites.preferenceKey: raw]) }
    }
}

extension ModelFavoritesStore {
    /// Pins or unpins a provider, from the pins in effect (what the person sees);
    /// false when it would be a fourth.
    func togglePin(_ key: String, effective: [String], session: Session) -> Bool {
        guard case let .pins(next) = ModelProviderPins.toggled(effective, key) else { return false }
        setPins(next, session: session)
        return true
    }
}

struct ModelMenuSheet: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @ObservedObject private var favorites = ModelFavoritesStore.shared
    /// The bot as the open thread sees it (`projected(forThread:)`).
    let bot: Bot
    /// Closes the menu; nil when it is a pushed page (it pops itself).
    var close: (() -> Void)? = nil
    /// Edit N bots: the pick is handed back instead of saved (the menu
    /// stays the bot editor's own, so one bot keeps saving at once).
    var choose: ((ModelSelection) -> Void)? = nil
    @Environment(\.dismiss) private var dismiss

    private enum Page: Hashable { case root, all, provider(String) }

    @State private var instances: [Instance] = []
    @State private var config: ConfigStatus?
    @State private var simple = false
    @State private var loaded = false
    @State private var page: Page = .root
    @State private var query = ""
    @State private var saving = false
    @State private var pinNote = false

    private var organization: Bool { session.surfaceGate.allows(.people) }
    private var profile: Bot { session.state.bot(bot.id) ?? bot }
    private var current: Bot { session.state.bot(bot.id)?.projected(forThread: bot.threadId) ?? bot }
    private var selection: ModelSelection { current.currentTaskModelSelection }
    /// The open thread follows the bot's model (nil: an older server).
    private var follows: Bool? { profile.tasks?.first { $0.threadId == bot.threadId }?.followsBotModel }

    private var sections: [ModelMenuSection] {
        let labels = ModelMenuLabels(
            auto: String(localized: "Auto"),
            autoHint: String(localized: "best model per task"),
            useBotModel: { String(localized: "Use \($0)'s model") },
            local: String(localized: "Local"),
            defaultTag: String(localized: "Default"),
            loadedTag: String(localized: "Loaded")
        )
        return ModelMenu.sections(
            instances: instances, selection: selection, botModel: profile.modelSelection, botName: profile.name,
            follows: follows, organization: organization, allowedEngines: config?.allowedEngines, disabledModels: config?.disabledModels,
            myDisabledModels: config?.myDisabledModels, labels: labels,
            engineLabel: { DesktopEngineRail.label($0) }
        )
    }

    private func finish() {
        if let close { close() } else { dismiss() }
    }

    var body: some View {
        if close != nil {
            NavigationStack { menu }
        } else {
            menu
        }
    }

    private var menu: some View {
            List {
                if !loaded {
                    HStack { Text("Loading models"); Spacer(); ProgressView() }
                } else if !query.isEmpty {
                    searchResults
                } else {
                    switch page {
                    case .root: root
                    case .all: providers(back: .root)
                    case let .provider(id): provider(id)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: Text("Search models"))
            .navigationTitle(Text("Model"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if close != nil {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(action: finish) { Text("Done") }.accessibilityIdentifier("model-menu-done")
                    }
                }
            }
            .disabled(saving || (choose == nil && current.busy == true))
            .overlay { if saving { ProgressView() } }
        .task {
            instances = await session.modelInstances()
            config = await session.configStatus()
            let stored = await favorites.load(session)
            simple = ModelMenu.isSimple(stored: stored)
            loaded = true
        }
        .accessibilityIdentifier("model-menu")
    }

    // MARK: Pages

    @ViewBuilder
    private var root: some View {
        let menu = ModelMenu.root(sections, favorites: favorites.keys)
        Section {
            ForEach(menu.top) { row(row: $0, id: "model-row.\($0.key)") }
            if let current = menu.current { row(row: current, id: "model-row.current") }
        }
        if !menu.favorites.isEmpty {
            Section(header: Text("Favorites")) {
                ForEach(menu.favorites) { row(row: $0, id: "model-row.favorite.\($0.instanceId ?? "").\($0.modelId ?? "")") }
            }
        }
        if !menu.providers.isEmpty {
            Section {
                if simple {
                    pageButton(String(localized: "All models"), id: "model-all", current: false) { page = .all }
                } else {
                    // at most three pinned providers (and the one in use); "All models" opens the rest
                    let shown = pinnedProviders(menu.providers)
                    providerRows(shown)
                    if shown.count < menu.providers.count {
                        pageButton(String(localized: "All models"), id: "model-all", current: false) { page = .all }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func providers(back: Page) -> some View {
        Section { backButton(to: back) }
        let all = ModelMenu.root(sections, favorites: favorites.keys).providers
        let pins = effectivePins(all)
        Section(header: Text("All models"), footer: pinNote ? Text("Three providers are pinned. Unpin one first.") : nil) {
            ForEach(all) { provider in
                HStack(spacing: 8) {
                    pageButton(provider.section.label ?? provider.id, id: "model-provider.\(provider.id)", current: provider.current) {
                        page = .provider(provider.id)
                    }
                    .buttonStyle(.plain)
                    let pinned = pins.contains(provider.id)
                    Button {
                        pinNote = !favorites.togglePin(provider.id, effective: pins, session: session)
                    } label: {
                        Image(systemName: pinned ? "pin.fill" : "pin")
                            .foregroundStyle(pinned ? Theme.accent : Theme.textTertiary)
                            .frame(width: 32, height: 32)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(pinned ? Text("Unpin \(provider.section.label ?? provider.id)") : Text("Pin \(provider.section.label ?? provider.id) to the model menu"))
                    .accessibilityIdentifier("model-pin.\(provider.id)")
                }
            }
        }
    }

    /// The pins in effect: the person's own, else the bot's provider and the most starred.
    private func effectivePins(_ providers: [ModelMenuProvider]) -> [String] {
        ModelProviderPins.effective(stored: favorites.pins, candidates: providers.map { provider in
            .init(key: provider.id, starred: provider.section.rows.filter { favorites.keys.contains($0.key) }.count, current: provider.current)
        })
    }

    /// The providers the root lists: the pinned ones in the order pinned, then the one in use.
    private func pinnedProviders(_ providers: [ModelMenuProvider]) -> [ModelMenuProvider] {
        guard providers.count > ModelProviderPins.max else { return providers }
        let pins = effectivePins(providers)
        let pinned = pins.compactMap { key in providers.first { $0.id == key } }
        return pinned + providers.filter { $0.current && !pins.contains($0.id) }
    }

    private func providerRows(_ providers: [ModelMenuProvider]) -> some View {
        ForEach(providers) { provider in
            pageButton(provider.section.label ?? provider.id, id: "model-provider.\(provider.id)", current: provider.current) {
                page = .provider(provider.id)
            }
        }
    }

    @ViewBuilder
    private func provider(_ id: String) -> some View {
        Section { backButton(to: simple ? .all : .root) }
        if let section = sections.first(where: { $0.key == id }) {
            Section(header: Text(verbatim: section.label ?? "")) {
                ForEach(section.rows) { row(row: $0, id: "model-row.\($0.instanceId ?? "").\($0.modelId ?? "")", star: true) }
            }
        }
    }

    @ViewBuilder
    private var searchResults: some View {
        let found = ModelMenu.filter(sections.filter { $0.label != nil }, query: query)
        if found.isEmpty {
            Text("No models match").foregroundStyle(Theme.textSecondary)
        }
        ForEach(found) { section in
            Section(header: Text(verbatim: section.label ?? "")) {
                ForEach(section.rows) { row(row: $0, id: "model-row.\($0.instanceId ?? "").\($0.modelId ?? "")", star: true) }
            }
        }
    }

    // MARK: Rows

    private func backButton(to target: Page) -> some View {
        Button { page = target } label: {
            Label { Text("Back") } icon: { Image(systemName: "chevron.left") }
                .foregroundStyle(Theme.textSecondary)
        }
        .accessibilityIdentifier("model-menu-back")
    }

    private func pageButton(_ title: String, id: String, current: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Text(verbatim: title).foregroundStyle(Theme.textPrimary)
                Spacer()
                if current { Image(systemName: "checkmark").font(.footnote.weight(.semibold)).foregroundStyle(Theme.accent) }
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Theme.textTertiary)
            }
            .contentShape(Rectangle())
        }
        .accessibilityIdentifier(id)
    }

    private func row(row: ModelMenuRow, id: String, star: Bool = false) -> some View {
        HStack(spacing: 8) {
            Button { pick(row) } label: {
                HStack(spacing: 6) {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(verbatim: row.label).foregroundStyle(Theme.textPrimary).fixedSize(horizontal: false, vertical: true)
                            ForEach(row.tags, id: \.self) { tag in
                                Text(verbatim: tag)
                                    .font(.caption2)
                                    .foregroundStyle(Theme.textSecondary)
                                    .padding(.horizontal, 5)
                                    .padding(.vertical, 1)
                                    .background(Theme.inset, in: RoundedRectangle(cornerRadius: 4))
                            }
                        }
                        if let detail = row.detail {
                            Text(verbatim: detail).font(.footnote).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
                        }
                        if row.notResponding {
                            Label { Text("Not responding") } icon: { Image(systemName: "exclamationmark.triangle") }
                                .font(.footnote)
                                .foregroundStyle(Theme.warning)
                        }
                    }
                    Spacer(minLength: 4)
                    if row.current {
                        Image(systemName: "checkmark").font(.footnote.weight(.semibold)).foregroundStyle(Theme.accent)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier(id)
            if star, row.kind == .model {
                let starred = favorites.keys.contains(row.key)
                Button { favorites.toggle(row.key, session: session) } label: {
                    Image(systemName: starred ? "star.fill" : "star")
                        .foregroundStyle(starred ? Theme.warning : Theme.textTertiary)
                        .frame(width: 32, height: 32)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(starred ? Text("Remove \(row.label) from favorites") : Text("Add \(row.label) to favorites"))
                .accessibilityIdentifier("model-favorite.\(row.instanceId ?? "").\(row.modelId ?? "")")
            }
        }
    }

    // MARK: Pick

    private func pick(_ row: ModelMenuRow) {
        switch row.kind {
        case .auto:
            guard selection.auto != true || choose != nil else { return finish() }
            var next = selection
            next.auto = true
            apply(next, updateBotDefault: true)
        case .follow:
            guard follows == false, choose == nil else { return finish() }
            apply(profile.modelSelection, updateBotDefault: true)
        case .model:
            guard let instance = instances.first(where: { $0.instanceId == row.instanceId }), let model = row.modelId else { return }
            if row.current && selection.auto != true && choose == nil { return finish() }
            apply(ModelPickerRules.selectionForPick(selection, instance: instance, model: model), updateBotDefault: true)
        }
    }

    private func apply(_ next: ModelSelection, updateBotDefault: Bool) {
        if let choose {
            choose(next)
            return finish()
        }
        saving = true
        Task {
            _ = await session.updateModel(next, for: current, updateBotDefault: updateBotDefault)
            saving = false
            finish()
        }
    }
}
