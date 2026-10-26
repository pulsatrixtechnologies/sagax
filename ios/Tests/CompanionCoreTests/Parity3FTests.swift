import Foundation
import XCTest
@testable import CompanionCore

final class Parity3FTests: XCTestCase {
    func testRecoverIsTheStuckComputerNotAHealthyOne() {
        XCTAssertFalse(ComputerCare.needsRecover(configured: false, state: "stopped", problem: nil, waking: false))
        XCTAssertFalse(ComputerCare.needsRecover(configured: true, state: "running", problem: nil, waking: false))
        XCTAssertFalse(ComputerCare.needsRecover(configured: true, state: "ready", problem: "  ", waking: false))
        XCTAssertTrue(ComputerCare.needsRecover(configured: true, state: "running", problem: "unreachable", waking: false))
        XCTAssertFalse(ComputerCare.needsRecover(configured: true, state: "running", problem: nil, waking: true))
        XCTAssertFalse(ComputerCare.needsRecover(configured: true, state: "stopped", problem: nil, waking: false))
        XCTAssertFalse(ComputerCare.needsRecover(configured: true, state: "paused", problem: nil, waking: false))
        XCTAssertFalse(ComputerCare.needsRecover(configured: true, state: "missing", problem: nil, waking: true))
        XCTAssertTrue(ComputerCare.needsRecover(configured: true, state: "unavailable", problem: nil, waking: false))
    }

    func testOtherComputersSkipTheOneInUseAndRefuseABadName() {
        let office = desktop("office-1", "Office", online: false, seen: 20)
        let home = desktop("home-1", "Home", online: true, seen: 50)
        let older = desktop("old-1", "Old", online: true, seen: 10)
        let nameless = desktop("", "Nope", online: false, seen: 1)
        XCTAssertEqual(OtherComputers.list([office, home, older, nameless]).map(\.id), ["office-1", "old-1"])
        XCTAssertEqual(OtherComputers.name("  Desk  "), "Desk")
        XCTAssertNil(OtherComputers.name(" "))
        XCTAssertNil(OtherComputers.name(String(repeating: "a", count: 121)))
        XCTAssertNil(OtherComputers.name("bad\nname"))
        XCTAssertEqual(OtherComputers.refusal(code: "computer_online"), .online)
        XCTAssertEqual(OtherComputers.refusal(code: "computer_rate"), .rate)
        XCTAssertEqual(OtherComputers.refusal(code: nil), .failed)
    }

    func testWordIndexAndAlignedTranscript() {
        let words = [
            VoiceNoteWord(text: "Bonjour", start: 0, end: 0.5),
            VoiceNoteWord(text: "JC", start: 0.6, end: 1),
        ]
        XCTAssertEqual(VoiceNoteWords.index(at: 0.3, in: words), 0)
        XCTAssertEqual(VoiceNoteWords.index(at: 0.55, in: words), -1)
        XCTAssertEqual(VoiceNoteWords.index(at: 0.9, in: words), 1)
        let placed = VoiceNoteWords.aligned(transcript: "un deux", duration: 3)
        XCTAssertEqual(placed.map(\.text), ["un", "deux"])
        XCTAssertEqual(placed.first?.start, 0)
        XCTAssertEqual(placed.last?.end, 3)
        XCTAssertTrue(placed[0].end < placed[1].start || placed[0].end == placed[1].start)
        XCTAssertTrue(VoiceNoteWords.aligned(transcript: "  ", duration: 3).isEmpty)
        XCTAssertTrue(VoiceNoteWords.aligned(transcript: String(repeating: "a ", count: 600), duration: 3).isEmpty)
    }

    func testVoiceNoteDecodesWordTimesWhenTheComputerSendsThem() throws {
        let json = #"{"id":"m1","role":"bot","kind":"text","at":1,"text":"Bonjour JC","attachments":[{"kind":"audio","path":"note-1.mp3","mime":"audio/mpeg","durationMs":1000,"words":[{"text":"Bonjour","start":0,"end":0.4},{"text":"JC","start":0.5,"end":1}]}]}"#
        let message = try JSONDecoder().decode(Message.self, from: Data(json.utf8))
        let note = try XCTUnwrap(message.voiceNotes.first)
        XCTAssertEqual(note.words?.map(\.text), ["Bonjour", "JC"])
    }

    func testPublishedPageRules() {
        XCTAssertTrue(PublishedPagesRules.validID("page_id_1"))
        XCTAssertFalse(PublishedPagesRules.validID("short"))
        XCTAssertFalse(PublishedPagesRules.validID("page/id12"))
        XCTAssertNil(PublishedPagesRules.expiresAt(hours: 0, now: Date(timeIntervalSince1970: 1_700_000_000)))
        let at = PublishedPagesRules.expiresAt(hours: 24, now: Date(timeIntervalSince1970: 1_700_000_000))
        XCTAssertEqual(at, 1_700_000_000_000 + 24 * 3_600_000)
    }

    func testRenamePostsTheDesktopBridgeAndRemoveReadsTheRefusal() async throws {
        let harness = Harness()
        harness.respond(#"{"ok":true,"id":"office-1","name":"Desk"}"#)
        try await harness.client.renameDesktopComputer(id: "office-1", name: " Desk ")
        XCTAssertEqual(harness.captured?.url?.path, "/api/me/desktop-bridge/computers/rename")
        XCTAssertEqual(harness.captured?.httpMethod, "POST")
        let sent = try harness.body()
        XCTAssertEqual(sent["computer"] as? String, "office-1")
        XCTAssertEqual(sent["name"] as? String, "Desk")

        harness.respond(#"{"error":"A computer cannot be removed while it is online","code":"computer_online"}"#, status: 409)
        do {
            try await harness.client.removeDesktopComputer(id: "office-1")
            XCTFail("online remove should be refused")
        } catch let error as ComputerChangeFailure {
            XCTAssertEqual(error.refusal, .online)
        }
        harness.finish()
    }

    func testPublishedPagesPatchAccessAndRevoke() async throws {
        let harness = Harness()
        let page = #"{"id":"page_id_1","title":"Notes","status":"published","access":"private","expired":false,"updatedAt":1,"versions":[{"n":1,"title":"Notes","state":"published"}]}"#
        harness.respond(#"{"pages":[\#(page)]}"#)
        let list = try await harness.client.publishedPages()
        XCTAssertEqual(list.map(\.title), ["Notes"])
        XCTAssertTrue(list[0].isPublished)

        harness.respond(#"{"page":\#(page.replacingOccurrences(of: "\"private\"", with: "\"link\""))}"#)
        let shared = try await harness.client.setPublishedPageAccess(id: "page_id_1", access: .link)
        XCTAssertEqual(shared.access, "link")
        XCTAssertEqual(harness.captured?.httpMethod, "PATCH")
        XCTAssertEqual(try harness.body()["access"] as? String, "link")

        harness.respond(#"{"page":\#(page.replacingOccurrences(of: "\"published\"", with: "\"revoked\""))}"#)
        let revoked = try await harness.client.revokePublishedPage(id: "page_id_1")
        XCTAssertEqual(revoked.status, "revoked")
        XCTAssertFalse(revoked.isPublished)
        XCTAssertEqual(harness.captured?.url?.path, "/api/pages/page_id_1/revoke")
        do {
            try await harness.client.deletePublishedPage(id: "../etc")
            XCTFail("a page id with a slash is not sent")
        } catch {
            XCTAssertTrue(error is APIError)
        }
        harness.finish()
    }

    func testWakingIsOptionalOnComputerStatus() throws {
        let json = #"{"kind":"org-sandbox","configured":true,"state":"unavailable","diskState":"normal","workspaceBytes":null,"waking":{"since":10,"elapsedMs":20}}"#
        let status = try JSONDecoder().decode(ComputerStatus.self, from: Data(json.utf8))
        XCTAssertEqual(status.waking?.elapsedMs, 20)
        XCTAssertTrue(ComputerCare.needsRecover(configured: status.configured, state: status.state, problem: status.problem, waking: status.waking != nil))
    }

    private func desktop(_ id: String, _ name: String, online: Bool, seen: Double) -> PersonDesktop {
        PersonDesktop(id: id.isEmpty ? nil : id, name: name, platform: "darwin", online: online, lastSeenAt: seen, capabilities: nil)
    }
}

private final class Harness {
    let client: CompanionClient
    private let session: URLSession
    var captured: URLRequest? { Stub.captured }

    init() {
        Stub.captured = nil
        Stub.capturedBody = nil
        Stub.statusCode = 200
        Stub.responseBody = Data("{}".utf8)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [Stub.self]
        session = URLSession(configuration: configuration)
        client = CompanionClient(connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810), token: "paired-token", session: session)
    }

    func respond(_ json: String, status: Int = 200) {
        Stub.responseBody = Data(json.utf8)
        Stub.statusCode = status
    }

    func body() throws -> [String: Any] {
        let data = try XCTUnwrap(Stub.capturedBody)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    func finish() { session.invalidateAndCancel() }
}

private final class Stub: URLProtocol {
    static var responseBody = Data()
    static var statusCode = 200
    static var captured: URLRequest?
    static var capturedBody: Data?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.captured = request
        Self.capturedBody = request.httpBody ?? request.httpBodyStream.map { stream in
            stream.open()
            defer { stream.close() }
            var data = Data()
            var buffer = [UInt8](repeating: 0, count: 1024)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                data.append(buffer, count: count)
            }
            return data
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: Self.statusCode, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.responseBody)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
