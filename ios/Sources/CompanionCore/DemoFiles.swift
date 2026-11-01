// The demo's Library files and resumable upload transport. Synthetic entries
// only (Atlas's weekly plan, checklist and a tiny PNG). Matches the real
// `/api/threads/:id/files`, `/api/bots/:id/files`, `/api/bots/:id/artifacts`,
// `/api/files` and `/api/attachments` contracts so the native Library and the
// upload transport under test see the same shapes as a live server.
import Foundation

extension DemoServer {
    /// Chunk ceiling shared with the production resumable transport (4 MiB).
    public static let uploadChunkMaxBytes = 4 * 1024 * 1024

    /// Opaque 24-hex ids the native client accepts (`validThreadFileID`).
    public enum DemoFileID {
        public static let plan = "a11111111111111111111111"
        public static let checklist = "a22222222222222222222222"
        public static let sketch = "a33333333333333333333333"
    }

    /// One-pixel PNG so Media rows have real image bytes without shipping assets.
    static let tinyPNG = Data([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
        0x0c, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
        0x00, 0x03, 0x01, 0x01, 0x00, 0xc9, 0xfe, 0x92, 0xef, 0x00, 0x00, 0x00,
        0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ])

    struct DemoThreadFile {
        var id: String
        var threadId: String
        var messageId: String
        var source: String
        var name: String
        var mime: String
        var at: Double
        var size: Int
        var available: Bool
        var path: String
        var pinned: Bool
        var bytes: Data

        var summary: [String: Any] {
            [
                "id": id, "messageId": messageId, "source": source, "name": name,
                "mime": mime, "at": at, "size": size, "available": available,
                "path": path, "localPath": path, "pinned": pinned,
            ]
        }

        var libraryRow: [String: Any] {
            var row: [String: Any] = [
                "id": id, "threadId": threadId, "messageId": messageId, "name": name,
                "mime": mime, "size": size, "available": available, "at": at,
                "kind": mime.hasPrefix("image/") ? "media" : "file",
                "url": "/api/threads/\(threadId)/files/\(id)",
            ]
            if mime.hasPrefix("image/") {
                row["previewUrl"] = "/api/threads/\(threadId)/files/\(id)?preview=1"
            }
            return row
        }
    }

    struct DemoUploadSession {
        var uploadId: String
        var name: String
        var mime: String
        var total: Int
        var image: Bool
        var offset: Int = 0
        var data = Data()
        var saved: [String: Any]?
    }

    func seedDemoFiles(language: DemoLanguage, now: Date) {
        let t = language.pick
        let base = (now.timeIntervalSince1970 * 1000).rounded()
        let planText = Data(t(
            "# Weekly plan\n\n- Ship the iOS beta\n- Finish onboarding\n- Keep the release build green\n",
            "# Plan de la semaine\n\n- Livrer la bêta iOS\n- Terminer l'accueil\n- Garder le build au vert\n"
        ).utf8)
        let checklist = Data(t(
            "%PDF-1.4 demo checklist for the beta release.\n",
            "%PDF-1.4 liste de contrôle de démo pour la bêta.\n"
        ).utf8)
        threadFiles = [
            DemoThreadFile(
                id: DemoFileID.plan, threadId: "demo-thread-atlas", messageId: "atlas-4",
                source: "written", name: t("weekly-plan.md", "plan-semaine.md"),
                mime: "text/markdown", at: base - 11 * 60_000, size: planText.count,
                available: true, path: "/demo/files/weekly-plan.md", pinned: true, bytes: planText
            ),
            DemoThreadFile(
                id: DemoFileID.checklist, threadId: "demo-thread-atlas", messageId: "atlas-2",
                source: "upload", name: t("beta-checklist.pdf", "liste-beta.pdf"),
                mime: "application/pdf", at: base - 94 * 60_000, size: checklist.count,
                available: true, path: "/demo/files/beta-checklist.pdf", pinned: false, bytes: checklist
            ),
            DemoThreadFile(
                id: DemoFileID.sketch, threadId: "demo-thread-atlas", messageId: "atlas-1",
                source: "attachment", name: t("onboarding.png", "accueil.png"),
                mime: "image/png", at: base - 95 * 60_000, size: Self.tinyPNG.count,
                available: true, path: "/demo/files/onboarding.png", pinned: false, bytes: Self.tinyPNG
            ),
        ]
    }

    func libraryFiles(method: String, parts: [String], query: [URLQueryItem], body: Data?, contentType: String?) -> Response {
        if parts.count >= 2 && parts[0] == "api" && parts[1] == "threads" {
            return threadFilesRoute(method: method, parts: parts, query: query, body: body)
        }
        if parts.count >= 2 && parts[0] == "api" && parts[1] == "bots" {
            return botLibraryRoute(method: method, parts: parts, query: query)
        }
        if parts.count == 2 && parts[0] == "api" && (parts[1] == "files" || parts[1] == "attachments") {
            return uploadRoute(method: method, path: parts[1], query: query, body: body, contentType: contentType)
        }
        if parts.count >= 3 && parts[0] == "pages" && (parts[1] == "preview" || parts[1] == "preview-frame") {
            return pagePreviewRoute(parts: parts)
        }
        return refusal(status: method == "GET" ? 404 : 403)
    }

    private func threadFilesRoute(method: String, parts: [String], query: [URLQueryItem], body: Data?) -> Response {
        guard parts.count >= 4, parts[3] == "files" else { return refusal(status: 404) }
        let threadId = parts[2]
        lock.lock()
        let knownThread = bots.contains { $0.threadId == threadId } || rooms.contains { $0.threadId == threadId }
        lock.unlock()
        guard knownThread else { return refusal(status: 404) }

        if parts.count == 4 {
            guard method == "GET" else { return refusal(status: 405) }
            lock.lock()
            let rows = threadFiles.filter { $0.threadId == threadId }.sorted { $0.at > $1.at }.map(\.summary)
            lock.unlock()
            return jsonObject(["files": rows])
        }

        guard parts.count >= 5 else { return refusal(status: 404) }
        let fileId = parts[4]
        guard fileId.utf8.count == 24, fileId.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else {
            return refusal(status: 404)
        }

        if parts.count == 6, parts[5] == "pin" {
            guard method == "POST" else { return refusal(status: 405) }
            let json = (body.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]) ?? [:]
            guard let pinned = json["pinned"] as? Bool else { return refusal(status: 400) }
            lock.lock()
            guard let index = threadFiles.firstIndex(where: { $0.id == fileId && $0.threadId == threadId }) else {
                lock.unlock(); return refusal(status: 404)
            }
            threadFiles[index].pinned = pinned
            lock.unlock()
            return .init(status: 200, body: Data("{}".utf8))
        }

        guard parts.count == 5, method == "GET" else { return refusal(status: method == "GET" ? 404 : 405) }
        lock.lock()
        let file = threadFiles.first { $0.id == fileId && $0.threadId == threadId }
        lock.unlock()
        guard let file else { return refusal(status: 404) }
        let preview = query.contains { $0.name == "preview" && ($0.value == "1" || $0.value?.isEmpty == false) }
        let thumb = query.contains { $0.name == "thumb" && ($0.value == "1" || $0.value?.isEmpty == false) }
        if (preview || thumb), !file.mime.hasPrefix("image/") {
            return .init(status: 415, body: Data(#"{"error":"preview is for images only","code":"demo"}"#.utf8), contentType: "application/json")
        }
        return .init(status: 200, body: file.bytes, contentType: file.mime)
    }

    private func botLibraryRoute(method: String, parts: [String], query: [URLQueryItem]) -> Response {
        guard parts.count >= 4 else { return refusal(status: 404) }
        let botId = parts[2]
        lock.lock()
        let known = bots.contains { $0.id == botId }
        let threadId = bots.first { $0.id == botId }?.threadId
        lock.unlock()
        guard known else { return refusal(status: 404) }

        if parts[3] == "artifacts" {
            guard method == "GET", parts.count == 4 else { return refusal(status: method == "GET" ? 404 : 405) }
            return jsonObject(["artifacts": [] as [Any]])
        }

        if parts[3] == "files" {
            guard method == "GET", parts.count == 4 else { return refusal(status: method == "GET" ? 404 : 405) }
            let kind = query.first { $0.name == "kind" }?.value ?? "file"
            let limit = max(1, min(Int(query.first { $0.name == "limit" }?.value ?? "100") ?? 100, 100))
            let cursor = Int(query.first { $0.name == "cursor" }?.value ?? "0") ?? 0
            lock.lock()
            let all = threadFiles.filter { $0.threadId == threadId }
                .filter { kind == "media" ? $0.mime.hasPrefix("image/") : !$0.mime.hasPrefix("image/") }
                .sorted { $0.at > $1.at }
            lock.unlock()
            let slice = Array(all.dropFirst(cursor).prefix(limit))
            let next = cursor + slice.count < all.count ? String(cursor + slice.count) : nil
            var payload: [String: Any] = ["files": slice.map(\.libraryRow), "total": all.count]
            if let next { payload["nextCursor"] = next }
            return jsonObject(payload)
        }

        if parts[3] == "links" {
            guard method == "GET", parts.count == 4 else { return refusal(status: method == "GET" ? 404 : 405) }
            return jsonObject(["links": [] as [Any], "total": 0])
        }

        return refusal(status: method == "GET" ? 404 : 403)
    }

    private func pagePreviewRoute(parts: [String]) -> Response {
        guard parts.count == 4, parts[2] == Self.pageID, Int(parts[3]) != nil else { return refusal(status: 404) }
        lock.lock(); let deleted = demoPage.deleted; lock.unlock()
        guard !deleted else { return refusal(status: 404) }
        let html = pageDocument(theme: .light)
        return .init(status: 200, body: Data(html.utf8), contentType: "text/html; charset=utf-8")
    }

    private func uploadRoute(method: String, path: String, query: [URLQueryItem], body: Data?, contentType: String?) -> Response {
        guard method == "POST" else { return refusal(status: 405) }
        let image = path == "attachments"
        let phase = query.first { $0.name == "phase" }?.value
        if let phase {
            return resumableUpload(image: image, phase: phase, query: query, body: body, contentType: contentType)
        }
        return oneShotUpload(image: image, query: query, body: body, contentType: contentType)
    }

    private func oneShotUpload(image: Bool, query: [URLQueryItem], body: Data?, contentType: String?) -> Response {
        guard let mime = Self.normalizedMime(contentType) else {
            return .init(status: 400, body: Data(#"{"error":"unsupported content-type","code":"demo"}"#.utf8))
        }
        if image, !mime.hasPrefix("image/") {
            return .init(status: 400, body: Data(#"{"error":"content-type must be an image type","code":"demo"}"#.utf8))
        }
        if !image {
            guard let name = query.first(where: { $0.name == "name" })?.value, !name.isEmpty else {
                return .init(status: 400, body: Data(#"{"error":"name is required","code":"demo"}"#.utf8))
            }
            _ = name
        }
        let data = body ?? Data()
        guard !data.isEmpty else { return .init(status: 400, body: Data(#"{"error":"empty body","code":"demo"}"#.utf8)) }
        let uploadId = query.first { $0.name == "uploadId" }?.value
        if let uploadId, UUID(uuidString: uploadId) == nil {
            return .init(status: 400, body: Data(#"{"error":"uploadId must be a UUID","code":"demo"}"#.utf8))
        }
        let id = (uploadId.flatMap { UUID(uuidString: $0)?.uuidString.lowercased() }) ?? UUID().uuidString.lowercased()
        let name = image ? "image\(Self.fileExtension(for: mime))" : Self.sanitizeName(query.first { $0.name == "name" }?.value ?? "file", mime: mime)
        let savedPath = "/demo/attachments/\(id)\(Self.fileExtension(for: mime))"
        lock.lock()
        if let existing = uploads[id]?.saved {
            lock.unlock()
            return jsonObject(existing, status: 201)
        }
        let saved: [String: Any] = ["path": savedPath, "name": name, "mime": mime, "bytes": data.count]
        uploads[id] = DemoUploadSession(uploadId: id, name: name, mime: mime, total: data.count, image: image, offset: data.count, data: data, saved: saved)
        lock.unlock()
        return jsonObject(saved, status: 201)
    }

    private func resumableUpload(image: Bool, phase: String, query: [URLQueryItem], body: Data?, contentType: String?) -> Response {
        guard ["status", "chunk", "commit", "cancel"].contains(phase) else {
            return .init(status: 400, body: Data(#"{"error":"invalid upload phase","code":"demo"}"#.utf8))
        }
        guard let rawId = query.first(where: { $0.name == "uploadId" })?.value, let uuid = UUID(uuidString: rawId) else {
            return .init(status: 400, body: Data(#"{"error":"uploadId must be a UUID","code":"demo"}"#.utf8))
        }
        let uploadId = uuid.uuidString.lowercased()
        guard let mime = Self.normalizedMime(contentType) else {
            return .init(status: 400, body: Data(#"{"error":"unsupported content-type","code":"demo"}"#.utf8))
        }
        if image, !mime.hasPrefix("image/") {
            return .init(status: 400, body: Data(#"{"error":"content-type must be an image type","code":"demo"}"#.utf8))
        }
        guard let totalText = query.first(where: { $0.name == "total" })?.value, let total = Int(totalText), total > 0 else {
            return .init(status: 400, body: Data(#"{"error":"total must be a positive integer","code":"demo"}"#.utf8))
        }
        let name = image
            ? "image\(Self.fileExtension(for: mime))"
            : Self.sanitizeName(query.first { $0.name == "name" }?.value ?? "file", mime: mime)
        if !image, (query.first { $0.name == "name" }?.value ?? "").isEmpty {
            return .init(status: 400, body: Data(#"{"error":"name is required","code":"demo"}"#.utf8))
        }
        let offset = Int(query.first { $0.name == "offset" }?.value ?? "0") ?? 0

        lock.lock(); defer { lock.unlock() }
        var session = uploads[uploadId]

        if session == nil {
            if phase == "cancel" {
                return jsonObject(["offset": 0, "total": total])
            }
            if phase != "chunk" || offset != 0 {
                return .init(status: 404, body: Data(#"{"error":"no such upload","code":"demo"}"#.utf8))
            }
            session = DemoUploadSession(uploadId: uploadId, name: name, mime: mime, total: total, image: image)
            uploads[uploadId] = session
        }

        guard var state = session else {
            return .init(status: 404, body: Data(#"{"error":"no such upload","code":"demo"}"#.utf8))
        }
        if state.mime != mime || state.name != name || state.total != total || state.image != image {
            return .init(status: 409, body: Data(#"{"error":"upload metadata changed","code":"demo"}"#.utf8))
        }

        if phase == "cancel" {
            uploads.removeValue(forKey: uploadId)
            return jsonObject(["offset": 0, "total": state.total])
        }

        if let saved = state.saved {
            return jsonObject(["offset": state.total, "total": state.total, "saved": saved])
        }

        if phase == "chunk" {
            if offset != state.offset {
                return .init(
                    status: 409,
                    body: (try? JSONSerialization.data(withJSONObject: ["error": "upload offset changed", "offset": state.offset, "code": "demo"])) ?? Data()
                )
            }
            let chunk = body ?? Data()
            if chunk.isEmpty {
                return .init(status: 400, body: Data(#"{"error":"empty upload chunk","code":"demo"}"#.utf8))
            }
            if chunk.count > Self.uploadChunkMaxBytes || state.offset + chunk.count > state.total {
                return .init(status: 413, body: Data(#"{"error":"upload chunk is too large","code":"demo"}"#.utf8))
            }
            state.data.append(chunk)
            state.offset += chunk.count
            uploads[uploadId] = state
            return jsonObject(["offset": state.offset, "total": state.total])
        }

        if phase == "status" {
            return jsonObject(["offset": state.offset, "total": state.total])
        }

        // commit
        if state.offset != state.total {
            return .init(
                status: 409,
                body: (try? JSONSerialization.data(withJSONObject: ["error": "upload is incomplete", "offset": state.offset, "code": "demo"])) ?? Data()
            )
        }
        let savedPath = "/demo/attachments/\(uploadId)\(Self.fileExtension(for: mime))"
        let saved: [String: Any] = ["path": savedPath, "name": state.name, "mime": state.mime, "bytes": state.total]
        state.saved = saved
        uploads[uploadId] = state
        return jsonObject(["offset": state.total, "total": state.total, "saved": saved])
    }

    func jsonObject(_ object: [String: Any], status: Int = 200) -> Response {
        .init(status: status, body: (try? JSONSerialization.data(withJSONObject: object)) ?? Data())
    }

    static func normalizedMime(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let mime = raw.split(separator: ";").first.map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() } ?? ""
        guard !mime.isEmpty, mime.contains("/"), mime.utf8.count <= 127 else { return nil }
        return mime
    }

    static func fileExtension(for mime: String) -> String {
        switch mime {
        case "image/png": return ".png"
        case "image/jpeg": return ".jpg"
        case "image/gif": return ".gif"
        case "image/webp": return ".webp"
        case "text/plain": return ".txt"
        case "text/markdown": return ".md"
        case "application/pdf": return ".pdf"
        case "application/zip": return ".zip"
        case "audio/mpeg": return ".mp3"
        case "video/mp4": return ".mp4"
        default:
            let subtype = mime.split(separator: "/").last.map(String.init) ?? "bin"
            return ".\(subtype.replacingOccurrences(of: "+", with: "-"))"
        }
    }

    static func sanitizeName(_ raw: String, mime: String) -> String {
        let base = URL(fileURLWithPath: raw).lastPathComponent
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if base.isEmpty { return "file\(fileExtension(for: mime))" }
        return String(base.prefix(255))
    }
}
