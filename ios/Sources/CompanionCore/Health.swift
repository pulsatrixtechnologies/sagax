import Foundation

// Apple Health on this iPhone (HealthKit, read and write), for the person's
// own bots. The wire contract is shared/phone-tools.ts (health_read and
// health_write, served through the same device link as the phone tools: the
// same requests, the same answer route, the owner-only turn). Everything here
// is pure: the categories, the person's choice, the checks a request passes
// before the phone touches HealthKit, and the shaping of each answer. The
// HealthKit calls live in the app target (Features/Health).
//
// The person's choice is Settings > Santé: which categories a bot may read,
// which it may add, each granted through the HealthKit sheet. Nothing is
// read or written for a category that is not chosen, and neither health tool
// is offered to the server while nothing is chosen. A health request never
// opens a card: the choice, made once, is the consent.

/// The two bot tools, as the server names them.
public enum HealthTool: String, CaseIterable, Codable, Sendable {
    case read = "health_read"
    case write = "health_write"
}

/// What Settings > Santé lets the person open.
public enum HealthCategory: String, CaseIterable, Codable, Sendable, Identifiable {
    case sleep, steps, exercise
    case heartRate = "heart_rate"
    case restingHeartRate = "resting_heart_rate"
    case hrv
    case mindfulMinutes = "mindful_minutes"
    case water, weight, workouts

    public var id: String { rawValue }

    /// A bot may add to these (the others come from the phone or a watch).
    public var canWrite: Bool {
        switch self {
        case .mindfulMinutes, .water, .weight, .workouts: true
        default: false
        }
    }

    /// The unit of a daily value, as the bot reads it.
    public var unit: String {
        switch self {
        case .sleep: "hours"
        case .steps: "count"
        case .exercise, .mindfulMinutes, .workouts: "min"
        case .heartRate, .restingHeartRate: "bpm"
        case .hrv: "ms"
        case .water: "ml"
        case .weight: "kg"
        }
    }

    /// Accumulates over a day (HealthKit adds it up, without counting two
    /// sources twice): only a daily total makes sense.
    public var isCumulative: Bool {
        switch self {
        case .sleep, .steps, .exercise, .mindfulMinutes, .water, .workouts: true
        case .heartRate, .restingHeartRate, .hrv, .weight: false
        }
    }

    /// Totals for what accumulates, averages for what is measured.
    public var defaultAggregation: HealthAggregation {
        switch self {
        case .sleep, .steps, .exercise, .mindfulMinutes, .water, .workouts: .dailySum
        case .heartRate, .restingHeartRate, .hrv, .weight: .dailyAverage
        }
    }
}

public enum HealthAggregation: String, Codable, Sendable {
    case dailySum = "daily_sum"
    case dailyAverage = "daily_avg"
}

/// The person's choice on this phone: what a bot may read, what it may add.
public struct HealthChoice: Codable, Equatable, Sendable {
    public var read: Set<HealthCategory>
    public var write: Set<HealthCategory>

    public init(read: Set<HealthCategory> = [], write: Set<HealthCategory> = []) {
        self.read = read
        self.write = write.filter(\.canWrite).reduce(into: Set<HealthCategory>()) { $0.insert($1) }
    }

    public static let none = HealthChoice()

    public var isEmpty: Bool { read.isEmpty && write.isEmpty }

    public mutating func setRead(_ category: HealthCategory, _ on: Bool) {
        if on { read.insert(category) } else { read.remove(category) }
    }

    public mutating func setWrite(_ category: HealthCategory, _ on: Bool) {
        guard category.canWrite else { return }
        if on { write.insert(category) } else { write.remove(category) }
    }

    /// The tools this phone offers the server: none until the person chose.
    public var offered: [HealthTool] {
        var tools: [HealthTool] = []
        if !read.isEmpty { tools.append(.read) }
        if !write.isEmpty { tools.append(.write) }
        return tools
    }
}

/// The choice, kept on this phone only (never synced, never sent).
public struct HealthChoiceStore: Sendable {
    public static let key = "health.choice.v1"
    private let suite: String?

    public init(suite: String? = nil) { self.suite = suite }

    private var defaults: UserDefaults { suite.flatMap(UserDefaults.init(suiteName:)) ?? .standard }

    public func load() -> HealthChoice {
        guard let data = defaults.data(forKey: Self.key), let choice = try? JSONDecoder().decode(HealthChoice.self, from: data) else { return .none }
        return HealthChoice(read: choice.read, write: choice.write)
    }

    public func save(_ choice: HealthChoice) {
        if choice.isEmpty {
            defaults.removeObject(forKey: Self.key)
        } else if let data = try? JSONEncoder().encode(choice) {
            defaults.set(data, forKey: Self.key)
        }
    }
}

public enum HealthRequestError: LocalizedError, Equatable, Sendable {
    case notAllowed(String)
    case invalid(String)

    /// English, for the bot that reads it.
    public var errorDescription: String? {
        switch self {
        case let .notAllowed(why), let .invalid(why): why
        }
    }
}

public struct HealthReadPlan: Equatable, Sendable {
    public var category: HealthCategory
    public var from: Date
    public var to: Date
    public var aggregation: HealthAggregation
}

public struct HealthWritePlan: Equatable, Sendable {
    public var category: HealthCategory
    /// Minutes, millilitres or kilograms, by category.
    public var value: Double
    public var start: Date
    public var end: Date
    public var workoutType: String
    public var note: String?
}

public enum HealthRules {
    public static let workoutTypes = ["running", "walking", "cycling", "swimming", "yoga", "strength", "hiit", "other"]
    public static let maxWindow: TimeInterval = 92 * 24 * 60 * 60

    private static let santeHint = "They can allow it in Settings > Santé on their iPhone."

    /// A read request, checked against the person's choice. Nothing here
    /// touches HealthKit.
    public static func readPlan(_ request: PhoneToolRequest, choice: HealthChoice) throws -> HealthReadPlan {
        guard let raw = request.string("category"), let category = HealthCategory(rawValue: raw) else {
            throw HealthRequestError.invalid("health_read needs category: \(HealthCategory.allCases.map(\.rawValue).joined(separator: ", ")).")
        }
        guard choice.read.contains(category) else {
            throw HealthRequestError.notAllowed("The person has not allowed reading \(label(category)) on this phone. \(santeHint)")
        }
        guard let from = PhoneToolShaping.date(request.string("from")), let to = PhoneToolShaping.date(request.string("to")), to > from, to.timeIntervalSince(from) <= maxWindow else {
            throw HealthRequestError.invalid("health_read needs from and to (ISO 8601), to after from, at most 92 days.")
        }
        // a total is the only honest daily figure for what accumulates
        let asked = request.string("aggregation").flatMap(HealthAggregation.init(rawValue:))
        let aggregation = category.isCumulative ? HealthAggregation.dailySum : (asked ?? category.defaultAggregation)
        return HealthReadPlan(category: category, from: from, to: to, aggregation: aggregation)
    }

    /// A write request, checked against the person's choice and plain limits.
    public static func writePlan(_ request: PhoneToolRequest, choice: HealthChoice, now: Date = Date()) throws -> HealthWritePlan {
        guard let raw = request.string("category"), let category = HealthCategory(rawValue: raw), category.canWrite else {
            throw HealthRequestError.invalid("health_write needs category: mindful_minutes, water, weight or workouts.")
        }
        guard choice.write.contains(category) else {
            throw HealthRequestError.notAllowed("The person has not allowed adding \(label(category)) on this phone. \(santeHint)")
        }
        let start = PhoneToolShaping.date(request.string("start"))
        let end = PhoneToolShaping.date(request.string("end"))
        let declared = request.args["value"]?.number
        let value: Double
        switch category {
        case .water: value = try limited(declared, 1...10_000, "water is in millilitres (1 to 10000)")
        case .weight: value = try limited(declared, 20...400, "weight is in kilograms (20 to 400)")
        case .mindfulMinutes, .workouts: value = try limited(declared ?? ((start != nil && end != nil) ? end!.timeIntervalSince(start!) / 60 : nil), 1...1_440, "\(category == .workouts ? "a workout" : "mindful time") is 1 to 1440 minutes")
        default: throw HealthRequestError.invalid("health_write cannot add that category.")
        }
        let seconds = category == .water || category == .weight ? 0 : value * 60
        let finish = end ?? start.map { $0.addingTimeInterval(seconds) } ?? now
        let begin = start ?? finish.addingTimeInterval(-seconds)
        guard finish >= begin else { throw HealthRequestError.invalid("end is before start.") }
        guard finish <= now.addingTimeInterval(5 * 60) else { throw HealthRequestError.invalid("Health does not take an entry in the future.") }
        let type = request.string("workout_type")?.lowercased() ?? "other"
        return HealthWritePlan(
            category: category,
            value: value,
            start: begin,
            end: finish,
            workoutType: workoutTypes.contains(type) ? type : "other",
            note: request.string("note").map { String($0.prefix(500)) }
        )
    }

    /// The words the bot reads for a category in an error.
    public static func label(_ category: HealthCategory) -> String {
        switch category {
        case .sleep: "sleep"
        case .steps: "steps"
        case .exercise: "exercise minutes"
        case .heartRate: "heart rate"
        case .restingHeartRate: "resting heart rate"
        case .hrv: "heart rate variability"
        case .mindfulMinutes: "mindful minutes"
        case .water: "water"
        case .weight: "weight"
        case .workouts: "workouts"
        }
    }

    private static func limited(_ value: Double?, _ range: ClosedRange<Double>, _ rule: String) throws -> Double {
        guard let value, value.isFinite, range.contains(value) else { throw HealthRequestError.invalid("value: \(rule).") }
        return value
    }
}

/// One day of a category: the value in the category's unit.
public struct HealthDayValue: Equatable, Sendable {
    public var date: String
    public var value: Double
    public var samples: Int

    public init(date: String, value: Double, samples: Int) {
        self.date = date
        self.value = value
        self.samples = samples
    }
}

/// One workout as the phone read it.
public struct HealthWorkoutRow: Equatable, Sendable {
    public var type: String
    public var start: Date
    public var end: Date
    public var energyKcal: Double?
    public var distanceMeters: Double?
    public var note: String?

    public init(type: String, start: Date, end: Date, energyKcal: Double? = nil, distanceMeters: Double? = nil, note: String? = nil) {
        self.type = type
        self.start = start
        self.end = end
        self.energyKcal = energyKcal
        self.distanceMeters = distanceMeters
        self.note = note
    }
}

public enum HealthShaping {
    private static func round(_ value: Double, _ digits: Int = 2) -> Double {
        let factor = pow(10.0, Double(digits))
        return (value * factor).rounded() / factor
    }

    /// The local day a moment belongs to, "2026-11-17".
    public static func dayKey(_ date: Date, calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    /// Sleep as hours asleep per night. Sources overlap (a watch and a
    /// phone both log the night): overlapping intervals count once. A night
    /// belongs to the day it ends on, the day the person woke up.
    public static func sleepDays(_ intervals: [DateInterval], calendar: Calendar = .current) -> [HealthDayValue] {
        let sorted = intervals.filter { $0.duration > 0 }.sorted { $0.start < $1.start }
        var merged: [DateInterval] = []
        for interval in sorted {
            if let last = merged.last, interval.start <= last.end {
                merged[merged.count - 1] = DateInterval(start: last.start, end: max(last.end, interval.end))
            } else {
                merged.append(interval)
            }
        }
        var seconds: [String: Double] = [:]
        var counts: [String: Int] = [:]
        for interval in merged {
            let key = dayKey(interval.end, calendar: calendar)
            seconds[key, default: 0] += interval.duration
            counts[key, default: 0] += 1
        }
        return seconds.keys.sorted().map { HealthDayValue(date: $0, value: round(seconds[$0]! / 3600), samples: counts[$0] ?? 0) }
    }

    /// Timed samples (heart rate readings, a weight, a mindful session as
    /// its minutes) folded into one value per local day.
    public static func daily(_ samples: [(date: Date, value: Double)], aggregation: HealthAggregation, calendar: Calendar = .current) -> [HealthDayValue] {
        var grouped: [String: [Double]] = [:]
        for sample in samples where sample.value.isFinite { grouped[dayKey(sample.date, calendar: calendar), default: []].append(sample.value) }
        return grouped.keys.sorted().map { key in
            let values = grouped[key]!
            let total = values.reduce(0, +)
            return HealthDayValue(date: key, value: round(aggregation == .dailySum ? total : total / Double(values.count)), samples: values.count)
        }
    }

    /// The answer to health_read: only the rows asked for, in the category's unit.
    public static func readResult(_ plan: HealthReadPlan, days: [HealthDayValue] = [], workouts: [HealthWorkoutRow] = []) -> WidgetJSON {
        var out: [String: WidgetJSON] = [
            "category": .string(plan.category.rawValue),
            "unit": .string(plan.category.unit),
        ]
        if plan.category == .workouts {
            out["workouts"] = .array(workouts.sorted { $0.start < $1.start }.prefix(100).map(workoutRow))
        } else {
            out["aggregation"] = .string(plan.aggregation.rawValue)
            out["days"] = .array(days.sorted { $0.date < $1.date }.prefix(93).map { day in
                .object(["date": .string(day.date), "value": .number(round(day.value)), "samples": .number(Double(max(day.samples, 0)))])
            })
        }
        return .object(out)
    }

    /// The answer to health_write: what was saved.
    public static func writeResult(_ plan: HealthWritePlan) -> WidgetJSON {
        var saved: [String: WidgetJSON] = [
            "category": .string(plan.category.rawValue),
            "value": .number(round(plan.value)),
            "unit": .string(plan.category.unit),
            "start": .string(PhoneToolShaping.iso(plan.start)),
            "end": .string(PhoneToolShaping.iso(plan.end)),
        ]
        if plan.category == .workouts { saved["unit"] = .string("min") }
        return .object(["saved": .object(saved)])
    }

    private static func workoutRow(_ workout: HealthWorkoutRow) -> WidgetJSON {
        var row: [String: WidgetJSON] = [
            "type": .string(String(workout.type.prefix(40))),
            "start": .string(PhoneToolShaping.iso(workout.start)),
            "end": .string(PhoneToolShaping.iso(workout.end)),
            "minutes": .number(round(max(workout.end.timeIntervalSince(workout.start), 0) / 60, 1)),
        ]
        if let energy = workout.energyKcal, energy.isFinite, energy >= 0 { row["energyKcal"] = .number(round(energy, 0)) }
        if let distance = workout.distanceMeters, distance.isFinite, distance >= 0 { row["distanceMeters"] = .number(round(distance, 0)) }
        if let note = workout.note, !note.isEmpty { row["note"] = .string(String(note.prefix(500))) }
        return .object(row)
    }
}
