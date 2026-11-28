// The iPad composer mode menu (#5529, desktop #5408 / ModeMenu.tsx): 280 px,
// Auto / Fast / Expert / Heavy, Custom (cascade of favorites and providers,
// Manage models at its foot), then Effort. Modes stay on screen; Custom and
// Effort open as the system's nested menus (#5338). No "All models" row and
// no Providers footer (those live under Custom / Manage models).
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

    /// `MODE_MENU_WIDTH` (ModeMenu.tsx): 280 so Custom names its model whole.
    static let width: CGFloat = 280

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
    /// A model the person pinned by hand (Custom), not a mode.
    private var pinned: Bool { selection.auto != true }

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
        modesPage
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

    // MARK: Modes (#5408 / #5529)

    private var modesPage: some View {
        let mode = ComposerModes.mode(of: selection)
        return VStack(alignment: .leading, spacing: 0) {
            ForEach(ComposerModes.offered(preview), id: \.self) { candidate in
                modeRow(candidate, checked: mode == candidate)
            }
            // Custom keeps the hook `desktop-mode-all` (desktop data-mode-row="all")
            if !loaded || !manual.providers.isEmpty || !manual.top.isEmpty || !manual.favorites.isEmpty || pinnedLabel != nil {
                ComposerCascadeAllModels(
                    list: manual,
                    favoriteKeys: favorites.keys,
                    onPick: pick,
                    onStar: { favorites.toggle($0.key, session: session) },
                    onManage: {
                        close()
                        openProviders()
                    }
                ) {
                    cascadeRow(
                        icon: .slidersHorizontal,
                        title: Text("Custom"),
                        trailing: pinnedLabel.map { Text(verbatim: $0) },
                        checked: pinned,
                        chevron: true
                    )
                }
                .accessibilityIdentifier("desktop-mode-all")
            }
            if levelRow.shown {
                Rectangle()
                    .fill(theme.hairline)
                    .frame(height: 1)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                // Effort keeps the hook `desktop-mode-reasoning` (desktop data-mode-row="reasoning")
                ComposerCascadeReasoning(reasoning: levelRow, automatic: mode == .auto, pickEffort: setEffort) {
                    cascadeRow(
                        icon: .gauge,
                        title: Text("Effort"),
                        trailing: effortTrailing(mode).map { Text(verbatim: $0) },
                        checked: false,
                        chevron: !levelRow.disabled
                    )
                }
                .disabled(levelRow.disabled)
                .accessibilityIdentifier("desktop-mode-reasoning")
            }
        }
        .padding(.horizontal, 6)
        .padding(.bottom, 4)
    }

    /// D-20261126-017: under Auto with no level chosen, Effort shows no value.
    private func effortTrailing(_ mode: ComposerMode?) -> String? {
        if mode == .auto, levelRow.value == nil { return nil }
        let text = levelRow.label(levelRow.value, automatic: mode == .auto)
        return text.isEmpty ? nil : text
    }

    private func modeRow(_ candidate: ComposerMode, checked: Bool) -> some View {
        Button { pickMode(candidate) } label: {
            HStack(spacing: 8) {
                DesktopIconView(icon: modeIcon(candidate), size: 15, strokeWidth: 1.75)
                    .foregroundStyle(checked ? theme.ink : theme.inkSecondary)
                    .frame(width: 16, height: 16)
                Text(modeTitle(candidate))
                    .font(theme.font(13))
                    .foregroundStyle(theme.ink)
                    .lineLimit(1)
                Spacer(minLength: 4)
                iconSlot {
                    if checked {
                        DesktopIconView(icon: .check, size: 14).foregroundStyle(theme.accent)
                    }
                }
            }
            .padding(.horizontal, 8)
            .frame(height: 36)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityIdentifier("desktop-mode-\(candidate.rawValue)")
    }

    private func cascadeRow(icon: DesktopIcon, title: Text, trailing: Text?, checked: Bool, chevron: Bool) -> some View {
        HStack(spacing: 8) {
            DesktopIconView(icon: icon, size: 15, strokeWidth: 1.75)
                .foregroundStyle(checked ? theme.ink : theme.inkSecondary)
                .frame(width: 16, height: 16)
            title.font(theme.font(13)).foregroundStyle(theme.ink).lineLimit(1)
            if let trailing {
                trailing
                    .font(theme.font(12))
                    .foregroundStyle(theme.inkSecondary)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            } else {
                Spacer(minLength: 4)
            }
            if checked {
                DesktopIconView(icon: .check, size: 14).foregroundStyle(theme.accent)
            }
            iconSlot {
                if chevron {
                    DesktopIconView(icon: .chevronRight, size: 14).foregroundStyle(theme.inkSecondary)
                }
            }
        }
        .padding(.horizontal, 8)
        .frame(height: 36)
        .contentShape(Rectangle())
    }

    private var pinnedLabel: String? {
        guard pinned else { return nil }
        return sections.flatMap(\.rows).first { $0.kind == .model && $0.current }?.label ?? selection.model
    }

    private func modeTitle(_ mode: ComposerMode) -> LocalizedStringKey {
        switch mode {
        case .auto: "Auto"
        case .fast: "Fast"
        case .expert: "Expert"
        case .heavy: "Heavy"
        }
    }

    private func modeIcon(_ mode: ComposerMode) -> DesktopIcon {
        switch mode {
        case .auto: .sparkles
        case .fast: .zap
        case .expert: .brain
        case .heavy: .layers
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

    // MARK: Pick

    private func pick(_ row: ModelMenuRow) {
        switch row.kind {
        case .auto:
            guard selection.auto != true || selection.mode != nil else { return close() }
            var next = selection
            next.auto = true
            next.mode = nil
            next.autoOptimize = selection.autoOptimize ?? .balance
            apply(next, updateBotDefault: true)
        case .follow:
            guard follows == false else { return close() }
            apply(profile.modelSelection, updateBotDefault: true)
        case .model:
            guard let instance = instances.first(where: { $0.instanceId == row.instanceId }), let model = row.modelId else { return }
            if row.current && selection.auto != true { return close() }
            apply(ModelPickerRules.selectionForPick(selection, instance: instance, model: model, pinAccount: row.pinAccount), updateBotDefault: true)
        }
    }

    private func setEffort(_ level: String?) {
        // Under Auto, clicking the checked level again hands it back (D-20261126-017).
        let chosen: String?
        if ComposerModes.mode(of: selection) == .auto, level != nil, level == levelRow.value {
            chosen = nil
        } else {
            chosen = level
        }
        let next = levelRow.choosing(chosen, in: selection)
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
