// Tools > Memory manager (desktop src/lib/memory-manager.ts, 2026-11-02):
// sources catalog, browse rows, note helpers, JSON fence split and folding
// tree rules. Views and the HTTP client sit beside this file.
import Foundation

// MARK: - Sources

public enum MemorySourceKind: String, Codable, Hashable, Sendable {
    case bot, team, perspicax
}

public struct MemoryManagerSource: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var kind: MemorySourceKind
    public var name: String
    public var detail: String?
    public var mayWrite: Bool
    public var mayManage: Bool?
    public var botId: String?
    public var section: String?
    public var scope: String?
    /// Bot source: false when no current bot owns this memory (a temporary
    /// agent's); nil from an older computer (treated as linked).
    public var linked: Bool?

    public init(
        id: String,
        kind: MemorySourceKind,
        name: String,
        detail: String? = nil,
        mayWrite: Bool,
        mayManage: Bool? = nil,
        botId: String? = nil,
        section: String? = nil,
        scope: String? = nil,
        linked: Bool? = nil
    ) {
        self.id = id
        self.kind = kind
        self.name = name
        self.detail = detail
        self.mayWrite = mayWrite
        self.mayManage = mayManage
        self.botId = botId
        self.section = section
        self.scope = scope
        self.linked = linked
    }
}

public struct MemoryManagerSourcesResponse: Codable, Hashable, Sendable {
    public var sources: [MemoryManagerSource]
    public var perspicax: PerspicaxAvailability

    public struct PerspicaxAvailability: Codable, Hashable, Sendable {
        public var available: Bool
        public var reason: String?

        public init(available: Bool, reason: String? = nil) {
            self.available = available
            self.reason = reason
        }
    }

    public init(sources: [MemoryManagerSource], perspicax: PerspicaxAvailability) {
        self.sources = sources
        self.perspicax = perspicax
    }
}

// MARK: - Browse / notes

public struct MemoryNoteRow: Hashable, Sendable, Identifiable {
    public var id: String
    public var title: String
    public var folder: String?
    public var tags: [String]?
    public var updatedAt: Double?
    public var excerpt: String?
    public var path: String?
    public var kind: String?
    public var scope: String?

    public init(
        id: String,
        title: String,
        folder: String? = nil,
        tags: [String]? = nil,
        updatedAt: Double? = nil,
        excerpt: String? = nil,
        path: String? = nil,
        kind: String? = nil,
        scope: String? = nil
    ) {
        self.id = id
        self.title = title
        self.folder = folder
        self.tags = tags
        self.updatedAt = updatedAt
        self.excerpt = excerpt
        self.path = path
        self.kind = kind
        self.scope = scope
    }
}

public struct MemoryFolderRow: Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var count: Int

    public init(id: String, name: String, count: Int) {
        self.id = id
        self.name = name
        self.count = count
    }
}

public struct MemoryBrowse: Hashable, Sendable {
    public var folders: [MemoryFolderRow]
    public var notes: [MemoryNoteRow]
    public var trashCount: Int?
    public var mayWrite: Bool
    public var mayManage: Bool?

    public init(
        folders: [MemoryFolderRow],
        notes: [MemoryNoteRow],
        trashCount: Int? = nil,
        mayWrite: Bool,
        mayManage: Bool? = nil
    ) {
        self.folders = folders
        self.notes = notes
        self.trashCount = trashCount
        self.mayWrite = mayWrite
        self.mayManage = mayManage
    }
}

public enum MemoryBodyKind: String, Hashable, Sendable {
    case markdown, json
}

public struct MemoryNoteDetail: Hashable, Sendable, Identifiable {
    public var id: String
    public var title: String
    public var body: String
    public var tags: [String]
    public var folder: String?
    public var scope: String?
    public var path: String?
    public var hash: String?
    public var version: Int?
    public var mayEdit: Bool
    public var bodyKind: MemoryBodyKind

    public init(
        id: String,
        title: String,
        body: String,
        tags: [String] = [],
        folder: String? = nil,
        scope: String? = nil,
        path: String? = nil,
        hash: String? = nil,
        version: Int? = nil,
        mayEdit: Bool,
        bodyKind: MemoryBodyKind
    ) {
        self.id = id
        self.title = title
        self.body = body
        self.tags = tags
        self.folder = folder
        self.scope = scope
        self.path = path
        self.hash = hash
        self.version = version
        self.mayEdit = mayEdit
        self.bodyKind = bodyKind
    }
}

// MARK: - Team / Perspicax wire shapes

public struct TeamMemoryEntry: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var kind: String
    public var name: String
    public var detail: String
    public var status: String?
    public var updatedAt: Double?

    public init(id: String, kind: String, name: String, detail: String, status: String? = nil, updatedAt: Double? = nil) {
        self.id = id
        self.kind = kind
        self.name = name
        self.detail = detail
        self.status = status
        self.updatedAt = updatedAt
    }
}

public struct TeamMemoryList: Codable, Hashable, Sendable {
    public var entries: [TeamMemoryEntry]
}

public struct PerspicaxTree: Codable, Hashable, Sendable {
    public var tiers: [Tier]

    public struct Tier: Codable, Hashable, Sendable {
        public var scope: String
        public var kind: String
        public var name: String
        public var mayWrite: Bool
        public var mayManage: Bool?
        public var trashed: Int?
        public var topics: [Topic]

        enum CodingKeys: String, CodingKey {
            case scope, kind, name, topics, trashed
            case mayWrite = "may_write"
            case mayManage = "may_manage"
        }
    }

    public struct Topic: Codable, Hashable, Sendable {
        public var topic: String
        public var count: Int
        public var entries: [Entry]
    }

    public struct Entry: Codable, Hashable, Sendable, Identifiable {
        public var id: String
        public var title: String
        public var topic: String
        public var tags: [String]?
        public var updated: String?
        public var excerpt: String?
    }
}

public struct PerspicaxEntry: Codable, Hashable, Sendable {
    public var id: String
    public var title: String
    public var body: String
    public var tags: [String]?
    public var topic: String?
    public var scope: String?
    public var version: Int?
    public var mayEdit: Bool?
    public var sealed: Bool?

    enum CodingKeys: String, CodingKey {
        case id, title, body, tags, topic, scope, version, sealed
        case mayEdit = "may_edit"
    }
}

public struct PerspicaxBulkReport: Codable, Hashable, Sendable {
    public var done: Int?
    public var batch: String?
}

public struct PerspicaxTrashList: Codable, Hashable, Sendable {
    public var notes: [TrashNote]?

    public struct TrashNote: Codable, Hashable, Sendable, Identifiable {
        public var id: String
        public var title: String
        public var scope: String
        public var mayManage: Bool?

        enum CodingKeys: String, CodingKey {
            case id, title, scope
            case mayManage = "may_manage"
        }
    }
}

// MARK: - Pure helpers (desktop memory-manager.ts)

public enum MemoryManager {
    /// Whole-document JSON (trimmed text parses as object or array).
    public static func detectBodyKind(_ text: String) -> MemoryBodyKind {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.first == "{" || trimmed.first == "[" else { return .markdown }
        guard let data = trimmed.data(using: .utf8),
              let value = try? JSONSerialization.jsonObject(with: data),
              value is [Any] || value is [String: Any]
        else { return .markdown }
        return .json
    }

    public enum FencePart: Equatable, Sendable {
        case text(String)
        case json(String)
    }

    /// Split markdown into text and ```json fences for the read view.
    public static func splitJsonFences(_ text: String) -> [FencePart] {
        var parts: [FencePart] = []
        let pattern = #"```json\s*\n([\s\S]*?)```"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
            return [.text(text)]
        }
        let ns = text as NSString
        let full = NSRange(location: 0, length: ns.length)
        var last = 0
        regex.enumerateMatches(in: text, options: [], range: full) { match, _, _ in
            guard let match, match.numberOfRanges >= 2 else { return }
            let whole = match.range(at: 0)
            let body = match.range(at: 1)
            if whole.location > last {
                parts.append(.text(ns.substring(with: NSRange(location: last, length: whole.location - last))))
            }
            parts.append(.json(ns.substring(with: body)))
            last = whole.location + whole.length
        }
        if last < ns.length {
            parts.append(.text(ns.substring(with: NSRange(location: last, length: ns.length - last))))
        }
        return parts.isEmpty ? [.text(text)] : parts
    }

    public static func filterNotes(_ notes: [MemoryNoteRow], query: String) -> [MemoryNoteRow] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return notes }
        return notes.filter { note in
            var hay = [note.title, note.excerpt, note.folder].compactMap { $0 }
            if let tags = note.tags { hay.append(contentsOf: tags) }
            return hay.joined(separator: "\n").lowercased().contains(q)
        }
    }

    /// Map a bot memory overview onto the manager's browse rows.
    public static func browseBot(overview: MemoryOverview) -> MemoryBrowse {
        var notes: [MemoryNoteRow] = [
            MemoryNoteRow(id: MemoryRules.index, title: MemoryRules.index, path: MemoryRules.index),
        ]
        notes += overview.topics.map { topic in
            MemoryNoteRow(
                id: topic.path,
                title: stripMd(topic.name),
                folder: "topics",
                updatedAt: topic.modifiedAt,
                path: topic.path
            )
        }
        notes += overview.logs.map { log in
            MemoryNoteRow(
                id: log.path,
                title: stripMd(log.name),
                folder: "logs",
                updatedAt: log.modifiedAt,
                path: log.path
            )
        }
        let folders = [
            MemoryFolderRow(id: "topics", name: "Topics", count: overview.topics.count),
            MemoryFolderRow(id: "logs", name: "Logs", count: overview.logs.count),
        ].filter { $0.count > 0 }
        return MemoryBrowse(folders: folders, notes: notes, mayWrite: true)
    }

    public static func openBotNote(doc: MemoryDoc) -> MemoryNoteDetail {
        let path = doc.path
        let title = path == MemoryRules.index
            ? MemoryRules.index
            : stripMd(path.split(separator: "/").last.map(String.init) ?? path)
        return MemoryNoteDetail(
            id: path,
            title: title,
            body: doc.text,
            path: path,
            hash: doc.hash,
            mayEdit: true,
            bodyKind: detectBodyKind(doc.text)
        )
    }

    public static func browseTeam(entries: [TeamMemoryEntry]) -> MemoryBrowse {
        let notes = entries.map { entry in
            MemoryNoteRow(
                id: entry.id,
                title: entry.name,
                folder: entry.kind,
                updatedAt: entry.updatedAt,
                excerpt: String(entry.detail.prefix(160)),
                kind: entry.kind
            )
        }
        var counts: [String: Int] = [:]
        for note in notes {
            let key = note.folder ?? "term"
            counts[key, default: 0] += 1
        }
        let folders = counts.map { MemoryFolderRow(id: $0.key, name: $0.key, count: $0.value) }
            .sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
        return MemoryBrowse(folders: folders, notes: notes, mayWrite: true)
    }

    public static func openTeamNote(entry: TeamMemoryEntry) -> MemoryNoteDetail {
        MemoryNoteDetail(
            id: entry.id,
            title: entry.name,
            body: entry.detail,
            folder: entry.kind,
            mayEdit: true,
            bodyKind: .markdown
        )
    }

    public static func browsePerspicax(tree: PerspicaxTree, folder: String? = nil, scope: String? = nil) -> MemoryBrowse {
        var notes: [MemoryNoteRow] = []
        var folders: [MemoryFolderRow] = []
        var mayWrite = false
        var mayManage = false
        var trashCount = 0
        for tier in tree.tiers {
            if let scope, tier.scope != scope, !(scope == "me" && tier.kind == "me") { continue }
            mayWrite = mayWrite || tier.mayWrite
            mayManage = mayManage || (tier.mayManage == true)
            trashCount += tier.trashed ?? 0
            for topic in tier.topics {
                folders.append(MemoryFolderRow(id: "\(tier.scope)/\(topic.topic)", name: topic.topic, count: topic.count))
                for entry in topic.entries {
                    if let folder, entry.topic != folder, "\(tier.scope)/\(entry.topic)" != folder { continue }
                    notes.append(MemoryNoteRow(
                        id: entry.id,
                        title: entry.title,
                        folder: entry.topic,
                        tags: entry.tags,
                        updatedAt: entry.updated.flatMap { ISO8601DateFormatter().date(from: $0)?.timeIntervalSince1970 }.map { $0 * 1000 },
                        excerpt: entry.excerpt,
                        scope: tier.scope
                    ))
                }
            }
        }
        return MemoryBrowse(folders: folders, notes: notes, trashCount: trashCount, mayWrite: mayWrite, mayManage: mayManage)
    }

    public static func openPerspicaxNote(_ note: PerspicaxEntry) -> MemoryNoteDetail {
        MemoryNoteDetail(
            id: note.id,
            title: note.title,
            body: note.body,
            tags: note.tags ?? [],
            folder: note.topic,
            scope: note.scope,
            version: note.version,
            mayEdit: note.mayEdit != false && note.sealed != true,
            bodyKind: detectBodyKind(note.body)
        )
    }

    /// Slug a note title the way the desktop create/rename path does.
    public static func slugTitle(_ title: String, fallback: String = "note") -> String {
        let lowered = title.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let scalars = lowered.unicodeScalars.map { CharacterSet.alphanumerics.contains($0) ? Character($0) : Character("-") }
        var slug = String(scalars)
        while slug.contains("--") { slug = slug.replacingOccurrences(of: "--", with: "-") }
        slug = slug.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return slug.isEmpty ? fallback : slug
    }

    public static func parseTags(_ value: String) -> [String] {
        value.split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }

    private static func stripMd(_ name: String) -> String {
        if name.lowercased().hasSuffix(".md") { return String(name.dropLast(3)) }
        return name
    }
}

// MARK: - JSON folding tree (desktop src/lib/json-tree.ts)

public enum MemoryJsonKind: String, Sendable {
    case object, array, string, number, boolean, null
}

public indirect enum MemoryJsonValue: Equatable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([MemoryJsonValue])
    case object([(String, MemoryJsonValue)])

    public static func == (lhs: MemoryJsonValue, rhs: MemoryJsonValue) -> Bool {
        switch (lhs, rhs) {
        case (.null, .null): return true
        case let (.bool(a), .bool(b)): return a == b
        case let (.number(a), .number(b)): return a == b
        case let (.string(a), .string(b)): return a == b
        case let (.array(a), .array(b)): return a == b
        case let (.object(a), .object(b)):
            guard a.count == b.count else { return false }
            return zip(a, b).allSatisfy { $0.0 == $1.0 && $0.1 == $1.1 }
        default: return false
        }
    }
}

public enum MemoryJsonTree {
    public static let rootPath = "$"
    public static let pageSize = 200
    public static let expandAllLimit = 2000

    public static func kind(of value: MemoryJsonValue) -> MemoryJsonKind {
        switch value {
        case .null: return .null
        case .bool: return .boolean
        case .number: return .number
        case .string: return .string
        case .array: return .array
        case .object: return .object
        }
    }

    public static func children(of value: MemoryJsonValue) -> [(String, MemoryJsonValue)] {
        switch value {
        case let .array(items): return items.enumerated().map { (String($0.offset), $0.element) }
        case let .object(entries): return entries
        default: return []
        }
    }

    public static func childPath(_ path: String, key: String) -> String {
        let escaped = key.replacingOccurrences(of: "~", with: "~0").replacingOccurrences(of: "/", with: "~1")
        return "\(path)/\(escaped)"
    }

    public static func parse(_ text: String) -> MemoryJsonValue? {
        var payload = text
        if payload.unicodeScalars.first?.value == 0xfeff {
            payload = String(payload.dropFirst())
        }
        guard let data = payload.data(using: .utf8),
              let raw = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
        else { return nil }
        return wrap(raw)
    }

    public static func expandAllPaths(_ root: MemoryJsonValue, limit: Int = expandAllLimit) -> Set<String> {
        var open = Set<String>()
        var queue: [(String, MemoryJsonValue)] = [(rootPath, root)]
        while !queue.isEmpty, open.count < limit {
            let (path, value) = queue.removeFirst()
            let k = kind(of: value)
            guard k == .object || k == .array else { continue }
            open.insert(path)
            for (key, child) in children(of: value).prefix(pageSize) {
                queue.append((childPath(path, key: key), child))
            }
        }
        return open
    }

    private static func wrap(_ raw: Any) -> MemoryJsonValue {
        switch raw {
        case is NSNull: return .null
        case let b as Bool: return .bool(b)
        case let n as NSNumber:
            // Bool bridges to NSNumber; catch it above when possible.
            if CFGetTypeID(n) == CFBooleanGetTypeID() { return .bool(n.boolValue) }
            return .number(n.doubleValue)
        case let s as String: return .string(s)
        case let a as [Any]: return .array(a.map(wrap))
        case let o as [String: Any]:
            // Keep key order unstable but deterministic enough for display.
            return .object(o.keys.sorted().map { ($0, wrap(o[$0]!)) })
        default: return .null
        }
    }
}
