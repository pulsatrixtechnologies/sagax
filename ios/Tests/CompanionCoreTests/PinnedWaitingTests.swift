// #3415, #3471 on the phone and the tablet: the card pinned over the
// composer holds every item waiting on the person, of every kind and from
// every topic of the bot, read from the server's one list
// (`GET /api/approvals?waiting=1&botId=`). Answering or skipping an item
// moves the pinned card to the next one.
import Foundation
import XCTest
@testable import CompanionCore

private final class WaitingListStub: URLProtocol {
    static var asked: [URL] = []
    static var body = Data()
    static var status = 200

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        if let url = request.url { Self.asked.append(url) }
        let response = HTTPURLResponse(url: request.url!, statusCode: Self.status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class PinnedWaitingTests: XCTestCase {
    // One item of each kind, in two topics of the bot `b1`, as the server
    // serves them (the `pending` rows carry each item's message).
    private let payloadJSON = #"""
    {
      "pending": [
        {"key":"main:r1","threadId":"main","requestId":"r1","message":{"id":"m1","role":"bot","kind":"options","at":2000,"card":{"title":"t","subtitle":"ls","options":["Allow","Deny"],"requestId":"r1","tool":"Bash"}}},
        {"key":"old:q1","threadId":"old","requestId":"q1","message":{"id":"m2","role":"bot","kind":"options","at":1000,"card":{"title":"Which build?","subtitle":"","options":["A","B"],"requestId":"q1"}}},
        {"key":"main:attention:m4","threadId":"main","requestId":"attention:m4","message":{"id":"m4","role":"bot","kind":"text","at":4000,"text":"","attention":{"kind":"question","items":[{"text":"Which account?"}],"botId":"b2","botName":"Wren","threadId":"work-1","sourceMessageId":"s1"}}},
        {"key":"main:proactive:p1","threadId":"main","requestId":"proactive:p1","message":{"id":"m3","role":"bot","kind":"options","at":3000,"card":{"title":"Receive alerts?","subtitle":"","options":["Yes","Not now"],"proactiveProposal":{"id":"p1"}}}},
        {"key":"main:attention:m5","threadId":"main","requestId":"attention:m5","message":{"id":"m5","role":"bot","kind":"activity","at":5000,"tool":{"name":"Wren needs your input: Which group?","ok":true},"inputRequest":{"botId":"b2","threadId":"work-2","botName":"Wren","question":"Which group?"},"attention":{"kind":"question","items":[{"text":"Which group?"}],"botId":"b2","botName":"Wren","threadId":"work-2","sourceMessageId":"m5"}}},
        {"key":"main:broken","threadId":"main","requestId":"broken","message":{"nonsense":true}}
      ],
      "history": [],
      "scopes": {"org": false, "team": false},
      "waiting": [
        {"id":"r1","kind":"approval","botId":"b1","botName":"Ara","threadId":"main","messageId":"m1","at":2000,"ageMs":5,"title":"ls","text":"ls","options":["Allow","Deny"],"answerWith":"decision","freeText":false,"skippable":true},
        {"id":"attention:m4","kind":"request","botId":"b1","botName":"Ara","threadId":"main","messageId":"m4","at":4000,"ageMs":5,"title":"Which account?","text":"Which account?","options":[],"answerWith":"text","freeText":true,"skippable":true,"workThreadId":"work-1","workBotId":"b2"},
        {"id":"q1","kind":"question","botId":"b1","botName":"Ara","threadId":"old","messageId":"m2","at":1000,"ageMs":5,"title":"Which build?","text":"Which build?","options":["A","B"],"answerWith":"option","freeText":true,"skippable":true},
        {"id":"proactive:p1","kind":"proposal","botId":"b1","botName":"Ara","threadId":"main","messageId":"m3","at":3000,"ageMs":5,"title":"Receive alerts?","text":"Receive alerts?","options":["Yes","Not now"],"answerWith":"option","freeText":false,"skippable":true,"proactiveId":"p1"},
        {"id":"attention:m5","kind":"request","botId":"b1","botName":"Ara","threadId":"main","messageId":"m5","at":5000,"ageMs":5,"title":"Which group?","text":"Which group?","options":[],"answerWith":"text","freeText":true,"skippable":true},
        {"id":"broken","kind":"approval","botId":"b1","botName":"Ara","threadId":"main","at":6000,"ageMs":5,"title":"","text":"","options":[],"answerWith":"decision","freeText":false,"skippable":true}
      ]
    }
    """#

    private func payload() throws -> WaitingPayload {
        try JSONDecoder().decode(WaitingPayload.self, from: Data(payloadJSON.utf8))
    }

    func testEveryKindFromEveryTopicIsPinnedOldestFirst() throws {
        let entries = PinnedWaiting.entries(try payload()) { _ in nil }
        // the question of an earlier topic first; the row the phone cannot read is left out
        XCTAssertEqual(entries.map(\.message.id), ["m2", "m1", "m3", "m4", "m5"])
        XCTAssertEqual(entries.map(\.item.kind), ["question", "approval", "proposal", "request", "request"])
        XCTAssertEqual(entries.first?.threadId, "old")
        // only the approval is drawn by the approval dock, on its own thread
        XCTAssertEqual(entries.compactMap(\.approval).map(\.requestId), ["r1"])
        XCTAssertEqual(entries.compactMap(\.approval).first?.threadId, "main")
    }

    func testEachItemIsSkippedOnTheRouteOfItsCard() throws {
        let entries = PinnedWaiting.entries(try payload()) { _ in nil }
        XCTAssertEqual(entries.map { PinnedWaiting.skipRoute($0, botId: "b1") }, [
            .respond(threadId: "old", requestId: "q1", behavior: "answer"),
            .respond(threadId: "main", requestId: "r1", behavior: "deny"),
            .proposal(botId: "b1", proposalId: "p1"),
            .handled(botId: "b1", threadId: "main", messageId: "m4"),
            .handled(botId: "b1", threadId: "main", messageId: "m5"),
        ])
    }

    /// A skip moves the pinned card to the next item, for each kind: the
    /// skipped item's card folds where the phone holds it, it leaves the
    /// pinned list at once, and the item after it moves into its place.
    func testASkipMovesThePinnedCardToTheNextItemForEachKind() throws {
        let list = try payload()
        let all = PinnedWaiting.entries(list) { _ in nil }
        for (position, entry) in all.enumerated() {
            var transcripts: [String: [Message]] = ["main": [], "old": []]
            transcripts[entry.threadId] = [WaitingCardSkip.skipped(entry.message)]
            let after = PinnedWaiting.entries(list) { transcripts[$0] }
            XCTAssertFalse(after.contains { $0.id == entry.id }, "\(entry.item.kind) still pinned after its skip")
            XCTAssertEqual(after.count, all.count - 1)
            let index = PinnedWaiting.index(after, key: entry.id, at: position)
            let expected = position + 1 < all.count ? all[position + 1].id : all[position - 1].id
            XCTAssertEqual(after[index].id, expected, "after a skip of the \(entry.item.kind)")
        }
    }

    func testAnItemAnsweredInTheTranscriptIsSettledOnThePinnedCard() throws {
        let list = try payload()
        var answered = try XCTUnwrap(PinnedWaiting.entries(list) { _ in nil }.first { $0.item.kind == "approval" }).message
        answered.card?.answered = "allow"
        let entries = PinnedWaiting.entries(list) { $0 == "main" ? [answered] : nil }
        XCTAssertFalse(entries.contains { $0.message.id == "m1" })
        // the transcript's open copy is the one drawn
        let open = try XCTUnwrap(PinnedWaiting.entries(list) { _ in nil }.first { $0.message.id == "m2" }).message
        XCTAssertEqual(PinnedWaiting.entries(list) { $0 == "old" ? [open] : nil }.first?.message, open)
    }

    func testThePlaceStaysOnTheSameItemWhenAnotherLeaves() throws {
        let all = PinnedWaiting.entries(try payload()) { _ in nil }
        let rest = Array(all.dropFirst())
        XCTAssertEqual(rest[PinnedWaiting.index(rest, key: all[2].id, at: 2)].id, all[2].id)
        XCTAssertEqual(PinnedWaiting.index([], key: nil, at: 3), 0)
        XCTAssertEqual(PinnedWaiting.index(all, key: nil, at: 99), all.count - 1)
    }

    func testARoomTakesTheItemsOfItsOwnThread() throws {
        let scoped = PinnedWaiting.inThread(try payload(), threadId: "old")
        XCTAssertEqual(PinnedWaiting.entries(scoped) { _ in nil }.map(\.message.id), ["m2"])
    }

    func testOnlyFramesThatMayOpenOrCloseAnItemReadTheListAgain() throws {
        let card = try JSONDecoder().decode(Message.self, from: Data(#"{"id":"x","role":"bot","kind":"options","at":1,"card":{"title":"t","subtitle":"","options":[],"requestId":"r9"}}"#.utf8))
        let words = try JSONDecoder().decode(Message.self, from: Data(#"{"id":"y","role":"user","kind":"text","at":1,"text":"done"}"#.utf8))
        let reply = try JSONDecoder().decode(Message.self, from: Data(#"{"id":"z","role":"bot","kind":"text","at":1,"text":"ok"}"#.utf8))
        let threads: Set<String> = ["main", "task"]
        XCTAssertTrue(PinnedWaiting.changes(.message(threadId: "task", message: card), threads: threads, waiting: []))
        XCTAssertTrue(PinnedWaiting.changes(.messagePatch(threadId: "main", message: card), threads: threads, waiting: []))
        XCTAssertFalse(PinnedWaiting.changes(.message(threadId: "elsewhere", message: card), threads: threads, waiting: []))
        XCTAssertTrue(PinnedWaiting.changes(.message(threadId: "main", message: words), threads: threads, waiting: ["main"]))
        XCTAssertFalse(PinnedWaiting.changes(.message(threadId: "main", message: words), threads: threads, waiting: []))
        XCTAssertFalse(PinnedWaiting.changes(.message(threadId: "main", message: reply), threads: threads, waiting: ["main"]))
    }

    func testTheListIsAskedForOneBot() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [WaitingListStub.self]
        WaitingListStub.asked = []
        WaitingListStub.body = Data(payloadJSON.utf8)
        let client = CompanionClient(connection: Connection(name: "Test", host: "127.0.0.1", port: 8810), token: "t", session: URLSession(configuration: config))
        let read = try await client.waitingItems(botId: "b1")
        XCTAssertEqual(read.waiting.count, 6)
        XCTAssertEqual(PinnedWaiting.entries(read) { _ in nil }.count, 5)
        let url = try XCTUnwrap(WaitingListStub.asked.first)
        XCTAssertEqual(url.path, "/api/approvals")
        let query = Set(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? [])
        XCTAssertEqual(query, [URLQueryItem(name: "waiting", value: "1"), URLQueryItem(name: "botId", value: "b1")])
    }

    /// An older server or desktop relay: the route answers with no
    /// `waiting` key, or refuses the read. The pinned card keeps the
    /// approvals the phone already has, so one can still be answered.
    func testWithNoListTheTranscriptsPendingApprovalStaysPinned() async throws {
        let ask = try JSONDecoder().decode(Message.self, from: Data(#"{"id":"a1","role":"bot","kind":"options","at":7,"card":{"title":"t","subtitle":"ls","options":["Allow","Deny"],"requestId":"ra","tool":"Bash"}}"#.utf8))
        let fallback = ApprovalDockRules.pendingApprovals([ask])
        func pinned(_ payload: WaitingPayload?) -> [PinnedWaitingEntry] {
            PinnedWaiting.pinned(payload, fallback: fallback, botId: "b1", botName: "Ara", conversation: "main") { _ in nil }
        }

        // an answer with no `waiting` key (its Today rows only)
        let old = try JSONDecoder().decode(WaitingPayload.self, from: Data(#"{"pending":[],"history":[]}"#.utf8))
        XCTAssertFalse(old.served)
        XCTAssertEqual(pinned(old).compactMap(\.approval).map(\.requestId), ["ra"])
        XCTAssertEqual(pinned(old).first?.threadId, "main")

        // a refused read: nothing kept for the chat
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [WaitingListStub.self]
        WaitingListStub.status = 403
        WaitingListStub.body = Data(#"{"error":"not allowed"}"#.utf8)
        defer { WaitingListStub.status = 200 }
        let client = CompanionClient(connection: Connection(name: "Test", host: "127.0.0.1", port: 8810), token: "t", session: URLSession(configuration: config))
        do {
            _ = try await client.waitingItems(botId: "b1")
            XCTFail("a refused read must throw")
        } catch let APIError.status(code, _) {
            XCTAssertEqual(code, 403)
        }
        XCTAssertEqual(pinned(nil).compactMap(\.approval).map(\.requestId), ["ra"])

        // the server's list wins whenever it answers, even empty; a live
        // approval it does not carry yet is pinned after its items (#3615,
        // #3689: the conversation leaves it to the pinned card at once)
        let served = try JSONDecoder().decode(WaitingPayload.self, from: Data(#"{"pending":[],"waiting":[]}"#.utf8))
        XCTAssertTrue(served.served)
        XCTAssertEqual(pinned(served).compactMap(\.approval).map(\.requestId), ["ra"])
        XCTAssertEqual(pinned(try payload()).map(\.message.id), ["m2", "m1", "m3", "m4", "m5", "a1"])
        XCTAssertTrue(PinnedWaiting.pinned(served, fallback: [], botId: "b1", botName: "Ara", conversation: "main") { _ in nil }.isEmpty)
    }

    /// Each served item carries its own message: it is the one drawn.
    func testAServedItemsOwnMessageIsRead() throws {
        let json = #"{"pending":[],"waiting":[{"id":"q9","kind":"question","botId":"b1","botName":"Ara","threadId":"main","messageId":"m9","at":1,"title":"Pick","text":"Pick","options":["A"],"message":{"id":"m9","role":"bot","kind":"options","at":1,"card":{"title":"Pick","subtitle":"","options":["A"],"requestId":"q9"}}}]}"#
        let list = try JSONDecoder().decode(WaitingPayload.self, from: Data(json.utf8))
        XCTAssertEqual(PinnedWaiting.entries(list) { _ in nil }.map(\.message.id), ["m9"])
    }

    func testAToolNamedAfterAProductReadsAsASentence() {
        XCTAssertEqual(ApprovalToolAction.of(tool: "App Store Connect"), .useNamed("App Store Connect"))
        XCTAssertEqual(ApprovalToolAction.of(tool: "mcp__srv__list_sites"), .named("list sites"))
    }
}
