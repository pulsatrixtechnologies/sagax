import XCTest

/// The home's usage paths, the same as the desktop's (NavigationMenus):
/// the bot row menu in the desktop's order with Rename Bot and Archive, the
/// photo's account menu, New on "+", and the places at the foot of the list.
/// Against the parity fixture (an admin pairing on a solo server); each
/// write is read back from the server.
///
///   node ios/parity/fixture-server.mjs &
///   TEST_RUNNER_PARITY_ENDPOINT=... TEST_RUNNER_PARITY_TOKEN=... \
///   TEST_RUNNER_PARITY_ENVIRONMENT=... xcodebuild test \
///     -only-testing:SagaxCompanionUITests/HomeMenusUITests ...
final class HomeMenusUITests: XCTestCase {
    private var arguments: [String] = []
    private var endpoint = ""
    private var token = ""

    override func setUpWithError() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        guard let endpoint = env["PARITY_ENDPOINT"], let token = env["PARITY_TOKEN"] else {
            throw XCTSkip("no parity fixture: set TEST_RUNNER_PARITY_ENDPOINT and TEST_RUNNER_PARITY_TOKEN")
        }
        self.endpoint = endpoint
        self.token = token
        arguments = [
            "-parityEndpoint", endpoint, "-parityToken", token, "-parityScreen", "01-home",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        ]
        if let environment = env["PARITY_ENVIRONMENT"], !environment.isEmpty {
            arguments += ["-parityEnvironment", environment]
        }
    }

    @MainActor
    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.terminate()
        app.launchArguments = arguments
        // threads under each bot row (#210: the default is the chat header)
        app.launchArguments += ["-omb-threads-location", "sidebar"]
        app.launch()
        XCTAssertTrue(app.buttons["home-plus"].waitForExistence(timeout: 20))
        return app
    }

    private func row(_ name: String, in app: XCUIApplication) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'chat-row.' AND label CONTAINS %@", name)).firstMatch
    }

    /// A bot's row, its section opened if an earlier test folded it.
    @MainActor
    private func reveal(_ name: String, section: String, in app: XCUIApplication) -> XCUIElement {
        let target = row(name, in: app)
        if !target.waitForExistence(timeout: 10) {
            let header = app.buttons["section.\(section)"]
            for _ in 0..<8 where !(header.exists && header.isHittable) { app.swipeUp() }
            if header.exists { header.tap() }
        }
        for _ in 0..<8 where !(target.exists && target.isHittable) { app.swipeUp() }
        return target
    }

    private func item(_ label: String, in app: XCUIApplication) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
    }

    // MARK: API

    private func api(_ method: String, _ path: String, _ body: [String: Any]? = nil) -> [String: Any] {
        var request = URLRequest(url: URL(string: endpoint + path)!, timeoutInterval: 60)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        let done = DispatchSemaphore(value: 0)
        var result: [String: Any] = [:]
        URLSession.shared.dataTask(with: request) { data, _, _ in
            result = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
            done.signal()
        }.resume()
        done.wait()
        return result
    }

    private func bot(named name: String) -> [String: Any]? {
        (api("GET", "/api/bots")["bots"] as? [[String: Any]] ?? []).first { $0["name"] as? String == name }
    }

    private func eventually(_ timeout: TimeInterval = 15, _ check: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if check() { return true }
            Thread.sleep(forTimeInterval: 0.4)
        }
        return false
    }

    // MARK: Bot row

    /// The long press lists the desktop's entries in its order, then Rename
    /// Bot renames on the server.
    @MainActor
    func testTheBotMenuFollowsTheDesktopOrderAndRenames() throws {
        let app = launch()
        let aurora = reveal("Aurora", section: "Administration", in: app)
        XCTAssertTrue(aurora.waitForExistence(timeout: 10))
        let id = try XCTUnwrap(bot(named: "Aurora")?["id"] as? String)
        defer { _ = api("PATCH", "/api/bots/\(id)", ["name": "Aurora"]) }

        aurora.press(forDuration: 1.2)
        // a press that lands while the list still settles opens nothing
        if !item("Copy conversation ID", in: app).waitForExistence(timeout: 5) { aurora.press(forDuration: 1.5) }
        // #182: no New thread or New folder on a bot row
        XCTAssertFalse(item("New thread", in: app).exists)
        XCTAssertFalse(item("New folder", in: app).exists)
        let expected = ["Pin", "Move to", "Mark as Unread", "Rename Bot", "Copy conversation ID", "Hide from sidebar", "Archive", "Delete"]
        var lastY = -CGFloat.greatestFiniteMagnitude
        for label in expected {
            let entry = item(label, in: app)
            XCTAssertTrue(entry.waitForExistence(timeout: 5), label)
            XCTAssertGreaterThan(entry.frame.minY, lastY, "\(label) comes after the entry before it")
            lastY = entry.frame.minY
        }
        XCTAssertFalse(item("Threads", in: app).exists, "the desktop's bot menu has no Threads")

        item("Rename Bot", in: app).tap()
        let field = app.alerts.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        // the field starts with the current name, the caret at its end
        let current = field.value as? String ?? ""
        field.typeText(XCUIKeyboardKey.delete.rawValue.repeated(current.count + 2) + "Aurora QC")
        app.alerts.buttons["bot-rename-save"].firstMatch.tap()
        XCTAssertTrue(eventually { self.bot(named: "Aurora QC") != nil }, "renamed on the server")
    }

    /// Archive hides the bot on the server; Archived bots (the account menu)
    /// restores it.
    @MainActor
    func testArchiveThenRestoreFromArchivedBots() throws {
        let app = launch()
        let orion = reveal("Orion", section: "Bots", in: app)
        XCTAssertTrue(orion.waitForExistence(timeout: 10))
        let id = try XCTUnwrap(bot(named: "Orion")?["id"] as? String)
        defer { _ = api("PATCH", "/api/bots/\(id)", ["hidden": false]) }

        orion.press(forDuration: 1.2)
        item("Archive", in: app).tap()
        let confirm = app.buttons["bot-archive-confirm"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        confirm.tap()
        XCTAssertTrue(eventually { self.bot(named: "Orion")?["hidden"] as? Bool == true }, "archived on the server")

        app.swipeDown()
        app.buttons["home-apps"].tap()
        let archived = app.buttons["account-menu.archivedBots"]
        XCTAssertTrue(archived.waitForExistence(timeout: 5))
        archived.tap()
        let restore = app.buttons["archived-restore.\(id)"]
        XCTAssertTrue(restore.waitForExistence(timeout: 10))
        restore.tap()
        XCTAssertTrue(eventually { self.bot(named: "Orion")?["hidden"] as? Bool != true }, "restored on the server")
    }

    // MARK: Account, New, places

    @MainActor
    func testTheAccountMenuOpensSettingsAndAbout() {
        let app = launch()
        app.buttons["home-apps"].tap()
        for id in ["settings", "about", "help"] {
            XCTAssertTrue(app.buttons["account-menu.\(id)"].waitForExistence(timeout: 5), id)
        }
        app.buttons["account-menu.settings"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["settings-appearance"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.descendants(matching: .any)["settings-advanced"].exists, "no Advanced junk drawer")
    }

    /// #184: Release notes sits above About and shows the bundled notes,
    /// newest first, with a version picker.
    @MainActor
    func testReleaseNotesOpenFromTheAccountMenuWithAVersionPicker() {
        let app = launch()
        app.buttons["home-apps"].tap()
        let notes = app.buttons["account-menu.releaseNotes"]
        XCTAssertTrue(notes.waitForExistence(timeout: 5))
        XCTAssertLessThan(notes.frame.minY, app.buttons["account-menu.about"].frame.minY)
        notes.tap()
        XCTAssertTrue(app.descendants(matching: .any)["release-notes-version"].waitForExistence(timeout: 10))
        let text = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'release-notes-text.'")).firstMatch
        XCTAssertTrue(text.waitForExistence(timeout: 5), app.debugDescription)
    }

    @MainActor
    func testNewListsTheBotsAndOpensOne() {
        let app = launch()
        app.buttons["home-plus"].tap()
        XCTAssertTrue(app.buttons["plus-menu.new-bot"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["plus-menu.new-group"].exists)
        let aurora = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'plus-menu.bot.' AND label == 'Aurora'")).firstMatch
        XCTAssertTrue(aurora.waitForExistence(timeout: 5))
        // New chat is the search sheet with the keyboard up: narrow it to
        // the one bot (the rows reorder as recent activity loads)
        app.textFields["search-field"].typeText("Auro")
        XCTAssertTrue(aurora.waitForExistence(timeout: 5))
        aurora.tap()
        XCTAssertTrue(app.buttons["chat-name"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["chat-name"].label.contains("Aurora"))
    }

    @MainActor
    func testTeamMapAndAutomationsSitUnderSettingsInTheAccountMenu() {
        let app = launch()
        app.buttons["home-apps"].tap()
        let settings = app.buttons["account-menu.settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 5))
        let map = app.buttons["account-menu.teamMap"]
        let automations = app.buttons["account-menu.automations"]
        XCTAssertTrue(map.waitForExistence(timeout: 5))
        XCTAssertTrue(automations.exists)
        XCTAssertGreaterThan(map.frame.minY, settings.frame.minY)
        XCTAssertGreaterThan(automations.frame.minY, map.frame.minY)
        XCTAssertFalse(app.buttons["home-place.teamMap"].exists)
        XCTAssertFalse(app.buttons["home-place.automations"].exists)
        automations.tap()
        XCTAssertTrue(app.segmentedControls["routines-section"].waitForExistence(timeout: 15))
    }
}

private extension String {
    func repeated(_ count: Int) -> String { String(repeating: self, count: count) }
}
