// The cards the bot profile draws in place on the phone and the tablet, the
// desktop's (#3399 to #3401, #3403): the "+ Add" pill whose choices carry a
// grey line, Knowledge's "To review" and Skills cards, the Analytics block
// of the reference (date range, Messages, Hours saved, Top users), and the
// form that adds a login to a team bot's shared vault.
import Charts
import CompanionCore
import SwiftUI

// MARK: - Pill and Add menu

/// The profile's grey pill (Connect, Manage, Enable, Decline).
struct ProfilePill: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.desktopTheme) private var desktopTheme
    let title: LocalizedStringKey
    var fillsMain = false

    var body: some View {
        Text(title)
            .font(Theme.Font.label)
            .foregroundStyle(Theme.textPrimary)
            .lineLimit(1)
            .fixedSize()
            .padding(.horizontal, 12)
            .frame(height: 28)
            .background(Capsule().fill(fillsMain ? desktopTheme.elevated : Theme.cardRaised))
            // The outline keeps the pill visible where the card and the pill share a fill.
            .overlay(Capsule().strokeBorder(fillsMain ? desktopTheme.hairlineWeak : Theme.hairline, lineWidth: 1))
    }
}

/// One choice of "+ Add": a title and the grey line saying what it does.
struct BotProfileAddItem: Identifiable {
    let id: String
    let title: LocalizedStringKey
    let detail: LocalizedStringKey
    let symbol: String
    let action: () -> Void
}

/// "+ Add": a plus before the word, no chevron; the system menu draws each
/// choice with its description under the title.
struct BotProfileAddMenu: View {
    @Environment(\.themePalette) var themePalette
    let items: [BotProfileAddItem]
    let identifier: String

    var body: some View {
        Menu {
            ForEach(items) { item in
                Button {
                    Haptics.selection()
                    item.action()
                } label: {
                    // a Label then a Text: the menu draws the Text as the
                    // grey line under the title
                    Label(item.title, systemImage: item.symbol)
                    Text(item.detail)
                }
                .accessibilityIdentifier("\(identifier).\(item.id)")
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "plus").font(.system(size: 11, weight: .semibold))
                Text("Add").font(Theme.Font.label)
            }
            .foregroundStyle(Theme.textPrimary)
            .padding(.horizontal, 12)
            .frame(height: 28)
            .background(Theme.cardRaised, in: Capsule())
            .overlay(Capsule().strokeBorder(Theme.hairline, lineWidth: 1))
            .contentShape(Capsule())
        }
        .accessibilityLabel(Text("Add"))
        .accessibilityIdentifier(identifier)
    }
}

/// A group's grey label with an accessory at its right.
struct BotProfileGroupLabel<Accessory: View>: View {
    @Environment(\.themePalette) var themePalette
    let title: LocalizedStringKey
    @ViewBuilder var accessory: () -> Accessory

    var body: some View {
        HStack(spacing: 8) {
            Text(title)
                .font(Theme.Font.label)
                .foregroundStyle(Theme.textTertiary)
                .lineLimit(1)
            Spacer(minLength: 0)
            accessory()
        }
        .padding(.leading, Theme.Profile.cardMargin + 4)
        .padding(.trailing, Theme.Profile.cardMargin)
    }
}

extension BotProfileGroupLabel where Accessory == EmptyView {
    init(title: LocalizedStringKey) {
        self.init(title: title) { EmptyView() }
    }
}

// MARK: - Knowledge > To review

/// What the bot learned from use and waits for a decision before it
/// applies it, one row each, decided in place (owner's decision of
/// 2026-11-10): Enable (or Update) and Decline answer the chat's card;
/// the bubble opens the chat. Nothing waits: one row that says so.
struct BotReviewCard: View {
    @Environment(\.themePalette) var themePalette
    @ObservedObject var model: BotSkillsModel
    var fillsMain = false
    let openChat: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            BotProfileGroupLabel(title: "To review")
            ProfileCard {
                ForEach(Array(model.stagedItems.enumerated()), id: \.element.id) { index, entry in
                    if index > 0 { ProfileDivider() }
                    row(entry)
                }
                if model.stagedItems.isEmpty && !model.loading {
                    ProfileRow(
                        icon: ProfileRowIcon(systemImage: "checkmark.circle", size: 16),
                        title: Text("You're all caught up"),
                        subtitle: Text("What the bot learns from use shows up here before it applies it."),
                        height: Theme.Profile.routineRow
                    )
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("bot-profile-review.empty")
                }
                if !model.decideError.isEmpty {
                    Text(verbatim: model.decideError)
                        .font(Theme.Profile.labelFont)
                        .foregroundStyle(Theme.danger)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, Theme.Profile.textInset)
                        .padding(.vertical, 8)
                        .accessibilityIdentifier("bot-profile-review.error")
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("bot-profile-group.review")
    }

    private func row(_ entry: StagedSkillSummary) -> some View {
        let busy = !model.deciding.isEmpty
        let gist = entry.gist?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return ProfileRow(
            icon: ProfileRowIcon(systemImage: "sparkles", size: 16),
            title: Text(verbatim: entry.name),
            subtitle: gist.isEmpty ? nil : Text(verbatim: gist),
            height: Theme.Profile.routineRow
        ) {
            HStack(spacing: 6) {
                if entry.decidable {
                    Button {
                        Haptics.selection()
                        Task { await model.decide(entry, allow: true) }
                    } label: {
                        ProfilePill(title: entry.action == "update" ? "Update" : "Enable", fillsMain: fillsMain)
                    }
                    .buttonStyle(.plain)
                    .disabled(busy)
                    .accessibilityIdentifier("bot-profile-review.allow.\(entry.id)")
                    Button {
                        Haptics.selection()
                        Task { await model.decide(entry, allow: false) }
                    } label: {
                        ProfilePill(title: "Decline", fillsMain: fillsMain)
                    }
                    .buttonStyle(.plain)
                    .disabled(busy)
                    .accessibilityIdentifier("bot-profile-review.deny.\(entry.id)")
                }
                if entry.card != nil {
                    Button {
                        Haptics.selection()
                        openChat()
                    } label: {
                        Image(systemName: "bubble.left")
                            .font(.system(size: 14))
                            .foregroundStyle(Theme.textSecondary)
                            .frame(width: 32, height: 32)
                            .contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("Open in chat"))
                    .accessibilityIdentifier("bot-profile-review.open.\(entry.id)")
                }
            }
            .padding(.trailing, 12)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("bot-profile-review.\(entry.id)")
    }
}

// MARK: - Knowledge > Skills

/// The Skills card in place: one row per skill with its switch (switching
/// one on shows its full text first), a tap opens it; "+ Add" imports from
/// a link, shows a path or adds one of the organization's; the row's menu
/// edits, copies the source or removes. Empty: one row with "+ Add".
struct BotSkillsCard: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    let bot: Bot
    @ObservedObject var model: BotSkillsModel
    /// The search: a skill shows when its name matches.
    let matches: (String) -> Bool
    let wholeCard: Bool

    @State private var removing: ManagedSkill?
    @State private var importing = false
    @State private var libraryOpen = false
    @State private var offered = false

    private var shown: [ManagedSkill] {
        wholeCard ? model.skills : model.skills.filter { matches(DisplayHygiene.skillTitle($0) + " " + $0.name) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            BotProfileGroupLabel(title: "Skills") {
                if !model.skills.isEmpty { addMenu }
            }
            ProfileCard {
                if model.loading && model.skills.isEmpty {
                    Text("Loading…")
                        .font(Theme.Profile.labelFont)
                        .foregroundStyle(Theme.textSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, Theme.Profile.textInset)
                        .frame(minHeight: Theme.Profile.singleRow)
                } else if model.skills.isEmpty {
                    ProfileRow(
                        icon: ProfileRowIcon(systemImage: "book", size: 16),
                        title: Text("No skills yet"),
                        subtitle: Text("A skill shows the bot how to do one task your way; it uses it when the task comes up."),
                        height: Theme.Profile.routineRow,
                        subtitleLines: 2
                    ) {
                        addMenu.padding(.trailing, 12)
                    }
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("bot-profile-skills.empty")
                } else {
                    ForEach(Array(shown.enumerated()), id: \.element.id) { index, skill in
                        if index > 0 { ProfileDivider() }
                        row(skill)
                    }
                }
                if !model.importMessage.isEmpty {
                    note(model.importMessage, color: Theme.textSecondary)
                }
                if !model.error.isEmpty {
                    note(model.error, color: Theme.danger).accessibilityIdentifier("skills-error")
                }
            }
            ProfileFooter(text: model.authoring
                ? "Save a bot's verification run as a skill from the Verify card. Every change waits for your review."
                : "Skill authoring is off, but skills you already enabled stay under your control here.")
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("bot-profile-group.skills")
        .task(id: bot.id) {
            // the organization's library is offered only where it has skills (OrgSkillsSection)
            guard session.surfaceGate.allows(.orgSkillsLibrary),
                  let offer = try? await session.profileClient?.orgOfferedSkills(botId: bot.id) else { return }
            offered = offer.shown && offer.organization != nil
        }
        .sheet(item: $model.reviewing) { sheet in SkillReviewSheet(sheet: sheet, model: model) }
        .sheet(item: $model.viewing) { sheet in SkillTextSheet(sheet: sheet, model: model) }
        .sheet(isPresented: $model.showingPath) {
            if let client = model.client {
                ShownPathSheet(botId: bot.id, client: client) { Task { await model.refresh() } }
            }
        }
        .sheet(isPresented: $importing) {
            SkillImportSheet(model: model)
        }
        .sheet(isPresented: $libraryOpen) {
            NavigationStack {
                ThemedList { OrgSkillsSection(bot: bot) { Task { await model.refresh() } } }
                    .navigationTitle(Text("From the library"))
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) { Button("Done") { libraryOpen = false } }
                    }
            }
            .environmentObject(session)
        }
        .confirmationDialog(
            removing.map { String(localized: "Remove the learned skill “\($0.name)”?") } ?? "",
            isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
            titleVisibility: .visible,
            presenting: removing
        ) { skill in
            Button(String(localized: "Remove skill"), role: .destructive) {
                removing = nil
                Task { await model.remove(skill) }
            }
            Button(String(localized: "Cancel"), role: .cancel) { removing = nil }
        }
    }

    private var addMenu: some View {
        var items: [BotProfileAddItem] = []
        if offered {
            items.append(BotProfileAddItem(id: "library", title: "From the library", detail: "A skill your library already holds", symbol: "books.vertical") {
                libraryOpen = true
            })
        }
        items.append(BotProfileAddItem(id: "import", title: "Import from a link", detail: "A GitHub repository, a SKILL.md link or a skills.sh page", symbol: "link") {
            importing = true
        })
        items.append(BotProfileAddItem(id: "path", title: "Show a path", detail: "A skill folder on the computer this bot runs on", symbol: "folder") {
            model.showingPath = true
        })
        return BotProfileAddMenu(items: items, identifier: "bot-profile-skills.add")
    }

    private func note(_ text: String, color: Color) -> some View {
        Text(verbatim: text)
            .font(Theme.Profile.labelFont)
            .foregroundStyle(color)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Theme.Profile.textInset)
            .padding(.vertical, 8)
    }

    private func row(_ skill: ManagedSkill) -> some View {
        let title = DisplayHygiene.skillTitle(skill)
        let slug = DisplayHygiene.skillSlug(skill)
        let line = skill.warnings.isEmpty
            ? (slug != title ? slug : String(localized: "Used when the bot decides it's relevant"))
            : skill.warnings.joined(separator: " · ")
        return HStack(spacing: 0) {
            Button {
                Haptics.selection()
                Task { await model.view(skill) }
            } label: {
                ProfileRow(
                    icon: ProfileRowIcon(systemImage: "book", size: 16),
                    title: Text(verbatim: title),
                    subtitle: Text(verbatim: line),
                    height: Theme.Profile.routineRow
                )
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("skill-open.\(skill.name)")
            Toggle(isOn: Binding(get: { skill.enabled }, set: { _ in Task { await model.toggle(skill) } })) { EmptyView() }
                .labelsHidden()
                .tint(Theme.toggleOn)
                .disabled(model.working == skill.name)
                .accessibilityLabel(Text(skill.enabled ? String(localized: "Disable \(skill.name)") : String(localized: "Enable \(skill.name)")))
                .accessibilityIdentifier("skill-toggle.\(skill.name)")
                .padding(.trailing, Theme.Profile.textInset)
        }
        .contextMenu {
            Button(String(localized: "Open"), systemImage: "doc.text") { Task { await model.view(skill) } }
            Button(String(localized: "Edit"), systemImage: "pencil") { Task { await model.view(skill, startEditing: true) } }
            if !skill.source.isEmpty {
                Button(String(localized: "Copy the source"), systemImage: "doc.on.doc") { UIPasteboard.general.string = skill.source }
            }
            Button(String(localized: "Remove skill"), systemImage: "trash", role: .destructive) { removing = skill }
        }
    }
}

/// "+ Add" > Import from a link: the Skills page's import field as a sheet.
struct SkillImportSheet: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var model: BotSkillsModel
    @State private var source = ""

    var body: some View {
        NavigationStack {
            ThemedForm {
                Section {
                    TextField(String(localized: "owner/repo, https://github.com/…/SKILL.md, or https://skills.sh/…"), text: $source)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .font(.system(size: 14))
                        .accessibilityLabel(Text(String(localized: "Import a skill")))
                        .accessibilityIdentifier("skills-import-field")
                        .onSubmit { run() }
                    if !model.error.isEmpty {
                        Text(verbatim: model.error).font(.footnote).foregroundStyle(Theme.danger)
                    }
                } footer: {
                    Text("A GitHub repository, a SKILL.md link or a skills.sh page")
                }
            }
            .navigationTitle(Text("Import from a link"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(model.importing ? String(localized: "Importing…") : String(localized: "Import")) { run() }
                        .disabled(model.importing || SkillRules.importSource(source) == nil)
                        .accessibilityIdentifier("skills-import")
                }
            }
        }
    }

    private func run() {
        let text = source
        Task { if await model.importSkill(text) { dismiss() } }
    }
}

// MARK: - Analytics

/// Money in the reader's language ("$9.59", FR "9,59 $").
enum ProfileMoney {
    static func format(_ amount: Double, currency: String? = nil) -> String {
        guard amount.isFinite else { return "" }
        let code = (currency?.isEmpty == false ? currency! : "USD").uppercased()
        let digits = amount != 0 && abs(amount) < 0.01 ? 3 : 2
        return amount.formatted(.currency(code: code).presentation(.narrow).precision(.fractionLength(digits)).locale(.current))
    }

    static func hours(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(1)).locale(.current)) + " h"
    }

    static func count(_ value: Int) -> String {
        value.formatted(.number.locale(.current))
    }
}

/// The block of the reference first on Analytics: the date range and the
/// 7, 30 or 90 days choice, the Messages and Hours saved cards, then Top
/// users with its sort. Nothing is shown as a figure before it is read.
struct BotProfileAnalyticsBlock: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    let bot: Bot
    var fillsMain = false

    @State private var days: BotAnalyticsDays = .days7
    @State private var sort: BotAnalytics.Sort = .messages
    @State private var answers: [Int: BotAnalytics] = [:]
    @State private var error: String?
    @State private var attempt = 0

    private var data: BotAnalytics? { answers[days.rawValue] }
    private var accent: Color { MausPalette.color((session.state.bot(bot.id) ?? bot).color) }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            header
            if let error {
                HStack(spacing: 8) {
                    Text(verbatim: String(localized: "Couldn't load the analytics: \(error)"))
                        .font(Theme.Profile.labelFont)
                        .foregroundStyle(Theme.textSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Button { attempt += 1 } label: { ProfilePill(title: "Try again", fillsMain: fillsMain) }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("bot-analytics.retry")
                }
                .padding(.horizontal, Theme.Profile.cardMargin + 4)
            }
            cards
            topUsers
        }
        .task(id: "\(bot.id):\(days.rawValue):\(attempt)") { await load() }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("bot-analytics")
    }

    private var header: some View {
        HStack(spacing: 12) {
            Text(verbatim: Self.rangeLabel(data?.series.map(\.day) ?? Self.localDays(days.rawValue)))
                .font(Theme.Font.label)
                .monospacedDigit()
                .foregroundStyle(Theme.textSecondary)
                .lineLimit(1)
                .accessibilityIdentifier("bot-analytics.range-label")
            Spacer(minLength: 8)
            Picker("Period", selection: $days) {
                Text("7 days").tag(BotAnalyticsDays.days7)
                Text("30 days").tag(BotAnalyticsDays.days30)
                Text("90 days").tag(BotAnalyticsDays.days90)
            }
            .pickerStyle(.segmented)
            .fixedSize()
            .accessibilityIdentifier("bot-analytics.range")
        }
        .padding(.leading, Theme.Profile.cardMargin + 4)
        .padding(.trailing, Theme.Profile.cardMargin)
    }

    @ViewBuilder
    private var cards: some View {
        let layout = fillsMain ? AnyLayout(HStackLayout(alignment: .top, spacing: 16)) : AnyLayout(VStackLayout(spacing: 16))
        layout {
            statCard(id: "messages", title: "Messages", figure: data.map { ProfileMoney.count($0.totals.messages) }, values: data?.series.map { Double($0.messages) })
            if let data, !data.hoursEstimated {
                statCard(id: "hoursSaved", title: "Hours saved", estimating: true)
            } else {
                statCard(
                    id: "hoursSaved", title: "Hours saved",
                    figure: data.flatMap { $0.totals.hoursSaved.map(ProfileMoney.hours) },
                    values: data?.series.map { $0.hoursSaved ?? 0 }
                )
            }
        }
        .padding(.horizontal, Theme.Profile.cardMargin)
    }

    private func statCard(id: String, title: LocalizedStringKey, figure: String? = nil, values: [Double]? = nil, estimating: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(Theme.Font.label)
                .foregroundStyle(Theme.textSecondary)
            if estimating {
                Text("Still being estimated…")
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textSecondary)
                    .frame(minHeight: 34, alignment: .leading)
                    .accessibilityIdentifier("bot-analytics.estimating")
            } else {
                Text(verbatim: figure ?? "...")
                    .font(.system(size: 28))
                    .monospacedDigit()
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                chart(values ?? [])
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.Metric.cardRadius, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("bot-analytics.card.\(id)")
    }

    private func chart(_ values: [Double]) -> some View {
        Chart(Array(values.enumerated()), id: \.offset) { point in
            AreaMark(x: .value("Day", point.offset), y: .value("Value", point.element))
                .foregroundStyle(accent.opacity(0.18))
                .interpolationMethod(.monotone)
            LineMark(x: .value("Day", point.offset), y: .value("Value", point.element))
                .foregroundStyle(accent)
                .interpolationMethod(.monotone)
        }
        .chartXAxis(.hidden)
        .chartYAxis(.hidden)
        .frame(height: 64)
        .opacity(values.isEmpty ? 0 : 1)
        .accessibilityHidden(true)
    }

    private var topUsers: some View {
        VStack(alignment: .leading, spacing: 8) {
            // the phone: the sort sits under the label so neither is cut
            if fillsMain {
                BotProfileGroupLabel(title: "Top users") { sortPicker }
            } else {
                BotProfileGroupLabel(title: "Top users")
                HStack {
                    Spacer(minLength: 0)
                    sortPicker
                }
                .padding(.horizontal, Theme.Profile.cardMargin)
            }
            ProfileCard {
                if let data {
                    let users = BotAnalytics.sorted(data.topUsers, by: sort)
                    if users.isEmpty {
                        line("No one has written to this bot yet.")
                            .accessibilityIdentifier("bot-analytics.no-users")
                    } else {
                        ForEach(Array(users.enumerated()), id: \.element.id) { index, user in
                            if index > 0 { ProfileDivider(leading: 54) }
                            userRow(user, estimated: data.hoursEstimated)
                        }
                    }
                } else {
                    line("...")
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("bot-analytics.top-users")
    }

    private var sortPicker: some View {
        Picker("Sort by", selection: $sort) {
            Text("Messages").tag(BotAnalytics.Sort.messages)
            Text("Hours saved").tag(BotAnalytics.Sort.hoursSaved)
        }
        .pickerStyle(.segmented)
        .fixedSize()
        .accessibilityIdentifier("bot-analytics.sort")
    }

    private func line(_ text: LocalizedStringKey) -> some View {
        Text(text)
            .font(Theme.Font.label)
            .foregroundStyle(Theme.textSecondary)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .padding(.horizontal, Theme.Profile.textInset)
    }

    private func userRow(_ user: BotAnalyticsUser, estimated: Bool) -> some View {
        let name = user.shownName ?? String(localized: "Unknown person")
        return HStack(spacing: 12) {
            Text(verbatim: BotAnalyticsUser.initials(name))
                .font(.system(size: 12))
                .foregroundStyle(Theme.textSecondary)
                .frame(width: 28, height: 28)
                .background(Circle().fill(Theme.cardRaised))
                .accessibilityHidden(true)
            Text(verbatim: name)
                .font(Theme.Font.body)
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(verbatim: ProfileMoney.count(user.messages))
                .font(Theme.Font.label)
                .monospacedDigit()
                .foregroundStyle(sort == .messages ? Theme.textPrimary : Theme.textSecondary)
                .frame(minWidth: 44, alignment: .trailing)
            Text(verbatim: estimated ? (user.hoursSaved.map(ProfileMoney.hours) ?? "...") : "...")
                .font(Theme.Font.label)
                .monospacedDigit()
                .foregroundStyle(sort == .hoursSaved ? Theme.textPrimary : Theme.textSecondary)
                .frame(minWidth: 52, alignment: .trailing)
        }
        .padding(.horizontal, Theme.Profile.textInset)
        .frame(minHeight: 48)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("bot-analytics.user")
    }

    private func load() async {
        guard let client = session.settingsClient else { return }
        let wanted = days
        do {
            answers[wanted.rawValue] = try await client.botAnalytics(botId: bot.id, days: wanted)
            error = nil
        } catch is CancellationError {
            return
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// The reader's own last N days while the answer loads, so the label
    /// does not jump.
    static func localDays(_ count: Int, now: Date = Date()) -> [String] {
        let calendar = Calendar.current
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return (0..<count).reversed().compactMap { back in
            calendar.date(byAdding: .day, value: -back, to: now).map(formatter.string(from:))
        }
    }

    /// "Nov 4 - Nov 10" (a simple hyphen, as the desktop writes it).
    static func rangeLabel(_ keys: [String]) -> String {
        guard let first = keys.first, let last = keys.last else { return "" }
        let parse = DateFormatter()
        parse.locale = Locale(identifier: "en_US_POSIX")
        parse.dateFormat = "yyyy-MM-dd"
        func label(_ key: String) -> String {
            guard let date = parse.date(from: key) else { return key }
            return date.formatted(.dateTime.month(.abbreviated).day().locale(.current))
        }
        return first == last ? label(first) : "\(label(first)) - \(label(last))"
    }
}

// MARK: - Access > Vault login

/// "+ Add" > Vault login: a username and password this bot fills on its
/// sites, saved in its shared vault. The password is sent once and never
/// read back.
struct TeamVaultLoginSheet: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var session: Session
    let bot: Bot
    let onSaved: () -> Void

    @State private var name = ""
    @State private var username = ""
    @State private var password = ""
    @State private var sites = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ThemedForm {
                Section {
                    TextField(String(localized: "Name"), text: $name)
                        .accessibilityIdentifier("team-vault.name")
                    TextField(String(localized: "Username or email"), text: $username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .textContentType(.username)
                        .accessibilityIdentifier("team-vault.username")
                    SecureField(String(localized: "Password"), text: $password)
                        .textContentType(.password)
                        .accessibilityIdentifier("team-vault.password")
                    TextField(String(localized: "Sites (example.com)"), text: $sites)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .accessibilityIdentifier("team-vault.sites")
                    if let error {
                        Text(verbatim: error).font(.footnote).foregroundStyle(Theme.danger)
                    }
                } footer: {
                    Text("Logins \(bot.name) can fill on its sites. Managers only. The bot never sees a password.")
                }
            }
            .navigationTitle(Text("Vault login"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(busy || username.trimmingCharacters(in: .whitespaces).isEmpty || password.isEmpty)
                        .accessibilityIdentifier("team-vault.save")
                }
            }
        }
    }

    private func save() async {
        guard let client = session.settingsClient else { return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            try await client.addTeamBotVaultLogin(botId: bot.id, name: name, username: username, password: password, domains: sites)
            password = ""
            onSaved()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
