// Tools > Memory on iPhone/iPad (desktop MemoryManagerPanel.tsx): sources,
// browse, note (markdown editor + JSON tree), create, move, trash. Opened
// from the account menu as a NavigationStack sheet with pushed pages.
import CompanionCore
import SwiftUI

// MARK: - Sheet

struct MemoryManagerSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            MemorySourcesPage()
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(String(localized: "Done")) { dismiss() }
                            .accessibilityIdentifier("memory-manager-done")
                    }
                }
        }
        .accessibilityIdentifier("memory-manager-panel")
    }
}

// MARK: - Routes

private enum MemoryRoute: Hashable {
    case browse(sourceId: String, folder: String?)
    case note(sourceId: String, noteId: String, scope: String?, path: String?)
    case create(sourceId: String)
    case move(sourceId: String, noteIds: [String])
    case trash(sourceId: String)
}

// MARK: - Sources

struct MemorySourcesPage: View {
    @EnvironmentObject private var session: Session
    @StateObject private var model = MemoryManagerModel()

    var body: some View {
        ThemedList {
            if let error = model.error {
                Section {
                    Text(error).foregroundStyle(Theme.danger)
                }
            }
            if model.sources == nil {
                Section {
                    ProgressView(String(localized: "Loading memory"))
                        .frame(maxWidth: .infinity)
                        .accessibilityIdentifier("memory-loading")
                }
            } else if let sources = model.sources, sources.isEmpty {
                Section {
                    Text(String(localized: "No memory sources yet."))
                        .foregroundStyle(Theme.textSecondary)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .accessibilityIdentifier("memory-empty-sources")
                }
            } else if let sources = model.sources {
                Section {
                    ForEach(sources) { source in
                        NavigationLink(value: MemoryRoute.browse(sourceId: source.id, folder: nil)) {
                            Label {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(source.name)
                                    if let detail = source.detail {
                                        Text(detail)
                                            .font(.footnote)
                                            .foregroundStyle(Theme.textSecondary)
                                    }
                                }
                            } icon: {
                                Image(systemName: icon(for: source.kind))
                                    .foregroundStyle(Theme.textSecondary)
                            }
                        }
                        .accessibilityIdentifier("memory-source.\(source.id)")
                    }
                }
            }
            if model.pxReason == "link" {
                Section {
                    Text(String(localized: "Link this installation to Perspicax to browse personal, team and organization notes here."))
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                }
            } else if model.pxReason == "sign_in" {
                Section {
                    Text(String(localized: "Sign in with Pulsatrix to open your Perspicax notes."))
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                }
            }
        }
        .navigationTitle(String(localized: "Memory"))
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: MemoryRoute.self) { route in
            destination(route)
        }
        .task { await model.loadSources(session) }
        .environmentObject(model)
    }

    @ViewBuilder
    private func destination(_ route: MemoryRoute) -> some View {
        switch route {
        case let .browse(sourceId, folder):
            if let source = model.sources?.first(where: { $0.id == sourceId }) {
                MemoryBrowsePage(source: source, folder: folder)
            } else {
                Text(String(localized: "This source is no longer available."))
            }
        case let .note(sourceId, noteId, scope, path):
            if let source = model.sources?.first(where: { $0.id == sourceId }) {
                MemoryNotePage(source: source, noteId: noteId, scope: scope, path: path)
            }
        case let .create(sourceId):
            if let source = model.sources?.first(where: { $0.id == sourceId }) {
                MemoryCreatePage(source: source)
            }
        case let .move(sourceId, noteIds):
            if let source = model.sources?.first(where: { $0.id == sourceId }) {
                MemoryMovePage(source: source, noteIds: noteIds)
            }
        case let .trash(sourceId):
            if let source = model.sources?.first(where: { $0.id == sourceId }) {
                MemoryTrashPage(source: source)
            }
        }
    }

    private func icon(for kind: MemorySourceKind) -> String {
        switch kind {
        case .perspicax: "text.book.closed"
        case .team: "folder"
        case .bot: "doc.text"
        }
    }
}

// MARK: - Browse

struct MemoryBrowsePage: View {
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: MemoryManagerModel
    let source: MemoryManagerSource
    var folder: String?

    @State private var confirmDelete = false

    var body: some View {
        ThemedList {
            if let error = model.error {
                Section { Text(error).foregroundStyle(Theme.danger) }
            }
            if model.busy && model.browse == nil {
                Section {
                    ProgressView().frame(maxWidth: .infinity)
                }
            }
            if let browse = model.browse {
                if folder == nil, !browse.folders.isEmpty, model.query.isEmpty {
                    Section(String(localized: "Folders")) {
                        ForEach(browse.folders) { row in
                            NavigationLink(value: MemoryRoute.browse(sourceId: source.id, folder: row.name)) {
                                Label {
                                    HStack {
                                        Text(row.name)
                                        Spacer()
                                        Text("\(row.count)")
                                            .foregroundStyle(Theme.textTertiary)
                                            .monospacedDigit()
                                    }
                                } icon: {
                                    Image(systemName: "folder")
                                        .foregroundStyle(Theme.textSecondary)
                                }
                            }
                        }
                    }
                }
                Section {
                    if model.visibleNotes.isEmpty {
                        Text(String(localized: "No notes in this source."))
                            .foregroundStyle(Theme.textSecondary)
                            .frame(maxWidth: .infinity, alignment: .center)
                            .accessibilityIdentifier("memory-empty-notes")
                    }
                    ForEach(model.visibleNotes) { row in
                        HStack(alignment: .top, spacing: 10) {
                            if browse.mayWrite {
                                Button {
                                    model.toggleSelect(row.id)
                                } label: {
                                    Image(systemName: model.selected.contains(row.id) ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(model.selected.contains(row.id) ? Theme.accent : Theme.textTertiary)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel(String(localized: "Select \(row.title)"))
                            }
                            NavigationLink(value: MemoryRoute.note(
                                sourceId: source.id,
                                noteId: row.id,
                                scope: row.scope,
                                path: row.path
                            )) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(row.title).font(.body.weight(.medium))
                                    let subtitle = [row.folder, row.excerpt].compactMap { $0 }.joined(separator: " · ")
                                    if !subtitle.isEmpty {
                                        Text(subtitle)
                                            .font(.footnote)
                                            .foregroundStyle(Theme.textSecondary)
                                            .lineLimit(2)
                                    }
                                }
                            }
                        }
                        .accessibilityIdentifier("memory-note-row.\(row.id)")
                    }
                }
                if source.kind == .perspicax, (browse.trashCount ?? 0) > 0 {
                    Section {
                        NavigationLink(value: MemoryRoute.trash(sourceId: source.id)) {
                            Text(String(localized: "Trash · \(browse.trashCount ?? 0)"))
                                .foregroundStyle(Theme.textSecondary)
                        }
                    }
                }
            }
        }
        .navigationTitle(folder ?? source.name)
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $model.query, prompt: String(localized: "Search notes"))
        .toolbar {
            if source.mayWrite {
                ToolbarItem(placement: .primaryAction) {
                    NavigationLink(value: MemoryRoute.create(sourceId: source.id)) {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel(String(localized: "New"))
                    .accessibilityIdentifier("memory-new")
                }
            }
            if !model.selected.isEmpty {
                ToolbarItemGroup(placement: .bottomBar) {
                    Text(String(localized: "\(model.selected.count) selected"))
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                    Spacer()
                    if source.kind == .perspicax {
                        NavigationLink(value: MemoryRoute.move(sourceId: source.id, noteIds: Array(model.selected))) {
                            Text(String(localized: "Move"))
                        }
                    }
                    Button(role: .destructive) { confirmDelete = true } label: {
                        Label(String(localized: "Delete"), systemImage: "trash")
                    }
                    .disabled(model.busy)
                    .accessibilityIdentifier("memory-bulk-delete")
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            if let notice = model.notice {
                HStack {
                    Text(notice.text).font(.footnote)
                    Spacer()
                    if notice.undo != nil {
                        Button(String(localized: "Undo")) {
                            Task {
                                await notice.undo?()
                                model.notice = nil
                            }
                        }
                        .font(.footnote.weight(.semibold))
                    }
                    Button {
                        model.notice = nil
                    } label: {
                        Image(systemName: "xmark")
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(.ultraThinMaterial)
                .accessibilityIdentifier("memory-notice")
            }
        }
        .confirmationDialog(
            String(localized: "Delete \(model.selected.count) notes? They can be undone for a moment."),
            isPresented: $confirmDelete,
            titleVisibility: .visible
        ) {
            Button(String(localized: "Delete"), role: .destructive) {
                Task { await model.deleteSelected(session, source: source, folder: folder) }
            }
            Button(String(localized: "Cancel"), role: .cancel) {}
        }
        .task(id: "\(source.id)|\(folder ?? "")") {
            await model.loadBrowse(session, source: source, folder: folder)
        }
    }
}

// MARK: - Note

struct MemoryNotePage: View {
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: MemoryManagerModel
    let source: MemoryManagerSource
    let noteId: String
    var scope: String?
    var path: String?

    var body: some View {
        Group {
            if model.busy && model.note == nil {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let note = model.note {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        if model.editing {
                            TextField(String(localized: "Title"), text: $model.draftTitle)
                                .textFieldStyle(.roundedBorder)
                                .accessibilityIdentifier("memory-rename")
                            if source.kind == .perspicax {
                                TextField(String(localized: "Tags (comma separated)"), text: $model.draftTags)
                                    .textFieldStyle(.roundedBorder)
                                    .accessibilityIdentifier("memory-tags")
                            }
                            MarkdownEditor(
                                text: $model.draft,
                                minHeight: 220,
                                showsCount: false,
                                accessibilityLabel: String(localized: "Note text"),
                                identifier: "memory-manager-note"
                            )
                        } else {
                            if !note.tags.isEmpty {
                                FlowTags(tags: note.tags)
                            }
                            MemoryReadBody(text: note.body, bodyKind: note.bodyKind)
                        }
                        if let error = model.error {
                            Text(error).foregroundStyle(Theme.danger).font(.footnote)
                        }
                    }
                    .padding()
                }
            } else {
                Text(String(localized: "This note no longer exists."))
                    .foregroundStyle(Theme.textSecondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle(model.note?.title ?? String(localized: "Note"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let note = model.note, note.mayEdit {
                if model.editing {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(String(localized: "Cancel")) {
                            model.editing = false
                            model.draft = note.body
                            model.draftTitle = note.title
                            model.draftTags = note.tags.joined(separator: ", ")
                        }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(String(localized: "Save")) {
                            Task { await model.saveNote(session, source: source) }
                        }
                        .disabled(model.busy)
                        .accessibilityIdentifier("memory-save")
                    }
                } else {
                    if source.kind == .perspicax {
                        ToolbarItem(placement: .primaryAction) {
                            NavigationLink(value: MemoryRoute.move(sourceId: source.id, noteIds: [note.id])) {
                                Text(String(localized: "Move"))
                            }
                        }
                    }
                    ToolbarItem(placement: .primaryAction) {
                        Button(String(localized: "Edit")) {
                            model.draftTitle = note.title
                            model.draftTags = note.tags.joined(separator: ", ")
                            model.editing = true
                        }
                        .accessibilityIdentifier("memory-edit")
                    }
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            if let notice = model.notice {
                Text(notice.text)
                    .font(.footnote)
                    .frame(maxWidth: .infinity)
                    .padding(10)
                    .background(.ultraThinMaterial)
            }
        }
        .task {
            let row = MemoryNoteRow(id: noteId, title: noteId, path: path, kind: nil, scope: scope)
            _ = await model.openNote(session, source: source, row: row)
        }
    }
}

private struct MemoryReadBody: View {
    let text: String
    let bodyKind: MemoryBodyKind

    var body: some View {
        if bodyKind == .json {
            MemoryJsonTreeView(source: text)
        } else {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(Array(MemoryManager.splitJsonFences(text).enumerated()), id: \.offset) { _, part in
                    switch part {
                    case let .json(json):
                        MemoryJsonTreeView(source: json)
                    case let .text(chunk):
                        Text(chunk)
                            .font(.body)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .textSelection(.enabled)
                    }
                }
            }
            .accessibilityIdentifier("memory-read-body")
        }
    }
}

private struct FlowTags: View {
    let tags: [String]
    var body: some View {
        FlexibleTagRow(tags: tags)
    }
}

/// Simple wrapping tag chips without a custom layout engine.
private struct FlexibleTagRow: View {
    let tags: [String]
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(tags, id: \.self) { tag in
                Text(tag)
                    .font(.caption)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Theme.inset, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                    .foregroundStyle(Theme.textSecondary)
            }
        }
    }
}

// MARK: - Create

struct MemoryCreatePage: View {
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: MemoryManagerModel
    @Environment(\.dismiss) private var dismiss
    let source: MemoryManagerSource

    var body: some View {
        Form {
            Section {
                TextField(String(localized: "Title"), text: $model.createTitle)
                    .accessibilityIdentifier("memory-create-title")
            }
            if let error = model.error {
                Section { Text(error).foregroundStyle(Theme.danger) }
            }
        }
        .navigationTitle(String(localized: "New note"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(String(localized: "Create")) {
                    Task {
                        if await model.createNote(session, source: source) {
                            dismiss()
                        }
                    }
                }
                .disabled(model.createTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.busy)
                .accessibilityIdentifier("memory-create")
            }
        }
    }
}

// MARK: - Move

struct MemoryMovePage: View {
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: MemoryManagerModel
    @Environment(\.dismiss) private var dismiss
    let source: MemoryManagerSource
    let noteIds: [String]

    var body: some View {
        Form {
            Section {
                Text(String(localized: "Move \(noteIds.count) notes to another folder or tier."))
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
            }
            Section(String(localized: "Folder")) {
                TextField(String(localized: "Folder"), text: $model.moveTopic)
                    .accessibilityIdentifier("memory-move-folder")
            }
            Section(String(localized: "Tier")) {
                Picker(String(localized: "Tier"), selection: $model.moveScope) {
                    Text(String(localized: "Personal")).tag("me")
                    Text(String(localized: "Organization")).tag("org")
                }
                .pickerStyle(.inline)
            }
            if let error = model.error {
                Section { Text(error).foregroundStyle(Theme.danger) }
            }
        }
        .navigationTitle(String(localized: "Move"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(String(localized: "Move notes")) {
                    Task {
                        if await model.runMove(session, source: source, noteIds: noteIds) {
                            dismiss()
                        }
                    }
                }
                .disabled(model.moveTopic.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.busy)
                .accessibilityIdentifier("memory-move-confirm")
            }
        }
        .onAppear {
            model.moveTopic = model.note?.folder ?? model.moveTopic
            model.moveScope = source.scope ?? model.moveScope
        }
    }
}

// MARK: - Trash

struct MemoryTrashPage: View {
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: MemoryManagerModel
    let source: MemoryManagerSource

    var body: some View {
        ThemedList {
            if model.trashRows.isEmpty {
                Section {
                    Text(String(localized: "Trash is empty."))
                        .foregroundStyle(Theme.textSecondary)
                        .frame(maxWidth: .infinity, alignment: .center)
                }
            } else {
                Section {
                    ForEach(model.trashRows) { row in
                        HStack {
                            Text(row.title)
                            Spacer()
                            Button(String(localized: "Restore")) {
                                Task { await model.restoreTrash(session, row: row) }
                            }
                            .font(.footnote.weight(.semibold))
                        }
                    }
                }
            }
            if let error = model.error {
                Section { Text(error).foregroundStyle(Theme.danger) }
            }
        }
        .navigationTitle(String(localized: "Trash"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.loadTrash(session) }
    }
}
