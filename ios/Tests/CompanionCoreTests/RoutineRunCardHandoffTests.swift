// 2026-11-04 / #2008: a routine run's card shows the teammates it handed
// work to, and every status pill matches the desktop wording
// (routines.status.*, routines.goal.*, routineRun.card.done).
import XCTest
@testable import CompanionCore

final class RoutineRunCardHandoffTests: XCTestCase {
    func testDecodesHandoffsAndNothingToReport() throws {
        let json = #"{"runId":"r","routineId":"rt","routineName":"Close past meetings","status":"nothing_to_report","handedTo":[{"botId":"nova","threadId":"t1","name":"Nova","status":"completed"}]}"#
        let card = try JSONDecoder().decode(RoutineRunCard.self, from: Data(json.utf8))
        XCTAssertEqual(card.knownStatus, .nothingToReport)
        XCTAssertEqual(card.stateLabel, "Nothing to report")
        XCTAssertEqual(card.handedTo, [RoutineRunCard.Handoff(botId: "nova", threadId: "t1", name: "Nova", status: "completed")])
    }

    func testDoneRunReadsDoneAndOddHandoffsCostOnlyThatField() throws {
        let done = try JSONDecoder().decode(RoutineRunCard.self, from: Data(#"{"runId":"r","routineId":"rt","routineName":"Brief","status":"completed","handedTo":"x"}"#.utf8))
        XCTAssertEqual(done.stateLabel, "Done")
        XCTAssertTrue(done.handedTo.isEmpty)
    }

    func testStatusPillsMatchDesktopWording() throws {
        func label(_ status: String, goal: String? = nil, deferred: Double? = nil, problems: String? = nil) -> String {
            RoutineRunCard(
                runId: "r", routineId: "t", routineName: "N", status: status,
                deferredAt: deferred, goalStatus: goal, problems: problems
            ).stateLabel
        }
        XCTAssertEqual(label("running"), "Running")
        XCTAssertEqual(label("failed"), "Failed")
        XCTAssertEqual(label("queued"), "Queued")
        XCTAssertEqual(label("queued", deferred: 1), "Deferred: target busy")
        XCTAssertEqual(label("waiting"), "Waiting")
        XCTAssertEqual(label("cancelled"), "Cancelled")
        XCTAssertEqual(label("missed"), "Missed")
        XCTAssertEqual(label("completed", problems: "step left open"), "Completed with problems")
        XCTAssertEqual(label("completed", goal: "needs-input"), "Needs your input")
        XCTAssertEqual(label("completed", goal: "blocked"), "Blocked")
        XCTAssertEqual(label("completed", goal: "limit-reached"), "Turn limit reached")
        XCTAssertEqual(label("running", goal: "paused"), "Paused")
        XCTAssertEqual(label("completed", goal: "stopped"), "Stopped")
        XCTAssertEqual(label("completed", goal: "failed"), "Failed")
        let decoded = try JSONDecoder().decode(
            RoutineRunCard.self,
            from: Data(#"{"runId":"r","routineId":"rt","routineName":"Sweep","status":"completed","problems":"  left open  "}"#.utf8)
        )
        XCTAssertEqual(decoded.problems, "  left open  ")
        XCTAssertEqual(decoded.stateLabel, "Completed with problems")
        XCTAssertEqual(decoded.tone, .attention)
    }
}
