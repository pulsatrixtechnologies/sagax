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
//
// The chat opens on the mode menu shared with iPad. The bot editor uses its short list.
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
            if list.isEmpty, !legacy.isEmpty {
                keys = legacy
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

    @State private var preview: ComposerModes.Preview?

    private var levelRow: ComposerModes.Reasoning {
        ComposerModes.reasoning(selection: selection, instances: instances, preview: preview)
    }
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
    /// The engine in use and the model's effort levels (`modelEffortLevels`).
    private var active: Instance? { instances.first { $0.instanceId == selection.instanceId } }
    private var efforts: [String] {
        guard let active, selection.auto != true, active.capabilities?.modelVariants != true else { return [] }
        let option = active.models.options.first { $0.id == selection.model }
        return ModelEffort.pickerLevels(option, engine: active.capabilities?.effortLevels ?? [])
    }

    private var menuLabels: ModelMenuLabels {
        ModelMenuLabels(
            auto: String(localized: "Auto"),
            autoHint: String(localized: "best model per task"),
            useBotModel: { String(localized: "Use \($0)'s model") },
            local: String(localized: "Local"),
            defaultTag: String(localized: "Default"),
            loadedTag: String(localized: "Loaded"),
            specialAccess: String(localized: "Special access"),
            specialAccessHint: { String(localized: "Only \($0) offers this model") },
            accountNumbered: { String(localized: "Account \($0)") }
        )
    }

    private var sections: [ModelMenuSection] {
        let labels = menuLabels
        return ModelMenu.sections(
            instances: instances, selection: selection, botModel: profile.modelSelection, botName: profile.name,
            follows: follows, organization: organization, allowedEngines: choose == nil ? nil : config?.allowedEngines, disabledModels: config?.disabledModels,
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
                    case .all: engineModels
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
            config = await session.configStatus()
            if choose == nil {
                instances = await session.composerModelInstances(config: config)
                preview = try? await session.settingsClient?.composerModePreview(botId: bot.id, threadId: bot.threadId)
            } else {
                instances = await session.modelInstances()
            }
            _ = await favorites.load(session)
            loaded = true
        }
        .accessibilityIdentifier("model-menu")
    }

    // MARK: Pages

    @ViewBuilder
    private var root: some View {
        if choose == nil { modes } else { shortList }
    }

    /// The modes available to this person, then Reasoning and All models.
    @ViewBuilder
    private var modes: some View {
        let mode = ComposerModes.mode(of: selection)
        Section(header: Text("Mode")) {
            ForEach(ComposerModes.offered(preview), id: \.self) { candidate in
                modeRow(candidate, on: mode == candidate)
            }
        }
        if levelRow.shown {
            Section {
                ComposerCascadeReasoning(reasoning: levelRow, automatic: mode == .auto, pickEffort: setEffort) {
                    HStack {
                        Text("Reasoning")
                            .foregroundStyle(levelRow.disabled ? Theme.textTertiary : Theme.textPrimary)
                        Spacer()
                        Text(verbatim: levelRow.label(levelRow.value, automatic: mode == .auto))
                            .foregroundStyle(levelRow.disabled ? Theme.textTertiary : Theme.textSecondary)
                        if !levelRow.disabled {
                            Image(systemName: "chevron.up.chevron.down")
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(Theme.textTertiary)
                        }
                    }
                    .contentShape(Rectangle())
                }
            }
        }
        if !manual.providers.isEmpty || !manual.top.isEmpty || !manual.favorites.isEmpty {
            Section {
                let pinned = mode == nil ? sections.flatMap(\.rows).first { $0.kind == .model && $0.current }?.label ?? selection.model : nil
                ComposerCascadeAllModels(
                    list: manual,
                    favoriteKeys: favorites.keys,
                    onPick: pick,
                    onStar: { favorites.toggle($0.key, session: session) }
                ) {
                    HStack(spacing: 0) {
                        Text("All models").foregroundStyle(Theme.textPrimary)
                        Spacer(minLength: 4)
                        if let pinned {
                            Text(verbatim: pinned).font(.footnote).foregroundStyle(Theme.textSecondary)
                        }
                        menuIcon {
                            Image(systemName: "chevron.up.chevron.down")
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(Theme.textTertiary)
                        }
                    }
                    .contentShape(Rectangle())
                }
            }
        }
    }

    private func modeRow(_ mode: ComposerMode, on: Bool) -> some View {
        let words: (name: LocalizedStringKey, blurb: LocalizedStringKey, icon: String) = switch mode {
        case .auto: ("Auto", "Picks from the request", "sparkles")
        case .fast: ("Fast", "Quick responses", "bolt")
        case .expert: ("Expert", "Thinks hard", "brain")
        case .heavy: ("Heavy", "Team of Experts", "square.3.layers.3d")
        }
        return Button { pickMode(mode) } label: {
            HStack(spacing: 10) {
                Image(systemName: words.icon).frame(width: 20).foregroundStyle(on ? Theme.textPrimary : Theme.textSecondary)
                VStack(alignment: .leading, spacing: 2) {
                    Text(words.name).foregroundStyle(Theme.textPrimary)
                    Text(words.blurb).font(.footnote).foregroundStyle(Theme.textSecondary)
                }
                Spacer(minLength: 4)
                menuIcon {
                    if on { Image(systemName: "checkmark").font(.footnote.weight(.semibold)).foregroundStyle(Theme.accent) }
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
        .accessibilityIdentifier("model-mode.\(mode.rawValue)")
    }

    /// The bot editor's menu: Auto, the bot's model, the favorites, All models.
    @ViewBuilder
    private var shortList: some View {
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
        if !efforts.isEmpty {
            Section { reasoning }
        }
    }

    /// "Optimize for" on one line under Auto (#5051): the label, then the small control.
    private var optimizeRow: some View {
        ModelMenuOptimizeLine(
            selected: selection.autoOptimize ?? .balance,
            idPrefix: "model-auto-optimize",
            ink: Theme.textPrimary,
            secondary: Theme.textSecondary,
            track: Theme.textPrimary.opacity(0.06),
            chosen: Theme.textPrimary.opacity(0.10),
            onPick: setAutoOptimize
        )
    }

    /// Every reasoning level whole, on balanced lines past four (#5051).
    private var reasoning: some View {
        ModelMenuReasoning(
            levels: efforts,
            selected: selection.effort,
            idPrefix: "model-menu-effort",
            ink: Theme.textPrimary,
            secondary: Theme.textSecondary,
            track: Theme.textPrimary.opacity(0.06),
            chosen: Theme.textPrimary.opacity(0.10),
            onPick: setEffort
        )
    }

    /// The bot editor's "All models": a segment per engine, then its models.
    @ViewBuilder
    private var engineModels: some View {
        let all = ModelMenu.root(sections, favorites: favorites.keys).providers
        let shown = all.first { $0.id == segment } ?? all.first { $0.current } ?? all.first
        Section { backButton(to: .root) }
        if let shown {
            Section { segments(all.map { ($0.id, $0.section.label ?? $0.id) }, shown: shown.id) }
            Section(header: Text(verbatim: shown.section.label ?? "")) {
                ForEach(shown.section.rows) { row(row: $0, id: "model-row.\($0.instanceId ?? "").\($0.modelId ?? "")", star: true) }
            }
        }
    }

    private var manual: ComposerModes.ManualList {
        ComposerModes.usable(ComposerModes.manual(
            sections, favorites: favorites.keys, instances: instances, allowedEngines: choose == nil ? nil : config?.allowedEngines, organization: organization,
            selectedId: selection.instanceId, labels: menuLabels, engineLabel: { DesktopEngineRail.label($0) }
        ), thisComputer: String(localized: "This computer"), excluded: preview?.excluded)
    }

    /// The provider (or engine) segments, the shown one filled.
    private func segments(_ items: [(id: String, label: String)], shown: String) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(items, id: \.id) { item in
                    let on = item.id == shown
                    Button { segment = item.id } label: {
                        Text(verbatim: item.label)
                            .font(.subheadline.weight(on ? .semibold : .regular))
                            .foregroundStyle(on ? Theme.textPrimary : Theme.textSecondary)
                            .padding(.horizontal, 12)
                            .frame(height: 32)
                            .background(on ? Theme.inset : .clear, in: Capsule())
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(on ? .isSelected : [])
                    .accessibilityIdentifier("model-provider.\(item.id)")
                }
            }
        }
        .listRowInsets(EdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12))
    }

    @ViewBuilder
    private var searchResults: some View {
        if choose == nil {
            manualResults
        } else {
            engineResults
        }
    }

    /// #5091: a search in the chat finds Manual's rows, under their provider and account.
    @ViewBuilder
    private var manualResults: some View {
        let found = ComposerModes.filter(manual, query: query)
        if found.top.isEmpty && found.favorites.isEmpty && found.providers.isEmpty {
            Text("No models match").foregroundStyle(Theme.textSecondary)
        }
        if !found.favorites.isEmpty {
            Section(header: Text("Favorites")) {
                ForEach(found.favorites) { row(row: $0, id: "model-row.favorite.\($0.instanceId ?? "").\($0.modelId ?? "")", star: true) }
            }
        }
        ForEach(found.providers) { provider in
            ForEach(provider.accounts) { account in
                Section(header: Text(verbatim: [provider.label, account.label].compactMap { $0 }.joined(separator: " · "))) {
                    ForEach(account.rows) { row(row: $0, id: "model-row.\($0.instanceId ?? "").\($0.modelId ?? "")", star: true) }
                }
            }
        }
    }

    @ViewBuilder
    private var engineResults: some View {
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

    private func pageButton(_ title: String, id: String, current: Bool, detail: String? = nil, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 0) {
                Text(verbatim: title).foregroundStyle(Theme.textPrimary)
                Spacer(minLength: 4)
                if let detail { Text(verbatim: detail).font(.footnote).foregroundStyle(Theme.textSecondary) }
                menuIcon {
                    if current {
                        Image(systemName: "checkmark").font(.footnote.weight(.semibold)).foregroundStyle(Theme.accent)
                    } else {
                        Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Theme.textTertiary)
                    }
                }
            }
            .contentShape(Rectangle())
        }
        .accessibilityIdentifier(id)
    }

    /// The check, the star and the chevron share one icon slot. The star of
    /// the model in use sits in the side slot, beside its check (#5051).
    private func row(row: ModelMenuRow, id: String, star: Bool = false) -> some View {
        let starBesideCheck = star && row.kind == .model && row.current
        return HStack(spacing: 0) {
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
                            // M-20261119-015: only this account of the person's offers the model
                            if let badge = row.badge {
                                Text(verbatim: badge)
                                    .font(.caption2)
                                    .foregroundStyle(Theme.accent)
                                    .padding(.horizontal, 5)
                                    .padding(.vertical, 1)
                                    .background(Theme.inset, in: RoundedRectangle(cornerRadius: 4))
                                    .accessibilityHint(Text(verbatim: row.badgeHint ?? ""))
                                    .accessibilityIdentifier("model-badge.\(row.instanceId ?? "").\(row.modelId ?? "")")
                            }
                        }
                        // M-20261119-015: the account it runs on, while the provider has several
                        if let account = row.account {
                            Text(verbatim: account).font(.footnote).foregroundStyle(Theme.textSecondary).lineLimit(1)
                                .accessibilityIdentifier("model-account.\(row.instanceId ?? "").\(row.modelId ?? "")")
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
                    if !starBesideCheck {
                        Color.clear.frame(width: ModelMenuLayout.sideSlot, height: ModelMenuLayout.iconSlot)
                    }
                    if !(star && row.kind == .model) {
                        iconOnly {
                            if row.current {
                                Image(systemName: "checkmark").font(.footnote.weight(.semibold)).foregroundStyle(Theme.accent)
                            }
                        }
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
                        .frame(width: starBesideCheck ? ModelMenuLayout.sideSlot : ModelMenuLayout.iconSlot, height: ModelMenuLayout.iconSlot)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(starred ? Text("Remove \(row.label) from favorites") : Text("Add \(row.label) to favorites"))
                .accessibilityIdentifier("model-favorite.\(row.instanceId ?? "").\(row.modelId ?? "")")
                if starBesideCheck {
                    iconOnly {
                        Image(systemName: "checkmark").font(.footnote.weight(.semibold)).foregroundStyle(Theme.accent)
                    }
                }
            }
        }
    }

    /// Side slot, then the icon slot, so every row's icon shares one centre.
    private func menuIcon<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        HStack(spacing: 0) {
            Color.clear.frame(width: ModelMenuLayout.sideSlot, height: ModelMenuLayout.iconSlot)
            iconOnly { content() }
        }
    }

    private func iconOnly<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        content().frame(width: ModelMenuLayout.iconSlot, height: ModelMenuLayout.iconSlot)
    }

    // MARK: Pick

    private func pick(_ row: ModelMenuRow) {
        switch row.kind {
        case .auto:
            // plain Auto: a composer mode also rides the Auto flag (#5091)
            guard selection.auto != true || selection.mode != nil || choose != nil else { return finish() }
            var next = selection
            next.auto = true
            next.mode = nil
            // Absent means Balance; store it so Optimize for shows the live choice.
            next.autoOptimize = selection.autoOptimize ?? .balance
            apply(next, updateBotDefault: true)
        case .follow:
            guard follows == false, choose == nil else { return finish() }
            apply(profile.modelSelection, updateBotDefault: true)
        case .model:
            guard let instance = instances.first(where: { $0.instanceId == row.instanceId }), let model = row.modelId else { return }
            if row.current && selection.auto != true && choose == nil { return finish() }
            apply(ModelPickerRules.selectionForPick(selection, instance: instance, model: model, pinAccount: row.pinAccount), updateBotDefault: true)
        }
    }

    /// #5091: a composer mode; like a model pick it becomes the bot's choice.
    private func pickMode(_ mode: ComposerMode) {
        guard ComposerModes.mode(of: selection) != mode || choose != nil else { return finish() }
        apply(ComposerModes.selection(selection, for: mode), updateBotDefault: true)
    }

    private func setAutoOptimize(_ value: ModelAutoOptimize) {
        var next = selection
        next.auto = true
        // Optimize belongs to plain Auto: choosing it leaves a mode
        next.mode = nil
        next.autoOptimize = value
        apply(next, updateBotDefault: true, keepOpen: true)
    }

    private func setEffort(_ level: String?) {
        let next = levelRow.choosing(level, in: selection)
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
