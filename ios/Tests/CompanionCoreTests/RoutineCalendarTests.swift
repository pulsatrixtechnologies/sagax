import Foundation
import XCTest
@testable import CompanionCore

/// WP10: the Automations calendar (AU2-AU4), checked against the desktop's
/// src/lib/routine-calendar.ts rules and the requests RoutineCalendarPage.tsx
/// sends for a calendar creation and a move.
final class RoutineCalendarTests: XCTestCase {
    private var toronto: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Toronto")!
        return calendar
    }

    private func local(_ y: Int, _ m: Int, _ d: Int, _ h: Int = 0, _ min: Int = 0) -> Date {
        toronto.date(from: DateComponents(year: y, month: m, day: d, hour: h, minute: min))!
    }

    private func ms(_ date: Date) -> Double { (date.timeIntervalSince1970 * 1_000).rounded() }

    private func routine(
        _ id: String, _ schedule: RoutineSchedule, enabled: Bool = true, nextRunAt: Date? = nil, createdAt: Date? = nil, bot: String = "b1"
    ) -> Routine {
        Routine(
            id: id, name: "Routine \(id)", prompt: "Do", botId: bot, runOn: "maus", enabled: enabled,
            schedule: schedule, durationMinutes: 45, timeoutMinutes: 20, nextRunAt: nextRunAt.map(ms),
            createdAt: ms(createdAt ?? local(2026, 1, 1)), updatedAt: 1
        )
    }

    private func run(_ id: String, routine: String, at: Date, status: String = "completed", bot: String = "b1") -> RoutineRun {
        RoutineRun(id: id, routineId: routine, routineName: "Routine \(routine)", botId: bot, runOn: "maus",
                   scheduledFor: ms(at), status: status, manual: false, createdAt: ms(at))
    }

    // MARK: Projection

    func testDailyOnceAndIntervalOccurrencesOfADay() {
        let day = local(2026, 10, 5) // a Monday
        let routines = [
            routine("daily", .daily(time: "09:30", weekdays: [1, 3])),
            routine("tuesday", .daily(time: "09:30", weekdays: [2])),
            routine("once", .once(at: local(2026, 10, 5, 14, 5))),
            routine("interval", .interval(everyMinutes: 30, anchorAt: local(2026, 10, 1)), nextRunAt: local(2026, 10, 5, 11)),
            routine("paused", .once(at: local(2026, 10, 5, 8)), enabled: false),
            routine("new", .daily(time: "07:00", weekdays: [1]), createdAt: local(2026, 10, 5, 8)),
        ]
        let items = RoutineCalendar.day(day, routines: routines, runs: [], calendar: toronto)
        XCTAssertEqual(items.map { $0.routine?.id }, ["daily", "interval", "once"])
        XCTAssertEqual(items.map(\.date), [local(2026, 10, 5, 9, 30), local(2026, 10, 5, 11), local(2026, 10, 5, 14, 5)])
        XCTAssertEqual(items.map(\.durationMinutes), [30, 30, 30])
        XCTAssertTrue(items.allSatisfy { $0.id.hasPrefix("plan-") && $0.canMove })
        XCTAssertEqual(RoutineCalendar.day(day, routines: routines, runs: [], botId: "other", calendar: toronto), [])
    }

    func testAReceiptReplacesItsOccurrenceAndFinishedReceiptsAreCapped() {
        let day = local(2026, 10, 5)
        let daily = routine("daily", .daily(time: "09:30", weekdays: [1]))
        var runs = [run("r0", routine: "daily", at: local(2026, 10, 5, 9, 30), status: "failed")]
        for minute in 0..<14 { runs.append(run("old\(minute)", routine: "gone", at: local(2026, 10, 5, 1, minute))) }
        runs.append(run("live", routine: "gone", at: local(2026, 10, 5, 0, 30), status: "running"))
        let items = RoutineCalendar.day(day, routines: [daily], runs: runs, calendar: toronto)
        // The calendar shows plans only: the receipt is a plain occurrence,
        // no run, no status; runs of a deleted routine do not show.
        XCTAssertEqual(items.map(\.routine?.id), ["daily"])
        XCTAssertNil(items[0].run)
        // the receipt logic itself stays for the list
        let all = RoutineCalendar.items(routines: [daily], runs: runs, from: day, to: RoutineCalendar.addDays(day, 1, calendar: toronto), calendar: toronto)
        XCTAssertEqual(all.filter { $0.run?.routineId == "gone" }.count, 13)
    }

    func testCronOccurrencesStartAtTheSchedulersNextRun() throws {
        let cron = routine("cron", .cron(expression: "0 9,15 * * *", timeZone: "America/Toronto"), nextRunAt: local(2026, 10, 5, 15))
        let monday = RoutineCalendar.day(local(2026, 10, 5), routines: [cron], runs: [], calendar: toronto)
        XCTAssertEqual(monday.map(\.date), [local(2026, 10, 5, 15)])
        XCTAssertFalse(monday[0].canMove)
        let tuesday = RoutineCalendar.day(local(2026, 10, 6), routines: [cron], runs: [], calendar: toronto)
        XCTAssertEqual(tuesday.map(\.date), [local(2026, 10, 6, 9), local(2026, 10, 6, 15)])
        let sunday = RoutineCalendar.day(local(2026, 10, 4), routines: [cron], runs: [], calendar: toronto)
        XCTAssertEqual(sunday, [])
    }

    func testOverlapsShareColumns() {
        func item(_ id: String, _ h: Int, _ m: Int, _ duration: Int = 30) -> RoutineCalendarItem {
            RoutineCalendarItem(id: id, at: ms(local(2026, 10, 5, h, m)), durationMinutes: duration, routine: nil, run: nil)
        }
        let layout = RoutineCalendar.pack([item("a", 9, 0), item("b", 9, 10), item("c", 9, 30), item("d", 11, 0)])
        XCTAssertEqual(layout["a"], RoutineCalendarLayout(column: 0, columns: 2))
        XCTAssertEqual(layout["b"], RoutineCalendarLayout(column: 1, columns: 2))
        XCTAssertEqual(layout["c"], RoutineCalendarLayout(column: 0, columns: 2))
        XCTAssertEqual(layout["d"], RoutineCalendarLayout(column: 0, columns: 1))
    }

    func testSlotsSnapToFiveMinutesInsideTheDay() {
        XCTAssertEqual(RoutineCalendar.snapMinutes(9 * 60 + 32.4), 9 * 60 + 30)
        XCTAssertEqual(RoutineCalendar.snapMinutes(-4), 0)
        XCTAssertEqual(RoutineCalendar.snapMinutes(24 * 60), 24 * 60 - 5)
        XCTAssertEqual(RoutineCalendar.slot(day: local(2026, 10, 5), minutes: 14 * 60 + 33, calendar: toronto), local(2026, 10, 5, 14, 35))
    }

    // MARK: Moving

    func testMovingRewritesTheScheduleLikeTheDesktop() throws {
        let from = local(2026, 10, 5, 9, 30) // Monday
        let to = local(2026, 10, 7, 16, 45) // Wednesday
        XCTAssertEqual(try RoutineCalendar.schedule(.once(at: from), movingOccurrence: from, to: to, calendar: toronto).at, ms(to))
        let daily = try RoutineCalendar.schedule(.daily(time: "09:30", weekdays: [1, 5, 6]), movingOccurrence: from, to: to, calendar: toronto)
        XCTAssertEqual(daily, .daily(time: "16:45", weekdays: [0, 1, 3]))
        var interval = RoutineSchedule.interval(everyMinutes: 30, anchorAt: local(2026, 10, 1))
        interval.window = RoutineIntervalWindow(start: "08:00", end: "18:00")
        interval.weekdays = [1, 2]
        let moved = try RoutineCalendar.schedule(interval, movingOccurrence: from, to: local(2026, 10, 5, 9, 45), calendar: toronto)
        XCTAssertEqual(moved.anchorAt, interval.anchorAt! + 15 * 60_000)
        XCTAssertEqual(moved.window, interval.window)
        XCTAssertEqual(moved.weekdays, [1, 2])
        XCTAssertThrowsError(try RoutineCalendar.schedule(.cron(expression: "0 9 * * *", timeZone: "UTC"), movingOccurrence: from, to: to))
    }

    func testARescheduleSendsTheScheduleAlone() {
        let original = routine("r", .daily(time: "09:30", weekdays: [1]))
        let body = RoutinePatch.body(original: original, input: .rescheduling(original, to: .daily(time: "10:00", weekdays: [2])))
        XCTAssertEqual(Set(body.keys), ["schedule"])
        let schedule = body["schedule"] as? [String: Any]
        XCTAssertEqual(schedule?["type"] as? String, "daily")
        XCTAssertEqual(schedule?["time"] as? String, "10:00")
        XCTAssertEqual(schedule?["weekdays"] as? [Int], [2])
        XCTAssertTrue(RoutinePatch.body(original: original, input: .rescheduling(original, to: original.schedule)).isEmpty)
    }

    func testACalendarSlotCreatesWhatTheQuickComposerSends() {
        let at = local(2026, 10, 5, 14, 30)
        let body = RoutinePatch.createBody(.calendarSlot(name: "Brief", prompt: "Summarize", botId: "b1", at: at))
        XCTAssertEqual(Set(body.keys), ["name", "prompt", "botId", "runOn", "enabled", "schedule", "durationMinutes", "attachments", "resultsThreadId"])
        XCTAssertEqual(body["runOn"] as? String, "maus")
        XCTAssertEqual(body["enabled"] as? Bool, true)
        XCTAssertEqual(body["durationMinutes"] as? Int, 30)
        XCTAssertEqual((body["attachments"] as? [Any])?.count, 0)
        XCTAssertTrue(body["resultsThreadId"] is NSNull)
        let schedule = body["schedule"] as? [String: Any]
        XCTAssertEqual(schedule?["type"] as? String, "once")
        XCTAssertEqual(schedule?["at"] as? Double, ms(at))
    }
}
