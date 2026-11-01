import XCTest

/// WP10 of the iOS feature parity matrix: the Automations page and its
/// calendar (rows AU1-AU4) against the parity fixture. Each test acts in the
/// app and reads the result back through the server's API.
///
/// Start the fixture with the routines lab (its desktop-made routine and
/// runs fill Run logs):
///
///   PARITY_ROUTINES=1 node ios/parity/fixture-server.mjs
///
/// The session comes from TEST_RUNNER_PARITY_ENDPOINT / _TOKEN / _ENVIRONMENT
/// or `ios/parity/out/session.json`; without the lab the tests skip.
final class AutomationsUITests: XCTestCase {
    private struct FixtureSession: Decodable {
        let endpoint: String
        let token: String
        let environmentId: String?
    }

    private var fixture: FixtureSession!

    override func setUpWithError() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        if let endpoint = env["PARITY_ENDPOINT"], let token = env["PARITY_TOKEN"] {
            fixture = FixtureSession(endpoint: endpoint, token: token, environmentId: env["PARITY_ENVIRONMENT"].flatMap { $0.isEmpty ? nil : $0 })
        } else {
            let file = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
                .appendingPathComponent("parity/out/session.json")
            guard let data = try? Data(contentsOf: file) else { throw XCTSkip("no parity fixture: set TEST_RUNNER_PARITY_ENDPOINT and TEST_RUNNER_PARITY_TOKEN") }
            fixture = try JSONDecoder().decode(FixtureSession.self, from: data)
        }
        guard try routine(named: "Veille WP8") != nil else {
            throw XCTSkip("start the fixture with PARITY_ROUTINES=1 for the routines lab")
        }
    }

    // MARK: API

    @discardableResult
    private func api(_ method: String, _ path: String, _ body: [String: Any]? = nil) throws -> [String: Any] {
        var request = URLRequest(url: try XCTUnwrap(URL(string: fixture.endpoint + path)))
        request.httpMethod = method
        request.timeoutInterval = 60
        request.setValue("Bearer \(fixture.token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let done = expectation(description: "\(method) \(path)")
        var result: (Data?, URLResponse?) = (nil, nil)
        URLSession.shared.dataTask(with: request) { data, response, _ in
            result = (data, response)
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 70)
        let status = (result.1 as? HTTPURLResponse)?.statusCode ?? 0
        XCTAssertTrue((200...299).contains(status), "\(method) \(path) -> \(status)")
        return (result.0.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]) ?? [:]
    }

    private func routines() throws -> [[String: Any]] { try api("GET", "/api/routines")["routines"] as? [[String: Any]] ?? [] }
    private func routine(named name: String) throws -> [String: Any]? { try routines().first { $0["name"] as? String == name } }
    private func botId(named name: String) throws -> String {
        let bots = try api("GET", "/api/bots")["bots"] as? [[String: Any]] ?? []
        return try XCTUnwrap(bots.first { $0["name"] as? String == name }?["id"] as? String)
    }

    private func eventually(_ what: String, timeout: TimeInterval = 20, _ check: () throws -> Bool) throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if try check() { return }
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        }
        XCTFail("never true: \(what)")
    }

    private func deleteAfterwards(named name: String) {
        addTeardownBlock { [weak self] in
            guard let self, let id = try? self.routine(named: name)?["id"] as? String else { return }
            _ = try? self.api("DELETE", "/api/routines/\(id)")
        }
    }

    private func ms(_ date: Date) -> Double { (date.timeIntervalSince1970 * 1_000).rounded() }

    /// Tomorrow at a local time, the day the tests work on (the agenda opens
    /// a day other than today at 7 AM).
    private func tomorrow(_ hour: Int, _ minute: Int = 0, plus days: Int = 1) -> Date {
        let calendar = Calendar.current
        let day = calendar.date(byAdding: .day, value: days, to: calendar.startOfDay(for: Date()))!
        return calendar.date(bySettingHour: hour, minute: minute, second: 0, of: day)!
    }

    // MARK: App

    @MainActor
    private func openAutomations() -> XCUIApplication {
        let app = XCUIApplication()
        app.terminate()
        var arguments = [
            "-parityEndpoint", fixture.endpoint, "-parityToken", fixture.token, "-parityScreen", "01-home",
            "-companion.prefs.rosterDensity", "standard",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES",
        ]
        if let environment = fixture.environmentId { arguments += ["-parityEnvironment", environment] }
        app.launchArguments = arguments
        app.launch()
        // Automations: the account menu, under Settings
        XCTAssertTrue(app.buttons["home-apps"].waitForExistence(timeout: 30))
        app.buttons["home-apps"].tap()
        let automations = app.buttons["account-menu.automations"]
        XCTAssertTrue(automations.waitForExistence(timeout: 5))
        automations.tap()
        XCTAssertTrue(app.segmentedControls["routines-section"].waitForExistence(timeout: 15))
        return app
    }

    private func element(_ id: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func showTomorrow(_ app: XCUIApplication) {
        let next = element("automations-next", in: app)
        XCTAssertTrue(next.waitForExistence(timeout: 10))
        next.tap()
    }

    private func event(_ name: String, in app: XCUIApplication) -> XCUIElement {
        element("automations-event.\(name)", in: app)
    }

    /// Long press an event and choose Reschedule.
    private func reschedule(_ name: String, in app: XCUIApplication) {
        let card = event(name, in: app)
        XCTAssertTrue(card.waitForExistence(timeout: 15), "no event \(name)")
        card.press(forDuration: 1.2)
        let item = app.buttons["Reschedule"]
        XCTAssertTrue(item.waitForExistence(timeout: 5))
        item.tap()
        XCTAssertTrue(element("automations-reschedule-date", in: app).waitForExistence(timeout: 10))
    }

    /// The graphical picker's day button for `date`, in the shown month.
    private func pickDay(_ date: Date, in app: XCUIApplication) throws {
        let day = Calendar.current.component(.day, from: date)
        let month = date.formatted(.dateTime.month(.wide))
        let button = app.datePickers.firstMatch.buttons
            .matching(NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", month, " \(day)")).firstMatch
        guard button.waitForExistence(timeout: 5) else { throw XCTSkip("the day after is in another month") }
        button.tap()
    }

    // MARK: AU1

    @MainActor
    func testTheHomePlusLongPressOpensAutomationsWithScheduleAndLogs() throws {
        let app = openAutomations()
        let section = app.segmentedControls["routines-section"]
        XCTAssertTrue(section.buttons["Schedule"].exists)
        XCTAssertTrue(section.buttons["Run logs"].exists)
        // Schedule opens on the calendar, as the desktop does.
        XCTAssertTrue(app.segmentedControls["automations-view"].buttons["Calendar"].isSelected)
        XCTAssertTrue(element("automations-agenda", in: app).exists)

        // List shows every routine, the desktop-made one included.
        app.segmentedControls["automations-view"].buttons["List"].tap()
        XCTAssertTrue(element("routines-row.Veille WP8", in: app).waitForExistence(timeout: 10))

        // Run logs: the lab's runs, as the server has them.
        section.buttons["Run logs"].tap()
        XCTAssertTrue(element("routine-run-row.lab-run-done", in: app).waitForExistence(timeout: 10))
        XCTAssertTrue(element("routines-status-filter", in: app).exists)
    }

    // MARK: AU2, AU3

    @MainActor
    func testTappingAnEmptyHourCreatesAOneTimeRoutineThere() throws {
        let name = "Créneau WP10"
        deleteAfterwards(named: name)
        let app = openAutomations()
        showTomorrow(app)

        // The mini month moves the day too: tomorrow, from today.
        element("automations-today", in: app).tap()
        element("automations-range", in: app).tap()
        XCTAssertTrue(element("automations-mini-month", in: app).waitForExistence(timeout: 5))
        try pickDay(tomorrow(0), in: app)
        XCTAssertTrue(element("automations-agenda", in: app).waitForExistence(timeout: 5))

        let hour = element("automations-hour.10", in: app)
        XCTAssertTrue(hour.waitForExistence(timeout: 10))
        hour.tap()
        let title = element("automations-quick-title", in: app)
        XCTAssertTrue(title.waitForExistence(timeout: 10))
        title.tap()
        title.typeText(name)
        let prompt = element("automations-quick-prompt", in: app)
        prompt.tap()
        prompt.typeText("Texte de remplacement pour le test WP10.")
        element("automations-quick-save", in: app).tap()

        // What the desktop's quick composer sends: once at the slot, 30 min, here.
        var created: [String: Any] = [:]
        try eventually("the slot's routine exists") {
            created = try routine(named: name) ?? [:]
            return !created.isEmpty
        }
        let schedule = try XCTUnwrap(created["schedule"] as? [String: Any])
        XCTAssertEqual(schedule["type"] as? String, "once")
        XCTAssertEqual(schedule["at"] as? Double, ms(tomorrow(10, 30)))
        XCTAssertEqual(created["durationMinutes"] as? Int, 30)
        XCTAssertEqual(created["runOn"] as? String, "maus")
        XCTAssertEqual(created["enabled"] as? Bool, true)
        XCTAssertEqual(created["prompt"] as? String, "Texte de remplacement pour le test WP10.")
        // And it shows on the day.
        XCTAssertTrue(event(name, in: app).waitForExistence(timeout: 15))
    }

    // MARK: AU4

    @MainActor
    func testRescheduleMovesAOneTimeRoutine() throws {
        let name = "Unique WP10"
        let ara = try botId(named: "Ara")
        try api("POST", "/api/routines", [
            "name": name, "prompt": "Texte de remplacement.", "botId": ara, "runOn": "maus",
            "schedule": ["type": "once", "at": ms(tomorrow(9))], "durationMinutes": 45, "timeoutMinutes": 20,
        ])
        deleteAfterwards(named: name)
        let app = openAutomations()
        showTomorrow(app)
        reschedule(name, in: app)
        try pickDay(tomorrow(9, plus: 2), in: app)
        element("automations-reschedule-save", in: app).tap()

        try eventually("the routine moved a day") {
            let schedule = try routine(named: name)?["schedule"] as? [String: Any]
            return schedule?["at"] as? Double == ms(tomorrow(9, plus: 2))
        }
        // The move sent the schedule alone: the rest is as it was.
        let moved = try XCTUnwrap(try routine(named: name))
        XCTAssertEqual(moved["durationMinutes"] as? Int, 45)
        XCTAssertEqual(moved["timeoutMinutes"] as? Int, 20)
        XCTAssertEqual((moved["schedule"] as? [String: Any])?["type"] as? String, "once")
    }

    @MainActor
    func testRescheduleMovesARecurringSeriesAfterAsking() throws {
        let name = "Série WP10"
        let ara = try botId(named: "Ara")
        let weekday = Calendar.current.component(.weekday, from: tomorrow(9)) - 1
        try api("POST", "/api/routines", [
            "name": name, "prompt": "Texte de remplacement.", "botId": ara, "runOn": "maus",
            "schedule": ["type": "daily", "time": "09:00", "weekdays": [weekday]], "durationMinutes": 30,
        ])
        deleteAfterwards(named: name)
        let app = openAutomations()
        showTomorrow(app)
        reschedule(name, in: app)
        try pickDay(tomorrow(9, plus: 2), in: app)
        element("automations-reschedule-save", in: app).tap()
        let series = app.buttons["Move series"].firstMatch
        XCTAssertTrue(series.waitForExistence(timeout: 5), "a series asks first")
        series.tap()

        try eventually("the series moved a day") {
            let schedule = try routine(named: name)?["schedule"] as? [String: Any]
            return schedule?["weekdays"] as? [Int] == [(weekday + 1) % 7]
        }
        let schedule = try XCTUnwrap(try routine(named: name)?["schedule"] as? [String: Any])
        XCTAssertEqual(schedule["type"] as? String, "daily")
        XCTAssertEqual(schedule["time"] as? String, "09:00")
    }
}
