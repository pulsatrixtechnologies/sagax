// Edit bot > Identity, Changes, Usage (iPad, round 4 of the parity sweep): PersonaOverview.tsx, HistorySection.tsx, UsageSection.tsx.
//
// Identity: the mascot at the left (Appearance on tap), the name and the
// label edited in place beside it, the Short description, then "At a glance"
// (Engine, Model, Owner, Sharing). Every write is `Session.updateProfile`,
// the same profile patch the phone's Edit bot fields send.
//
// Changes: one card, a row per version (the rows one save writes, same
// time, actor and origin: shared/bot-versions.ts), newest first; a row opens
// on what that version changed. "Restore this version" goes through the
// iPad's history rollback (`POST /api/bots/:id/history/rollback`), which
// brings back the Personality from before a change: it is offered where
// that is exactly the version (only Personality changed since).
//
// Usage: the "Usage" group and its card, as Settings > Usage draws it.
import SwiftUI
import CompanionCore

// MARK: - Identity

/// Identity (persona/PersonaOverview.tsx).
struct PersonaIdentityPage: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    @ObservedObject private var directory = PeopleDirectory.shared
    let bot: Bot

    @State private var instances: [Instance] = []
    @State private var blurb = ""
    @FocusState private var blurbFocused: Bool

    private var current: Bot { session.state.bot(bot.id) ?? bot }
    /// `viewerActorId(config)`, as the bot panel reads it.
    @State private var viewerId = "local-owner"

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            header
            descriptionSection
            summary
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("persona-overview")
        .task(id: bot.id) {
            blurb = current.description
            async let config = session.configStatus()
            instances = await DesktopModelCatalog.shared.instances(session)
            viewerId = PrimaryBotRules.viewerId(config: await config)
            await directory.load(session)
        }
        .onValueChange(of: current.description) { now in
            if !blurbFocused { blurb = now }
        }
        .onValueChange(of: blurbFocused) { focused in
            if !focused { commitBlurb() }
        }
        .onDisappear { commitBlurb() }
    }

    // MARK: Header

    private var header: some View {
        HStack(alignment: .top, spacing: 16) {
            Button {
                model.personaPage = .appearance
            } label: {
                BotMascotView(bot: current, size: 144, state: .idle, animated: true)
                    .frame(width: 144, height: 144)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            // BotProfileAvatarCard's pt-5 under the overview's -mt-6
            .padding(.top, -4)
            .accessibilityLabel(Text("Edit avatar"))
            .accessibilityIdentifier("persona-overview.avatar")

            VStack(alignment: .leading, spacing: 4) {
                PersonaInlineText(
                    value: current.name, placeholder: nil, required: true, maxLength: 100,
                    size: 19, weight: .semibold, line: 28, muted: false,
                    label: "Edit name", identifier: "persona-overview.name",
                    onSave: session.canEditBotField(current, "name") ? { name in
                        var patch = BotProfilePatch()
                        patch.name = name
                        save(patch)
                    } : nil
                )
                PersonaInlineText(
                    value: current.title, placeholder: "Add a label", required: false, maxLength: 200,
                    size: 13, weight: .regular, line: 20, muted: true,
                    label: "Edit label", identifier: "persona-overview.title",
                    onSave: session.canEditBotField(current, "title") ? { title in
                        var patch = BotProfilePatch()
                        patch.title = title
                        save(patch)
                    } : nil
                )
                if PrimaryBotRules.isViewersPrimary(current, viewerId: viewerId) {
                    HStack(spacing: 4) {
                        Image(systemName: "star")
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundStyle(theme.accent)
                        DesktopText(Text("Primary Bot"), size: 11.5, line: 16, color: \.inkSecondary)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(theme.hover, in: Capsule())
                    .padding(.top, 4)
                    .accessibilityIdentifier("persona-overview.primary")
                }
            }
            .padding(.top, 16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        // the avatar button is inline on the desktop: its line box adds 7 px under the mascot
        .padding(.bottom, 7)
    }

    // MARK: Short description

    private var descriptionSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            DesktopText(Text("Short description"), size: 13, line: 18, color: \.inkSecondary)
                .padding(.horizontal, 4)
            if session.canEditBotField(current, "description") {
                TextField("", text: $blurb, prompt: Text("One line on what this bot is for").foregroundColor(theme.inkSecondary), axis: .vertical)
                    .font(theme.font(13))
                    .foregroundStyle(theme.ink)
                    .lineSpacing(21.125 - 16)
                    .focused($blurbFocused)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity, minHeight: 72, alignment: .topLeading)
                    .background(theme.elevated, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(blurbFocused ? theme.focus : theme.border, lineWidth: 1)
                    )
                    .contentShape(Rectangle())
                    .onTapGesture { blurbFocused = true }
                    .onValueChange(of: blurb) { now in
                        if now.count > NewBotRules.descriptionLimit { blurb = String(now.prefix(NewBotRules.descriptionLimit)) }
                    }
                    .accessibilityLabel(Text("Short description"))
                    .accessibilityIdentifier("persona-overview.description")
            } else {
                Group {
                    let shown = current.description.trimmingCharacters(in: .whitespacesAndNewlines)
                    if shown.isEmpty {
                        DesktopText(Text("No description yet."), size: 13, line: 21.125, color: \.inkSecondary)
                    } else {
                        DesktopText(verbatim: shown, size: 13, line: 21.125)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.elevated, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .desktopHairlineBox(radius: 12)
                .accessibilityIdentifier("persona-overview.description")
            }
        }
    }

    // MARK: At a glance

    private var summary: some View {
        DesktopSettingsGroup(Text("At a glance"), identifier: "personaSummary") {
            fact("Engine", engineLabel, id: "engine")
            fact("Model", modelSummary, id: "model")
            fact("Owner", owner, id: "owner")
            fact("Sharing", sharing, id: "sharing")
        }
    }

    private func fact(_ label: LocalizedStringKey, _ value: String, id: String) -> some View {
        DesktopCompactRow(Text(label), identifier: "persona-overview.\(id)") {
            DesktopText(verbatim: value, size: 13, line: 18, color: \.inkSecondary)
                .lineLimit(1)
                .frame(maxWidth: 260, alignment: .trailing)
        }
    }

    private var engine: Instance? {
        instances.first { $0.instanceId == current.modelSelection.instanceId }
    }

    /// `engineLabel`: the engine's name, else its id when readable.
    private var engineLabel: String {
        let name = engine?.displayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !name.isEmpty { return name }
        return HumanID.readable(current.modelSelection.instanceId, or: AppStrings.localized("Removed engine"))
    }

    /// `personaModelSummary`: Auto, or the model's label with the effort.
    private var modelSummary: String {
        let selection = current.modelSelection
        if selection.auto == true { return AppStrings.localized("Auto") }
        let label = engine?.models.options.first { $0.id == selection.model }?.label ?? selection.model
        if let effort = selection.effort, !effort.isEmpty { return "\(label) · \(effort)" }
        return label
    }

    private var owner: String {
        if PrimaryBotRules.viewerOwns(current, viewerId: viewerId) { return AppStrings.localized("You") }
        guard let ownerId = current.ownerUserId, !ownerId.isEmpty else { return "" }
        let person = directory.directory?.person(ownerId)
        return HumanID.readable(person?.name, person?.login, ownerId, or: AppStrings.localized("Unknown person"))
    }

    /// `personaSharingSummary` (`BotSharingSummary`, #2141).
    private var sharing: String { BotSharingSummary.summary(for: current) }

    // MARK: Saving

    private func commitBlurb() {
        guard let next = DesktopInlineEdit.commit(draft: blurb, current: current.description, required: false) else { return }
        var patch = BotProfilePatch()
        patch.description = next
        save(patch)
    }

    private func save(_ patch: BotProfilePatch) {
        let target = current
        Task { _ = await session.updateProfile(patch, for: target) }
    }
}

/// `InlineEditableText`: the value as a button (the pencil shows on a touch
/// screen, `touch:opacity-100`), a field in its place while editing; leaving
/// it or Return saves, an emptied required value goes back. Shared with the
/// bot profile hero (BotProfileHero.swift).
struct PersonaInlineText: View {
    @Environment(\.desktopTheme) private var theme
    let value: String
    let placeholder: LocalizedStringKey?
    let required: Bool
    let maxLength: Int
    let size: CGFloat
    let weight: Font.Weight
    let line: CGFloat
    let muted: Bool
    let label: LocalizedStringKey
    let identifier: String
    let onSave: ((String) -> Void)?

    @State private var editing = false
    @State private var draft = ""
    @FocusState private var focused: Bool

    private var shown: String { value.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        if let onSave {
            if editing {
                TextField("", text: $draft, prompt: placeholder.map { Text($0) })
                    .font(theme.font(size, weight))
                    .foregroundStyle(theme.ink)
                    .focused($focused)
                    .submitLabel(.done)
                    .onSubmit {
                        // Return saves on its own: the focus change may not reach
                        // this view when the desktop shell keeps keyboard focus.
                        commit(onSave)
                        focused = false
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .frame(height: line + 4)
                    .background(theme.inset, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
                    .onValueChange(of: draft) { now in
                        if now.count > maxLength { draft = String(now.prefix(maxLength)) }
                    }
                    .onValueChange(of: focused) { now in
                        if !now { commit(onSave) }
                    }
                    .onAppear {
                        draft = value
                        focused = true
                    }
                    .onDisappear { if editing { commit(onSave) } }
                    .accessibilityLabel(Text(label))
                    .accessibilityIdentifier("\(identifier).field")
            } else {
                Button { editing = true } label: {
                    HStack(spacing: 4) {
                        text
                        Image(systemName: "pencil")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(theme.inkSecondary)
                    }
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .contentShape(Rectangle())
                }
                .buttonStyle(DesktopHoverFill(radius: 6))
                .accessibilityLabel(Text(label))
                .accessibilityValue(Text(verbatim: shown))
                .accessibilityIdentifier(identifier)
            }
        } else if !shown.isEmpty {
            text
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .accessibilityIdentifier(identifier)
        }
    }

    @ViewBuilder
    private var text: some View {
        if shown.isEmpty, let placeholder {
            DesktopText(Text(placeholder), size: size, weight: weight, line: line, color: \.inkSecondary)
                .lineLimit(1)
        } else {
            DesktopText(verbatim: shown, size: size, weight: weight, line: line, color: muted ? \.inkSecondary : \.ink)
                .lineLimit(1)
        }
    }

    private func commit(_ onSave: (String) -> Void) {
        guard editing else { return }
        editing = false
        if let next = DesktopInlineEdit.commit(draft: draft, current: value, required: required) { onSave(next) }
    }
}

// MARK: - Changes

/// One save: the rows written together (same time, actor and origin),
/// `botVersions` of shared/bot-versions.ts.
struct PersonaBotVersion: Identifiable, Hashable {
    /// The id of the version's first row: what a restore names.
    var id: String
    var at: Double
    var actor: String
    var via: String
    var rows: [BotHistoryRow]

    private static func sameChange(_ a: BotHistoryRow, _ b: BotHistoryRow) -> Bool {
        a.at == b.at && a.via == b.via && a.actor == b.actor
    }

    /// The versions, newest first, from rows in any order.
    static func versions(_ rows: [BotHistoryRow]) -> [PersonaBotVersion] {
        let oldestFirst = rows.sorted { $0.at < $1.at }
        var out: [PersonaBotVersion] = []
        for row in oldestFirst {
            if let last = out.last, let first = last.rows.first, sameChange(first, row) {
                out[out.count - 1].rows.append(row)
            } else {
                out.append(PersonaBotVersion(id: row.id, at: row.at, actor: row.actor, via: row.via, rows: [row]))
            }
        }
        return out.reversed()
    }

    /// The rows saved after `version`, oldest first.
    static func later(than version: PersonaBotVersion, in rows: [BotHistoryRow]) -> [BotHistoryRow] {
        let ids = Set(version.rows.map(\.id))
        let oldestFirst = rows.sorted { $0.at < $1.at }
        guard let end = oldestFirst.lastIndex(where: { ids.contains($0.id) }) else { return [] }
        return Array(oldestFirst[(end + 1)...])
    }

    /// The row whose rollback brings the bot back to `version`: only when
    /// every later change is the Personality and the earliest of them keeps
    /// its previous text (the rollback restores the text from before it).
    static func rollbackRow(for version: PersonaBotVersion, in rows: [BotHistoryRow]) -> BotHistoryRow? {
        let later = later(than: version, in: rows)
        guard let first = later.first, later.allSatisfy({ $0.field == "soul" }), first.restorable else { return nil }
        return first
    }
}

/// Changes (bot-settings/HistorySection.tsx).
struct PersonaChangesPage: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let bot: Bot
    let slackURL: URL?

    @State private var history: BotHistory?
    @State private var loadFailed = false
    @State private var restoring = false
    @State private var target: (version: PersonaBotVersion, row: BotHistoryRow)?
    @State private var open: String?
    @State private var request = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let history {
                if loadFailed {
                    DesktopText(Text("Couldn’t refresh history."), size: 12.5, line: 18, color: \.inkSecondary)
                }
                if history.rows.isEmpty {
                    DesktopText(Text("Each change to this bot's settings will show here, and you can restore it."), size: 13, line: 18, color: \.inkSecondary)
                        .accessibilityIdentifier("persona-changes.empty")
                } else {
                    versionsCard(history)
                }
            } else if loadFailed {
                DesktopText(Text("Couldn’t load history."), size: 13, line: 18, color: \.inkSecondary)
            } else {
                DesktopText(Text("Loading…"), size: 13, line: 18, color: \.inkSecondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task(id: bot.id) { await load() }
        .confirmationDialog(
            AppStrings.localized("Restore this version?"),
            isPresented: Binding(get: { target != nil }, set: { if !$0 { target = nil } }),
            titleVisibility: .visible
        ) {
            Button(AppStrings.localized("Restore this version")) {
                if let target { Task { await restore(target.row) } }
            }
            Button(AppStrings.localized("Cancel"), role: .cancel) { target = nil }
        } message: {
            Text(verbatim: String(format: AppStrings.localized("The bot goes back to this version (%@). The current version stays in Changes, so you can come back to it."),
                                  Self.field("soul")))
        }
    }

    private func versionsCard(_ history: BotHistory) -> some View {
        let versions = PersonaBotVersion.versions(history.rows)
        return VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(versions.enumerated()), id: \.element.id) { index, version in
                if index > 0 {
                    Rectangle().fill(theme.hairline.opacity(0.4)).frame(height: 1)
                }
                versionRow(version, current: index == 0, history: history)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.elevated, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .desktopHairlineBox(radius: 12)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("persona-changes.versions")
    }

    private func versionRow(_ version: PersonaBotVersion, current: Bool, history: BotHistory) -> some View {
        let expanded = open == version.id
        let restored = version.via == "restore" || version.via == "rollback"
        return VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeOut(duration: 0.15)) { open = expanded ? nil : version.id }
            } label: {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(theme.inkSecondary)
                        .rotationEffect(.degrees(expanded ? 90 : 0))
                        .frame(width: 14, height: 14)
                        .padding(.top, 4)
                    VStack(alignment: .leading, spacing: 0) {
                        HStack(spacing: 8) {
                            DesktopText(verbatim: DesktopWhenLabel.label(version.at), size: 13, line: 21.125)
                            if current { chip("Current version", id: "persona-changes.current") }
                            if restored { chip("Version restored", id: "persona-changes.restored") }
                        }
                        DesktopText(verbatim: "\(Self.who(version.actor)) · " + String(format: AppStrings.localized("Changed: %@"), Self.fields(version)),
                                    size: 12, line: 18, color: \.inkSecondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isButton)
            .accessibilityIdentifier("persona-changes.version.\(version.id)")

            if expanded {
                VStack(alignment: .leading, spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(version.rows) { row in
                            DesktopText(verbatim: Self.summary(row), size: 12.5, line: 18, color: \.inkSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    if !current {
                        let rollback = PersonaBotVersion.rollbackRow(for: version, in: history.rows)
                        Button(AppStrings.localized("Restore this version")) {
                            if let rollback { target = (version, rollback) }
                        }
                        .buttonStyle(DesktopButtonStyle(kind: .control, size: 12.5, height: 28, horizontal: 12, radius: 999))
                        .disabled(restoring || rollback == nil || history.revision == nil)
                        .accessibilityIdentifier("persona-changes.restore.\(version.id)")
                    }
                }
                .padding(.top, 12)
                .padding(.leading, 24)
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("persona-changes.details.\(version.id)")
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    private func chip(_ title: LocalizedStringKey, id: String) -> some View {
        DesktopText(Text(title), size: 11, line: 16, color: \.inkSecondary)
            .padding(.horizontal, 8)
            .padding(.vertical, 1)
            .background(theme.hover, in: Capsule())
            .accessibilityIdentifier(id)
    }

    // MARK: Words

    /// `historyWho`: who changed it, in words; an unknown actor as sent.
    static func who(_ actor: String) -> String {
        switch actor {
        case "user": AppStrings.localized("You")
        case "bot": AppStrings.localized("The bot")
        case "file": AppStrings.localized("A file change")
        case "import": AppStrings.localized("An import")
        case "system": "Sagax"
        default: actor
        }
    }

    /// `historyField`: a field's name in words; an unknown one as sent.
    static func field(_ field: String) -> String {
        switch field {
        case "soul": AppStrings.localized("Personality")
        case "name": AppStrings.localized("Name")
        case "title": AppStrings.localized("Label")
        case "description": AppStrings.localized("Description")
        case "cwd": AppStrings.localized("Working folder")
        case "notifications": AppStrings.localized("Notifications")
        case "speakReplies": AppStrings.localized("Read replies aloud")
        default: field
        }
    }

    /// `versionFields`: the fields a version changed, in words, joined.
    static func fields(_ version: PersonaBotVersion) -> String {
        var seen = Set<String>()
        return version.rows.map { field($0.field) }.filter { seen.insert($0).inserted }.joined(separator: ", ")
    }

    /// `historySummary`: "Personality: 0 B → 372 B", "Name: "Ara" → "Aria"",
    /// read from the server's summary (`soul: B → A bytes`, `field: "x" → "y"`).
    static func summary(_ row: BotHistoryRow) -> String {
        let text = row.summary
        guard let colon = text.range(of: ": "), text[..<colon.lowerBound] == row.field else { return text }
        let rest = String(text[colon.upperBound...])
        if row.field == "soul" {
            let parts = rest.replacingOccurrences(of: " bytes", with: "").components(separatedBy: " → ")
            if parts.count == 2, let before = Int(parts[0]), let after = Int(parts[1]) {
                return "\(field(row.field)): \(MemoryCapacity.formatBytes(before)) → \(MemoryCapacity.formatBytes(after))"
            }
        }
        return "\(field(row.field)): \(rest)"
    }

    // MARK: Calls

    private func load() async {
        guard let client = session.profileClient else { return }
        request += 1
        let mine = request
        do {
            let next = try await client.botHistory(botId: bot.id)
            guard mine == request else { return }
            history = next
            loadFailed = false
        } catch {
            if mine == request { loadFailed = true }
        }
    }

    private func restore(_ row: BotHistoryRow) async {
        target = nil
        guard !restoring, let revision = history?.revision, let client = session.profileClient else { return }
        restoring = true
        do {
            try await client.rollbackHistory(botId: bot.id, rowId: row.id, expectedRevision: revision)
        } catch {
            session.actionError = AppStrings.localized("Couldn't restore this version.")
        }
        await load()
        restoring = false
    }
}

// MARK: - Usage

/// Usage (bot-settings/UsageSection.tsx).
struct PersonaUsagePage: View {
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    let bot: Bot
    let slackURL: URL?

    @State private var instances: [Instance] = []

    private var current: Bot { session.state.bot(bot.id) ?? bot }

    var body: some View {
        let usage = BotUsageTotal.of(current)
        Group {
            if usage.turns == 0 {
                DesktopSettingsGroup(Text("Usage"), identifier: "botUsage") {
                    DesktopText(Text("No usage recorded yet for this bot."), size: 13, line: 18, color: \.inkSecondary)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityIdentifier("persona-usage.empty")
                }
            } else {
                DesktopSettingsGroup(Text("Usage"), accessory: AnyView(allBots), identifier: "botUsage") {
                    DesktopCompactRow(Text("Turns"), identifier: "persona-usage.turns") {
                        DesktopText(verbatim: "\(usage.turns)", size: 13, line: 18, color: \.inkSecondary).monospacedDigit()
                    }
                    DesktopCompactRow(Text(usage.cachedInput != nil ? LocalizedStringKey("New tokens") : LocalizedStringKey("Tokens")), identifier: "persona-usage.tokens") {
                        DesktopText(verbatim: BotUsageTotal.formatTokens(usage.headlineTokens), size: 13, line: 18, color: \.inkSecondary).monospacedDigit()
                    }
                    DesktopDescribedRow(Text("Cost"), description: Text(verbatim: costDescription(usage)), identifier: "persona-usage.cost") {
                        DesktopText(verbatim: usage.hasCost ? BotUsageTotal.formatUsd(usage.costUsd ?? 0) : "-", size: 13, line: 18).monospacedDigit()
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task(id: bot.id) { instances = await DesktopModelCatalog.shared.instances(session) }
    }

    /// "All bots →": Settings > Usage (it closes Edit bot, as the desktop's does).
    private var allBots: some View {
        HStack(spacing: 0) {
            Spacer(minLength: 0)
            Button {
                model.personaOpen = false
                model.settingsSection = .usage
                model.modal = .settings
            } label: {
                DesktopText(Text("All bots →"), size: 12.5, line: 18, color: \.inkSecondary)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("persona-usage.allBots")
        }
    }

    private func costDescription(_ usage: BotUsageTotal) -> String {
        guard usage.hasCost else { return AppStrings.localized("This provider doesn't report a price; tokens are counted.") }
        let billing = instances.first { $0.instanceId == current.modelSelection.instanceId }?.snapshot.billing
        let caption: String = switch billing {
        case "subscription": AppStrings.localized("equivalent, on your subscription, not billed")
        case "metered": AppStrings.localized("billed to your API key")
        default: AppStrings.localized("as reported by the provider")
        }
        return String(format: AppStrings.localized("Cost %@."), caption)
    }
}
