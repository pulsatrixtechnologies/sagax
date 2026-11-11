// The iPhone bot panel's More pages that had no phone page of their own
// (`bot-settings/sections.ts`): Model, Permissions, Works on, Voice &
// alerts and Usage, as phone forms. Each change saves at once, as on the
// desktop (no Save button). The pages the phone already had (Skills,
// Memory, Access, Who can see it, Shared with, History,
// Slack) are pushed as they are; Overview carries the prompt preview, as
// `OverviewSection.tsx` does.
//
// Moved here from the retired "Bot settings" sheet (AgentProfileView):
// the model picker, the voice card, notifications; from its Advanced
// bucket: usage, voice notes.
import AVFAudio
import CompanionCore
import SwiftUI

// MARK: - Page frame

/// A More page: the phone's grouped form under the section's title.
struct BotPanelFormPage<Content: View>: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    let section: DesktopPanelSection
    var bot: Bot?
    @ViewBuilder let content: Content

    var body: some View {
        ThemedForm {
            if let intro = section.subpageIntro {
                Section { Text(intro).font(.footnote).foregroundStyle(Theme.textSecondary) }
                    .accessibilityIdentifier("panel-page.\(section.rawValue).intro")
            }
            // a section this viewer may not change says why (`botSectionLock`)
            if let bot, let lock = session.sectionLock(bot, section) {
                Section { PanelLockNote(text: lock) }
                    .accessibilityIdentifier("panel-page.\(section.rawValue).locked")
            }
            content
        }
            .navigationTitle(Text(section.title))
            .navigationBarTitleDisplayMode(.inline)
            .accessibilityIdentifier("panel-page.\(section.rawValue)")
    }
}

/// Desktop `Note` (bot-profile cards.tsx): a lock and why this viewer may
/// not change the setting, in place of the setting itself.
struct PanelLockNote: View {
    @Environment(\.themePalette) var themePalette
    let text: LocalizedStringKey

    var body: some View {
        Label { Text(text) } icon: { Image(systemName: "lock") }
            .font(.footnote)
            .foregroundStyle(Theme.textSecondary)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .accessibilityElement(children: .combine)
    }
}

/// Opens the bot's chat from a panel page: the chat is under the panel,
/// so the panel goes (desktop: settings close, the bot is selected).
private struct BotPanelOpenChatKey: EnvironmentKey {
    static let defaultValue: (() -> Void)? = nil
}

extension EnvironmentValues {
    var botPanelOpenChat: (() -> Void)? {
        get { self[BotPanelOpenChatKey.self] }
        set { self[BotPanelOpenChatKey.self] = newValue }
    }
}

/// Desktop `ModelLockLine` (bot-settings/ModelSection.tsx): why the model
/// waits for the turn, and the way out, back to the conversation.
struct ModelTurnLockLine: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.botPanelOpenChat) private var openChat
    let bot: Bot
    let lock: ModelTurnLock

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(lock.line)
                .font(.footnote)
                .foregroundStyle(Theme.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let openChat {
                Button(String(format: AppStrings.localized("Open %@'s chat"), bot.name), action: openChat)
                    .font(.footnote.weight(.medium))
                    .buttonStyle(.borderless)
                    .accessibilityIdentifier("model-lock-open-chat")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("model-lock.\(lock.rawValue)")
    }
}

extension ModelTurnLock {
    /// Desktop `botPanel.model.locked*`.
    var line: LocalizedStringKey {
        switch self {
        case .working: "This bot's conversation is working. Stop its turn to change the model."
        case .approval: "An approval is waiting for you in this bot's conversation. Answer it to change the model."
        case .admin: "An approval is waiting for an admin in this bot's conversation. The model can change once it is answered."
        }
    }
}

extension Session {
    /// Desktop `botSectionLock`: why this viewer may not change a section,
    /// or nil when they may.
    func sectionLock(_ bot: Bot, _ section: DesktopPanelSection) -> LocalizedStringKey? {
        let edits = { (field: String) in self.canEditBotField(bot, field) }
        let locked: Bool = switch section {
        case .access: !edits("computer") && !edits("cwd")
        case .worksOn: !edits("computer")
        case .memory: !edits("memoryEnabled")
        case .soul, .history: !edits("soul")
        case .permissions: !edits("chiefOfStaff") && !edits("approvalMode")
        default: false
        }
        guard locked else { return nil }
        return surfaceGate.botsReadOnly
            ? "Your administrator lets you use shared bots only."
            : "Only this bot's owner or an admin can change this."
    }
}

extension DesktopPanelSection {
    /// The one line of intro under a sub-page's title (desktop
    /// `botProfile.v6.page.<page>.intro`, #3030).
    var subpageIntro: LocalizedStringKey? {
        switch self {
        case .soul: "Its standing instructions. Write as you would talk to it."
        case .model, .worksOn: "One engine, one fallback, one place to run. Applies to the bot and all its threads."
        case .slack: "Where people talk to it and where it reaches you."
        case .sharing, .visibility: "Who can talk to it and who can set it up."
        case .access: "Accounts and connectors. One place for both."
        case .voice: "How it sounds on the phone and in voice notes."
        case .history: "Every settings change, restorable."
        case .skills: "What else it knows how to do. Each skill turns on or off."
        case .memory: "The files it keeps and what it remembers."
        default: nil
        }
    }
}

// MARK: - Overview

/// Overview (`OverviewSection.tsx`): who it is, what it does, can reach and
/// won't, recent changes, and the prompt preview (what the model sees).
struct BotOverviewPage: View {
    let bot: Bot
    @EnvironmentObject private var session: Session

    var body: some View {
        BotOverviewView(bot: bot, showsPromptPreview: session.surfaceGate.allows(.promptPreview, bot: bot))
            .navigationTitle(Text(DesktopPanelSection.overview.title))
            .navigationBarTitleDisplayMode(.inline)
            .accessibilityIdentifier("panel-page.overview")
    }
}

// MARK: - Model

/// Model (`ModelSection.tsx`): provider, model, variant or effort. An admin
/// and the bot's owner on an organization server pick it (`modelSelection`
/// is a member field, 2026-10-26); other pairings read the current model.
/// One mode (#261): a change runs the open thread and becomes the bot's
/// model; models under Cloud and Local; an organization lists only the
/// providers its admin allows.
struct BotModelSection: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    @EnvironmentObject private var session: Session

    @State private var instances: [Instance] = []
    @State private var allowedEngines: [String]?
    @State private var loaded = false
    @State private var instanceID: String
    @State private var modelID: String
    @State private var effort: String?
    @State private var variant: String?
    @State private var saved: ModelSelection
    @State private var busy = false
    /// Auto (#153): the best model per task, picked by the server.
    @State private var auto: Bool

    init(bot: Bot) {
        self.bot = bot
        let selection = bot.currentTaskModelSelection
        _instanceID = State(initialValue: selection.instanceId)
        _modelID = State(initialValue: selection.model)
        _effort = State(initialValue: selection.effort)
        _variant = State(initialValue: selection.variant)
        _saved = State(initialValue: selection)
        _auto = State(initialValue: selection.auto == true)
    }

    private var current: Bot { session.state.bot(bot.id)?.projected(forThread: bot.threadId) ?? bot }
    private var instance: Instance? { instances.first { $0.instanceId == instanceID } }
    private var organization: Bool { session.surfaceGate.allows(.people) }
    private var available: [Instance] {
        instances.filter { $0.snapshot.isAvailable && (!organization || ModelPickerRules.engineAllowed(allowedEngines, $0.instanceId)) }
    }
    /// The open thread follows the bot's model (nil: an older server).
    private var follows: Bool? { current.tasks?.first { $0.threadId == bot.threadId }?.followsBotModel }
    private var profile: Bot { session.state.bot(bot.id) ?? bot }
    /// An admin, the owner's sidecar, or the bot's owner on an organization
    /// server (`modelSelection` is a member field).
    private var canPick: Bool { session.canAdminister || session.canEditBotField(profile, "modelSelection") }
    private var instanceChoices: [Instance] {
        guard let saved = instances.first(where: { $0.instanceId == self.saved.instanceId }), !saved.snapshot.isAvailable else { return available }
        return [saved] + available
    }
    /// The menu row's value: the provider's model name, Auto when on.
    private var modelLabel: String {
        let name = instance?.models.options.first { $0.id == modelID }?.label ?? (modelID.isEmpty ? String(localized: "Default") : modelID)
        return auto ? String(localized: "Auto · \(name)") : name
    }
    private var usesVariants: Bool { instance?.capabilities?.modelVariants == true }
    private var variantOptions: [ModelVariantOption]? {
        ModelVariantRules.options(for: ModelSelection(instanceId: instanceID, model: modelID, variant: variant), instances: instances)
    }
    private var levels: [String] {
        guard !usesVariants else { return [] }
        return ModelEffort.pickerLevels(modelOption, engine: instance?.capabilities?.effortLevels ?? [])
    }
    private var modelOption: ModelOption? { instance?.models.options.first { $0.id == modelID } }
    private var draft: ModelSelection {
        var next = usesVariants
            ? ModelSelection(instanceId: instanceID, model: modelID, variant: variant)
            : ModelSelection(instanceId: instanceID, model: modelID, effort: effort)
        if auto { next.auto = true }
        return next
    }
    private var canApply: Bool {
        guard loaded, current.busy != true, let instance, instance.snapshot.isAvailable else { return false }
        let offered = modelID == instance.models.default || instance.models.options.contains { $0.id == modelID }
        return offered && (effort.map { ModelEffort.forModel($0, option: modelOption, engine: instance.capabilities?.effortLevels ?? []) != nil } ?? true) && draft != saved
    }

    var body: some View {
        Section {
            if !canPick {
                let model = saved.model.isEmpty ? String(localized: "Default") : saved.model
                LabeledContent(String(localized: "Model"), value: saved.auto == true ? String(localized: "Auto · \(model)") : model)
            } else if !loaded {
                HStack { Text("Loading models"); Spacer(); ProgressView() }
            } else if instanceChoices.isEmpty {
                Label("No model providers are available", systemImage: "exclamationmark.triangle").foregroundStyle(Theme.textSecondary)
            } else {
                // #153: Auto first, as the desktop picker's first row
                Toggle(isOn: Binding(get: { auto }, set: { on in
                    auto = on
                    apply()
                })) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(String(localized: "Auto"))
                        Text(String(localized: "The best model per task: the strongest one you can pay for its own turns, the right tier for the work it hands out."))
                            .font(.footnote)
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
                .tint(Theme.toggleOn)
                .disabled(current.busy == true)
                .accessibilityIdentifier("model-auto")
                // The model menu (#477, #478, #518): providers in submenus,
                // favorites, only the models that run.
                NavigationLink {
                    ModelMenuSheet(bot: current)
                        .onDisappear(perform: syncFromServer)
                } label: {
                    HStack {
                        Text("Model").foregroundStyle(Theme.textPrimary)
                        Spacer()
                        Text(verbatim: modelLabel).foregroundStyle(Theme.textSecondary).lineLimit(1)
                    }
                    .contentShape(Rectangle())
                }
                .disabled(current.busy == true)
                .accessibilityIdentifier("model-menu-open")
                if let variantOptions {
                    ModelVariantPicker(options: variantOptions, saved: saved.variant, variant: $variant)
                        .onValueChange(of: variant) { _ in apply() }
                }
                if !levels.isEmpty {
                    Picker("Reasoning effort", selection: $effort) {
                        Text("Default").tag(String?.none)
                        ForEach(levels, id: \.self) { Text(BotPanelModel.effortLabel($0)).tag(Optional($0)) }
                    }
                    .onValueChange(of: effort) { _ in apply() }
                }
                if follows == false {
                    // "Use <bot>'s model": the thread back on the bot's (#261)
                    Button(String(localized: "Use \(profile.name)'s model")) {
                        busy = true
                        Task {
                            defer { busy = false }
                            if let updated = await session.updateModel(profile.modelSelection, for: current, updateBotDefault: true) {
                                saved = updated.projected(forThread: bot.threadId)?.currentTaskModelSelection ?? profile.modelSelection
                                instanceID = saved.instanceId
                                modelID = saved.model
                                effort = saved.effort
                                variant = saved.variant
                            }
                        }
                    }
                    .disabled(current.busy == true)
                    .accessibilityIdentifier("model-follow-bot")
                }
            }
            // why the model waits, under the picker (desktop ModelLockLine)
            if let lock = ModelTurnLock.of(current) {
                ModelTurnLockLine(bot: current, lock: lock)
            }
        }
        .overlay { if busy { ProgressView() } }
        .task {
            instances = canPick ? await session.modelInstances() : []
            allowedEngines = await session.configStatus()?.allowedEngines
            loaded = true
        }
    }

    /// After the menu: the choice it saved.
    private func syncFromServer() {
        let next = current.currentTaskModelSelection
        saved = next
        instanceID = next.instanceId
        modelID = next.model
        effort = next.effort
        variant = next.variant
        auto = next.auto == true
    }

    /// Saved as soon as the choice is complete, as the desktop's picker does.
    private func apply() {
        guard canApply else { return }
        let next = draft
        busy = true
        Task {
            defer { busy = false }
            // one mode (#261): the thread and the bot's model in one request
            if let updated = await session.updateModel(next, for: current, updateBotDefault: true) {
                saved = updated.projected(forThread: bot.threadId)?.currentTaskModelSelection ?? next
            }
        }
    }
}

// MARK: - Permissions

/// Permissions (`PermissionsSection.tsx`): Chief of Staff, ask before
/// contacting other bots, the approval level, and the command allowlist.
/// An admin session and the bot's owner on an organization server change
/// them (each switch asks for its own field, 2026-10-26); other pairings
/// read them.
struct BotPermissionsSection: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    /// A sub-page (When it acts alone, Advanced settings) shows its rows only.
    var part: BotPermissionsPart = .all
    @EnvironmentObject private var session: Session
    @State private var confirmingFull = false
    @State private var viewerId = "local-owner"
    @State private var maxThreads: Int?
    @State private var hooks: BotLifecycleHooks?
    @State private var engineKind: String?
    @State private var grokConnectors: Bool?
    /// #3465: « Ce que ce bot suit pour toi »
    @StateObject private var follows = ProactiveReceiveModel()

    private func shows(_ group: BotPermissionsPart) -> Bool { part == .all || part == group }

    private var current: Bot { session.state.bot(bot.id) ?? bot }
    private var canEdit: Bool { session.surfaceGate.allows(.botAccessEdit, bot: current) }
    private func edits(_ field: String) -> Bool { canEdit && session.canEditBotField(current, field) }
    private var level: ApprovalLevel { ApprovalLevel.of(approvalMode: current.approvalSettingMode, autoApprove: current.autoApprove) }
    private var sectionName: String {
        let name = current.section?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return name.isEmpty ? String(localized: "Unassigned") : name
    }
    /// A client session reads and removes command rules only for its own bot.
    private var showsAllowlist: Bool {
        let gate = session.surfaceGate
        guard gate.allows(.commandAllowlist) else { return false }
        return gate.scope != .serverClient || PrimaryBotRules.viewerOwns(current, viewerId: viewerId)
    }

    var body: some View {
        if let intro = part.intro {
            Section { Text(intro).font(.footnote).foregroundStyle(Theme.textSecondary) }
        }
        if shows(.advanced) { primaryAndPeers }
        if shows(.beforeActing) { approvalSection }
        if shows(.actsAlone) { actsAloneSections }
        if shows(.advanced) { advancedSections }
        if shows(.advanced) { extraAdvancedSections }
        if !canEdit {
            Section {
                Text("These are changed by an administrator, or in Sagax on your computer.")
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("permissions-read-only")
            }
        }
    }

    @ViewBuilder
    private var primaryAndPeers: some View {
        Section {
            Toggle(isOn: Binding(get: { current.chiefOfStaff == true }, set: { on in send(BotPanelPatch(chiefOfStaff: on)) })) {
                Label("Chief of Staff", systemImage: "crown")
            }
            .tint(Theme.toggleOn)
            .disabled(!edits("chiefOfStaff"))
            .accessibilityIdentifier("permissions-chief")
        } footer: {
            Text(current.chiefOfStaff == true
                 ? "This is the primary contact for \(sectionName). It can create and coordinate specialists in this team, then combine their work into one answer."
                 : "Make this bot the primary contact for the \(sectionName) team.")
        }
        Section {
            Toggle("Ask me before contacting other bots", isOn: Binding(get: { current.approvePeerComms == true }, set: { on in
                send(BotPanelPatch(approvePeerComms: on))
            }))
            .tint(Theme.toggleOn)
            .disabled(!edits("approvePeerComms"))
            .accessibilityIdentifier("permissions-peers")
        } footer: {
            Text(current.approvePeerComms == true
                 ? "This bot will stop and ask before it reaches out to another bot."
                 : "Let this bot talk to teammates on its own, without a confirmation step.")
        }
        // the engine decides whether the Grok account connectors switch shows
        .task(id: current.modelSelection.instanceId) {
            let instances = await DesktopModelCatalog.shared.instances(session)
            engineKind = instances.first { $0.instanceId == current.modelSelection.instanceId }?.driverKind
        }
    }

    @ViewBuilder
    private var approvalSection: some View {
        Section {
            Picker("Approval level", selection: Binding(get: { level }, set: { pick($0) })) {
                ForEach([ApprovalLevel.ask, .edits, .auto, .full], id: \.self) { option in
                    Label { Text(DesktopApprovalButton.label(option)) } icon: { Image(systemName: DesktopApprovalButton.icon(option)) }
                        .tag(option)
                }
                if level == .custom { Text(verbatim: level.rawValue.capitalized).tag(ApprovalLevel.custom) }
            }
            .disabled(!edits("approvalMode") || current.busy == true)
            .accessibilityIdentifier("permissions-approval")
            if showsAllowlist {
                NavigationLink {
                    CommandAllowlistPage(bot: current)
                } label: {
                    Label("Command allowlist", systemImage: "terminal")
                }
                .accessibilityIdentifier("permissions-allowlist")
            }
            NavigationLink {
                ApprovalGrantsPage(botId: current.id)
            } label: {
                Label("Approval rules", systemImage: "checkmark.shield")
            }
            .accessibilityIdentifier("permissions-approval-grants")
            // Only a team bot (shared with someone) has a shared vault.
            if canEdit, !(current.directGrants ?? []).isEmpty {
                NavigationLink {
                    TeamBotVaultListView(botId: current.id, botName: current.name)
                } label: {
                    Label("Shared vault", systemImage: "key.fill")
                }
                .accessibilityIdentifier("permissions-team-vault")
            }
        } footer: {
            VStack(alignment: .leading, spacing: 6) {
                Text(DesktopApprovalButton.detail(level))
                AppliedLevelNote(bot: current)
                Text("Applies to every thread of this bot at once: routines, delegated work and work another bot or an AI client sends here. A thread keeps its own level only when you chose one in it.")
            }
        }
        .task(id: bot.id) { viewerId = PrimaryBotRules.viewerId(config: await session.configStatus()) }
        .alert("Give this bot Full access?", isPresented: $confirmingFull) {
            Button("Cancel", role: .cancel) {}
            Button("Full access", role: .destructive) { send(.approval(.full)) }
        } message: {
            Text("It runs commands and edits files without asking, in every thread. Use only with bots you trust.")
        }
    }

    @ViewBuilder
    private var actsAloneSections: some View {
        // 2026-10-30: Proactive, as on the desktop (PermissionsSection.tsx)
        Section {
            Picker("Proactive", selection: Binding(get: { ProactiveMode.of(current.proactiveMode) }, set: { mode in
                guard mode != ProactiveMode.of(current.proactiveMode) else { return }
                send(BotPanelPatch(proactiveMode: mode.rawValue))
            })) {
                ForEach(ProactiveMode.allCases, id: \.self) { mode in
                    Text(mode.label).tag(mode)
                }
            }
            .disabled(!edits("proactiveMode"))
            .accessibilityIdentifier("permissions-proactive")
            .task(id: bot.id) { await follows.load(session) }
        } footer: {
            VStack(alignment: .leading, spacing: 6) {
                Text(ProactiveMode.of(current.proactiveMode).hint)
                Text("How this bot acts on its own on an email, a calendar entry, a failed run, another bot's post or a webhook.")
            }
        }
        // #3465: « Ce que ce bot suit pour toi », beside Proactive
        BotFollowsSection(bot: current, model: follows)
        // PermissionsSection.tsx: Allowed recipients, beside Proactive
        if edits("allowedRecipients") {
            let count = (current.allowedRecipients ?? []).count
            Section {
                NavigationLink {
                    ApprovalGrantsPage(botId: current.id, recipientsOnly: true)
                } label: {
                    LabeledContent {
                        Text(count == 0 ? String(localized: "No one yet") : count == 1 ? String(localized: "1 recipient") : String(localized: "\(count) recipients"))
                    } label: {
                        Label("Allowed recipients", systemImage: "person.crop.circle.badge.checkmark")
                    }
                }
                .accessibilityIdentifier("permissions-allowed-recipients")
            } footer: {
                Text("People and bots it writes to without an approval card.")
            }
        }
        // #2048: remembered publish target (page / artifact surface).
        if edits("pageTargetDefault") {
            Section {
                Picker("Publish target", selection: Binding(get: { current.pageTargetDefault ?? "" }, set: { value in
                    guard value != (current.pageTargetDefault ?? "") else { return }
                    send(BotPanelPatch(pageTargetDefault: value.isEmpty ? "" : value))
                })) {
                    ForEach(PageTargetDefaultChoice.all, id: \.id) { choice in
                        Text(choice.label).tag(choice.id)
                    }
                }
                .disabled(current.busy == true)
                .accessibilityIdentifier("permissions-page-target")
            } footer: {
                Text(PageTargetDefaultChoice.summary(for: current.pageTargetDefault))
            }
        }
        if edits("emailDrafts") {
            let on = current.emailDrafts ?? true
            Section {
                Toggle("Email drafts", isOn: Binding(get: { on }, set: { next in field("emailDrafts", .bool(next)) }))
                    .tint(Theme.toggleOn)
                    .accessibilityIdentifier("permissions-email-drafts")
            } footer: {
                Text("When off, this bot does not write email draft cards.")
            }
        }
        if edits("memeReplies") {
            let auto = current.memeReplies != "off"
            Section {
                Picker("Meme replies", selection: Binding(get: { auto ? "auto" : "off" }, set: { next in
                    guard next != (auto ? "auto" : "off") else { return }
                    field("memeReplies", .string(next))
                })) {
                    Text("Auto").tag("auto")
                    Text("Off").tag("off")
                }
                .accessibilityIdentifier("permissions-meme-replies")
            } footer: {
                VStack(alignment: .leading, spacing: 6) {
                    Text(auto ? "The bot decides from the person's style." : "Meme replies are off for this bot.")
                    Text("When Auto, this bot may post a fitting reaction meme from the person's style. Off hides the tool. Never in serious or work contexts.")
                }
            }
        }
    }

    @ViewBuilder
    private var advancedSections: some View {
        if edits("maxConcurrentThreads") {
            let threads = maxThreads ?? current.maxConcurrentThreads ?? 3
            Section {
                Picker("Maximum running conversations for this bot", selection: Binding(get: { threads }, set: { value in
                    guard value != threads, let client = session.settingsClient else { return }
                    let botId = current.id
                    Task { if (try? await client.setBotMaxConcurrentThreads(botId: botId, value)) != nil { maxThreads = value } }
                })) {
                    ForEach(1...16, id: \.self) { value in Text(verbatim: String(value)).tag(value) }
                }
                .disabled(current.busy == true)
                .accessibilityIdentifier("permissions-parallel-threads")
            } header: {
                Text("Parallel conversations")
            } footer: {
                Text("Applies to this bot's 1:1 conversations. Extra messages wait for a free place. Delegated work and conversations waiting for an approval take a place too. Lowering the limit does not stop work in progress.")
            }
            .task(id: bot.id) {
                if current.maxConcurrentThreads == nil {
                    maxThreads = (try? await session.settingsClient?.botRuntimeSettings(botId: bot.id))?.maxConcurrentThreads
                }
            }
        }
        if edits("loopGuard") {
            let on = current.loopGuard ?? true
            Section {
                Toggle("Loop guard", isOn: Binding(get: { on }, set: { next in field("loopGuard", .bool(next)) }))
                    .tint(Theme.toggleOn)
                    .accessibilityIdentifier("permissions-loop-guard")
            } footer: {
                Text("When off, this bot is not steered or stopped for a repeating shell failure.")
            }
        }
    }

    /// Lifecycle hooks, Grok account connectors and Tool access
    /// (`PermissionsSection.tsx`: LifecycleHooksRow, the Grok switch,
    /// BotToolAccess), each shown only where the desktop shows it.
    @ViewBuilder
    private var extraAdvancedSections: some View {
        if edits("grokAccountConnectors"), engineKind == "grokAgent", current.toolScope == nil {
            let on = grokConnectors ?? current.grokAccountConnectors ?? false
            Section {
                Toggle("Grok account connectors", isOn: Binding(get: { on }, set: { next in
                    let target = current
                    Task { if await PersonaBotFields.patch(["grokAccountConnectors": .bool(next)], bot: target, session: session) { grokConnectors = next } }
                }))
                .tint(Theme.toggleOn)
                .accessibilityIdentifier("permissions-grok-connectors")
            } footer: {
                VStack(alignment: .leading, spacing: 6) {
                    if on { Text("This bot loads your grok.com connectors on your own Grok sign-in.") }
                    Text("When on, this bot also loads the connectors of your own grok.com account. A write through them asks first, unless an Always allow rule covers it or the bot is on Full access.")
                }
            }
        }
        if edits("allowedRecipients") {
            Section {
                Toggle("Lifecycle hooks", isOn: Binding(get: { hooks?.enabled ?? false }, set: { next in
                    guard let client = session.settingsClient else { return }
                    let botId = current.id
                    Task { if let saved = try? await client.setBotLifecycleHooks(botId: botId, enabled: next) { hooks = saved } }
                }))
                .tint(Theme.toggleOn)
                .disabled(hooks == nil)
                .accessibilityIdentifier("permissions-lifecycle-hooks")
                if let events = hooks?.events, !events.isEmpty {
                    Text(verbatim: events.joined(separator: ", "))
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                }
            } footer: {
                VStack(alignment: .leading, spacing: 6) {
                    if hooks?.events.isEmpty ?? true { Text("No plugin hooks installed.") }
                    Text("Plugin hooks run on the bot's computer (sandbox, VM or PC), never on the server. They stay off until you turn them on.")
                }
            }
            .task(id: bot.id) { hooks = try? await session.settingsClient?.botLifecycleHooks(botId: bot.id) }
        }
        if edits("toolScope") {
            MyToolAccessSections(botId: current.id)
        }
    }

    private func field(_ name: String, _ value: BulkValue) {
        let target = current
        Task { _ = await PersonaBotFields.patch([name: value], bot: target, session: session) }
    }

    private func pick(_ option: ApprovalLevel) {
        guard option != level, current.busy != true else { return }
        if option == .full { confirmingFull = true; return }
        send(.approval(option))
    }

    private func send(_ patch: BotPanelPatch) {
        let target = current
        Task { _ = await sendPanelPatch(patch, bot: target, session: session) }
    }
}

// MARK: - Works on

/// Where the bot works (`AccessSection.tsx` Works on): Access holds it, or
/// its own Computer item on an organization server.
struct BotWorksOnSection: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    /// The Model page shows the lock note in the Workspace card; the Works on
    /// page already says it above.
    var notesLock = false
    @EnvironmentObject private var session: Session
    @State private var config: ConfigStatus?

    private var current: Bot { session.state.bot(bot.id) ?? bot }
    private var canEdit: Bool { session.surfaceGate.allows(.botAccessEdit, bot: current) && session.canEditBotField(current, "computer") }
    private var organization: Bool { session.surfaceGate.organization }
    /// Auto, this computer and the cloud computer; never Off.
    private var choices: [DesktopWorksOn] { DesktopWorksOnRules.choices(config: config, organization: organization) }
    /// A place an older build saved reads as Auto (the server moves it back
    /// to Auto at start).
    private var selected: DesktopWorksOn { DesktopWorksOnRules.selected(DesktopWorksOn.of(current)) }

    var body: some View {
        if let lock = session.sectionLock(current, .worksOn) {
            // desktop: the Workspace card holds only the note (botSectionLock);
            // on its own page the page's note says it
            if notesLock {
                Section { PanelLockNote(text: lock) } header: { Text("Workspace") }
                    .accessibilityIdentifier("panel-page.worksOn.locked")
            }
        } else {
            picker
        }
    }

    private var picker: some View {
        Section {
            Picker("Works on", selection: Binding(get: { selected }, set: { next in
                guard next != selected else { return }
                let target = current
                Task { _ = await sendPanelPatch(BotPanelPatch(computer: next.stored), bot: target, session: session) }
            })) {
                ForEach(choices, id: \.self) { place in
                    Text(Self.name(place)).tag(place)
                }
            }
            .disabled(!canEdit || current.busy == true)
            .accessibilityIdentifier("access-works-on")
        } header: {
            Text("Workspace")
        } footer: {
            Text("The bot picks where each task runs: the cloud, a Local VM, this computer or the browser, among the places available to it and allowed. Off gives it no computer and no browser.")
        }
        .task { config = await session.configStatus() }
    }

    static func name(_ place: DesktopWorksOn) -> String {
        switch place {
        case .auto: String(localized: "Auto")
        case .cloud: String(localized: "Cloud")
        case .vm: String(localized: "Local VM")
        case .local: String(localized: "This computer")
        case .browser: String(localized: "Browser")
        case .off: String(localized: "Off")
        }
    }
}

// MARK: - Voice & alerts

/// Voice options (`VoiceSection.tsx` with `VoiceSettings`): the engine,
/// the agent's voice, read replies aloud and voice notes. Notifications
/// stay on the bot profile only (lot 3); pass `showsNotifications` when a
/// legacy desktop surface still wants the toggle here.
struct BotVoiceSections: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    /// When false (Edit bot More voice options), Notifications is omitted.
    var showsNotifications: Bool = true
    @EnvironmentObject private var session: Session

    @State private var voices: [Voice] = []
    @State private var config: ConfigStatus?
    @State private var engine: VoiceProvider = .elevenlabs
    @State private var hostIsMac = false
    @State private var chatterboxURL = ""
    @State private var chatterboxModel = ""
    @State private var switching = false
    @State private var savingServer = false
    @State private var serverProblem: String?
    @State private var previewing = false
    @State private var player: AVAudioPlayer?

    private var current: Bot { session.state.bot(bot.id) ?? bot }
    private var voice: String { current.voice ?? "" }
    private var canSetEngine: Bool { session.surfaceGate.allows(.voiceEngineSettings) }
    private var configured: Bool { config?.isTTSConfigured == true }
    private var canSpeak: Bool { config?.canSpeak(agentVoice: voice) == true }

    var body: some View {
        Group {
            Section {
                if canSetEngine {
                    Picker("Voice engine", selection: $engine) {
                        Text("ElevenLabs").tag(VoiceProvider.elevenlabs)
                        Text("Fish Audio").tag(VoiceProvider.fish)
                        Text("Built-in Mac voices").tag(VoiceProvider.system).disabled(!hostIsMac)
                        Text("Chatterbox (local)").tag(VoiceProvider.chatterbox)
                    }
                    .disabled(switching)
                    if config?.voiceProvider == .chatterbox {
                        TextField("Chatterbox server address", text: $chatterboxURL, prompt: Text(verbatim: "http://127.0.0.1:4123"))
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        TextField("Chatterbox model", text: $chatterboxModel, prompt: Text(verbatim: "chatterbox-turbo"))
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        Button { Task { await saveServer() } } label: {
                            HStack { Text("Save server"); if savingServer { Spacer(); ProgressView() } }
                        }
                        .disabled(savingServer || chatterboxURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        if let serverProblem {
                            Label(serverProblem, systemImage: "exclamationmark.triangle").foregroundStyle(Theme.warning)
                        }
                    }
                }
                if configured {
                    Picker("Spoken replies voice", selection: Binding(get: { voice }, set: { save(voice: $0) })) {
                        if config?.hasWorkspaceDefaultVoice == true {
                            Text("Workspace default").tag("")
                        } else {
                            Text("Choose an agent voice").tag("").disabled(true)
                        }
                        if !voice.isEmpty, !voices.contains(where: { $0.id == voice }) {
                            Text("Current agent voice").tag(voice)
                        }
                        ForEach(voices) { option in Text(option.label).tag(option.id) }
                    }
                    .accessibilityIdentifier("voice-picker")
                    Button("Preview voice", systemImage: "speaker.wave.2") { Task { await preview() } }
                        .disabled(previewing || !canSpeak)
                } else {
                    Label(String(localized: "Add it in Sagax on your computer."), systemImage: "speaker.slash")
                        .foregroundStyle(Theme.textSecondary)
                }
                Toggle("Read replies aloud", isOn: Binding(get: { current.speakReplies == true }, set: { on in
                    var patch = BotProfilePatch()
                    patch.speakReplies = on
                    update(patch)
                }))
                .tint(Theme.toggleOn)
                .disabled(!canSpeak && current.speakReplies != true)
                .accessibilityIdentifier("voice-speak-replies")
            } header: {
                Text("Voice")
            } footer: {
                Text("Give this agent a voice for calls and spoken replies. The voice choice belongs to this agent; provider keys stay on your computer and never come to this device.")
            }
            if session.surfaceGate.allows(.voiceNotesSetting, bot: current) {
                BotVoiceNotesSection(bot: current)
            }
            if showsNotifications {
                Section {
                    Toggle("Notifications", isOn: Binding(get: { current.notifications }, set: { on in
                        var patch = BotProfilePatch()
                        patch.notifications = on
                        update(patch)
                    }))
                    .tint(Theme.toggleOn)
                    .accessibilityIdentifier("profile-notifications")
                } footer: {
                    Text("Get notified when this Bot finishes or needs input")
                }
            }
        }
        .task {
            async let status = session.configStatus()
            async let options = session.voiceOptions(quiet: true)
            async let environment = session.serverEnvironment()
            let loaded = await status
            config = loaded
            engine = loaded?.voiceProvider ?? .elevenlabs
            chatterboxURL = loaded?.tts?.baseUrl ?? ""
            chatterboxModel = loaded?.tts?.model ?? ""
            voices = await options
            hostIsMac = (await environment)?.platform == "darwin"
        }
        .onValueChange(of: engine) { selected in Task { await switchEngine(selected) } }
    }

    private func update(_ patch: BotProfilePatch) {
        let target = current
        Task { _ = await session.updateProfile(patch, for: target) }
    }

    private func save(voice next: String) {
        var patch = BotProfilePatch()
        patch.voice = next
        // a voice that cannot speak cannot read replies aloud
        if config?.canSpeak(agentVoice: next) != true, current.speakReplies == true { patch.speakReplies = false }
        update(patch)
    }

    private func switchEngine(_ selected: VoiceProvider) async {
        guard canSetEngine, selected != (config?.voiceProvider ?? .elevenlabs) else { return }
        switching = true
        defer { switching = false }
        if let status = await session.setVoiceProvider(selected) {
            let reset = AgentProfileVoiceState(voice: voice, speakReplies: current.speakReplies == true, baselineVoice: voice)
                .afterProviderSwitch(to: status)
            config = status
            engine = status.voiceProvider
            voices = []
            voices = await session.voiceOptions(quiet: true)
            if reset.voice != voice || reset.speakReplies != (current.speakReplies == true) {
                var patch = BotProfilePatch()
                patch.voice = reset.voice
                patch.speakReplies = reset.speakReplies
                update(patch)
            }
        } else {
            engine = config?.voiceProvider ?? .elevenlabs
        }
    }

    private func saveServer() async {
        let address = chatterboxURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard address.hasPrefix("http://") || address.hasPrefix("https://") else {
            serverProblem = String(localized: "The server address must start with http:// or https://.")
            return
        }
        serverProblem = nil
        savingServer = true
        defer { savingServer = false }
        if let status = await session.saveChatterboxServer(baseURL: address, model: chatterboxModel.trimmingCharacters(in: .whitespacesAndNewlines)) {
            config = status
            voices = await session.voiceOptions(quiet: true)
        }
    }

    private func preview() async {
        previewing = true
        defer { previewing = false }
        guard let data = await session.previewVoice(voice, for: current) else { return }
        do {
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.playback, mode: .spokenAudio)
            try audio.setActive(true)
            let next = try AVAudioPlayer(data: data)
            guard next.prepareToPlay(), next.play() else {
                session.actionError = String(localized: "The generated audio could not be played.")
                return
            }
            player = next
        } catch {
            player = nil
            session.actionError = String(localized: "The generated audio could not be played.")
        }
    }
}

// MARK: - Permissions sub-page

/// A Permissions sub-page pushed from the More rows (When it acts alone,
/// Advanced settings), as the desktop's PERMISSIONS_PARTS.
struct BotPermissionsPartPage: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    let part: BotPermissionsPart

    var body: some View {
        ThemedForm { BotPermissionsSection(bot: bot, part: part) }
            .navigationTitle(Text(part.title))
            .navigationBarTitleDisplayMode(.inline)
            .accessibilityIdentifier("panel-page.permissions.\(part.rawValue)")
    }
}

// MARK: - Page for a section

/// The page a More row pushes.
struct BotPanelSectionPage: View {
    let section: DesktopPanelSection
    let bot: Bot
    /// Works on has its own item (an organization server): Access leaves it out.
    let worksOnListed: Bool
    let slackURL: URL?

    var body: some View {
        switch section {
        case .overview: AnyView(BotOverviewPage(bot: bot))
        case .slack:
            AnyView(BotPanelFormPage(section: section, bot: bot) { if let slackURL { BotSlackSection(url: slackURL) } })
        case .soul: AnyView(InstructionView(bot: bot, personality: true))
        case .skills: AnyView(BotSkillsPage(bot: bot))
        case .memory: AnyView(BotMemoryPage(bot: bot))
        case .access:
            // Accounts is Access only; Works on lives on the Model page (#3030).
            AnyView(BotPanelFormPage(section: section, bot: bot) { BotAccessSection(bot: bot) })
        case .worksOn: AnyView(BotPanelFormPage(section: section, bot: bot) { BotWorksOnSection(bot: bot) })
        case .model:
            // Model and Works on on one page (desktop `model: ["model", "worksOn"]`)
            AnyView(BotPanelFormPage(section: section, bot: bot) {
                BotModelSection(bot: bot)
                BotWorksOnSection(bot: bot, notesLock: true)
                BotPayerSection(bot: bot)
            })
        case .permissions: AnyView(BotPanelFormPage(section: section, bot: bot) { BotPermissionsSection(bot: bot) })
        case .voice: AnyView(BotPanelFormPage(section: section, bot: bot) { BotVoiceSections(bot: bot) })
        case .visibility: AnyView(BotVisibilityPage(bot: bot))
        case .sharing: AnyView(BotSharingPage(bot: bot))
        case .history: AnyView(BotHistoryPage(bot: bot))
        case .usage: AnyView(BotPanelFormPage(section: section, bot: bot) { BotUsageSection(bot: bot) })
        }
    }
}
