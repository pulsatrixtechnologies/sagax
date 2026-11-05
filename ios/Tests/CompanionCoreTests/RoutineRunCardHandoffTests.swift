// 2026-11-04: a routine run's card shows the teammates it handed work to,
// and a finished run reads Done or Nothing to report, as on desktop.
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
}
