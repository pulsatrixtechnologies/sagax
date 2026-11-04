// Edit N bots (the home selection's Edit button): the sections of a bot's
// own settings (Model, Shared with, Workspace, Access, Voice, Permissions)
// for every selected bot at once. Every field reads
// "Do not change" until it is touched; a value the bots share shows as it
// is, else "Mixed values" with each bot's own. Lists change by Add, Remove
// or Replace with. Apply sends, bot by bot, only what differs for that bot,
// through the bot editor's own routes (PATCH /api/bots/:id and its grants):
// each bot is journaled and refused for its own
// reasons, and its result is shown. The values before are kept: "Undo the
// last bulk change" puts them back the same way. Rules live in
// CompanionCore/BulkBotEdit.swift (shared/bulk-bot-edit.ts).
import CompanionCore
import SwiftUI

// MARK: - Undo

/// The last bulk change's values before, kept while the app runs.
@MainActor
final class BulkBotEditUndoStore: ObservableObject {
    static let shared = BulkBotEditUndoStore()
    @Published private(set) var last: [BulkBotUndo] = []

    func keep(_ steps: [BulkBotUndo]) { last = steps }
    func clear() { last = [] }
}

// MARK: - Model

@MainActor
final class BulkEditBotsModel: ObservableObject {
    enum Phase: Equatable { case editing, applying, done }

    let botIds: [String]

    // What the server holds
    @Published var servers: [MCPServerListing]?
    @Published var voices: [Voice] = []
    @Published var config: ConfigStatus?
    @Published var instances: [Instance] = []
    @Published var grants: [String: [WireGrant]] = [:]
    @Published var grantsFailed: Set<String> = []
    @Published var directory: OrgShareDirectory?

    // The draft: nil is "Do not change"
    @Published var model: ModelSelection?
    @Published var computer: DesktopWorksOn?
    @Published var browser: Bool?
    @Published var notifications: Bool?
    @Published var speakReplies: Bool?
    @Published var voice: String?
    @Published var approval: ApprovalLevel?
    @Published var mcp: BulkListEdit?
    @Published var shared: BulkGrantEdit?

    @Published var phase: Phase = .editing
    @Published var outcomes: [BulkBotOutcome] = []
    @Published var undoing = false

    init(botIds: [String]) {
        self.botIds = botIds
    }

    var enabledServers: [String] { (servers ?? []).filter { $0.enabled != false }.map(\.name) }

    var plan: BulkBotEditPlan {
        var fields: BulkPatch = [:]
        if let model { fields["modelSelection"] = .encoding(model) }
        if let computer { fields["computer"] = computer == .auto ? .null : .string(computer.stored) }
        if let browser { fields["browser"] = .bool(browser) }
        if let notifications { fields["notifications"] = .bool(notifications) }
        if let speakReplies { fields["speakReplies"] = .bool(speakReplies) }
        if let voice { fields["voice"] = .string(voice) }
        if let approval { fields["approvalMode"] = .string(approval.rawValue) }
        return BulkBotEditPlan(fields: fields, mcpServers: mcp, grants: shared)
    }

    func load(session: Session, bots: [Bot], sharing: Bool) async {
        guard let client = session.profileClient else { return }
        async let status = session.configStatus()
        async let voiceList = session.voiceOptions()
        async let modelList = session.modelInstances()
        servers = (try? await client.mcpServers().servers) ?? []
        config = await status
        voices = await voiceList
        instances = await modelList
        if sharing {
            directory = try? await client.orgShareDirectory()
            for bot in bots {
                do { grants[bot.id] = try await client.botGrants(botId: bot.id).grants } catch { grantsFailed.insert(bot.id) }
            }
        }
    }

    func apply(session: Session, bots: [Bot]) async {
        guard let client = session.profileClient else { return }
        phase = .applying
        let result = await BulkBotEditRunner.apply(plan, bots: bots, enabledServers: enabledServers, api: client, reason: Self.reason)
        for bot in result.updated { session.applyProfileBot(bot) }
        if !result.undo.isEmpty { BulkBotEditUndoStore.shared.keep(result.undo) }
        outcomes = result.outcomes
        phase = .done
    }

    func undo(session: Session) async {
        guard let client = session.profileClient else { return }
        let steps = BulkBotEditUndoStore.shared.last
        guard !steps.isEmpty else { return }
        undoing = true
        phase = .applying
        let result = await BulkBotEditRunner.undo(steps, api: client, reason: Self.reason)
        for bot in result.updated { session.applyProfileBot(bot) }
        BulkBotEditUndoStore.shared.clear()
        outcomes = result.outcomes
        undoing = false
        phase = .done
    }

    /// The server's own words for a refusal.
    nonisolated static let reason: @Sendable (Error) -> String = { error in
        return error.localizedDescription
    }
}

// MARK: - Sheet

struct BulkEditBotsSheet: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var session: Session
    @StateObject private var model: BulkEditBotsModel
    @ObservedObject private var undoStore = BulkBotEditUndoStore.shared
    @State private var confirmingFull = false
    @State private var reviewing = false
    @State private var choosingModel = false
    @State private var shareQuery = ""

    init(botIds: [String]) {
        _model = StateObject(wrappedValue: BulkEditBotsModel(botIds: botIds))
    }

    private var bots: [Bot] { model.botIds.compactMap { session.state.bot($0) } }
    private var gate: SurfaceGate { session.surfaceGate }
    private var showsSharing: Bool { gate.allows(.botSharing) }

    /// Offered when the bot editor would offer it for at least one bot; the
    /// server answers for each of the others.
    private func edits(_ field: String) -> Bool {
        bots.contains { session.canAdminister || session.canEditBotField($0, field) }
    }

    var body: some View {
        NavigationStack {
            Group {
                switch model.phase {
                case .editing: form
                case .applying: progress
                case .done: results
                }
            }
            .navigationTitle(Text("Edit \(bots.count) bots"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(model.phase == .done ? String(localized: "Done") : String(localized: "Cancel")) { dismiss() }
                        .disabled(model.phase == .applying)
                        .accessibilityIdentifier("bulk-edit-close")
                }
                if model.phase == .editing {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(String(localized: "Review")) { reviewing = true }
                            .disabled(model.plan.isEmpty)
                            .accessibilityIdentifier("bulk-edit-review")
                    }
                }
            }
        }
        .task {
            await model.load(session: session, bots: bots, sharing: showsSharing)
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-parity-bulk-edit-draft") {
                model.voice = ""
                model.approval = .auto
                model.notifications = false
            }
            #endif
        }
        .interactiveDismissDisabled(model.phase == .applying)
        .accessibilityIdentifier("bulk-edit-sheet")
    }

    // MARK: Form

    private var form: some View {
        ThemedForm {
            if !undoStore.last.isEmpty {
                Section {
                    undoButton
                } footer: {
                    Text("Puts back each bot's values from before the last bulk change, the same way.")
                }
            }
            modelSection
            if showsSharing { sharingSection }
            workspaceSection
            accessSection
            voiceSection
            permissionsSection
            Section {
                Button {
                    reviewing = true
                } label: {
                    Text("Review and apply").frame(maxWidth: .infinity)
                }
                .disabled(model.plan.isEmpty)
                .accessibilityIdentifier("bulk-edit-review-bottom")
            } footer: {
                Text("Each bot is changed on its own, as in its own settings: a bot that refuses keeps its values and says why.")
            }
        }
        .confirmationDialog(summary, isPresented: $reviewing, titleVisibility: .visible) {
            Button(String(localized: "Apply")) { Task { await model.apply(session: session, bots: bots) } }
                .accessibilityIdentifier("bulk-edit-apply")
            Button(String(localized: "Cancel"), role: .cancel) {}
        }
        .alert("Give these bots Full access?", isPresented: $confirmingFull) {
            Button("Cancel", role: .cancel) {}
            Button("Full access", role: .destructive) { model.approval = .full }
        } message: {
            Text("They run commands and edit files without asking, in every thread. Use only with bots you trust.")
        }
        .sheet(isPresented: $choosingModel) {
            if let first = bots.first {
                ModelMenuSheet(bot: first, close: { choosingModel = false }, choose: { model.model = $0 })
            }
        }
    }

    // MARK: Model

    private var modelSection: some View {
        Section {
            let current = column { BulkBotField.modelSelection.value(of: $0) }
            BulkFieldRow(title: String(localized: "Model"), current: current, bots: bots, describe: describeModel, touched: model.model != nil) {
                Button {
                    choosingModel = true
                } label: {
                    Text(model.model.map { modelLabel($0) } ?? String(localized: "Choose a model"))
                }
                .disabled(!edits("modelSelection"))
                .accessibilityIdentifier("bulk-edit-model")
            } reset: { model.model = nil }
            if let selection = model.model, let options = ModelVariantRules.options(for: selection, instances: model.instances) {
                ModelVariantPicker(options: options, saved: nil, variant: Binding(
                    get: { model.model?.variant },
                    set: { model.model?.variant = $0 }
                ))
            }
        } header: {
            Text("Model")
        }
    }

    private func modelLabel(_ selection: ModelSelection) -> String {
        let instance = model.instances.first { $0.instanceId == selection.instanceId }
        let name = instance?.models.options.first { $0.id == selection.model }?.label ?? (selection.model.isEmpty ? String(localized: "Default") : selection.model)
        return selection.auto == true ? String(localized: "Auto · \(name)") : name
    }

    private func describeModel(_ value: BulkValue?) -> String {
        guard let selection = value?.decoded(as: ModelSelection.self) else { return String(localized: "Default") }
        return modelLabel(selection)
    }

    // MARK: Workspace

    private var workspaceSection: some View {
        Section {
            let current = column { BulkBotField.computer.value(of: $0) }
            BulkFieldRow(title: String(localized: "Works on"), current: current, bots: bots, describe: describeComputer, touched: model.computer != nil) {
                Picker(String(localized: "Works on"), selection: optional($model.computer)) {
                    Text("Do not change").tag(DesktopWorksOn?.none)
                    ForEach([DesktopWorksOn.auto, .local, .cloud, .off], id: \.self) { place in
                        Text(BotWorksOnSection.name(place)).tag(Optional(place))
                    }
                }
                .disabled(!edits("computer"))
                .accessibilityIdentifier("bulk-edit-works-on")
            } reset: { model.computer = nil }
        } header: {
            Text("Workspace")
        } footer: {
            Text("Off gives the bots no computer and no browser.")
        }
    }

    private func describeComputer(_ value: BulkValue?) -> String {
        let place = value?.stringValue.flatMap(DesktopWorksOn.init(rawValue:)) ?? .auto
        return BotWorksOnSection.name(place)
    }

    // MARK: Access

    private var accessSection: some View {
        Section {
            let lists = bots.map { BulkBotValue(botId: $0.id, value: ($0.mcpServers ?? model.enabledServers).sorted()) }
            BulkListEditor(
                title: String(localized: "MCP servers"),
                current: BulkBotEdit.commonValue(lists),
                bots: bots,
                edit: $model.mcp,
                options: (model.servers ?? []).map { BulkListOption(id: $0.name, label: $0.name, disabled: $0.enabled == false) },
                common: BulkBotEdit.commonListItems(bots.map { $0.mcpServers ?? model.enabledServers }),
                editable: edits("mcpServers"),
                identifier: "bulk-edit-mcp"
            ) { option in
                if let server = model.servers?.first(where: { $0.name == option.id }) { McpServerLabel(server: server) }
            }
            let browser = column { BulkBotField.browser.value(of: $0) }
            BulkFieldRow(title: String(localized: "Browser"), current: browser, bots: bots, describe: describeOnOff, touched: model.browser != nil) {
                onOffPicker(String(localized: "Browser"), $model.browser, id: "bulk-edit-browser").disabled(!edits("browser"))
            } reset: { model.browser = nil }
        } header: {
            Text("Access")
        } footer: {
            Text("A bot without its own list mounts every enabled server: the change starts from that set.")
        }
    }

    // MARK: Voice

    private var voiceSection: some View {
        Section {
            let notifications = column { BulkBotField.notifications.value(of: $0) }
            BulkFieldRow(title: String(localized: "Notifications"), current: notifications, bots: bots, describe: describeOnOff, touched: model.notifications != nil) {
                onOffPicker(String(localized: "Notifications"), $model.notifications, id: "bulk-edit-notifications")
            } reset: { model.notifications = nil }
            let speak = column { BulkBotField.speakReplies.value(of: $0) }
            BulkFieldRow(title: String(localized: "Read replies aloud"), current: speak, bots: bots, describe: describeOnOff, touched: model.speakReplies != nil) {
                onOffPicker(String(localized: "Read replies aloud"), $model.speakReplies, id: "bulk-edit-speak")
            } reset: { model.speakReplies = nil }
            let voice = column { BulkBotField.voice.value(of: $0) }
            BulkFieldRow(title: String(localized: "Voice"), current: voice, bots: bots, describe: describeVoice, touched: model.voice != nil) {
                Picker(String(localized: "Voice"), selection: optional($model.voice)) {
                    Text("Do not change").tag(String?.none)
                    Text("Workspace default").tag(Optional(""))
                    ForEach(model.voices) { option in Text(option.label).tag(Optional(option.id)) }
                }
                .accessibilityIdentifier("bulk-edit-voice")
            } reset: { model.voice = nil }
        } header: {
            Text("Voice")
        }
    }

    private func describeVoice(_ value: BulkValue?) -> String {
        let id = value?.stringValue ?? ""
        if id.isEmpty { return String(localized: "Workspace default") }
        return model.voices.first { $0.id == id }?.label ?? id
    }

    // MARK: Permissions

    private var permissionsSection: some View {
        Section {
            let current = column { BulkBotField.approvalMode.value(of: $0) }
            BulkFieldRow(title: String(localized: "Approval level"), current: current, bots: bots, describe: describeLevel, touched: model.approval != nil) {
                Picker(String(localized: "Approval level"), selection: Binding(get: { model.approval }, set: { next in
                    if next == .full, model.approval != .full { confirmingFull = true } else { model.approval = next }
                })) {
                    Text("Do not change").tag(ApprovalLevel?.none)
                    ForEach([ApprovalLevel.ask, .edits, .auto, .full], id: \.self) { level in
                        Label { Text(DesktopApprovalButton.label(level)) } icon: { Image(systemName: DesktopApprovalButton.icon(level)) }
                            .tag(Optional(level))
                    }
                }
                .disabled(!edits("approvalMode"))
                .accessibilityIdentifier("bulk-edit-approval")
            } reset: { model.approval = nil }
        } header: {
            Text("Permissions")
        } footer: {
            if let level = model.approval { Text(DesktopApprovalButton.detail(level)) }
        }
    }

    private func describeLevel(_ value: BulkValue?) -> String {
        let level = ApprovalLevel(rawValue: value?.stringValue ?? "") ?? .ask
        return String(localized: DesktopApprovalButton.labelResource(level))
    }

    // MARK: Shared with

    private var sharingSection: some View {
        Section {
            let records = bots.map { bot in
                BulkBotValue(botId: bot.id, value: (model.grants[bot.id] ?? []).map { "\($0.target)#\($0.level.rawValue)" }.sorted())
            }
            BulkGrantEditor(
                current: BulkBotEdit.commonValue(records),
                bots: bots,
                edit: $model.shared,
                grants: model.grants,
                directory: model.directory,
                query: $shareQuery,
                editable: gate.allows(.botSharing)
            )
            if !model.grantsFailed.isEmpty {
                Text("Some bots' sharing could not be read; they are changed from what the server holds.")
                    .font(.footnote).foregroundStyle(Theme.textSecondary)
            }
        } header: {
            Text("Shared with")
        }
    }

    // MARK: Review, progress, results

    private var summaryLines: [BulkSummaryLine] {
        var lines: [BulkSummaryLine] = []
        if let selection = model.model { lines.append(.init(field: String(localized: "Model"), value: modelLabel(selection))) }
        if let grants = model.shared {
            let labels = grantLabels
            let names = BulkListEdit(mode: grants.mode, items: grants.items.map(\.target))
            lines.append(.init(field: String(localized: "Shared with"),
                               value: BulkSummary.listValue(names, label: { labels[$0] ?? $0 }, none: String(localized: "nobody"))))
        }
        if let place = model.computer { lines.append(.init(field: String(localized: "Works on"), value: BotWorksOnSection.name(place))) }
        if let mcp = model.mcp {
            lines.append(.init(field: String(localized: "MCP servers"), value: BulkSummary.listValue(mcp, label: { $0 }, none: String(localized: "none"))))
        }
        if let on = model.browser { lines.append(.init(field: String(localized: "Browser"), value: onOff(on))) }
        if let on = model.notifications { lines.append(.init(field: String(localized: "Notifications"), value: onOff(on))) }
        if let on = model.speakReplies { lines.append(.init(field: String(localized: "Read replies aloud"), value: onOff(on))) }
        if let voice = model.voice { lines.append(.init(field: String(localized: "Voice"), value: describeVoice(.string(voice)))) }
        if let level = model.approval { lines.append(.init(field: String(localized: "Approval level"), value: describeLevel(.string(level.rawValue)))) }
        return lines
    }

    private var summary: String {
        BulkSummary.text(botCount: bots.count, botsWord: { String(localized: "\($0) bots") }, lines: summaryLines)
    }

    private var grantLabels: [String: String] {
        var labels: [String: String] = [:]
        for grant in model.grants.values.flatMap({ $0 }) { labels[grant.target] = grant.label }
        for candidate in GrantRules.candidates(model.directory, ownerId: nil, taken: [], query: "", administer: nil, limit: .max) {
            labels[candidate.target] = candidate.label
        }
        return labels
    }

    private var progress: some View {
        VStack(spacing: 12) {
            ProgressView()
            Group {
                if model.undoing { Text("Undoing the last bulk change") } else { Text("Changing the bots one at a time") }
            }
            .foregroundStyle(Theme.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityIdentifier("bulk-edit-progress")
    }

    private var results: some View {
        ThemedForm {
            let counts = BulkBotEdit.outcomeCounts(model.outcomes)
            Section {
                ForEach(model.outcomes) { outcome in
                    let name = session.state.bot(outcome.botId)?.name ?? outcome.botId
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Image(systemName: outcome.ok ? (outcome.skipped ? "equal.circle" : "checkmark.circle.fill") : "xmark.octagon.fill")
                                .foregroundStyle(outcome.ok ? (outcome.skipped ? Theme.textSecondary : Theme.toggleOn) : Theme.danger)
                            Text(verbatim: name).foregroundStyle(Theme.textPrimary)
                            Spacer()
                            Text(outcome.ok ? (outcome.skipped ? String(localized: "Unchanged") : String(localized: "OK")) : String(localized: "Refused"))
                                .font(.footnote).foregroundStyle(Theme.textSecondary)
                        }
                        ForEach(outcome.reasons, id: \.self) { reason in
                            Text(verbatim: reason).font(.footnote).foregroundStyle(Theme.danger)
                        }
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("bulk-edit-result.\(outcome.botId)")
                }
            } header: {
                Text("Result")
            } footer: {
                Text("\(counts.ok) changed, \(counts.skipped) unchanged, \(counts.failed) refused")
            }
            if !undoStore.last.isEmpty {
                Section { undoButton }
            }
        }
    }

    private var undoButton: some View {
        Button {
            Task { await model.undo(session: session) }
        } label: {
            Label("Undo the last bulk change", systemImage: "arrow.uturn.backward")
        }
        .accessibilityIdentifier("bulk-edit-undo")
    }

    // MARK: Helpers

    private func column(_ read: (Bot) -> BulkValue) -> BulkCommonValue<BulkValue> {
        BulkBotEdit.commonValue(bots.map { BulkBotValue(botId: $0.id, value: read($0)) })
    }

    private func describeOnOff(_ value: BulkValue?) -> String { onOff(value?.boolValue == true) }

    private func onOff(_ on: Bool) -> String { on ? String(localized: "On") : String(localized: "Off") }

    private func onOffPicker(_ title: String, _ value: Binding<Bool?>, id: String) -> some View {
        Picker(title, selection: optional(value)) {
            Text("Do not change").tag(Bool?.none)
            Text("On").tag(Optional(true))
            Text("Off").tag(Optional(false))
        }
        .accessibilityIdentifier(id)
    }

    /// A Picker's selection over an optional draft.
    private func optional<Value>(_ binding: Binding<Value?>) -> Binding<Value?> { binding }
}

// MARK: - A field

/// One field: the bots' current value (or Mixed values, each bot's own in a
/// menu), the control, and Do not change once touched.
struct BulkFieldRow<Control: View>: View {
    let title: String
    let current: BulkCommonValue<BulkValue>
    let bots: [Bot]
    let describe: (BulkValue?) -> String
    let touched: Bool
    @ViewBuilder let control: () -> Control
    let reset: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            control()
            HStack(spacing: 6) {
                BulkCurrentValue(current: current, bots: bots, describe: describe)
                Spacer(minLength: 4)
                if touched {
                    Button(String(localized: "Do not change"), action: reset)
                        .font(.footnote)
                        .buttonStyle(.borderless)
                        .accessibilityLabel(Text("Do not change \(title)"))
                }
            }
        }
    }
}

/// "Now: X", or "Mixed values" opening each bot's own.
struct BulkCurrentValue<Value: Hashable & Sendable>: View {
    let current: BulkCommonValue<Value>
    let bots: [Bot]
    let describe: (Value?) -> String

    var body: some View {
        switch current {
        case let .same(value):
            Text("Now: \(describe(value))")
                .font(.footnote).foregroundStyle(Theme.textSecondary)
        case let .mixed(rows):
            Menu {
                ForEach(rows, id: \.botId) { row in
                    let name = bots.first { $0.id == row.botId }?.name ?? row.botId
                    Text(verbatim: "\(name): \(describe(row.value))")
                }
            } label: {
                HStack(spacing: 3) {
                    Text("Mixed values")
                    Image(systemName: "chevron.up.chevron.down").font(.caption2)
                }
                .font(.footnote)
            }
            .accessibilityHint(Text("Shows each bot's value"))
            .accessibilityIdentifier("bulk-edit-mixed")
        }
    }
}

// MARK: - A list

struct BulkListOption: Identifiable, Hashable {
    var id: String
    var label: String
    var disabled = false
}

extension BulkListMode {
    var title: String {
        switch self {
        case .add: String(localized: "Add")
        case .remove: String(localized: "Remove")
        case .replace: String(localized: "Replace with")
        }
    }
}

/// A list (MCP servers): Do not change, Add, Remove or
/// Replace with, then the items. Replace starts from what every bot has.
struct BulkListEditor<Row: View>: View {
    let title: String
    let current: BulkCommonValue<[String]>
    let bots: [Bot]
    @Binding var edit: BulkListEdit?
    let options: [BulkListOption]
    let common: [String]
    let editable: Bool
    let identifier: String
    var describe: ((String) -> String)? = nil
    @ViewBuilder let row: (BulkListOption) -> Row

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Picker(title, selection: Binding(get: { edit?.mode }, set: { mode in
                guard let mode else { edit = nil; return }
                edit = BulkListEdit(mode: mode, items: mode == .replace ? common : (edit?.mode == .replace ? [] : edit?.items ?? []))
            })) {
                Text("Do not change").tag(BulkListMode?.none)
                ForEach(BulkListMode.allCases, id: \.self) { mode in Text(mode.title).tag(Optional(mode)) }
            }
            .disabled(!editable)
            .accessibilityIdentifier(identifier)
            BulkCurrentValue(current: current, bots: bots) { list in
                let names = (list ?? []).map { describe?($0) ?? $0 }
                return names.isEmpty ? String(localized: "None") : names.joined(separator: ", ")
            }
        }
        if let current = edit {
            ForEach(options) { option in
                Toggle(isOn: Binding(get: { current.items.contains(option.id) }, set: { on in
                    var items = edit?.items ?? []
                    items.removeAll { $0 == option.id }
                    if on { items.append(option.id) }
                    edit?.items = items
                })) {
                    row(option)
                }
                .tint(Theme.toggleOn)
                .disabled(option.disabled && current.mode != .remove)
                .accessibilityIdentifier("\(identifier).\(option.id)")
            }
        }
    }
}

/// Shared with: Do not change, Add, Remove or Replace with, then the
/// people and teams, each at the level chosen for it.
struct BulkGrantEditor: View {
    let current: BulkCommonValue<[String]>
    let bots: [Bot]
    @Binding var edit: BulkGrantEdit?
    let grants: [String: [WireGrant]]
    let directory: OrgShareDirectory?
    @Binding var query: String
    let editable: Bool

    /// Everyone on a selected bot, then the directory's matches.
    private var known: [GrantCandidate] {
        var seen = Set<String>()
        var out: [GrantCandidate] = []
        for grant in bots.flatMap({ grants[$0.id] ?? [] }) where seen.insert(grant.target).inserted {
            out.append(GrantCandidate(target: grant.target, kind: grant.kind, label: grant.label, detail: "", count: nil))
        }
        if edit?.mode != .remove {
            for candidate in GrantRules.candidates(directory, ownerId: nil, taken: Array(seen), query: query, administer: nil) {
                out.append(candidate)
            }
        }
        return out
    }

    private var labels: [String: String] {
        Dictionary(known.map { ($0.target, $0.label) }, uniquingKeysWith: { a, _ in a })
    }

    private var common: [BotGrantRecord] {
        let lists = bots.map { (grants[$0.id] ?? []).map { "\($0.target)#\($0.level.rawValue)" } }
        return BulkBotEdit.commonListItems(lists).compactMap { key in
            let parts = key.split(separator: "#", maxSplits: 1).map(String.init)
            guard parts.count == 2, let level = GrantLevel(rawValue: parts[1]) else { return nil }
            return BotGrantRecord(target: parts[0], level: level)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Picker(String(localized: "Shared with"), selection: Binding(get: { edit?.mode }, set: { mode in
                guard let mode else { edit = nil; return }
                edit = BulkGrantEdit(mode: mode, items: mode == .replace ? common : (edit?.mode == .replace ? [] : edit?.items ?? []))
            })) {
                Text("Do not change").tag(BulkListMode?.none)
                ForEach(BulkListMode.allCases, id: \.self) { mode in Text(mode.title).tag(Optional(mode)) }
            }
            .disabled(!editable)
            .accessibilityIdentifier("bulk-edit-sharing")
            BulkCurrentValue(current: current, bots: bots) { list in
                let names = (list ?? []).compactMap { key -> String? in
                    let parts = key.split(separator: "#", maxSplits: 1).map(String.init)
                    guard let target = parts.first else { return nil }
                    let level = parts.count == 2 ? GrantLevel(rawValue: parts[1])?.label ?? "" : ""
                    return "\(labels[target] ?? target) (\(level))"
                }
                return names.isEmpty ? String(localized: "Nobody") : names.joined(separator: ", ")
            }
        }
        if let current = edit {
            if current.mode != .remove {
                TextField(String(localized: "Search by name, login or email"), text: $query)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("bulk-edit-sharing-search")
            }
            ForEach(known) { candidate in
                let chosen = current.items.first { $0.target == candidate.target }
                HStack(spacing: 8) {
                    Button {
                        toggle(candidate.target, on: chosen == nil)
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: chosen == nil ? "circle" : "checkmark.circle.fill")
                                .foregroundStyle(chosen == nil ? Theme.textTertiary : Theme.accent)
                            GrantCandidateLabel(candidate: candidate)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    Spacer(minLength: 8)
                    if let chosen, current.mode != .remove {
                        Menu {
                            ForEach(GrantLevel.allCases, id: \.self) { level in
                                Button { setLevel(candidate.target, level) } label: {
                                    if level == chosen.level { Label(level.label, systemImage: "checkmark") } else { Text(level.label) }
                                }
                            }
                        } label: {
                            HStack(spacing: 4) {
                                Text(chosen.level.label)
                                Image(systemName: "chevron.up.chevron.down").font(.caption2)
                            }
                            .font(.footnote)
                        }
                        .accessibilityLabel(Text(String(localized: "Level") + " · " + candidate.label))
                    }
                }
                .accessibilityIdentifier("bulk-edit-sharing.\(candidate.target)")
            }
        }
    }

    private func toggle(_ target: String, on: Bool) {
        var items = edit?.items ?? []
        items.removeAll { $0.target == target }
        if on { items.append(BotGrantRecord(target: target, level: .use)) }
        edit?.items = items
    }

    private func setLevel(_ target: String, _ level: GrantLevel) {
        guard let index = edit?.items.firstIndex(where: { $0.target == target }) else { return }
        edit?.items[index].level = level
    }
}
