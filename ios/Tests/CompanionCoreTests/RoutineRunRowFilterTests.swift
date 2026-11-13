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
            // #4201: a count that is not the streak's summary on a run taken for the person's
            try row(#""status":"completed","problems":"x","startedBy":"person","repeat":{"firstRunId":"a","count":2,"since":1,"lastAt":2}"#),
        ]
        for message in out {
            XCTAssertTrue(RoutineRunRows.outOfChat(message), "\(String(describing: message.routineRun))")
        }
    }

    private func run(_ id: String, _ fields: String) throws -> Message {
        let json = #"{"id":"\#(id)","role":"bot","kind":"routine.run","at":1,"routineRun":{"runId":"\#(id)","routineId":"x","routineName":"X",\#(fields)}}"#
        return try JSONDecoder().decode(Message.self, from: Data(json.utf8))
    }

    /// #4201: the owner's capture, a teammate's run_routine hop stored as the
    /// person's: "Completed with problems", then "2 runs with problems since".
    /// Both cards leave the chat; a lone first card the person started stays.
    func testTheFirstCardLeavesWithTheCountThatNamesIt() throws {
        let first = try run("r1", #""status":"completed","problems":"x","startedBy":"person""#)
        let second = try run("r2", #""status":"completed","problems":"x","startedBy":"person","repeat":{"firstRunId":"r1","count":2,"since":1,"lastAt":2}"#)
        let counted = RoutineRunRows.counted([first, second])
        XCTAssertEqual(counted, ["r1"])
        XCTAssertTrue(RoutineRunRows.outOfChat(first, counted: counted))
        XCTAssertTrue(RoutineRunRows.outOfChat(second, counted: counted))
        XCTAssertNil(LiveTextPlace.lastDrawn([first, second]))
        let own = try run("r3", #""status":"completed","problems":"x","startedBy":"person""#)
        XCTAssertFalse(RoutineRunRows.outOfChat(own, counted: RoutineRunRows.counted([own, second])))
        let summary = try run("r4", #""status":"completed","problems":"x","repeat":{"firstRunId":"r3","count":3,"since":1,"lastAt":2,"streak":true}"#)
        XCTAssertFalse(RoutineRunRows.outOfChat(own, counted: RoutineRunRows.counted([own, summary])))
    }

    /// #4201: a person's Run now stays when the next pass, with problems and
    /// items for the person, names it in a count that is not the summary.
    func testAPersonsRunNowStaysWhenAPassWithItemsNamesIt() throws {
        let mine = try run("r1", #""status":"completed","problems":"x","startedBy":"person""#)
        let json = #"{"id":"r2","role":"bot","kind":"routine.run","at":1\#(attention),"routineRun":{"runId":"r2","routineId":"x","routineName":"X","status":"completed","problems":"x","repeat":{"firstRunId":"r1","count":2,"since":1,"lastAt":2}}}"#
        let itemsRow = try JSONDecoder().decode(Message.self, from: Data(json.utf8))
        let counted = RoutineRunRows.counted([mine, itemsRow])
        XCTAssertTrue(counted.isEmpty)
        XCTAssertFalse(RoutineRunRows.outOfChat(mine, counted: counted))
        XCTAssertFalse(RoutineRunRows.outOfChat(itemsRow, counted: counted))
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
