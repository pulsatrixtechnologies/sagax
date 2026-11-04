// The pieces of Edit bot > Model, Permissions and Voice
// (PersonaPagesModelTools.swift): the approval level pill
// (ApprovalModeSelector's trigger), Allowed recipients (AllowedRecipientsRow),
// Rules (OwnerPermissionsCard), Automatic recovery (BotRecoverySettings),
// the backups (ModelSection FallbackChain), the bot's fields PATCH and the
// bot's own voice choice in the synced voice preference.
import SwiftUI
import CompanionCore

// MARK: - PATCH /api/bots/:id

@MainActor
enum PersonaBotFields {
    /// `PATCH /api/bots/:id` with exactly these fields (the bulk editor's route).
    static func patch(_ fields: BulkPatch, bot: Bot, session: Session) async -> Bool {
        guard let client = session.profileClient else { return false }
        do {
            session.applyProfileBot(try await client.patchBotFields(botId: bot.id, patch: fields))
            return true
        } catch {
            session.actionError = error.localizedDescription
            return false
        }
    }
}

// MARK: - Approval level

/// ApprovalModeSelector's trigger: the level's glyph, its name, the chevron,
/// the four levels in a menu.
struct PersonaApprovalPill: View {
    @Environment(\.desktopTheme) private var theme
    let level: ApprovalLevel
    var disabled = false
    let choose: (ApprovalLevel) -> Void

    var body: some View {
        Menu {
            ForEach([ApprovalLevel.ask, .edits, .auto, .full], id: \.self) { option in
                Button { choose(option) } label: {
                    if option == level {
                        Label { Text(DesktopApprovalButton.label(option)) } icon: { Image(systemName: "checkmark") }
                    } else {
                        Label { Text(DesktopApprovalButton.label(option)) } icon: { Image(systemName: DesktopApprovalButton.icon(option)) }
                    }
                }
            }
        } label: {
            HStack(spacing: 6) {
                if let paths = DesktopLucide.forSymbol(DesktopApprovalButton.icon(level)) {
                    DesktopLucideGlyph(paths: paths, size: 13)
                        .foregroundStyle(theme.inkSecondary)
                } else {
                    Image(systemName: DesktopApprovalButton.icon(level)).font(.system(size: 12))
                        .foregroundStyle(theme.inkSecondary)
                }
                Text(DesktopApprovalButton.label(level))
                    .font(theme.font(13))
                    .foregroundStyle(theme.ink)
                    .lineLimit(1)
                DesktopSettingsIconView(icon: .chevronDown, size: 13)
                    .foregroundStyle(theme.inkSecondary)
            }
            .padding(.horizontal, 10)
            .frame(height: 28)
            .contentShape(Capsule())
        }
        .fixedSize()
        .disabled(disabled)
        .opacity(disabled ? 0.5 : 1)
        .accessibilityLabel(Text("Approval level"))
        .accessibilityValue(Text(DesktopApprovalButton.label(level)))
        .accessibilityIdentifier("persona-permissions.approval")
    }
}

// MARK: - Allowed recipients

/// AllowedRecipientsRow: the people and bots this bot writes to without a
/// card (PATCH /api/bots/:id {allowedRecipients}, the step-up when asked).
struct PersonaRecipientsRow: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let bot: Bot

    @State private var draft = ""
    @State private var error: String?
    @State private var saving = false
    /// The organization's Always allow (`/api/custom-rules` orgPolicy).
    @State private var grantsOn = true

    private var list: [String] { bot.allowedRecipients ?? [] }
    private var others: [Bot] {
        session.state.bots.filter { $0.id != bot.id && $0.hidden != true && !list.contains("bot:\($0.id)") }
    }

    var body: some View {
        DesktopDescribedRow(Text("Allowed recipients"),
                            description: Text("It writes to these people and bots without a card. For anyone else, an approval card shows."),
                            help: bot.approvePeerComms == true
                                ? Text("An email or a text goes without a card when every recipient is on this list. A bot on the list is reached without the confirmation step. Payments, invitations, shares, posts and replies always ask for an approval.")
                                : Text("An email or a text goes without a card when every recipient is on this list. Bots on the list count once \"Ask me before contacting other bots\" is on. Payments, invitations, shares, posts and replies always ask for an approval."),
                            identifier: "allowedRecipients") {
            EmptyView()
        } below: {
            AnyView(editor)
        }
        .task(id: bot.id) {
            if let rules = try? await session.settingsClient?.customRules(botId: bot.id) { grantsOn = rules.alwaysAllow }
        }
    }

    private var editor: some View {
        VStack(alignment: .leading, spacing: 8) {
            if list.isEmpty {
                DesktopText(Text("No one yet: every send asks for an approval."), size: 12, line: 16, color: \.inkTertiary)
                    .accessibilityIdentifier("persona-recipients.empty")
            } else {
                PanelFlow(spacing: 6, lineSpacing: 6) {
                    ForEach(list, id: \.self) { key in AnyView(chip(key)) }
                }
            }
            if !grantsOn {
                DesktopText(Text("Your organization requires an approval each time: this list is paused."), size: 12, line: 16, color: \.inkSecondary)
            }
            HStack(spacing: 8) {
                TextField(text: $draft, prompt: Text("Email address or phone number").foregroundColor(theme.inkSecondary)) {
                    Text("Email address or phone number")
                }
                .font(theme.font(13))
                .foregroundStyle(theme.ink)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.emailAddress)
                .submitLabel(.done)
                .onSubmit(addPerson)
                .onChange(of: draft) { _ in error = nil }
                .padding(.horizontal, 12)
                .frame(height: 32)
                .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.border, lineWidth: 1))
                .accessibilityIdentifier("persona-recipients.input")
                Button("Add", action: addPerson)
                    .buttonStyle(DesktopButtonStyle(kind: .control))
                    .disabled(saving || !grantsOn || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityIdentifier("persona-recipients.add")
                if !others.isEmpty {
                    Menu {
                        ForEach(others) { candidate in
                            Button { addBot(candidate.id) } label: { Text(verbatim: candidate.name) }
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Text("Add a bot")
                            DesktopSettingsIconView(icon: .chevronDown, size: 13)
                        }
                        .font(theme.font(13))
                        .foregroundStyle(theme.ink)
                        .padding(.horizontal, 12)
                        .frame(height: 31.5)
                        .background(theme.control, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }
                    .disabled(saving || !grantsOn)
                    .accessibilityIdentifier("persona-recipients.add-bot")
                }
            }
            if let error {
                DesktopText(verbatim: error, size: 12, line: 16, color: \.danger)
                    .accessibilityIdentifier("persona-recipients.error")
            }
        }
        .padding(.top, 8)
    }

    private func chip(_ key: String) -> some View {
        let shown = AllowedRecipients.label(key) { id in session.state.bots.first { $0.id == id }?.name }
        return HStack(spacing: 4) {
            Text(verbatim: shown.text)
                .font(theme.font(12))
                .foregroundStyle(theme.ink)
                .lineLimit(1)
                .frame(maxWidth: 240, alignment: .leading)
                .fixedSize()
            Button {
                Task { await save(list.filter { $0 != key }) }
            } label: {
                DesktopSettingsIconView(icon: .x, size: 12)
                    .foregroundStyle(theme.inkTertiary)
                    .frame(width: 20, height: 20)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .disabled(saving)
            .accessibilityLabel(Text("Remove \(shown.text)"))
        }
        .padding(.leading, 10)
        .padding(.trailing, 4)
        .padding(.vertical, 2)
        .background(theme.inset, in: Capsule())
        .overlay(Capsule().strokeBorder(theme.border, lineWidth: 1))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("persona-recipients.chip")
    }

    private func addPerson() {
        switch AllowedRecipients.addingPerson(draft, to: list) {
        case .invalid:
            error = AppStrings.localized("Enter an email address or a phone number.")
        case .unchanged:
            draft = ""
        case let .next(next):
            Task { if await save(next) { draft = "" } }
        }
    }

    private func addBot(_ id: String) {
        guard let next = AllowedRecipients.addingBot(id: id, to: list) else {
            error = AppStrings.localized("Enter an email address or a phone number.")
            return
        }
        Task { await save(next) }
    }

    @discardableResult
    private func save(_ next: [String]) async -> Bool {
        guard let client = session.settingsClient else { return false }
        saving = true
        defer { saving = false }
        error = nil
        do {
            _ = try await Session.withStepUp(client) { stepUp in
                session.applyProfileBot(try await client.patchAllowedRecipients(botId: bot.id, recipients: next, stepUp: stepUp))
            }
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }
}

// MARK: - Rules

/// OwnerPermissionsCard's "Rules": what the person decided with Always
/// allow or Always deny, for this bot or all their bots
/// (`GET /api/approval-rules`), each with Delete (asked first).
struct PersonaOwnerRulesGroup: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let bot: Bot

    @State private var rules: [OwnerApprovalRule] = []
    @State private var removing: OwnerApprovalRule?
    @State private var error: String?

    var body: some View {
        DesktopSettingsGroup(Text("Rules"),
                             accessory: AnyView(DesktopHelpTip(help: Text("What you decided with Always allow or Always deny. Rules are yours: they apply to this bot or to all your bots, never to someone else's."))),
                             identifier: "ownerRules") {
            if rules.isEmpty {
                DesktopText(Text("No rules yet. Answer a card with Always allow or Always deny to add one."), size: 12.5, line: 18, color: \.inkSecondary)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .accessibilityIdentifier("persona-rules.empty")
            } else {
                ForEach(Array(rules.enumerated()), id: \.element.id) { index, rule in
                    if index > 0 { Rectangle().fill(theme.hairline40).frame(height: 1) }
                    AnyView(row(rule))
                }
            }
            if let error {
                DesktopText(verbatim: error, size: 12, line: 16, color: \.danger)
                    .padding(.horizontal, 14).padding(.bottom, 8)
            }
        }
        .task(id: bot.id) { await load() }
        .alert("Delete this rule?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } })) {
            Button("Cancel", role: .cancel) { removing = nil }
            Button("Delete rule", role: .destructive) {
                let rule = removing
                removing = nil
                if let rule { Task { await remove(rule) } }
            }
        } message: {
            Text(verbatim: removing?.description ?? "")
        }
    }

    private func row(_ rule: OwnerApprovalRule) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                DesktopText(verbatim: rule.description)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                if rule.botId == nil {
                    DesktopText(Text("All my bots"), size: 11.5, line: 16, color: \.inkTertiary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            DesktopText(behavior(rule.behavior), size: 12.5, line: 18, color: tone(rule.behavior))
            Button { removing = rule } label: {
                DesktopSettingsIconView(icon: .trash2, size: 14)
                    .foregroundStyle(theme.inkSecondary)
                    .frame(width: 24, height: 24)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Delete rule"))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("persona-rules.row")
    }

    private func tone(_ raw: String) -> KeyPath<DesktopTheme, Color> {
        switch raw {
        case "deny": \.danger
        case "allow": \.success
        default: \.inkSecondary
        }
    }

    private func behavior(_ raw: String) -> Text {
        switch raw {
        case "allow": Text("Allow automatically")
        case "deny": Text("Deny")
        default: Text("Ask every time")
        }
    }

    /// `rulesForBot`: its own first, then the ones for all my bots.
    private func load() async {
        guard let client = session.settingsClient, let all = try? await client.approvalRules() else {
            rules = []
            return
        }
        rules = all.filter { $0.botId == bot.id || $0.botId == nil }
            .sorted { a, b in
                if (a.botId == nil) != (b.botId == nil) { return a.botId != nil }
                return a.description.localizedCompare(b.description) == .orderedAscending
            }
    }

    private func remove(_ rule: OwnerApprovalRule) async {
        guard let client = session.settingsClient else { return }
        error = nil
        do {
            try await client.deleteApprovalRule(id: rule.id)
        } catch {
            self.error = String(format: AppStrings.localized("Could not save the rule: %@"), error.localizedDescription)
        }
        await load()
    }
}

// MARK: - Automatic recovery

/// BotRecoverySettings: Use a backup model, Backup provider, Backup model,
/// Save. The bot's own value (PATCH /api/bots/:id/runtime-settings) has no
/// iPad call yet: the group shows the workspace's value, its controls held.
struct PersonaRecoveryGroup: View {
    @Environment(\.desktopTheme) private var theme
    let bot: Bot
    let instances: [Instance]
    let workspace: Bool?

    var body: some View {
        let enabled = workspace == true
        let engines = instances.filter { $0.snapshot.isAvailable }
        DesktopSettingsGroup(Text("Automatic recovery"),
                             accessory: AnyView(DesktopHelpTip(help: Text("Applies to direct bot threads, including Primary Bot and delegated work. Channels are not included. Only this thread switches; bot defaults stay unchanged."))),
                             identifier: "botRecovery") {
            DesktopDescribedRow(Text("Use a backup model"),
                                help: Text("If an ACP model provider (such as Qwen or OpenCode) fails before starting, try a backup once. Work that may have already run is not replayed."),
                                identifier: "botRecoveryEnabled") {
                PanelSwitch(label: "Use a backup model", isOn: enabled, disabled: true,
                            onColor: BubbleColors.user(botColor: bot.color)?.fill.color) { _ in }
            }
            DesktopCompactRow(Text("Backup provider"), identifier: "botRecoveryEngine") {
                DesktopPillSelect(options: [("", AppStrings.localized("Choose a provider"))] + engines.map { ($0.instanceId, HumanID.readable($0.displayName, $0.instanceId, or: AppStrings.localized("Removed engine"))) },
                                  selection: "", label: Text("Backup provider"), identifier: "persona-recovery.engine", disabled: true) { _ in }
            }
            DesktopDescribedRow(Text("Backup model"),
                                help: Text("Permissions stay unchanged; some provider switches need confirmation. Using the backup can incur charges from its provider."),
                                identifier: "botRecoveryModel") {
                DesktopPillSelect(options: [("", AppStrings.localized("Choose a model"))], selection: "",
                                  label: Text("Backup model"), identifier: "persona-recovery.model", disabled: true) { _ in }
            }
            HStack {
                Spacer(minLength: 0)
                Button("Save") {}
                    .buttonStyle(DesktopButtonStyle(kind: .control, height: 28, radius: 14))
                    .disabled(true)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
        }
        .accessibilityIdentifier("persona-model.recovery")
    }
}

// MARK: - Backups

/// ModelSection's FallbackChain: "Backup models for this bot", one row per
/// engine (its model in a pill, remove), then "Add a fallback engine".
struct PersonaFallbackGroup: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let bot: Bot
    let instances: [Instance]

    @State private var saving = false

    private var chain: [ModelSelection] { bot.fallback ?? [] }
    private var candidates: [Instance] { BotFallbackRules.candidates(instances, bot: bot) }

    private func name(_ instanceId: String) -> String {
        HumanID.readable(instances.first { $0.instanceId == instanceId }?.displayName, instanceId, or: AppStrings.localized("Removed engine"))
    }

    var body: some View {
        DesktopSettingsGroup(Text("Backup models for this bot"),
                             accessory: AnyView(DesktopHelpTip(help: Text("When Automatic recovery is enabled in App Settings, try these models in order only if the provider proves the request never started. Work that may have run is not replayed. Only that thread switches; bot defaults and other threads stay unchanged. Backup provider charges may apply."))),
                             identifier: "botBackups") {
            ForEach(Array(chain.enumerated()), id: \.element.instanceId) { index, entry in
                AnyView(row(index, entry))
            }
            if chain.count < BotFallbackRules.limit {
                DesktopCompactRow(Text("Add a fallback engine")) {
                    DesktopPillSelect(options: [("", candidates.isEmpty ? AppStrings.localized("No other engine is available") : AppStrings.localized("Add an engine…"))]
                                      + candidates.map { ($0.instanceId, name($0.instanceId)) },
                                      selection: "", label: Text("Add a fallback engine"), identifier: "persona-fallback.add",
                                      disabled: candidates.isEmpty || saving) { id in
                        guard let instance = candidates.first(where: { $0.instanceId == id }) else { return }
                        save(BotFallbackRules.adding(instance, to: chain))
                    }
                }
            }
        }
    }

    private func row(_ index: Int, _ entry: ModelSelection) -> some View {
        let models = instances.first { $0.instanceId == entry.instanceId }?.models.options ?? []
        let options = (models.contains { $0.id == entry.model } ? [] : [(entry.model, entry.model)]) + models.map { ($0.id, $0.label) }
        return DesktopCompactRow(Text(verbatim: "\(index + 1). \(name(entry.instanceId))")) {
            DesktopPillSelect(options: options, selection: entry.model, label: Text("Backup model"), disabled: saving) { model in
                save(chain.map { $0.instanceId == entry.instanceId ? ModelSelection(instanceId: $0.instanceId, model: model) : $0 })
            }
            Button {
                save(chain.filter { $0.instanceId != entry.instanceId })
            } label: {
                DesktopSettingsIconView(icon: .x, size: 13)
                    .foregroundStyle(theme.inkSecondary)
                    .frame(width: 24, height: 24)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(saving)
            .accessibilityLabel(Text("Remove \(name(entry.instanceId)) from the fallback list"))
        }
    }

    private func save(_ next: [ModelSelection]) {
        Task {
            saving = true
            _ = await session.updateFallback(next, for: bot)
            saving = false
        }
    }
}

// MARK: - The bot's own voice choice

/// One bot's providers and voices in the person's synced voice preference
/// (`omb.voiceMode.v1`, shared/voice-providers.ts): `bots[botId]` holds the
/// bot's own `tts`, `stt` and `voices`; absent is "Same as my settings".
struct PersonaVoiceChoice {
    let settings: VoiceModeSettings
    let botId: String

    private var record: [String: Any] {
        guard let data = settings.extraJSON.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return object
    }

    private var own: [String: Any]? { (record["bots"] as? [String: Any])?[botId] as? [String: Any] }

    /// The pill values: the bot's own provider, or "inherit".
    var ownTts: String { (own?["tts"] as? String).flatMap { VoiceModeSettings.ttsProviders.contains($0) ? $0 : nil } ?? "inherit" }
    var ownStt: String { (own?["stt"] as? String).flatMap { VoiceModeSettings.sttProviders.contains($0) ? $0 : nil } ?? "inherit" }

    /// `effectiveVoiceChoice`: the bot's own, else the person's, else Auto.
    var tts: String { ownTts == "inherit" ? settings.personTts : ownTts }
    var stt: String { ownStt == "inherit" ? settings.personStt : ownStt }

    /// The provider whose voice is picked: the one chosen, else the one the
    /// server starts with, else the first offered.
    func speaking(status: VoiceProvidersStatus?) -> String? {
        VoiceProviderChoice.speaking(picked: tts, status: status)
    }

    /// The voice this bot speaks with on `provider`: its own, else the person's.
    func voice(of provider: String) -> String {
        if let mine = (own?["voices"] as? [String: Any])?[provider] as? String { return mine }
        if provider == "xai" { return settings.voice }
        return ((record["voices"] as? [String: Any])?[provider] as? String) ?? ""
    }

    /// `writeBotVoiceChoice`: the bot's provider for one role; nil goes
    /// back to the person's settings (the bot's entry stays).
    func setting(_ role: String, _ provider: String?) -> VoiceModeSettings {
        var next = record
        var bots = next["bots"] as? [String: Any] ?? [:]
        var entry = bots[botId] as? [String: Any] ?? [:]
        entry[role] = provider
        bots[botId] = entry
        next["bots"] = bots
        return with(next)
    }

    /// `writeVoiceForBot`: in the bot's own choice when it has one, else
    /// the person's (xAI's in `voice`).
    func withVoice(_ id: String, provider: String) -> VoiceModeSettings {
        var next = record
        if var bots = next["bots"] as? [String: Any], var entry = bots[botId] as? [String: Any] {
            var voices = entry["voices"] as? [String: Any] ?? [:]
            voices[provider] = id.isEmpty ? nil : id
            entry["voices"] = voices.isEmpty ? nil : voices
            bots[botId] = entry
            next["bots"] = bots
            return with(next)
        }
        if provider == "xai" {
            var out = settings
            out.voice = id
            return out
        }
        var voices = next["voices"] as? [String: Any] ?? [:]
        voices[provider] = id.isEmpty ? nil : id
        next["voices"] = voices.isEmpty ? nil : voices
        return with(next)
    }

    private func with(_ next: [String: Any]) -> VoiceModeSettings {
        let json = next.isEmpty ? "" : (try? JSONSerialization.data(withJSONObject: next, options: [.sortedKeys]))
            .map { String(decoding: $0, as: UTF8.self) } ?? ""
        return VoiceModeSettings(voice: settings.voice, speed: settings.speed, language: settings.language, extraJSON: json)
    }
}
