// The HealthKit calls behind health_read and health_write (CompanionCore
// Health.swift holds the rules and the shaping). Nothing here runs before the
// person chose a category in Settings > Santé and granted it through the
// HealthKit sheet; every call is checked against that choice first. A value
// read is returned to the server for the bot's turn and kept nowhere on the
// phone, and it is never logged. HealthKit never says whether a read was
// refused (a refused category just reads as empty), so a category that was
// never asked is reported as not allowed, and the rest reads what Health lets
// this app see.
import CompanionCore
import Foundation
import HealthKit

@MainActor
final class HealthKitStore {
    static let shared = HealthKitStore()

    private let store = HKHealthStore()

    /// An iPhone or iPad with Health (not a Mac, not a device without it).
    static var isAvailable: Bool { HKHealthStore.isHealthDataAvailable() }

    // MARK: Types

    private static func quantityType(_ category: HealthCategory) -> HKQuantityType? {
        switch category {
        case .steps: HKQuantityType(.stepCount)
        case .exercise: HKQuantityType(.appleExerciseTime)
        case .heartRate: HKQuantityType(.heartRate)
        case .restingHeartRate: HKQuantityType(.restingHeartRate)
        case .hrv: HKQuantityType(.heartRateVariabilitySDNN)
        case .water: HKQuantityType(.dietaryWater)
        case .weight: HKQuantityType(.bodyMass)
        default: nil
        }
    }

    private static func unit(_ category: HealthCategory) -> HKUnit {
        switch category {
        case .steps: .count()
        case .exercise: .minute()
        case .heartRate, .restingHeartRate: HKUnit.count().unitDivided(by: .minute())
        case .hrv: .secondUnit(with: .milli)
        case .water: .literUnit(with: .milli)
        case .weight: .gramUnit(with: .kilo)
        default: .count()
        }
    }

    /// The Health type of a category, for a read or a write.
    static func sampleType(_ category: HealthCategory) -> HKSampleType {
        switch category {
        case .sleep: HKCategoryType(.sleepAnalysis)
        case .mindfulMinutes: HKCategoryType(.mindfulSession)
        case .workouts: HKObjectType.workoutType()
        default: quantityType(category)!
        }
    }

    // MARK: Permission (the HealthKit sheet)

    /// Shows the HealthKit sheet for these categories. HealthKit answers the
    /// sheet only when it has something to ask: a category already decided
    /// is not asked again (the person changes it in Health > Sharing).
    func requestAccess(read: Set<HealthCategory>, write: Set<HealthCategory>) async throws {
        guard Self.isAvailable else { throw HealthRequestError.invalid("Apple Health is not available on this device.") }
        try await store.requestAuthorization(toShare: Set(write.map(Self.sampleType)), read: Set(read.map { Self.sampleType($0) as HKObjectType }))
    }

    /// Whether this app may add to a category now (HealthKit tells writes).
    func canWrite(_ category: HealthCategory) -> Bool {
        store.authorizationStatus(for: Self.sampleType(category)) == .sharingAuthorized
    }

    private func readWasNeverAsked(_ category: HealthCategory) async -> Bool {
        let status = try? await store.statusForAuthorizationRequest(toShare: [], read: [Self.sampleType(category)])
        return status == .shouldRequest
    }

    // MARK: Requests

    func run(_ request: PhoneToolRequest, choice: HealthChoice) async throws -> WidgetJSON {
        guard Self.isAvailable else { throw HealthRequestError.invalid("Apple Health is not available on this device.") }
        switch request.healthTool {
        case .read:
            let plan = try HealthRules.readPlan(request, choice: choice)
            if await readWasNeverAsked(plan.category) {
                throw HealthRequestError.notAllowed("The person has not yet allowed \(HealthRules.label(plan.category)) in the Health sheet. They can do it in Settings > Santé on their iPhone.")
            }
            return try await read(plan)
        case .write:
            let plan = try HealthRules.writePlan(request, choice: choice)
            guard canWrite(plan.category) else {
                throw HealthRequestError.notAllowed("Apple Health does not let Sagax add \(HealthRules.label(plan.category)). The person can turn it on in Settings > Santé, or in Health > Sharing > Apps > Sagax.")
            }
            try await write(plan)
            return HealthShaping.writeResult(plan)
        case nil:
            throw HealthRequestError.invalid("This phone does not know that health tool.")
        }
    }

    // MARK: Read

    private func read(_ plan: HealthReadPlan) async throws -> WidgetJSON {
        let calendar = Calendar.current
        let firstDay = HealthShaping.dayKey(plan.from, calendar: calendar)
        let lastDay = HealthShaping.dayKey(plan.to, calendar: calendar)
        func inRange(_ days: [HealthDayValue]) -> [HealthDayValue] { days.filter { $0.date >= firstDay && $0.date <= lastDay } }
        switch plan.category {
        case .workouts:
            return HealthShaping.readResult(plan, workouts: try await workouts(plan))
        case .sleep:
            // a night that began before the window still ends inside it
            let samples = try await categorySamples(HKCategoryType(.sleepAnalysis), from: plan.from.addingTimeInterval(-12 * 3600), to: plan.to)
            let asleep = Set(HKCategoryValueSleepAnalysis.allAsleepValues.map(\.rawValue))
            let intervals = samples.filter { asleep.contains($0.value) }.map { DateInterval(start: $0.startDate, end: max($0.endDate, $0.startDate)) }
            return HealthShaping.readResult(plan, days: inRange(HealthShaping.sleepDays(intervals, calendar: calendar)))
        case .mindfulMinutes:
            let samples = try await categorySamples(HKCategoryType(.mindfulSession), from: plan.from, to: plan.to)
            let rows = samples.map { (date: $0.startDate, value: $0.endDate.timeIntervalSince($0.startDate) / 60) }
            return HealthShaping.readResult(plan, days: inRange(HealthShaping.daily(rows, aggregation: .dailySum, calendar: calendar)))
        default:
            guard let type = Self.quantityType(plan.category) else { throw HealthRequestError.invalid("health_read cannot read that category.") }
            let unit = Self.unit(plan.category)
            if plan.category.isCumulative {
                return HealthShaping.readResult(plan, days: try await dailyTotals(type, unit: unit, from: plan.from, to: plan.to, calendar: calendar))
            }
            let samples = try await quantitySamples(type, from: plan.from, to: plan.to)
            let rows = samples.map { (date: $0.startDate, value: $0.quantity.doubleValue(for: unit)) }
            return HealthShaping.readResult(plan, days: inRange(HealthShaping.daily(rows, aggregation: plan.aggregation, calendar: calendar)))
        }
    }

    /// HealthKit's own daily totals: two sources (a watch and the phone) are
    /// not counted twice.
    private func dailyTotals(_ type: HKQuantityType, unit: HKUnit, from: Date, to: Date, calendar: Calendar) async throws -> [HealthDayValue] {
        let anchor = calendar.startOfDay(for: from)
        return try await withCheckedThrowingContinuation { done in
            let query = HKStatisticsCollectionQuery(
                quantityType: type,
                quantitySamplePredicate: HKQuery.predicateForSamples(withStart: from, end: to, options: []),
                options: .cumulativeSum,
                anchorDate: anchor,
                intervalComponents: DateComponents(day: 1)
            )
            query.initialResultsHandler = { _, collection, error in
                if let error { done.resume(throwing: error); return }
                var days: [HealthDayValue] = []
                collection?.enumerateStatistics(from: anchor, to: to) { statistics, _ in
                    guard let sum = statistics.sumQuantity() else { return }
                    days.append(HealthDayValue(date: HealthShaping.dayKey(statistics.startDate, calendar: calendar), value: sum.doubleValue(for: unit), samples: 0))
                }
                done.resume(returning: days)
            }
            store.execute(query)
        }
    }

    private func quantitySamples(_ type: HKQuantityType, from: Date, to: Date) async throws -> [HKQuantitySample] {
        try await samples(type, from: from, to: to).compactMap { $0 as? HKQuantitySample }
    }

    private func categorySamples(_ type: HKCategoryType, from: Date, to: Date) async throws -> [HKCategorySample] {
        try await samples(type, from: from, to: to).compactMap { $0 as? HKCategorySample }
    }

    private func samples(_ type: HKSampleType, from: Date, to: Date, limit: Int = 20_000) async throws -> [HKSample] {
        try await withCheckedThrowingContinuation { done in
            let query = HKSampleQuery(
                sampleType: type,
                predicate: HKQuery.predicateForSamples(withStart: from, end: to, options: []),
                limit: limit,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
            ) { _, rows, error in
                if let error { done.resume(throwing: error) } else { done.resume(returning: rows ?? []) }
            }
            store.execute(query)
        }
    }

    private func workouts(_ plan: HealthReadPlan) async throws -> [HealthWorkoutRow] {
        let rows = try await samples(HKObjectType.workoutType(), from: plan.from, to: plan.to, limit: 200).compactMap { $0 as? HKWorkout }
        return rows.map { workout in
            let energy = workout.statistics(for: HKQuantityType(.activeEnergyBurned))?.sumQuantity()?.doubleValue(for: .kilocalorie())
            let distance = [HKQuantityType(.distanceWalkingRunning), HKQuantityType(.distanceCycling), HKQuantityType(.distanceSwimming)]
                .compactMap { workout.statistics(for: $0)?.sumQuantity()?.doubleValue(for: .meter()) }.first
            return HealthWorkoutRow(
                type: Self.workoutName(workout.workoutActivityType),
                start: workout.startDate,
                end: workout.endDate,
                energyKcal: energy,
                distanceMeters: distance,
                note: workout.metadata?[Self.noteKey] as? String
            )
        }
    }

    // MARK: Write

    /// A workout a bot noted keeps its note under this key.
    private static let noteKey = "SagaxNote"

    private func write(_ plan: HealthWritePlan) async throws {
        switch plan.category {
        case .water:
            try await store.save(HKQuantitySample(type: HKQuantityType(.dietaryWater), quantity: HKQuantity(unit: .literUnit(with: .milli), doubleValue: plan.value), start: plan.start, end: plan.end))
        case .weight:
            try await store.save(HKQuantitySample(type: HKQuantityType(.bodyMass), quantity: HKQuantity(unit: .gramUnit(with: .kilo), doubleValue: plan.value), start: plan.start, end: plan.end))
        case .mindfulMinutes:
            try await store.save(HKCategorySample(type: HKCategoryType(.mindfulSession), value: HKCategoryValue.notApplicable.rawValue, start: plan.start, end: plan.end))
        case .workouts:
            let configuration = HKWorkoutConfiguration()
            configuration.activityType = Self.activity(plan.workoutType)
            let builder = HKWorkoutBuilder(healthStore: store, configuration: configuration, device: .local())
            try await builder.beginCollection(at: plan.start)
            if let note = plan.note { try await builder.addMetadata([Self.noteKey: note]) }
            try await builder.endCollection(at: plan.end)
            _ = try await builder.finishWorkout()
        default:
            throw HealthRequestError.invalid("health_write cannot add that category.")
        }
    }

    // MARK: Workout names

    private static func activity(_ name: String) -> HKWorkoutActivityType {
        switch name {
        case "running": .running
        case "walking": .walking
        case "cycling": .cycling
        case "swimming": .swimming
        case "yoga": .yoga
        case "strength": .traditionalStrengthTraining
        case "hiit": .highIntensityIntervalTraining
        default: .other
        }
    }

    private static func workoutName(_ type: HKWorkoutActivityType) -> String {
        switch type {
        case .running: "running"
        case .walking: "walking"
        case .cycling: "cycling"
        case .swimming: "swimming"
        case .yoga: "yoga"
        case .traditionalStrengthTraining, .functionalStrengthTraining: "strength"
        case .highIntensityIntervalTraining: "hiit"
        case .hiking: "hiking"
        case .elliptical: "elliptical"
        case .rowing: "rowing"
        default: "other"
        }
    }
}
