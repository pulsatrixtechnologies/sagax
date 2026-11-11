// #3471 on the phone and the tablet: every waiting card can be skipped from
// one quiet control, a skip is never a refusal, and a closed card folds
// into "Skipped, no answer" or "Expired, no answer".
import Foundation
import XCTest
@testable import CompanionCore

private final class SkipRequestStub: URLProtocol {
    static var captured: [(path: String, body: [String: Any])] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        var data = request.httpBody ?? Data()
        if data.isEmpty, let stream = request.httpBodyStream {
            stream.open()
            var buffer = [UInt8](repeating: 0, count: 1_024)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                data.append(buffer, count: count)
            }
            stream.close()
        }
        let body = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        Self.captured.append((request.url?.path ?? "", body))
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(#"{"ok":true,"outcome":"skipped"}"#.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class WaitingCardSkipTests: XCTestCase {
    private func message(_ json: String) throws -> Message {
        try JSONDecoder().decode(Message.self, from: Data(json.utf8))
    }

    private let approval = #"{"id":"m1","role":"bot","kind":"options","at":1,"card":{"title":"t","subtitle":"ls","options":["Allow","Deny"],"requestId":"r1","tool":"Bash"}}"#
    private let question = #"{"id":"m2","role":"bot","kind":"options","at":1,"card":{"title":"Which build?","subtitle":"","options":["A","B"],"requestId":"q1"}}"#
    private let proposal = #"{"id":"m3","role":"bot","kind":"options","at":1,"card":{"title":"Receive alerts?","subtitle":"","options":["Yes","Not now"],"proactiveProposal":{"id":"p1"}}}"#
    private let attention = #"{"id":"m4","role":"bot","kind":"text","at":1,"text":"","attention":{"kind":"question","items":[{"text":"Which account?"}],"botId":"b2","botName":"Wren","threadId":"work-1","sourceMessageId":"s1"}}"#

    // MARK: Each kind is skipped on its own route, never denied

    func testAnApprovalIsSkippedThroughRespondWithSkip() throws {
        let card = try XCTUnwrap(try message(approval).card)
        XCTAssertEqual(WaitingCardSkip.route(for: card, threadId: "t1", botId: "b1"),
                       .respond(threadId: "t1", requestId: "r1", behavior: "deny"))
    }

    func testAQuestionIsSkippedAsAnAnswerNotADeny() throws {
        let card = try XCTUnwrap(try message(question).card)
        XCTAssertEqual(WaitingCardSkip.route(for: card, threadId: "t1", botId: "b1"),
                       .respond(threadId: "t1", requestId: "q1", behavior: "answer"))
    }

    func testAProposalIsSkippedOnItsBot() throws {
        let card = try XCTUnwrap(try message(proposal).card)
        XCTAssertEqual(WaitingCardSkip.route(for: card, threadId: "t1", botId: "b1"), .proposal(botId: "b1", proposalId: "p1"))
        XCTAssertNil(WaitingCardSkip.route(for: card, threadId: "t1", botId: nil), "a proposal needs its bot")
    }

    func testAQuestionInWordsIsSkippedOnTheConversationsBot() throws {
        let row = try message(attention)
        let card = try XCTUnwrap(row.attention)
        XCTAssertEqual(WaitingCardSkip.route(for: card, messageId: row.id, threadId: "t1", botId: "b1"),
                       .handled(botId: "b1", threadId: "t1", messageId: "m4"))
    }

    func testASettledCardHasNoSkip() throws {
        var card = try XCTUnwrap(try message(approval).card)
        card.answered = "allow"
        XCTAssertNil(WaitingCardSkip.route(for: card, threadId: "t1", botId: "b1"))
        var asked = try XCTUnwrap(try message(attention).attention)
        asked.closed = "expired"
        asked.handledAt = 5
        XCTAssertNil(WaitingCardSkip.route(for: asked, messageId: "m4", threadId: "t1", botId: "b1"))
        let quiz = try message(#"{"id":"m5","role":"bot","kind":"options","at":1,"card":{"title":"t","subtitle":"","options":["A"]}}"#)
        XCTAssertNil(WaitingCardSkip.route(for: try XCTUnwrap(quiz.card), threadId: "t1", botId: "b1"), "a first-run quiz is put away, not skipped")
    }

    // MARK: Folded at once, in one quiet line

    func testASkippedCardFoldsAtOnceAndReadsSkipped() throws {
        let folded = WaitingCardSkip.skipped(try message(approval))
        let card = try XCTUnwrap(folded.card)
        XCTAssertEqual(card.skipped, true)
        XCTAssertEqual(card.answered, "skipped")
        XCTAssertFalse(card.isPending)
        XCTAssertTrue(ApprovalDockRules.pendingApprovals([folded]).isEmpty, "the pinned card moves to the next item")
        XCTAssertEqual(WaitingCardSkip.fold(card), .skipped)
        XCTAssertEqual(ApprovalOutcome.of(card), .skipped, "never read as denied")
        XCTAssertEqual(ApprovalPill.of(card), .skipped)
        XCTAssertEqual(ApprovalPill.skipped.tone, .neutral)

        let words = WaitingCardSkip.skipped(try message(attention), now: Date(timeIntervalSince1970: 2))
        XCTAssertEqual(words.attention?.closed, "skipped")
        XCTAssertEqual(words.attention?.handledAt, 2_000)
        XCTAssertEqual(words.attention.flatMap(WaitingCardSkip.fold), .skipped)
    }

    func testTheServersSkippedAndExpiredFieldsAreRead() throws {
        let skipped = try message(#"{"id":"m","role":"bot","kind":"options","at":1,"card":{"title":"t","subtitle":"","options":["A"],"requestId":"q","answered":"skipped","skipped":true,"expired":true}}"#)
        XCTAssertEqual(skipped.card.flatMap(WaitingCardSkip.fold), .skipped)
        let expired = try message(#"{"id":"m","role":"bot","kind":"options","at":1,"card":{"title":"t","subtitle":"","options":["A"],"requestId":"q","expired":true}}"#)
        XCTAssertEqual(expired.card.flatMap(WaitingCardSkip.fold), .expired)
        let closed = try message(#"{"id":"m","role":"bot","kind":"text","at":1,"text":"","attention":{"kind":"question","items":[],"botId":"b","botName":"B","threadId":"w","sourceMessageId":"s","handledAt":9,"closed":"expired"}}"#)
        XCTAssertEqual(closed.attention.flatMap(WaitingCardSkip.fold), .expired)
        XCTAssertFalse(try XCTUnwrap(closed.attention).isWaiting)
    }

    // MARK: One way to skip a question

    func testAWaitingQuestionOffersOnlyTheSkipNoIgnoreNorCountdown() throws {
        // desktop QuestionCard.r2.test.ts: "offers only the skip X, no Ignore or countdown"
        let asked = try message(#"{"id":"m","role":"bot","kind":"options","at":1,"card":{"title":"t","subtitle":"","options":["A"],"requestId":"q","requestType":"question","expiresAt":9999999999999}}"#)
        let card = try XCTUnwrap(asked.card)
        XCTAssertEqual(WaitingCardSkip.route(for: card, threadId: "t1", botId: "b1"), .respond(threadId: "t1", requestId: "q", behavior: "answer"))
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        for file in ["App/Cards/QuestionCardView.swift", "App/Cards/FlatQuestionCardView.swift", "App/Cards/QuestionSheet.swift"] {
            let text = try String(contentsOf: root.appendingPathComponent(file), encoding: .utf8)
            for word in ["QuestionIgnoreControl", "QuestionIgnore.answer", "Ignore the question", "closes automatically", "TimelineView"] {
                XCTAssertFalse(text.contains(word), "\(file) still offers \(word)")
            }
        }
    }

    // MARK: A skip that does not land

    func testAFailedSkipOpensTheQuestionAgainWithItsReplyBox() throws {
        let original = try message(attention)
        let folded = WaitingCardSkip.skipped(original)
        XCTAssertEqual(folded.attention.flatMap(WaitingCardSkip.fold), .skipped)
        for failure: Error in [APIError.status(code: 500, message: nil), APIError.transport("offline"), APIError.badURL] {
            let back = try XCTUnwrap(WaitingCardSkip.reopened(original, after: failure), "a failed skip puts the card back")
            let card = try XCTUnwrap(back.attention)
            XCTAssertNil(WaitingCardSkip.fold(card), "never left reading Skipped, no answer")
            XCTAssertTrue(card.isWaiting, "the reply box comes back")
            XCTAssertNotNil(WaitingCardSkip.route(for: card, messageId: back.id, threadId: "t1", botId: "b1"), "it can be skipped again")
        }
        let approvalBack = try XCTUnwrap(WaitingCardSkip.reopened(try message(approval), after: APIError.status(code: 503, message: nil)))
        XCTAssertTrue(try XCTUnwrap(approvalBack.card).isPending)
    }

    func testASkipOfACardClosedElsewhereKeepsTheServersOutcome() throws {
        // desktop skipCard: a 409 keeps the server's outcome, never a live card again
        XCTAssertNil(WaitingCardSkip.reopened(try message(approval), after: APIError.status(code: 409, message: "already answered")))
        XCTAssertNil(WaitingCardSkip.reopened(try message(attention), after: APIError.status(code: 409, message: nil)))
    }

    // MARK: The requests

    func testEachRouteSendsTheDesktopsBody() async throws {
        SkipRequestStub.captured = []
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [SkipRequestStub.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let client = CompanionClient(connection: Connection(name: "Test", host: "127.0.0.1", port: 8810), token: "t", session: session)

        try await client.skipWaitingCard(.respond(threadId: "t1", requestId: "r1", behavior: "deny"))
        try await client.skipWaitingCard(.handled(botId: "b1", threadId: "t1", messageId: "m4"))
        try await client.skipWaitingCard(.proposal(botId: "b1", proposalId: "p1"))

        let sent = SkipRequestStub.captured
        XCTAssertEqual(sent.map(\.path), ["/api/threads/t1/respond", "/api/approvals/handled", "/api/bots/b1/proactive/p1"])
        XCTAssertEqual(sent[0].body["requestId"] as? String, "r1")
        XCTAssertEqual(sent[0].body["behavior"] as? String, "deny")
        XCTAssertEqual(sent[0].body["skip"] as? Bool, true)
        XCTAssertNil(sent[0].body["rule"], "a skip saves no rule")
        XCTAssertEqual(sent[1].body["messageId"] as? String, "m4")
        XCTAssertEqual(sent[1].body["botId"] as? String, "b1")
        XCTAssertEqual(sent[1].body["skip"] as? Bool, true)
        XCTAssertEqual(sent[2].body["skip"] as? Bool, true)
        XCTAssertNil(sent[2].body["accept"], "neither a yes nor a no")
    }
}
