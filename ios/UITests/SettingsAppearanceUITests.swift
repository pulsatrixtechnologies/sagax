import XCTest

/// WP12 of the iOS feature parity matrix against the parity fixture: the
/// Settings search (ST11), About (ST12), notification sounds (ST3), usage by
/// bot and its history (ST10), achievements (ST9), and on an organization
/// server the Organization page and the routine delegation prompt (ST8,
/// AU19). Every write is read back through the server's API.
///
///   node ios/parity/fixture-server.mjs &                      # the solo tests
///   PARITY_ORG=1 PARITY_ORG_PHONE=1 node ios/parity/fixture-server.mjs &   # + the org tests
///   TEST_RUNNER_PARITY_ENDPOINT=... TEST_RUNNER_PARITY_TOKEN=... \
///   TEST_RUNNER_PARITY_ENVIRONMENT=... xcodebuild test \
///     -only-testing:SagaxUITests/SettingsAppearanceUITests ...
final class SettingsAppearanceUITests: XCTestCase {
    private var endpoint = ""
    private var token = ""
    private var environment: String?

    override func setUpWithError() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        guard let endpoint = env["PARITY_ENDPOINT"], let token = env["PARITY_TOKEN"] else {
            throw XCTSkip("no parity fixture: set TEST_RUNNER_PARITY_ENDPOINT and TEST_RUNNER_PARITY_TOKEN")
        }
        self.endpoint = endpoint
        self.token = token
        environment = env["PARITY_ENVIRONMENT"].flatMap { $0.isEmpty ? nil : $0 }
    }

    // MARK: Launch and navigation

    @MainActor
    private func launch(_ extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.terminate()
        var arguments = [
            "-parityEndpoint", endpoint, "-parityToken", token, "-parityScreen", "12-settings-top",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US", "-achievementsLive",
        ]
        if let environment { arguments += ["-parityEnvironment", environment] }
        app.launchArguments = arguments + extra
        app.launch()
        XCTAssertTrue(app.element("settings-close").waitForExistence(timeout: 30))
        return app
    }

    /// A row of the Settings list (the root, in the desktop's order).
    @MainActor
    private func openRow(_ id: String, _ app: XCUIApplication) {
        let row = app.element(id)
        XCTAssertTrue(row.waitForExistence(timeout: 10), id)
        for _ in 0..<10 where !row.isHittable { app.swipeUp() }
        row.tap()
    }

    /// The search field at the top of Settings.
    @MainActor
    private func search(_ text: String, _ app: XCUIApplication) -> XCUIElement {
        // the round search button opens the field (Grok Bot's sheet, 2026-11-01)
        let open = app.buttons["settings-search-open"]
        if open.waitForExistence(timeout: 5) { open.tap() }
        let field = app.textFields["settings-search"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText(text)
        return field
    }

    // MARK: API

    @discardableResult
    private func api(_ method: String, _ path: String, body: [String: Any]? = nil) -> (Int, [String: Any]) {
        var request = URLRequest(url: URL(string: endpoint + path)!, timeoutInterval: 60)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        let done = DispatchSemaphore(value: 0)
        var result: (Int, [String: Any]) = (0, [:])
        URLSession.shared.dataTask(with: request) { data, response, _ in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
            result = (status, json)
            done.signal()
        }.resume()
        _ = done.wait(timeout: .now() + 70)
        return result
    }

    private func eventually(_ timeout: TimeInterval = 15, _ check: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if check() { return true }
            Thread.sleep(forTimeInterval: 0.4)
        }
        return check()
    }

    private var organization: Bool {
        let (status, body) = api("GET", "/api/org")
        return status == 200 && ((body["org"] as? [String: Any])?["identity"] as? [String: Any])?["kind"] as? String == "perspicax"
    }

    // MARK: ST11, ST12

    @MainActor
    func testSearchFindsPagesByNameAndKeyword() {
        let app = launch()
        let field = search("chime", app)
        let haptics = app.element("settings-search.haptics")
        XCTAssertTrue(haptics.waitForExistence(timeout: 5), "a keyword finds the sounds")
        XCTAssertFalse(app.element("settings-search.about").exists)
        app.buttons["Clear"].firstMatch.tap()
        field.typeText("zzqq")
        XCTAssertTrue(app.element("settings-search-empty").waitForExistence(timeout: 5))
        // A name opens its page.
        app.buttons["Clear"].firstMatch.tap()
        field.typeText("About")
        app.element("settings-search.about").tap()
        XCTAssertTrue(app.element("about-version").waitForExistence(timeout: 5))
    }

    @MainActor
    func testAboutShowsTheVersionAndTheDesktopsLinks() {
        // About is in the account menu; in Settings, the search finds it
        let app = launch()
        _ = search("About", app)
        openRow("settings-search.about", app)
        let version = app.element("about-version")
        XCTAssertTrue(version.waitForExistence(timeout: 5))
        XCTAssertTrue(version.label.hasPrefix("Version "))
        XCTAssertTrue(app.element("about-release-notes").exists)
        XCTAssertFalse(app.element("about-computer").exists, "the desktop shows no computer")
        XCTAssertTrue(app.element("about-license").exists)
    }

    // MARK: ST3

    @MainActor
    func testNotificationSoundsSwitchIsKept() {
        // #222: the sounds live in Settings > Notifications with the nudge rows
        let app = launch()
        openRow("settings-notifications", app)
        XCTAssertTrue(app.element("settings-nudge-sound.toggle").waitForExistence(timeout: 5))
        XCTAssertTrue(app.element("settings-nudge-haptic.toggle").exists)
        XCTAssertTrue(app.element("settings-notification-badge.toggle").exists)
        let toggle = app.element("settings-notification-sounds.toggle")
        XCTAssertTrue(toggle.waitForExistence(timeout: 5))
        let before = toggle.value as? String ?? "1"
        let flipped = before == "1" ? "0" : "1"
        toggle.tap()
        XCTAssertTrue(eventually(5) { toggle.value as? String == flipped })
        // Kept on this phone after a relaunch, then put back.
        let again = launch()
        openRow("settings-notifications", again)
        let kept = again.element("settings-notification-sounds.toggle")
        XCTAssertTrue(kept.waitForExistence(timeout: 5))
        XCTAssertEqual(kept.value as? String, flipped)
        kept.tap()
        XCTAssertTrue(eventually(5) { kept.value as? String == before })
    }

    // MARK: ST10

    /// Usage (#518): the signed-in person's own cost, by bot and by model.
    /// The per-bot table and the installation's history left for Sagax
    /// Business, so the page is the personal section only.
    @MainActor
    func testUsageShowsThePersonalCost() {
        let app = launch()
        let usage = app.element("settings-usage")
        XCTAssertTrue(usage.waitForExistence(timeout: 15))
        usage.tap()
        XCTAssertTrue(app.element("usage-personal-cost").waitForExistence(timeout: 15))
    }

    // MARK: ST9

    @MainActor
    func testAchievementsShowThePersonAndSaveTheSwitches() throws {
        let (status, before) = api("GET", "/api/me/achievements")
        guard status == 200 else { throw XCTSkip("this pairing keeps no achievements (\(status))") }
        let wasPublic = (before["settings"] as? [String: Any])?["public"] as? Bool ?? false
        let app = launch()
        // #220: Achievements left Settings for their own window, opened
        // from the account menu
        XCTAssertFalse(app.element("settings-achievements").exists)
        app.element("settings-close").tap()
        let account = app.element("home-apps")
        XCTAssertTrue(account.waitForExistence(timeout: 10))
        account.tap()
        let entry = app.element("account-menu.achievements")
        XCTAssertTrue(entry.waitForExistence(timeout: 10))
        entry.tap()
        XCTAssertTrue(app.element("achievements-points").waitForExistence(timeout: 15))
        XCTAssertTrue(app.element("achievement.first-words").exists)

        // The category select narrows the cards: Productivity drops Getting
        // started's own.
        app.element("achievements-category").tap()
        let productivity = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Productivity' AND elementType != %d", XCUIElement.ElementType.other.rawValue)).firstMatch
        XCTAssertTrue(productivity.waitForExistence(timeout: 5), app.debugDescription)
        productivity.tap()
        XCTAssertTrue(app.element("achievement.on-schedule").waitForExistence(timeout: 5))
        XCTAssertFalse(app.element("achievement.first-words").exists)

        // The page reported itself viewed (`achievements.viewed`); the
        // launch reported `app.opened`.
        XCTAssertTrue(eventually(10) {
            let items = self.api("GET", "/api/me/achievements").1["items"] as? [[String: Any]] ?? []
            return items.contains { ($0["current"] as? Int ?? 0) > 0 }
        })

        // "Show my points to colleagues" is the person's setting on the server.
        let toggle = app.element("achievements-public.toggle")
        for _ in 0..<12 where !toggle.isHittable { app.swipeUp() }
        toggle.tap()
        XCTAssertTrue(eventually { (self.api("GET", "/api/me/achievements").1["settings"] as? [String: Any])?["public"] as? Bool == !wasPublic })
        toggle.tap()
        XCTAssertTrue(eventually { (self.api("GET", "/api/me/achievements").1["settings"] as? [String: Any])?["public"] as? Bool == wasPublic })
    }

    // MARK: ST8, AU19 (organization server)

    @MainActor
    func testOrganizationPageShowsTheServerAndSavesFullAccess() throws {
        guard organization else { throw XCTSkip("start the fixture with PARITY_ORG=1 PARITY_ORG_PHONE=1") }
        let org = api("GET", "/api/org").1
        let admin = org["viewerRole"] as? String == "admin"
        let app = launch()
        openRow("settings-organization", app)
        XCTAssertTrue(app.element("org-name").waitForExistence(timeout: 15))
        XCTAssertEqual(app.element("org-name").label, (org["org"] as? [String: Any])?["name"] as? String)
        // #149: routines act in the owner's name, one read-only line
        XCTAssertTrue(app.element("org-delegation-state").waitForExistence(timeout: 10))

        // Sharing lists the bots the server says this person sees.
        let bots = api("GET", "/api/org/bots").1["bots"] as? [[String: Any]] ?? []
        if let first = bots.first?["id"] as? String {
            let row = app.element("org-bot.\(first)")
            for _ in 0..<8 where !row.exists { app.swipeUp() }
            XCTAssertTrue(row.waitForExistence(timeout: 10))
        }

        guard admin else { return }
        let allowed = (org["settings"] as? [String: Any])?["allowFullAccess"] as? Bool ?? true
        let toggle = app.element("org-full-access.toggle")
        for _ in 0..<10 where !toggle.isHittable { app.swipeUp() }
        toggle.tap()
        XCTAssertTrue(eventually { ((self.api("GET", "/api/org").1["settings"] as? [String: Any])?["allowFullAccess"] as? Bool) == !allowed })
        toggle.tap()
        XCTAssertTrue(eventually { ((self.api("GET", "/api/org").1["settings"] as? [String: Any])?["allowFullAccess"] as? Bool) == allowed })
    }

    /// #149: a quick create on the Automations calendar no longer sends the
    /// person to a consent; the routine simply exists.
    @MainActor
    func testAQuickCreateAsksForNoConsent() throws {
        guard organization else { throw XCTSkip("start the fixture with PARITY_ORG=1 PARITY_ORG_PHONE=1") }
        let names = ["Délégation WP12 A"]
        defer { deleteRoutines(named: names) }

        let app = XCUIApplication()
        app.terminate()
        var arguments = [
            "-parityEndpoint", endpoint, "-parityToken", token, "-parityScreen", "01-home",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-companion.onboarding.notificationsSeen", "YES",
        ]
        if let environment { arguments += ["-parityEnvironment", environment] }
        app.launchArguments = arguments
        app.launch()

        quickCreate(names[0], in: app)
        XCTAssertTrue(eventually(20) { self.routineExists(names[0]) })
        Thread.sleep(forTimeInterval: 4)
        XCTAssertFalse(app.element("routine-delegation-help").exists)
    }

    @MainActor
    private func quickCreate(_ name: String, in app: XCUIApplication) {
        if !app.segmentedControls["routines-section"].exists {
            // Automations opens from the account menu, under Settings
            XCTAssertTrue(app.buttons["home-apps"].waitForExistence(timeout: 30))
            app.buttons["home-apps"].tap()
            let automations = app.buttons["account-menu.automations"]
            XCTAssertTrue(automations.waitForExistence(timeout: 5))
            automations.tap()
            XCTAssertTrue(app.segmentedControls["routines-section"].waitForExistence(timeout: 15))
            app.element("automations-next").tap()
        }
        let hour = app.element(name.hasSuffix("A") ? "automations-hour.10" : "automations-hour.14")
        for _ in 0..<6 where !hour.isHittable { app.swipeUp() }
        XCTAssertTrue(hour.waitForExistence(timeout: 10))
        hour.tap()
        let title = app.element("automations-quick-title")
        XCTAssertTrue(title.waitForExistence(timeout: 10))
        title.tap()
        title.typeText(name)
        let prompt = app.element("automations-quick-prompt")
        prompt.tap()
        prompt.typeText("Texte de remplacement pour le test WP12.")
        app.element("automations-quick-save").tap()
    }

    private func routines() -> [[String: Any]] {
        api("GET", "/api/routines").1["routines"] as? [[String: Any]] ?? []
    }

    private func routineExists(_ name: String) -> Bool {
        routines().contains { $0["name"] as? String == name }
    }

    private func deleteRoutines(named names: [String]) {
        for routine in routines() where names.contains(routine["name"] as? String ?? "") {
            if let id = routine["id"] as? String { api("DELETE", "/api/routines/\(id)") }
        }
    }
}

private extension XCUIApplication {
    func element(_ identifier: String) -> XCUIElement {
        descendants(matching: .any).matching(identifier: identifier).firstMatch
    }
}
