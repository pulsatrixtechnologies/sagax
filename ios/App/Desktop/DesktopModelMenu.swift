// The desktop's model menu (ModelPicker `windowOnly`, ModelPickerMenu.tsx;
// "Lot 7: the full window is gone"), in place of the old large model
// window: one 340 pt popover (`rounded-xl border bg-popover py-1`) with
// the search field on a hairline, the model sections listed flat (a quiet
// heading each, a check on the model in use, a star on every model), the
// model's own settings in Advanced mode (Effort ›, its levels on a page of
// the menu), then Providers › (Settings > Providers). The rows are
// CompanionCore's ModelMenu, the phone menu's (ModelMenuSheet.swift).
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
    @State private var effortOpen = false
    @FocusState private var searching: Bool

    private var organization: Bool { session.surfaceGate.allows(.people) }
    private var profile: Bot { session.state.bot(bot.id) ?? bot }
    private var current: Bot { session.state.bot(bot.id)?.projected(forThread: bot.threadId) ?? bot }
    private var selection: ModelSelection { current.currentTaskModelSelection }
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

    /// The engine in use and the model's effort levels (`modelEffortLevels`).
    private var active: Instance? { instances.first { $0.instanceId == selection.instanceId } }
    private var efforts: [String] {
        guard let active, selection.auto != true, active.capabilities?.modelVariants != true else { return [] }
        let option = active.models.options.first { $0.id == selection.model }
        return ModelEffort.pickerLevels(option, engine: active.capabilities?.effortLevels ?? [])
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if effortOpen {
                effortPage
            } else {
                searchField
                list
                if !simple, !efforts.isEmpty { settings }
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
        // Escape: the effort page, then the search, then the menu
        .background {
            Button("Close") {
                if effortOpen { effortOpen = false } else if !query.isEmpty { query = "" } else { close() }
            }
            .keyboardShortcut(.escape, modifiers: [])
            .opacity(0)
            .accessibilityHidden(true)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Model"))
        .accessibilityIdentifier("desktop-model-menu")
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
    /// between them (the search filters them in place).
    private var list: some View {
        let shown = ModelMenu.filter(sections, query: query)
        return ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if !loaded {
                    HStack { Text("Loading models").font(theme.font(12.5)).foregroundStyle(theme.inkSecondary); Spacer(); ProgressView() }
                        .padding(12)
                } else if shown.isEmpty {
                    Text("No model matches.")
                        .font(theme.font(12.5))
                        .foregroundStyle(theme.inkSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 20)
                }
                ForEach(Array(shown.enumerated()), id: \.element.id) { index, section in
                    VStack(alignment: .leading, spacing: 0) {
                        if let label = section.label {
                            Text(verbatim: label)
                                .font(theme.font(11.5))
                                .foregroundStyle(theme.inkSecondary)
                                .lineLimit(1)
                                .padding(.horizontal, 8)
                                .padding(.top, 8)
                                .padding(.bottom, 4)
                        }
                        ForEach(section.rows) { modelRow($0) }
                    }
                    .padding(.vertical, 2)
                    .overlay(alignment: .top) {
                        if index > 0 { Rectangle().fill(theme.hairline).frame(height: 1) }
                    }
                }
            }
            .padding(.horizontal, 6)
            .padding(.bottom, 4)
        }
        .frame(maxHeight: 400)
        .fixedSize(horizontal: false, vertical: true)
    }

    /// ModelSearchRow: the label 13 (its tags on the field fill), its detail
    /// 11.5, the check in the accent, a star on a model.
    private func modelRow(_ row: ModelMenuRow) -> some View {
        HStack(spacing: 6) {
            Button { pick(row) } label: {
                HStack(spacing: 6) {
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
                        }
                        if let detail = row.detail {
                            Text(verbatim: detail).font(theme.font(11.5)).foregroundStyle(theme.inkSecondary).lineLimit(2)
                        }
                        if row.notResponding {
                            Text("Not responding").font(theme.font(11.5)).foregroundStyle(theme.warning)
                        }
                    }
                    Spacer(minLength: 4)
                    if row.current {
                        DesktopIconView(icon: .check, size: 14).foregroundStyle(theme.accent)
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
            .accessibilityIdentifier("desktop-model-row.\(row.instanceId ?? row.kind.rawValue).\(row.modelId ?? "")")
            if row.kind == .model {
                let starred = favorites.keys.contains(row.key)
                Button { favorites.toggle(row.key, session: session) } label: {
                    Image(systemName: starred ? "star.fill" : "star")
                        .font(.system(size: 12))
                        .foregroundStyle(starred ? theme.warning : theme.inkTertiary)
                        .frame(width: 24, height: 24)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(starred ? Text("Remove \(row.label) from favorites") : Text("Add \(row.label) to favorites"))
            }
        }
    }

    // MARK: Settings

    /// ModelMenuSettings: Effort › with the level in use ("Default").
    private var settings: some View {
        VStack(spacing: 0) {
            row(title: Text("Effort"),
                trailing: Text(verbatim: selection.effort.flatMap { efforts.contains($0) ? BotPanelModel.effortLabel($0) : nil } ?? String(localized: "Default")),
                chevron: true, id: "model-menu-effort") { effortOpen = true }
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
        .overlay(alignment: .top) { Rectangle().fill(theme.hairline).frame(height: 1) }
    }

    /// EffortSubmenu: Back, then Default and the model's levels.
    private var effortPage: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button { effortOpen = false } label: {
                HStack(spacing: 4) {
                    DesktopIconView(icon: .chevronLeft, size: 14)
                    Text("Effort").font(theme.font(12.5, .medium))
                }
                .foregroundStyle(theme.inkSecondary)
                .padding(.horizontal, 8)
                .frame(height: 30)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Back"))
            ForEach([nil] + efforts.map(Optional.some), id: \.self) { level in
                let on = level == nil ? (selection.effort.map { !efforts.contains($0) } ?? true) : selection.effort == level
                row(title: Text(verbatim: level.map(BotPanelModel.effortLabel) ?? String(localized: "Default")),
                    trailing: nil, chevron: false, checked: on, id: "model-menu-effort.\(level ?? "default")") {
                    var next = selection
                    next.effort = level
                    apply(next, updateBotDefault: true, keepOpen: true)
                    effortOpen = false
                }
            }
        }
        .padding(.horizontal, 6)
    }

    /// A 30 pt menu row (`px-2 py-1.5 text-[13px] rounded-lg`).
    private func row(title: Text, trailing: Text?, chevron: Bool, checked: Bool? = nil, id: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                title.font(theme.font(13)).foregroundStyle(theme.ink).lineLimit(1)
                Spacer(minLength: 4)
                if let trailing { trailing.font(theme.font(13)).foregroundStyle(theme.inkSecondary).lineLimit(1) }
                if let checked { DesktopIconView(icon: .check, size: 14).foregroundStyle(theme.accent).opacity(checked ? 1 : 0) }
                if chevron { DesktopIconView(icon: .chevronRight, size: 14).foregroundStyle(theme.inkSecondary) }
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
            guard selection.auto != true else { return close() }
            var next = selection
            next.auto = true
            apply(next, updateBotDefault: true)
        case .follow:
            guard follows == false else { return close() }
            apply(profile.modelSelection, updateBotDefault: true)
        case .model:
            guard let instance = instances.first(where: { $0.instanceId == row.instanceId }), let model = row.modelId else { return }
            if row.current && selection.auto != true { return close() }
            apply(ModelPickerRules.selectionForPick(selection, instance: instance, model: model), updateBotDefault: true)
        }
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
