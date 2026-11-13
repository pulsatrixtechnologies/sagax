import XCTest

/// Connect apps (#203, #206, #207, #218; matrix DC35 to DC39): the main view,
/// Manage, an app's and a server's page, Providers, against the
/// parity fixture's plugins lab (`PARITY_PLUGINS=1`, ios/parity/plugin-lab.mjs).
/// Every action is a real request to the real server; each result is read
/// back through the API (the managed connected-apps broker is gone).
///
///   PARITY_PLUGINS=1 node ios/parity/fixture-server.mjs &
///   TEST_RUNNER_PARITY_ENDPOINT=... TEST_RUNNER_PARITY_TOKEN=... \
///   TEST_RUNNER_PARITY_ENVIRONMENT=... xcodebuild test \
///     -only-testing:SagaxUITests/PluginsUITests ...
///
/// The fixture pairs with the admin scope, so every row the gate allows on
/// an admin pairing shows; the sidecar and client-session gates are unit
/// tested (PluginsParityTests).
final class PluginsUITests: XCTestCase {
    private var arguments: [String] = []
    private var endpoint = ""
    private var token = ""

    override func setUpWithError() throws {
        continueAfterFailure = false
        // the phone's Settings > Connect apps (-parityScreen 15-plugins); the iPad's desktop shell opens
        // plugins in its Capabilities window, covered by the Desktop* and YourConnections suites
        try XCTSkipIf(UIDevice.current.userInterfaceIdiom == .pad, "the phone's Settings > Connect apps; the iPad's Capabilities window is the desktop's")
        let env = ProcessInfo.processInfo.environment
        guard let endpoint = env["PARITY_ENDPOINT"], let token = env["PARITY_TOKEN"] else {
            throw XCTSkip("no parity fixture: set TEST_RUNNER_PARITY_ENDPOINT and TEST_RUNNER_PARITY_TOKEN")
        }
        self.endpoint = endpoint
        self.token = token
        guard api("GET", "/__parity/plugins").0 == 200 else {
            throw XCTSkip("start the fixture with PARITY_PLUGINS=1 for the plugins lab")
        }
        arguments = ["-parityEndpoint", endpoint, "-parityToken", token, "-parityScreen", "15-plugins"]
        if let environment = env["PARITY_ENVIRONMENT"], !environment.isEmpty {
            arguments += ["-parityEnvironment", environment]
        }
    }

    @MainActor
    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.terminate()
        app.launchArguments = arguments
        app.launch()
        // Settings > Connect apps (#203, #218)
        XCTAssertTrue(app.element("connect-apps-manage").waitForExistence(timeout: 20), app.debugDescription)
        return app
    }

    /// Scrolls the list to a row and opens it.
    @MainActor
    private func open(_ identifier: String, in app: XCUIApplication) {
        let row = app.element(identifier)
        for _ in 0..<16 where !(row.exists && row.isHittable) {
            // Manage shows the first installed plugins, then Show all
            let showAll = app.element("connect-apps-show-all")
            if !row.exists, showAll.exists, showAll.isHittable, showAll.label.hasPrefix("Show all") { showAll.tap(); continue }
            scrollStep(app)
        }
        XCTAssertTrue(row.waitForExistence(timeout: 10), app.debugDescription)
        row.tap()
    }

    /// Half a page up: a full swipe can fling a lazy row past the screen
    /// between two checks.
    @MainActor
    private func scrollStep(_ app: XCUIApplication) {
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.75))
        start.press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4)))
    }

    // MARK: API

    @discardableResult
    private func api(_ method: String, _ path: String, body: [String: Any]? = nil) -> (Int, [String: Any]) {
        var request = URLRequest(url: URL(string: endpoint + path)!, timeoutInterval: 140)
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
        _ = done.wait(timeout: .now() + 150)
        return result
    }

    private func eventually(_ timeout: TimeInterval = 10, _ check: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if check() { return true }
            Thread.sleep(forTimeInterval: 0.3)
        }
        return check()
    }

    // MARK: Connect apps

    /// The main view: one row per app with Add or Connect, a section per
    /// category, and "N connected" to what is connected (#203, #218).
    /// Discover has no "Browse Bots" button (2026-10-29): Bots is one of
    /// the chips that scroll sideways (#4103), for every bot.
    @MainActor
    func testDiscoverHasNoBrowseBotsButtonAndBotsIsAChip() {
        let app = launch()
        let botsChip = chip("bots", in: app)
        XCTAssertFalse(app.element("connect-apps-bot-templates").exists, "no Browse Bots button in Discover")
        XCTAssertFalse(app.element("connect-apps-chip.providers").exists, "Providers is a section of Installed")
        ParityShots.save("Connect apps Discover", app)
        botsChip.tap()
        XCTAssertTrue(eventually(5) { botsChip.isSelected }, "the Bots chip is in front")
        XCTAssertFalse(app.element("connect-apps-chip.all").isSelected)
        XCTAssertTrue(app.element("connect-apps-manage").exists, "Connect apps stays open")
        XCTAssertTrue(app.element("browse-bots.category.all").waitForExistence(timeout: 10), "Browse Bots' categories in the chip's list")
        ParityShots.save("Connect apps Bots chip", app)
    }

    /// One search on every list: the bots are found from what is connected
    /// too, in their own group, and a hit opens the bot's card.
    @MainActor
    func testOneSearchFindsBotsFromAnyTab() {
        let app = launch()
        app.element("connect-apps-manage").tap()
        // the floating search at the sheet's foot (#4103)
        let field = app.textFields["connect-apps-search"]
        XCTAssertTrue(field.waitForExistence(timeout: 10), "the search shows on what is connected")
        field.tap()
        field.typeText("Aurora")
        let hit = app.staticTexts["Aurora"].firstMatch
        XCTAssertTrue(hit.waitForExistence(timeout: 15), app.debugDescription)
        ParityShots.save("Connect apps search", app)
        hit.tap()
        XCTAssertTrue(app.element("browse-bots.action.open").waitForExistence(timeout: 10), "the bot's card")
    }

    @MainActor
    func testTheMainViewListsAppsAndCountsWhatIsConnected() {
        let app = launch()
        XCTAssertTrue(chip("all", in: app).isSelected, "All is the chip in front")
        let manage = app.element("connect-apps-manage")
        XCTAssertTrue(manage.label.contains("connected"), manage.label)
        // the featured connectors (the managed connected-apps broker is gone)
        let notion = app.element("connect-apps-action.featured:notion")
        XCTAssertTrue(notion.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertEqual(notion.label, "Connect")
    }

    /// The chips (the reference's row that scrolls sideways, #4103): a type
    /// chip narrows the list to that type, pressed again or All goes back.
    @MainActor
    func testATypeChipPicksATypeAndAllClears() {
        let app = launch()
        let all = chip("all", in: app)
        let skills = chip("type.skills", in: app)
        skills.tap()
        XCTAssertTrue(eventually(5) { skills.isSelected && !all.isSelected })
        // a featured app is no skill: the type hides it
        XCTAssertTrue(eventually(5) { !app.element("connect-apps-row.featured:notion").exists }, app.debugDescription)
        let back = chip("all", in: app)
        back.tap()
        XCTAssertTrue(eventually(5) { back.isSelected && !skills.isSelected })
        XCTAssertTrue(app.element("connect-apps-row.featured:notion").waitForExistence(timeout: 10), app.debugDescription)
    }

    /// A chip, scrolled sideways into reach.
    @MainActor
    private func chip(_ key: String, in app: XCUIApplication) -> XCUIElement {
        let chip = app.element("connect-apps-chip.\(key)")
        XCTAssertTrue(chip.waitForExistence(timeout: 10), app.debugDescription)
        let row = app.element("connect-apps-tabs")
        for _ in 0..<8 where !chip.isHittable { row.swipeLeft() }
        for _ in 0..<8 where !chip.isHittable { row.swipeRight() }
        XCTAssertTrue(chip.isHittable, key)
        return chip
    }

    // MARK: MCP servers

    /// A server's sheet: its one sign-in, the Authorize pill at the foot
    /// (#4103; no second Sign in in its Accounts section), runs the real
    /// OAuth flow in the system sheet and the server reaches connected.
    @MainActor
    func testMcpServerSignInFromItsPage() {
        api("POST", "/api/mcp/servers/oauthdocs/oauth/disconnect", body: [:])
        let app = launch()
        app.element("connect-apps-manage").tap()
        open("connect-apps-installed.mcp:oauthdocs", in: app)
        // the Authorize pill, or the Accounts row's Sign in when the server
        // is turned off (its pill then says Off): never both
        let row = app.element("connect-apps-sign-in")
        let pill = app.element("connect-apps-detail-action")
        XCTAssertTrue(eventually(15) { row.exists || pill.exists }, app.debugDescription)
        XCTAssertFalse(row.exists && pill.exists, "one sign-in on the sheet")
        let signIn = row.exists ? row : pill
        if signIn == pill { XCTAssertEqual(pill.label, "Authorize") }
        // the half sheet opens at its medium height: the Accounts row can
        // sit under the foot pill on a small phone, so raise it first
        if signIn == row { app.element("connect-apps-detail-header").swipeUp() }
        signIn.tap()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let proceed = springboard.buttons["Continue"]
        XCTAssertTrue(proceed.waitForExistence(timeout: 15))
        proceed.tap()
        XCTAssertTrue(eventually(60) {
            let servers = self.api("GET", "/api/mcp/servers").1["servers"] as? [[String: Any]] ?? []
            return servers.first { $0["name"] as? String == "oauthdocs" }?["auth"] as? String == "connected"
        })
        api("POST", "/api/mcp/servers/oauthdocs/oauth/disconnect", body: [:])
    }

    // MARK: Claude connectors

    /// PL7: the person's claude.ai answer and Manage; the admin switch is
    /// retired (always on since #168).
    @MainActor
    func testClaudeConnectorsShowTheAnswerAndNoAdminSwitch() {
        // Installed > Providers (#207; Providers is a section of Installed since 2026-10-29)
        // "N connected" opens what is connected (#4103: no tabs on the phone)
        let app = launch()
        app.element("connect-apps-manage").tap()
        let manage = app.element("harness-connectors-manage")
        for _ in 0..<16 where !(manage.exists && manage.isHittable) { scrollStep(app) }
        XCTAssertTrue(manage.waitForExistence(timeout: 30), app.debugDescription)
        let empty = app.element("harness-connectors-empty")
        let unavailable = app.element("harness-connectors-unavailable")
        XCTAssertTrue(eventually(100) { empty.exists || unavailable.exists })

        // always allowed on a server (#168): no admin switch any more
        XCTAssertFalse(app.element("harness-connectors-allow.toggle").exists, "the retired admin switch is gone")
        XCTAssertEqual(api("GET", "/api/me/harness-connectors").1["enabled"] as? Bool, true)
    }
}

private extension XCUIApplication {
    func element(_ identifier: String) -> XCUIElement {
        descendants(matching: .any).matching(identifier: identifier).firstMatch
    }
}
