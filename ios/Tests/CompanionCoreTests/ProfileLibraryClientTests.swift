// The bot profile's client calls (parity 03 to 10): profile edits, links,
// files, export and the routine presentation helpers. Payloads follow
// server/routes/bot-library.ts and docs/ios-companion.md.
import Foundation
import XCTest
@testable import CompanionCore

private final class ProfileRequestStub: URLProtocol {
    static var responseBody = Data()
    static var statusCode = 200
    static var capturedRequest: URLRequest?
    static var capturedBody: Data?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.capturedRequest = request
        if let body = request.httpBody {
            Self.capturedBody = body
        } else if let stream = request.httpBodyStream {
            stream.open()
            var data = Data()
            var buffer = [UInt8](repeating: 0, count: 1_024)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                data.append(buffer, count: count)
            }
            stream.close()
            Self.capturedBody = data
        }
        let response = HTTPURLResponse(
            url: request.url!, statusCode: Self.statusCode, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.responseBody)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class ProfileLibraryClientTests: XCTestCase {
    private var session: URLSession!
    private var client: CompanionClient!

    private static let botJSON = #"""
    {"bot":{"id":"bot-1","threadId":"thread-1","name":"Ara","title":"Admin","description":"",
    "notifications":false,"color":"purple","unread":false,"pinned":true,
    "modelSelection":{"instanceId":"claude","model":"default"},"createdAt":1,
    "speakReplies":false}}
    """#

    override func setUp() {
        super.setUp()
        ProfileRequestStub.capturedRequest = nil
        ProfileRequestStub.capturedBody = nil
        ProfileRequestStub.statusCode = 200
        ProfileRequestStub.responseBody = Data("{}".utf8)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ProfileRequestStub.self]
        session = URLSession(configuration: configuration)
        client = CompanionClient(
            connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810),
            token: "paired-token",
            session: session
        )
    }

    override func tearDown() {
        session.invalidateAndCancel()
        super.tearDown()
    }

    private func respond(_ json: String, status: Int = 200) {
        ProfileRequestStub.responseBody = Data(json.utf8)
        ProfileRequestStub.statusCode = status
    }

    private var captured: URLRequest { ProfileRequestStub.capturedRequest! }

    private func capturedJSON() throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(ProfileRequestStub.capturedBody)) as? [String: Any])
    }

    private func query(_ name: String) -> String? {
        URLComponents(url: captured.url!, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == name }?.value
    }

    // MARK: Edit

    func testEditBotPatchesOnlyTheFieldsSet() async throws {
        respond(Self.botJSON)
        let bot = try await client.editBot(botId: "bot-1", edit: BotProfileEdit(color: "blue", mascotSkin: .frost))
        XCTAssertEqual(captured.httpMethod, "PATCH")
        XCTAssertEqual(captured.url?.path, "/api/bots/bot-1")
        let body = try capturedJSON()
        XCTAssertEqual(Set(body.keys), ["color", "mascotSkin"])
        XCTAssertEqual(body["mascotSkin"] as? String, "frost")
        XCTAssertEqual(bot.name, "Ara")
    }

    func testResetLookIsTheDesktopsDefaultAndClearsThePicture() throws {
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(BotProfileEdit.resetLook)) as? [String: Any])
        XCTAssertEqual(object["color"] as? String, "green")
        XCTAssertEqual((object["mascotLook"] as? [String: Any])?["character"] as? String, "owl")
        XCTAssertEqual(object["mascotSkin"] as? String, "none")
        XCTAssertEqual(object["avatarCrop"] as? String, "mascot")
        XCTAssertTrue(object["avatarUrl"] is NSNull)
    }

    /// Lot 9: Done builds a look PATCH from the Avatar draft; Back leaves it empty.
    func testLookDiffOnlySendsChangedFieldsAndOptionalPictureClear() throws {
        let same = BotProfileEdit.lookDiff(
            fromColor: "purple", fromLook: .owl, fromSkin: .none,
            toColor: "purple", toLook: .owl, toSkin: .none,
            clearsPicture: false
        )
        XCTAssertTrue(same.isEmpty)

        let colourOnly = BotProfileEdit.lookDiff(
            fromColor: "purple", fromLook: .owl, fromSkin: .none,
            toColor: "teal", toLook: .owl, toSkin: .none,
            clearsPicture: false
        )
        XCTAssertEqual(colourOnly.color, "teal")
        XCTAssertNil(colourOnly.mascotLook)
        XCTAssertNil(colourOnly.mascotSkin)
        XCTAssertNil(colourOnly.avatarUrl)

        let reset = BotProfileEdit.lookDiff(
            fromColor: "purple", fromLook: .owl, fromSkin: .frost,
            toColor: "green", toLook: .owl, toSkin: .none,
            clearsPicture: true
        )
        XCTAssertEqual(reset.color, "green")
        XCTAssertEqual(reset.mascotSkin, MascotSkin.none)
        XCTAssertEqual(reset.avatarCrop, .mascot)
        XCTAssertEqual(reset.avatarUrl, .clear)
    }

    func testFramingAndSoulEncode() throws {
        let edit = BotProfileEdit(avatarZoom: 1.5, avatarFocusX: 0.25, avatarFocusY: 0.75, notifications: true, soul: "Be brief.")
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(edit)) as? [String: Any])
        XCTAssertEqual(Set(object.keys), ["avatarZoom", "avatarFocusX", "avatarFocusY", "notifications", "soul"])
        XCTAssertEqual(object["avatarZoom"] as? Double, 1.5)
    }

    func testSaveSoulSendsTheSoul() async throws {
        respond(Self.botJSON)
        _ = try await client.saveSoul(botId: "bot-1", soul: "# Ara\n\nNew instructions.")
        XCTAssertEqual(try capturedJSON()["soul"] as? String, "# Ara\n\nNew instructions.")
    }

    func testEmptyEditOrBadIdIsRefused() {
        XCTAssertThrowsError(try client.editBotRequest(botId: "bot-1", edit: BotProfileEdit()))
        XCTAssertThrowsError(try client.editBotRequest(botId: "../x", edit: BotProfileEdit(color: "red")))
    }

    // MARK: Links

    func testLinksPageDecodesAndSendsTheCursor() async throws {
        respond(#"""
        {"links":[{"url":"https://docs.example.com/a/b","domain":"docs.example.com","messageId":"m1","threadId":"t1","at":5},
                  {"url":"https://example.org/x","domain":"","at":4}],"nextCursor":"2","total":3}
        """#)
        let page = try await client.botLinks(botId: "bot-1", cursor: "2", limit: 2)
        XCTAssertEqual(captured.url?.path, "/api/bots/bot-1/links")
        XCTAssertEqual(query("limit"), "2")
        XCTAssertEqual(query("cursor"), "2")
        XCTAssertEqual(page.items.map(\.domain), ["docs.example.com", "example.org"])
        XCTAssertEqual(page.nextCursor, "2")
        XCTAssertEqual(page.total, 3)
        XCTAssertTrue(page.hasMore)
        XCTAssertEqual(page.items[0].webURL?.host, "docs.example.com")
    }

    func testOnlyWebLinksOpen() throws {
        let data = Data(#"[{"url":"javascript:alert(1)","domain":"x","at":1},{"url":"http://a.example","domain":"a.example","at":1}]"#.utf8)
        let links = try JSONDecoder().decode([BotLink].self, from: data)
        XCTAssertNil(links[0].webURL)
        XCTAssertNotNil(links[1].webURL)
    }

    /// An older computer sent the code mark a message wrapped the link in,
    /// raw or percent-encoded (`%60`): the phone drops it before opening.
    func testAnOlderComputersCodeMarkIsDropped() throws {
        let data = Data(#"[{"url":"https://docs.example.com/guide%60","domain":"docs.example.com","at":1},{"url":"https://example.org/a`.","at":1},{"url":"https://example.net/q?x=1%22%3E","at":1}]"#.utf8)
        let links = try JSONDecoder().decode([BotLink].self, from: data)
        XCTAssertEqual(links.map(\.url), ["https://docs.example.com/guide", "https://example.org/a", "https://example.net/q?x=1"])
        XCTAssertEqual(links[1].domain, "example.org")
        XCTAssertEqual(links[0].webURL?.absoluteString, "https://docs.example.com/guide")
    }

    func testComputerOnlyAddressesAreTold() {
        let computer = [
            "http://127.0.0.1:8787/", "http://localhost:3000/app", "http://[::1]:8080/", "http://0.0.0.0:5173",
            "http://10.0.0.4/", "http://172.20.1.2/", "http://192.168.1.10:8080/", "http://169.254.1.1/",
            "http://printer.local/", "http://app.localhost/", "http://nas/", "http://[fd12:3456::1]/", "http://[fe80::1]/",
            "http://[::ffff:7f00:1]/", "http://[::ffff:192.168.0.2]/",
        ]
        for url in computer { XCTAssertEqual(BotLink(url: url).reach, .computer, url) }
        let web = ["https://docs.example.com/x", "http://172.32.0.1/", "https://8.8.8.8/", "http://[2001:db8::1]/", "https://100.64.0.1/"]
        for url in web { XCTAssertEqual(BotLink(url: url).reach, .web, url) }
    }

    func testTheAddressReadsDecoded() {
        XCTAssertEqual(BotLink(url: "http://127.0.0.1:8787/").readableAddress, "127.0.0.1:8787")
        XCTAssertEqual(BotLink(url: "https://example.com/caf%C3%A9/notes").readableAddress, "example.com/café/notes")
        XCTAssertEqual(BotLink(url: "https://example.com/a", title: "Guide").fallbackTitle, "Guide")
        XCTAssertEqual(BotLink(url: "https://www.example.com/a", domain: "example.com").fallbackTitle, "example.com")
    }

    func testAPageCursorThatIsNotAnOffsetIsDropped() throws {
        let request = try client.botLinksRequest(botId: "bot-1", cursor: "../../etc", limit: 500)
        let items = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
        XCTAssertEqual(items.first { $0.name == "limit" }?.value, "100")
        XCTAssertNil(items.first { $0.name == "cursor" })
    }

    func testPagesAppendWithoutRepeating() throws {
        let data = Data(#"[{"url":"https://a.example","domain":"a.example","at":2},{"url":"https://b.example","domain":"b.example","at":1}]"#.utf8)
        let links = try JSONDecoder().decode([BotLink].self, from: data)
        let first = LibraryPage(items: [links[0]], nextCursor: "1", total: 2)
        let merged = first.appending(LibraryPage(items: links, nextCursor: nil, total: 2))
        XCTAssertEqual(merged.items.map(\.url), ["https://a.example", "https://b.example"])
        XCTAssertFalse(merged.hasMore)
    }

    // MARK: Files

    func testFilesPageSendsTheKindAndDecodesTheRoutes() async throws {
        respond(#"""
        {"files":[{"id":"0123456789abcdef01234567","threadId":"t1","messageId":"m1","name":"shot.png","mime":"image/png",
        "size":10,"available":true,"source":"attachment","at":7,"kind":"media",
        "url":"/api/threads/t1/files/0123456789abcdef01234567","previewUrl":"/api/threads/t1/files/0123456789abcdef01234567?preview=1"}],
        "nextCursor":null,"total":1}
        """#)
        let page = try await client.botFiles(botId: "bot-1", kind: .media, limit: 2)
        XCTAssertEqual(captured.url?.path, "/api/bots/bot-1/files")
        XCTAssertEqual(query("kind"), "media")
        XCTAssertEqual(query("limit"), "2")
        XCTAssertNil(query("cursor"))
        XCTAssertEqual(page.items.first?.kind, .media)
        XCTAssertEqual(page.items.first?.previewUrl, "/api/threads/t1/files/0123456789abcdef01234567?preview=1")
        XCTAssertFalse(page.hasMore)
    }

    func testFileDataUsesTheThreadFileRoute() async throws {
        respond("PNG")
        let data = Data(#"{"id":"0123456789abcdef01234567","threadId":"t1","name":"a/b:c.md","kind":"file","at":1}"#.utf8)
        let file = try JSONDecoder().decode(BotLibraryFile.self, from: data)
        XCTAssertEqual(file.localFileName, "b-c.md")
        _ = try await client.botFileData(file, preview: false)
        XCTAssertEqual(captured.url?.path, "/api/threads/t1/files/0123456789abcdef01234567")
        XCTAssertNil(query("preview"))
    }

    // MARK: Export

    func testExportKeepsTheDocumentAndNamesTheFileAfterTheBot() async throws {
        respond(#"{"document":{"format":"openmausbot-team","version":2,"bots":[{"name":"Ara"}]},"filename":"ara.omb-team.json","redacted":["x"],"skipped":[],"summary":{}}"#)
        let export = try await client.exportBot(botId: "bot-1")
        XCTAssertEqual(captured.httpMethod, "POST")
        XCTAssertEqual(captured.url?.path, "/api/bots/bot-1/export")
        let document = try XCTUnwrap(JSONSerialization.jsonObject(with: export.document) as? [String: Any])
        XCTAssertEqual(document["version"] as? Int, 2)
        XCTAssertEqual(export.redacted, 1)
        XCTAssertEqual(BotExport.shareFileName(botName: "Ara"), "Ara.json")
        XCTAssertEqual(BotExport.shareFileName(botName: "a/b: c"), "a-b- c.json")
        XCTAssertEqual(BotExport.shareFileName(botName: "  "), "Bot.json")
    }

    func testExportRefusalSurfaces() async {
        respond(#"{"error":"forbidden: only the bot owner or an admin can share it as a template"}"#, status: 403)
        do {
            _ = try await client.exportBot(botId: "bot-1")
            XCTFail("expected a refusal")
        } catch let APIError.status(code, _) {
            XCTAssertEqual(code, 403)
        } catch {
            XCTFail("unexpected \(error)")
        }
    }

    // MARK: Routine presentation

    private func routine(enabled: Bool = true, nextRunAt: Double?, schedule: RoutineSchedule) -> Routine {
        Routine(
            id: "r1", name: "Scan", prompt: "p", botId: "bot-1", runOn: "maus", enabled: enabled,
            schedule: schedule, durationMinutes: 30, timeoutMinutes: nil, nextRunAt: nextRunAt, createdAt: 0, updatedAt: 0
        )
    }

    func testNextRunIsDueNowOnceItsTimeHasCome() {
        let now = Date(timeIntervalSince1970: 1_000)
        let cron = RoutineSchedule.cron(expression: "2 7 1-7 * 1", timeZone: "America/Toronto")
        XCTAssertEqual(routine(nextRunAt: 900_000, schedule: cron).nextRun(now: now), .dueNow)
        XCTAssertEqual(routine(nextRunAt: 2_000_000, schedule: cron).nextRun(now: now), .at(Date(timeIntervalSince1970: 2_000)))
        XCTAssertEqual(routine(enabled: false, nextRunAt: 2_000_000, schedule: cron).nextRun(now: now), .none)
        XCTAssertEqual(routine(nextRunAt: nil, schedule: cron).nextRun(now: now), .none)
        XCTAssertEqual(cron.cronDisplay, "CRON_TZ=America/Toronto 2 7 1-7 * 1")
    }

    func testDayPatternsAndTime() {
        XCTAssertEqual(RoutineSchedule.daily(time: "07:00", weekdays: [1]).dayPattern, .days([1]))
        XCTAssertEqual(RoutineSchedule.daily(time: "07:00", weekdays: [1, 2, 3, 4, 5]).dayPattern, .weekdays)
        XCTAssertEqual(RoutineSchedule.daily(time: "07:00", weekdays: [6, 0]).dayPattern, .weekends)
        XCTAssertEqual(RoutineSchedule.daily(time: "07:00", weekdays: Array(0...6)).dayPattern, .everyDay)
        XCTAssertEqual(RoutineSchedule.daily(time: "07:05", weekdays: [1]).timeOfDay?.minute, 5)
        XCTAssertNil(RoutineSchedule.daily(time: "25:00", weekdays: [1]).timeOfDay)
    }
}
