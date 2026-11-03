import Foundation

// Client calls for the bot profile (parity screens 03 to 10) and its routine
// screens (05, 06). The routes and their payloads are in docs/ios-companion.md,
// "Visual parity routes"; which of them a paired phone may reach is the
// server's call (`server/auth/request-auth.ts`, `companion/src/routes.ts`).
public extension CompanionClient {
    /// The first page sizes the reference shows (08, 09, 10) before "Show more".
    enum ProfilePage {
        public static let firstLinks = 2
        public static let firstMedia = 2
        public static let firstFiles = 3
        /// Every "Show more" after the first page.
        public static let more = 20
    }

    // MARK: Edit

    /// `PATCH /api/bots/:id` with only the fields set in `edit`.
    func editBot(botId: String, edit: BotProfileEdit) async throws -> Bot {
        try await send(editBotRequest(botId: botId, edit: edit), as: BotResponse.self).bot
    }

    /// Save the bot's standing instructions (owner or admin).
    func saveSoul(botId: String, soul: String) async throws -> Bot {
        try await editBot(botId: botId, edit: BotProfileEdit(soul: soul))
    }

    // MARK: Library

    /// `GET /api/bots/:id/links`: newest first, one per URL.
    func botLinks(botId: String, cursor: String? = nil, limit: Int) async throws -> LibraryPage<BotLink> {
        let response = try await send(botLinksRequest(botId: botId, cursor: cursor, limit: limit), as: BotLinksResponse.self)
        return LibraryPage(items: response.links, nextCursor: response.nextCursor, total: response.total ?? response.links.count)
    }

    /// `GET /api/bots/:id/files?kind=`: images (media) or everything else.
    func botFiles(botId: String, kind: BotFileKind, cursor: String? = nil, limit: Int) async throws -> LibraryPage<BotLibraryFile> {
        let response = try await send(botFilesRequest(botId: botId, kind: kind, cursor: cursor, limit: limit), as: BotFilesResponse.self)
        return LibraryPage(items: response.files, nextCursor: response.nextCursor, total: response.total ?? response.files.count)
    }

    /// One library file's bytes: its thumbnail (`preview`, images only) or the
    /// whole file.
    func botFileData(_ file: BotLibraryFile, preview: Bool) async throws -> Data {
        try await threadFileData(threadId: file.threadId, fileId: file.id, preview: preview)
    }

    // MARK: Export

    /// `POST /api/bots/:id/export`: the bot as a team package (owner or admin).
    func exportBot(botId: String) async throws -> BotExport {
        let (data, response) = try await perform(exportBotRequest(botId: botId))
        try Self.check(response, data)
        return try BotExport.decode(data)
    }

    // MARK: Request builders (tested without a network)

    func editBotRequest(botId: String, edit: BotProfileEdit) throws -> URLRequest {
        guard Self.validRouteID(botId), !edit.isEmpty else { throw APIError.badURL }
        return try makeRequest("PATCH", "/api/bots/\(botId)", encodedBody: edit)
    }

    func botLinksRequest(botId: String, cursor: String?, limit: Int) throws -> URLRequest {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try makeRequest("GET", "/api/bots/\(botId)/links", query: Self.pageQuery(cursor: cursor, limit: limit))
    }

    func botFilesRequest(botId: String, kind: BotFileKind, cursor: String?, limit: Int) throws -> URLRequest {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try makeRequest(
            "GET", "/api/bots/\(botId)/files",
            query: [URLQueryItem(name: "kind", value: kind.rawValue)] + Self.pageQuery(cursor: cursor, limit: limit)
        )
    }

    func exportBotRequest(botId: String) throws -> URLRequest {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        var request = try makeRequest("POST", "/api/bots/\(botId)/export")
        // The package collects skills; give it more time than a plain read.
        request.timeoutInterval = 60
        return request
    }
}

extension CompanionClient {
    /// The server's cursors are offsets; anything else is not sent.
    static func pageQuery(cursor: String?, limit: Int) -> [URLQueryItem] {
        var items = [URLQueryItem(name: "limit", value: String(max(1, min(limit, 100))))]
        if let cursor, !cursor.isEmpty, cursor.utf8.allSatisfy({ (48...57).contains($0) }) {
            items.append(URLQueryItem(name: "cursor", value: cursor))
        }
        return items
    }
}
