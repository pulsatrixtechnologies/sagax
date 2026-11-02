// Tools > Memory manager state (desktop MemoryManagerPanel.tsx). Loads
// sources and browse rows through the person's session credentials.
import CompanionCore
import SwiftUI

@MainActor
final class MemoryManagerModel: ObservableObject {
    @Published private(set) var sources: [MemoryManagerSource]?
    @Published private(set) var pxReason: String?
    @Published private(set) var browse: MemoryBrowse?
    @Published private(set) var note: MemoryNoteDetail?
    @Published private(set) var trashRows: [PerspicaxTrashList.TrashNote] = []
    @Published var query = ""
    @Published var selected: Set<String> = []
    @Published var busy = false
    @Published var error: String?
    @Published var notice: Notice?
    @Published var editing = false
    @Published var draft = ""
    @Published var draftTitle = ""
    @Published var draftTags = ""
    @Published var createTitle = ""
    @Published var moveTopic = "notes"
    @Published var moveScope = "me"

    struct Notice: Equatable {
        var text: String
        var undo: (() async -> Void)?

        static func == (lhs: Notice, rhs: Notice) -> Bool { lhs.text == rhs.text }
    }

    var visibleNotes: [MemoryNoteRow] {
        MemoryManager.filterNotes(browse?.notes ?? [], query: query)
    }

    func loadSources(_ session: Session) async {
        guard let client = session.settingsClient else {
            sources = []
            error = String(localized: "Not connected.")
            return
        }
        do {
            let result = try await client.memoryManagerSources()
            sources = result.sources
            pxReason = result.perspicax.available ? nil : result.perspicax.reason
            error = nil
        } catch {
            self.error = error.localizedDescription
            sources = []
        }
    }

    func loadBrowse(_ session: Session, source: MemoryManagerSource, folder: String? = nil) async {
        busy = true
        error = nil
        browse = nil
        selected = []
        defer { busy = false }
        guard let client = session.settingsClient else {
            browse = MemoryBrowse(folders: [], notes: [], mayWrite: false)
            return
        }
        do {
            switch source.kind {
            case .bot:
                guard let botId = source.botId else { throw APIError.badURL }
                var page = MemoryManager.browseBot(overview: try await client.memoryOverview(botId: botId))
                if let folder {
                    page.notes = page.notes.filter { $0.folder == folder }
                    page.folders = []
                }
                browse = page
            case .team:
                let list = try await client.teamMemory(section: source.section ?? "")
                var page = MemoryManager.browseTeam(entries: list.entries)
                if let folder {
                    page.notes = page.notes.filter { $0.folder == folder }
                    page.folders = []
                }
                browse = page
            case .perspicax:
                let tree = try await client.perspicaxMemoryTree()
                browse = MemoryManager.browsePerspicax(tree: tree, folder: folder, scope: source.scope)
            }
        } catch {
            self.error = error.localizedDescription
            browse = MemoryBrowse(folders: [], notes: [], mayWrite: false)
        }
    }

    func openNote(_ session: Session, source: MemoryManagerSource, row: MemoryNoteRow) async -> MemoryNoteDetail? {
        busy = true
        error = nil
        note = nil
        editing = false
        defer { busy = false }
        guard let client = session.settingsClient else { return nil }
        do {
            let detail: MemoryNoteDetail?
            switch source.kind {
            case .bot:
                guard let botId = source.botId, let path = row.path else { throw APIError.badURL }
                detail = MemoryManager.openBotNote(doc: try await client.memoryDoc(botId: botId, path: path))
            case .team:
                let list = try await client.teamMemory(section: source.section ?? "")
                guard let entry = list.entries.first(where: { $0.id == row.id }) else {
                    throw APIError.transport(String(localized: "This note no longer exists."))
                }
                detail = MemoryManager.openTeamNote(entry: entry)
            case .perspicax:
                guard let scope = row.scope else { throw APIError.badURL }
                detail = MemoryManager.openPerspicaxNote(try await client.perspicaxMemoryEntry(scope: scope, id: row.id))
            }
            guard let detail else { return nil }
            note = detail
            draft = detail.body
            draftTitle = detail.title
            draftTags = detail.tags.joined(separator: ", ")
            return detail
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }

    func saveNote(_ session: Session, source: MemoryManagerSource) async {
        guard let note, let client = session.settingsClient else { return }
        busy = true
        error = nil
        defer { busy = false }
        let nextTitle = draftTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? note.title : draftTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        let nextTags = MemoryManager.parseTags(draftTags)
        do {
            switch source.kind {
            case .bot:
                guard let botId = source.botId, var path = note.path else { throw APIError.badURL }
                let base = path.split(separator: "/").last.map { String($0).replacingOccurrences(of: ".md", with: "", options: .caseInsensitive) } ?? ""
                if nextTitle != note.title, path != MemoryRules.index {
                    let slug = MemoryManager.slugTitle(nextTitle, fallback: base)
                    let folder: String
                    if let slash = path.lastIndex(of: "/") {
                        folder = String(path[...slash])
                    } else {
                        folder = "memory/"
                    }
                    let nextPath = "\(folder)\(slug).md"
                    if nextPath != path {
                        _ = try await client.saveMemoryDoc(botId: botId, path: nextPath, text: draft, expectedHash: nil)
                        _ = try await client.deleteMemoryDoc(botId: botId, path: path)
                        path = nextPath
                    }
                }
                let result = try await client.saveMemoryDoc(
                    botId: botId,
                    path: path,
                    text: draft,
                    expectedHash: path == note.path ? note.hash : nil
                )
                switch result {
                case let .saved(doc, _):
                    self.note = MemoryNoteDetail(
                        id: path, title: nextTitle, body: doc.text, tags: [], path: path, hash: doc.hash,
                        mayEdit: true, bodyKind: MemoryManager.detectBodyKind(doc.text)
                    )
                    draft = doc.text
                case let .conflict(current, currentHash):
                    error = String(localized: "This note changed elsewhere. The other version was reloaded.")
                    self.note = MemoryNoteDetail(
                        id: path, title: note.title, body: current, tags: [], path: path, hash: currentHash,
                        mayEdit: true, bodyKind: MemoryManager.detectBodyKind(current)
                    )
                    draft = current
                    return
                }
            case .team:
                try await client.patchTeamMemory(section: source.section ?? "", id: note.id, name: nextTitle, detail: draft)
                self.note = MemoryNoteDetail(
                    id: note.id, title: nextTitle, body: draft, folder: note.folder, mayEdit: true, bodyKind: .markdown
                )
            case .perspicax:
                guard let scope = note.scope else { throw APIError.badURL }
                let saved = try await client.savePerspicaxMemoryEntry(
                    scope: scope, id: note.id, title: nextTitle, body: draft, tags: nextTags, baseVersion: note.version
                )
                self.note = MemoryManager.openPerspicaxNote(saved)
                draft = self.note?.body ?? draft
                draftTitle = self.note?.title ?? nextTitle
                draftTags = (self.note?.tags ?? nextTags).joined(separator: ", ")
            }
            editing = false
            notice = Notice(text: String(localized: "Saved"))
        } catch {
            self.error = error.localizedDescription
        }
    }

    func createNote(_ session: Session, source: MemoryManagerSource) async -> Bool {
        let title = createTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, let client = session.settingsClient else { return false }
        busy = true
        error = nil
        defer { busy = false }
        do {
            switch source.kind {
            case .bot:
                guard let botId = source.botId else { throw APIError.badURL }
                let path = "memory/\(MemoryManager.slugTitle(title)).md"
                _ = try await client.saveMemoryDoc(botId: botId, path: path, text: "# \(title)\n\n", expectedHash: nil)
            case .team:
                try await client.createTeamMemory(section: source.section ?? "", kind: "term", name: title, detail: "")
            case .perspicax:
                try await client.createPerspicaxMemoryEntry(scope: "me", topic: "notes", title: title, body: "")
            }
            createTitle = ""
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func deleteSelected(_ session: Session, source: MemoryManagerSource, folder: String?) async {
        let ids = Array(selected)
        guard !ids.isEmpty, let client = session.settingsClient else { return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            switch source.kind {
            case .bot:
                guard let botId = source.botId else { throw APIError.badURL }
                let paths = visibleNotes.filter { ids.contains($0.id) }.compactMap(\.path)
                for path in paths {
                    _ = try await client.deleteMemoryDoc(botId: botId, path: path)
                }
                let journal = try await client.memoryJournal(botId: botId, limit: 40)
                let undoIds = paths.compactMap { path in
                    journal.first(where: { $0.path == path && $0.kind == .deleted && $0.canRevert })?.id
                }
                notice = Notice(text: String(localized: "\(paths.count) notes deleted")) {
                    for id in undoIds {
                        _ = try? await client.revertMemoryChange(botId: botId, entryId: id)
                    }
                    await self.loadBrowse(session, source: source, folder: folder)
                }
            case .team:
                let section = source.section ?? ""
                var removed: [(id: String, kind: String, name: String, detail: String)] = []
                for id in ids {
                    guard let row = browse?.notes.first(where: { $0.id == id }) else { continue }
                    let list = try await client.teamMemory(section: section)
                    let detail = list.entries.first(where: { $0.id == id })
                    try await client.deleteTeamMemory(section: section, id: id)
                    if let detail {
                        removed.append((id, row.folder ?? "term", detail.name, detail.detail))
                    }
                }
                notice = Notice(text: String(localized: "\(removed.count) notes deleted")) {
                    for entry in removed {
                        try? await client.createTeamMemory(section: section, kind: entry.kind, name: entry.name, detail: entry.detail)
                    }
                    await self.loadBrowse(session, source: source, folder: folder)
                }
            case .perspicax:
                let items = visibleNotes.filter { ids.contains($0.id) }.compactMap { row -> [String: String]? in
                    guard let scope = row.scope else { return nil }
                    return ["scope": scope, "id": row.id]
                }
                let report = try await client.perspicaxMemoryBulk(action: "delete", items: items)
                let batch = report.batch
                let done = report.done ?? items.count
                notice = Notice(text: String(localized: "\(done) notes deleted")) {
                    if let batch {
                        try? await client.undoPerspicaxMemoryTrash(batch: batch)
                        await self.loadBrowse(session, source: source, folder: folder)
                    }
                }
            }
            selected = []
            await loadBrowse(session, source: source, folder: folder)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func runMove(_ session: Session, source: MemoryManagerSource, noteIds: [String]) async -> Bool {
        guard source.kind == .perspicax, let client = session.settingsClient else { return false }
        let topic = moveTopic.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !topic.isEmpty else { return false }
        busy = true
        error = nil
        defer { busy = false }
        do {
            let items = noteIds.map { id -> [String: String] in
                let row = browse?.notes.first(where: { $0.id == id })
                return ["scope": row?.scope ?? moveScope, "id": id]
            }
            _ = try await client.perspicaxMemoryBulk(action: "move", items: items, topic: topic, to: moveScope)
            selected = []
            notice = Notice(text: String(localized: "\(items.count) notes moved"))
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func loadTrash(_ session: Session) async {
        busy = true
        defer { busy = false }
        guard let client = session.settingsClient else {
            trashRows = []
            return
        }
        do {
            trashRows = try await client.perspicaxMemoryTrash().notes ?? []
        } catch {
            self.error = error.localizedDescription
            trashRows = []
        }
    }

    func restoreTrash(_ session: Session, row: PerspicaxTrashList.TrashNote) async {
        guard let client = session.settingsClient else { return }
        do {
            try await client.restorePerspicaxMemoryTrash(scope: row.scope, id: row.id)
            await loadTrash(session)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func toggleSelect(_ id: String) {
        if selected.contains(id) { selected.remove(id) } else { selected.insert(id) }
    }
}
