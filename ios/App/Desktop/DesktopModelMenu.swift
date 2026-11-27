// The iPad composer mode menu (#5338): modes stay on screen; Reasoning and
// All models open as the system's nested menus, shared with the phone sheet.
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

    @State private var preview: ComposerModes.Preview?

    private var levelRow: ComposerModes.Reasoning {
        ComposerModes.reasoning(selection: selection, instances: instances, preview: preview)
    }
    @State private var instances: [Instance] = []
    @State private var config: ConfigStatus?
    @State private var loaded = false
    @State private var saving = false

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
            modesPage
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
        .background {
            Button("Close", action: close)
                .keyboardShortcut(.escape, modifiers: [])
                .opacity(0)
                .accessibilityHidden(true)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Model"))
        .accessibilityIdentifier("desktop-model-menu")
    }

    // MARK: Modes (#5091, cascade #5338)

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
                ComposerCascadeReasoning(reasoning: levelRow, automatic: mode == .auto, pickEffort: setEffort) {
                    cascadeRow(
                        title: Text("Reasoning"),
                        trailing: Text(verbatim: levelRow.label(levelRow.value, automatic: mode == .auto)),
                        chevron: !levelRow.disabled
                    )
                }
                .disabled(levelRow.disabled)
                .accessibilityIdentifier("desktop-mode-reasoning")
            }
            if !loaded || !manual.providers.isEmpty || !manual.top.isEmpty || !manual.favorites.isEmpty {
                Divider()
                ComposerCascadeAllModels(
                    list: manual,
                    favoriteKeys: favorites.keys,
                    onPick: pick,
                    onStar: { favorites.toggle($0.key, session: session) }
                ) {
                    cascadeRow(
                        title: Text("All models"),
                        trailing: pinnedLabel.map { Text(verbatim: $0) },
                        chevron: true
                    )
                }
                .accessibilityIdentifier("desktop-mode-all")
            }
        }
        .padding(.horizontal, 6)
        .padding(.bottom, 4)
    }

    /// A mode-menu row that opens a system nested menu; same metrics as `row`.
    private func cascadeRow(title: Text, trailing: Text?, chevron: Bool) -> some View {
        HStack(spacing: 0) {
            title.font(theme.font(13)).foregroundStyle(theme.ink).lineLimit(1)
            Spacer(minLength: 4)
            if let trailing {
                trailing.font(theme.font(13)).foregroundStyle(theme.inkSecondary).lineLimit(1)
            }
            Color.clear.frame(width: ModelMenuLayout.sideSlot, height: ModelMenuLayout.iconSlot)
            iconSlot {
                if chevron {
                    DesktopIconView(icon: .chevronRight, size: 14).foregroundStyle(theme.inkSecondary)
                }
            }
        }
        .padding(.horizontal, 8)
        .frame(height: 30)
        .contentShape(Rectangle())
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

    private func pickMode(_ mode: ComposerMode) {
        guard ComposerModes.mode(of: selection) != mode else { return close() }
        apply(ComposerModes.selection(selection, for: mode), updateBotDefault: true)
    }

    // MARK: List

    private var manual: ComposerModes.ManualList {
        ComposerModes.usable(ComposerModes.manual(
            sections, favorites: favorites.keys, instances: instances, allowedEngines: nil, organization: organization,
            selectedId: selection.instanceId, labels: menuLabels, engineLabel: { DesktopEngineRail.label($0) }
        ), thisComputer: String(localized: "This computer"), excluded: preview?.excluded)
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
