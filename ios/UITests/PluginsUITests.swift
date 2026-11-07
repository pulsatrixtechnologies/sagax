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
    /// category, and "N connected >" to Manage (#203, #218).
    /// Discover has no "Browse Bots" button any more (2026-10-29): the
    /// Bots tab is its place, for every bot.
    @MainActor
    func testDiscoverHasNoBrowseBotsButtonAndBotsIsATab() {
        let app = launch()
        let botsTab = app.segmentedControls["connect-apps-tabs"].buttons["Bots"]
        XCTAssertTrue(botsTab.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertFalse(app.element("connect-apps-bot-templates").exists, "no Browse Bots button in Discover")
        XCTAssertFalse(app.segmentedControls["connect-apps-tabs"].buttons["Providers"].exists, "Providers is a section of Installed")
        ParityShots.save("Connect apps Discover", app)
        botsTab.tap()
        XCTAssertTrue(botsTab.isSelected, "the Bots tab is in front")
        XCTAssertTrue(app.element("connect-apps-manage").exists, "Connect apps stays open")
        XCTAssertTrue(app.element("browse-bots.category.all").waitForExistence(timeout: 10), "Browse Bots' categories in the tab")
        ParityShots.save("Connect apps Bots tab", app)
    }

    /// One search on every tab: the bots are found from Installed too, in
    /// their own group, and a hit opens the bot's card.
    @MainActor
    func testOneSearchFindsBotsFromAnyTab() {
        let app = launch()
        app.segmentedControls["connect-apps-tabs"].buttons["Installed"].tap()
        let field = app.searchFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10), "the search shows on Installed")
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
        XCTAssertTrue(app.element("connect-apps-filter").exists)
        let manage = app.element("connect-apps-manage")
        XCTAssertTrue(manage.label.contains("connected"), manage.label)
        // the featured connectors (the managed connected-apps broker is gone)
        let notion = app.element("connect-apps-action.featured:notion")
        XCTAssertTrue(notion.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertEqual(notion.label, "Connect")
    }

    /// One filter button (the reference iOS app's marketplace): the menu picks a
    /// type, the button names it, All goes back.
    @MainActor
    func testTheFilterMenuPicksATypeAndClears() {
        let app = launch()
        let filter = app.element("connect-apps-filter")
        XCTAssertTrue(filter.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(filter.label.contains("All"), filter.label)
        // the list row reports the whole width; the capsule is at its leading edge
        let capsule = filter.coordinate(withNormalizedOffset: CGVector(dx: 0.08, dy: 0.5))
        capsule.tap()
        let mcp = app.buttons["MCP servers"].firstMatch
        XCTAssertTrue(mcp.waitForExistence(timeout: 5), app.debugDescription)
        mcp.tap()
        XCTAssertTrue(eventually(5) { filter.label.contains("MCP servers") }, filter.label)
        filter.coordinate(withNormalizedOffset: CGVector(dx: 0.08, dy: 0.5)).tap()
        let all = app.buttons["All"].firstMatch
        XCTAssertTrue(all.waitForExistence(timeout: 5), app.debugDescription)
        all.tap()
        XCTAssertTrue(eventually(5) { filter.label.contains("All") && !filter.label.contains("MCP") }, filter.label)
    }

    // MARK: MCP servers

    /// A server's page: Sign in runs the real OAuth flow in the system sheet
    /// and the server reaches connected.
    @MainActor
    func testMcpServerSignInFromItsPage() {
        api("POST", "/api/mcp/servers/oauthdocs/oauth/disconnect", body: [:])
        let app = launch()
        app.element("connect-apps-manage").tap()
        open("connect-apps-installed.mcp:oauthdocs", in: app)
        let signIn = app.element("connect-apps-sign-in")
        XCTAssertTrue(signIn.waitForExistence(timeout: 15), app.debugDescription)
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
        let app = launch()
        app.element("connect-apps-manage").tap()
        let tabs = app.segmentedControls.firstMatch
        XCTAssertTrue(tabs.waitForExistence(timeout: 10))
        tabs.buttons["Installed"].tap()
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
