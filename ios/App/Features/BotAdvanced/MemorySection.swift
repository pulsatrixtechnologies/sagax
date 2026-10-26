// Memory (BA5, bot-settings/MemorySection.tsx and src/lib/memory.ts): the
// switch, the gauge of what loads, upkeep and a tidy pass, MEMORY.md and the
// topic files to edit, daily logs to read, and the journal of every change
// with Undo. A save carries the hash the file was loaded with; when the bot
// wrote the file meanwhile the server answers 409 and the editor offers the
// desktop's two ways out: Reload (the draft is kept below, read-only) or
// Overwrite with mine. Opening the folder on the computer's screen stays on
// the computer (the sidecar refuses it).
//
// `BotMemoryModel` holds the state for the phone's two pages (the overview
// and the editor) and for a future iPad panel.
import CompanionCore
import SwiftUI

@MainActor
final class BotMemoryModel: ObservableObject {
    struct Editing: Equatable {
        var path: String
        var text: String
        var hash: String
        var dirty: Bool
        var readOnly: Bool
    }

    struct Conflict: Equatable {
        var path: String
        var current: String
        var currentHash: String
    }

    @Published var overview: MemoryOverview?
    @Published var journal: [MemoryJournalRow]?
    @Published var upkeep: MemoryUpkeepStatus?
    @Published var editing: Editing?
    @Published var conflict: Conflict?
    @Published var savedDraft: String?
    @Published var error: String?
    @Published var notice: String?
    @Published var saving = false
    @Published var reverting: String?
    @Published var tidying = false
    @Published var reviewing = false
    @Published var reviewStale = false

    let botId: String
    var client: CompanionClient?

    init(botId: String) { self.botId = botId }

    /// Fetched when the page opens; a dirty draft survives a re-read.
    func refresh(openPath: String? = nil) async {
        guard let client else { return }
        error = nil
        do {
            async let overview = client.memoryOverview(botId: botId)
            async let journal = client.memoryJournal(botId: botId)
            async let upkeep = try? client.memoryUpkeep(botId: botId)
            self.overview = try await overview
            self.journal = try await journal
            self.upkeep = await upkeep
            if let openPath { try await load(openPath) }
        } catch {
            self.error = error.localizedDescription
        }
    }

    func activate() async {
        let keepDraft = editing?.dirty == true
        await refresh(openPath: keepDraft ? nil : (editing?.path ?? MemoryRules.index))
    }

    private func load(_ path: String) async throws {
        guard let client else { return }
        let doc = try await client.memoryDoc(botId: botId, path: path)
        editing = Editing(path: doc.path, text: doc.text, hash: doc.hash, dirty: false, readOnly: MemoryRules.readOnly(path))
    }

    func open(_ path: String) async {
        error = nil
        conflict = nil
        do { try await load(path) } catch { self.error = error.localizedDescription }
    }

    func edit(_ text: String) {
        guard var editing, !editing.readOnly else { return }
        editing.text = text
        editing.dirty = true
        self.editing = editing
    }

    func save(expectedHash: String?) async {
        guard let editing, let client else { return }
        saving = true
        error = nil
        defer { saving = false }
        do {
            switch try await client.saveMemoryDoc(botId: botId, path: editing.path, text: editing.text, expectedHash: expectedHash) {
            case let .conflict(current, currentHash):
                conflict = Conflict(path: editing.path, current: current, currentHash: currentHash)
            case let .saved(doc, overview):
                conflict = nil
                savedDraft = nil
                self.editing = Editing(path: editing.path, text: doc.text, hash: doc.hash, dirty: false, readOnly: editing.readOnly)
                if let overview { self.overview = overview }
                journal = try await client.memoryJournal(botId: botId)
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Reload keeps the person's words: the draft moves below, read-only.
    func reloadFromConflict() {
        guard let conflict, let editing else { return }
        savedDraft = editing.text
        self.editing = Editing(path: editing.path, text: conflict.current, hash: conflict.currentHash, dirty: false, readOnly: editing.readOnly)
        self.conflict = nil
    }

    func remove(_ file: MemoryFileInfo) async {
        guard let client else { return }
        error = nil
        do {
            overview = try await client.deleteMemoryDoc(botId: botId, path: file.path)
            journal = try await client.memoryJournal(botId: botId)
            if editing?.path == file.path { editing = nil }
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Returns the path opened, or nil when the name is refused.
    func createTopic(_ name: String) async -> String? {
        guard let file = MemoryRules.topicFileName(name) else {
            error = String(localized: "Give the topic a name — letters, numbers, spaces, dots or dashes.")
            return nil
        }
        let path = "memory/\(file)"
        await open(path)
        if var editing, editing.path == path {
            editing.dirty = true
            if editing.text.isEmpty { editing.text = MemoryRules.topicTemplate(file) }
            self.editing = editing
        }
        return path
    }

    func revert(_ row: MemoryJournalRow) async {
        guard let client else { return }
        reverting = row.id
        error = nil
        defer { reverting = nil }
        do {
            let result = try await client.revertMemoryChange(botId: botId, entryId: row.id)
            if let overview = result.overview { self.overview = overview }
            journal = try await client.memoryJournal(botId: botId)
            if var editing, editing.path == row.path, !editing.dirty {
                editing.text = result.doc.text
                editing.hash = result.doc.hash
                self.editing = editing
            }
            notice = String(localized: "Put \(row.path) back the way it was.")
        } catch {
            self.error = error.localizedDescription
        }
    }

    func tidy() async {
        guard let client else { return }
        tidying = true
        error = nil
        notice = nil
        defer { tidying = false }
        do {
            let result = try await client.tidyMemory(botId: botId)
            if let overview = result.overview { self.overview = overview }
            journal = try await client.memoryJournal(botId: botId)
            upkeep = try? await client.memoryUpkeep(botId: botId)
            if let editing, !editing.dirty { await open(editing.path) }
            let note = result.report.note.map { " \($0)" } ?? ""
            notice = "\(BotAdvancedWording.tidySummary(result.report)).\(note)"
        } catch {
            self.error = error.localizedDescription
        }
    }

    func markReviewed() async {
        guard let client, let token = overview?.lendingReview?.token else { return }
        reviewing = true
        defer { reviewing = false }
        do {
            try await client.markMemoryReviewed(botId: botId, token: token)
            overview?.lendingReview = nil
            reviewStale = false
        } catch let APIError.status(code, _) where code == 409 {
            // changed again since it was shown: show what is there now
            reviewStale = true
            await refresh()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - The overview page

struct BotMemorySection: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    @ObservedObject var model: BotMemoryModel
    /// Opens a file in the editor (the phone pushes it).
    let openFile: (String) -> Void
    @EnvironmentObject private var session: Session
    @State private var newTopic = ""
    @State private var deleting: MemoryFileInfo?
    @State private var switching = false

    private var current: Bot { session.state.bot(bot.id) ?? bot }
    private var memoryOn: Bool { current.memoryEnabled != false }

    var body: some View {
        Section {
            Toggle(isOn: Binding(get: { memoryOn }, set: { value in Task { await patch(BotAccessPatch(memoryEnabled: value)) } })) {
                Text(String(localized: "Let this bot use memory")).foregroundStyle(Theme.textPrimary)
            }
            .tint(Theme.toggleOn)
            .disabled(current.busy == true || switching)
            .accessibilityIdentifier("memory-enabled")
            if let path = model.overview?.workspacePath, !path.isEmpty {
                Text(verbatim: path)
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        } header: {
            Text(String(localized: "Memory"))
        } footer: {
            Text(String(localized: "Off stops memory prompts, recall, native memory tools, upkeep, and automatic turn logs. Existing files remain available for review.")
                 + (current.busy == true ? " " + String(localized: "Stop this bot's turn before changing this setting.") : "")
                 + "\n" + String(localized: "Notes this bot keeps between tasks. They are plain markdown files in a folder on your computer — open them in any editor, or in Obsidian."))
        }

        if let review = model.overview?.lendingReview {
            Section {
                Text(model.reviewStale
                     ? String(localized: "The memory changed again after you looked, so it can't use your Mac yet. Check the notes below, then mark them reviewed.")
                     : String(localized: "This bot's memory was changed in a conversation you didn't write, so it can't use your Mac. Check the notes below, then mark them reviewed."))
                    .foregroundStyle(Theme.textPrimary)
                if !review.changed.isEmpty {
                    Text(String(localized: "Changed:")).font(.footnote).foregroundStyle(Theme.textSecondary)
                    ForEach(review.changed, id: \.self) { file in
                        Text(verbatim: file).font(.system(size: 12, design: .monospaced)).foregroundStyle(Theme.textPrimary)
                    }
                }
                if session.surfaceGate.scope == .serverAdmin {
                    Button(String(localized: "Mark reviewed")) { Task { await model.markReviewed() } }
                        .disabled(model.reviewing)
                }
            }
        }

        if let overview = model.overview {
            Section { BotMemoryGauge(capacity: overview.index) }
        }

        if memoryOn {
            upkeepSection
        }

        if let overview = model.overview {
            Section {
                fileRow(path: MemoryRules.index, name: MemoryRules.index, detail: "\(MemoryCapacity.formatBytes(overview.index.bytes))")
                ForEach(overview.topics) { file in
                    fileRow(path: file.path, name: file.name, detail: detail(file))
                        .swipeActions(edge: .trailing) {
                            Button(String(localized: "Delete"), role: .destructive) { deleting = file }
                        }
                }
                if overview.topics.isEmpty {
                    Text(String(localized: "None yet.")).foregroundStyle(Theme.textSecondary)
                }
                HStack(spacing: 8) {
                    TextField(String(localized: "New topic name, e.g. clients"), text: $newTopic)
                        .accessibilityLabel(Text(String(localized: "New topic name")))
                        .accessibilityIdentifier("memory-new-topic-field")
                        .onSubmit { createTopic() }
                    Button(String(localized: "New topic")) { createTopic() }
                        .buttonStyle(.borderless)
                        .disabled(newTopic.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityIdentifier("memory-new-topic")
                }
            } header: {
                Text(String(localized: "Topic files"))
            } footer: {
                Text(String(localized: "Longer notes the bot reads on demand. Tap one to edit it."))
            }

            if !overview.logs.isEmpty {
                Section {
                    ForEach(overview.logs) { file in
                        fileRow(path: file.path, name: file.name, detail: detail(file))
                            .swipeActions(edge: .trailing) {
                                Button(String(localized: "Delete"), role: .destructive) { deleting = file }
                            }
                    }
                } header: {
                    Text(String(localized: "Daily logs"))
                } footer: {
                    Text(String(localized: "What the bot did each day, in its own words. Not loaded into conversations."))
                }
            }
        }

        Section {
            if let journal = model.journal {
                if journal.isEmpty {
                    Text(String(localized: "No changes recorded yet.")).foregroundStyle(Theme.textSecondary)
                }
                ForEach(journal) { row in journalRow(row) }
            } else {
                Text(String(localized: "Loading…")).foregroundStyle(Theme.textSecondary)
            }
            if let notice = model.notice {
                Text(verbatim: notice).font(.footnote).foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("memory-notice")
            }
            if let error = model.error {
                Text(verbatim: error).font(.footnote).foregroundStyle(Theme.danger)
                    .accessibilityIdentifier("memory-error")
            }
        } header: {
            Text(String(localized: "Changes"))
        } footer: {
            Text(String(localized: "Every change to these files, whoever made it. Undo puts a file back the way it was before that change."))
        }
        .confirmationDialog(
            deleting.map { String(localized: "Delete \($0.name)? The journal below can bring it back.") } ?? "",
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            titleVisibility: .visible,
            presenting: deleting
        ) { file in
            Button(String(localized: "Delete"), role: .destructive) {
                deleting = nil
                Task { await model.remove(file) }
            }
            Button(String(localized: "Cancel"), role: .cancel) { deleting = nil }
        }
    }

    private var upkeepSection: some View {
        let enabled = current.memoryUpkeep != false
        return Section {
            Toggle(isOn: Binding(get: { enabled }, set: { value in Task { await toggleUpkeep(value) } })) {
                Text(String(localized: "Memory upkeep")).foregroundStyle(Theme.textPrimary)
            }
            .tint(Theme.toggleOn)
            .disabled(switching)
            .accessibilityIdentifier("memory-upkeep")
            if enabled, let status = model.upkeep, !status.modelSteps {
                Text(String(localized: "This bot's engine can't make the quick background model call upkeep uses, so it only archives expired notes and merges exact duplicates. Claude and chat-model engines can do the rest."))
                    .font(.footnote).foregroundStyle(Theme.textSecondary)
            }
            if enabled {
                Button(model.tidying ? String(localized: "Tidying…") : String(localized: "Tidy up now")) { Task { await model.tidy() } }
                    .disabled(model.tidying)
                    .accessibilityIdentifier("memory-tidy")
                Text(verbatim: lastUpkeepLine)
                    .font(.footnote).foregroundStyle(Theme.textSecondary)
            }
        } footer: {
            Text(String(localized: "Keeps these notes in shape without the bot having to remember to: notices facts you mention in chats and files them — core facts here, detail in topic files it creates — and tidies up every night: expired notes are archived, duplicates merged, contradicted notes crossed out. Facts about you are added to About me (Settings → General), where every bot reads them and you can remove any. Every change shows below and can be undone."))
        }
    }

    private var lastUpkeepLine: String {
        var line = model.upkeep?.lastTidy.map {
            String(localized: "Last tidy-up \(BotAdvancedWording.ago($0.at)): \(BotAdvancedWording.tidySummary($0).lowercased()).")
        } ?? String(localized: "Not tidied yet.")
        if let capture = model.upkeep?.lastCapture {
            let receipt = BotAdvancedWording.captureReceipt(capture)
            if !receipt.isEmpty { line += " " + receipt }
        }
        return line
    }

    private func detail(_ file: MemoryFileInfo) -> String {
        "\(MemoryCapacity.formatBytes(file.bytes)) · \(BotAdvancedWording.ago(file.modifiedAt))"
    }

    private func fileRow(path: String, name: String, detail: String) -> some View {
        Button { openFile(path) } label: {
            HStack(spacing: 8) {
                Image(systemName: "doc.text").foregroundStyle(Theme.textSecondary)
                Text(verbatim: name)
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text(verbatim: detail).font(.system(size: 11.5)).foregroundStyle(Theme.textSecondary)
                Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.chevron)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("memory-file.\(path)")
    }

    private func journalRow(_ row: MemoryJournalRow) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .top, spacing: 8) {
                Text(verbatim: [BotAdvancedWording.journalSummary(row, botName: current.name), BotAdvancedWording.ago(row.at),
                                BotAdvancedWording.journalSource(row)].compactMap { $0 }.joined(separator: " · "))
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textPrimary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if row.canRevert {
                    Button {
                        Task { await model.revert(row) }
                    } label: {
                        Label(model.reverting == row.id ? String(localized: "Undoing…") : String(localized: "Undo"), systemImage: "arrow.uturn.backward")
                            .font(.system(size: 12, weight: .medium))
                    }
                    .buttonStyle(.borderless)
                    .foregroundStyle(Theme.blue)
                    .disabled(model.reverting != nil)
                    .accessibilityIdentifier("memory-undo.\(row.id)")
                } else {
                    Text(String(localized: "Can't undo"))
                        .font(.system(size: 11.5))
                        .foregroundStyle(Theme.textSecondary)
                        .help(row.revertUnavailableReason ?? "")
                }
            }
            if !row.diff.isEmpty {
                DisclosureGroup(String(localized: "+\(row.added) −\(row.removed) · show what changed")) {
                    Text(verbatim: row.diff)
                        .font(.system(size: 11.5, design: .monospaced))
                        .foregroundStyle(Theme.textPrimary)
                        .textSelection(.enabled)
                }
                .font(.system(size: 12))
                .foregroundStyle(Theme.textSecondary)
            }
        }
    }

    private func createTopic() {
        let name = newTopic
        Task {
            if let path = await model.createTopic(name) {
                newTopic = ""
                openFile(path)
            }
        }
    }

    private func toggleUpkeep(_ value: Bool) async {
        await patch(BotAccessPatch(memoryUpkeep: value))
        model.upkeep?.enabled = value
    }

    private func patch(_ patch: BotAccessPatch) async {
        guard let client = session.profileClient else { return }
        switching = true
        defer { switching = false }
        do {
            let updated = try await client.patchBotAccess(botId: bot.id, patch: patch)
            session.applyProfileBot(updated)
        } catch {
            session.actionError = error.localizedDescription
        }
    }
}

/// How much of MEMORY.md loads (MemoryGauge).
struct BotMemoryGauge: View {
    @Environment(\.themePalette) var themePalette
    let capacity: MemoryCapacity

    var body: some View {
        let level = capacity.level
        let fill = level == .over ? Theme.danger : level == .near ? Theme.warning : Theme.accent
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(String(localized: "How much of MEMORY.md loads"))
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.textPrimary)
                Spacer(minLength: 8)
                Text(verbatim: "\(capacity.lines) / \(capacity.maxLines) · \(MemoryCapacity.formatBytes(capacity.bytes)) / \(MemoryCapacity.formatBytes(capacity.maxBytes))")
                    .font(.system(size: 12))
                    .foregroundStyle(level == .over ? Theme.danger : Theme.textSecondary)
            }
            bar(String(localized: "Lines"), share: capacity.lineShare, fill: fill)
            bar(String(localized: "Size"), share: capacity.byteShare, fill: fill)
            if let warning {
                Text(warning).font(.system(size: 12.5)).foregroundStyle(Theme.danger)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("memory-gauge")
    }

    private var warning: String? {
        guard capacity.truncated else { return nil }
        let missing = capacity.missingLines
        if missing > 0 {
            return String(localized: "\(capacity.lines) lines saved, \(capacity.loadedLines) load into every conversation — \(missing) lines are not being loaded. Trim this file or move notes into a topic file.")
        }
        return String(localized: "\(MemoryCapacity.formatBytes(capacity.bytes)) saved, \(MemoryCapacity.formatBytes(capacity.loadedBytes)) load into every conversation — the rest is not being loaded. Trim this file or move notes into a topic file.")
    }

    private func bar(_ label: String, share: Double, fill: Color) -> some View {
        HStack(spacing: 8) {
            Text(label).font(.system(size: 11.5)).foregroundStyle(Theme.textSecondary).frame(width: 40, alignment: .leading)
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.inset)
                    Capsule().fill(fill).frame(width: proxy.size.width * min(1, max(0, share)))
                }
            }
            .frame(height: 6)
        }
    }
}

// MARK: - The editor

struct BotMemoryEditor: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    @ObservedObject var model: BotMemoryModel
    @EnvironmentObject private var session: Session

    var body: some View {
        ThemedList {
            if let editing = model.editing {
                if let conflict = model.conflict, conflict.path == editing.path {
                    Section {
                        Text(String(localized: "\(bot.name) changed this file while you were editing."))
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(Theme.textPrimary)
                        Text(String(localized: "Nothing has been saved. Reload to see \(bot.name)'s version (your draft is kept below), or overwrite it with yours."))
                            .font(.footnote)
                            .foregroundStyle(Theme.textSecondary)
                        Button(String(localized: "Reload")) { model.reloadFromConflict() }
                            .disabled(model.saving)
                            .accessibilityIdentifier("memory-conflict-reload")
                        Button(String(localized: "Overwrite with mine")) { Task { await model.save(expectedHash: conflict.currentHash) } }
                            .disabled(model.saving)
                            .accessibilityIdentifier("memory-conflict-overwrite")
                    }
                }
                Section {
                    if editing.readOnly {
                        Text(verbatim: editing.text)
                            .font(.system(size: 12.5, design: .monospaced))
                            .foregroundStyle(Theme.textPrimary)
                            .textSelection(.enabled)
                    } else {
                        // the markdown editor (desktop MemoryEditorDialog, #258)
                        MarkdownEditor(
                            text: Binding(get: { model.editing?.text ?? "" }, set: { model.edit($0) }),
                            placeholder: editing.path == MemoryRules.index
                                ? String(localized: "Nothing remembered yet. The bot writes durable notes here — or add your own.")
                                : String(localized: "Write the note here."),
                            minHeight: 260, monospaced: true,
                            accessibilityLabel: editing.path == MemoryRules.index
                                ? String(localized: "Bot memory")
                                : String(localized: "Memory file \(editing.path)"),
                            identifier: "memory-editor"
                        )
                    }
                } footer: {
                    if editing.readOnly {
                        Text(String(localized: "Daily logs are the bot's own record of what it did; they are not loaded into conversations and are read-only here."))
                    }
                }
                if !editing.readOnly, editing.dirty {
                    Section {
                        Button(String(localized: "Discard changes")) { Task { await model.open(editing.path) } }
                            .disabled(model.saving)
                    }
                }
                if let draft = model.savedDraft {
                    Section {
                        Text(verbatim: draft)
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundStyle(Theme.textPrimary)
                            .textSelection(.enabled)
                        Button(String(localized: "Dismiss draft")) { model.savedDraft = nil }
                    } header: {
                        Text(String(localized: "Your unsaved draft, kept so nothing is lost:"))
                    }
                }
                if let error = model.error {
                    Section { Text(verbatim: error).foregroundStyle(Theme.danger) }
                }
            } else {
                Text(model.error ?? String(localized: "Loading…")).foregroundStyle(Theme.textSecondary)
            }
        }
        .navigationTitle(Text(verbatim: model.editing?.path ?? MemoryRules.index))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let editing = model.editing, !editing.readOnly {
                ToolbarItem(placement: .confirmationAction) {
                    Button(model.saving ? String(localized: "Saving…") : String(localized: "Save")) {
                        Task { await model.save(expectedHash: editing.hash) }
                    }
                    .disabled(model.saving || !editing.dirty)
                    .accessibilityIdentifier("memory-save")
                }
            }
        }
    }
}

struct BotMemoryPage: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    @EnvironmentObject private var session: Session
    @StateObject private var model: BotMemoryModel
    @State private var editorOpen = false

    init(bot: Bot) {
        self.bot = bot
        _model = StateObject(wrappedValue: BotMemoryModel(botId: bot.id))
    }

    var body: some View {
        ThemedList {
            BotMemorySection(bot: bot, model: model) { path in
                Task {
                    if model.editing?.path != path { await model.open(path) }
                    editorOpen = true
                }
            }
        }
        .navigationTitle(String(localized: "Memory"))
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("memory-page")
        .navigationDestination(isPresented: $editorOpen) {
            BotMemoryEditor(bot: session.state.bot(bot.id) ?? bot, model: model)
        }
        .task(id: bot.id) {
            model.client = session.profileClient
            await model.activate()
        }
        .refreshable { await model.activate() }
    }
}
