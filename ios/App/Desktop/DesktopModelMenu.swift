// The iPad composer mode menu. Its panels share the phone menu navigation rules.
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

    @State private var panel: ComposerModes.Panel = .root
    @State private var preview: ComposerModes.Preview?

    private var levelRow: ComposerModes.Reasoning {
        ComposerModes.reasoning(selection: selection, instances: instances, preview: preview)
    }
    @State private var instances: [Instance] = []
    @State private var config: ConfigStatus?
    @State private var loaded = false
    @State private var query = ""
    @State private var saving = false
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
            follows: follows, organization: organization, allowedEngines: nil, disabledModels: config?.disabledModels,
            myDisabledModels: config?.myDisabledModels, labels: labels,
            engineLabel: { DesktopEngineRail.label($0) }
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if panel == .root {
                modesPage
            } else {
                if panel == .providers { searchField }
                if !loaded { ProgressView() }
                ScrollView {
                    VStack(alignment: .leading, spacing: 6) {
                        ComposerMenuPanel(panel: $panel, list: ComposerModes.filter(manual, query: query), reasoning: levelRow, automatic: ComposerModes.mode(of: selection) == .auto, pickEffort: setEffort, modelRow: modelRow)
                    }
                    .buttonStyle(.plain)
                    .font(theme.font(13))
                    .foregroundStyle(theme.ink)
                    .padding(.horizontal, 10)
                }
                .frame(maxHeight: 400)
                .fixedSize(horizontal: false, vertical: true)
            }
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
        .padding(.vertical, 4)
        .frame(width: Self.width, alignment: .leading)
        .background(theme.menu, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline, lineWidth: 1))
        .shadow(color: .black.opacity(0.5), radius: 25, y: 25)
        .disabled(saving || current.busy == true)
        .task {
            config = await session.configStatus()
            instances = await session.composerModelInstances(config: config)
            preview = try? await session.settingsClient?.composerModePreview(botId: bot.id, threadId: bot.threadId)
            _ = await favorites.load(session)
            loaded = true
        }
        // Escape: Manual's list, then the search, then the menu
        .background {
            Button("Close") {
                if panel != .root && query.isEmpty { panel = ComposerModes.back(panel, providers: manual.providers) }
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
            ForEach(ComposerModes.offered(preview), id: \.self) { candidate in
                row(title: modeName(candidate), trailing: modeBlurb(candidate), chevron: false, checked: mode == candidate, id: "desktop-mode-\(candidate.rawValue)") {
                    pickMode(candidate)
                }
            }
            if levelRow.shown {
                Divider()
                row(title: Text("Reasoning"), trailing: Text(verbatim: levelRow.label(levelRow.value, automatic: mode == .auto)), chevron: !levelRow.disabled, id: "desktop-mode-reasoning") { panel = .reasoning }
                    .disabled(levelRow.disabled)
            }
            if !loaded || !manual.providers.isEmpty || !manual.top.isEmpty {
                Divider()
                row(title: Text("All models"), trailing: pinnedLabel.map { Text(verbatim: $0) }, chevron: true, id: "desktop-mode-all") { panel = .providers }
            }
        }
        .padding(.horizontal, 6)
        .padding(.bottom, 4)
    }

    private var pinnedLabel: String? {
        guard selection.auto != true else { return nil }
        return sections.flatMap(\.rows).first { $0.kind == .model && $0.current }?.label ?? selection.model
    }

    private func modeName(_ mode: ComposerMode) -> Text {
        switch mode {
        case .auto: Text("Auto")
        case .fast: Text("Fast")
        case .expert: Text("Expert")
        case .build: Text("Build")
        case .heavy: Text("Heavy")
        }
    }

    private func modeBlurb(_ mode: ComposerMode) -> Text {
        switch mode {
        case .auto: Text("Picks from the request")
        case .fast: Text("Quick responses")
        case .expert: Text("Thinks hard")
        case .build: Text("A model made for code")
        case .heavy: Text("Team of Experts")
        }
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

    private var manual: ComposerModes.ManualList {
        ComposerModes.usable(ComposerModes.manual(
            sections, favorites: favorites.keys, instances: instances, allowedEngines: nil, organization: organization,
            selectedId: selection.instanceId, labels: menuLabels, engineLabel: { DesktopEngineRail.label($0) }
        ), thisComputer: String(localized: "This computer"), excluded: preview?.excluded)
    }

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
            apply(ModelPickerRules.selectionForPick(selection, instance: instance, model: model, pinAccount: row.pinAccount), updateBotDefault: true)
        }
    }

    private func setEffort(_ level: String?) {
        let next = levelRow.choosing(level, in: selection)
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
