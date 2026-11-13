// The passing notices (TransientNotices, desktop shared/transient-notices.ts).
// Fixtures/transient-notices.json is the desktop's list; the TypeScript test
// keeps it in step.
import XCTest
@testable import CompanionCore

final class TransientNoticesTests: XCTestCase {
    private struct Fixture: Decodable {
        let routineRunStatuses: [String]
        let routineGoalStatuses: [String]
        let visibleMs: Double
        let freshMs: Double
        let autoPaused: [String]
        let transient: [Message]
        let rows: [Message]
    }

    private func fixture() throws -> Fixture {
        let url = try XCTUnwrap(
            Bundle.module.url(forResource: "transient-notices", withExtension: "json", subdirectory: "Fixtures")
                ?? Bundle.module.url(forResource: "transient-notices", withExtension: "json")
        )
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }

    func testRulesAreTheDesktopList() throws {
        let list = try fixture()
        XCTAssertEqual(TransientNotices.routineRunStatuses, list.routineRunStatuses)
        XCTAssertEqual(TransientNotices.routineGoalStatuses, list.routineGoalStatuses)
        XCTAssertEqual(TransientNotices.visibleMs, list.visibleMs)
        XCTAssertEqual(TransientNotices.freshMs, list.freshMs)
        for message in list.transient { XCTAssertTrue(TransientNotices.isTransient(message), message.id) }
        for message in list.rows { XCTAssertFalse(TransientNotices.isTransient(message), message.id) }
    }

    /// No passing notice leaves a row in the chat, at any detail level.
    func testTransientNoticesLeaveNoRow() throws {
        let list = try fixture()
        for detail in ActivityDetail.allCases {
            let ids = transcriptRows(list.transient + list.rows, detail: detail).map(\.id)
            for message in list.transient { XCTAssertFalse(ids.contains(message.id), "\(message.id) \(detail)") }
            XCTAssertTrue(ids.contains("done"), "\(detail)")
        }
    }

    func testPickShowsEachFreshNoticeOnceAndSettlesAccess() throws {
        let list = try fixture()
        let now: Double = 1_800_000_000_000
        var failed = list.transient[0]; failed.at = now - 1000
        var stale = list.transient[1]; stale.at = now - 10 * 60_000
        var access = list.transient[3]; access.at = now - 500
        XCTAssertEqual(TransientNotices.pick([stale, failed, access], now: now, shown: []).map(\.id), "access")
        XCTAssertEqual(TransientNotices.pick([stale, failed, access], now: now, shown: ["access"]).map(\.id), "failed")
        XCTAssertNil(TransientNotices.pick([stale, failed, access], now: now, shown: ["access", "failed"]))
        var done = list.rows[0]; done.at = now - 100; done.from = Sender(botId: "b1", name: "Ada", color: "teal")
        XCTAssertTrue(TransientNotices.settled(access, in: [access, done]))
        XCTAssertNil(TransientNotices.pick([access, done], now: now, shown: []))
    }

    /// 2026-10-26: the failure that paused its routine offers Resume, a
    /// blocked team goal included, and never settles an access notice.
    func testAutoPausedNoticesAreTheDesktopList() throws {
        let list = try fixture()
        let paused = (list.transient + list.rows).filter(TransientNotices.isRoutineAutoPaused).map(\.id)
        XCTAssertEqual(paused, list.autoPaused)
        let access = try XCTUnwrap(list.transient.first { $0.id == "access" })
        var goal = try XCTUnwrap(list.transient.first { $0.id == "goal-auto-paused" })
        goal.at = access.at + 1000; goal.from = Sender(botId: "b1", name: "Ada", color: "teal")
        XCTAssertFalse(TransientNotices.accessSettled(access, later: [goal][...]))
    }

    /// #4058: a streak's summary stays a row, a failed or pausing run
    /// included, and never settles an access notice.
    func testStreakSummaryIsARow() throws {
        let list = try fixture()
        let access = try XCTUnwrap(list.transient.first { $0.id == "access" })
        for id in ["streak-failed", "streak-auto-paused"] {
            var summary = try XCTUnwrap(list.rows.first { $0.id == id })
            XCTAssertFalse(TransientNotices.isTransient(summary), id)
            XCTAssertFalse(TransientNotices.isRoutineAutoPaused(summary), id)
            summary.at = access.at + 1000; summary.from = Sender(botId: "b1", name: "Ada", color: "teal")
            XCTAssertFalse(TransientNotices.accessSettled(access, later: [summary][...]), id)
        }
    }

    func testMemoryKeepsShownIds() throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "transient-notices-test"))
        defaults.removePersistentDomain(forName: "transient-notices-test")
        let memory = TransientNoticeMemory(defaults: defaults)
        memory.remember("a"); memory.remember("a")
        XCTAssertEqual(memory.shown, ["a"])
        defaults.removePersistentDomain(forName: "transient-notices-test")
    }
}
