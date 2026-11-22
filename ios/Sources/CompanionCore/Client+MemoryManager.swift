// HTTP for Tools > Memory: sources catalog, team memory, Perspicax notes
// proxy (`/api/me/memory/*`). Bot file routes stay in Client+BotAdvanced.
import Foundation

extension CompanionClient {
    /// `GET /api/memory-manager/sources`
    public func memoryManagerSources() async throws -> MemoryManagerSourcesResponse {
        try await send(makeRequest("GET", "/api/memory-manager/sources"), as: MemoryManagerSourcesResponse.self)
    }

    /// `GET /api/team-memory?section=`
    public func teamMemory(section: String) async throws -> TeamMemoryList {
        try await send(
            makeRequest("GET", "/api/team-memory", query: [URLQueryItem(name: "section", value: section)]),
            as: TeamMemoryList.self
        )
    }

    /// `POST /api/team-memory?section=`
    public func createTeamMemory(section: String, kind: String, name: String, detail: String) async throws {
        try await send(makeRequest(
            "POST",
            "/api/team-memory",
            query: [URLQueryItem(name: "section", value: section)],
            body: ["kind": kind, "name": name, "detail": detail]
        ))
    }

    /// `PATCH /api/team-memory/:id?section=`
    public func patchTeamMemory(section: String, id: String, name: String, detail: String) async throws {
        guard Self.validRouteID(id) else { throw APIError.badURL }
        try await send(makeRequest(
            "PATCH",
            "/api/team-memory/\(id)",
            query: [URLQueryItem(name: "section", value: section)],
            body: ["name": name, "detail": detail]
        ))
    }

    /// `DELETE /api/team-memory/:id?section=`
    public func deleteTeamMemory(section: String, id: String) async throws {
        guard Self.validRouteID(id) else { throw APIError.badURL }
        try await send(makeRequest(
            "DELETE",
            "/api/team-memory/\(id)",
            query: [URLQueryItem(name: "section", value: section)]
        ))
    }

    /// `GET /api/me/memory/tree`
    public func perspicaxMemoryTree() async throws -> PerspicaxTree {
        try await send(makeRequest("GET", "/api/me/memory/tree"), as: PerspicaxTree.self)
    }

    /// `GET /api/me/memory/entry?scope=&id=`
    public func perspicaxMemoryEntry(scope: String, id: String) async throws -> PerspicaxEntry {
        try await send(
            makeRequest(
                "GET",
                "/api/me/memory/entry",
                query: [
                    URLQueryItem(name: "scope", value: scope),
                    URLQueryItem(name: "id", value: id),
                ]
            ),
            as: PerspicaxEntry.self
        )
    }

    /// `POST /api/me/memory/entry` (create).
    public func createPerspicaxMemoryEntry(scope: String, topic: String, title: String, body: String) async throws {
        try await send(makeRequest(
            "POST",
            "/api/me/memory/entry",
            body: ["scope": scope, "topic": topic, "title": title, "body": body]
        ))
    }

    /// `PUT /api/me/memory/entry` (save). `baseVersion` is the note's content
    /// hash, sent back as `base_version`. Perspicax refuses a stale copy with
    /// 409 `memory_conflict` and `details.version` (the current hash). An
    /// import overwrite does not come through here: it sends no version.
    public func savePerspicaxMemoryEntry(
        scope: String,
        id: String,
        title: String,
        body: String,
        tags: [String],
        baseVersion: String?
    ) async throws -> PerspicaxMemorySave {
        var payload: [String: Any] = [
            "scope": scope,
            "id": id,
            "title": title,
            "body": body,
            "tags": tags,
        ]
        if let baseVersion, !baseVersion.isEmpty { payload["base_version"] = baseVersion }
        let (data, response) = try await perform(makeRequest("PUT", "/api/me/memory/entry", body: payload))
        if (response as? HTTPURLResponse)?.statusCode == 409,
           let conflict = try? JSONDecoder().decode(PerspicaxConflictBody.self, from: data),
           conflict.code == "memory_conflict" {
            return .conflict(version: conflict.details?.version)
        }
        try Self.check(response, data)
        do {
            return .saved(try JSONDecoder().decode(PerspicaxEntry.self, from: data))
        } catch {
            throw APIError.transport("The computer sent something this app couldn't read.")
        }
    }

    /// `POST /api/me/memory/bulk`
    public func perspicaxMemoryBulk(action: String, items: [[String: String]], topic: String? = nil, to: String? = nil) async throws -> PerspicaxBulkReport {
        var payload: [String: Any] = ["action": action, "items": items]
        if let topic { payload["topic"] = topic }
        if let to { payload["to"] = to }
        return try await send(makeRequest("POST", "/api/me/memory/bulk", body: payload), as: PerspicaxBulkReport.self)
    }

    /// `GET /api/me/memory/trash`
    public func perspicaxMemoryTrash() async throws -> PerspicaxTrashList {
        try await send(makeRequest("GET", "/api/me/memory/trash"), as: PerspicaxTrashList.self)
    }

    /// `POST /api/me/memory/trash/undo`
    public func undoPerspicaxMemoryTrash(batch: String) async throws {
        try await send(makeRequest("POST", "/api/me/memory/trash/undo", body: ["batch": batch]))
    }

    /// `POST /api/me/memory/trash` restore one note (optional helper).
    public func restorePerspicaxMemoryTrash(scope: String, id: String) async throws {
        try await send(makeRequest("POST", "/api/me/memory/trash/undo", body: ["scope": scope, "id": id]))
    }
}

/// `PUT /api/me/memory/entry`: a 409 `memory_conflict` is an answer, not a
/// failure. The current hash is `details.version`; the note itself is not in
/// the refusal, so the editor reloads it before the next save.
public enum PerspicaxMemorySave: Sendable {
    case saved(PerspicaxEntry)
    case conflict(version: String?)
}

private struct PerspicaxConflictBody: Decodable {
    var code: String?
    var details: Details?

    struct Details: Decodable {
        var version: String?

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            version = PerspicaxEntry.readVersion(container, forKey: .version)
        }

        enum CodingKeys: String, CodingKey { case version }
    }
}
