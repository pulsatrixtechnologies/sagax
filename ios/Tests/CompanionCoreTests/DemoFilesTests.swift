import Foundation
import XCTest
@testable import CompanionCore

/// Library files, pages metadata and resumable uploads against a real
/// DemoServer loopback listener (URLSession, not only DemoURLProtocol).
final class DemoFilesTests: XCTestCase {
    private let clock = Date(timeIntervalSince1970: 1_790_000_000)
    private let uploadId = "11111111-1111-4111-8111-111111111111"

    func testLoopbackListsAtlasLibraryFilesAndServesBytes() async throws {
        let server = DemoServer(now: clock, chunkDelay: 0)
        let base = try server.startListening()
        defer { server.stop() }

        let listing = try await http(base, "GET", "/api/threads/demo-thread-atlas/files")
        XCTAssertEqual(listing.status, 200)
        let files = try XCTUnwrap((listing.json["files"] as? [[String: Any]]))
        XCTAssertEqual(files.map { $0["id"] as? String }, [
            DemoServer.DemoFileID.plan,
            DemoServer.DemoFileID.checklist,
            DemoServer.DemoFileID.sketch,
        ])
        XCTAssertEqual(files.first?["name"] as? String, "weekly-plan.md")
        XCTAssertEqual(files.first?["pinned"] as? Bool, true)
        XCTAssertEqual(files.first?["source"] as? String, "written")

        let plan = try await http(base, "GET", "/api/threads/demo-thread-atlas/files/\(DemoServer.DemoFileID.plan)")
        XCTAssertEqual(plan.status, 200)
        XCTAssertEqual(plan.contentType, "text/markdown")
        XCTAssertTrue(String(data: plan.body, encoding: .utf8)?.contains("Weekly plan") == true)

        let preview = try await http(base, "GET", "/api/threads/demo-thread-atlas/files/\(DemoServer.DemoFileID.plan)?preview=1")
        XCTAssertEqual(preview.status, 415)

        let image = try await http(base, "GET", "/api/threads/demo-thread-atlas/files/\(DemoServer.DemoFileID.sketch)?preview=1")
        XCTAssertEqual(image.status, 200)
        XCTAssertEqual(image.contentType, "image/png")
        XCTAssertEqual(image.body, DemoServer.tinyPNG)

        let media = try await http(base, "GET", "/api/bots/demo-atlas/files?kind=media&limit=10")
        XCTAssertEqual(media.status, 200)
        let mediaFiles = try XCTUnwrap(media.json["files"] as? [[String: Any]])
        XCTAssertEqual(mediaFiles.count, 1)
        XCTAssertEqual(mediaFiles.first?["kind"] as? String, "media")

        let docs = try await http(base, "GET", "/api/bots/demo-atlas/files?kind=file&limit=10")
        XCTAssertEqual((docs.json["files"] as? [Any])?.count, 2)
        XCTAssertEqual(docs.json["total"] as? Int, 2)

        let artifacts = try await http(base, "GET", "/api/bots/demo-atlas/artifacts")
        XCTAssertEqual(artifacts.status, 200)
        XCTAssertEqual((artifacts.json["artifacts"] as? [Any])?.count, 0)

        let empty = try await http(base, "GET", "/api/threads/demo-thread-scout/files")
        XCTAssertEqual(empty.status, 200)
        XCTAssertEqual((empty.json["files"] as? [Any])?.count, 0)
    }

    func testLoopbackPagesMetadataAndPreviewDocument() async throws {
        let server = DemoServer(now: clock, chunkDelay: 0)
        let base = try server.startListening()
        defer { server.stop() }

        let list = try await http(base, "GET", "/api/pages")
        XCTAssertEqual(list.status, 200)
        let pages = try XCTUnwrap(list.json["pages"] as? [[String: Any]])
        XCTAssertEqual(pages.first?["id"] as? String, DemoServer.pageID)
        XCTAssertEqual(pages.first?["botId"] as? String, "demo-atlas")
        XCTAssertEqual(pages.first?["title"] as? String, "Weekly plan")

        let one = try await http(base, "GET", "/api/pages/\(DemoServer.pageID)")
        XCTAssertEqual(one.status, 200)
        XCTAssertEqual((one.json["page"] as? [String: Any])?["threadId"] as? String, "demo-thread-atlas")

        let version = try await http(base, "GET", "/api/pages/\(DemoServer.pageID)/versions/1")
        XCTAssertEqual(version.status, 200)
        let previewPath = try XCTUnwrap((version.json["version"] as? [String: Any])?["previewPath"] as? String)
        XCTAssertEqual(previewPath, "/pages/preview/\(DemoServer.pageID)/1")

        let html = try await http(base, "GET", previewPath)
        XCTAssertEqual(html.status, 200)
        XCTAssertTrue(html.contentType.hasPrefix("text/html"))
        XCTAssertTrue(String(data: html.body, encoding: .utf8)?.contains("Weekly plan") == true)

        let policy = try await http(base, "GET", "/api/pages/policy")
        XCTAssertEqual(policy.status, 200)
        XCTAssertEqual(policy.json["linkSharing"] as? Bool, true)
    }

    func testResumableUploadStatusChunkCommitRetryAndCancel() async throws {
        let server = DemoServer(now: clock, chunkDelay: 0)
        let base = try server.startListening()
        defer { server.stop() }
        let prefix = "/api/files?name=notes.txt&uploadId=\(uploadId)&total=6"

        let missing = try await http(base, "POST", "\(prefix)&phase=status&offset=0", body: Data(), contentType: "text/plain")
        XCTAssertEqual(missing.status, 404)

        let first = try await http(base, "POST", "\(prefix)&phase=chunk&offset=0", body: Data("abc".utf8), contentType: "text/plain")
        XCTAssertEqual(first.status, 200)
        XCTAssertEqual(first.json["offset"] as? Int, 3)
        XCTAssertEqual(first.json["total"] as? Int, 6)

        let status = try await http(base, "POST", "\(prefix)&phase=status&offset=0", body: Data(), contentType: "text/plain")
        XCTAssertEqual(status.status, 200)
        XCTAssertEqual(status.json["offset"] as? Int, 3)

        let wrong = try await http(base, "POST", "\(prefix)&phase=chunk&offset=0", body: Data("zzz".utf8), contentType: "text/plain")
        XCTAssertEqual(wrong.status, 409)
        XCTAssertEqual(wrong.json["offset"] as? Int, 3)

        let second = try await http(base, "POST", "\(prefix)&phase=chunk&offset=3", body: Data("def".utf8), contentType: "text/plain")
        XCTAssertEqual(second.status, 200)
        XCTAssertEqual(second.json["offset"] as? Int, 6)

        let committed = try await http(base, "POST", "\(prefix)&phase=commit&offset=6", body: Data(), contentType: "text/plain")
        XCTAssertEqual(committed.status, 200)
        let saved = try XCTUnwrap(committed.json["saved"] as? [String: Any])
        XCTAssertEqual(saved["bytes"] as? Int, 6)
        XCTAssertEqual(saved["name"] as? String, "notes.txt")
        XCTAssertEqual(saved["mime"] as? String, "text/plain")
        XCTAssertEqual(saved["path"] as? String, "/demo/attachments/\(uploadId.lowercased()).txt")

        let replay = try await http(base, "POST", "\(prefix)&phase=commit&offset=6", body: Data(), contentType: "text/plain")
        XCTAssertEqual(replay.status, 200)
        XCTAssertEqual(replay.json["saved"] as? [String: Any] as NSDictionary?, saved as NSDictionary)

        let after = try await http(base, "POST", "\(prefix)&phase=status&offset=0", body: Data(), contentType: "text/plain")
        XCTAssertEqual(after.status, 200)
        XCTAssertEqual(after.json["saved"] as? [String: Any] as NSDictionary?, saved as NSDictionary)

        // A second upload id: cancel removes the partial before commit.
        let other = "22222222-2222-4222-8222-222222222222"
        let otherPrefix = "/api/attachments?uploadId=\(other)&total=4"
        let started = try await http(base, "POST", "\(otherPrefix)&phase=chunk&offset=0", body: Data("ab".utf8), contentType: "image/png")
        XCTAssertEqual(started.status, 200)
        XCTAssertEqual(started.json["offset"] as? Int, 2)
        let cancelled = try await http(base, "POST", "\(otherPrefix)&phase=cancel&offset=0", body: Data(), contentType: "image/png")
        XCTAssertEqual(cancelled.status, 200)
        XCTAssertEqual(cancelled.json["offset"] as? Int, 0)
        let gone = try await http(base, "POST", "\(otherPrefix)&phase=status&offset=0", body: Data(), contentType: "image/png")
        XCTAssertEqual(gone.status, 404)
    }

    func testMissingRouteStillReturnsDemoFeedback() async throws {
        let server = DemoServer(now: clock, chunkDelay: 0)
        let base = try server.startListening()
        defer { server.stop() }

        let missing = try await http(base, "GET", "/api/bots/demo-atlas/overview")
        XCTAssertEqual(missing.status, 404)
        XCTAssertEqual(missing.json["error"] as? String, DemoServer.unavailable)
        XCTAssertEqual(missing.json["code"] as? String, "demo")

        let refused = try await http(base, "POST", "/api/bots/demo-atlas/soul", body: Data("{}".utf8), contentType: "application/json")
        XCTAssertEqual(refused.status, 403)
        XCTAssertEqual(refused.json["code"] as? String, "demo")
    }

    func testCompanionClientReadsLibraryThroughDemoURLProtocol() async throws {
        let server = DemoServer(now: clock, chunkDelay: 0)
        defer { server.stop() }
        let client = server.makeClient()
        let files = try await client.threadFiles(threadId: "demo-thread-atlas")
        XCTAssertEqual(files.map(\.id), [
            DemoServer.DemoFileID.plan,
            DemoServer.DemoFileID.checklist,
            DemoServer.DemoFileID.sketch,
        ])
        XCTAssertTrue(files[0].pinned)
        let pages = try await client.publishedPages()
        XCTAssertEqual(pages.map(\.id), [DemoServer.pageID])
        let media = try await client.botFiles(botId: "demo-atlas", kind: .media, limit: 10)
        XCTAssertEqual(media.items.count, 1)
        XCTAssertEqual(media.total, 1)
    }

    // MARK: - HTTP helper

    private struct HTTPAnswer {
        var status: Int
        var body: Data
        var contentType: String
        var json: [String: Any]
    }

    private func http(
        _ base: URL, _ method: String, _ pathAndQuery: String,
        body: Data? = nil, contentType: String? = nil
    ) async throws -> HTTPAnswer {
        let url = try XCTUnwrap(URL(string: pathAndQuery, relativeTo: base)?.absoluteURL)
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        if let contentType { request.setValue(contentType, forHTTPHeaderField: "Content-Type") }
        let session = URLSession(configuration: .ephemeral)
        let (data, response) = try await session.data(for: request)
        let http = try XCTUnwrap(response as? HTTPURLResponse)
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        return HTTPAnswer(
            status: http.statusCode,
            body: data,
            contentType: http.value(forHTTPHeaderField: "Content-Type") ?? "",
            json: json
        )
    }
}
