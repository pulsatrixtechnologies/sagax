// Edit bot > Model, Permissions, Voice (iPad, round 4 of the parity sweep):
// bot-settings/ModelSection.tsx, PermissionsSection.tsx, VoiceSection.tsx,
// drawn with the Settings primitives (SettingsGroup, DescribedRow,
// CompactRow, PillSelect, Switch) as the desktop's pages are. Every control
// saves through the route the iPad already has for it: the model and its
// effort (`updateModel`), the backups (`updateFallback`), the approval level
// and its neighbours (PATCH /api/bots/:id through `BotPanelPatch` or
// `patchBotFields`), the allowed recipients (`patchAllowedRecipients`, with
// the security key step-up), the person's rules (`approvalRules`), the
// voice choice (the synced `omb.voiceMode.v1` preference, a bot's own entry
// under `bots`) and the profile switches (`updateProfile`, `editBot`).
// The pieces live in PersonaPagesModelToolsParts.swift.
import SwiftUI
import AVFoundation
import CompanionCore

// MARK: - Model

/// Model (bot-settings/ModelSection.tsx): the "Model" group (Default model
/// and its provider mark menu, Effort), who pays, "Automatic recovery", the
/// backups while recovery is on, then "Keep prompt cache warm".
struct PersonaModelPage: View {
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    @ObservedObject private var mode = DesktopInterfaceMode.shared
    let bot: Bot
    let slackURL: URL?

    @State private var instances: [Instance] = []
    @State private var config: DesktopSettingsConfig?
    @State private var saving = false
    /// What this page last wrote: the bot frame does not carry the field yet.
    @State private var keepWarm: String?

    private var selection: ModelSelection { bot.currentTaskModelSelection }
    private var instance: Instance? { instances.first { $0.instanceId == selection.instanceId } }
    private var option: ModelOption? { instance?.models.options.first { $0.id == selection.model } }
    private var engineLevels: [String] { instance?.capabilities?.effortLevels ?? [] }
    private var levels: [String] {
        guard instance?.capabilities?.modelVariants != true else { return [] }
        return ModelEffort.pickerLevels(option, engine: engineLevels)
    }
    private var modelLabel: String {
        let id = selection.model.isEmpty ? (instance?.models.default ?? "") : selection.model
        return instance?.models.options.first { $0.id == id }?.label ?? id
    }
    private var recoveryOn: Bool { config?.automaticRecovery?.enabled == true }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            DesktopSettingsGroup(Text("Model"), identifier: "botModel") {
                AnyView(defaultModelRow)
                if mode.advanced, !levels.isEmpty {
                    AnyView(effortRow)
                }
            }
            // #1137: who pays for this bot's replies (organization server)
            if BotPayerModel(bot: bot, session: session).visible {
                DesktopSettingsGroup(Text("Who pays for replies"), identifier: "botPayer") {
                    BotPayerPicker(bot: bot)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                }
            }
            if mode.advanced, session.canEditBotField(bot, "automaticRecovery") {
                PersonaRecoveryGroup(bot: bot, instances: instances, workspace: config?.automaticRecovery?.enabled)
            }
            if mode.advanced, recoveryOn, session.surfaceGate.allows(.botFallback, bot: bot) {
                PersonaFallbackGroup(bot: bot, instances: instances)
            }
            AnyView(keepWarmCard)
        }
        .task(id: bot.id) {
            instances = await DesktopModelCatalog.shared.instances(session)
            config = try? await session.settingsClient?.desktopSettingsConfig()
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("persona-page.model")
    }

    private var defaultModelRow: some View {
        let busy = bot.currentTaskBusy == true
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 20) {
                DesktopText(Text("Default model"))
                    .frame(maxWidth: .infinity, alignment: .leading)
                Button { model.modelPickerOpen = true } label: {
                    HStack(spacing: 6) {
                        if let instance { ProviderMarkView(instance: instance, size: 13) }
                        Text(verbatim: modelLabel.isEmpty ? AppStrings.localized("Choose a model") : modelLabel)
                            .font(theme.font(13))
                            .foregroundStyle(theme.ink)
                            .lineLimit(1)
                        DesktopSettingsIconView(icon: .chevronDown, size: 13)
                            .foregroundStyle(theme.inkSecondary)
                    }
                    .padding(.horizontal, 10)
                    .frame(height: 28)
                    .background(theme.control.opacity(0.6), in: Capsule())
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .disabled(busy)
                .opacity(busy ? 0.5 : 1)
                .accessibilityLabel(Text("Default model"))
                .accessibilityValue(Text(verbatim: modelLabel))
                .accessibilityIdentifier("persona-model.default")
            }
            .frame(minHeight: 28)
            if busy {
                DesktopText(bot.activity == "waiting-on-you"
                            ? Text("An approval is waiting for you in this bot's conversation. Answer it to change the model.")
                            : Text("This bot's conversation is working. Stop its turn to change the model."),
                            size: 12, line: 16, color: \.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 8)
                    .accessibilityIdentifier("persona-model.lock")
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    @Environment(\.desktopTheme) private var theme

    private var effortRow: some View {
        let current = selection.effort.flatMap { levels.contains($0) ? $0 : nil } ?? ""
        let modelDefault = ModelEffort.defaultLevel(option, engine: engineLevels)
        let defaultLabel = modelDefault.map { String(format: AppStrings.localized("Default (%@)"), UltracodeEffort.label($0)) }
            ?? AppStrings.localized("Default")
        let help = AppStrings.localized("How hard it thinks in groups and new threads")
            + (selection.effort == nil ? AppStrings.localized(" (Default: none sent)") : "")
        let options: [(String, String)] = [("", defaultLabel)] + levels.map { ($0, UltracodeEffort.label($0)) }
        return DesktopDescribedRow(Text("Effort"), help: Text(verbatim: help), identifier: "effort") {
            DesktopPillSelect(options: options, selection: current, label: Text("Reasoning effort"),
                              identifier: "persona-model.effort", disabled: saving || bot.currentTaskBusy == true) { value in
                Task {
                    saving = true
                    var next = selection
                    next.effort = value.isEmpty ? nil : value
                    _ = await session.updateModel(next, for: bot)
                    saving = false
                }
            }
        }
    }

    /// `KeepWarmRow`: follow Settings, or this bot's own On / Off
    /// (PATCH /api/bots/:id {cacheKeepWarm}).
    private var keepWarmCard: some View {
        let value = keepWarm ?? (bot.cacheKeepWarm.map { $0 ? "on" : "off" } ?? "follow")
        // the workspace's switch is on unless Settings turned it off
        // (cacheKeepWarmSettings); the iPad's config does not carry it yet
        let follow = String(format: AppStrings.localized("Same as Settings (%@)"), AppStrings.localized("On"))
        return HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 2) {
                DesktopText(Text("Keep prompt cache warm"), size: 15, weight: .medium, line: 22)
                DesktopText(Text("Idle Claude threads with a big context get one cache read every 50 minutes for the window set in Settings → Models."),
                            color: \.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            DesktopSelect(options: [("follow", follow), ("on", AppStrings.localized("On")), ("off", AppStrings.localized("Off"))],
                          selection: value, label: Text("Keep prompt cache warm"), identifier: "persona-model.keep-warm") { next in
                guard next != value else { return }
                let patched: BulkValue = next == "on" ? .bool(true) : next == "off" ? .bool(false) : .null
                Task {
                    if await PersonaBotFields.patch(["cacheKeepWarm": patched], bot: bot, session: session) { keepWarm = next }
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("persona-model.keep-warm-card")
    }
}

// MARK: - Permissions

/// One sub-page of Permissions (PERMISSIONS_PARTS in PermissionsSection.tsx):
/// `.all` is the whole page (its advanced rows behind the Advanced mode),
/// a part shows only its own rows, always.
enum BotPermissionsPart: String, Hashable, Sendable {
    case all, beforeActing, actsAlone, advanced

    var title: LocalizedStringKey {
        switch self {
        case .all, .beforeActing: return "Approvals"
        case .actsAlone: return "When it acts alone"
        case .advanced: return "Advanced settings"
        }
    }

    var intro: LocalizedStringKey? {
        switch self {
        case .actsAlone: return "What it may do on its own."
        case .advanced: return "For the person who builds. Everything is here, nothing was removed."
        case .all, .beforeActing: return nil
        }
    }
}

/// Permissions (bot-settings/PermissionsSection.tsx): the Primary Bot while
/// the bot holds the role, the "Approvals" group (Approval level, Proactive,
/// Ask me before contacting other bots, Allowed recipients, Email drafts,
/// Loop guard, Lifecycle hooks), "Rules", then the folded More options
/// (command allowlist, the person's approval rules, sending on your behalf).
struct PersonaPermissionsPage: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @ObservedObject private var mode = DesktopInterfaceMode.shared
    let bot: Bot
    let slackURL: URL?
    var part: BotPermissionsPart = .all

    @State private var confirmingFull = false
    @State private var confirmingLocalAuto = false
    @State private var notice: String?
    @State private var memeReplies: String?
    @State private var maxThreads: Int?
    @State private var emailDrafts: Bool?
    @State private var loopGuard: Bool?
    @State private var hooks: BotLifecycleHooks?
    @State private var moreOpen = false
    @State private var allowlist = false
    @State private var grants = false

    private var level: ApprovalLevel { ApprovalLevel.of(approvalMode: bot.approvalSettingMode, autoApprove: bot.autoApprove) }
    private var proactive: ProactiveMode { ProactiveMode.of(bot.proactiveMode) }
    private var tint: Color? { BubbleColors.user(botColor: bot.color)?.fill.color }
    private func edits(_ field: String) -> Bool { session.canEditBotField(bot, field) }
    /// Whether rows of `group` show: the whole page gates them behind the
    /// Advanced mode (`gated`), a sub-page shows its own rows only.
    private func shows(_ group: BotPermissionsPart, gated: Bool = true) -> Bool {
        part == .all ? (!gated || mode.advanced) : part == group
    }
    private var sectionName: String {
        let name = bot.section?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return name.isEmpty ? AppStrings.localized("Unassigned") : name
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            // one Primary Bot per person: shown while this bot holds the role
            if let intro = part.intro {
                DesktopText(Text(intro), size: 13, line: 18, color: \.inkSecondary)
            }
            if shows(.advanced), bot.chiefOfStaff == true {
                AnyView(BotPanelPrimaryCard(bot: bot, canEdit: edits("chiefOfStaff"), sectionName: sectionName))
            }
            DesktopSettingsGroup(Text(part.title), identifier: "approvals") {
                AnyView(approvalRows)
            }
            if shows(.beforeActing, gated: false) {
                PersonaOwnerRulesGroup(bot: bot)
            }
            if shows(.advanced) {
                AnyView(moreOptions)
            }
        }
        .alert("Give this bot Full access?", isPresented: $confirmingFull) {
            Button("Cancel", role: .cancel) {}
            Button("Full access", role: .destructive) {
                Task { _ = await sendPanelPatch(.approval(.full), bot: bot, session: session) }
            }
        } message: {
            Text("It runs commands and edits files without asking, in every thread. Use only with bots you trust.")
        }
        .alert("Allow Auto mode on this computer?", isPresented: $confirmingLocalAuto) {
            Button("Cancel", role: .cancel) {}
            Button("OK") {
                Task { _ = await PersonaBotFields.patch(["approvalMode": .string("auto"), "acknowledgeLocalAuto": .bool(true)], bot: bot, session: session) }
            }
        } message: {
            Text("Auto mode will let this bot click, type, and run tools on this computer without asking first. Destructive and sensitive actions still stop. Continue only if you are watching.")
        }
        .sheet(isPresented: $allowlist) {
            NavigationStack { CommandAllowlistPage(bot: bot) }
                .environmentObject(session)
        }
        .sheet(isPresented: $grants) {
            NavigationStack { ApprovalGrantsPage(botId: bot.id, showsDone: true) }
                .environmentObject(session)
        }
        .onChange(of: bot.id) { _ in
            emailDrafts = nil
            loopGuard = nil
            memeReplies = nil
            maxThreads = nil
            notice = nil
        }
        .task(id: bot.id) {
            hooks = try? await session.settingsClient?.botLifecycleHooks(botId: bot.id)
            if shows(.advanced), bot.maxConcurrentThreads == nil {
                maxThreads = (try? await session.settingsClient?.botRuntimeSettings(botId: bot.id))?.maxConcurrentThreads
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("persona-page.permissions")
    }

    @ViewBuilder
    private var approvalRows: some View {
        if shows(.beforeActing, gated: false), edits("approvalMode") {
            DesktopDescribedRow(Text("Approval level"),
                                help: Text("Applies to every thread of this bot at once: routines, delegated work and work another bot or an AI client sends here. A thread keeps its own level only when you chose one in it; Refresh permissions brings it back to this level."),
                                identifier: "approvalLevel") {
                PersonaApprovalPill(level: level, disabled: false) { pick($0) }
            }
            if let notice, bot.busy == true {
                DesktopText(verbatim: notice, size: 12, line: 16, color: \.danger)
                    .padding(.horizontal, 14)
                    .padding(.bottom, 8)
            }
            if bot.appliedLevelNote != nil {
                AppliedLevelNote(bot: bot)
                    .foregroundStyle(theme.ink)
                    .padding(.horizontal, 14)
                    .padding(.bottom, 8)
            }
        }
        if shows(.actsAlone), edits("approvalMode") || edits("proactiveMode") {
            DesktopDescribedRow(Text("Proactive"),
                                description: Text(verbatim: proactive.hint),
                                help: Text("Whether this bot may wake on its own on an email, a calendar entry, a failed run, a mention of the bot, or a webhook, and start work without being asked. On by default. When on, it acts at this bot's approval level and rules; before a write from a wake, a dry run is recorded on the wake, then ordinary approval runs it. The proactive layer adds no extra approval card. Your organization's Ask and Deny rules and person isolation still apply."),
                                identifier: "proactiveMode") {
                PanelSwitch(label: "Proactive", isOn: proactive == .proactive,
                            disabled: bot.busy == true || !edits("proactiveMode"), onColor: tint) { on in
                    Task { _ = await sendPanelPatch(BotPanelPatch(proactiveMode: (on ? ProactiveMode.proactive : .off).rawValue), bot: bot, session: session) }
                }
                .accessibilityIdentifier("persona-permissions.proactive")
            }
            // #2048: remembered publish target (page / artifact surface).
            if edits("pageTargetDefault") {
                DesktopDescribedRow(
                    Text("Publish target"),
                    description: Text(PageTargetDefaultChoice.summary(for: bot.pageTargetDefault)),
                    help: Text("When this bot is asked to create a page or an artifact and more than one surface is available, which one to use. Ask each time shows a choice card."),
                    identifier: "pageTargetDefault"
                ) {
                    Menu {
                        ForEach(PageTargetDefaultChoice.all, id: \.id) { choice in
                            Button {
                                let current = bot.pageTargetDefault ?? ""
                                guard choice.id != current else { return }
                                Task {
                                    _ = await sendPanelPatch(
                                        BotPanelPatch(pageTargetDefault: choice.id.isEmpty ? "" : choice.id),
                                        bot: bot, session: session
                                    )
                                }
                            } label: {
                                if (bot.pageTargetDefault ?? "") == choice.id {
                                    Label(choice.label, systemImage: "checkmark")
                                } else {
                                    Text(choice.label)
                                }
                            }
                        }
                    } label: {
                        Text(PageTargetDefaultChoice.label(for: bot.pageTargetDefault ?? ""))
                            .font(theme.font(13))
                            .foregroundStyle(theme.ink)
                    }
                    .disabled(bot.busy == true)
                    .accessibilityIdentifier("persona-permissions.page-target")
                }
            }
        }
        if shows(.advanced), edits("approvePeerComms") {
            DesktopDescribedRow(Text("Ask me before contacting other bots"),
                                help: bot.approvePeerComms == true
                                    ? Text("On: this bot stops and asks before it reaches out to another bot.")
                                    : Text("Off: this bot talks to teammates on its own, without a confirmation step."),
                                identifier: "askBeforeContact") {
                PanelSwitch(label: "Ask me before contacting other bots", isOn: bot.approvePeerComms == true, onColor: tint) { on in
                    Task { _ = await sendPanelPatch(BotPanelPatch(approvePeerComms: on), bot: bot, session: session) }
                }
                .accessibilityIdentifier("persona-permissions.ask")
            }
        }
        if shows(.actsAlone), edits("allowedRecipients") {
            PersonaRecipientsRow(bot: bot)
        }
        if shows(.actsAlone), edits("emailDrafts") {
            let on = emailDrafts ?? bot.emailDrafts ?? true
            DesktopDescribedRow(Text("Email drafts"),
                                description: on ? nil : Text("Drafts are off for this bot."),
                                help: Text("When off, this bot does not write email draft cards."),
                                identifier: "emailDrafts") {
                PanelSwitch(label: "Email drafts", isOn: on, onColor: tint) { next in
                    Task { if await PersonaBotFields.patch(["emailDrafts": .bool(next)], bot: bot, session: session) { emailDrafts = next } }
                }
                .accessibilityIdentifier("persona-permissions.email-drafts")
            }
        }
        if shows(.actsAlone), edits("memeReplies") {
            let auto = (memeReplies ?? bot.memeReplies) != "off"
            DesktopDescribedRow(Text("Meme replies"),
                                description: auto ? Text("The bot decides from the person's style.") : Text("Meme replies are off for this bot."),
                                help: Text("When Auto, this bot may post a fitting reaction meme from the person's style. Off hides the tool. Never in serious or work contexts."),
                                identifier: "memeReplies") {
                Picker("Meme replies", selection: Binding(get: { auto ? "auto" : "off" }, set: { next in
                    guard next != (auto ? "auto" : "off") else { return }
                    Task { if await PersonaBotFields.patch(["memeReplies": .string(next)], bot: bot, session: session) { memeReplies = next } }
                })) {
                    Text("Auto").tag("auto")
                    Text("Off").tag("off")
                }
                .pickerStyle(.segmented)
                .fixedSize()
                .accessibilityIdentifier("persona-permissions.meme-replies")
            }
        }
        if shows(.advanced), edits("maxConcurrentThreads") {
            let threads = maxThreads ?? bot.maxConcurrentThreads ?? 3
            DesktopDescribedRow(Text("Maximum running conversations for this bot"),
                                help: Text("Applies to this bot's 1:1 conversations. Extra messages wait for a free place. Delegated work and conversations waiting for an approval take a place too. Lowering the limit does not stop work in progress."),
                                identifier: "parallelThreads") {
                Menu {
                    ForEach(1...16, id: \.self) { value in
                        Button {
                            guard value != threads, let client = session.settingsClient else { return }
                            let botId = bot.id
                            Task { if (try? await client.setBotMaxConcurrentThreads(botId: botId, value)) != nil { maxThreads = value } }
                        } label: {
                            if value == threads { Label(String(value), systemImage: "checkmark") } else { Text(verbatim: String(value)) }
                        }
                    }
                } label: {
                    Text(verbatim: String(threads))
                        .font(theme.font(13))
                        .foregroundStyle(theme.ink)
                }
                .disabled(bot.busy == true)
                .accessibilityIdentifier("persona-permissions.parallel-threads")
            }
        }
        if shows(.advanced), edits("loopGuard") {
            let on = loopGuard ?? bot.loopGuard ?? true
            DesktopDescribedRow(Text("Loop guard"),
                                description: on ? nil : Text("Loop guard is off for this bot."),
                                help: Text("When off, this bot is not steered or stopped for a repeating shell failure."),
                                identifier: "loopGuard") {
                PanelSwitch(label: "Loop guard", isOn: on, onColor: tint) { next in
                    Task { if await PersonaBotFields.patch(["loopGuard": .bool(next)], bot: bot, session: session) { loopGuard = next } }
                }
                .accessibilityIdentifier("persona-permissions.loop-guard")
            }
        }
        if shows(.advanced, gated: false), edits("allowedRecipients") {
            // LifecycleHooksRow: GET / PUT /api/bots/:id/lifecycle-hooks
            DesktopDescribedRow(Text("Lifecycle hooks"),
                                description: hooks.map { $0.events.isEmpty ? Text("No plugin hooks installed.") : Text(verbatim: $0.events.joined(separator: ", ")) }
                                    ?? Text("No plugin hooks installed."),
                                help: Text("Plugin hooks run on the bot's computer (sandbox, VM or PC), never on the server. They stay off until you turn them on."),
                                identifier: "lifecycleHooks") {
                PanelSwitch(label: "Lifecycle hooks", isOn: hooks?.enabled ?? false, disabled: hooks == nil, onColor: tint) { next in
                    guard let client = session.settingsClient else { return }
                    let botId = bot.id
                    Task { if let saved = try? await client.setBotLifecycleHooks(botId: botId, enabled: next) { hooks = saved } }
                }
                .accessibilityIdentifier("persona-permissions.lifecycle-hooks")
            }
        }
    }

    /// `AdvancedFold`: "More options", folded.
    private var moreOptions: some View {
        VStack(alignment: .leading, spacing: 20) {
            Button {
                withAnimation(.easeOut(duration: 0.15)) { moreOpen.toggle() }
            } label: {
                HStack(spacing: 12) {
                    DesktopText(Text("More options"))
                        .frame(maxWidth: .infinity, alignment: .leading)
                    DesktopSettingsIconView(icon: .chevronDown, size: 14)
                        .foregroundStyle(theme.inkSecondary)
                        .rotationEffect(.degrees(moreOpen ? 180 : 0))
                }
                .padding(.horizontal, 14)
                .frame(minHeight: 40)
                .background(theme.elevated, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .desktopHairlineBox(radius: 12)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(moreOpen ? Text("Expanded") : Text("Collapsed"))
            .accessibilityIdentifier("persona-permissions.more")
            if moreOpen {
                HStack(spacing: 8) {
                    if session.surfaceGate.allows(.commandAllowlist) {
                        Button("Manage command allowlist") { allowlist = true }
                            .buttonStyle(DesktopButtonStyle(kind: .control))
                            .accessibilityIdentifier("persona-permissions.allowlist")
                    }
                    // the person's custom rules and always-allowed tools
                    Button("Approval rules") { grants = true }
                        .buttonStyle(DesktopButtonStyle(kind: .control))
                        .accessibilityIdentifier("persona-permissions.grants")
                }
                if session.surfaceGate.allows(.botOutbound, bot: bot) {
                    AnyView(BotPanelOutbound(bot: bot))
                }
            }
        }
    }

    private func pick(_ option: ApprovalLevel) {
        guard option != level else { return }
        if bot.busy == true, option == .full || option == .custom {
            notice = AppStrings.localized("Stop this bot's turn before changing its approval level")
            return
        }
        notice = nil
        if option == .full { confirmingFull = true; return }
        if option == .auto, bot.computer == "local" { confirmingLocalAuto = true; return }
        Task { _ = await sendPanelPatch(.approval(option), bot: bot, session: session) }
    }
}

// MARK: - Voice

/// Voice (bot-settings/VoiceSection.tsx with VoiceSettings and the bot's
/// VoiceProviderSettings): Bot's voice, Voice with "Test the voice", Speech
/// to text; then Read replies aloud and Voice notes; then Notifications.
struct PersonaVoicePage: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @AppStorage(VoiceModeSettings.storageKey) private var voiceRaw = ""
    let bot: Bot
    let slackURL: URL?

    @State private var status: VoiceProvidersStatus?
    @State private var statusFailed: String?
    @State private var voices: [VoiceModeVoice]?
    @State private var testing = false
    @State private var note: String?
    @State private var player: AVAudioPlayer?

    private var settings: VoiceModeSettings { VoiceModeSettings.decode(voiceRaw.isEmpty ? nil : voiceRaw) }
    private var tint: Color? { BubbleColors.user(botColor: bot.color)?.fill.color }
    private var showVoice: Bool { session.canEditBotField(bot, "voice") }

    var body: some View {
        let choice = PersonaVoiceChoice(settings: settings, botId: bot.id)
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 12) {
                DesktopSettingsGroup(identifier: "voiceProviders") {
                    AnyView(providerRows(choice))
                }
                if showVoice {
                    DesktopSettingsGroup(identifier: "botVoice") {
                        DesktopDescribedRow(Text("Read replies aloud"), help: Text("Speaks this bot's answers as they arrive."), identifier: "speakReplies") {
                            PanelSwitch(label: "Read this bot's replies aloud", isOn: bot.speakReplies == true, onColor: tint) { on in
                                Task { _ = await session.updateProfile(BotProfilePatch(speakReplies: on), for: bot) }
                            }
                            .accessibilityIdentifier("persona-voice.read")
                        }
                        DesktopDescribedRow(Text("Voice notes"), help: Text("Lets this bot send spoken notes."), identifier: "voiceNotes") {
                            PanelSwitch(label: "Let this bot send voice notes", isOn: bot.voiceNotes != false, onColor: tint) { on in
                                Task {
                                    guard let client = session.profileClient else { return }
                                    do { session.applyProfileBot(try await client.editBot(botId: bot.id, edit: BotProfileEdit(voiceNotes: on))) }
                                    catch { session.actionError = error.localizedDescription }
                                }
                            }
                            .accessibilityIdentifier("persona-voice.notes")
                        }
                    }
                }
            }
            DesktopSettingsGroup(Text("Notifications"), identifier: "botNotifications") {
                DesktopDescribedRow(Text("Notify me when this bot finishes or needs me"), identifier: "notifications") {
                    PanelSwitch(label: "Notify me when this bot finishes or needs me", isOn: bot.notifications, onColor: tint) { on in
                        Task { _ = await session.updateProfile(BotProfilePatch(notifications: on), for: bot) }
                    }
                    .accessibilityIdentifier("persona-voice.notify")
                }
            }
        }
        .task { await seedInstalledVoice() }
        .task(id: "\(bot.id)|\(choice.tts)|\(choice.stt)") { await loadStatus(choice) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("persona-page.voice")
    }

    private func label(_ provider: String) -> String {
        VoiceProviderChoice.label(provider, system: AppStrings.localized("Built-in Mac voices"), chatterbox: AppStrings.localized("Chatterbox (local)"))
    }

    private func noKey(_ name: String) -> String { String(format: AppStrings.localized("%@ (no key)"), name) }

    private func inherit(_ picked: String) -> String {
        String(format: AppStrings.localized("Same as my settings (%@)"), picked == "auto" ? AppStrings.localized("Auto") : label(picked))
    }

    /// `providerOptions` with the bot's "Same as my settings" first.
    private func options(offered: [String], all: [String], picked: String, person: String) -> [(String, String)] {
        var out: [(String, String)] = [("inherit", inherit(person))]
        for provider in all {
            if offered.contains(provider) { out.append((provider, label(provider))) }
            else if picked == provider { out.append((provider, noKey(label(provider)))) }
        }
        return out
    }

    @ViewBuilder
    private func providerRows(_ choice: PersonaVoiceChoice) -> some View {
        let none = status != nil && (status?.offeredTts.isEmpty ?? true) && (status?.offeredStt.isEmpty ?? true)
        if let statusFailed, status == nil {
            DesktopDescribedRow(Text("Bot's voice"), description: Text(verbatim: statusFailed)) { EmptyView() }
        } else if none {
            DesktopDescribedRow(Text("Bot's voice"), description: Text("Add a key in Providers, or use an installed voice, to choose who speaks and who listens.")) { EmptyView() }
        } else {
            let speaking = choice.speaking(status: status)
            let offeredTts = status?.offeredTts ?? []
            DesktopDescribedRow(Text("Bot's voice"),
                                help: Text("Only the providers you have a key for are offered. If one fails or reaches its limit, another one you have takes over by itself, and the conversation's Events tab says so."),
                                identifier: "voiceProviders.tts") {
                DesktopPillSelect(options: options(offered: offeredTts, all: VoiceModeSettings.ttsProviders, picked: choice.ownTts, person: settings.personTts),
                                  selection: choice.ownTts, label: Text("Bot's voice"), identifier: "persona-voice.tts") { value in
                    note = nil
                    voiceRaw = choice.setting("tts", value == "inherit" ? nil : value).encoded
                }
            }
            DesktopCompactRow(Text("Voice"), identifier: "voiceProviders.voice") {
                let selected = speaking.map { choice.voice(of: $0) } ?? ""
                let base: [(String, String)] = [("", voices == nil && speaking != nil ? AppStrings.localized("Loading voices…") : AppStrings.localized("Provider's default voice"))]
                let kept: [(String, String)] = !selected.isEmpty && !(voices ?? []).contains { $0.id == selected } ? [(selected, selected)] : []
                DesktopPillSelect(options: base + kept + (voices ?? []).map { ($0.id, $0.label) },
                                  selection: selected,
                                  label: Text(verbatim: String(format: AppStrings.localized("%@ voice"), speaking.map(label) ?? "")),
                                  identifier: "persona-voice.voice", disabled: speaking == nil) { value in
                    guard let speaking else { return }
                    note = nil
                    voiceRaw = choice.withVoice(value, provider: speaking).encoded
                }
                Button { Task { await test() } } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "speaker.wave.2").font(.system(size: 12))
                        Text("Test the voice")
                    }
                }
                .buttonStyle(DesktopButtonStyle(kind: .control))
                .disabled(testing || speaking == nil || offeredTts.isEmpty)
                .accessibilityIdentifier("persona-voice.test")
            }
            DesktopDescribedRow(Text("Speech to text"), help: Text("Who turns what you say into text on a call and in dictation."), identifier: "voiceProviders.stt") {
                DesktopPillSelect(options: options(offered: status?.offeredStt ?? [], all: VoiceModeSettings.sttProviders, picked: choice.ownStt, person: settings.personStt),
                                  selection: choice.ownStt, label: Text("Speech to text"), identifier: "persona-voice.stt") { value in
                    voiceRaw = choice.setting("stt", value == "inherit" ? nil : value).encoded
                }
            }
        }
        if let note {
            DesktopText(verbatim: note, size: 12, line: 16, color: \.danger)
                .padding(.horizontal, 14).padding(.bottom, 8)
        }
    }

    /// `migrateInstalledVoiceSettings`, as Settings > Voice does: on a solo
    /// installation, the first time nothing is stored, the installation's
    /// voice becomes the person's (what "Same as my settings" names).
    private func seedInstalledVoice() async {
        guard voiceRaw.isEmpty, let config = try? await session.settingsClient?.desktopSettingsConfig(),
              config.personalSettings != true, let tts = config.tts, voiceRaw.isEmpty else { return }
        voiceRaw = VoiceModeSettings.installed(provider: tts.provider, voice: tts.voice).encoded
    }

    private func loadStatus(_ choice: PersonaVoiceChoice) async {
        guard let client = session.settingsClient else { return }
        do {
            status = try await client.voiceProvidersStatus(tts: choice.tts, stt: choice.stt)
            statusFailed = nil
        } catch {
            statusFailed = error.localizedDescription
        }
        guard let speaking = choice.speaking(status: status), status?.offeredTts.contains(speaking) == true else {
            voices = nil
            return
        }
        voices = nil
        voices = (try? await client.voiceModeVoices(botId: bot.id, provider: speaking)) ?? []
    }

    private func test() async {
        guard let client = session.settingsClient else { return }
        testing = true
        note = nil
        defer { testing = false }
        do {
            let (clip, _) = try await client.voiceModeSpeak(botId: bot.id, text: AppStrings.localized("Hello, this is how I sound on a call."), settings: settings, threadId: nil)
            try? AVAudioSession.sharedInstance().setCategory(.playback)
            player = try AVAudioPlayer(data: clip)
            player?.play()
        } catch {
            note = String(format: AppStrings.localized("The voice test did not play: %@"), error.localizedDescription)
        }
    }
}
