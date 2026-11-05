// Rules (RULES.md) and the bot folder tree (docs/, inbox/, memory/, …), the
// files the desktop's persona editor manages (WorkspaceFilesSection.tsx,
// server/routes/bot-workspace.ts). Open to the bot's owner like the soul;
// CLIENT_ALLOW, no route on the companion sidecar.
import Foundation

public struct BotWorkspaceEntry: Decodable, Hashable, Identifiable, Sendable {
    public var path: String
    public var kind: String
    public var bytes: Int?
    public var modifiedAt: Double?
    public var editable: Bool?
    public var markdown: Bool?
    public var load: String?
    /// When the file was created and last read by the bot (epoch ms), and
    /// whether it looks forgotten (no use in 30 days, not loaded every turn).
    public var createdAt: Double?
    public var lastUsedAt: Double?
    public var forgotten: Bool?
    public var id: String { path }

    public var name: String { path.split(separator: "/").last.map(String.init) ?? path }
    public var isDirectory: Bool { kind == "dir" }
    /// What /workspace/file serves: RULES.md or docs/<name>.md.
    public var isDoc: Bool { BotWorkspaceFiles.isDoc(path) }
    public var isCore: Bool { BotWorkspaceFiles.isCore(path) }
}

public struct BotWorkspaceListing: Decodable, Sendable {
    public struct Budget: Decodable, Sendable { public var maxLines: Int?; public var maxBytes: Int? }
    public struct Budgets: Decodable, Sendable { public var rules: Budget? }
    public struct Soul: Decodable, Sendable {
        public var path: String?
        public var bytes: Int?
        public var load: String?
        public var createdAt: Double?
        public var modifiedAt: Double?
        public var lastUsedAt: Double?
        /// SOUL.md's budget (`maxBytes`, its bytes).
        public var budget: SoulBudget?
    }
    public struct SoulBudget: Decodable, Sendable { public var maxBytes: Int?; public var bytes: Int? }

    public var entries: [BotWorkspaceEntry]
    public var rulesTemplate: String?
    public var budgets: Budgets?
    public var uploadMaxBytes: Int?
    public var soul: Soul?

    enum CodingKeys: String, CodingKey { case entries, rulesTemplate, budgets, uploadMaxBytes, soul }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        entries = (try? c.decodeIfPresent([Lossy<BotWorkspaceEntry>].self, forKey: .entries))??.compactMap(\.value) ?? []
        rulesTemplate = (try? c.decodeIfPresent(String.self, forKey: .rulesTemplate)) ?? nil
        budgets = (try? c.decodeIfPresent(Budgets.self, forKey: .budgets)) ?? nil
        uploadMaxBytes = (try? c.decodeIfPresent(Int.self, forKey: .uploadMaxBytes)) ?? nil
        soul = (try? c.decodeIfPresent(Soul.self, forKey: .soul)) ?? nil
    }

    /// The documents, by name.
    public var docs: [BotWorkspaceEntry] {
        entries.filter { $0.kind == "file" && BotWorkspaceFiles.isDoc($0.path) && $0.path != BotWorkspaceFiles.rulesPath }
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }
}

public enum BotWorkspaceFiles {
    public static let rulesPath = "RULES.md"
    public static let maxRulesLines = 60
    public static let maxRulesBytes = 8_000
    public static let coreFiles: Set<String> = ["SOUL.md", "MEMORY.md", "RULES.md"]

    public static func isCore(_ path: String) -> Bool { coreFiles.contains(path) }

    public static func isDoc(_ path: String) -> Bool {
        path == rulesPath || path.range(of: #"^docs\/[^/]+\.md$"#, options: .regularExpression) != nil
    }

    /// RULES.md as it loads: comments removed, blank runs folded, trimmed.
    public static func effectiveRules(_ raw: String) -> String {
        var text = raw.replacingOccurrences(of: #"<!--[\s\S]*?(?:-->|$)"#, with: "", options: .regularExpression)
        text = text.replacingOccurrences(of: #"\n{3,}"#, with: "\n\n", options: .regularExpression)
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Lines and bytes of what loads each turn, against the budget.
    public static func rulesCount(_ raw: String, maxLines: Int = maxRulesLines, maxBytes: Int = maxRulesBytes) -> (lines: Int, bytes: Int, over: Bool) {
        let text = effectiveRules(raw)
        let lines = text.isEmpty ? 0 : text.components(separatedBy: "\n").count
        let bytes = text.utf8.count
        return (lines, bytes, lines > maxLines || bytes > maxBytes)
    }

    /// `docPathFromName`: docs/<stem>.md from what the person typed; nil
    /// when nothing usable is left.
    public static func docPath(fromName input: String) -> String? {
        var stem = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if stem.hasPrefix("docs/") { stem.removeFirst(5) }
        if stem.lowercased().hasSuffix(".md") { stem.removeLast(3) }
        stem = stem.replacingOccurrences(of: #"[^\p{L}\p{N}_ .-]+"#, with: "-", options: .regularExpression)
        stem = stem.replacingOccurrences(of: #"^[^\p{L}\p{N}_]+"#, with: "", options: .regularExpression)
        stem = stem.trimmingCharacters(in: .whitespaces)
        guard !stem.isEmpty, stem.count <= 190 else { return nil }
        return "docs/\(stem).md"
    }

    /// Join a parent folder with a file or folder name.
    public static func join(parent: String?, name: String) -> String {
        let clean = name.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let parent, !parent.isEmpty else { return clean }
        return "\(parent.trimmingCharacters(in: CharacterSet(charactersIn: "/")))/\(clean)"
    }
}

struct WorkspaceRenameBody: Encodable { var from: String; var to: String }
struct WorkspacePathBody: Encodable { var path: String; var text: String? }

public extension CompanionClient {
    /// `GET /api/bots/:id/workspace`.
    func botWorkspace(botId: String) async throws -> BotWorkspaceListing {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try await send(makeRequest("GET", "/api/bots/\(botId)/workspace"), as: BotWorkspaceListing.self)
    }

    /// `GET /api/bots/:id/workspace/file?path=`.
    func workspaceDoc(botId: String, path: String) async throws -> MemoryDoc {
        try await send(workspaceFileRequest("GET", botId: botId, path: path), as: MemoryDoc.self)
    }

    /// `PUT /api/bots/:id/workspace/file {path, text, expectedHash}`; a 409
    /// carries the file as it is now.
    func saveWorkspaceDoc(botId: String, path: String, text: String, expectedHash: String?) async throws -> MemorySaveResult {
        guard Self.validRouteID(botId), BotWorkspaceFiles.isDoc(path) else { throw APIError.badURL }
        let request = try makeRequest("PUT", "/api/bots/\(botId)/workspace/file", encodedBody: MemorySaveBody(path: path, text: text, expectedHash: expectedHash))
        let (data, response) = try await perform(request)
        if (response as? HTTPURLResponse)?.statusCode == 409,
           let conflict = try? JSONDecoder().decode(MemoryConflictBody.self, from: data) {
            return .conflict(current: conflict.current, currentHash: conflict.currentHash)
        }
        try Self.check(response, data)
        return .saved(try JSONDecoder().decode(MemoryDoc.self, from: data), nil)
    }

    /// `DELETE /api/bots/:id/workspace/file?path=`.
    func deleteWorkspaceDoc(botId: String, path: String) async throws {
        try await send(workspaceFileRequest("DELETE", botId: botId, path: path))
    }

    /// `POST /api/bots/:id/workspace/docs/rename {from, to}`.
    func renameWorkspaceDoc(botId: String, from: String, to: String) async throws {
        guard Self.validRouteID(botId), BotWorkspaceFiles.isDoc(from), BotWorkspaceFiles.isDoc(to) else { throw APIError.badURL }
        try await send(makeRequest("POST", "/api/bots/\(botId)/workspace/docs/rename", encodedBody: WorkspaceRenameBody(from: from, to: to)))
    }

    /// `POST /api/bots/:id/workspace/mkdir {path}`.
    func createWorkspaceFolder(botId: String, path: String) async throws {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        try await send(makeRequest("POST", "/api/bots/\(botId)/workspace/mkdir", encodedBody: WorkspacePathBody(path: path, text: nil)))
    }

    /// `POST /api/bots/:id/workspace/touch {path, text?}`.
    func createWorkspaceFile(botId: String, path: String, text: String = "") async throws {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        try await send(makeRequest("POST", "/api/bots/\(botId)/workspace/touch", encodedBody: WorkspacePathBody(path: path, text: text)))
    }

    /// `POST /api/bots/:id/workspace/rename {from, to}`.
    func renameWorkspaceEntry(botId: String, from: String, to: String) async throws {
        guard Self.validRouteID(botId), !BotWorkspaceFiles.isCore(from), !BotWorkspaceFiles.isCore(to) else { throw APIError.badURL }
        try await send(makeRequest("POST", "/api/bots/\(botId)/workspace/rename", encodedBody: WorkspaceRenameBody(from: from, to: to)))
    }

    /// `DELETE /api/bots/:id/workspace/entry?path=&recursive=`.
    func deleteWorkspaceEntry(botId: String, path: String, recursive: Bool = false) async throws {
        guard Self.validRouteID(botId), !BotWorkspaceFiles.isCore(path) else { throw APIError.badURL }
        var query = [URLQueryItem(name: "path", value: path)]
        if recursive { query.append(URLQueryItem(name: "recursive", value: "1")) }
        try await send(makeRequest("DELETE", "/api/bots/\(botId)/workspace/entry", query: query))
    }

    /// `GET /api/bots/:id/workspace/count?path=`.
    func countWorkspaceFiles(botId: String, path: String) async throws -> Int {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        struct Count: Decodable { var count: Int }
        let body: Count = try await send(makeRequest("GET", "/api/bots/\(botId)/workspace/count", query: [URLQueryItem(name: "path", value: path)]), as: Count.self)
        return body.count
    }

    /// `POST /api/bots/:id/workspace/upload?path=` with raw bytes.
    func uploadWorkspaceFile(botId: String, path: String, data: Data, overwrite: Bool = false) async throws {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        var query = [URLQueryItem(name: "path", value: path)]
        if overwrite { query.append(URLQueryItem(name: "overwrite", value: "1")) }
        var request = try makeRequest("POST", "/api/bots/\(botId)/workspace/upload", query: query)
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        request.httpBody = data
        let (body, response) = try await perform(request)
        try Self.check(response, body)
    }

    /// `GET /api/bots/:id/workspace/download?path=` as bytes.
    func downloadWorkspaceFile(botId: String, path: String) async throws -> Data {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        let request = try makeRequest("GET", "/api/bots/\(botId)/workspace/download", query: [URLQueryItem(name: "path", value: path)])
        let (data, response) = try await perform(request)
        try Self.check(response, data)
        return data
    }

    func workspaceFileRequest(_ method: String, botId: String, path: String) throws -> URLRequest {
        guard Self.validRouteID(botId), BotWorkspaceFiles.isDoc(path) else { throw APIError.badURL }
        return try makeRequest(method, "/api/bots/\(botId)/workspace/file", query: [URLQueryItem(name: "path", value: path)])
    }
}
