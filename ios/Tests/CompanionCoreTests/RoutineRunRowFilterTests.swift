// #4066: the phone's transcript leaves out the routine run rows the desktop
// chat leaves out (shared/routine-repeat.ts `routineRunRowOutOfChat`, #3990):
// a row that only says how a run went, and a wake's row with nothing for the
// person. The cases are the desktop's own (shared/routine-repeat.test.ts).
import XCTest
@testable import CompanionCore

final class RoutineRunRowFilterTests: XCTestCase {
    private func row(_ run: String, extra: String = "") throws -> Message {
        let json = #"{"id":"m","role":"bot","kind":"routine.run","at":1,"routineRun":{"runId":"r","routineId":"x","routineName":"X",\#(run)}\#(extra)}"#
        return try JSONDecoder().decode(Message.self, from: Data(json.utf8))
    }

    private let attention = #","attention":{"kind":"human","items":[{"text":"decide"}],"botId":"b","botName":"B","threadId":"t","sourceMessageId":"m"}"#

    func testTheRowsTheDesktopLeavesOutLeaveThePhoneChat() throws {
        let out = [
            try row(#""status":"completed","problems":"the mailbox refused the move""#),
            try row(#""status":"completed","problems":"x","repeat":{"firstRunId":"a","count":4,"since":1,"lastAt":2}"#),
            try row(#""status":"completed","recovered":{"afterRuns":2,"since":1}"#),
            try row(#""status":"nothing_to_report","recovered":{"afterRuns":1,"since":1}"#),
            try row(#""status":"nothing_to_report""#),
            try row(#""status":"blocked","error":"signed out""#),
            try row(#""status":"cancelled""#),
            try row(#""status":"completed","summary":"Replied to the teammate.","wakeTopic":"peer""#),
            try row(#""status":"completed","summary":"A new mail from the supplier.","wakeTopic":"email""#),
            try row(#""status":"completed","summary":"Meeting moved to 3 pm.","wakeTopic":"calendar""#),
            try row(#""status":"completed","summary":"All quiet.","wakeTopic":"heartbeat""#),
            try row(#""status":"completed","summary":"Rien à remonter.","wakeTopic":"watch""#),
            try row(#""status":"completed","summary":"The suggestion you accepted.","wakeTopic":"suggestion""#),
        ]
        for message in out {
            XCTAssertTrue(RoutineRunRows.outOfChat(message), "\(String(describing: message.routineRun))")
        }
    }

    func testWhatIsForThePersonStays() throws {
        let kept = [
            try row(#""status":"completed","summary":"Three meetings today.""#),
            // an empty text is no problem and no wake, as on the desktop
            try row(#""status":"completed","summary":"Three meetings today.","problems":"""#),
            try row(#""status":"completed","summary":"Three meetings today.","wakeTopic":"""#),
            try row(#""status":"completed","summary":"The suggestion you accepted.","wakeTopic":"suggestion","forPerson":true"#),
            try row(#""status":"completed","summary":"Your watch found a new ticket.","wakeTopic":"watch","forPerson":true"#),
            try row(#""status":"completed","summary":"Replied to the teammate.","wakeTopic":"peer""#, extra: attention),
            try row(#""status":"completed","summary":"Replied to the teammate.","wakeTopic":"peer","startedBy":"person""#),
            try row(#""status":"completed","problems":"x","repeat":{"firstRunId":"a","count":3,"since":1,"lastAt":2,"streak":true}"#),
            try row(#""status":"completed","recovered":{"afterRuns":4,"since":1,"streak":true}"#),
            try row(#""status":"completed","problems":"x","startedBy":"person""#),
            try row(#""status":"completed","problems":"x""#, extra: attention),
            try row(#""status":"waiting","attention":"Publish?""#),
            try row(#""status":"running""#),
            try row(#""status":"failed","error":"engine""#),
            try row(#""status":"completed","goalStatus":"needs-input""#),
            try row(#""status":"failed","autoPausedAfter":5"#),
        ]
        for message in kept {
            XCTAssertFalse(RoutineRunRows.outOfChat(message), "\(String(describing: message.routineRun))")
        }
        let text = try JSONDecoder().decode(Message.self, from: Data(#"{"id":"t","role":"bot","kind":"text","at":1,"text":"hello"}"#.utf8))
        XCTAssertFalse(RoutineRunRows.outOfChat(text))
    }

    /// The transcript and the bot's last words read the same rule.
    func testTheTranscriptAndTheLastWordsLeaveTheRowOut() throws {
        let answer = try JSONDecoder().decode(Message.self, from: Data(#"{"id":"a","role":"bot","kind":"text","at":1,"text":"Done."}"#.utf8))
        var quiet = try row(#""status":"completed","problems":"the mailbox refused the move""#)
        quiet.id = "q"
        quiet.at = 2
        var result = try row(#""status":"completed","summary":"Three meetings today.""#)
        result.id = "r"
        result.at = 3
        let ids = transcriptRows([answer, quiet, result], detail: .full).flatMap { row -> [String] in
            if case let .message(message) = row { return [message.id] }
            return []
        }
        XCTAssertEqual(ids, ["a", "r"])
        XCTAssertEqual(LiveTextPlace.lastDrawn([answer, quiet])?.id, "a")
    }
}
