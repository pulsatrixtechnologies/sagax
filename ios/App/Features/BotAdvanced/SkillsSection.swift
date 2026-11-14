// Skills (BA4, bot-settings/SkillsSection.tsx and OrgSkillsCard.tsx): what
// the bot learned or imported, to read, switch on after a review, switch
// off and remove; an import field; the organization's offered skills for
// an admin. Enabling a disabled skill always shows its full SKILL.md first,
// exactly as the desktop's review step. `BotSkillsModel` holds the state
// (the page and a future iPad panel share it); the review and the full
// text open as sheets from the page, never from inside a List section
// (a sheet raised there dismisses the sheet around it).
import CompanionCore
import SwiftUI

struct SkillSheet: Identifiable {
    let skill: ManagedSkill
    let text: String
    /// Open the editor already in Edit mode (row menu Edit).
    var startEditing: Bool = false
    /// Open on Review changes (the iPad row menu's Review changes, #4165).
    var startReview: Bool = false
    /// Where the skill lives (nil: the bot's own): the editor reads, saves
    /// and reviews it there, as the desktop's `skillEditorApiPath` does.
    var origin: SkillOrigin? = nil
    var id: String { skill.name }
}

@MainActor
final class BotSkillsModel: ObservableObject {
    @Published var skills: [ManagedSkill] = []
    @Published var staged = 0
    /// What waits for a decision (the Knowledge tab's To review card, #3403).
    @Published var stagedItems: [StagedSkillSummary] = []
    /// The learning being decided from the tab, or "".
    @Published var deciding = ""
    @Published var decideError = ""
    @Published var loading = true
    @Published var working = ""
    @Published var error = ""
    @Published var authoring = true
    @Published var importing = false
    @Published var importMessage = ""
    @Published var reviewing: SkillSheet?
    @Published var viewing: SkillSheet?
    @Published var showingPath = false

    let botId: String
    var client: CompanionClient?

    init(botId: String) { self.botId = botId }

    func refresh(first: Bool = false) async {
        guard let client else { return }
        if first {
            loading = true
            authoring = (try? await client.skillAuthoringEnabled()) ?? true
        }
        do {
            let list = try await client.botSkills(botId: botId)
            skills = list.skills
            staged = list.staged.count
            stagedItems = list.staged
            error = ""
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }

    func toggle(_ skill: ManagedSkill) async {
        guard let client else { return }
        working = skill.name
        error = ""
        defer { working = "" }
        do {
            if !skill.enabled {
                // A disabled import has not necessarily been reviewed: show
                // the integrity-checked text before it can reach the bot.
                guard let text = try await client.skillText(botId: botId, name: skill.name), !text.isEmpty else {
                    error = String(localized: "The skill contents are unavailable; remove and import or learn it again.")
                    return
                }
                reviewing = SkillSheet(skill: skill, text: text)
                return
            }
            try await client.setSkillEnabled(botId: botId, name: skill.name, enabled: false)
            await refresh()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func enableReviewed(_ skill: ManagedSkill) async {
        guard let client else { return }
        working = skill.name
        error = ""
        defer { working = "" }
        do {
            try await client.setSkillEnabled(botId: botId, name: skill.name, enabled: true)
            reviewing = nil
            await refresh()
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Enable (or Update) and Decline answer the chat's own card, so
    /// answering in one place settles the other; the server leaves one
    /// quiet line in the chat (`via: "profile"`, #3400).
    func decide(_ entry: StagedSkillSummary, allow: Bool) async {
        guard let client, let card = entry.card, deciding.isEmpty else { return }
        deciding = entry.id
        decideError = ""
        defer { deciding = "" }
        do {
            try await client.respond(
                threadId: card.threadId,
                requestId: card.requestId,
                behavior: allow ? "allow" : "deny",
                reviewedSha256: allow ? entry.sha256 : nil,
                via: "profile"
            )
        } catch {
            decideError = String(localized: "Could not record this decision.")
        }
        await refresh()
    }

    func remove(_ skill: ManagedSkill) async {
        guard let client else { return }
        working = skill.name
        error = ""
        defer { working = "" }
        do {
            try await client.removeSkill(botId: botId, name: skill.name)
            await refresh()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func view(_ skill: ManagedSkill, startEditing: Bool = false, startReview: Bool = false, origin: SkillOrigin? = nil) async {
        guard let client else { return }
        error = ""
        do {
            let payload = try await client.skillEditor(botId: botId, name: skill.name, origin: origin)
            viewing = SkillSheet(skill: skill, text: payload.text, startEditing: startEditing, startReview: startReview, origin: origin)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func saveSkill(_ skill: ManagedSkill, name: String, description: String, instructions: String, origin: SkillOrigin? = nil) async -> Bool {
        guard let client else { return false }
        working = skill.name
        error = ""
        defer { working = "" }
        do {
            try await client.saveSkill(botId: botId, name: skill.name, newName: name, description: description, instructions: instructions, origin: origin)
            viewing = nil
            await refresh()
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func reviewSkill(_ skill: ManagedSkill, action: String, origin: SkillOrigin? = nil) async -> Bool {
        guard let client else { return false }
        working = skill.name
        error = ""
        defer { working = "" }
        do {
            try await client.reviewSkill(botId: botId, name: skill.name, origin: origin, action: action)
            viewing = nil
            await refresh()
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    /// True when the import worked (the field then clears).
    func importSkill(_ source: String) async -> Bool {
        guard let trimmed = SkillRules.importSource(source), let client else { return false }
        importing = true
        error = ""
        importMessage = ""
        defer { importing = false }
        do {
            let count = try await client.importSkill(botId: botId, source: trimmed)
            importMessage = count == 1
                ? String(localized: "Imported 1 skill. Review and enable below.")
                : String(localized: "Imported \(count) skills. Review and enable below.")
            await refresh()
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }
}

struct BotSkillsSection: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    @ObservedObject var model: BotSkillsModel
    @EnvironmentObject private var session: Session
    @State private var source = ""
    @State private var removing: ManagedSkill?

    var body: some View {
        Section {
            HStack(spacing: 8) {
                TextField(String(localized: "owner/repo, https://github.com/…/SKILL.md, or https://skills.sh/…"), text: $source)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.system(size: 14))
                    .accessibilityLabel(Text(String(localized: "Import a skill")))
                    .accessibilityIdentifier("skills-import-field")
                    .onSubmit { importSkill() }
                Button(model.importing ? String(localized: "Importing…") : String(localized: "Import")) { importSkill() }
                    .buttonStyle(.borderless)
                    .disabled(model.importing || SkillRules.importSource(source) == nil)
                    .accessibilityIdentifier("skills-import")
            }
            Button(String(localized: "Show a path")) { model.showingPath = true }
                .accessibilityIdentifier("skills-show-path")
            if !model.importMessage.isEmpty {
                Text(verbatim: model.importMessage).font(.footnote).foregroundStyle(Theme.textSecondary)
            }
            if model.loading {
                Text(String(localized: "Loading…")).foregroundStyle(Theme.textSecondary)
            } else if model.skills.isEmpty {
                Text(String(localized: "No installed skills yet."))
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("skills-empty")
            } else {
                ForEach(model.skills) { skill in row(skill) }
            }
            if model.staged > 0 {
                Text(model.staged == 1
                     ? String(localized: "1 proposal is waiting for a decision in chat.")
                     : String(localized: "\(model.staged) proposals are waiting for a decision in chat."))
                    .font(.footnote)
                    .foregroundStyle(Theme.warning)
            }
            if !model.error.isEmpty {
                Text(verbatim: model.error).font(.footnote).foregroundStyle(Theme.danger)
                    .accessibilityIdentifier("skills-error")
            }
        } header: {
            Text(String(localized: "Learned skills"))
        } footer: {
            Text(model.authoring
                 ? String(localized: "Save a bot's verification run as a skill from the Verify card, or import one below. Every change waits for your review.")
                 : String(localized: "Skill authoring is off, but skills you already enabled stay under your control here."))
        }
        .task(id: bot.id) {
            model.client = session.profileClient
            await model.refresh(first: true)
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
            .accessibilityIdentifier("skills-remove-confirm")
            Button(String(localized: "Cancel"), role: .cancel) { removing = nil }
        }

        if session.surfaceGate.allows(.orgSkillsLibrary) {
            OrgSkillsSection(bot: bot) { Task { await model.refresh() } }
        }
    }

    private func importSkill() {
        let text = source
        Task { if await model.importSkill(text) { source = "" } }
    }

    @ViewBuilder
    private func row(_ skill: ManagedSkill) -> some View {
        let title = DisplayHygiene.skillTitle(skill)
        let slug = DisplayHygiene.skillSlug(skill)
        return VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .top, spacing: 10) {
                Button { Task { await model.view(skill) } } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        // Lot 8: readable title first; slug as a discreet subline.
                        Text(verbatim: title)
                            .font(.system(size: 14))
                            .foregroundStyle(Theme.textPrimary)
                            .lineLimit(2)
                        if slug != title {
                            Text(verbatim: slug)
                                .font(Theme.mono(11))
                                .foregroundStyle(Theme.textSecondary)
                                .lineLimit(1)
                        }
                        Text(String(localized: "Used when the bot decides it's relevant"))
                            .font(.system(size: 11))
                            .foregroundStyle(Theme.textSecondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("skill-open.\(skill.name)")
                Toggle(isOn: Binding(get: { skill.enabled }, set: { _ in Task { await model.toggle(skill) } })) { EmptyView() }
                    .labelsHidden()
                    .tint(Theme.toggleOn)
                    .disabled(model.working == skill.name)
                    .accessibilityLabel(Text(skill.enabled ? String(localized: "Disable \(skill.name)") : String(localized: "Enable \(skill.name)")))
                    .accessibilityIdentifier("skill-toggle.\(skill.name)")
            }
            if !skill.source.isEmpty {
                DisclosureGroup {
                    Text(verbatim: skill.source)
                        .font(Theme.mono(11))
                        .foregroundStyle(Theme.textSecondary)
                        .textSelection(.enabled)
                } label: {
                    Text(String(localized: "Source"))
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.textSecondary)
                }
                .accessibilityIdentifier("skill-source.\(skill.name)")
            }
            if !skill.warnings.isEmpty {
                Text(verbatim: skill.warnings.joined(separator: " · "))
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.warning)
            }
        }
        .swipeActions(edge: .trailing) {
            Button(String(localized: "Remove"), role: .destructive) { removing = skill }
                .disabled(model.working == skill.name)
        }
        .contextMenu {
            Button(String(localized: "Open"), systemImage: "doc.text") { Task { await model.view(skill) } }
            Button(String(localized: "Edit"), systemImage: "pencil") { Task { await model.view(skill, startEditing: true) } }
            Button(String(localized: "Remove skill"), systemImage: "trash", role: .destructive) { removing = skill }
        }
    }
}

/// The review before enabling, as a sheet from the page.
struct SkillReviewSheet: View {
    @Environment(\.themePalette) var themePalette
    let sheet: SkillSheet
    @ObservedObject var model: BotSkillsModel

    var body: some View {
        NavigationStack {
            ThemedList {
                Section {
                    Text(verbatim: DisplayHygiene.skillTitle(sheet.skill))
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(Theme.textPrimary)
                    Text(verbatim: DisplayHygiene.skillSlug(sheet.skill))
                        .font(Theme.mono(12))
                        .foregroundStyle(Theme.textSecondary)
                    if !sheet.skill.source.isEmpty {
                        DisclosureGroup(String(localized: "Source")) {
                            Text(verbatim: sheet.skill.source)
                                .font(Theme.mono(11))
                                .foregroundStyle(Theme.textSecondary)
                                .textSelection(.enabled)
                        }
                    }
                    if !sheet.skill.warnings.isEmpty {
                        Text(verbatim: sheet.skill.warnings.joined(separator: " · "))
                            .font(.footnote).foregroundStyle(Theme.warning)
                    }
                    Text(verbatim: sheet.text)
                        .font(Theme.mono(12))
                        .foregroundStyle(Theme.textPrimary)
                        .textSelection(.enabled)
                        .accessibilityLabel(Text(String(localized: "Full SKILL.md for \(sheet.skill.name)")))
                    if !model.error.isEmpty {
                        Text(verbatim: model.error).font(.footnote).foregroundStyle(Theme.danger)
                    }
                }
            }
            .navigationTitle(String(localized: "Review before enabling"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(String(localized: "Cancel")) { model.reviewing = nil }.disabled(model.working == sheet.skill.name)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "Enable reviewed skill")) { Task { await model.enableReviewed(sheet.skill) } }
                        .disabled(model.working == sheet.skill.name)
                        .accessibilityIdentifier("skill-enable-reviewed")
                }
            }
        }
    }
}

/// A skill's SKILL.md in the shared markdown editor: view by default, Edit, Save.
struct SkillTextSheet: View {
    @Environment(\.themePalette) var themePalette
    let sheet: SkillSheet
    @ObservedObject var model: BotSkillsModel
    /// What the iPad's compact skill row no longer shows (#4165): sharing,
    /// where it was learned, its warnings and its actions.
    var details: AnyView? = nil

    @State private var editing = false
    @State private var name: String = ""
    @State private var description: String = ""
    @State private var instructions: String = ""
    @State private var currentText: String = ""
    @State private var changedAfterReview = false
    @State private var reviewedText: String?
    @State private var reviewingChanges = false
    @State private var loaded = false

    var body: some View {
        NavigationStack {
            ThemedList {
                if changedAfterReview {
                    Section {
                        Text(String(localized: "stored SKILL.md changed after review - enablement is blocked"))
                            .font(.footnote)
                            .foregroundStyle(Theme.warning)
                        Button(AppStrings.localized("botPanel.skills.reviewChanges")) { reviewingChanges = true }
                            .accessibilityIdentifier("skill-review-changes")
                    }
                }
                if reviewingChanges {
                    Section {
                        Text(String(localized: "Reviewed"))
                            .font(.footnote)
                            .foregroundStyle(Theme.textSecondary)
                        Text(verbatim: reviewedText ?? "")
                            .font(Theme.mono(12))
                            .textSelection(.enabled)
                        Text(String(localized: "Current"))
                            .font(.footnote)
                            .foregroundStyle(Theme.textSecondary)
                        Text(verbatim: currentText.isEmpty ? sheet.text : currentText)
                            .font(Theme.mono(12))
                            .textSelection(.enabled)
                    }
                } else {
                    Section {
                        TextField(String(localized: "Name"), text: $name)
                            .disabled(!editing)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        TextField(String(localized: "Description"), text: $description, axis: .vertical)
                            .disabled(!editing)
                            .lineLimit(2...4)
                    }
                    Section {
                        MarkdownEditor(
                            text: $instructions,
                            placeholder: String(localized: "Instructions"),
                            minHeight: 220,
                            accessibilityLabel: String(localized: "Instructions"),
                            identifier: "skill-text"
                        )
                        .disabled(!editing)
                        .accessibilityIdentifier("skill-text")
                    }
                    if let details, !editing {
                        Section { details }
                    }
                }
                if !model.error.isEmpty {
                    Section {
                        Text(verbatim: model.error).font(.footnote).foregroundStyle(Theme.danger)
                    }
                }
            }
            .navigationTitle(Text(verbatim: DisplayHygiene.skillTitle(sheet.skill)))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(String(localized: "Close")) { model.viewing = nil }
                        .disabled(model.working == sheet.skill.name)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if reviewingChanges {
                        Menu {
                            Button(String(localized: "Accept")) {
                                Task { _ = await model.reviewSkill(sheet.skill, action: "accept", origin: sheet.origin) }
                            }
                            Button(String(localized: "Revert"), role: .destructive) {
                                Task { _ = await model.reviewSkill(sheet.skill, action: "revert", origin: sheet.origin) }
                            }
                        } label: {
                            Text(verbatim: AppStrings.localized("botPanel.skills.reviewChanges"))
                        }
                        .disabled(model.working == sheet.skill.name)
                    } else if editing {
                        Button(String(localized: "Save")) {
                            Task {
                                if await model.saveSkill(sheet.skill, name: name, description: description, instructions: instructions, origin: sheet.origin) {
                                    editing = false
                                }
                            }
                        }
                        .disabled(model.working == sheet.skill.name || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityIdentifier("skill-save")
                    } else {
                        Button(String(localized: "Edit")) { editing = true }
                            .accessibilityIdentifier("skill-edit")
                    }
                }
            }
            .task {
                guard !loaded else { return }
                loaded = true
                editing = sheet.startEditing
                if let client = model.client,
                   let payload = try? await client.skillEditor(botId: model.botId, name: sheet.skill.name, origin: sheet.origin) {
                    name = payload.name
                    description = payload.description
                    currentText = payload.text
                    instructions = Self.body(from: payload.text)
                    changedAfterReview = payload.changedAfterReview
                    reviewedText = payload.reviewedText
                    reviewingChanges = sheet.startReview && payload.changedAfterReview
                } else {
                    name = sheet.skill.name
                    description = sheet.skill.description
                    currentText = sheet.text
                    instructions = Self.body(from: sheet.text)
                }
            }
        }
    }

    /// SKILL.md body after the frontmatter block.
    private static func body(from text: String) -> String {
        guard text.hasPrefix("---"),
              let end = text.range(of: "\n---\n") else { return text }
        return String(text[end.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

/// Bot > Skills > From {Organization} (OrgSkillsCard.tsx): absent with no
/// organization or nothing offered.
struct OrgSkillsSection: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    let onAdded: () -> Void
    @EnvironmentObject private var session: Session
    @State private var offer: OrgSkillsOffer?
    @State private var working = ""
    @State private var error = ""

    var body: some View {
        Group {
            if let offer, offer.shown, let organization = offer.organization {
                Section {
                    ForEach(offer.skills) { skill in
                        HStack(spacing: 10) {
                            VStack(alignment: .leading, spacing: 2) {
                                let title = skill.description.trimmingCharacters(in: .whitespacesAndNewlines)
                                Text(verbatim: title.isEmpty ? skill.name.replacingOccurrences(of: "-", with: " ") : title)
                                    .font(.system(size: 14))
                                    .foregroundStyle(Theme.textPrimary)
                                    .lineLimit(2)
                                Text(verbatim: skill.name)
                                    .font(Theme.mono(11))
                                    .foregroundStyle(Theme.textSecondary)
                                    .lineLimit(1)
                                Text(String(localized: "\(skill.packageName) \(skill.release) · \(skill.publisher)"))
                                    .font(.system(size: 11)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                            }
                            Spacer(minLength: 8)
                            if skill.added {
                                Label(String(localized: "Added"), systemImage: "checkmark")
                                    .font(.footnote).foregroundStyle(Theme.textSecondary)
                            } else {
                                Button(working == skill.id ? String(localized: "Adding…") : String(localized: "Add")) {
                                    Task { await add(skill) }
                                }
                                .buttonStyle(.borderless)
                                .disabled(!working.isEmpty)
                                .accessibilityLabel(Text(String(localized: "Add \(skill.name) to this bot")))
                            }
                        }
                    }
                    if !error.isEmpty {
                        Text(verbatim: error).font(.footnote).foregroundStyle(Theme.danger)
                    }
                } header: {
                    Text(String(localized: "From \(organization.name)"))
                } footer: {
                    Text(String(localized: "Skills your organization shares. Adding one puts it on this bot, switched on."))
                }
            }
        }
        .task(id: bot.id) { await refresh() }
    }

    private func refresh() async {
        // No organization library is the same as nothing offered.
        offer = try? await session.profileClient?.orgOfferedSkills(botId: bot.id)
    }

    private func add(_ skill: OfferedOrgSkill) async {
        guard let client = session.profileClient else { return }
        working = skill.id
        error = ""
        defer { working = "" }
        do {
            try await client.addOrgSkill(botId: bot.id, skill: skill)
            await refresh()
            onAdded()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct BotSkillsPage: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    @StateObject private var model: BotSkillsModel

    init(bot: Bot) {
        self.bot = bot
        _model = StateObject(wrappedValue: BotSkillsModel(botId: bot.id))
    }

    var body: some View {
        ThemedList { BotSkillsSection(bot: bot, model: model) }
            .sheet(item: $model.reviewing) { sheet in SkillReviewSheet(sheet: sheet, model: model) }
            .sheet(item: $model.viewing) { sheet in SkillTextSheet(sheet: sheet, model: model) }
            .sheet(isPresented: $model.showingPath) {
                if let client = model.client {
                    ShownPathSheet(botId: bot.id, client: client) { Task { await model.refresh() } }
                }
            }
            .navigationTitle(String(localized: "Skills"))
            .navigationBarTitleDisplayMode(.inline)
            .accessibilityIdentifier("skills-page")
    }
}
