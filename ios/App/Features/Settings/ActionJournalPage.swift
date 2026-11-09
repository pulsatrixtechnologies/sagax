// The Journal of the person's bots (Settings > Bots > Journal of actions):
// every action, allowed, asked, refused, failed or expired, with what decided
// it; a rule test on the last seven days; and the person's own tool access.
// The words and the contract are the desktop's (shared/action-journal.ts).
// Never an id on screen: names and the rule's own words only.
import CompanionCore
import SwiftUI

/// A key of Localizable.xcstrings, localized at run time (the labels come
/// from CompanionCore as English keys).
private func tr(_ key: String) -> String {
    String(localized: String.LocalizationValue(key))
}

private func deciderText(_ label: JournalDeciderLabel) -> String {
    let format = tr(label.key)
    guard let argument = label.argument else { return format }
    return String(format: format, argument)
}

private func outcomeText(_ outcome: JournalOutcome) -> String {
    switch outcome {
    case .allowed: tr("Allowed")
    case .asked: tr("Asked")
    case .denied: tr("Refused")
    case .failed: tr("Failed")
    case .expired: tr("Expired")
    case .unknown: tr("Not known")
    }
}

private func outcomeColor(_ outcome: JournalOutcome) -> Color {
    switch outcome {
    case .allowed: Theme.success
    case .asked: Theme.warning
    case .denied, .failed: Theme.danger
    case .expired, .unknown: Theme.textTertiary
    }
}

private func timeText(_ iso: String) -> String {
    guard let date = ActionJournal.date(iso) else { return "" }
    return date.formatted(date: .abbreviated, time: .shortened)
}

private func effectText(_ effect: RuleTestEffect) -> String {
    switch effect {
    case .allowed: tr("It would allow it")
    case .asked: tr("It would ask first")
    case .denied: tr("It would refuse it")
    case .cardStays: tr("The card would stay")
    case .unknown: tr("Not known")
    }
}

struct ActionJournalPage: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.settingsPop) private var settingsPop
    @EnvironmentObject private var session: Session

    @State private var days = ActionJournal.defaultDays
    @State private var payload: JournalPayload?
    @State private var loading = false
    @State private var error: String?
    @State private var filter = JournalFilter()
    @State private var detail: JournalEntry?
    @State private var testWhen = ""
    @State private var testBehavior: CustomRuleBehavior = .allow
    @State private var testBot = ""
    @State private var testRisks: Set<CustomRuleRisk> = []

    var body: some View {
        if settingsPop != nil {
            SettingsPage(title: "Journal of actions", scrollable: false) {
                list.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            }
        } else {
            list
                .navigationTitle("Journal of actions")
                .navigationBarTitleDisplayMode(.inline)
        }
    }

    private var entries: [JournalEntry] { payload?.entries ?? [] }
    private var counts: JournalCounts { ActionJournal.counts(entries) }
    private var shown: [JournalEntry] { ActionJournal.filter(entries, filter) }

    private var list: some View {
        List {
            filtersSection
            actionsSection
            testSection
            MyToolAccessSections()
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .accessibilityIdentifier("action-journal")
        .task(id: days) { await load() }
        .sheet(item: $detail) { entry in
            NavigationStack { ActionJournalDetail(entry: entry) }
        }
    }

    // MARK: Filters

    private var outcomeChips: [(JournalOutcome?, String)] {
        [(nil, tr("All")), (.allowed, tr("Allowed")), (.asked, tr("Asked")), (.denied, tr("Refused")), (.failed, tr("Failed")), (.expired, tr("Expired"))]
    }

    private var filtersSection: some View {
        Section {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(outcomeChips, id: \.1) { chip in
                        let selected = filter.outcome == chip.0
                        Button {
                            filter.outcome = chip.0
                        } label: {
                            Text(verbatim: "\(chip.1) \(counts.count(chip.0))")
                                .font(Theme.Font.labelMedium)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .foregroundStyle(selected ? Theme.textPrimary : Theme.textSecondary)
                                .background(Capsule().fill(selected ? Theme.toggleOn.opacity(0.25) : Color.clear))
                                .overlay(Capsule().stroke(Theme.textTertiary.opacity(0.4), lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(selected ? .isSelected : [])
                    }
                }
            }
            .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
            Picker("Bot", selection: Binding(get: { filter.bot ?? "" }, set: { filter.bot = $0.isEmpty ? nil : $0 })) {
                Text("All my bots").tag("")
                ForEach(ActionJournal.bots(entries), id: \.id) { bot in
                    Text(verbatim: bot.name).tag(bot.id)
                }
            }
            .accessibilityIdentifier("action-journal-bot")
            TextField("Search the journal", text: $filter.query)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityIdentifier("action-journal-search")
            Picker("Period", selection: $days) {
                Text("7 days").tag(7)
                Text("30 days").tag(30)
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("action-journal-days")
        }
    }

    // MARK: List

    private var actionsSection: some View {
        Section {
            if loading, payload == nil {
                ProgressView().tint(Theme.textSecondary)
            }
            if let error {
                Text(verbatim: error)
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.danger)
            }
            if payload != nil, shown.isEmpty {
                Text("Nothing here yet.")
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("action-journal-empty")
            }
            ForEach(shown) { entry in
                Button { detail = entry } label: { row(entry) }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("action-journal-row")
            }
            if payload?.truncated == true {
                Text("More actions happened than the list shows. Narrow the period or search.")
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textTertiary)
            }
        } header: {
            Text("Actions")
        } footer: {
            Text("What your bots did, and what decided it: your rules, your organization's rules, a card you answered, or the bot's approval level.")
        }
    }

    private func row(_ entry: JournalEntry) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Circle().fill(outcomeColor(entry.outcome)).frame(width: 8, height: 8)
                Text(verbatim: outcomeText(entry.outcome))
                    .font(Theme.Font.labelMedium)
                    .foregroundStyle(outcomeColor(entry.outcome))
                Spacer(minLength: 8)
                Text(verbatim: timeText(entry.at))
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textTertiary)
            }
            Text(verbatim: tr(ActionJournal.title(tool: entry.tool)))
                .font(Theme.Font.rowTitle)
                .foregroundStyle(Theme.textPrimary)
            Text(verbatim: ActionJournal.botName(entry) == ActionJournal.deletedBot ? tr("Deleted bot") : ActionJournal.botName(entry))
                .font(Theme.Font.label)
                .foregroundStyle(Theme.textSecondary)
            Text(verbatim: String(format: tr("Decided by: %@"), deciderText(ActionJournal.deciderLabel(entry))))
                .font(Theme.Font.label)
                .foregroundStyle(Theme.textSecondary)
                .lineLimit(2)
        }
        .contentShape(Rectangle())
    }

    // MARK: Rule test

    private var testBotId: String? { testBot.isEmpty ? nil : testBot }

    private var testSection: some View {
        let bots = session.state.bots.filter { $0.hidden != true }
        return Section {
            Text("When the bot wants to:")
                .font(Theme.Font.label)
                .foregroundStyle(Theme.textSecondary)
            TextField("e.g. read files in ~/Documents", text: $testWhen, axis: .vertical)
                .lineLimit(2...4)
                .textInputAutocapitalization(.never)
                .accessibilityIdentifier("action-journal-test-when")
            Picker("It should:", selection: $testBehavior) {
                Text("Allow automatically").tag(CustomRuleBehavior.allow)
                Text("Ask first").tag(CustomRuleBehavior.ask)
                Text("Refuse").tag(CustomRuleBehavior.deny)
            }
            Picker("Applies to", selection: $testBot) {
                Text("All my bots").tag("")
                ForEach(bots) { bot in
                    Text(verbatim: bot.name).tag(bot.id)
                }
            }
            if testBehavior == .allow {
                Text("This rule may also approve:")
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textSecondary)
                ForEach(CustomRuleRisk.allCases, id: \.self) { risk in
                    Toggle(isOn: Binding(get: { testRisks.contains(risk) }, set: { on in
                        if on { testRisks.insert(risk) } else { testRisks.remove(risk) }
                    })) {
                        Text(verbatim: tr(risk.label))
                    }
                    .tint(Theme.toggleOn)
                }
            }
            RuleTestRunner(draft: RuleTestDraft(
                when: testWhen.trimmingCharacters(in: .whitespacesAndNewlines),
                behavior: testBehavior,
                botId: testBotId,
                riskScope: testBehavior == .allow ? CustomRuleRisk.allCases.filter { testRisks.contains($0) } : []
            ))
        } header: {
            Text("Test a rule")
        } footer: {
            Text("Replays a rule on what your bots really did, without saving it or changing anything.")
        }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        guard let client = session.settingsClient else { return }
        do {
            payload = try await client.actionJournal(days: days)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - Detail

private struct ActionJournalDetail: View {
    let entry: JournalEntry
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List {
            Section {
                line("Action", tr(ActionJournal.title(tool: entry.tool)))
                line("Bot", ActionJournal.botName(entry) == ActionJournal.deletedBot ? tr("Deleted bot") : ActionJournal.botName(entry))
                line("Result", outcomeText(entry.outcome))
                line("When", timeText(entry.at))
                if entry.unattended == true {
                    Text("Nobody was at the keyboard.")
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            if let summary = ActionJournal.summary(entry) {
                Section("Summary") {
                    Text(verbatim: summary)
                        .font(Theme.Font.rowTitle)
                        .foregroundStyle(Theme.textPrimary)
                        .textSelection(.enabled)
                }
            }
            Section("Decided by") {
                Text(verbatim: deciderText(ActionJournal.deciderLabel(entry)))
                    .font(Theme.Font.rowTitle)
                    .foregroundStyle(Theme.textPrimary)
                if let asked = entry.askedBy, asked != entry.decider {
                    Text(verbatim: String(format: tr("A card was shown because: %@"), deciderText(ActionJournal.deciderLabel(asked, source: entry.askedSource))))
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.textSecondary)
                }
                if let rule = ActionJournal.readable(entry.ruleText) {
                    Text(verbatim: rule)
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.textSecondary)
                    if let behavior = entry.ruleBehavior {
                        Text(verbatim: tr(behavior.label))
                            .font(Theme.Font.label)
                            .foregroundStyle(Theme.textTertiary)
                    }
                }
                if let reason = ActionJournal.readable(entry.reason) {
                    Text(verbatim: reason)
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            if let note = ActionJournal.guardNote(entry.guardVerdict) {
                Section("Tool guard") {
                    Text(verbatim: tr(note))
                        .font(Theme.Font.rowTitle)
                        .foregroundStyle(entry.guardVerdict?.allow == false ? Theme.warning : Theme.textPrimary)
                    if let scope = entry.guardVerdict?.scope {
                        Text(verbatim: scope)
                            .font(Theme.Font.code)
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Action")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
        }
    }

    private func line(_ label: LocalizedStringKey, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).foregroundStyle(Theme.textSecondary)
            Spacer(minLength: 12)
            Text(verbatim: value).foregroundStyle(Theme.textPrimary).multilineTextAlignment(.trailing)
        }
        .font(Theme.Font.rowTitle)
    }
}

// MARK: - Rule test (shared with the rule editor)

/// The "Test on the last 7 days" button and its result, for a draft rule.
struct RuleTestRunner: View {
    @EnvironmentObject private var session: Session
    let draft: RuleTestDraft

    @State private var result: RuleTestResult?
    @State private var running = false
    @State private var error: String?

    var body: some View {
        Group {
            Button {
                Task { await run() }
            } label: {
                HStack {
                    Text("Test on the last 7 days")
                    if running { ProgressView().tint(Theme.textSecondary) }
                }
            }
            .disabled(running || draft.when.isEmpty)
            .accessibilityIdentifier("rule-test-run")
            if let error {
                Text(verbatim: error)
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.danger)
            }
            if let result { resultView(result) }
        }
    }

    @ViewBuilder
    private func resultView(_ result: RuleTestResult) -> some View {
        if result.unreadable {
            Text("This rule names nothing the matcher can read, so it would match nothing. Name an action (read, write, send...), a folder or a tool in backticks.")
                .font(Theme.Font.label)
                .foregroundStyle(Theme.warning)
        } else {
            let counts = result.counts
            Text(verbatim: String(format: tr("%lld of %lld actions touched"), result.matched, result.scanned))
                .font(Theme.Font.rowTitle)
                .foregroundStyle(Theme.textPrimary)
                .accessibilityIdentifier("rule-test-summary")
            Text(verbatim: String(format: tr("Would allow %lld, ask %lld, refuse %lld, card stays %lld, would change %lld"), counts.allowed, counts.asked, counts.denied, counts.cardStays, counts.changed))
                .font(Theme.Font.label)
                .foregroundStyle(Theme.textSecondary)
            ForEach(result.hits) { hit in
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 8) {
                        Text(verbatim: tr(ActionJournal.title(tool: hit.tool)))
                            .font(Theme.Font.rowTitle)
                            .foregroundStyle(Theme.textPrimary)
                        if hit.changed {
                            Text("Would change")
                                .font(Theme.Font.labelMedium)
                                .foregroundStyle(Theme.warning)
                        }
                    }
                    if let summary = ActionJournal.readable(hit.summary) {
                        Text(verbatim: summary)
                            .font(Theme.Font.label)
                            .foregroundStyle(Theme.textSecondary)
                            .lineLimit(2)
                    }
                    Text(verbatim: "\(ActionJournal.botName(hit.botName)) · \(timeText(hit.at))")
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.textTertiary)
                    Text(verbatim: String(format: tr("It happened: %@. %@."), outcomeText(hit.actual), effectText(hit.would)))
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.textSecondary)
                    if !hit.missing.isEmpty {
                        Text(verbatim: String(format: tr("The rule leaves these unticked: %@"), hit.missing.map { tr($0.label) }.joined(separator: ", ")))
                            .font(Theme.Font.label)
                            .foregroundStyle(Theme.warning)
                    }
                    if hit.approximate {
                        Text("Read from its one line: this action's details were not kept.")
                            .font(Theme.Font.label)
                            .foregroundStyle(Theme.textTertiary)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("rule-test-hit")
            }
        }
    }

    private func run() async {
        guard let client = session.settingsClient else { return }
        running = true
        defer { running = false }
        do {
            result = try await client.testRule(draft)
            error = nil
        } catch {
            result = nil
            self.error = error.localizedDescription
        }
    }
}

// MARK: - My tool access

struct MyToolAccessSections: View {
    @EnvironmentObject private var session: Session
    /// A bot's own grants (`BotToolAccess.tsx`); nil: the person's.
    var botId: String? = nil

    @State private var data: MyToolGrants?
    @State private var area = ""
    @State private var tier = "write"
    @State private var days = ""
    @State private var error: String?
    @State private var saving = false

    private func tierText(_ tier: String) -> String {
        switch tier {
        case "read": tr("Read")
        case "write": tr("Write")
        case "admin": tr("Admin")
        default: tier
        }
    }

    var body: some View {
        Section {
            if data == nil {
                ProgressView().tint(Theme.textSecondary)
            }
            if let data, data.grants.isEmpty {
                Text(botId == nil ? "No access granted yet." : "No grants: this bot has the default tool access.")
                    .foregroundStyle(Theme.textSecondary)
            }
            ForEach(data?.sorted ?? []) { grant in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: "\(grant.area) · \(tierText(grant.tier))")
                            .font(Theme.Font.rowTitle)
                            .foregroundStyle(Theme.textPrimary)
                        Text(verbatim: stateText(grant))
                            .font(Theme.Font.label)
                            .foregroundStyle(grant.state == .active ? Theme.success : Theme.textTertiary)
                    }
                    Spacer(minLength: 8)
                    if grant.state == .active {
                        Button("Revoke") { Task { await revoke(grant) } }
                            .disabled(saving)
                            .foregroundStyle(Theme.danger)
                    }
                }
                .opacity(grant.state == .active ? 1 : 0.6)
                .accessibilityElement(children: .combine)
            }
            TextField("Area, e.g. files", text: $area)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityIdentifier("my-tool-access-area")
            Picker("Level", selection: $tier) {
                ForEach(MyToolGrantForm.tiers.filter { $0 != "admin" || data?.mayGrantAdmin == true }, id: \.self) { option in
                    Text(verbatim: tierText(option)).tag(option)
                }
            }
            TextField("Days (optional)", text: $days)
                .keyboardType(.numberPad)
                .accessibilityIdentifier("my-tool-access-days")
            Button("Grant access") { Task { await grant() } }
                .disabled(saving || area.trimmingCharacters(in: .whitespaces).isEmpty)
                .accessibilityIdentifier("my-tool-access-grant")
            if let error {
                Text(verbatim: error)
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.danger)
            }
            if let areas = data?.adminOnlyAreas, !areas.isEmpty {
                Text(verbatim: String(format: tr("These areas stay with an administrator: %@."), areas.joined(separator: ", ")))
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textTertiary)
            }
        } header: {
            Text(botId == nil ? "My tool access" : "Tool access")
        } footer: {
            Text(botId == nil
                 ? "What your own bots may use beyond the defaults. You grant and revoke it yourself."
                 : "What this bot may do through tools beyond the defaults. The person it works for needs the same access.")
        }
        .task { await load() }
    }

    private func stateText(_ grant: MyToolGrant) -> String {
        switch grant.state {
        case .active:
            if let end = grant.expiresAt {
                return String(format: tr("Active until %@"), Date(timeIntervalSince1970: end / 1000).formatted(date: .abbreviated, time: .omitted))
            }
            return tr("Active, no end")
        case .expired: return tr("Expired")
        case .revoked: return tr("Revoked")
        case .unknown: return tr("Not known")
        }
    }

    private func load() async {
        guard let client = session.settingsClient else { return }
        do {
            if let botId {
                data = try await client.botToolGrants(botId: botId)
            } else {
                data = try await client.myToolGrants()
            }
        } catch {
            data = MyToolGrants()
            self.error = error.localizedDescription
        }
    }

    private func grant() async {
        guard let client = session.settingsClient else { return }
        switch MyToolGrantForm.request(area: area, tier: tier, days: days) {
        case let .failure(failure):
            error = tr(failure.rawValue)
        case let .success(request):
            saving = true
            defer { saving = false }
            do {
                if let botId {
                    try await client.grantBotToolAccess(botId: botId, scope: request.scope, expiresAt: request.expiresAt)
                } else {
                    try await client.grantMyToolAccess(scope: request.scope, expiresAt: request.expiresAt)
                }
                area = ""
                days = ""
                error = nil
                await load()
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    private func revoke(_ grant: MyToolGrant) async {
        guard let client = session.settingsClient else { return }
        saving = true
        defer { saving = false }
        do {
            if let botId {
                try await client.revokeBotToolGrant(botId: botId, id: grant.id)
            } else {
                try await client.revokeMyToolGrant(id: grant.id)
            }
            error = nil
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
