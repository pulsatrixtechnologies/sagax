// The Automations calendar (matrix AU2-AU4), ported from the desktop's
// src/lib/routine-calendar.ts: which routine occurrences and run receipts a
// day shows, side-by-side columns for overlaps, the new schedule a moved
// occurrence saves, and the requests a calendar creation and a reschedule
// send (RoutineCalendarPage.tsx QuickComposer, moveEvent).
//
// Layout-free: the phone's day agenda reads it, and so can a wider grid.
import Foundation

public struct RoutineCalendarItem: Hashable, Identifiable, Sendable {
    public var id: String
    /// Epoch milliseconds.
    public var at: Double
    public var durationMinutes: Int
    public var routine: Routine?
    public var run: RoutineRun?

    public init(id: String, at: Double, durationMinutes: Int, routine: Routine?, run: RoutineRun?) {
        self.id = id
        self.at = at
        self.durationMinutes = durationMinutes
        self.routine = routine
        self.run = run
    }

    public var date: Date { Date(timeIntervalSince1970: at / 1_000) }
    public var botId: String? { run?.botId ?? routine?.botId }
    public var name: String { run?.routineName ?? routine?.name ?? "Routine" }

    /// `canMove`: an upcoming occurrence of a routine whose schedule a move
    /// can rewrite; a receipt and a cron routine stay put.
    public var canMove: Bool {
        // AU20: someone else's routine (a wider scope) is read-only
        guard let routine, run == nil, routine.mayEdit else { return false }
        return routine.schedule.type != .cron && routine.schedule.type != .unknown
    }

    /// Moving it moves every occurrence ("Move this entire recurring series?").
    public var recurring: Bool { (routine?.schedule.type ?? .once) != .once }
}

public struct RoutineCalendarLayout: Hashable, Sendable {
    public var column: Int
    public var columns: Int

    public init(column: Int, columns: Int) {
        self.column = column
        self.columns = columns
    }
}

public enum RoutineCalendar {
    /// `CALENDAR_SLOT_MINUTES`.
    public static let slotMinutes = 5
    /// `ROUTINE_MARKER_MINUTES`: a routine shows as a half hour.
    public static let markerMinutes = 30
    static let maxReceiptsPerRoutinePerRange = 12
    static let maxCronProjectionsPerDay = 12

    // MARK: Dates

    public static func startOfDay(_ date: Date, calendar: Calendar = .current) -> Date {
        calendar.startOfDay(for: date)
    }

    public static func addDays(_ date: Date, _ days: Int, calendar: Calendar = .current) -> Date {
        calendar.date(byAdding: .day, value: days, to: date) ?? date
    }

    /// `snapMinutes`: to the 5-minute slot, inside the day.
    public static func snapMinutes(_ minutes: Double, increment: Int = slotMinutes) -> Int {
        let snapped = Int((minutes / Double(increment)).rounded()) * increment
        return max(0, min(24 * 60 - increment, snapped))
    }

    /// `slotAt`: the slot `minutes` into `day`.
    public static func slot(day: Date, minutes: Double, calendar: Calendar = .current) -> Date {
        let snapped = snapMinutes(minutes)
        return calendar.date(bySettingHour: snapped / 60, minute: snapped % 60, second: 0, of: day) ?? day
    }

    /// `calendarRangeLabel` for one day: "October 3, 2026".
    public static func dayLabel(_ day: Date, locale: Locale = .current, calendar: Calendar = .current) -> String {
        var style = Date.FormatStyle(date: .long, time: .omitted)
        style.locale = locale
        style.calendar = calendar
        style.timeZone = calendar.timeZone
        return day.formatted(style)
    }

    // MARK: Projection

    /// `projectedRoutineItems`: the receipts in [from, to) (active ones all,
    /// at most twelve finished ones per routine) and each enabled routine's
    /// upcoming occurrences that have no receipt yet.
    public static func items(
        routines: [Routine], runs: [RoutineRun], from: Date, to: Date, calendar: Calendar = .current
    ) -> [RoutineCalendarItem] {
        let fromMs = from.timeIntervalSince1970 * 1_000
        let toMs = to.timeIntervalSince1970 * 1_000
        let byId = Dictionary(routines.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        var receiptCounts: [String: Int] = [:]
        var items: [RoutineCalendarItem] = []
        let visible = runs
            .filter { $0.scheduledFor >= fromMs && $0.scheduledFor < toMs }
            .sorted { $0.scheduledFor > $1.scheduledFor }
        for run in visible {
            if !["queued", "running", "waiting"].contains(run.status) {
                let count = receiptCounts[run.routineId] ?? 0
                if count >= maxReceiptsPerRoutinePerRange { continue }
                receiptCounts[run.routineId] = count + 1
            }
            items.append(RoutineCalendarItem(
                id: "run-\(run.id)", at: run.scheduledFor, durationMinutes: markerMinutes,
                routine: byId[run.routineId], run: run
            ))
        }

        func hasReceipt(_ routineId: String, _ at: Double) -> Bool {
            runs.contains { $0.routineId == routineId && abs($0.scheduledFor - at) < 60_000 }
        }
        func upcoming(_ routine: Routine, _ at: Double) -> RoutineCalendarItem {
            RoutineCalendarItem(id: "next-\(routine.id)-\(Int64(at.rounded()))", at: at, durationMinutes: markerMinutes, routine: routine, run: nil)
        }

        for routine in routines where routine.enabled {
            let schedule = routine.schedule
            switch schedule.type {
            case .cron:
                guard let nextRunAt = routine.nextRunAt,
                      let cron = try? CronExpression(expression: schedule.expression ?? "", timeZone: schedule.timeZone ?? "")
                else { continue }
                var day = startOfDay(Date(timeIntervalSince1970: max(fromMs, nextRunAt) / 1_000), calendar: calendar)
                while day.timeIntervalSince1970 * 1_000 < toMs {
                    let dayMs = day.timeIntervalSince1970 * 1_000
                    let after = max(dayMs, fromMs, routine.createdAt, nextRunAt) - 1
                    let next = cron.nextRuns(after: Date(timeIntervalSince1970: after / 1_000), count: maxCronProjectionsPerDay)
                    guard let first = next.first, first.timeIntervalSince1970 * 1_000 < toMs else { break }
                    day = startOfDay(first, calendar: calendar)
                    let end = min(toMs, addDays(day, 1, calendar: calendar).timeIntervalSince1970 * 1_000)
                    for date in next {
                        let at = (date.timeIntervalSince1970 * 1_000).rounded()
                        if at >= end { break }
                        if !hasReceipt(routine.id, at) { items.append(upcoming(routine, at)) }
                    }
                    day = addDays(day, 1, calendar: calendar)
                }
            case .once:
                guard let at = schedule.at else { continue }
                if at >= fromMs && at < toMs && !hasReceipt(routine.id, at) { items.append(upcoming(routine, at)) }
            case .interval:
                guard let at = routine.nextRunAt else { continue }
                if at >= fromMs && at < toMs && !hasReceipt(routine.id, at) { items.append(upcoming(routine, at)) }
            case .daily:
                let weekdays = schedule.weekdays ?? []
                var day = startOfDay(from, calendar: calendar)
                while day < to {
                    defer { day = addDays(day, 1, calendar: calendar) }
                    guard weekdays.contains(calendar.component(.weekday, from: day) - 1) else { continue }
                    let at = RoutineScheduleForm.atLocalTime(day, schedule.time ?? "09:00", calendar: calendar).timeIntervalSince1970 * 1_000
                    if at >= fromMs && at < toMs && at >= routine.createdAt && !hasReceipt(routine.id, at) {
                        items.append(upcoming(routine, at))
                    }
                }
            case .unknown:
                continue
            }
        }
        return items.sorted { $0.at < $1.at }
    }

    /// One day's items, for a bot or all of them (the "Filter schedule by bot" select).
    public static func day(
        _ day: Date, routines: [Routine], runs: [RoutineRun], botId: String? = nil, calendar: Calendar = .current
    ) -> [RoutineCalendarItem] {
        let start = startOfDay(day, calendar: calendar)
        return planned(items(routines: routines, runs: runs, from: start, to: addDays(start, 1, calendar: calendar), calendar: calendar))
            .filter { botId == nil || $0.botId == botId }
    }

    /// The calendar shows what was PLANNED, never what ran: a receipt becomes
    /// its plain planned occurrence (no status), a receipt of a deleted
    /// routine goes away, and the history stays in the list view.
    public static func planned(_ items: [RoutineCalendarItem]) -> [RoutineCalendarItem] {
        var seen = Set<String>()
        var out: [RoutineCalendarItem] = []
        for item in items {
            guard let routine = item.routine else { continue }
            let id = "plan-\(routine.id)-\(Int64(item.at.rounded()))"
            if !seen.insert(id).inserted { continue }
            out.append(RoutineCalendarItem(id: id, at: item.at, durationMinutes: item.durationMinutes, routine: routine, run: nil))
        }
        return out
    }

    /// `packCalendarCollisions`: overlapping items share a cluster's column
    /// count; a short item takes at least 15 minutes of room.
    public static func pack(_ items: [RoutineCalendarItem]) -> [String: RoutineCalendarLayout] {
        func visualEnd(_ item: RoutineCalendarItem) -> Double { item.at + Double(max(15, item.durationMinutes)) * 60_000 }
        let sorted = items.sorted {
            if $0.at != $1.at { return $0.at < $1.at }
            if visualEnd($0) != visualEnd($1) { return visualEnd($0) < visualEnd($1) }
            return $0.id < $1.id
        }
        var result: [String: RoutineCalendarLayout] = [:]
        var cursor = 0
        while cursor < sorted.count {
            var cluster: [RoutineCalendarItem] = []
            var clusterEnd = sorted[cursor].at
            while cursor < sorted.count {
                let item = sorted[cursor]
                if !cluster.isEmpty && item.at >= clusterEnd { break }
                cluster.append(item)
                clusterEnd = max(clusterEnd, visualEnd(item))
                cursor += 1
            }
            var columnEnds: [Double] = []
            var assignments: [(String, Int)] = []
            for item in cluster {
                let column = columnEnds.firstIndex { $0 <= item.at } ?? columnEnds.count
                if column == columnEnds.count { columnEnds.append(visualEnd(item)) } else { columnEnds[column] = visualEnd(item) }
                assignments.append((item.id, column))
            }
            let columns = max(1, columnEnds.count)
            for (id, column) in assignments { result[id] = RoutineCalendarLayout(column: column, columns: columns) }
        }
        return result
    }

    // MARK: Moving

    public enum MoveError: Error, Equatable, LocalizedError {
        case cron
        public var errorDescription: String? {
            "Open this routine to edit its repeating schedule and time zone."
        }
    }

    /// `scheduleAt`: the schedule that runs at `nextAt` the occurrence that
    /// ran at `occurrenceAt`. A one-time run moves; a daily one takes the new
    /// time and shifts its weekdays by the days moved; an interval shifts its
    /// anchor and keeps everything else.
    public static func schedule(
        _ schedule: RoutineSchedule, movingOccurrence occurrenceAt: Date, to nextAt: Date, calendar: Calendar = .current
    ) throws -> RoutineSchedule {
        switch schedule.type {
        case .cron, .unknown:
            throw MoveError.cron
        case .once:
            return .once(at: nextAt)
        case .interval:
            var moved = schedule
            let delta = Int64(((nextAt.timeIntervalSince1970 - occurrenceAt.timeIntervalSince1970) * 1_000).rounded())
            moved.anchorAt = (schedule.anchorAt ?? 0) + delta
            return moved
        case .daily:
            let days = (startOfDay(nextAt, calendar: calendar).timeIntervalSince1970
                - startOfDay(occurrenceAt, calendar: calendar).timeIntervalSince1970) / 86_400
            let dayDelta = Int(days.rounded())
            let weekdays = (schedule.weekdays ?? []).map { (($0 + dayDelta) % 7 + 7) % 7 }.sorted()
            return .daily(time: RoutineScheduleForm.clock(nextAt, calendar: calendar), weekdays: weekdays)
        }
    }
}

extension RoutineInput {
    /// The quick creation of a calendar slot (`QuickComposer` save): a
    /// one-time run at the slot, a half hour long, on this computer, with a
    /// dedicated results thread and no attachments.
    public static func calendarSlot(name: String, prompt: String, botId: String, at: Date) -> RoutineInput {
        RoutineInput(
            name: name, prompt: prompt, botId: botId, runOn: "maus", enabled: true,
            schedule: .once(at: at), durationMinutes: RoutineCalendar.markerMinutes,
            attachments: [], results: .newThread
        )
    }

    /// A reschedule (`moveEvent`): the routine unchanged but its schedule, so
    /// the PATCH (`RoutinePatch.body`) carries the schedule alone.
    public static func rescheduling(_ routine: Routine, to schedule: RoutineSchedule) -> RoutineInput {
        RoutineInput(
            name: routine.name, prompt: routine.prompt, botId: routine.botId, runOn: routine.runOn,
            schedule: schedule, durationMinutes: routine.durationMinutes, timeoutMinutes: routine.timeoutMinutes,
            completeSchedule: true
        )
    }
}
