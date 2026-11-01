import XCTest

/// WP8 of the iOS feature parity matrix: routine runs and the editor (rows
/// AU6, AU8-AU10, AU12-AU15) against the parity fixture. Each test acts in
/// the app and reads the result back through the server's API.
///
/// Start the fixture with the routines lab, which seeds a desktop-made
/// routine on Aurora ("Veille WP8": weekdays 08:00-18:00 every 30 minutes
/// with an end date, overlap queue, an attachment, a results thread) and its
/// runs (failed and missed unseen, completed, one held in the queue):
///
///   PARITY_ROUTINES=1 node ios/parity/fixture-server.mjs
///
/// The session comes from TEST_RUNNER_PARITY_ENDPOINT / _TOKEN / _ENVIRONMENT
/// or `ios/parity/out/session.json`; without the lab the tests skip.
final class RoutinesUITests: XCTestCase {
    private struct FixtureSession: Decodable {
        let endpoint: String
        let token: String
        let environmentId: String?
    }

    private var fixture: FixtureSession!
    private let lab = "Veille WP8"

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
        guard try routine(named: lab) != nil else {
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
    private func runs() throws -> [[String: Any]] { try api("GET", "/api/routines")["runs"] as? [[String: Any]] ?? [] }
    private func routine(named name: String) throws -> [String: Any]? { try routines().first { $0["name"] as? String == name } }
    private func run(_ id: String) throws -> [String: Any]? { try runs().first { $0["id"] as? String == id } }
    private func bot(named name: String) throws -> [String: Any]? {
        (try api("GET", "/api/bots")["bots"] as? [[String: Any]] ?? []).first { $0["name"] as? String == name }
    }

    private func eventually(_ what: String, timeout: TimeInterval = 20, _ check: () throws -> Bool) throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if try check() { return }
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        }
        XCTFail("never true: \(what)")
    }

    /// A plain routine for a test to edit, deleted afterwards.
    private func scratchRoutine(_ name: String, bot: String = "Ara") throws -> String {
        let botId = try XCTUnwrap(try self.bot(named: bot)?["id"] as? String)
        let created = try api("POST", "/api/routines", [
            "name": name, "prompt": "Texte de remplacement pour le test WP8.", "botId": botId, "runOn": "maus",
            "schedule": ["type": "daily", "time": "09:00", "weekdays": [1, 2, 3, 4, 5]], "durationMinutes": 30,
        ])
        let id = try XCTUnwrap((created["routine"] as? [String: Any])?["id"] as? String)
        addTeardownBlock { [weak self] in _ = try? self?.api("DELETE", "/api/routines/\(id)") }
        return id
    }

    // MARK: App

    @MainActor
    private func openRoutines() -> XCUIApplication {
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
        // Automations opens from the account menu, under Settings
        XCTAssertTrue(app.buttons["home-apps"].waitForExistence(timeout: 30))
        app.buttons["home-apps"].tap()
        let row = app.buttons["account-menu.automations"]
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.tap()
        XCTAssertTrue(element("routines-section", in: app).waitForExistence(timeout: 15))
        // Automations opens on the calendar; these tests read the list
        let list = app.segmentedControls["automations-view"].buttons.element(boundBy: 0)
        if list.waitForExistence(timeout: 5) { list.tap() }
        return app
    }

    private func element(_ id: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func scrollTo(_ target: XCUIElement, in app: XCUIApplication) {
        for _ in 0..<10 where !(target.exists && target.isHittable) { app.swipeUp() }
    }

    private func showLogs(_ app: XCUIApplication) {
        app.segmentedControls["routines-section"].buttons["Run logs"].tap()
    }

    private func choose(_ option: String, in picker: String, app: XCUIApplication) {
        let control = element(picker, in: app)
        scrollTo(control, in: app)
        control.tap()
        let item = app.buttons[option].firstMatch
        XCTAssertTrue(item.waitForExistence(timeout: 5), "no \(option) in \(picker)")
        item.tap()
    }

    @MainActor
    private func openEditor(_ name: String, in app: XCUIApplication) {
        let row = element("routines-row.\(name)", in: app)
        scrollTo(row, in: app)
        row.tap()
        XCTAssertTrue(element("routine-editor-save", in: app).waitForExistence(timeout: 10))
    }

    @MainActor
    private func save(_ app: XCUIApplication) {
        let save = element("routine-editor-save", in: app)
        XCTAssertTrue(save.isEnabled, "Save is disabled")
        save.tap()
        XCTAssertTrue(element("routines-section", in: app).waitForExistence(timeout: 15))
    }

    // MARK: Runs (AU6, AU8-AU10)

    /// The unseen-failure badge opens the problem logs; opening a failed run
    /// marks it seen on the server; Mark all as read clears the rest.
    @MainActor
    func testProblemBadgeSeenOnOpenAndMarkAllRead() throws {
        let unseen = try runs().filter { ["failed", "missed"].contains($0["status"] as? String) && $0["seenAt"] == nil }
        guard !unseen.isEmpty else { throw XCTSkip("the lab's failures were already seen; restart the fixture") }
        let app = openRoutines()
        let badge = element("routines-problems-badge", in: app)
        XCTAssertTrue(badge.waitForExistence(timeout: 10))
        XCTAssertEqual(badge.value as? String, "\(unseen.count)")
        badge.tap()

        let failed = element("routine-run-row.lab-run-failed", in: app)
        XCTAssertTrue(failed.waitForExistence(timeout: 10))
        XCTAssertFalse(element("routine-run-row.lab-run-done", in: app).exists, "Problems shows only failed and missed runs")
        XCTAssertTrue(element("routine-run-unseen.lab-run-failed", in: app).exists)
        failed.tap()
        XCTAssertTrue(element("routine-run-status", in: app).waitForExistence(timeout: 10))
        try eventually("the failed run is seen on the server") { try run("lab-run-failed")?["seenAt"] != nil }
        // the run's own Done, over the Automations sheet's
        app.buttons.matching(NSPredicate(format: "label == %@", "Done")).allElementsBoundByIndex.last?.tap()

        element("routines-menu", in: app).tap()
        element("routines-mark-all-seen", in: app).tap()
        try eventually("every failure is seen on the server") {
            try runs().allSatisfy { !["failed", "missed"].contains($0["status"] as? String) || $0["seenAt"] != nil }
        }
        XCTAssertTrue(badge.waitForNonExistence(timeout: 10))
    }

    /// Run logs: search and the status filter narrow to what the server holds.
    @MainActor
    func testLogsSearchAndStatusFilter() throws {
        let app = openRoutines()
        showLogs(app)
        XCTAssertTrue(element("routine-run-row.lab-run-done", in: app).waitForExistence(timeout: 10))
        let search = app.searchFields["Search run logs"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("trois nouveaux")
        let matching = try runs().filter { ($0["output"] as? String ?? "").contains("trois nouveaux") }.compactMap { $0["id"] as? String }
        XCTAssertEqual(matching, ["lab-run-done"])
        XCTAssertTrue(element("routine-run-row.lab-run-done", in: app).waitForExistence(timeout: 5))
        XCTAssertFalse(element("routine-run-row.lab-run-failed", in: app).exists)
        search.buttons["Clear text"].firstMatch.tap()
        app.swipeDown()

        choose("Missed", in: "routines-status-filter", app: app)
        XCTAssertTrue(element("routine-run-row.lab-run-missed", in: app).waitForExistence(timeout: 5))
        XCTAssertFalse(element("routine-run-row.lab-run-done", in: app).exists)
        XCTAssertEqual(try runs().filter { $0["status"] as? String == "missed" }.count, 1)
    }

    /// A long press on a queued run cancels it on the server.
    @MainActor
    func testCancelRunFromTheLogs() throws {
        guard try run("lab-run-queued")?["status"] as? String == "queued" else { throw XCTSkip("the lab's queued run is gone; restart the fixture") }
        let app = openRoutines()
        showLogs(app)
        let row = element("routine-run-row.lab-run-queued", in: app)
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.press(forDuration: 1.2)
        let cancel = app.buttons["Cancel run"].firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 5))
        cancel.tap()
        try eventually("the run is cancelled on the server") { try run("lab-run-queued")?["status"] as? String == "cancelled" }
    }

    /// Filter by bot: only that bot's routines remain.
    @MainActor
    func testFilterByBot() throws {
        let aurora = try XCTUnwrap(try bot(named: "Aurora")?["id"] as? String)
        let expected = try routines().filter { $0["botId"] as? String == aurora }.compactMap { $0["name"] as? String }
        XCTAssertEqual(expected, [lab])
        let app = openRoutines()
        XCTAssertTrue(element("routines-row.Scan skills populaires mensuel", in: app).waitForExistence(timeout: 10))
        element("routines-menu", in: app).tap()
        app.buttons["Filter by bot"].firstMatch.tap()
        // the submenu opens over the Automations sheet
        let auroraItem = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Aurora")).firstMatch
        XCTAssertTrue(auroraItem.waitForExistence(timeout: 5), "Aurora in the bot filter")
        auroraItem.tap()
        XCTAssertTrue(element("routines-row.\(lab)", in: app).waitForExistence(timeout: 5))
        XCTAssertFalse(element("routines-row.Scan skills populaires mensuel", in: app).exists)
    }

    // MARK: Editor (AU12-AU14, S3)

    /// A rename from the phone leaves everything the desktop set as it was.
    @MainActor
    func testRenameKeepsTheDesktopFields() throws {
        let before = try XCTUnwrap(try routine(named: lab))
        let app = openRoutines()
        openEditor(lab, in: app)
        let name = element("routine-editor-name", in: app)
        name.tap()
        name.typeText(" bis")
        save(app)
        try eventually("the rename reached the server") { try routine(named: "\(lab) bis") != nil }
        let after = try XCTUnwrap(try routine(named: "\(lab) bis"))
        addTeardownBlock { [weak self] in
            guard let self, let id = after["id"] as? String else { return }
            _ = try? self.api("PATCH", "/api/routines/\(id)", ["name": self.lab])
        }
        func json(_ value: Any?) -> String {
            guard let value else { return "absent" }
            guard JSONSerialization.isValidJSONObject([value]),
                  let data = try? JSONSerialization.data(withJSONObject: [value], options: .sortedKeys)
            else { return String(describing: value) }
            return String(decoding: data, as: UTF8.self)
        }
        for key in ["schedule", "overlap", "attachments", "resultsThreadId", "timeoutMinutes", "target", "runOn", "prompt"] {
            XCTAssertEqual(json(after[key]), json(before[key]), "\(key) changed")
        }
    }

    /// Advanced: overlap and the interval's end date save; the window stays.
    @MainActor
    func testIntervalEndAndOverlapSave() throws {
        let id = try scratchRoutine("Intervalle WP8")
        try api("PATCH", "/api/routines/\(id)", [
            "overlap": "queue",
            "schedule": ["type": "interval", "everyMinutes": 30, "anchorAt": Int(Date().timeIntervalSince1970 * 1_000) / 60_000 * 60_000 + 3_600_000,
                         "window": ["start": "08:00", "end": "18:00"], "endsAt": Int(Date().timeIntervalSince1970 * 1_000) + 20 * 86_400_000],
        ])
        let app = openRoutines()
        openEditor("Intervalle WP8", in: app)
        let window = element("routine-editor-window-start", in: app)
        scrollTo(window, in: app)
        XCTAssertTrue(window.exists, "the window shows")
        choose("Never", in: "routine-editor-ends", app: app)
        let advanced = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'More options'")).firstMatch
        scrollTo(advanced, in: app)
        advanced.tap()
        let overlap = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'If the previous run is still working'")).firstMatch
        scrollTo(overlap, in: app)
        XCTAssertTrue(overlap.exists, "the overlap choice shows under More options")
        overlap.tap()
        app.buttons["Skip this occurrence"].firstMatch.tap()
        save(app)
        try eventually("the end date and overlap are cleared on the server") {
            let saved = try self.routines().first { $0["id"] as? String == id }
            let schedule = saved?["schedule"] as? [String: Any]
            return saved?["overlap"] == nil && schedule?["endsAt"] == nil && schedule?["window"] != nil
        }
    }

    /// Repeats > Every month, then Weekdays at two times: both save as cron
    /// under the hood, the editor never shows the expression (2026-10-29).
    @MainActor
    func testMonthlyAndWeekdaysAtTwoTimesSave() throws {
        let id = try scratchRoutine("Mensuel WP8")
        let app = openRoutines()
        openEditor("Mensuel WP8", in: app)
        choose("Every month", in: "routine-editor-repeat", app: app)
        XCTAssertTrue(element("routine-editor-next-runs", in: app).waitForExistence(timeout: 5))
        XCTAssertTrue(element("routine-editor-summary", in: app).exists)
        save(app)
        try eventually("a monthly cron is saved") {
            let schedule = try self.routines().first { $0["id"] as? String == id }?["schedule"] as? [String: Any]
            let parts = (schedule?["expression"] as? String ?? "").split(separator: " ")
            return schedule?["type"] as? String == "cron" && parts.count == 5 && parts[3] == "*" && parts[4] == "*"
        }

        openEditor("Mensuel WP8", in: app)
        choose("Weekdays", in: "routine-editor-repeat", app: app)
        let add = element("routine-editor-add-time", in: app)
        scrollTo(add, in: app)
        add.tap()
        XCTAssertTrue(element("routine-editor-time.1", in: app).waitForExistence(timeout: 5))
        save(app)
        try eventually("weekdays at two times are saved") {
            let schedule = try self.routines().first { $0["id"] as? String == id }?["schedule"] as? [String: Any]
            let parts = (schedule?["expression"] as? String ?? "").split(separator: " ")
            return parts.count == 5 && parts[1].contains(",") && parts[4] == "1-5"
        }
    }

    /// Routine type > Team goal saves the room and its lead.
    @MainActor
    func testTeamGoalSaves() throws {
        let id = try scratchRoutine("Objectif WP8")
        let app = openRoutines()
        openEditor("Objectif WP8", in: app)
        app.segmentedControls["routine-editor-type"].buttons["Team goal"].tap()
        XCTAssertTrue(element("routine-editor-lead", in: app).waitForExistence(timeout: 5))
        save(app)
        try eventually("the routine is a team goal on the server") {
            let saved = try self.routines().first { $0["id"] as? String == id }
            return saved?["target"] as? String == "room-goal" && (saved?["groupId"] as? String)?.isEmpty == false
        }
    }

    // MARK: Runs as, and Continue in the conversation (AU15)

    /// "Runs as" (the desktop's RunAsField, organization server): the
    /// editor shows the person the routine runs as; the list names who may
    /// run it and lists the others, not choosable, with the reason.
    @MainActor
    func testRunAsListsWhoMayRunTheRoutine() throws {
        let routine = try XCTUnwrap(try routine(named: lab))
        let botId = try XCTUnwrap(routine["botId"] as? String)
        let id = try XCTUnwrap(routine["id"] as? String)
        let options = try api("GET", "/api/routines/run-as-options?botId=\(botId)&target=bot&routineId=\(id)")
        guard options["canChoose"] as? Bool == true, let people = options["people"] as? [[String: Any]] else {
            throw XCTSkip("an organization fixture (PARITY_ORG=1 PARITY_ORG_PHONE=1) chooses who a routine runs as")
        }
        let app = openRoutines()
        openEditor(lab, in: app)
        let field = element("routine-editor-run-as", in: app)
        scrollTo(field, in: app)
        XCTAssertTrue(field.waitForExistence(timeout: 10), "Runs as in the editor")
        let current = (options["current"] as? [String: Any])?["name"] as? String ?? ""
        XCTAssertTrue(field.label.contains(current), "the routine's current person")
        ParityShots.save("Routine editor Runs as", app)
        field.tap()
        for person in people {
            let id = try XCTUnwrap(person["principalId"] as? String)
            let row = element("routine-run-as.\(id)", in: app)
            XCTAssertTrue(row.waitForExistence(timeout: 5), "\(person["name"] ?? id) listed")
            XCTAssertEqual(row.isEnabled, person["selectable"] as? Bool ?? false, "only who may run it can be chosen")
        }
        ParityShots.save("Routine Runs as picker", app)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "Runs as picker"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// 2026-10-29: a run's Continue in the conversation opens the bot's one
    /// conversation (Aurora's chat), never a separate results thread.
    @MainActor
    func testRunContinuesInTheConversation() throws {
        let app = openRoutines()
        showLogs(app)
        let row = element("routine-run-row.lab-run-done", in: app)
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.tap()
        XCTAssertFalse(element("routine-run-open-results", in: app).exists, "no Open results thread")
        let open = element("routine-run-open-thread", in: app)
        XCTAssertTrue(open.waitForExistence(timeout: 10))
        open.tap()
        XCTAssertTrue(app.staticTexts["Aurora"].firstMatch.waitForExistence(timeout: 15), "Aurora's chat opens")
    }
}
