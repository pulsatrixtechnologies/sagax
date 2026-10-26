// Approval rules on the phone: the desktop's custom rules
// (CustomRulesCard.tsx) and allowed recipients (AllowedRecipientsRow.tsx),
// plus the always-allowed tools the Access section already removes.
// The words and the routes are the desktop's. This screen does not add a
// rule kind, and an exact command is still allowed only from its card.
import CompanionCore
import SwiftUI

struct ApprovalGrantsPage: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.settingsPop) private var settingsPop
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var session: Session

    /// Nil on the Settings row: the person picks a bot. Set from a bot's
    /// Permissions, where the bot is already known.
    var botId: String?
    var showsDone = false

    @State private var picked: String?
    @State private var role: String?
    @State private var principalId: String?
    @State private var readOnly = false
    @State private var rules: [CustomRuleRow]?
    @State private var alwaysAllow = true
    @State private var error: String?
    @State private var saving = false
    @State private var editor: Editor?
    @State private var whenText = ""
    @State private var behavior: CustomRuleBehavior = .allow
    @State private var applies = Applies.thisBot
    @State private var chosen: Set<String> = []
    @State private var risks: Set<CustomRuleRisk> = []
    @State private var draft = ""

    private enum Editor: Equatable { case new, existing(String) }
    private enum Applies: String, Hashable { case thisBot, all, some }

    private var activeId: String? {
        if let botId { return botId }
        if let picked, bots.contains(where: { $0.id == picked }) { return picked }
        return bots.first?.id
    }

    private var bots: [Bot] {
        session.state.bots.filter { $0.hidden != true }
    }

    private var bot: Bot? {
        guard let activeId else { return nil }
        return session.state.bot(activeId) ?? bots.first { $0.id == activeId }
    }

    var body: some View {
        if settingsPop != nil {
            SettingsPage(title: "Approval rules", scrollable: false) {
                list.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            }
        } else {
            list
                .navigationTitle("Approval rules")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    if showsDone {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { dismiss() }
                                .accessibilityIdentifier("approval-grants-done")
                        }
                    }
                }
        }
    }

    private var list: some View {
        List {
            if botId == nil {
                Section {
                    if bots.isEmpty {
                        Text("No bots yet.")
                            .foregroundStyle(Theme.textSecondary)
                    } else {
                        Picker("Bot", selection: Binding(get: { activeId ?? "" }, set: { picked = $0 })) {
                            ForEach(bots) { candidate in
                                Text(verbatim: candidate.name).tag(candidate.id)
                            }
                        }
                        .accessibilityIdentifier("approval-grants-bot")
                    }
                }
            }
            if let bot {
                rulesSection(bot)
                recipientsSection(bot)
                alwaysSection(bot)
            }
            // this iPhone's phone tools and their "Toujours permettre" (Features/PhoneTools)
            if botId == nil { PhoneToolsSettingsSections() }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .accessibilityIdentifier("approval-grants")
        .task(id: activeId) { await load() }
        .onChange(of: activeId) { _ in editor = nil }
    }

    // MARK: Custom rules

    @ViewBuilder
    private func rulesSection(_ bot: Bot) -> some View {
        let canEdit = ApprovalGrantGate.managesRules(role: role, principalId: principalId, ownerUserId: bot.ownerUserId)
        let shown = rules ?? []
        let hasAllow = shown.contains { !$0.org && $0.behavior == .allow && $0.enabled }
        Section {
            if rules == nil {
                ProgressView().tint(Theme.textSecondary)
            }
            if !alwaysAllow {
                note("Your organization requires an approval each time: Always allow is off and your \"Allow automatically\" rules are paused. \"Ask first\" and \"Refuse\" rules still apply.")
            }
            if alwaysAllow, hasAllow, bot.approvalMode == "full" {
                note("Full access: this bot already acts without asking, so \"Allow automatically\" rules change nothing here. \"Ask first\" and \"Refuse\" rules still apply.")
            }
            if shown.isEmpty, editor != .new, rules != nil {
                Text("No custom rule yet. Example: \"always allow reading files in ~/Documents\".")
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("custom-rules-empty")
            }
            ForEach(shown) { rule in
                if editor == .existing(rule.id), canEdit, !rule.org {
                    form(bot)
                } else {
                    ruleRow(rule, bot: bot, canEdit: canEdit)
                }
            }
            if editor == .new, canEdit {
                form(bot)
            } else if canEdit {
                Button("Add a rule") { beginNew() }
                    .disabled(saving)
                    .accessibilityIdentifier("custom-rule-add")
            }
            if let error {
                Text(verbatim: error)
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.danger)
                    .accessibilityIdentifier("approval-grants-error")
            }
        } header: {
            Text("Custom rules")
        } footer: {
            Text("Write a short rule in plain words for each action. \"Refuse\" wins over \"Ask first\", which wins over \"Allow automatically\". For the shell, only exact commands and plain reads of a folder can be allowed. These rules apply only to you, and the built-in safety checks always apply. Automatic review: a light model also reads your rules and approves or refuses the cards they clearly cover, with its reason on the card. When it is unsure, the card stays yours. It never allows a shell command, or a risky action your rule does not tick.")
        }
    }

    @ViewBuilder
    private func ruleRow(_ rule: CustomRuleRow, bot: Bot, canEdit: Bool) -> some View {
        let paused = !alwaysAllow && rule.behavior == .allow
        VStack(alignment: .leading, spacing: 4) {
            Text(verbatim: rule.when)
                .font(Theme.Font.rowTitle)
                .foregroundStyle(Theme.textPrimary)
            HStack(spacing: 8) {
                Text(verbatim: rule.behavior.label)
                    .font(Theme.Font.label)
                    .foregroundStyle(rule.behavior == .deny ? Theme.danger : rule.behavior == .allow ? Theme.success : Theme.textSecondary)
                if rule.org {
                    Text("Required by your administrator")
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.textTertiary)
                }
                if rule.botId == nil {
                    Text("All my bots")
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.textTertiary)
                }
                if paused {
                    Text("Paused by your organization")
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.warning)
                }
                if !rule.riskScope.isEmpty {
                    Text("May approve: \(rule.riskScope.map(\.label).joined(separator: ", "))")
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.warning)
                }
                if !rule.recognized {
                    Text("Automatic review")
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            if canEdit, !rule.org {
                HStack(spacing: 16) {
                    Toggle("Turn this rule on or off", isOn: Binding(get: { rule.enabled }, set: { on in
                        Task { await setEnabled(rule, on) }
                    }))
                    .labelsHidden()
                    .tint(Theme.toggleOn)
                    .disabled(saving)
                    .accessibilityLabel("Turn this rule on or off")
                    Button("Edit") { beginEdit(rule) }
                        .disabled(saving)
                        .accessibilityIdentifier("custom-rule-edit.\(rule.id)")
                    Button("Delete") { Task { await remove(rule) } }
                        .disabled(saving)
                        .foregroundStyle(Theme.danger)
                        .accessibilityIdentifier("custom-rule-delete.\(rule.id)")
                }
            }
        }
        .opacity(!rule.enabled || paused ? 0.6 : 1)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("custom-rule.\(rule.id)")
    }

    @ViewBuilder
    private func form(_ bot: Bot) -> some View {
        let compiled = whenText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : CustomRuleEditor.compile(whenText)
        let exact = behavior == .allow && (compiled?.commands.isEmpty == false)
        let canChoose = editor == .new && !exact && ownBots(bot).count > 1
        let choosing = applies == .some && canChoose
        let blocked = CustomRuleEditor.isBlocked(when: whenText, behavior: behavior, choosing: choosing, chosenEmpty: chosen.isEmpty, allowOff: !alwaysAllow)
        VStack(alignment: .leading, spacing: 10) {
            Text("When \(bot.name) wants to:")
                .font(Theme.Font.label)
                .foregroundStyle(Theme.textSecondary)
            TextField("e.g. read files in ~/Documents", text: $whenText, axis: .vertical)
                .lineLimit(2...4)
                .textInputAutocapitalization(.never)
                .accessibilityIdentifier("custom-rule-when")
            if case let .existing(id) = editor, let before = rules?.first(where: { $0.id == id })?.when, before.trimmingCharacters(in: .whitespacesAndNewlines) != whenText.trimmingCharacters(in: .whitespacesAndNewlines) {
                diff(before: before, after: whenText)
            }
            if compiled?.recognized == false {
                Text("Read by automatic review: a model judges each card against this rule. For an exact rule, name an action (read, write, send...), a folder or a tool in backticks.")
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textSecondary)
            }
            if behavior == .allow, compiled?.shellFamily == true {
                Text("For the shell, only exact commands can be allowed automatically. Write \"the exact command `...`\", or choose Ask first or Refuse.")
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.danger)
            }
            if exact {
                Text("An exact command can be allowed only from its approval card (Always allow this): it is then bound to this bot, this tool and the session's launch folder (the shell may change folder between commands).")
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.danger)
            }
            Picker("It should:", selection: $behavior) {
                ForEach(CustomRuleBehavior.allCases.filter { alwaysAllow || $0 != .allow }, id: \.self) { option in
                    Text(verbatim: option.label).tag(option)
                }
            }
            .accessibilityIdentifier("custom-rule-behavior")
            Picker("Applies to", selection: $applies) {
                Text("This bot").tag(Applies.thisBot)
                Text("All my bots").tag(Applies.all)
                if canChoose { Text("Bots I choose").tag(Applies.some) }
            }
            if choosing {
                Text("Choose the bots this rule is for:")
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textSecondary)
                ForEach(ownBots(bot)) { candidate in
                    Toggle(isOn: Binding(get: { chosen.contains(candidate.id) }, set: { on in
                        if on { chosen.insert(candidate.id) } else { chosen.remove(candidate.id) }
                    })) {
                        Text(verbatim: candidate.name)
                    }
                    .tint(Theme.toggleOn)
                }
            }
            if behavior == .allow {
                Text("This rule may also approve:")
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textSecondary)
                ForEach(CustomRuleRisk.allCases, id: \.self) { risk in
                    Toggle(isOn: Binding(get: { risks.contains(risk) }, set: { on in
                        if on { risks.insert(risk) } else { risks.remove(risk) }
                    })) {
                        Text(verbatim: risk.label)
                    }
                    .tint(Theme.toggleOn)
                }
                Text("Off by default. Without it, a risky action always asks, even when the rule matches.")
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textTertiary)
            }
            HStack {
                Spacer()
                Button("Cancel") { editor = nil }
                Button("Save rule") { Task { await save(bot, choosing: choosing) } }
                    .disabled(whenText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || saving || blocked)
                    .accessibilityIdentifier("custom-rule-save")
            }
        }
        .accessibilityIdentifier("custom-rule-form")
    }

    private func diff(before: String, after: String) -> Text {
        var line = AttributedString("Changes: ")
        line.foregroundColor = Theme.textTertiary
        for part in CustomRuleEditor.textDiff(before: before.trimmingCharacters(in: .whitespacesAndNewlines), after: after.trimmingCharacters(in: .whitespacesAndNewlines)) {
            var piece = AttributedString(part.text)
            switch part.kind {
            case .same:
                piece.foregroundColor = Theme.textSecondary
            case .removed:
                piece.foregroundColor = Theme.danger
                piece.strikethroughStyle = .single
            case .added:
                piece.foregroundColor = Theme.textPrimary
            }
            line.append(piece)
        }
        return Text(line).font(Theme.Font.label)
    }

    // MARK: Recipients

    @ViewBuilder
    private func recipientsSection(_ bot: Bot) -> some View {
        let list = bot.allowedRecipients ?? []
        let canEdit = ApprovalGrantGate.editsRecipients(role: role, botsReadOnly: readOnly, principalId: principalId, ownerUserId: bot.ownerUserId)
        let others = bots.filter { $0.id != bot.id && !list.contains("bot:\($0.id)") }
        Section {
            if list.isEmpty {
                Text("No one yet: every send asks for an approval.")
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textTertiary)
                    .accessibilityIdentifier("allowed-recipients-empty")
            }
            ForEach(list, id: \.self) { key in
                let shown = AllowedRecipients.label(key) { id in bots.first { $0.id == id }?.name }
                HStack {
                    Text(verbatim: shown.text)
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    if canEdit {
                        Button("Remove") { Task { await saveRecipients(list.filter { $0 != key }, bot: bot) } }
                            .disabled(saving)
                            .accessibilityLabel("Remove \(shown.text)")
                    }
                }
                .accessibilityIdentifier("allowed-recipient")
            }
            if !alwaysAllow {
                Text("Your organization requires an approval each time: this list is paused.")
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textSecondary)
            }
            if canEdit {
                HStack {
                    TextField("Email address or phone number", text: $draft)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("allowed-recipients-input")
                    Button("Add") { addPerson(list, bot: bot) }
                        .disabled(saving || !alwaysAllow || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityIdentifier("allowed-recipients-add")
                }
                if !others.isEmpty {
                    Menu("Add a bot") {
                        ForEach(others) { candidate in
                            Button { addBot(candidate.id, list: list, bot: bot) } label: {
                                Text(verbatim: candidate.name)
                            }
                        }
                    }
                    .disabled(saving || !alwaysAllow)
                    .accessibilityIdentifier("allowed-recipients-add-bot")
                }
            }
        } header: {
            Text("Allowed recipients")
        } footer: {
            Text(bot.approvePeerComms == true
                 ? "It writes to these people and bots without a card. For anyone else, an approval card shows. An email or a text goes without a card when every recipient is on this list. A bot on the list is reached without the confirmation step. Payments, invitations, shares, posts and replies always ask for an approval."
                 : "It writes to these people and bots without a card. For anyone else, an approval card shows. An email or a text goes without a card when every recipient is on this list. Bots on the list count once \"Ask me before contacting other bots\" is on. Payments, invitations, shares, posts and replies always ask for an approval.")
        }
    }

    // MARK: Always allowed tools

    @ViewBuilder
    private func alwaysSection(_ bot: Bot) -> some View {
        let always = bot.alwaysAllow ?? []
        let canEdit = ApprovalGrantGate.editsRecipients(role: role, botsReadOnly: readOnly, principalId: principalId, ownerUserId: bot.ownerUserId)
        Section {
            if always.isEmpty {
                Text("Nothing standing yet.")
                    .foregroundStyle(Theme.textSecondary)
            }
            ForEach(always, id: \.self) { entry in
                HStack {
                    Text(verbatim: entry)
                        .font(Theme.Font.code)
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    if canEdit {
                        Button("Remove") {
                            Task { await removeAlways(entry, from: always, bot: bot) }
                        }
                        .disabled(saving)
                        .accessibilityLabel("Remove \(entry) from always allowed")
                    }
                }
                .accessibilityIdentifier("always-allowed")
            }
        } header: {
            Text("Always allowed")
        } footer: {
            Text("Tools this bot no longer asks about. A new one is saved from its approval card, not typed here.")
        }
    }

    private func note(_ text: String) -> some View {
        Text(verbatim: text)
            .font(Theme.Font.label)
            .foregroundStyle(Theme.textSecondary)
    }

    private func ownBots(_ bot: Bot) -> [Bot] {
        bots.filter { $0.id == bot.id || $0.ownerUserId == bot.ownerUserId }
    }

    private func beginNew() {
        whenText = ""
        behavior = alwaysAllow ? .allow : .ask
        applies = .thisBot
        chosen = []
        risks = []
        editor = .new
        error = nil
    }

    private func beginEdit(_ rule: CustomRuleRow) {
        whenText = rule.when
        behavior = !alwaysAllow && rule.behavior == .allow ? .ask : rule.behavior
        applies = rule.botId == nil ? .all : .thisBot
        chosen = []
        risks = Set(rule.riskScope)
        editor = .existing(rule.id)
        error = nil
    }

    private func load() async {
        guard let id = activeId, let client = session.settingsClient else {
            rules = []
            return
        }
        if let config = await session.configStatus() {
            role = config.viewer?.role
            principalId = config.viewer?.principalId
            readOnly = config.viewer?.botsReadOnly == true
        }
        do {
            let list = try await client.customRules(botId: id)
            rules = CustomRuleEditor.ordered(list.rules, forBot: id)
            alwaysAllow = list.alwaysAllow
        } catch {
            rules = []
            self.error = error.localizedDescription
        }
    }

    private func save(_ bot: Bot, choosing: Bool) async {
        guard let client = session.settingsClient else { return }
        let scope = behavior == .allow ? CustomRuleRisk.allCases.filter { risks.contains($0) } : []
        let targets = CustomRuleEditor.saveTargets(botId: bot.id, allBots: choosing ? false : applies == .all, chosen: choosing ? Array(chosen) : nil)
        let saved = await run { stepUp in
            if case let .existing(id) = editor {
                try await client.saveCustomRule(id: id, when: whenText, behavior: behavior, allBots: applies == .all, botId: bot.id, riskScope: scope, stepUp: stepUp)
            } else {
                for target in targets {
                    try await client.createCustomRule(when: whenText, behavior: behavior, botId: target, riskScope: scope, stepUp: stepUp)
                }
            }
        }
        if saved { editor = nil }
        await load()
    }

    private func setEnabled(_ rule: CustomRuleRow, _ on: Bool) async {
        guard let client = session.settingsClient else { return }
        await run { stepUp in
            try await client.setCustomRuleEnabled(id: rule.id, enabled: on, stepUp: stepUp)
        }
        await load()
    }

    private func remove(_ rule: CustomRuleRow) async {
        guard let client = session.settingsClient else { return }
        await run { stepUp in
            try await client.deleteCustomRule(id: rule.id, stepUp: stepUp)
        }
        await load()
    }

    private func addPerson(_ list: [String], bot: Bot) {
        switch AllowedRecipients.addingPerson(draft, to: list) {
        case .invalid:
            error = AllowedRecipients.failureText(apiCode: "invalid_recipients", serverMessage: nil)
        case .unchanged:
            draft = ""
        case let .next(next):
            draft = ""
            Task { await saveRecipients(next, bot: bot) }
        }
    }

    private func addBot(_ id: String, list: [String], bot: Bot) {
        guard let next = AllowedRecipients.addingBot(id: id, to: list) else {
            error = AllowedRecipients.failureText(apiCode: "invalid_recipients", serverMessage: nil)
            return
        }
        Task { await saveRecipients(next, bot: bot) }
    }

    private func saveRecipients(_ next: [String], bot: Bot) async {
        guard let client = session.settingsClient else { return }
        await run { stepUp in
            let updated = try await client.patchAllowedRecipients(botId: bot.id, recipients: next, stepUp: stepUp)
            session.applyProfileBot(updated)
        }
    }

    private func removeAlways(_ entry: String, from always: [String], bot: Bot) async {
        guard let client = session.settingsClient else { return }
        saving = true
        defer { saving = false }
        error = nil
        do {
            let updated = try await client.patchBotAccess(botId: bot.id, patch: BotAccessPatch(alwaysAllow: always.filter { $0 != entry }))
            session.applyProfileBot(updated)
        } catch {
            self.error = error.localizedDescription
        }
    }

    @discardableResult
    private func run(_ work: (String?) async throws -> Void) async -> Bool {
        guard let client = session.settingsClient else { return false }
        saving = true
        defer { saving = false }
        error = nil
        do {
            try await Session.withStepUp(client, work)
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }
}
