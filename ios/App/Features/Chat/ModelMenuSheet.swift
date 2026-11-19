// The model menu (desktop ModelPanel.tsx, #4966): short by default. Auto at
// the top (with "Optimize for" under it while Auto is on), the bot's model,
// the person's favorites, the model in use when it is none of them, then
// "All models": a segment per provider, every model with a star. Only the
// models that can run a turn are listed; the one in use stays, saying it
// does not respond. A search lists every provider's matches flat.
//
// The favorites are the person's own list on the server (`favoriteModels` of
// `GET`/`PUT /api/me/models`), the one the desktop reads and writes; the
// Simple or Advanced choice is a synced preference (`sagax.interfaceMode.v1`).
// A pick runs this thread and becomes the bot's model (#261).
import SwiftUI
import CompanionCore

@MainActor
final class ModelFavoritesStore: ObservableObject {
    static let shared = ModelFavoritesStore()
    /// This device's copy of the server's list, shown before the server answers.
    private static let cacheKey = "sagax.modelFavoriteKeys.cache"
    @Published private(set) var keys: [String] = ModelFavoritesStore.cached()
    /// The server answered for this person: every star is sent to it.
    private var synced = false
    private var saving: Task<Void, Never>?

    private static func cached() -> [String] {
        ModelFavorites.clean(UserDefaults.standard.stringArray(forKey: cacheKey) ?? [])
    }

    /// Reads the person's list on the server (`favoriteModels` of
    /// `GET /api/me/models`, the desktop's own); a list this device kept from
    /// before is sent when the server has none. Answers the stored Simple or
    /// Advanced choice, if any.
    func load(_ session: Session) async -> String? {
        if let client = session.settingsClient, let list = try? await client.modelFavorites() {
            synced = true
            let legacy = ModelFavorites.parseLegacy(UserDefaults.standard.string(forKey: ModelFavorites.legacyPreferenceKey))
            let local = ModelFavorites.clean(Self.cached() + legacy)
            if list.isEmpty, !local.isEmpty {
                keys = local
                send(session)
            } else {
                keys = list
            }
            UserDefaults.standard.set(keys, forKey: Self.cacheKey)
            UserDefaults.standard.removeObject(forKey: ModelFavorites.legacyPreferenceKey)
        } else {
            synced = false
        }
        let record = try? await session.settingsClient?.sidebarPreferenceRecord()
        return record?.preferences[ModelMenu.interfaceModeKey] ?? UserDefaults.standard.string(forKey: ModelMenu.interfaceModeKey)
    }

    func toggle(_ key: String, session: Session) {
        keys = ModelFavorites.toggled(keys, key)
        UserDefaults.standard.set(keys, forKey: Self.cacheKey)
        send(session)
    }

    /// Sends the whole list, one request after the other so the last star wins.
    private func send(_ session: Session) {
        guard synced, let client = session.settingsClient else { return }
        let previous = saving
        saving = Task { [weak self] in
            await previous?.value
            guard let self else { return }
            _ = try? await client.saveModelFavorites(self.keys)
        }
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

    private enum Page: Hashable { case root, all }

    @State private var instances: [Instance] = []
    @State private var config: ConfigStatus?
    @State private var loaded = false
    @State private var page: Page = .root
    @State private var query = ""
    @State private var saving = false
    /// The provider segment "All models" shows.
    @State private var segment: String?

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
                    case .all: allModels
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
            _ = await favorites.load(session)
            loaded = true
        }
        .accessibilityIdentifier("model-menu")
    }

    // MARK: Pages

    @ViewBuilder
    private var root: some View {
        let menu = ModelMenu.root(sections, favorites: favorites.keys)
        Section {
            ForEach(menu.top) { top in
                row(row: top, id: "model-row.\(top.key)")
                if top.kind == .auto, top.current { optimizeRow }
            }
            if let current = menu.current { row(row: current, id: "model-row.current") }
        }
        if !menu.favorites.isEmpty {
            Section(header: Text("Favorites")) {
                ForEach(menu.favorites) { row(row: $0, id: "model-row.favorite.\($0.instanceId ?? "").\($0.modelId ?? "")") }
            }
        }
        if !menu.providers.isEmpty {
            Section {
                pageButton(String(localized: "All models"), id: "model-all", current: false) { page = .all }
            }
        }
    }

    /// "Optimize for" under Auto: Intelligence, Balance or Cost (#2106).
    private var optimizeRow: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Optimize for").font(.footnote).foregroundStyle(Theme.textSecondary)
            Picker("Optimize for", selection: Binding(
                get: { selection.autoOptimize ?? .balance },
                set: { setAutoOptimize($0) }
            )) {
                ForEach(ModelAutoOptimize.allCases, id: \.self) { Text(LocalizedStringKey($0.labelKey)).tag($0) }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("model-auto-optimize")
        }
    }

    /// "All models": a segment per provider, then that provider's models, each with a star.
    @ViewBuilder
    private var allModels: some View {
        let all = ModelMenu.root(sections, favorites: favorites.keys).providers
        let shown = all.first { $0.id == segment } ?? all.first { $0.current } ?? all.first
        Section { backButton(to: .root) }
        if let shown {
            Section {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(all) { provider in
                            let on = provider.id == shown.id
                            Button { segment = provider.id } label: {
                                Text(verbatim: provider.section.label ?? provider.id)
                                    .font(.subheadline.weight(on ? .semibold : .regular))
                                    .foregroundStyle(on ? Theme.textPrimary : Theme.textSecondary)
                                    .padding(.horizontal, 12)
                                    .frame(height: 32)
                                    .background(on ? Theme.inset : .clear, in: Capsule())
                                    .contentShape(Capsule())
                            }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(on ? .isSelected : [])
                            .accessibilityIdentifier("model-provider.\(provider.id)")
                        }
                    }
                }
                .listRowInsets(EdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12))
            }
            Section(header: Text(verbatim: shown.section.label ?? "")) {
                ForEach(shown.section.rows) { row(row: $0, id: "model-row.\($0.instanceId ?? "").\($0.modelId ?? "")", star: true) }
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
            // Absent means Balance; store it so Optimize for shows the live choice.
            next.autoOptimize = selection.autoOptimize ?? .balance
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

    private func setAutoOptimize(_ value: ModelAutoOptimize) {
        var next = selection
        next.auto = true
        next.autoOptimize = value
        apply(next, updateBotDefault: true, keepOpen: true)
    }

    private func apply(_ next: ModelSelection, updateBotDefault: Bool, keepOpen: Bool = false) {
        if let choose {
            choose(next)
            return keepOpen ? () : finish()
        }
        saving = true
        Task {
            _ = await session.updateModel(next, for: current, updateBotDefault: updateBotDefault)
            saving = false
            if !keepOpen { finish() }
        }
    }
}
