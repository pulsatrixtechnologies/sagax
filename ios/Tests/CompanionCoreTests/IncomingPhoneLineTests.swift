import Foundation
import XCTest
@testable import CompanionCore

/// #4112 on the phone and the tablet: a line the person sent on their phone
/// line (a text, a call request) is the same "Asked by" names line and the
/// same fold as a teammate's request, never the person's bubble.
final class IncomingPhoneLineTests: XCTestCase {
    private func decode(_ json: String) throws -> Message {
        try JSONDecoder().decode(Message.self, from: Data(json.utf8))
    }

    private func texted(_ id: String, _ number: String, at: Double, via: String = "sms", callId: String? = nil) throws -> Message {
        let call = callId.map { #","callId":"\#($0)""# } ?? ""
        return try decode(#"{"id":"\#(id)","role":"user","kind":"text","at":\#(at),"text":"Words \#(id)","via":"\#(via)"\#(call),"sender":{"name":"\#(number)","id":"person-1"}}"#)
    }

    private func receipt(_ id: String, at: Double) throws -> Message {
        try decode(#"{"id":"\#(id)","role":"bot","kind":"activity","at":\#(at),"from":{"botId":"b","name":"Bot B","color":"green"},"tool":{"name":"Asked by Bot B","ok":true,"input":"Please check","handoffId":"h\#(id)"},"threadRef":{"botId":"self","threadId":"w\#(id)","title":"Work"}}"#)
    }

    private func answer(_ id: String, to line: String, at: Double) throws -> Message {
        try decode(#"{"id":"\#(id)","role":"bot","kind":"text","at":\#(at),"text":"Answer to \#(line)","requestMessageId":"\#(line)"}"#)
    }

    private func line(_ rows: [TranscriptRow]) -> IncomingLine? {
        guard rows.count == 1, case let .incoming(line) = rows[0] else { return nil }
        return line
    }

    func testOneTextIsTheNamesLineWithItsNumberReadTheLocalWay() throws {
        let only = try XCTUnwrap(line(transcriptRows([texted("1", "+1 555 010 0142", at: 1)], detail: .full)))
        XCTAssertEqual(only.askers, [IncomingAsker(botId: nil, name: "555 010-0142", agent: false, phone: "sms")])
        XCTAssertNil(only.requestCount)
        XCTAssertEqual(only.exchanges.first?.request, "Words 1")
    }

    func testThreeTextsFromOneNumberFoldWithACount() throws {
        let messages = try [texted("1", "+15550100142", at: 1), texted("2", "+1 555 010 0142", at: 2), texted("3", "+1 555 010 0142", at: 3)]
        let folded = try XCTUnwrap(line(transcriptRows(messages, detail: .full)))
        XCTAssertEqual(folded.askers.count, 1)
        XCTAssertEqual(folded.requestCount, 3)
        XCTAssertEqual(folded.exchanges(of: folded.askers[0]).map(\.id), ["3", "2", "1"], "newest first")
    }

    func testTwoNumbersAreTwoNamesOfOneLine() throws {
        let messages = try [texted("1", "+1 555 010 0142", at: 1), texted("2", "+1 555 010 0199", at: 2)]
        let folded = try XCTUnwrap(line(transcriptRows(messages, detail: .full)))
        XCTAssertEqual(folded.askers.map(\.name), ["555 010-0142", "555 010-0199"])
        XCTAssertNil(folded.requestCount)
    }

    func testATextATeammateAndATextAreOneLine() throws {
        let messages = try [texted("1", "+1 555 010 0142", at: 1), receipt("2", at: 2), texted("3", "+1 555 010 0142", at: 3)]
        let folded = try XCTUnwrap(line(transcriptRows(messages, detail: .full, showThreads: false)))
        XCTAssertEqual(folded.askers.map(\.name), ["555 010-0142", "Bot B"])
        XCTAssertEqual(folded.requestCount, 3)
    }

    func testTextAnswerTextAnswerFromTwoNumbersIsOneLineWithEachAnswerBehindItsNumber() throws {
        let messages = try [
            texted("1", "+1 555 010 0142", at: 1), answer("a1", to: "1", at: 2),
            texted("2", "+1 555 010 0199", at: 3), answer("a2", to: "2", at: 4),
            texted("3", "+1 555 010 0142", at: 5), answer("a3", to: "3", at: 6),
        ]
        let folded = try XCTUnwrap(line(transcriptRows(messages, detail: .full)))
        XCTAssertEqual(folded.askers.map(\.name), ["555 010-0142", "555 010-0199"])
        XCTAssertEqual(folded.requestCount, 3)
        XCTAssertEqual(folded.exchanges(of: folded.askers[0]).map(\.reply), ["Answer to 3", "Answer to 1"])
        XCTAssertEqual(folded.messages.count, 6)
    }

    func testThePersonsOwnWordsAndAnotherLinesTurnStayInTheChat() throws {
        let typed = try decode(#"{"id":"u","role":"user","kind":"text","at":3,"text":"Hi"}"#)
        let rows = try transcriptRows([texted("1", "+1 555 010 0142", at: 1), answer("o", to: "x", at: 2), typed], detail: .full)
        XCTAssertEqual(rows.count, 3)
    }

    func testACallRequestHasItsOwnSourceAndALiveCallLineStaysThePersons() throws {
        let request = try texted("1", "Sam Example", at: 1, via: "call")
        XCTAssertEqual(IncomingLines.phoneSource(request), "call")
        XCTAssertEqual(line(transcriptRows([request], detail: .full))?.askers.first?.phone, "call")
        let spoken = try texted("2", "Sam Example", at: 2, via: "call", callId: "call-1")
        XCTAssertNil(IncomingLines.phoneSource(spoken))
    }
}
