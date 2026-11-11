// The Library tab's model (`src/lib/library-items.ts`): the conversation's
// files and the bot's artifacts in one list, what the person pinned on top,
// the rest by how recent it is. A file's pin is kept on the server per
// conversation; an artifact's pin is its favorite flag.
import Foundation

/// One artifact in a list (`GET /api/bots/:id/artifacts`): everything but
/// the widget's document, which is fetched when it opens.
public struct BotArtifact: Decodable, Hashable, Identifiable, Sendable {
    public var id: String
    public var botId: String
    public var title: String
    /// The Library's pin.
    public var favorite: Bool
    /// Milliseconds.
    public var updatedAt: Double
    /// "idle", "ok", "error", "paused" or "blocked".
    public var refreshState: String

    private enum CodingKeys: String, CodingKey { case id, botId, title, favorite, updatedAt, refresh }
    private struct Refresh: Decodable { var state: String? }

    public init(id: String, botId: String = "", title: String, favorite: Bool = false, updatedAt: Double, refreshState: String = "idle") {
        self.id = id
        self.botId = botId
        self.title = title
        self.favorite = favorite
        self.updatedAt = updatedAt
        self.refreshState = refreshState
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        botId = try values.decodeIfPresent(String.self, forKey: .botId) ?? ""
        title = try values.decodeIfPresent(String.self, forKey: .title) ?? ""
        favorite = try values.decodeIfPresent(Bool.self, forKey: .favorite) ?? false
        updatedAt = try values.decodeIfPresent(Double.self, forKey: .updatedAt) ?? 0
        refreshState = try values.decodeIfPresent(Refresh.self, forKey: .refresh)?.state ?? "idle"
    }

    /// A refresh that did not work: the Library marks the row.
    public var needsAttention: Bool { ["error", "paused", "blocked"].contains(refreshState) }
}

struct BotArtifactsResponse: Decodable {
    var artifacts: [BotArtifact]
}

/// One artifact opened: its document and the last data of its source.
public struct BotArtifactDocument: Equatable, Sendable {
    public var title: String
    public var html: String
    /// The source's last JSON, serialized; nil when it has none.
    public var dataJSON: String?
    public var dataAt: Double?

    public init(title: String, html: String, dataJSON: String? = nil, dataAt: Double? = nil) {
        self.title = title
        self.html = html
        self.dataJSON = dataJSON
        self.dataAt = dataAt
    }

    /// Reads `GET /api/bots/:id/artifacts/:id` (`{ artifact: {...} }`).
    public static func parse(_ data: Data) -> BotArtifactDocument? {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let artifact = root["artifact"] as? [String: Any],
              let html = artifact["html"] as? String else { return nil }
        var json: String?
        var at: Double?
        if let stored = artifact["data"] as? [String: Any], let value = stored["value"], !(value is NSNull),
           let bytes = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]) {
            json = String(data: bytes, encoding: .utf8)
            at = stored["at"] as? Double
        }
        return BotArtifactDocument(title: artifact["title"] as? String ?? "", html: html, dataJSON: json, dataAt: at)
    }
}

public enum LibraryEntry: Identifiable, Hashable, Sendable {
    case file(ThreadFile)
    case artifact(BotArtifact)
    /// A page the bot made (`GET /api/pages`, this bot's), 2026-10-28.
    case page(PublishedPageSummary)

    public var id: String {
        switch self {
        // A person's Library can list the same file id in two conversations
        // (#2117); keep both rows distinct the way the desktop does.
        case let .file(file):
            if let threadId = file.threadId, !threadId.isEmpty { return "file:\(threadId):\(file.id)" }
            return "file:\(file.id)"
        case let .artifact(artifact):
            return "artifact:\(artifact.id)"
        case let .page(page):
            return "page:\(page.id)"
        }
    }

    /// Milliseconds: a file's message time, an artifact's last change.
    public var at: Double {
        switch self {
        case let .file(file): file.at
        case let .artifact(artifact): artifact.updatedAt
        case let .page(page): page.updatedAt
        }
    }

    public var pinned: Bool {
        switch self {
        case let .file(file): file.pinned
        case let .artifact(artifact): artifact.favorite
        case let .page(page): page.pinned
        }
    }
}

public struct LibraryGroups: Equatable, Sendable {
    public var pinned: [LibraryEntry]
    /// This calendar day (2026-10-28).
    public var today: [LibraryEntry]
    /// The rest of the last seven days.
    public var thisWeek: [LibraryEntry]
    public var older: [LibraryEntry]

    public var isEmpty: Bool { pinned.isEmpty && today.isEmpty && thisWeek.isEmpty && older.isEmpty }
}

/// The picture at the start of a Library row (`src/lib/library-glyph.ts`):
/// an image is its own small thumbnail; a page, an artifact or an .html file
/// the colored chart mark; Markdown and text a document; a zip an archive;
/// a PDF its own mark; the rest by kind.
public enum LibraryGlyph: String, Equatable, Sendable {
    case thumbnail, page, pdf, document, archive, video, audio, code, image, other
}

public extension ThreadFileRules {
    /// Pictures the server can draw as a thumbnail (`server/media/thumbnail.ts`).
    static func hasThumbnail(_ file: ThreadFile) -> Bool {
        guard file.available, kind(of: file) == .image else { return false }
        let mime = file.mime?.split(separator: ";").first.map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
        if let mime, mime != "application/octet-stream" {
            return ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"].contains(mime)
        }
        return ["png", "jpg", "jpeg", "gif", "webp", "svg"].contains(fileExtension(file.name))
    }

    static func glyph(of file: ThreadFile) -> LibraryGlyph {
        if hasThumbnail(file) { return .thumbnail }
        let ext = fileExtension(file.name)
        let mime = file.mime?.split(separator: ";").first.map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
        if ext == "html" || ext == "htm" || mime == "text/html" { return .page }
        if ext == "pdf" || mime == "application/pdf" { return .pdf }
        switch kind(of: file) {
        case .document: return .document
        case .archive: return .archive
        case .video: return .video
        case .audio: return .audio
        case .code: return .code
        case .image: return .image
        case .other: return .other
        }
    }
}

public extension LibraryEntry {
    var glyph: LibraryGlyph {
        switch self {
        case let .file(file): ThreadFileRules.glyph(of: file)
        case .artifact, .page: .page
        }
    }
}

public enum LibraryRules {
    /// Older shows this many rows first; "Show more" opens the rest.
    public static let olderPreview = 5

    /// Pinned on top whatever the age; the rest today (the calendar day in
    /// the person's time zone), the rest of the last seven days, or older.
    /// Each part is newest first. `now` and the times are milliseconds.
    public static func groups(files: [ThreadFile], artifacts: [BotArtifact], pages: [PublishedPageSummary] = [], now: Double, calendar: Calendar = .current) -> LibraryGroups {
        let week = 7.0 * 24 * 3_600_000
        let startOfToday = calendar.startOfDay(for: Date(timeIntervalSince1970: now / 1000)).timeIntervalSince1970 * 1000
        // Each list is typed on its own: one chain of three mapped lists
        // and an untyped sort took the compiler close to a second.
        let fileEntries: [LibraryEntry] = files.map(LibraryEntry.file)
        let artifactEntries: [LibraryEntry] = artifacts.map(LibraryEntry.artifact)
        let pageEntries: [LibraryEntry] = pages.map(LibraryEntry.page)
        let all: [LibraryEntry] = fileEntries + artifactEntries + pageEntries
        let entries: [LibraryEntry] = all.sorted { (a: LibraryEntry, b: LibraryEntry) -> Bool in
            a.at != b.at ? a.at > b.at : a.id < b.id
        }
        let rest = entries.filter { !$0.pinned }
        return LibraryGroups(
            pinned: entries.filter(\.pinned),
            today: rest.filter { $0.at >= startOfToday },
            thisWeek: rest.filter { $0.at < startOfToday && now - $0.at < week },
            older: rest.filter { $0.at < startOfToday && now - $0.at >= week }
        )
    }
}
