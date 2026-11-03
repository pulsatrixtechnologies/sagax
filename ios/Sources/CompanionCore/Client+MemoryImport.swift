// HTTP for Memory > Import and Delete folder (desktop MemoryManagerPanel.tsx,
// memory-manager.ts emptyBotFolder, 2026-11-03), next to the memory calls of
// Client+MemoryManager.swift and Client+BotAdvanced.swift. Same routes as the
// desktop.
import Foundation

/// The wire answer of `POST /api/bots/:id/memory/import`.
private struct BotImportAnswer: Decodable {
    struct Row: Decodable {
        var path: String
        var status: String
        var reason: String?
    }

    var results: [Row]
}

/// What emptying a bot's memory folder did: each one a journal row Undo puts back.
public struct MemoryFolderEmptied: Hashable, Sendable {
    public var undoIds: [String]
    public var count: Int
}

public extension CompanionClient {
    // MARK: Import

    /// `POST /api/bots/:id/memory/import { notes: [{path, text}], attachments: [{path, data}], conflict }`:
    /// one batch. The server checks every path, size and secret again, journals
    /// each write as the import's and leaves an identical note alone.
    func importIntoBotMemory(
        botId: String,
        notes: [(path: String, text: String)],
        attachments: [(path: String, data: String)],
        conflict: VaultConflict
    ) async throws -> [VaultWriteResult] {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        var request = try makeRequest("POST", "/api/bots/\(botId)/memory/import", body: [
            "notes": notes.map { ["path": $0.path, "text": $0.text] },
            "attachments": attachments.map { ["path": $0.path, "data": $0.data] },
            "conflict": conflict.rawValue,
        ])
        // A batch carries up to 6 MB of notes: more than the twenty seconds of a small call.
        request.timeoutInterval = 120
        let answer = try await send(request, as: BotImportAnswer.self)
        return answer.results.map { VaultWriteResult(path: $0.path, status: VaultImportStatus(rawValue: $0.status) ?? .refused, reason: $0.reason) }
    }

    /// `POST /api/me/memory/entry { scope, topic, title, body, tags }` (the import's create).
    func createPerspicaxMemoryNote(scope: String, topic: String, title: String, body: String, tags: [String]) async throws {
        try await send(makeRequest("POST", "/api/me/memory/entry", body: [
            "scope": scope, "topic": topic, "title": title, "body": body, "tags": tags,
        ]))
    }

    /// `PUT /api/me/memory/entry { scope, id, title, body, tags }` (the import's overwrite).
    func updatePerspicaxMemoryNote(scope: String, id: String, title: String, body: String, tags: [String]) async throws {
        try await send(makeRequest("PUT", "/api/me/memory/entry", body: [
            "scope": scope, "id": id, "title": title, "body": body, "tags": tags,
        ]))
    }

    /// The notes already at a destination, to decide conflicts against: a
    /// bot's `memory/<name>.md` files (id: the file's path), or a Perspicax
    /// tier's entries (folder: topic, id: entry id), with their folders.
    func vaultDestinationNotes(_ target: VaultImportTarget) async throws -> (existing: [VaultExistingNote], folders: [String]) {
        switch target {
        case .bot(let botId):
            let overview = try await memoryOverview(botId: botId)
            let existing = overview.topics.filter { $0.path.hasPrefix("memory/") }.map { file in
                VaultExistingNote(folder: "", title: file.name.lowercased().hasSuffix(".md") ? String(file.name.dropLast(3)) : file.name, body: nil, id: file.path)
            }
            return (existing, [])
        case .perspicax(let scope):
            let tree = try await perspicaxMemoryTree()
            guard let tier = tree.tiers.first(where: { $0.scope == scope }) else { return ([], []) }
            let existing = tier.topics.flatMap { topic in
                topic.entries.map { VaultExistingNote(folder: $0.topic, title: $0.title, body: nil, id: $0.id) }
            }
            return (existing, tier.topics.map(\.topic))
        }
    }

    /// The text of the notes a conflict is decided against (an identical note is "unchanged").
    func vaultFillBodies(_ notes: [VaultExistingNote], target: VaultImportTarget, keys: Set<String>) async -> [VaultExistingNote] {
        var out: [VaultExistingNote] = []
        for note in notes {
            var next = note
            if note.body == nil, keys.contains(ObsidianVault.existingKey(folder: note.folder, title: note.title)), let id = note.id, !Task.isCancelled {
                switch target {
                case .bot(let botId): next.body = try? await memoryDoc(botId: botId, path: id).text
                case .perspicax(let scope): next.body = try? await perspicaxMemoryEntry(scope: scope, id: id).body
                }
            }
            out.append(next)
        }
        return out
    }

    // MARK: Delete folder

    /// A bot memory folder no bot is linked to, emptied: its topics and logs
    /// deleted and its MEMORY.md cleared (it cannot be deleted), each one a
    /// journal row the Trash and Undo put back.
    func emptyBotMemoryFolder(botId: String, paths: [String], clearIndex: Bool) async throws -> MemoryFolderEmptied {
        for path in paths { _ = try await deleteMemoryDoc(botId: botId, path: path) }
        // Journal rows for undo: latest deletes for these paths.
        let journal = try await memoryJournal(botId: botId, limit: 40)
        var undoIds = paths.compactMap { path in journal.first { $0.path == path && $0.kind == .deleted && $0.canRevert }?.id }
        if clearIndex {
            _ = try await saveMemoryDoc(botId: botId, path: MemoryRules.index, text: "", expectedHash: nil)
            let after = try await memoryJournal(botId: botId, limit: 10)
            if let cleared = after.first(where: { $0.path == MemoryRules.index && $0.canRevert }) { undoIds.append(cleared.id) }
        }
        return MemoryFolderEmptied(undoIds: undoIds, count: paths.count + (clearIndex ? 1 : 0))
    }

    /// Undo of `emptyBotMemoryFolder`: each journal row reverted.
    func undoBotMemoryFolderDelete(botId: String, undoIds: [String]) async {
        for id in undoIds { _ = try? await revertMemoryChange(botId: botId, entryId: id) }
    }

    /// A Perspicax folder deleted (`POST /api/me/memory/bulk` action delete): its notes go to the Trash; `batch` undoes it.
    func deletePerspicaxMemoryFolder(scope: String, ids: [String]) async throws -> PerspicaxBulkReport {
        try await perspicaxMemoryBulk(action: "delete", items: ids.map { ["scope": scope, "id": $0] })
    }
}

/// The import's writers over a client.
public struct ClientVaultWriters: VaultImportWriters {
    public let client: CompanionClient

    public init(client: CompanionClient) { self.client = client }

    public func bot(botId: String, notes: [(path: String, text: String)], attachments: [(path: String, data: String)], conflict: VaultConflict) async throws -> [VaultWriteResult] {
        try await client.importIntoBotMemory(botId: botId, notes: notes, attachments: attachments, conflict: conflict)
    }

    public func pxCreate(scope: String, topic: String, title: String, body: String, tags: [String]) async throws {
        try await client.createPerspicaxMemoryNote(scope: scope, topic: topic, title: title, body: body, tags: tags)
    }

    public func pxUpdate(scope: String, id: String, title: String, body: String, tags: [String]) async throws {
        try await client.updatePerspicaxMemoryNote(scope: scope, id: id, title: title, body: body, tags: tags)
    }
}
