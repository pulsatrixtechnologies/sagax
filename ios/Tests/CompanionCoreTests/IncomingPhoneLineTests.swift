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
    // #4122: the desktop's vectors (src/lib/incoming-line.test.ts, "phone-line
    // requests") that the phone did not run yet, so both read the same rule.

    private func unlabelled(_ id: String, sender: String?) throws -> Message {
        let stamp = sender.map { #","sender":{"name":"\#($0)","id":"person-1"}"# } ?? ""
        return try decode(#"{"id":"\#(id)","role":"user","kind":"text","at":1,"text":"Words \#(id)","via":"sms"\#(stamp)}"#)
    }

    private func step(_ id: String, to line: String, at: Double) throws -> Message {
        try decode(#"{"id":"\#(id)","role":"bot","kind":"activity","at":\#(at),"tool":{"name":"Search","ok":true},"requestMessageId":"\#(line)"}"#)
    }

    func testAStoredTextWithoutALabelIsTheSourceAlone() throws {
        for row in [try unlabelled("t1", sender: "via text message"), try unlabelled("t2", sender: nil)] {
            let only = try XCTUnwrap(line(transcriptRows([row], detail: .full)))
            XCTAssertEqual(only.askers, [IncomingAsker(botId: nil, name: "", agent: false, phone: "sms")])
        }
    }

    func testTheNumberIsReadTheDesktopsWayAndNothingElseIsReshaped() {
        // shared/outbound-call.ts readablePhone: "+1", then 3, 3 and 4 digits,
        // at most one space between the groups
        let vectors: [(String, String)] = [
            ("+1 555 010 0142", "555 010-0142"),
            ("+15550100142", "555 010-0142"),
            (" +1 555 0100142 ", "555 010-0142"),
            ("+1  555 010 0142", "+1  555 010 0142"),
            ("+1 55 5010 0142", "+1 55 5010 0142"),
            ("+1 555 010 0142 9", "+1 555 010 0142 9"),
            ("+44 20 7946 0958", "+44 20 7946 0958"),
            ("Sam Example", "Sam Example"),
        ]
        for (label, read) in vectors { XCTAssertEqual(IncomingLines.readablePhone(label), read, label) }
    }

    func testALiveCallsSpokenRequestAndATypedLineStayThePersons() throws {
        let spoken = try texted("l1", "Sam Example", at: 1, via: "call", callId: "call-1")
        let typed = try decode(#"{"id":"u","role":"user","kind":"text","at":2,"text":"Hi"}"#)
        let rows = transcriptRows([spoken, typed], detail: .full)
        XCTAssertFalse(rows.contains { if case .incoming = $0 { return true } else { return false } })
    }

    func testTextAnswerTextAnswerFromOneNumberIsOneRowOfTwoRequests() throws {
        let messages = try [texted("t1", "+1 555 010 0142", at: 1), answer("r1", to: "t1", at: 2), texted("t2", "+1 555 010 0142", at: 3), answer("r2", to: "t2", at: 4)]
        let folded = try XCTUnwrap(line(transcriptRows(messages, detail: .full)))
        XCTAssertEqual(folded.askers.map(\.name), ["555 010-0142"])
        XCTAssertEqual(folded.requestCount, 2)
        XCTAssertEqual(folded.exchanges(of: folded.askers[0]).map { [$0.request, $0.reply] }, [["Words t2", "Answer to t2"], ["Words t1", "Answer to t1"]])
        XCTAssertEqual(folded.messages.map(\.id), ["t1", "r1", "t2", "r2"])
    }

    func testTextsAndAnswersFromTwoNumbersWithStepsAndTwoWordsJoin() throws {
        let messages = try [
            texted("t1", "+1 555 010 0142", at: 1), step("s1", to: "t1", at: 2), answer("r1", to: "t1", at: 3),
            texted("t2", "+1 555 010 0199", at: 4), answer("r2", to: "t2", at: 5),
            texted("t3", "+1 555 010 0142", at: 6), answer("r3a", to: "t3", at: 7), answer("r3b", to: "t3", at: 8),
            texted("t4", "+1 555 010 0199", at: 9), answer("r4", to: "t4", at: 10),
        ]
        for detail in [ActivityDetail.full, .hidden] {
            let folded = try XCTUnwrap(line(transcriptRows(messages, detail: detail)))
            XCTAssertEqual(folded.askers.map(\.name), ["555 010-0142", "555 010-0199"])
            XCTAssertEqual(folded.requestCount, 4)
            XCTAssertEqual(folded.exchanges(of: folded.askers[0]).first?.reply, "Answer to t3\n\nAnswer to t3")
            XCTAssertEqual(folded.exchanges(of: folded.askers[1]).map(\.reply), ["Answer to t4", "Answer to t2"])
        }
    }

    func testATextsAnswerStaysInTheRowBetweenTeammatesRequests() throws {
        let messages = try [receipt("0", at: 1), texted("t1", "+1 555 010 0142", at: 2), answer("r1", to: "t1", at: 3), receipt("1", at: 4)]
        let folded = try XCTUnwrap(line(transcriptRows(messages, detail: .full, showThreads: false)))
        XCTAssertEqual(folded.exchanges.map(\.asker.key), ["bot.b", "phone.sms.555 010-0142", "bot.b"])
    }

    func testWhatIsNotTheLinesAnswerStaysInTheChat() throws {
        let typed = try decode(#"{"id":"u","role":"user","kind":"text","at":2,"text":"Hi"}"#)
        let card = try decode(#"{"id":"k","role":"bot","kind":"options","at":2,"text":"Pick one","requestMessageId":"t1"}"#)
        let other = try answer("o", to: "u0", at: 2)
        let failed = try decode(#"{"id":"f","role":"bot","kind":"activity","at":2,"tool":{"name":"error: network","ok":false},"requestMessageId":"t1"}"#)
        for row in [typed, card, other, failed] {
            let rows = try transcriptRows([texted("t1", "+1 555 010 0142", at: 1), row], detail: .full)
            XCTAssertEqual(rows.count, 2, row.id)
            guard case .incoming = rows[0] else { return XCTFail("the text is the Asked by row: \(row.id)") }
            if case .incoming = rows[1] { XCTFail("\(row.id) stays a row of the chat") }
        }
    }

    // #4122: on a phone-width line the desktop keeps every number whole and
    // lets only the source word give way (HandoffRow.incoming.dom.test.ts
    // "keeps a phone line's number and the count whole on a narrow row")
    func testTheSourceWordGivesWayBeforeAName() {
        let tries = NamesLineFit.attempts(total: 2, compactable: true)
        XCTAssertEqual(tries.map(\.shown), [2, 2, 1, 1])
        XCTAssertEqual(tries.map(\.compact), [false, true, false, true])
        XCTAssertEqual(NamesLineFit.attempts(total: 2, compactable: false).map(\.shown), [2, 1])
    }

    func testTheNumberIsTheWordsAfterTheSource() {
        XCTAssertEqual(NamesLineFit.detail(name: "Text Message (555 010-0142)", lead: "Text Message"), "(555 010-0142)")
        XCTAssertEqual(NamesLineFit.detail(name: "Texto (555 010-0142)", lead: "Texto"), "(555 010-0142)")
        XCTAssertNil(NamesLineFit.detail(name: "Text Message", lead: "Text Message"))
        XCTAssertNil(NamesLineFit.detail(name: "Bot B", lead: "Text Message"))
    }
}
