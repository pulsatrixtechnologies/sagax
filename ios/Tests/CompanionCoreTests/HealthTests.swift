import XCTest
@testable import CompanionCore

/// Apple Health for the person's own bots (Health.swift, shared/phone-tools.ts):
/// nothing is offered, read or written before the person chose it.
final class HealthTests: XCTestCase {
    private var utc: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }

    private func request(_ tool: String, _ args: [String: WidgetJSON]) throws -> PhoneToolRequest {
        let body: [String: WidgetJSON] = [
            "id": .string("r1"), "tool": .string(tool), "args": .object(args), "access": .string(tool == "health_write" ? "write" : "read"),
            "botId": .string("b"), "botName": .string("Wren"), "threadId": .string("t"),
            "allowAlways": .bool(false), "preApproved": .bool(true), "createdAt": .number(0), "expiresAt": .number(0),
        ]
        return try JSONDecoder().decode(PhoneToolRequest.self, from: JSONEncoder().encode(WidgetJSON.object(body)))
    }

    func testNothingIsOfferedUntilThePersonChooses() {
        XCTAssertEqual(HealthChoice.none.offered, [])
        XCTAssertEqual(HealthChoice(read: [.steps]).offered, [.read])
        XCTAssertEqual(HealthChoice(write: [.water]).offered, [.write])
        XCTAssertEqual(HealthChoice(read: [.sleep], write: [.weight]).offered, [.read, .write])
    }

    func testOnlyAppWritableCategoriesCanBeWritten() {
        var choice = HealthChoice()
        choice.setWrite(.heartRate, true)
        XCTAssertTrue(choice.write.isEmpty)
        choice.setWrite(.mindfulMinutes, true)
        XCTAssertEqual(choice.write, [.mindfulMinutes])
        XCTAssertEqual(HealthChoice(write: [.sleep, .water]).write, [.water])
    }

    func testTheChoiceStaysOnThisPhone() {
        let suite = "health-tests-\(UUID().uuidString)"
        defer { UserDefaults.standard.removePersistentDomain(forName: suite) }
        let store = HealthChoiceStore(suite: suite)
        XCTAssertEqual(store.load(), .none)
        store.save(HealthChoice(read: [.steps, .sleep], write: [.water]))
        XCTAssertEqual(store.load(), HealthChoice(read: [.steps, .sleep], write: [.water]))
        store.save(.none)
        XCTAssertEqual(store.load(), .none)
    }

    func testAHealthRequestIsNotAPhoneToolAndNeverOpensACard() throws {
        let read = try request("health_read", ["category": .string("steps")])
        XCTAssertNil(read.tool)
        XCTAssertEqual(read.healthTool, .read)
        XCTAssertEqual(try request("health_write", [:]).healthTool, .write)
        XCTAssertNil(try request("location", [:]).healthTool)
        XCTAssertTrue(PhoneToolRules.runsHealth(read, appActive: true, offered: [.read]))
        XCTAssertFalse(PhoneToolRules.runsHealth(read, appActive: false, offered: [.read]))
        XCTAssertFalse(PhoneToolRules.runsHealth(read, appActive: true, offered: [.write]))
        XCTAssertFalse(PhoneToolRules.runsHealth(read, appActive: true, offered: [.read], protectedTransport: false))
    }

    func testReadingNeedsTheCategoryChosenAndAWindow() throws {
        let args: [String: WidgetJSON] = ["category": .string("steps"), "from": .string("2026-11-01T00:00:00Z"), "to": .string("2026-11-08T00:00:00Z")]
        XCTAssertThrowsError(try HealthRules.readPlan(try request("health_read", args), choice: .none)) { error in
            XCTAssertEqual((error as? HealthRequestError)?.errorDescription?.contains("Settings > Santé"), true)
        }
        let plan = try HealthRules.readPlan(try request("health_read", args), choice: HealthChoice(read: [.steps]))
        XCTAssertEqual(plan.category, .steps)
        XCTAssertEqual(plan.aggregation, .dailySum)
        var tooLong = args
        tooLong["to"] = .string("2027-03-01T00:00:00Z")
        XCTAssertThrowsError(try HealthRules.readPlan(try request("health_read", tooLong), choice: HealthChoice(read: [.steps])))
        var heart = args
        heart["category"] = .string("heart_rate")
        XCTAssertEqual(try HealthRules.readPlan(try request("health_read", heart), choice: HealthChoice(read: [.heartRate])).aggregation, .dailyAverage)
        // an accumulating category is only ever a total
        var avg = args
        avg["aggregation"] = .string("daily_avg")
        XCTAssertEqual(try HealthRules.readPlan(try request("health_read", avg), choice: HealthChoice(read: [.steps])).aggregation, .dailySum)
    }

    func testWritingNeedsTheCategoryChosenAndSaneValues() throws {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let water = try request("health_write", ["category": .string("water"), "value": .number(250)])
        XCTAssertThrowsError(try HealthRules.writePlan(water, choice: HealthChoice(read: [.water]), now: now))
        let plan = try HealthRules.writePlan(water, choice: HealthChoice(write: [.water]), now: now)
        XCTAssertEqual(plan.value, 250)
        XCTAssertEqual(plan.start, plan.end)
        XCTAssertThrowsError(try HealthRules.writePlan(try request("health_write", ["category": .string("water"), "value": .number(50_000)]), choice: HealthChoice(write: [.water]), now: now))
        XCTAssertThrowsError(try HealthRules.writePlan(try request("health_write", ["category": .string("heart_rate"), "value": .number(60)]), choice: HealthChoice(write: [.water]), now: now))
        XCTAssertThrowsError(try HealthRules.writePlan(try request("health_write", ["category": .string("weight"), "value": .number(2)]), choice: HealthChoice(write: [.weight]), now: now))
        let future = try request("health_write", ["category": .string("mindful_minutes"), "value": .number(10), "start": .string("2030-01-01T00:00:00Z")])
        XCTAssertThrowsError(try HealthRules.writePlan(future, choice: HealthChoice(write: [.mindfulMinutes]), now: now))
    }

    func testAWorkoutTakesMinutesOrStartAndEndAndKeepsItsNote() throws {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let choice = HealthChoice(write: [.workouts])
        let byMinutes = try HealthRules.writePlan(try request("health_write", ["category": .string("workouts"), "value": .number(30), "workout_type": .string("Yoga"), "note": .string("calme")]), choice: choice, now: now)
        XCTAssertEqual(byMinutes.workoutType, "yoga")
        XCTAssertEqual(byMinutes.end, now)
        XCTAssertEqual(byMinutes.end.timeIntervalSince(byMinutes.start), 1_800)
        XCTAssertEqual(byMinutes.note, "calme")
        let byRange = try HealthRules.writePlan(try request("health_write", ["category": .string("workouts"), "start": .string("2026-11-01T10:00:00Z"), "end": .string("2026-11-01T10:45:00Z"), "workout_type": .string("teleport")]), choice: choice, now: now)
        XCTAssertEqual(byRange.value, 45)
        XCTAssertEqual(byRange.workoutType, "other")
        XCTAssertThrowsError(try HealthRules.writePlan(try request("health_write", ["category": .string("workouts")]), choice: choice, now: now))
    }

    func testSleepCountsOverlappingSourcesOnceAndBelongsToTheWakeUpDay() {
        let night = DateInterval(start: Date(timeIntervalSince1970: 1_793_750_400), duration: 8 * 3600) // 2026-11-04 00:00 to 08:00 UTC
        let watch = DateInterval(start: night.start.addingTimeInterval(1800), duration: 7 * 3600)
        let days = HealthShaping.sleepDays([night, watch], calendar: utc)
        XCTAssertEqual(days, [HealthDayValue(date: "2026-11-04", value: 8, samples: 1)])
        let overnight = DateInterval(start: Date(timeIntervalSince1970: 1_793_750_400 - 2 * 3600), duration: 8 * 3600) // 22:00 to 06:00
        XCTAssertEqual(HealthShaping.sleepDays([overnight], calendar: utc).first?.date, "2026-11-04")
    }

    func testDailyFoldsSumsAndAverages() {
        let day = Date(timeIntervalSince1970: 1_793_750_400)
        let rows = [(day.addingTimeInterval(60), 60.0), (day.addingTimeInterval(3600), 80.0), (day.addingTimeInterval(86_400 + 5), 70.0)]
        XCTAssertEqual(HealthShaping.daily(rows, aggregation: .dailyAverage, calendar: utc), [
            HealthDayValue(date: "2026-11-04", value: 70, samples: 2), HealthDayValue(date: "2026-11-05", value: 70, samples: 1),
        ])
        XCTAssertEqual(HealthShaping.daily(rows, aggregation: .dailySum, calendar: utc).first?.value, 140)
    }

    func testTheAnswerCarriesUnitsAndOnlyTheRowsAsked() throws {
        let from = Date(timeIntervalSince1970: 1_793_750_400)
        let plan = HealthReadPlan(category: .heartRate, from: from, to: from.addingTimeInterval(86_400), aggregation: .dailyAverage)
        let result = HealthShaping.readResult(plan, days: [HealthDayValue(date: "2026-11-04", value: 61.456, samples: 9)])
        guard case let .object(body) = result, case let .array(days)? = body["days"] else { return XCTFail("shape") }
        XCTAssertEqual(body["unit"]?.string, "bpm")
        XCTAssertEqual(body["aggregation"]?.string, "daily_avg")
        XCTAssertEqual(days.count, 1)
        XCTAssertNil(body["workouts"])
        let workoutPlan = HealthReadPlan(category: .workouts, from: from, to: from.addingTimeInterval(86_400), aggregation: .dailySum)
        let workouts = HealthShaping.readResult(workoutPlan, workouts: [HealthWorkoutRow(type: "running", start: from, end: from.addingTimeInterval(1800), energyKcal: 250.4, distanceMeters: 5000.2, note: "tempo")])
        guard case let .object(w) = workouts, case let .array(rows)? = w["workouts"], case let .object(row)? = rows.first else { return XCTFail("shape") }
        XCTAssertEqual(row["minutes"]?.number, 30)
        XCTAssertEqual(row["note"]?.string, "tempo")
        XCTAssertNil(w["days"])
    }

    func testTheSettingsRowExistsOnlyWhereHealthDoes() {
        var context = SettingsContext.everything
        XCTAssertTrue(SettingsTree.cards(.root, context).joined().contains(.health))
        context.health = false
        XCTAssertFalse(SettingsTree.cards(.root, context).joined().contains(.health))
        XCTAssertTrue(SettingsDestination.health.matches("santé", label: "Health"))
        XCTAssertTrue(SettingsDestination.health.matches("sommeil", label: "Health"))
    }
}
