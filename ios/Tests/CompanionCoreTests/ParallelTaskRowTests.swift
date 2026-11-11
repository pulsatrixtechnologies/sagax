// #3689, the phone's parallel task row read against the desktop's
// (ParallelTaskCard.tsx): a stopped task is drawn in the neutral ink, only
// a failed one in the danger ink; its elapsed time is written the way the
// desktop writes it (src/lib/working-time.ts `formatElapsed`).
import XCTest
@testable import CompanionCore

final class ParallelTaskRowTests: XCTestCase {
    func testOnlyAFailedTaskIsDrawnInTheDangerInk() {
        XCTAssertEqual(ParallelCardState.failed.stepPhase, .failed)
        XCTAssertEqual(ParallelCardState.stopped.stepPhase, .done)
        XCTAssertEqual(ParallelCardState.done.stepPhase, .done)
        for live: ParallelCardState in [.running, .waiting, .queued] {
            XCTAssertEqual(live.stepPhase, .running)
        }
    }

    func testTheElapsedTimeIsWrittenAsTheDesktopWritesIt() {
        XCTAssertEqual(ParallelCardState.elapsed(ms: 42_400), "42s")
        XCTAssertEqual(ParallelCardState.elapsed(ms: 194_900), "3m 14s")
        XCTAssertEqual(ParallelCardState.elapsed(ms: 3_725_000), "62m 05s")
        XCTAssertEqual(ParallelCardState.elapsed(ms: -5), "0s")
        XCTAssertEqual(ParallelCardState.elapsed(ms: .nan), "0s")
    }
}
