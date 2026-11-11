// #3471 on the phone and the tablet: a teammate's parked question from
// handed-over work (`Message.inputRequest`) is a waiting card like the
// others: drawn as the question in words, skipped through
// `POST /api/approvals/handled` with `skip`, folded once closed.
import Foundation
import XCTest
@testable import CompanionCore

final class InputRequestTests: XCTestCase {
    private func message(_ json: String) throws -> Message {
        try JSONDecoder().decode(Message.self, from: Data(json.utf8))
    }

    private func row(id: String = "ir1", at: Double = 1_000, extra: String = "") -> String {
        #"{"id":"\#(id)","role":"bot","kind":"activity","at":\#(at),"tool":{"name":"Wren needs your input: Which account?","ok":true},"threadRef":{"botId":"b2","threadId":"work-1","title":"Release"},"inputRequest":{"botId":"b2","threadId":"work-1","botName":"Wren","title":"Release","question":"Which account?"\#(extra)}}"#
    }

    func testTheWireInputRequestIsDecoded() throws {
        let request = try XCTUnwrap(try message(row()).inputRequest)
        XCTAssertEqual(request.botId, "b2")
        XCTAssertEqual(request.threadId, "work-1")
        XCTAssertEqual(request.question, "Which account?")
        XCTAssertTrue(request.isOpen)
    }

    func testItReadsAsTheQuestionInWordsCard() throws {
        let card = try XCTUnwrap(InputRequestRules.card(try message(row())))
        XCTAssertEqual(card.kind, "question")
        XCTAssertEqual(card.botName, "Wren")
        XCTAssertEqual(card.threadId, "work-1")
        XCTAssertEqual(card.items.map(\.text), ["Which account?"])
        XCTAssertTrue(card.isWaiting)
        XCTAssertTrue(WaitingCardSkip.waits(try message(row())))
    }

    func testItIsSkippedThroughHandledOnTheConversation() throws {
        // the conversation's thread and bot, never the asking work's
        XCTAssertEqual(WaitingCardSkip.route(forWords: try message(row()), threadId: "main-1", botId: "b1"),
                       .handled(botId: "b1", threadId: "main-1", messageId: "ir1"))
        XCTAssertEqual(WaitingCardSkip.route(for: try message(row()), threadId: "main-1", botId: "b1"),
                       .handled(botId: "b1", threadId: "main-1", messageId: "ir1"))
    }

    func testASkipFoldsItIntoSkippedNoAnswer() throws {
        let folded = WaitingCardSkip.skipped(try message(row()))
        XCTAssertEqual(folded.inputRequest?.skipped, true)
        XCTAssertEqual(folded.inputRequest?.expired, true)
        XCTAssertFalse(WaitingCardSkip.waits(folded))
        XCTAssertNil(WaitingCardSkip.route(forWords: folded, threadId: "main-1", botId: "b1"))
        XCTAssertEqual(InputRequestRules.card(folded).flatMap(WaitingCardSkip.fold), .skipped)
    }

    func testAClosedOneFoldsAsExpiredOrDefaulted() throws {
        let expired = try message(row(extra: #","expired":true"#))
        XCTAssertEqual(InputRequestRules.card(expired).flatMap(WaitingCardSkip.fold), .expired)
        let defaulted = try message(row(extra: #","expired":true,"defaulted":true"#))
        XCTAssertEqual(InputRequestRules.card(defaulted).flatMap(WaitingCardSkip.fold), .defaulted)
        let answered = try message(row(extra: #","answered":true"#))
        XCTAssertNil(InputRequestRules.card(answered).flatMap(WaitingCardSkip.fold))
        XCTAssertFalse(try XCTUnwrap(InputRequestRules.card(answered)).isWaiting)
    }

    func testItIsACardOfItsOwnInTheTranscriptEvenWithThreadsOff() throws {
        let user = try message(#"{"id":"u1","role":"user","kind":"text","at":500,"text":"go"}"#)
        let request = try message(row())
        let rows = transcriptRows([user, request], detail: .full, showThreads: false)
        XCTAssertEqual(rows.map(\.head.id), ["u1", "ir1"])
        guard case .message = try XCTUnwrap(rows.last) else { return XCTFail("a card, never a step of a run") }
    }

    func testTheCardOfTheSameAskDrawsItOnce() throws {
        let card = try message(#"{"id":"a1","role":"bot","kind":"text","at":1200,"text":"","attention":{"kind":"question","items":[{"text":"Which account?"}],"botId":"b2","botName":"Wren","threadId":"work-1","sourceMessageId":"s1"}}"#)
        let request = try message(row())
        XCTAssertEqual(InputRequestRules.drawnElsewhere([card, request]), ["ir1"])
        XCTAssertEqual(transcriptRows([card, request], detail: .full, showThreads: false).map(\.head.id), ["a1"])
        // the card marked handled leaves a still open input request drawn
        var handled = card
        handled.attention?.handledAt = 2_000
        XCTAssertEqual(InputRequestRules.drawnElsewhere([handled, request]), [])
        // an ask of another work hides nothing
        let other = try message(row(id: "ir2", at: 1_000).replacingOccurrences(of: "work-1", with: "work-2"))
        XCTAssertEqual(InputRequestRules.drawnElsewhere([card, other]), [])
    }
}
