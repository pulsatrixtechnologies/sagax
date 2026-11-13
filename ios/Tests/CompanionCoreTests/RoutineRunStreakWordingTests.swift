// #4066: a streak of runs whose problems differ is no "Same problem since":
// the phone says it as the desktop's card does (src/components/
// RoutineRunCard.tsx `routineRepeatText`): "N runs with problems since"
// for the streak's summary (`streak`) and for a run of any problem
// (`anyProblem`, #3910), "Same problem since" only for one problem lasting.
import XCTest
@testable import CompanionCore

final class RoutineRunStreakWordingTests: XCTestCase {
    private func card(_ `repeat`: String) throws -> RoutineRunCard {
        let json = #"{"runId":"r","routineId":"x","routineName":"X","status":"completed","problems":"x","repeat":\#(`repeat`)}"#
        return try JSONDecoder().decode(RoutineRunCard.self, from: Data(json.utf8))
    }

    func testAStreakOfAnyProblemIsSaidAsAStreak() throws {
        let anyProblem = try card(#"{"firstRunId":"a","count":3,"since":1,"lastAt":2,"anyProblem":true}"#)
        XCTAssertEqual(anyProblem.repeat?.wording, .problemStreak)
        let summary = try card(#"{"firstRunId":"a","count":3,"since":1,"lastAt":2,"streak":true}"#)
        XCTAssertEqual(summary.repeat?.wording, .problemStreak)
    }

    /// The desktop's `routineRunForm` (isProblemStreakCard -> "card") and its
    /// `streakFailed` state line: the streak's summary is a card whatever
    /// its run said, folded or not, and its state line counts the runs for
    /// a failed or blocked run too.
    func testAFailedOrBlockedStreakSummaryIsACardThatCountsItsRuns() throws {
        for status in ["failed", "blocked"] {
            let json = #"{"runId":"r","routineId":"x","routineName":"X","status":"\#(status)","error":"Login refused","repeat":{"count":4,"since":1,"streak":true}}"#
            let summary = try JSONDecoder().decode(RoutineRunCard.self, from: Data(json.utf8))
            XCTAssertTrue(summary.isFailedStreak, status)
            XCTAssertEqual(RoutineResultStack.form(summary, attention: nil, folded: false), .card, status)
            XCTAssertEqual(RoutineResultStack.form(summary, attention: nil, folded: true), .card, status)
            XCTAssertEqual(summary.countedRepeat?.count, 4, status)
            XCTAssertEqual(summary.countedRepeat?.wording, .problemStreak, status)
        }
    }

    /// A failed run that is no streak's summary stays the quiet row, and its
    /// card counts no repeat.
    func testAFailedRunOutsideAStreakStaysARow() throws {
        let json = #"{"runId":"r","routineId":"x","routineName":"X","status":"failed","error":"x","repeat":{"count":4,"since":1}}"#
        let run = try JSONDecoder().decode(RoutineRunCard.self, from: Data(json.utf8))
        XCTAssertFalse(run.isFailedStreak)
        XCTAssertEqual(RoutineResultStack.form(run, attention: nil, folded: false), .row)
        XCTAssertNil(run.countedRepeat)
    }

    func testOneProblemLastingIsTheSameProblem() throws {
        let same = try card(#"{"firstRunId":"a","count":3,"since":1,"lastAt":2}"#)
        XCTAssertEqual(same.repeat?.wording, .sameProblem)
        XCTAssertEqual(same.repeat?.count, 3)
    }
}
