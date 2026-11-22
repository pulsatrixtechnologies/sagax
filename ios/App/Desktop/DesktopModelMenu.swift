// The desktop's model menu (ModelPicker `windowOnly`, ModelPickerMenu.tsx;
// "Lot 7: the full window is gone"), in place of the old large model
// window: one 340 pt popover (`rounded-xl border bg-popover py-1`) with
// the search field on a hairline, the model sections listed flat (a quiet
// heading each, a check on the model in use, a star on every model), the
// model's own settings in Advanced mode (Effort ›, its levels on a page of
// the menu), then Providers › (Settings > Providers). The rows are
// CompanionCore's ModelMenu, the phone menu's (ModelMenuSheet.swift).
//
// #5091 (the desktop's #5088, owner 2026-11-19, M-20261119-077): it opens on
// the modes, Auto (Optimize under it), Fast, Expert, Heavy, Manual; Manual
// is the list above (search, Effort, Providers) as the desktop's Manual
// lists it (D-20261119-083): the bot's model and the starred favorites
// first, then each provider and each of its accounts with its state
// ("Signed out"), every model with its star.
import SwiftUI
import CompanionCore

struct DesktopModelMenu: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @ObservedObject private var favorites = ModelFavoritesStore.shared
    /// The bot as the open thread sees it (`projected(forThread:)`).
    let bot: Bot
    let close: () -> Void
    let openProviders: () -> Void

    /// `MENU_WIDTH` (ModelPicker.tsx-parts/helpers.ts).
    static let width: CGFloat = 340

    @State private var instances: [Instance] = []
    @State private var config: ConfigStatus?
    @State private var simple = false
    @State private var loaded = false
    @State private var query = ""
    @State private var saving = false
    /// #5091: Manual's list is open (else the modes).
    @State private var manualOpen = false
    @FocusState private var searching: Bool

    private var organization: Bool { session.surfaceGate.allows(.people) }
    private var profile: Bot { session.state.bot(bot.id) ?? bot }
    private var current: Bot { session.state.bot(bot.id)?.projected(forThread: bot.threadId) ?? bot }
    private var selection: ModelSelection { current.currentTaskModelSelection }
    private var follows: Bool? { profile.tasks?.first { $0.threadId == bot.threadId }?.followsBotModel }

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
            follows: follows, organization: organization, allowedEngines: config?.allowedEngines, disabledModels: config?.disabledModels,
            myDisabledModels: config?.myDisabledModels, labels: labels,
            engineLabel: { DesktopEngineRail.label($0) }
        )
    }

    /// The engine in use and the model's effort levels (`modelEffortLevels`).
    private var active: Instance? { instances.first { $0.instanceId == selection.instanceId } }
    private var efforts: [String] {
        guard let active, selection.auto != true, active.capabilities?.modelVariants != true else { return [] }
        let option = active.models.options.first { $0.id == selection.model }
        return ModelEffort.pickerLevels(option, engine: active.capabilities?.effortLevels ?? [])
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if !manualOpen {
                modesPage
            } else {
                row(title: Text("Manual"), trailing: nil, chevron: false, id: "desktop-mode-back") { manualOpen = false }
                    .padding(.horizontal, 6)
                searchField
                list
                if !simple, !efforts.isEmpty { reasoning }
                VStack(spacing: 0) {
                    row(title: Text("Providers"), trailing: nil, chevron: true, id: "model-menu-providers") {
                        close()
                        openProviders()
                    }
                }
                .padding(.horizontal, 6)
                .padding(.top, 4)
                .overlay(alignment: .top) { Rectangle().fill(theme.hairline).frame(height: 1) }
            }
        }
        .padding(.vertical, 4)
        .frame(width: Self.width, alignment: .leading)
        .background(theme.menu, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline, lineWidth: 1))
        .shadow(color: .black.opacity(0.5), radius: 25, y: 25)
        .disabled(saving || current.busy == true)
        .task {
            instances = await session.modelInstances()
            config = await session.configStatus()
            let stored = await favorites.load(session)
            simple = ModelMenu.isSimple(stored: stored)
            loaded = true
        }
        // Escape: Manual's list, then the search, then the menu
        .background {
            Button("Close") {
                if manualOpen && query.isEmpty { manualOpen = false }
                else if !query.isEmpty { query = "" }
                else { close() }
            }
            .keyboardShortcut(.escape, modifiers: [])
            .opacity(0)
            .accessibilityHidden(true)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Model"))
        .accessibilityIdentifier("desktop-model-menu")
    }

    // MARK: Modes (#5091)

    private var modesPage: some View {
        let mode = ComposerModes.mode(of: selection)
        return VStack(alignment: .leading, spacing: 0) {
            Text("Mode")
                .font(theme.font(11.5))
                .foregroundStyle(theme.inkSecondary)
                .padding(.horizontal, 8)
                .padding(.top, 6)
                .padding(.bottom, 4)
            ForEach(ComposerMode.allCases, id: \.self) { candidate in
                row(title: modeName(candidate), trailing: modeBlurb(candidate), chevron: false, checked: mode == candidate, id: "desktop-mode-\(candidate.rawValue)") {
                    pickMode(candidate)
                }
                if candidate == .auto, mode == .auto { optimizeLine }
            }
            row(title: Text("Manual"), trailing: mode == nil ? Text(verbatim: currentModelName) : Text("Choose a model yourself"), chevron: true, checked: mode == nil, id: "desktop-mode-manual") {
                manualOpen = true
            }
        }
        .padding(.horizontal, 6)
        .padding(.bottom, 4)
    }

    private func modeName(_ mode: ComposerMode) -> Text {
        switch mode {
        case .auto: Text("Auto")
        case .fast: Text("Fast")
        case .expert: Text("Expert")
        case .heavy: Text("Heavy")
        }
    }

    private func modeBlurb(_ mode: ComposerMode) -> Text {
        switch mode {
        case .auto: Text("Picks from the request")
        case .fast: Text("Quick responses")
        case .expert: Text("Thinks hard")
        case .heavy: Text("Team of Experts")
        }
    }

    /// The pinned model's name, on the Manual row.
    private var currentModelName: String {
        sections.flatMap(\.rows).first { $0.kind == .model && $0.current }?.label ?? selection.model
    }

    private func pickMode(_ mode: ComposerMode) {
        guard ComposerModes.mode(of: selection) != mode else { return close() }
        apply(ComposerModes.selection(selection, for: mode), updateBotDefault: true)
    }

    // MARK: Search and list

    /// `mx-1.5 mb-1 border-b px-2 py-2`, a 13 pt search glyph and field.
    private var searchField: some View {
        HStack(spacing: 8) {
            DesktopIconView(icon: .search, size: 13).foregroundStyle(theme.inkSecondary)
            TextField("", text: $query, prompt: Text("Search models").foregroundColor(theme.inkTertiary))
                .font(theme.font(13))
                .foregroundStyle(theme.ink)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($searching)
                .accessibilityIdentifier("desktop-model-search")
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 8)
        .overlay(alignment: .bottom) { Rectangle().fill(theme.hairline).frame(height: 1) }
        .padding(.horizontal, 6)
        .padding(.bottom, 4)
    }

    /// `max-h-[min(400px,56dvh)] px-1.5 pb-1`: the sections flat, a hairline
    /// between them (the search filters them in place). #5091: Manual's
    /// list (ComposerModes.manual): the bot's model, Favorites, then each
    /// provider (a heading) and each of its accounts (a quiet heading, its
    /// state beside it in the accent, ModelPanel.tsx data-model-account-state).
    private var list: some View {
        let manual = ComposerModes.filter(ComposerModes.manual(
            sections, favorites: favorites.keys, instances: instances, allowedEngines: config?.allowedEngines, organization: organization,
            selectedId: selection.instanceId, labels: menuLabels, engineLabel: { DesktopEngineRail.label($0) }
        ), query: query)
        let empty = manual.top.isEmpty && manual.favorites.isEmpty && manual.providers.isEmpty
        return ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if !loaded {
                    HStack { Text("Loading models").font(theme.font(12.5)).foregroundStyle(theme.inkSecondary); Spacer(); ProgressView() }
                        .padding(12)
                } else if empty {
                    Text("No model matches.")
                        .font(theme.font(12.5))
                        .foregroundStyle(theme.inkSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 20)
                }
                if !manual.top.isEmpty {
                    VStack(alignment: .leading, spacing: 0) { ForEach(manual.top) { modelRow($0) } }
                        .padding(.vertical, 2)
                }
                if !manual.favorites.isEmpty {
                    VStack(alignment: .leading, spacing: 0) {
                        heading(Text("Favorites"))
                        ForEach(manual.favorites) { modelRow($0) }
                    }
                    .padding(.vertical, 2)
                    .overlay(alignment: .top) {
                        if !manual.top.isEmpty { Rectangle().fill(theme.hairline).frame(height: 1) }
                    }
                }
                ForEach(Array(manual.providers.enumerated()), id: \.element.id) { index, provider in
                    VStack(alignment: .leading, spacing: 0) {
                        heading(Text(verbatim: provider.label), ink: theme.ink)
                        ForEach(provider.accounts) { account in
                            if let label = account.label {
                                HStack(spacing: 4) {
                                    Text(verbatim: label).lineLimit(1)
                                    if let state = account.state {
                                        Group {
                                            Text(verbatim: "·")
                                            switch state {
                                            case .signedOut: Text("Signed out")
                                            case .notResponding: Text("Not responding")
                                            }
                                        }
                                        .foregroundStyle(theme.accent)
                                        .accessibilityIdentifier("desktop-model-account-state.\(account.instanceId)")
                                    }
                                }
                                .font(theme.font(11.5))
                                .foregroundStyle(theme.inkSecondary)
                                .padding(.horizontal, 8)
                                .padding(.top, 6)
                                .padding(.bottom, 2)
                                .accessibilityElement(children: .combine)
                                .accessibilityIdentifier("desktop-model-account.\(account.instanceId)")
                            }
                            ForEach(account.rows) { modelRow($0) }
                        }
                    }
                    .padding(.vertical, 2)
                    .overlay(alignment: .top) {
                        if index > 0 || !manual.top.isEmpty || !manual.favorites.isEmpty { Rectangle().fill(theme.hairline).frame(height: 1) }
                    }
                }
            }
            .padding(.horizontal, 6)
            .padding(.bottom, 4)
        }
        .frame(maxHeight: 400)
        .fixedSize(horizontal: false, vertical: true)
    }

    /// A section's quiet heading (11.5, secondary ink).
    private func heading(_ text: Text, ink: Color? = nil) -> some View {
        text
            .font(theme.font(11.5))
            .foregroundStyle(ink ?? theme.inkSecondary)
            .lineLimit(1)
            .padding(.horizontal, 8)
            .padding(.top, 8)
            .padding(.bottom, 4)
    }

    /// One text edge, then the fixed icon zone (#5051): the check, a model's
    /// star and a chevron share the icon slot. The star of the model in use
    /// sits in the side slot, beside its check. Auto's Optimize for is one
    /// line under the row while Auto is on.
    private func modelRow(_ row: ModelMenuRow) -> some View {
        let starBesideCheck = row.kind == .model && row.current
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 0) {
                Button { pick(row) } label: {
                    HStack(spacing: 6) {
                        modelNames(row)
                        Spacer(minLength: 4)
                        if !starBesideCheck {
                            Color.clear.frame(width: ModelMenuLayout.sideSlot, height: ModelMenuLayout.iconSlot)
                        }
                        if row.kind != .model {
                            iconSlot {
                                if row.current {
                                    DesktopIconView(icon: .check, size: 14).foregroundStyle(theme.accent)
                                }
                            }
                        }
                    }
                    .padding(.leading, 8)
                    .padding(.vertical, 6)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .accessibilityIdentifier("desktop-model-row.\(row.instanceId ?? row.kind.rawValue).\(row.modelId ?? "")")
                if row.kind == .model {
                    let starred = favorites.keys.contains(row.key)
                    starButton(row, starred: starred, width: starBesideCheck ? ModelMenuLayout.sideSlot : ModelMenuLayout.iconSlot)
                    if starBesideCheck {
                        iconSlot {
                            DesktopIconView(icon: .check, size: 14).foregroundStyle(theme.accent)
                        }
                    }
                }
            }
            .padding(.trailing, 8)
            if row.kind == .auto, row.current {
                optimizeLine.padding(.horizontal, 8)
            }
        }
    }

    private func modelNames(_ row: ModelMenuRow) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 6) {
                Text(verbatim: row.label).font(theme.font(13)).foregroundStyle(theme.ink).lineLimit(1)
                ForEach(row.tags, id: \.self) { tag in
                    Text(verbatim: tag)
                        .font(theme.font(10.5))
                        .foregroundStyle(theme.inkSecondary)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(theme.inset, in: RoundedRectangle(cornerRadius: 4, style: .continuous))
                }
                // M-20261119-015: only this account of the person's offers the model
                if let badge = row.badge {
                    Text(verbatim: badge)
                        .font(theme.font(10.5))
                        .foregroundStyle(theme.accent)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(theme.inset, in: RoundedRectangle(cornerRadius: 4, style: .continuous))
                        .accessibilityHint(Text(verbatim: row.badgeHint ?? ""))
                }
            }
            // M-20261119-015: the account it runs on, while the provider has several
            if let account = row.account {
                Text(verbatim: account).font(theme.font(11.5)).foregroundStyle(theme.inkSecondary).lineLimit(1)
            }
            if let detail = row.detail {
                Text(verbatim: detail).font(theme.font(11.5)).foregroundStyle(theme.inkSecondary).lineLimit(2)
            }
            if row.notResponding {
                Text("Not responding").font(theme.font(11.5)).foregroundStyle(theme.warning)
            }
        }
    }

    private func starButton(_ row: ModelMenuRow, starred: Bool, width: CGFloat) -> some View {
        Button { favorites.toggle(row.key, session: session) } label: {
            Image(systemName: starred ? "star.fill" : "star")
                .font(.system(size: 12))
                .foregroundStyle(starred ? theme.warning : theme.inkTertiary)
                .frame(width: width, height: ModelMenuLayout.iconSlot)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(starred ? Text("Remove \(row.label) from favorites") : Text("Add \(row.label) to favorites"))
    }

    private func iconSlot<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        content().frame(width: ModelMenuLayout.iconSlot, height: ModelMenuLayout.iconSlot)
    }

    /// #5051: Optimize for on one line under Auto, the small control at the right.
    private var optimizeLine: some View {
        ModelMenuOptimizeLine(
            selected: selection.autoOptimize ?? .balance,
            idPrefix: "desktop-model-auto-optimize",
            ink: theme.ink,
            secondary: theme.inkSecondary,
            track: theme.ink.opacity(0.06),
            chosen: theme.ink.opacity(0.10),
            onPick: setAutoOptimize
        )
    }

    // MARK: Reasoning

    /// Every level the model takes, whole, on balanced lines past four (#5051).
    private var reasoning: some View {
        ModelMenuReasoning(
            levels: efforts,
            selected: selection.effort,
            idPrefix: "model-menu-effort",
            ink: theme.ink,
            secondary: theme.inkSecondary,
            track: theme.ink.opacity(0.06),
            chosen: theme.ink.opacity(0.10),
            onPick: setEffort
        )
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .overlay(alignment: .top) { Rectangle().fill(theme.hairline).frame(height: 1) }
    }

    /// A 30 pt menu row. The trailing words end on one edge; the check and the
    /// chevron share the icon slot (#5051).
    private func row(title: Text, trailing: Text?, chevron: Bool, checked: Bool? = nil, id: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 0) {
                title.font(theme.font(13)).foregroundStyle(theme.ink).lineLimit(1)
                Spacer(minLength: 4)
                if let trailing {
                    trailing.font(theme.font(13)).foregroundStyle(theme.inkSecondary).lineLimit(1)
                }
                Color.clear.frame(width: ModelMenuLayout.sideSlot, height: ModelMenuLayout.iconSlot)
                iconSlot {
                    if checked == true {
                        DesktopIconView(icon: .check, size: 14).foregroundStyle(theme.accent)
                    } else if chevron {
                        DesktopIconView(icon: .chevronRight, size: 14).foregroundStyle(theme.inkSecondary)
                    }
                }
            }
            .padding(.horizontal, 8)
            .frame(height: 30)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityIdentifier(id)
    }

    // MARK: Pick

    private func pick(_ row: ModelMenuRow) {
        switch row.kind {
        case .auto:
            // plain Auto: a composer mode also rides the Auto flag (#5091)
            guard selection.auto != true || selection.mode != nil else { return close() }
            var next = selection
            next.auto = true
            next.mode = nil
            // Absent means Balance; store it so Optimize for shows the live choice.
            next.autoOptimize = selection.autoOptimize ?? .balance
            apply(next, updateBotDefault: true)
        case .follow:
            guard follows == false else { return close() }
            apply(profile.modelSelection, updateBotDefault: true)
        case .model:
            guard let instance = instances.first(where: { $0.instanceId == row.instanceId }), let model = row.modelId else { return }
            if row.current && selection.auto != true { return close() }
            // Pinning a model clears Auto and its Optimize preference.
            apply(ModelPickerRules.selectionForPick(selection, instance: instance, model: model), updateBotDefault: true)
        }
    }

    private func setAutoOptimize(_ value: ModelAutoOptimize) {
        var next = selection
        next.auto = true
        next.mode = nil
        next.autoOptimize = value
        apply(next, updateBotDefault: true, keepOpen: true)
    }

    private func setEffort(_ level: String?) {
        var next = selection
        next.effort = level
        apply(next, updateBotDefault: true, keepOpen: true)
    }

    private func apply(_ next: ModelSelection, updateBotDefault: Bool, keepOpen: Bool = false) {
        saving = true
        Task {
            _ = await session.updateModel(next, for: current, updateBotDefault: updateBotDefault)
            saving = false
            if !keepOpen { close() }
        }
    }
}
