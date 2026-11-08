// The wizard's steps on iOS, over the real bot (desktop WizardSteps.tsx):
// identity and look, the soul and its answers, the one approval level and
// the suggested rules, only the tools of the role, the suggested routines,
// and the recap with Try it. Each field saves through the bot's own route.
// 2026-10-27 (desktop v2): Identity puts the avatar beside the name and the
// role in one menu; Rules gives each suggestion one effect (Off, Allow, Ask,
// Deny) and asks whether the bot uses apps or a computer; the recap is a
// compact read-only summary with one Edit per step.
import SwiftUI
import CompanionCore

struct WizardStepBody: View {
    let step: WizardStep
    let bot: Bot
    let draft: WizardDraft
    let suggestions: WizardSuggestions
    let language: String
    let patch: (WizardPatch) async -> Void
    let goTo: (WizardStep) -> Void

    var body: some View {
        switch step {
        case .identity: WizardIdentityStep(bot: bot, draft: draft, patch: patch)
        case .soul: WizardSoulStep(bot: bot, draft: draft, suggestions: suggestions, language: language, patch: patch)
        case .rules: WizardRulesStep(bot: bot, draft: draft, suggestions: suggestions, patch: patch)
        case .tools: WizardToolsStep(bot: bot, suggestions: suggestions)
        case .routines: WizardRoutinesStep(draft: draft, suggestions: suggestions, patch: patch)
        case .recap: WizardRecapStep(bot: bot, draft: draft, suggestions: suggestions, language: language, patch: patch, goTo: goTo)
        }
    }
}

private struct WizardCard<Content: View>: View {
    let title: String?
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let title { Text(title).font(Theme.Font.bodyMedium).foregroundStyle(Theme.textPrimary) }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

private func roleTitle(_ role: WizardRole?) -> String {
    switch role {
    case .assistant?: String(localized: "General assistant")
    case .inbox?: String(localized: "Email triage")
    case .research?: String(localized: "Researcher")
    case .coder?: String(localized: "Coding partner")
    case .community?: String(localized: "Community monitor")
    case .ops?: String(localized: "Operations")
    case .subscriptions?: String(localized: "Subscriptions")
    case nil: String(localized: "Custom")
    }
}

// MARK: 1 Identity

struct WizardIdentityStep: View {
    let bot: Bot
    let draft: WizardDraft
    let patch: (WizardPatch) async -> Void
    @EnvironmentObject private var session: Session
    @State private var name = ""
    @State private var description = ""
    @State private var look = CharacterDraft()
    @State private var loaded = false
    /// The values the fields last showed from the bot: a field the person
    /// did not touch follows the bot (the guide fills it live) and is never
    /// sent back stale when the step closes.
    @State private var shownName = ""
    @State private var shownDescription = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            // The reference app's layout: the avatar beside the name and the role
            HStack(alignment: .center, spacing: 16) {
                MascotCharacterView(look: look.complete, color: look.color, skin: look.skin, size: 96, animated: true)
                    .frame(width: 96, height: 96)
                    .accessibilityHidden(true)
                    .accessibilityIdentifier("wizard-avatar")
                VStack(alignment: .leading, spacing: 10) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Name").font(Theme.Font.preview).foregroundStyle(Theme.textSecondary)
                        TextField("Name your Bot", text: $name)
                            .textFieldStyle(.roundedBorder)
                            .onSubmit { saveText() }
                            .accessibilityIdentifier("wizard-name")
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Role").font(Theme.Font.preview).foregroundStyle(Theme.textSecondary)
                        rolePicker
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            WizardCard(title: String(localized: "Description")) {
                TextField("What it does for you", text: $description, axis: .vertical)
                    .lineLimit(2...4)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { saveText() }
                    .accessibilityIdentifier("wizard-description")
                Text("Its role in one sentence, shown in rosters, on the phone and to other bots. Longer instructions go in the Soul step.")
                    .font(Theme.Font.preview).foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("wizard-description-help")
            }
            WizardCard(title: String(localized: "Mascot and skin")) {
                CharacterEditor(draft: Binding(get: { look }, set: { saveLook($0) }), metrics: .profileCard, unlocks: session.isDemo ? .demo : .nothingLocked)
            }
            WizardCard(title: nil) {
                Toggle(isOn: Binding(get: { bot.chiefOfStaff == true }, set: { on in Task { await setPrimary(on) } })) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Primary Bot").font(Theme.Font.body).foregroundStyle(Theme.textPrimary)
                        Text(bot.chiefOfStaff == true ? "This is your Primary Bot: it can act on your other bots for you." : "Make it your Primary Bot, the one that acts on your other bots for you.")
                            .font(Theme.Font.preview).foregroundStyle(Theme.textSecondary)
                    }
                }
                .accessibilityIdentifier("wizard-primary")
            }
        }
        .onAppear {
            guard !loaded else { return }
            loaded = true
            name = bot.name
            description = bot.description
            shownName = bot.name
            shownDescription = bot.description
            look = CharacterDraft(bot: bot)
        }
        .onChange(of: bot.name) { fresh in
            if name == shownName { name = fresh }
            shownName = fresh
        }
        .onChange(of: bot.description) { fresh in
            if description == shownDescription { description = fresh }
            shownDescription = fresh
        }
        .onDisappear { saveText() }
    }

    /// The role as one compact menu (no wrapping chips).
    private var rolePicker: some View {
        Menu {
            Picker("Role", selection: Binding(get: { WizardRole(rawValue: draft.roleId) }, set: { choose($0) })) {
                ForEach(WizardRole.allCases, id: \.self) { role in
                    Text(roleTitle(role)).tag(WizardRole?.some(role))
                }
                Text(roleTitle(nil)).tag(WizardRole?.none)
            }
        } label: {
            HStack(spacing: 6) {
                Text(roleTitle(WizardRole(rawValue: draft.roleId)))
                    .font(Theme.Font.body)
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                Spacer(minLength: 4)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
            }
            .padding(.horizontal, 10)
            .frame(height: 34)
            .background(Theme.cardRaised, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .accessibilityHint(Text("A role fills in the role sentence, a starting soul and the suggestions of the next steps. Everything stays editable."))
        .accessibilityIdentifier("wizard-role")
    }

    private func choose(_ role: WizardRole?) {
        let previous = WizardRole(rawValue: draft.roleId)
        guard role != previous else { return }
        Task {
            await patch(WizardPatch(roleId: role?.rawValue ?? ""))
            guard let role else { return }
            // the role fills what is still empty or still the previous
            // role's; the person's own words stay
            func replaceable(_ value: String, _ before: String?) -> Bool {
                value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || value == before
            }
            var change = BotProfilePatch()
            if replaceable(bot.title, previous?.defaults.title) { change.title = role.defaults.title }
            if replaceable(description, previous?.defaults.description) {
                description = role.defaults.description
                change.description = role.defaults.description
            }
            if change.title != nil || change.description != nil { _ = await session.updateProfile(change, for: bot) }
        }
    }

    private func saveText() {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        var change = BotProfilePatch()
        // only what the person changed here
        if !trimmed.isEmpty, name != shownName, trimmed != bot.name { change.name = trimmed }
        if description != shownDescription, description != bot.description { change.description = description }
        guard change.name != nil || change.description != nil else { return }
        Task { _ = await session.updateProfile(change, for: bot) }
    }

    private func saveLook(_ next: CharacterDraft) {
        let previous = look
        guard next != previous else { return }
        look = next
        var change = BotProfileEdit()
        if next.color != previous.color { change.color = next.color }
        if next.look != previous.look { change.mascotLook = next.look }
        if next.skin != previous.skin { change.mascotSkin = next.skin }
        guard !change.isEmpty, let client = session.profileClient else { return }
        Task {
            do { session.applyProfileBot(try await client.editBot(botId: bot.id, edit: change)) }
            catch { look = previous; session.actionError = error.localizedDescription }
        }
    }

    private func setPrimary(_ on: Bool) async {
        guard let client = session.profileClient else { return }
        do { session.applyProfileBot(try await client.setWizardPrimary(botId: bot.id, on: on)) }
        catch { session.actionError = error.localizedDescription }
    }
}

// MARK: 2 Soul

struct WizardSoulStep: View {
    let bot: Bot
    let draft: WizardDraft
    let suggestions: WizardSuggestions
    let language: String
    let patch: (WizardPatch) async -> Void
    @EnvironmentObject private var session: Session
    @State private var answers = WizardAnswers()
    @State private var soul = ""
    @State private var writing = false
    @State private var loaded = false
    /// The soul as the server keeps it (`GET /api/bots/:id/soul`).
    @State private var saved = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(WizardAnswers.Key.allCases, id: \.self) { key in
                WizardCard(title: label(key)) {
                    TextField(placeholder(key), text: Binding(get: { answers[key] }, set: { answers[key] = $0 }), axis: .vertical)
                        .lineLimit(1...4)
                        .textFieldStyle(.roundedBorder)
                        .onSubmit { save(key) }
                        .accessibilityIdentifier("wizard-answer-\(key.rawValue)")
                    if let suggestion = suggestions.answers?[key], !suggestion.isEmpty, suggestion != answers[key] {
                        Button { answers[key] = suggestion; save(key) } label: {
                            Text("Suggestion: \(suggestion)").font(Theme.Font.preview).foregroundStyle(Theme.accent).multilineTextAlignment(.leading)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            Button { Task { await writeForMe() } } label: {
                HStack(spacing: 6) {
                    if writing { ProgressView() } else { Image(systemName: "wand.and.stars") }
                    Text(writing ? "Writing…" : "Write it for me")
                }
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.primaryInk)
                .padding(.horizontal, 16).frame(height: 38)
                .background(Theme.primaryFill, in: Capsule())
            }
            .buttonStyle(.plain)
            .disabled(writing)
            .accessibilityIdentifier("wizard-write-soul")
            WizardCard(title: String(localized: "Soul")) {
                TextEditor(text: $soul)
                    .frame(minHeight: 180)
                    .font(.system(size: 14))
                    .scrollContentBackground(.hidden)
                    .accessibilityIdentifier("wizard-soul")
                Button("Save the soul") { Task { await saveSoul() } }
                    .disabled(soul == saved)
            }
        }
        .onAppear {
            guard !loaded else { return }
            loaded = true
            answers = draft.answers
            Task {
                if let read = try? await session.profileClient?.soul(botId: bot.id) {
                    saved = read.soul
                    if soul.isEmpty { soul = read.soul }
                }
            }
        }
        .onChange(of: draft.answers) { answers = $0 }
        .onDisappear { Task { await saveSoul() } }
    }

    private func label(_ key: WizardAnswers.Key) -> String {
        switch key {
        case .tone: String(localized: "Tone")
        case .language: String(localized: "Language")
        case .does: String(localized: "What it does")
        case .never: String(localized: "What it never does")
        case .speech: String(localized: "How it talks")
        }
    }

    private func placeholder(_ key: WizardAnswers.Key) -> String {
        switch key {
        case .tone: String(localized: "Friendly, direct, formal…")
        case .language: String(localized: "Quebec French, English, the language of each message…")
        case .does: String(localized: "Its job, in your words")
        case .never: String(localized: "The lines it never crosses")
        case .speech: String(localized: "Short replies, lists, one question at a time…")
        }
    }

    private func save(_ key: WizardAnswers.Key) {
        let value = answers[key]
        Task { await patch(WizardPatch(answers: [key.rawValue: value])) }
    }

    private func writeForMe() async {
        guard let client = session.profileClient else { return }
        writing = true
        defer { writing = false }
        await patch(WizardPatch(answers: Dictionary(uniqueKeysWithValues: WizardAnswers.Key.allCases.map { ($0.rawValue, answers[$0]) })))
        do {
            let written = try await client.writeWizardSoul(botId: bot.id, language: language)
            soul = written.soul
            await saveSoul()
        } catch {
            session.actionError = error.localizedDescription
        }
    }

    private func saveSoul() async {
        guard soul != saved, let client = session.profileClient else { return }
        do {
            session.applyProfileBot(try await client.saveSoul(botId: bot.id, soul: soul))
            saved = soul
        }
        catch { session.actionError = error.localizedDescription }
    }
}

// MARK: 3 Rules

struct WizardRulesStep: View {
    let bot: Bot
    let draft: WizardDraft
    let suggestions: WizardSuggestions
    let patch: (WizardPatch) async -> Void
    @EnvironmentObject private var session: Session
    @State private var confirmingFull = false
    @State private var working: String?
    /// The applied rules' own effects, read back (the person may have
    /// changed one here or in the bot's rules).
    @State private var read: [String: WizardRuleEffect] = [:]

    private var level: ApprovalLevel { ApprovalLevel.of(approvalMode: bot.approvalMode, autoApprove: nil) }
    private var effects: [String: WizardRuleEffect] { BotWizardRules.currentEffects(draft: draft, suggestions: suggestions, read: read) }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            WizardCard(title: String(localized: "Approval level")) {
                Picker("Approval level", selection: Binding(get: { level }, set: { choose($0) })) {
                    ForEach([ApprovalLevel.ask, .edits, .auto, .full], id: \.self) { item in
                        Text(approvalLevelTitle(item)).tag(item)
                    }
                }
                .pickerStyle(.menu)
                .accessibilityIdentifier("wizard-approval")
                Text(LocalizedStringKey(level.detail)).font(Theme.Font.preview).foregroundStyle(Theme.textSecondary)
            }
            WizardCard(title: String(localized: "Suggested rules")) {
                Text("Rules apply before the approval level, whatever the level. An effect you pick is saved at once for this bot; Off removes the rule.")
                    .font(Theme.Font.preview).foregroundStyle(Theme.textSecondary)
                ForEach(suggestions.rules) { rule in
                    ruleRow(rule)
                    if rule.id != suggestions.rules.last?.id { Divider() }
                }
            }
            toolsQuestion
        }
        .task(id: draft.rules) {
            guard let client = session.profileClient, let found = try? await client.wizardRuleEffects(draft: draft) else { return }
            read.merge(found) { _, fresh in fresh }
        }
        .alert("Full access", isPresented: $confirmingFull) {
            Button("Cancel", role: .cancel) {}
            Button("Turn on Full access", role: .destructive) { Task { _ = await sendPanelPatch(.approval(.full), bot: bot, session: session) } }
        } message: {
            Text(LocalizedStringKey(ApprovalLevel.full.detail))
        }
    }

    /// One row per suggestion: the rule, its suggested effect under it, and
    /// one small selector (Off, Allow, Ask, Deny).
    private func ruleRow(_ rule: WizardRuleSuggestion) -> some View {
        let suggested = WizardRuleEffect(rawValue: rule.behavior) ?? .ask
        let label = VStack(alignment: .leading, spacing: 2) {
            Text(sentence(rule.when)).font(Theme.Font.body).foregroundStyle(Theme.textPrimary)
            Text("Suggested: \(effectTitle(suggested))").font(Theme.Font.preview).foregroundStyle(Theme.textTertiary)
        }
        let selector = Picker(String(localized: "Effect of the rule: \(rule.when)"), selection: Binding(
            get: { effects[rule.id].map(EffectChoice.on) ?? .off },
            set: { choice in Task { await change(rule, to: choice.effect) } }
        )) {
            // its own key: "Non" in French, where Off elsewhere reads "Désactivé"
            Text(String(localized: "botWizard.rules.effect.off", defaultValue: "Off")).tag(EffectChoice.off)
            ForEach(WizardRuleEffect.allCases, id: \.self) { effect in
                Text(effectTitle(effect)).tag(EffectChoice.on(effect))
            }
        }
        .pickerStyle(.segmented)
        .disabled(working == rule.id)
        .accessibilityIdentifier("wizard-rule-\(rule.id)")
        return ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) {
                label.frame(minWidth: 140, alignment: .leading)
                Spacer(minLength: 0)
                selector.fixedSize()
            }
            VStack(alignment: .leading, spacing: 8) {
                label
                selector
            }
        }
        .padding(.vertical, 2)
    }

    /// "Should this bot use apps or a computer?": Yes puts Tools and apps
    /// next, Later keeps the defaults.
    private var toolsQuestion: some View {
        WizardCard(title: nil) {
            Text("Should this bot use apps or a computer?").font(Theme.Font.body).foregroundStyle(Theme.textPrimary)
            Text("Yes adds the Tools and apps step next. Later keeps the defaults: Workspace on Auto, no MCP server, apps connected later.")
                .font(Theme.Font.preview).foregroundStyle(Theme.textSecondary)
            Picker("Should this bot use apps or a computer?", selection: Binding(
                get: { draft.tools ?? .later },
                set: { choice in Task { await patch(WizardPatch(tools: choice)) } }
            )) {
                Text("Later").tag(WizardToolsChoice.later)
                Text("Yes").tag(WizardToolsChoice.yes)
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("wizard-tools-question")
        }
    }

    private func choose(_ next: ApprovalLevel) {
        guard next != level else { return }
        if next == .full { confirmingFull = true; return }
        Task { _ = await sendPanelPatch(.approval(next), bot: bot, session: session) }
    }

    /// Off deletes the custom rule; another effect changes the applied rule
    /// in place, or makes it (desktop `setSuggestedRuleEffect`).
    private func change(_ rule: WizardRuleSuggestion, to effect: WizardRuleEffect?) async {
        guard let client = session.profileClient else { return }
        working = rule.id
        defer { working = nil }
        let existing = draft.rules[rule.id].flatMap { $0.isEmpty || $0 == "pending" ? nil : $0 }
        do {
            if let effect {
                if let existing {
                    try await client.setWizardRuleEffect(ruleId: existing, effect: effect)
                } else if let made = try await client.addWizardRule(botId: bot.id, suggestion: rule, effect: effect) {
                    await patch(WizardPatch(rules: [rule.id: made]))
                }
                read[rule.id] = effect
            } else {
                // already removed by hand: the draft forgets it all the same
                if let existing { try? await client.removeWizardRule(ruleId: existing) }
                await patch(WizardPatch(rules: [rule.id: nil]))
                read[rule.id] = nil
            }
        } catch {
            session.actionError = error.localizedDescription
        }
    }
}

/// A rule's selector value: Off, or one effect.
private enum EffectChoice: Hashable {
    case off
    case on(WizardRuleEffect)

    var effect: WizardRuleEffect? {
        if case let .on(effect) = self { return effect }
        return nil
    }
}

func effectTitle(_ effect: WizardRuleEffect) -> String {
    switch effect {
    case .allow: String(localized: "Allow")
    case .ask: String(localized: "Ask")
    case .deny: String(localized: "Deny")
    }
}

func approvalLevelTitle(_ level: ApprovalLevel) -> String {
    switch level {
    case .ask: String(localized: "Ask for approval")
    case .edits: String(localized: "Auto-accept edits")
    case .auto: String(localized: "Approve for me")
    case .full: String(localized: "Full access")
    case .custom: String(localized: "Custom")
    }
}

private func sentence(_ text: String) -> String {
    guard let first = text.first else { return text }
    return first.uppercased() + text.dropFirst()
}

// MARK: 4 Tools and apps

struct WizardToolsStep: View {
    let bot: Bot
    let suggestions: WizardSuggestions
    @EnvironmentObject private var session: Session
    @State private var all = false

    private var tools: [String] { all ? ["apps", "mcp", "computer", "browser"] : suggestions.tools }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if tools.contains("apps") {
                WizardCard(title: String(localized: "Apps")) {
                    Text(suggestions.apps.isEmpty ? String(localized: "Connect the apps this bot will work with.") : String(localized: "This role usually uses: \(suggestions.apps.joined(separator: ", ")).")
                    ).font(Theme.Font.preview).foregroundStyle(Theme.textSecondary)
                    Text("Connect them from Capabilities, on this device or on your computer.").font(Theme.Font.preview).foregroundStyle(Theme.textSecondary)
                }
                .accessibilityIdentifier("wizard-tool-apps")
            }
            if tools.contains("mcp") {
                WizardCard(title: String(localized: "MCP servers")) {
                    if bot.mcpServers == nil {
                        Text("This bot uses every MCP server that is turned on. Pick them one by one in its Access settings.")
                            .font(Theme.Font.preview).foregroundStyle(Theme.textSecondary)
                    } else {
                        // the wizard's default: no MCP server (2026-10-27)
                        Text(mcpSummaryText(bot.mcpServers)).font(Theme.Font.body).foregroundStyle(Theme.textPrimary)
                        Text("Pick the MCP servers one by one in its Access settings.")
                            .font(Theme.Font.preview).foregroundStyle(Theme.textSecondary)
                    }
                }
                .accessibilityIdentifier("wizard-tool-mcp")
            }
            if tools.contains("computer") {
                WizardCard(title: String(localized: "Works on")) {
                    Picker("Works on", selection: Binding(get: { bot.computer == "off" ? "off" : "auto" }, set: { value in
                        Task { _ = await sendPanelPatch(BotPanelPatch(computer: value), bot: bot, session: session) }
                    })) {
                        Text("Auto").tag("auto")
                        Text("Off").tag("off")
                    }
                    .pickerStyle(.segmented)
                }
                .accessibilityIdentifier("wizard-tool-computer")
            }
            if tools.contains("browser") {
                WizardCard(title: nil) {
                    Toggle("Browser", isOn: Binding(get: { bot.browser != false }, set: { on in
                        Task { _ = await sendPanelPatch(BotPanelPatch(browser: on), bot: bot, session: session) }
                    }))
                }
                .accessibilityIdentifier("wizard-tool-browser")
            }
            if !all && suggestions.tools.count < 4 {
                Button("Show every tool") { all = true }.font(Theme.Font.preview)
            }
        }
    }
}

// MARK: 5 Routines

struct WizardRoutinesStep: View {
    let draft: WizardDraft
    let suggestions: WizardSuggestions
    let patch: (WizardPatch) async -> Void

    private var days: [String] {
        [String(localized: "Sun"), String(localized: "Mon"), String(localized: "Tue"), String(localized: "Wed"), String(localized: "Thu"), String(localized: "Fri"), String(localized: "Sat")]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(suggestions.routines) { routine in
                WizardCard(title: nil) {
                    Toggle(isOn: Binding(get: { draft.routines.contains(routine.id) }, set: { on in
                        let next = on ? draft.routines + [routine.id] : draft.routines.filter { $0 != routine.id }
                        Task { await patch(WizardPatch(routines: next)) }
                    })) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(routine.name).font(Theme.Font.body).foregroundStyle(Theme.textPrimary)
                            Text(BotWizardRules.scheduleLabel(time: routine.time, weekdays: routine.weekdays, dayNames: days,
                                                              weekdaysLabel: String(localized: "weekdays"), everyDay: String(localized: "every day")))
                                .font(Theme.Font.preview).foregroundStyle(Theme.textSecondary)
                            Text(routine.prompt).font(Theme.Font.preview).foregroundStyle(Theme.textSecondary)
                        }
                    }
                    .accessibilityIdentifier("wizard-routine-\(routine.id)")
                }
            }
            Text("The routines you tick are created when you finish.").font(Theme.Font.preview).foregroundStyle(Theme.textSecondary)
        }
    }
}

// MARK: 6 Recap and try

func mcpSummaryText(_ servers: [String]?) -> String {
    switch BotWizardRules.mcpSummary(servers) {
    case .all: String(localized: "Every MCP server")
    case .none: String(localized: "No MCP server")
    case let .some(names): String(localized: "MCP: \(names.joined(separator: ", "))")
    }
}

private struct RecapLine {
    let step: WizardStep
    let text: String
}

/// The last step (2026-10-27): a compact read-only summary. The bot in one
/// card (avatar, name, role, description) with Try it, then one line per
/// step with Edit, which opens that step; the test conversation under it.
/// Finish stays in the footer.
struct WizardRecapStep: View {
    let bot: Bot
    let draft: WizardDraft
    let suggestions: WizardSuggestions
    let language: String
    let patch: (WizardPatch) async -> Void
    let goTo: (WizardStep) -> Void
    @EnvironmentObject private var session: Session
    @State private var sending = false
    @State private var soul: String?
    @State private var read: [String: WizardRuleEffect] = [:]

    private var roleName: String { roleTitle(WizardRole(rawValue: draft.roleId)) }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 14) {
                    BotMascotView(bot: bot, size: 56, state: .happy, animated: false)
                        .frame(width: 56, height: 56)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(bot.name).font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.textPrimary).lineLimit(1)
                        Text(roleName).font(Theme.Font.preview).foregroundStyle(Theme.accent).lineLimit(1)
                            .accessibilityIdentifier("wizard-recap-role")
                        Text(bot.description.isEmpty ? (bot.title.isEmpty ? String(localized: "No description yet") : bot.title) : bot.description)
                            .font(Theme.Font.preview).foregroundStyle(Theme.textSecondary).lineLimit(2)
                    }
                    Spacer(minLength: 0)
                }
                Button { Task { await tryIt() } } label: {
                    HStack(spacing: 6) {
                        if sending { ProgressView().tint(Theme.primaryInk) } else { Image(systemName: "paperplane") }
                        Text("Try it")
                    }
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.primaryInk)
                    .frame(maxWidth: .infinity)
                    .frame(height: 42)
                    .background(Theme.primaryFill, in: Capsule())
                }
                .buttonStyle(.plain)
                .disabled(sending)
                .accessibilityIdentifier("wizard-try")
            }
            .padding(14)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("wizard-recap-card")
            VStack(spacing: 0) {
                ForEach(Array(lines.enumerated()), id: \.offset) { index, line in
                    if index > 0 { Divider().padding(.leading, 14) }
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text(stepTitle(line.step))
                            .font(Theme.Font.bodyMedium).foregroundStyle(Theme.textPrimary)
                            .frame(width: 96, alignment: .leading)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(line.text).font(Theme.Font.preview).foregroundStyle(Theme.textSecondary)
                                .accessibilityIdentifier("wizard-recap-summary-\(line.step.rawValue)")
                            if draft.skipped.contains(line.step) {
                                Text("skipped").font(Theme.Font.preview).foregroundStyle(Theme.textTertiary)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        Button("Edit") { goTo(line.step) }
                            .font(Theme.Font.bodyMedium)
                            .foregroundStyle(Theme.accent)
                            .accessibilityLabel(Text("Edit \(stepTitle(line.step))"))
                            .accessibilityIdentifier("wizard-recap-edit-\(line.step.rawValue)")
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                }
            }
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            if let threadId = draft.testThreadId {
                WizardChatView(botId: bot.id, threadId: threadId)
                    .frame(height: 320)
                    .background(Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
        }
        .task {
            guard let client = session.profileClient else { return }
            if let found = try? await client.soul(botId: bot.id) { soul = found.soul }
            if let found = try? await client.wizardRuleEffects(draft: draft) { read = found }
        }
    }

    /// One line of words per step, read only (desktop `recapLines`).
    private var lines: [RecapLine] {
        let identity = [roleName, bot.chiefOfStaff == true ? String(localized: "Primary Bot") : ""].filter { !$0.isEmpty }.joined(separator: " · ")
        let answered = BotWizardRules.answeredCount(draft.answers)
        let soulLine = (soul ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? String(localized: "Not written yet")
            : String(localized: "Written · \(answered.answered) of \(answered.total) answers")
        let counts = BotWizardRules.ruleCounts(BotWizardRules.currentEffects(draft: draft, suggestions: suggestions, read: read))
        let parts = [
            counts.ask > 0 ? String(localized: "\(counts.ask) asked") : "",
            counts.deny > 0 ? String(localized: "\(counts.deny) denied") : "",
            counts.allow > 0 ? String(localized: "\(counts.allow) allowed") : "",
        ].filter { !$0.isEmpty }
        let level = bot.approvalMode == nil ? "" : approvalLevelTitle(ApprovalLevel.of(approvalMode: bot.approvalMode, autoApprove: nil))
        let rules = [level, parts.isEmpty ? String(localized: "No rule") : parts.joined(separator: ", ")].filter { !$0.isEmpty }.joined(separator: " · ")
        let place = bot.computer == "off" ? String(localized: "Off") : String(localized: "Auto")
        let tools = [
            String(localized: "Workspace: \(place)"),
            mcpSummaryText(bot.mcpServers),
            suggestions.apps.isEmpty ? String(localized: "Apps connected later") : String(localized: "Apps to connect: \(suggestions.apps.joined(separator: ", "))"),
        ].joined(separator: " · ")
        let picked = BotWizardRules.pickedRoutineNames(draft: draft, suggestions: suggestions)
        let routines = picked.isEmpty ? String(localized: "No routine") : picked.joined(separator: ", ")
        return [RecapLine(step: .identity, text: identity), RecapLine(step: .soul, text: soulLine), RecapLine(step: .rules, text: rules),
                RecapLine(step: .tools, text: tools), RecapLine(step: .routines, text: routines)]
    }

    private func tryIt() async {
        guard let client = session.profileClient else { return }
        sending = true
        defer { sending = false }
        do {
            var threadId = draft.testThreadId
            if threadId == nil {
                let opened = try await client.openWizardThread(botId: bot.id, title: String(localized: "First try"))
                await patch(WizardPatch(testThreadId: opened))
                threadId = opened
            }
            if let threadId {
                _ = try await client.send(text: BotWizardRules.tryIt(french: language == "fr"), toBot: bot.id, threadId: threadId)
            }
        } catch {
            session.actionError = error.localizedDescription
        }
    }
}

// MARK: The conversation

/// A conversation inside the wizard: its messages read back every two
/// seconds while it is open, and a field to answer. The guided one with
/// the Primary Bot, and Try it with the new bot.
struct WizardChatView: View {
    let botId: String
    let threadId: String
    @EnvironmentObject private var session: Session
    @State private var messages: [Message] = []
    @State private var text = ""
    @State private var sending = false

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 8) {
                        ForEach(messages.filter { $0.kind == .text && !($0.text ?? "").isEmpty }) { message in
                            HStack {
                                if message.role == .user { Spacer(minLength: 40) }
                                Text(message.text ?? "")
                                    .font(Theme.Font.body)
                                    .foregroundStyle(message.role == .user ? Theme.primaryInk : Theme.textPrimary)
                                    .padding(.horizontal, 12).padding(.vertical, 8)
                                    .background(message.role == .user ? Theme.primaryFill : Theme.cardRaised, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                                    .textSelection(.enabled)
                                if message.role != .user { Spacer(minLength: 40) }
                            }
                            .id(message.id)
                        }
                    }
                    .padding(14)
                }
                .onChange(of: messages.count) { _ in
                    if let last = messages.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
                }
            }
            HStack(spacing: 8) {
                TextField("Answer…", text: $text, axis: .vertical)
                    .lineLimit(1...4)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityIdentifier("wizard-chat-field")
                Button { Task { await send() } } label: { Image(systemName: "arrow.up.circle.fill").font(.system(size: 28)) }
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || sending)
                    .accessibilityLabel(Text("Send"))
            }
            .padding(10)
        }
        .task(id: threadId) {
            while !Task.isCancelled {
                if let client = session.profileClient, let page = try? await client.messages(threadId: threadId, limit: 60) {
                    messages = page.messages
                }
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
        .accessibilityIdentifier("wizard-chat")
    }

    private func send() async {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, let client = session.profileClient else { return }
        sending = true
        defer { sending = false }
        do {
            _ = try await client.send(text: value, toBot: botId, threadId: threadId)
            text = ""
            if let page = try? await client.messages(threadId: threadId, limit: 60) { messages = page.messages }
        } catch {
            session.actionError = error.localizedDescription
        }
    }
}
