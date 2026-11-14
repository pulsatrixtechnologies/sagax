// The routine editor's schedule, as the desktop's EventEditor builds it
// (src/components/RoutineCalendarPage.tsx, matrix AU12, AU13).
//
// One value type holds what the Repeat picker and its fields show; it
// validates exactly as the desktop does and produces the schedule to save.
// Since 2026-10-29 a repeating schedule is picked in words (every hour, day,
// weekday, certain days, month or year, at one or more times, in a named
// zone: RoutineScheduleModel) and saved as cron; a cron no choice can say
// stays as it is under Advanced.
// The phone's editor binds to it, so the rules live here, tested, and any
// layout (iPhone sheet, a future iPad panel) shows the same thing.
import Foundation

/// The Repeats picker, in its order (2026-10-29: a schedule is picked in
/// words, cron stays under the hood).
public enum RoutineRecurrence: String, CaseIterable, Hashable, Sendable {
    /// "Does not repeat".
    case none
    case hourly
    case daily
    case weekdays
    /// Certain days of the week.
    case days
    case monthly
    case yearly
    /// "Every N minutes or hours", with days, hours and an end date.
    case interval
    /// A cron schedule no choice above can say: kept as it is.
    case advanced
    /// "When a webhook arrives" (2026-10-29): the routine's own webhook
    /// starts it. A bot routine only.
    case webhook
    /// "When email arrives": shown only for a routine that already starts
    /// that way, kept as it is.
    case email
    /// "When something changes in a product" (#4250): the watched resources
    /// (`perspicax://...`). Offered on a server linked to Perspicax and
    /// kept for a routine that already starts that way, as on the desktop.
    case product

    /// The model frequency behind a choice, nil for once, interval and advanced.
    public var frequency: RoutineScheduleFrequency? {
        switch self {
        case .hourly: .hourly
        case .daily: .daily
        case .weekdays: .weekdays
        case .days: .days
        case .monthly: .monthly
        case .yearly: .yearly
        case .none, .interval, .advanced, .webhook, .email, .product: nil
        }
    }

    /// Started by a webhook, an email or a product change instead of the clock.
    public var isTrigger: Bool { self == .webhook || self == .email || self == .product }

    /// Repeats on the clock: what timing, overlap, auto pause, continuity
    /// and a watch apply to.
    public var repeatsOnClock: Bool { self != .none && !isTrigger }

    public init(_ frequency: RoutineScheduleFrequency) {
        switch frequency {
        case .hourly: self = .hourly
        case .daily: self = .daily
        case .weekdays: self = .weekdays
        case .days: self = .days
        case .monthly: self = .monthly
        case .yearly: self = .yearly
        case .every: self = .interval
        }
    }
}

/// "Timing" of a repeating routine (RoutineTimingFields.tsx).
public enum RoutineTimingMode: String, CaseIterable, Hashable, Sendable {
    /// Starts at the scheduled time.
    case exact
    /// Starts somewhere in a window around the scheduled time.
    case flexible
}

/// "On": which days an interval runs.
public enum RoutineIntervalDays: String, CaseIterable, Hashable, Sendable {
    case everyDay = "every-day"
    case weekdays
    case custom
}

public struct RoutineScheduleForm: Hashable, Sendable {
    public static let allDays = [0, 1, 2, 3, 4, 5, 6]
    public static let workWeek = [1, 2, 3, 4, 5]
    public static let intervalPresets = [5, 10, 15, 30, 60]
    /// "Every N hours" presets of the interval.
    public static let intervalHourPresets = [1, 2, 3, 4, 6, 8, 12]

    public var recurrence: RoutineRecurrence
    /// The start: the date and time of a one-time run.
    public var at: Date
    /// What the frequency fields hold (hourly to yearly).
    public var model: RoutineScheduleModel
    /// The IANA zone the times are read in (the person's own by default).
    public var timeZone: String
    /// Minutes between interval runs; nil while the custom field is empty.
    public var intervalMinutes: Int?
    /// Whether the interval is said in minutes or in hours.
    public var intervalUnit: RoutineScheduleEveryUnit
    public var intervalDays: RoutineIntervalDays
    /// The custom interval days; may be empty (then invalid).
    public var intervalWeekdays: [Int]
    /// "During": nil is all day.
    public var windowCustom: Bool
    public var windowStart: String
    public var windowEnd: String
    /// "Ends": on a date (the end of that local day), or never.
    public var endsOnDate: Bool
    public var endDate: Date
    /// "Timing": exact or flexible, for a repeating routine only.
    public var timing: RoutineTimingMode
    /// Flexible: minutes before the scheduled time (default 15).
    public var earlyMinutes: Int
    /// Flexible: minutes after; 0 means ready by the scheduled time.
    public var lateMinutes: Int
    /// "Watched resources" of a product change trigger: one URI per line
    /// (the desktop's ProductDraft).
    public var productResources: String

    public static let defaultEarlyMinutes = 15
    public static let defaultLateMinutes = 15

    /// The schedule the editor opened, nil for a new routine.
    public let original: RoutineSchedule?
    public let openedAt: Date
    public let calendar: Calendar
    /// The schedule fields as they opened: until they differ, a daily or
    /// cron schedule is kept exactly as it was.
    private let opened: Snapshot

    struct Snapshot: Hashable, Sendable {
        var recurrence: RoutineRecurrence
        var model: RoutineScheduleModel
        var timeZone: String
        var intervalMinutes: Int?
        var intervalDays: RoutineIntervalDays
        var intervalWeekdays: [Int]
        var windowCustom: Bool
        var windowStart: String
        var windowEnd: String
        var endsOnDate: Bool
        var endDate: Date
        var productResources: String
    }

    private var snapshot: Snapshot {
        Snapshot(recurrence: recurrence, model: model, timeZone: timeZone, intervalMinutes: intervalMinutes,
                 intervalDays: intervalDays, intervalWeekdays: intervalWeekdays, windowCustom: windowCustom,
                 windowStart: windowStart, windowEnd: windowEnd, endsOnDate: endsOnDate, endDate: endDate,
                 productResources: productResources)
    }

    /// The person touched the schedule.
    public var scheduleChanged: Bool { snapshot != opened }

    /// `seedAt`: when the routine would next run (or the next hour for a new one).
    public init(schedule: RoutineSchedule?, seedAt: Date, now: Date = Date(), calendar: Calendar = .current) {
        self.original = schedule
        self.openedAt = now
        self.calendar = calendar
        let initialAt: Date
        switch schedule?.type {
        case .once?: initialAt = schedule?.at.map { Date(timeIntervalSince1970: $0 / 1_000) } ?? seedAt
        case .daily?: initialAt = Self.atLocalTime(seedAt, schedule?.time ?? "09:00", calendar: calendar)
        case .interval?: initialAt = schedule?.anchorAt.map { Date(timeIntervalSince1970: Double($0) / 1_000) } ?? seedAt
        default: initialAt = seedAt
        }
        at = initialAt
        let zone = schedule?.type == .cron ? (schedule?.timeZone).flatMap { $0.isEmpty ? nil : $0 } : nil
        timeZone = zone ?? calendar.timeZone.identifier
        let read = Self.model(for: schedule)
        var model = read ?? Self.defaultModel(at: initialAt, calendar: calendar)
        recurrence = Self.recurrence(for: schedule, at: initialAt, calendar: calendar)
        // an interval cron ("*/15 * * * *") opens in the interval fields
        let everyCron = read?.frequency == .every ? read : nil
        if everyCron != nil { model = Self.defaultModel(at: initialAt, calendar: calendar) }
        self.model = model
        let interval = schedule?.type == .interval ? schedule : nil
        if let everyCron {
            intervalMinutes = everyCron.every * (everyCron.unit == .hours ? 60 : 1)
            intervalUnit = everyCron.unit
        } else {
            let minutes = interval?.everyMinutes ?? 15
            intervalMinutes = minutes
            intervalUnit = minutes >= 60 && minutes % 60 == 0 ? .hours : .minutes
        }
        intervalDays = Self.intervalDayChoice(interval)
        intervalWeekdays = (interval?.weekdays).flatMap { $0.isEmpty ? nil : $0 } ?? Self.allDays
        windowCustom = interval?.window != nil
        windowStart = interval?.window?.start ?? "09:00"
        windowEnd = interval?.window?.end ?? "17:00"
        endsOnDate = interval?.endsAt != nil
        if let endsAt = interval?.endsAt {
            endDate = Date(timeIntervalSince1970: Double(endsAt) / 1_000)
        } else {
            let start = calendar.startOfDay(for: max(now, initialAt))
            endDate = calendar.date(byAdding: .day, value: 7, to: start) ?? start
        }
        // `readTiming`: a flexible repeating schedule keeps its window
        if let schedule, schedule.type != .once, schedule.timing == "flexible" {
            timing = .flexible
            earlyMinutes = schedule.windowEarlyMinutes ?? Self.defaultEarlyMinutes
            lateMinutes = schedule.windowLateMinutes ?? Self.defaultLateMinutes
        } else {
            timing = .exact
            earlyMinutes = Self.defaultEarlyMinutes
            lateMinutes = Self.defaultLateMinutes
        }
        productResources = (schedule?.isProductEvent == true ? schedule?.resources : nil)?.joined(separator: "\n") ?? ""
        opened = Snapshot(recurrence: recurrence, model: self.model, timeZone: timeZone, intervalMinutes: intervalMinutes,
                          intervalDays: intervalDays, intervalWeekdays: intervalWeekdays, windowCustom: windowCustom,
                          windowStart: windowStart, windowEnd: windowEnd, endsOnDate: endsOnDate, endDate: endDate,
                 productResources: productResources)
    }

    // MARK: Reading a schedule

    /// The model a daily or cron schedule is, nil for anything else.
    public static func model(for schedule: RoutineSchedule?) -> RoutineScheduleModel? {
        switch schedule?.type {
        case .daily?: RoutineScheduleModel.from(time: schedule?.time ?? "", weekdays: schedule?.weekdays)
        case .cron?: RoutineScheduleModel.from(cron: schedule?.expression ?? "")
        default: nil
        }
    }

    /// A new schedule's fields: the time of the start, its day and month.
    static func defaultModel(at: Date, calendar: Calendar) -> RoutineScheduleModel {
        let parts = calendar.dateComponents([.month, .day], from: at)
        return RoutineScheduleModel(
            times: [clock(at, calendar: calendar)],
            monthDay: .day(parts.day ?? 1),
            month: parts.month ?? 1
        )
    }

    public static func recurrence(for schedule: RoutineSchedule?, at: Date, calendar: Calendar = .current) -> RoutineRecurrence {
        guard let schedule else { return .none }
        switch schedule.type {
        case .once, .unknown: return .none
        case .webhook: return .webhook
        case .event: return schedule.isProductEvent ? .product : .email
        case .interval: return .interval
        case .daily: return RoutineRecurrence(model(for: schedule)?.frequency ?? .daily)
        case .cron: return model(for: schedule).map { RoutineRecurrence($0.frequency) } ?? .advanced
        }
    }

    static func intervalDayChoice(_ schedule: RoutineSchedule?) -> RoutineIntervalDays {
        guard let days = schedule?.weekdays, days.count != 7 else { return .everyDay }
        return days == workWeek ? .weekdays : .custom
    }

    // MARK: Edits

    /// What a recurrence change does beside switching (`selectRecurrence`).
    /// The interval's default 30-minute run limit is the editor's to apply.
    public mutating func select(_ choice: RoutineRecurrence) {
        if let frequency = choice.frequency {
            model.frequency = frequency
            if model.times.isEmpty { model.times = [Self.clock(at, calendar: calendar)] }
        }
        recurrence = choice
    }

    /// "Choose a simple schedule" under Advanced: every day, at the time
    /// of the schedule's next run.
    public mutating func chooseSimpleSchedule() {
        var time = Self.clock(at, calendar: calendar)
        if let next = preview?.runs.first {
            var zoned = calendar
            zoned.timeZone = TimeZone(identifier: timeZone) ?? calendar.timeZone
            time = Self.clock(next, calendar: zoned)
        }
        model = RoutineScheduleModel(frequency: .daily, times: [time], monthDay: model.monthDay, month: model.month)
        recurrence = .daily
    }

    /// "+ Add a time": the next free hour after the last one, at the same
    /// minutes as the last one (each time may then take its own minutes).
    public mutating func addTime() {
        let times = RoutineScheduleModel.normalizeTimes(model.times).compactMap(RoutineScheduleModel.parseClock)
        guard let last = times.last else {
            model.times = ["09:00"]
            return
        }
        let used = Set(times.map(\.hour))
        let free = ((last.hour + 1)..<24).first { !used.contains($0) } ?? (0..<last.hour).reversed().first { !used.contains($0) }
        guard let hour = free else { return }
        model.times = RoutineScheduleModel.normalizeTimes(model.times + [RoutineScheduleModel.clock(hour, last.minute)])
    }

    public mutating func removeTime(at index: Int) {
        guard model.times.indices.contains(index), model.times.count > 1 else { return }
        model.times.remove(at: index)
    }

    /// Certain days: a day on or off (none left is a problem to show).
    public mutating func toggleModelWeekday(_ day: Int) {
        if model.weekdays.contains(day) { model.weekdays.removeAll { $0 == day } }
        else { model.weekdays = (model.weekdays + [day]).sorted() }
    }

    /// The interval in its unit (15 minutes, 2 hours).
    public var intervalCount: Int? {
        guard let minutes = intervalMinutes else { return nil }
        return intervalUnit == .hours ? minutes / 60 : minutes
    }

    public mutating func setIntervalCount(_ count: Int?) {
        intervalMinutes = count.map { intervalUnit == .hours ? $0 * 60 : $0 }
    }

    /// Minutes or hours: the count is kept when it still fits, else the
    /// first sensible step of that unit.
    public mutating func selectIntervalUnit(_ unit: RoutineScheduleEveryUnit) {
        guard unit != intervalUnit else { return }
        intervalUnit = unit
        if unit == .hours {
            let minutes = intervalMinutes ?? 0
            intervalMinutes = minutes >= 60 && minutes % 60 == 0 ? minutes : 60
        } else if (intervalMinutes ?? 0) > 60 {
            intervalMinutes = 15
        }
    }

    public mutating func selectIntervalDays(_ choice: RoutineIntervalDays) {
        if choice == .custom && intervalDays != .custom {
            intervalWeekdays = intervalDays == .weekdays ? Self.workWeek : Self.allDays
        }
        intervalDays = choice
    }

    public mutating func toggleIntervalWeekday(_ day: Int) {
        if intervalWeekdays.contains(day) { intervalWeekdays.removeAll { $0 == day } }
        else { intervalWeekdays = (intervalWeekdays + [day]).sorted() }
    }

    // MARK: Product change (#4250, shared/routine-product-event.ts)

    public static let productResourcePrefix = "perspicax://"
    /// As many as a trigger's filter holds.
    public static let productResourcesMax = 20
    public static let productResourceMaxChars = 200

    /// The URIs of the field: one per line or comma, trimmed, empty dropped
    /// (the desktop's draftUris).
    public static func productURIs(_ text: String) -> [String] {
        text.split(whereSeparator: { $0 == "\n" || $0 == "," || $0 == "\r" || $0 == "\r\n" })
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    /// The watched URIs to save, deduplicated, or nil when the desktop's
    /// cleanProductEventSchedule would refuse them.
    public static func cleanProductResources(_ text: String) -> [String]? {
        var resources: [String] = []
        for uri in productURIs(text) {
            guard uri.lowercased().hasPrefix(productResourcePrefix), uri.count <= productResourceMaxChars,
                  uri.rangeOfCharacter(from: .whitespacesAndNewlines) == nil,
                  uri.rangeOfCharacter(from: CharacterSet(charactersIn: "{}")) == nil else { return nil }
            if !resources.contains(uri) { resources.append(uri) }
        }
        guard !resources.isEmpty, resources.count <= productResourcesMax else { return nil }
        return resources
    }

    // MARK: Validation (the desktop's messages)

    /// The original, kept as it was while the schedule is untouched (a
    /// daily or cron schedule; an interval is rebuilt with its phase).
    var keptOriginal: RoutineSchedule? {
        guard !scheduleChanged, let original, original.type == .daily || original.type == .cron else { return nil }
        return original
    }

    public var intervalInvalid: Bool {
        keptOriginal == nil && recurrence == .interval && !(5...1_440).contains(intervalMinutes ?? 0)
    }

    public var intervalDaysInvalid: Bool {
        keptOriginal == nil && recurrence == .interval && intervalDays == .custom && intervalWeekdays.isEmpty
    }

    public var windowInvalid: Bool {
        guard keptOriginal == nil, recurrence == .interval, windowCustom else { return false }
        guard let start = Self.clockMinutes(windowStart), let end = Self.clockMinutes(windowEnd) else { return true }
        return end - start < max(intervalMinutes ?? 0, 0)
    }

    var originalInterval: (everyMinutes: Int, anchorAt: Int64)? {
        guard let original, original.type == .interval, let every = original.everyMinutes, let anchor = original.anchorAt else { return nil }
        return (every, anchor)
    }

    /// The earliest allowed end: the first run after the editor opened.
    public var endMinimum: Date {
        Self.nextIntervalForSave(now: openedAt, everyMinutes: max(5, intervalMinutes ?? 5), current: originalInterval)
    }

    public var endsAt: Int64? {
        guard endsOnDate else { return nil }
        // An end set elsewhere (an agent, the API) need not be the end of a
        // day: the same day picked again keeps it exactly.
        if let original, original.type == .interval, let kept = original.endsAt,
           calendar.isDate(Date(timeIntervalSince1970: Double(kept) / 1_000), inSameDayAs: endDate) {
            return kept
        }
        return Self.endOfLocalDate(endDate, calendar: calendar)
    }

    public var endInvalid: Bool {
        guard keptOriginal == nil, recurrence == .interval, endsOnDate, let endsAt else { return false }
        return Double(endsAt) < endMinimum.timeIntervalSince1970 * 1_000
    }

    /// A schedule said in cron (a model or Advanced): what to save, its
    /// next three runs, or what is wrong.
    public struct CronValue: Equatable, Sendable {
        public var schedule: RoutineSchedule?
        /// The expression the runs and the sentence are read from.
        public var expression: String?
        public var timeZone: String
        public var runs: [Date]
        public var problem: Problem?
    }

    /// Nil for once and for a changed interval.
    public var preview: CronValue? {
        if let kept = keptOriginal {
            let expression: String?
            let zone: String
            if kept.type == .cron {
                expression = kept.expression
                zone = kept.timeZone ?? timeZone
            } else {
                expression = try? model.cron().get()
                zone = calendar.timeZone.identifier
            }
            let runs = expression.flatMap { try? CronExpression(expression: $0, timeZone: zone) }?.nextRuns(after: openedAt, count: 3) ?? []
            return CronValue(schedule: kept, expression: expression, timeZone: zone, runs: runs, problem: nil)
        }
        guard recurrence.frequency != nil else { return nil }
        switch model.cron() {
        case let .failure(problem):
            return CronValue(schedule: nil, expression: nil, timeZone: timeZone, runs: [], problem: .schedule(problem))
        case let .success(expression):
            do {
                let normalized = try CronExpression.normalized(.cron(expression: expression, timeZone: timeZone), after: openedAt)
                let cron = try CronExpression(expression: normalized.expression ?? "", timeZone: normalized.timeZone ?? "")
                return CronValue(schedule: normalized, expression: cron.expression, timeZone: cron.zoneName,
                                 runs: cron.nextRuns(after: openedAt, count: 3), problem: nil)
            } catch {
                return CronValue(schedule: nil, expression: expression, timeZone: timeZone, runs: [], problem: .cron(error.localizedDescription))
            }
        }
    }

    /// What is wrong, in the desktop's order; nil when valid.
    public enum Problem: Hashable, Sendable {
        /// "Choose a whole number from 5 to 1,440 minutes."
        case intervalRange
        /// "Choose at least one day."
        case noDays
        /// "Choose a same-day window at least N minutes long."
        case window(minutes: Int)
        /// "Choose an end date after the first run."
        case endDate
        /// The frequency fields cannot make a schedule.
        case schedule(RoutineScheduleModel.Problem)
        /// The cron calculator's message (`CronExpression.Failure`).
        case cron(String)
        /// A product change trigger without a valid watched address.
        case productResources

        public var message: String {
            switch self {
            case .intervalRange: "Choose a whole number from 5 to 1,440 minutes."
            case .noDays, .schedule(.noDays): "Choose at least one day."
            case let .window(minutes): "Choose a same-day window at least \(minutes) minutes long."
            case .endDate: "Choose an end date after the first run."
            case .schedule(.noTime): "Add at least one time."
            case .schedule(.badTime): "Choose a valid time."
            case let .cron(message): message
            case .productResources: "Enter at least one watched address (perspicax://...), with any {...} part filled in."
            }
        }
    }

    public var problem: Problem? {
        if recurrence == .product, Self.cleanProductResources(productResources) == nil { return .productResources }
        if intervalInvalid { return .intervalRange }
        if intervalDaysInvalid { return .noDays }
        if windowInvalid { return .window(minutes: (intervalMinutes ?? 0) == 0 ? 5 : intervalMinutes ?? 5) }
        if endInvalid { return .endDate }
        if let problem = preview?.problem { return problem }
        return nil
    }

    public var isValid: Bool { problem == nil }

    // MARK: Saving

    /// The schedule to send: a model or Advanced as cron in its zone, the
    /// interval with its days, window and end date written out (nil there
    /// means "clear it": `RoutinePatch` sends null). An untouched daily or
    /// cron schedule is sent back exactly as it was.
    public func schedule(savedAt: Date) throws -> RoutineSchedule {
        Self.withTiming(try baseSchedule(savedAt: savedAt), mode: timing, early: earlyMinutes, late: lateMinutes)
    }

    /// `withRoutineTiming`: a one-time schedule carries no timing; an exact
    /// repeating one names "exact" so a flexible routine can be turned back;
    /// a flexible one keeps its whole, non-negative minutes.
    public static func withTiming(_ schedule: RoutineSchedule, mode: RoutineTimingMode, early: Int, late: Int) -> RoutineSchedule {
        var timed = schedule
        timed.windowEarlyMinutes = nil
        timed.windowLateMinutes = nil
        // a one-time run carries no timing, nor does a trigger (the server
        // takes `{ type: "webhook" }` as it is)
        guard schedule.type != .once, !schedule.isTrigger else {
            timed.timing = nil
            return timed
        }
        guard mode == .flexible else {
            timed.timing = RoutineTimingMode.exact.rawValue
            return timed
        }
        timed.timing = RoutineTimingMode.flexible.rawValue
        timed.windowEarlyMinutes = early >= 0 ? early : defaultEarlyMinutes
        timed.windowLateMinutes = late >= 0 ? late : defaultLateMinutes
        return timed
    }

    private func baseSchedule(savedAt: Date) throws -> RoutineSchedule {
        if let problem { throw RoutineScheduleError(problem.message) }
        if recurrence != .none, let kept = keptOriginal { return kept }
        switch recurrence {
        case .interval:
            let minutes = intervalMinutes ?? 15
            if let endsAt, Double(endsAt) < Self.nextIntervalForSave(now: savedAt, everyMinutes: minutes, current: originalInterval).timeIntervalSince1970 * 1_000 {
                throw RoutineScheduleError("Choose an end date after the first run.")
            }
            let anchor = Self.intervalAnchorForSave(now: savedAt, everyMinutes: minutes, current: originalInterval)
            var schedule = RoutineSchedule(type: .interval, everyMinutes: minutes, anchorAt: Int64((anchor.timeIntervalSince1970 * 1_000).rounded()))
            switch intervalDays {
            case .everyDay: schedule.weekdays = nil
            case .weekdays: schedule.weekdays = Self.workWeek
            case .custom: schedule.weekdays = intervalWeekdays.sorted()
            }
            schedule.window = windowCustom ? RoutineIntervalWindow(start: windowStart, end: windowEnd) : nil
            schedule.endsAt = endsAt
            return schedule
        case .none:
            return .init(type: .once, at: exactAt)
        case .webhook:
            return .init(type: .webhook)
        case .email:
            guard let original, original.type == .event else { throw RoutineScheduleError("Choose a valid schedule.") }
            return original
        case .product:
            guard let resources = Self.cleanProductResources(productResources) else {
                throw RoutineScheduleError(Problem.productResources.message)
            }
            return .productEvent(resources: resources)
        case .hourly, .daily, .weekdays, .days, .monthly, .yearly, .advanced:
            guard let schedule = preview?.schedule else { throw RoutineScheduleError("Choose a valid schedule.") }
            return schedule
        }
    }

    /// `at` in epoch ms. Untouched, an existing one-time run keeps its exact
    /// instant (seconds included); a chosen time is on the minute.
    var exactAt: Double {
        if let original, original.type == .once, let originalAt = original.at,
           Int64(originalAt.rounded() / 1_000) == Int64(at.timeIntervalSince1970.rounded()) {
            return originalAt
        }
        let minute = calendar.dateInterval(of: .minute, for: at)?.start ?? at
        return (minute.timeIntervalSince1970 * 1_000).rounded()
    }

    // MARK: Helpers (src/lib/routine-calendar.ts)

    public static func clock(_ date: Date, calendar: Calendar) -> String {
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
    }

    public static func clockMinutes(_ text: String) -> Int? {
        let parts = text.split(separator: ":")
        guard parts.count == 2, let hour = Int(parts[0]), let minute = Int(parts[1]),
              (0..<24).contains(hour), (0..<60).contains(minute) else { return nil }
        return hour * 60 + minute
    }

    public static func atLocalTime(_ day: Date, _ time: String, calendar: Calendar) -> Date {
        let minutes = clockMinutes(time) ?? 9 * 60
        return calendar.date(bySettingHour: minutes / 60, minute: minutes % 60, second: 0, of: day) ?? day
    }

    /// The next whole hour from now, where a new routine starts.
    public static func nextHour(after now: Date = Date(), calendar: Calendar = .current) -> Date {
        let later = now.addingTimeInterval(3_600)
        return calendar.dateInterval(of: .hour, for: later)?.start ?? later
    }

    public static func endOfLocalDate(_ date: Date, calendar: Calendar) -> Int64 {
        let start = calendar.startOfDay(for: date)
        let end = calendar.date(byAdding: DateComponents(day: 1, nanosecond: -1_000_000), to: start) ?? start
        return Int64((end.timeIntervalSince1970 * 1_000).rounded())
    }

    /// A new interval starts at least one full cadence from now, on a clean minute.
    public static func nextIntervalAnchor(now: Date, everyMinutes: Int) -> Date {
        let ms = now.timeIntervalSince1970 * 1_000 + Double(everyMinutes) * 60_000
        return Date(timeIntervalSince1970: (ms / 60_000).rounded(.up) * 60)
    }

    public static func intervalAnchorForSave(now: Date, everyMinutes: Int, current: (everyMinutes: Int, anchorAt: Int64)?) -> Date {
        if let current, current.everyMinutes == everyMinutes {
            return Date(timeIntervalSince1970: Double(current.anchorAt) / 1_000)
        }
        return nextIntervalAnchor(now: now, everyMinutes: everyMinutes)
    }

    /// The next cadence point, keeping the original phase when editing.
    public static func nextIntervalForSave(now: Date, everyMinutes: Int, current: (everyMinutes: Int, anchorAt: Int64)?) -> Date {
        let anchor = intervalAnchorForSave(now: now, everyMinutes: everyMinutes, current: current)
        if anchor > now { return anchor }
        let step = Double(everyMinutes) * 60
        let periods = ((now.timeIntervalSince1970 - anchor.timeIntervalSince1970) / step).rounded(.down) + 1
        return anchor.addingTimeInterval(periods * step)
    }
}
