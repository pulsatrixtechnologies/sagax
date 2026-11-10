// #3465 (lot 8 of #3408): Settings, Notifications, « Ce que je reçois » on
// the phone and the tablet, and a bot's « Ce que ce bot suit pour toi »:
// the desktop's ProactiveReceiveSettings.tsx and BotFollowsRows.tsx, in its
// order and wording, on the same store (`GET` and `PUT /api/me/proactive`).
// Every switch acts at once, with no confirmation; a row that cannot work
// is not drawn. Labels only: a bot or a watch is named, never its id.
import CompanionCore
import SwiftUI

@MainActor
final class ProactiveReceiveModel: ObservableObject {
    @Published private(set) var state: ProactiveReceiveState?

    /// The interface's language, for the organization's own labels.
    static var french: Bool {
        let stored = UserDefaults.standard.string(forKey: PrefKey.language) ?? AppLanguage.system.rawValue
        let code = AppLanguage.resolved(stored).locale?.identifier ?? Locale.preferredLanguages.first ?? ""
        return code.lowercased().hasPrefix("fr")
    }

    func load(_ session: Session) async {
        guard let client = session.profileClient else { state = nil; return }
        do {
            // an older server has no `receive`: nothing to draw
            state = ProactiveReceiveState(try await client.proactiveReceive())
        } catch {
            state = nil
        }
    }

    /// Drawn before the answer; the server's answer then wins, and a
    /// refusal (no longer eligible, offline) draws what the server holds.
    private func put(_ session: Session, _ call: @escaping (CompanionClient) async throws -> [String: ProactiveDomainChoice]) {
        guard let client = session.profileClient else { return }
        Task {
            do {
                let domains = try await call(client)
                state?.choices = domains
            } catch {
                await load(session)
            }
        }
    }

    func setDomain(_ session: Session, row: ProactiveDomainRow, on: Bool, botId: String? = nil) {
        guard let current = state else { return }
        let carrier = botId ?? row.botId
        state = ProactiveReceiveRules.settingDomain(current, row: row, on: on, botId: carrier)
        put(session) { try await $0.setProactiveDomain(row.domain, on: on, botId: on ? carrier : nil) }
    }

    func setWatch(_ session: Session, row: ProactiveDomainRow, watch: String, on: Bool) {
        guard let current = state else { return }
        state = ProactiveReceiveRules.settingWatch(current, domain: row.domain, watch: watch, on: on)
        put(session) { try await $0.setProactiveWatch(domain: row.domain, watch: watch, on: on) }
    }

    func setBot(_ session: Session, botId: String, brief: Bool? = nil, screen: Bool? = nil, checklist: Bool? = nil) {
        guard let current = state, let client = session.profileClient else { return }
        state = ProactiveReceiveRules.settingBot(current, botId: botId, brief: brief, screen: screen, checklist: checklist)
        Task {
            do {
                try await client.setProactiveBotRow(botId: botId, brief: brief, screen: screen, checklist: checklist)
            } catch {
                await load(session)
            }
        }
    }
}

enum ProactiveReceiveText {
    static func relative(_ at: Double) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .full
        return formatter.localizedString(for: Date(timeIntervalSince1970: at / 1000), relativeTo: Date())
    }

    static func lastAlert(_ at: Double?) -> String? {
        guard let at, at > 0 else { return nil }
        return String(localized: "Last alert \(relative(at))")
    }

    /// The domain row's line, in the desktop's order.
    static func domainLine(_ row: ProactiveDomainRow, names: [String: String], botPage: Bool, note: String?) -> String {
        let carriers = row.carriers.filter { names[$0] != nil }
        var parts: [String] = []
        if !row.on, let note { parts.append(note) }
        if !row.on, let paused = row.pausedOn {
            if let name = names[paused] {
                parts.append(String(localized: "Paused: \(name) can no longer follow it, turn it on to move it"))
            } else {
                parts.append(String(localized: "Paused: the bot that followed it can no longer do so, turn it on to move it"))
            }
        }
        if !botPage, row.on, carriers.count <= 1 {
            parts.append(String(localized: "Followed by \(names[row.botId] ?? String(localized: "a bot"))"))
        }
        if !row.on, row.never { parts.append(String(localized: "You said “Never suggest again”, you can still turn it on")) }
        parts.append(lastAlert(row.lastAlertAt) ?? String(localized: "No alert yet"))
        return parts.joined(separator: " · ")
    }

    static func watchLine(_ watch: ProactiveDomainRow.Watch) -> String? {
        let parts = [ProactiveReceiveRules.cadenceText(watch.cadence), lastAlert(watch.lastAlertAt)].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

/// The rows of one domain: its switch (and, when on and more than one bot
/// can carry it, which bot), then each watch with its own switch. Shared
/// by Settings and the phone's bot page.
struct ProactiveDomainRows: View {
    let row: ProactiveDomainRow
    let names: [String: String]
    var botPage = false
    var note: String?
    let onDomain: (Bool, String?) -> Void
    let onWatch: (String, Bool) -> Void

    var body: some View {
        let carriers = row.carriers.filter { names[$0] != nil }
        SettingsRow(
            title: "", verbatimTitle: row.label,
            subtitle: ProactiveReceiveText.domainLine(row, names: names, botPage: botPage, note: note),
            accessory: .toggle(Binding(get: { row.on }, set: { onDomain($0, nil) })),
            identifier: "receive-domain-\(row.domain)"
        )
        if !botPage, row.on, carriers.count > 1 {
            CardHairline(leadingInset: SettingsMetrics.rowInset)
            Menu {
                ForEach(carriers, id: \.self) { id in
                    Button {
                        guard id != row.botId else { return }
                        onDomain(true, id)
                    } label: {
                        if id == row.botId { Label(names[id] ?? "", systemImage: "checkmark") } else { Text(verbatim: names[id] ?? "") }
                    }
                }
            } label: {
                SettingsRow(
                    title: "", verbatimTitle: String(localized: "Bot that follows \(row.label)"),
                    accessory: .valueChevron(names[row.botId] ?? String(localized: "a bot"))
                )
            }
            .accessibilityIdentifier("receive-carrier-\(row.domain)")
        }
        if row.on {
            ForEach(row.watches) { watch in
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                SettingsRow(
                    title: "", verbatimTitle: watch.summary,
                    subtitle: ProactiveReceiveText.watchLine(watch),
                    accessory: .toggle(Binding(get: { watch.on }, set: { onWatch(watch.id, $0) })),
                    identifier: "receive-watch-\(watch.id)"
                )
                .padding(.leading, 16)
            }
        }
    }
}

/// Settings, Notifications, « Ce que je reçois »: one list for the person,
/// in the desktop's groups (alerts of the organization, daily brief, screen
/// context, checklists, addressed to my bots).
struct ProactiveReceiveSection: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @StateObject private var model = ProactiveReceiveModel()

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let state = model.state {
                content(state)
            }
        }
        .task { await model.load(session) }
    }

    private func label(_ part: String) -> LocalizedStringKey {
        LocalizedStringKey(stringLiteral: "\(String(localized: "What I receive")) · \(part)")
    }

    @ViewBuilder
    private func content(_ state: ProactiveReceiveState) -> some View {
        let bots = session.state.bots
        let names = Dictionary(bots.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first })
        let mine = state.receive.bots.filter { names[$0.id] != nil }
        let rows = ProactiveReceiveRules.domainRows(state, french: ProactiveReceiveModel.french)
        if !rows.isEmpty {
            SettingsSectionLabel(text: label(String(localized: "Alerts from your organization")))
            SettingsCard {
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                    if index > 0 { CardHairline(leadingInset: SettingsMetrics.rowInset) }
                    ProactiveDomainRows(
                        row: row, names: names,
                        onDomain: { on, botId in model.setDomain(session, row: row, on: on, botId: botId) },
                        onWatch: { watch, on in model.setWatch(session, row: row, watch: watch, on: on) }
                    )
                }
            }
        }
        botGroup(mine, names: names, title: String(localized: "Daily brief"), field: \.briefRow, id: "brief") { id, on in
            model.setBot(session, botId: id, brief: on)
        }
        botGroup(mine, names: names, title: String(localized: "Screen context"), field: \.screen, id: "screen") { id, on in
            model.setBot(session, botId: id, screen: on)
        }
        botGroup(mine, names: names, title: String(localized: "Checklists"), field: \.checklist, id: "checklist") { id, on in
            model.setBot(session, botId: id, checklist: on)
        }
        let addressed = mine.compactMap { row in bots.first { $0.id == row.id } }
        if !addressed.isEmpty {
            SettingsSectionLabel(text: label(String(localized: "Addressed to my bots")))
            SettingsCard {
                ForEach(Array(addressed.enumerated()), id: \.element.id) { index, bot in
                    if index > 0 { CardHairline(leadingInset: SettingsMetrics.rowInset) }
                    let on = ProactiveMode.of(bot.proactiveMode) == .proactive
                    SettingsRow(
                        title: "", verbatimTitle: bot.name,
                        subtitle: String(localized: "Wakes on what is sent to it: another bot, an email, an invitation, a text or a webhook."),
                        accessory: .toggle(Binding(get: { on }, set: { next in
                            guard bot.busy != true else { return }
                            Task { _ = await sendPanelPatch(BotPanelPatch(proactiveMode: next ? "proactive" : "off"), bot: bot, session: session) }
                        })),
                        identifier: "receive-addressed-\(bot.id)"
                    )
                }
            }
        }
    }

    @ViewBuilder
    private func botGroup(_ rows: [ProactiveReceiveBot], names: [String: String], title: String,
                          field: KeyPath<ProactiveReceiveBot, Bool?>, id: String,
                          change: @escaping (String, Bool) -> Void) -> some View {
        let drawn = rows.filter { $0[keyPath: field] != nil }
        if !drawn.isEmpty {
            SettingsSectionLabel(text: label(title))
            SettingsCard {
                ForEach(Array(drawn.enumerated()), id: \.element.id) { index, row in
                    if index > 0 { CardHairline(leadingInset: SettingsMetrics.rowInset) }
                    let on = row[keyPath: field] ?? false
                    SettingsRow(
                        title: "", verbatimTitle: names[row.id] ?? "",
                        accessory: .toggle(Binding(get: { on }, set: { change(row.id, $0) })),
                        identifier: "receive-\(id)-\(row.id)"
                    )
                }
            }
        }
    }
}

extension ProactiveReceiveBot {
    /// `brief` is always drawn; Optional so the three groups share one path.
    var briefRow: Bool? { brief }
}

/// The phone's bot page, Permissions: « Ce que ce bot suit pour toi », the
/// person's domains this bot can carry, each on when this bot carries it.
/// A yes here moves the domain to this bot. None: nothing is drawn.
/// Drawn in a `Form`: the page owns the model and loads it (an empty
/// section has no view to start a task from).
struct BotFollowsSection: View {
    let bot: Bot
    @ObservedObject var model: ProactiveReceiveModel
    @EnvironmentObject private var session: Session

    var body: some View {
        Group {
            if let state = model.state {
                let rows = ProactiveReceiveRules.domainRows(state, botId: bot.id, french: ProactiveReceiveModel.french)
                if !rows.isEmpty {
                    let names = Dictionary(session.state.bots.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first })
                    Section {
                        ForEach(rows) { row in
                            let other = ProactiveReceiveRules.carriedElsewhere(state, row: row, botId: bot.id).flatMap { names[$0] }
                            BotFollowsListRows(
                                row: row, names: names,
                                note: other.map { String(localized: "Followed by \($0)") },
                                onDomain: { on in model.setDomain(session, row: row, on: on, botId: bot.id) },
                                onWatch: { watch, on in model.setWatch(session, row: row, watch: watch, on: on) }
                            )
                        }
                    } header: {
                        Text("What this bot follows for you")
                    }
                }
            }
        }
    }
}

/// The same rows in a `Form` (the phone's bot pages) or a panel card (the
/// tablet's desktop panel): native toggles with the row's line under it.
struct BotFollowsListRows: View {
    let row: ProactiveDomainRow
    let names: [String: String]
    var note: String?
    let onDomain: (Bool) -> Void
    let onWatch: (String, Bool) -> Void

    var body: some View {
        Toggle(isOn: Binding(get: { row.on }, set: { onDomain($0) })) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: row.label)
                Text(verbatim: ProactiveReceiveText.domainLine(row, names: names, botPage: true, note: note))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .tint(Theme.toggleOn)
        .accessibilityIdentifier("bot-follows-\(row.domain)")
        if row.on {
            ForEach(row.watches) { watch in
                Toggle(isOn: Binding(get: { watch.on }, set: { onWatch(watch.id, $0) })) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: watch.summary)
                        if let line = ProactiveReceiveText.watchLine(watch) {
                            Text(verbatim: line).font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }
                .tint(Theme.toggleOn)
                .padding(.leading, 16)
                .accessibilityIdentifier("bot-follows-watch-\(watch.id)")
            }
        }
    }
}

/// The tablet's desktop panel, Permissions: the same « Ce que ce bot suit
/// pour toi » in a panel card, under the Proactive card (PermissionsSection.tsx).
struct BotFollowsPanelCard: View {
    let bot: Bot
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @ObservedObject var model: ProactiveReceiveModel

    var body: some View {
        Group {
            if let state = model.state {
                let rows = ProactiveReceiveRules.domainRows(state, botId: bot.id, french: ProactiveReceiveModel.french)
                if !rows.isEmpty {
                    let names = Dictionary(session.state.bots.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first })
                    PanelCard {
                        Text("What this bot follows for you").panelText(13, 19.5, .medium).foregroundStyle(theme.ink)
                        ForEach(rows) { row in
                            let other = ProactiveReceiveRules.carriedElsewhere(state, row: row, botId: bot.id).flatMap { names[$0] }
                            let line = ProactiveReceiveText.domainLine(row, names: names, botPage: true, note: other.map { String(localized: "Followed by \($0)") })
                            PanelSettingRow(title: LocalizedStringKey(stringLiteral: row.label), detail: Text(verbatim: line)) {
                                PanelSwitch(label: LocalizedStringKey(stringLiteral: row.label), isOn: row.on) { on in
                                    model.setDomain(session, row: row, on: on, botId: bot.id)
                                }
                            }
                            .padding(.top, 12)
                            .accessibilityIdentifier("desktop-panel-follows-\(row.domain)")
                            if row.on {
                                ForEach(row.watches) { watch in
                                    PanelSettingRow(title: LocalizedStringKey(stringLiteral: watch.summary),
                                                    detail: ProactiveReceiveText.watchLine(watch).map { Text(verbatim: $0) }) {
                                        PanelSwitch(label: LocalizedStringKey(stringLiteral: watch.summary), isOn: watch.on) { on in
                                            model.setWatch(session, row: row, watch: watch.id, on: on)
                                        }
                                    }
                                    .padding(.top, 10)
                                    .padding(.leading, 16)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/// The tablet's persona window, When it acts alone: the same rows, in the
/// window's described rows, right under Proactive.
struct PersonaFollowsRows: View {
    let bot: Bot
    var tint: Color? = nil
    @EnvironmentObject private var session: Session
    @ObservedObject var model: ProactiveReceiveModel

    var body: some View {
        Group {
            if let state = model.state {
                let rows = ProactiveReceiveRules.domainRows(state, botId: bot.id, french: ProactiveReceiveModel.french)
                if !rows.isEmpty {
                    let names = Dictionary(session.state.bots.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first })
                    ForEach(rows) { row in
                        let other = ProactiveReceiveRules.carriedElsewhere(state, row: row, botId: bot.id).flatMap { names[$0] }
                        let line = ProactiveReceiveText.domainLine(row, names: names, botPage: true, note: other.map { String(localized: "Followed by \($0)") })
                        DesktopDescribedRow(Text(verbatim: row.label), description: Text(verbatim: line),
                                            help: Text("What this bot follows for you"), identifier: "follows.\(row.domain)") {
                            PanelSwitch(label: LocalizedStringKey(stringLiteral: row.label), isOn: row.on, onColor: tint) { on in
                                model.setDomain(session, row: row, on: on, botId: bot.id)
                            }
                            .accessibilityIdentifier("persona-follows-\(row.domain)")
                        } below: { EmptyView() }
                        if row.on {
                            ForEach(row.watches) { watch in
                                DesktopDescribedRow(Text(verbatim: watch.summary),
                                                    description: ProactiveReceiveText.watchLine(watch).map { Text(verbatim: $0) },
                                                    identifier: "follows.\(watch.id)") {
                                    PanelSwitch(label: LocalizedStringKey(stringLiteral: watch.summary), isOn: watch.on, onColor: tint) { on in
                                        model.setWatch(session, row: row, watch: watch.id, on: on)
                                    }
                                } below: { EmptyView() }
                                .padding(.leading, 16)
                            }
                        }
                    }
                }
            }
        }
    }
}

/// The tablet's Settings, Notifications (desktop look): the same « Ce que je
/// reçois » groups as the desktop, in its described rows and switches.
struct DesktopReceiveGroups: View {
    @ObservedObject var model: ProactiveReceiveModel
    @EnvironmentObject private var session: Session

    private func heading(_ part: String) -> AnyView {
        AnyView(DesktopText(verbatim: "· " + part, color: \.inkSecondary).lineLimit(1))
    }

    var body: some View {
        if let state = model.state {
            let bots = session.state.bots
            let names = Dictionary(bots.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first })
            let mine = state.receive.bots.filter { names[$0.id] != nil }
            let rows = ProactiveReceiveRules.domainRows(state, french: ProactiveReceiveModel.french)
            let title = Text("What I receive")
            if !rows.isEmpty {
                DesktopSettingsGroup(title, accessory: heading(String(localized: "Alerts from your organization")), identifier: "receiveDomains") {
                    ForEach(rows) { row in
                        let carriers = row.carriers.filter { names[$0] != nil }
                        DesktopDescribedRow(Text(verbatim: row.label),
                                            description: Text(verbatim: ProactiveReceiveText.domainLine(row, names: names, botPage: false, note: nil)),
                                            identifier: "receive.domain.\(row.domain)") {
                            HStack(spacing: 8) {
                                if row.on, carriers.count > 1 {
                                    DesktopPillSelect(options: carriers.map { ($0, names[$0] ?? "") }, selection: row.botId,
                                                      label: Text("Bot that follows \(row.label)"), identifier: "receive-carrier-\(row.domain)") { id in
                                        model.setDomain(session, row: row, on: true, botId: id)
                                    }
                                }
                                DesktopSwitch(isOn: row.on, label: Text(verbatim: row.label), identifier: "receive-domain-\(row.domain)") {
                                    model.setDomain(session, row: row, on: !row.on)
                                }
                            }
                        } below: { EmptyView() }
                        if row.on {
                            ForEach(row.watches) { watch in
                                DesktopDescribedRow(Text(verbatim: watch.summary),
                                                    description: ProactiveReceiveText.watchLine(watch).map { Text(verbatim: $0) },
                                                    identifier: "receive.watch.\(watch.id)") {
                                    DesktopSwitch(isOn: watch.on, label: Text(verbatim: watch.summary), identifier: "receive-watch-\(watch.id)") {
                                        model.setWatch(session, row: row, watch: watch.id, on: !watch.on)
                                    }
                                } below: { EmptyView() }
                            }
                        }
                    }
                }
            }
            group(mine, names: names, part: String(localized: "Daily brief"), field: \.briefRow, id: "brief") { id, on in model.setBot(session, botId: id, brief: on) }
            group(mine, names: names, part: String(localized: "Screen context"), field: \.screen, id: "screen") { id, on in model.setBot(session, botId: id, screen: on) }
            group(mine, names: names, part: String(localized: "Checklists"), field: \.checklist, id: "checklist") { id, on in model.setBot(session, botId: id, checklist: on) }
            let addressed = mine.compactMap { row in bots.first { $0.id == row.id } }
            if !addressed.isEmpty {
                DesktopSettingsGroup(title, accessory: heading(String(localized: "Addressed to my bots")), identifier: "receiveAddressed") {
                    ForEach(addressed) { bot in
                        let on = ProactiveMode.of(bot.proactiveMode) == .proactive
                        DesktopDescribedRow(Text(verbatim: bot.name),
                                            description: Text("Wakes on what is sent to it: another bot, an email, an invitation, a text or a webhook."),
                                            identifier: "receive.addressed.\(bot.id)") {
                            DesktopSwitch(isOn: on, label: Text(verbatim: bot.name), identifier: "receive-addressed-\(bot.id)", disabled: bot.busy == true) {
                                Task { _ = await sendPanelPatch(BotPanelPatch(proactiveMode: on ? "off" : "proactive"), bot: bot, session: session) }
                            }
                        } below: { EmptyView() }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func group(_ rows: [ProactiveReceiveBot], names: [String: String], part: String,
                       field: KeyPath<ProactiveReceiveBot, Bool?>, id: String, change: @escaping (String, Bool) -> Void) -> some View {
        let drawn = rows.filter { $0[keyPath: field] != nil }
        if !drawn.isEmpty {
            DesktopSettingsGroup(Text("What I receive"), accessory: heading(part), identifier: "receive-\(id)") {
                ForEach(drawn, id: \.id) { row in
                    let on = row[keyPath: field] ?? false
                    DesktopCompactRow(Text(verbatim: names[row.id] ?? ""), identifier: "receive.\(id).\(row.id)") {
                        DesktopSwitch(isOn: on, label: Text(verbatim: names[row.id] ?? ""), identifier: "receive-\(id)-\(row.id)") { change(row.id, !on) }
                    }
                }
            }
        }
    }
}
