import XCTest

/// iPad lot 5 (2026-11-03): the routine side panel, the bot-to-bot exchange
/// page and the Memory page's views, against the parity fixture.
///
///   PARITY_EXCHANGE=1 node ios/parity/fixture-server.mjs &
///   xcodebuild test -only-testing:SagaxUITests/DesktopLot5UITests ...
///
/// The exchange test skips without the exchange lab; all skip on an iPhone.
final class DesktopLot5UITests: XCTestCase {
    private var endpoint = ""
    private var token = ""
    private var environment: String?

    override func setUpWithError() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        guard let endpoint = env["PARITY_ENDPOINT"], let token = env["PARITY_TOKEN"], !token.isEmpty else {
            throw XCTSkip("no parity fixture: set TEST_RUNNER_PARITY_ENDPOINT and TEST_RUNNER_PARITY_TOKEN")
        }
        guard UIDevice.current.userInterfaceIdiom == .pad else { throw XCTSkip("the desktop shell is the iPad's") }
        self.endpoint = endpoint
        self.token = token
        environment = env["PARITY_ENVIRONMENT"].flatMap { $0.isEmpty ? nil : $0 }
    }

    @MainActor
    private func launch(_ screen: String) -> XCUIApplication {
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication()
        app.terminate()
        var arguments = [
            "-parityEndpoint", endpoint, "-parityToken", token, "-parityIPadScreen", screen,
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES",
            "-companion.sidebarPrefs.parity-harness", "{}",
        ]
        if let environment { arguments += ["-parityEnvironment", environment] }
        app.launchArguments = arguments
        app.launch()
        XCTAssertTrue(app.buttons["desktop-sidebar-account"].waitForExistence(timeout: 30), "the desktop shell")
        return app
    }

    private func api(_ method: String, _ path: String, _ body: [String: Any]? = nil) throws -> [String: Any] {
        var request = URLRequest(url: try XCTUnwrap(URL(string: endpoint + path)))
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let done = expectation(description: "\(method) \(path)")
        var result: Data?
        URLSession.shared.dataTask(with: request) { data, _, _ in result = data; done.fulfill() }.resume()
        wait(for: [done], timeout: 30)
        return (result.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]) ?? [:]
    }

    private func eventually(_ what: String, timeout: TimeInterval = 20, _ check: () throws -> Bool) throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if try check() { return }
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        }
        XCTFail("never true: \(what)")
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    // MARK: Routine panel

    /// The panel opens on a routine with its rows and the bar; Edit turns
    /// the name into a field with Save, Cancel comes back; Disable pauses
    /// the routine on the server and Enable resumes it.
    @MainActor
    func testRoutinePanelViewEditAndDisable() throws {
        let app = launch("routine-edit")
        let panel = element(app, "desktop-routine-panel")
        XCTAssertTrue(panel.waitForExistence(timeout: 30), "the routine panel")
        XCTAssertTrue(element(app, "desktop-routine-panel.trigger").exists, "the Trigger row")
        XCTAssertTrue(element(app, "desktop-routine-panel.active").exists, "the Active switch")
        XCTAssertTrue(element(app, "desktop-routine-panel.run").exists, "Run now")
        XCTAssertTrue(element(app, "desktop-routine-panel.delete").exists, "the trash")

        element(app, "desktop-routine-panel.edit").tap()
        XCTAssertTrue(element(app, "desktop-routine-panel.name").waitForExistence(timeout: 5), "the name in place")
        XCTAssertTrue(element(app, "desktop-routine-panel.save").exists, "Save")
        XCTAssertTrue(element(app, "desktop-routine-panel.duplicate").exists, "Duplicate under Advanced")
        app.buttons["Cancel"].firstMatch.tap()
        XCTAssertTrue(element(app, "desktop-routine-panel.run").waitForExistence(timeout: 5), "back to the view")

        let routines = try api("GET", "/api/routines")["routines"] as? [[String: Any]] ?? []
        let routine = try XCTUnwrap(routines.first { ($0["name"] as? String)?.hasPrefix("Scan skills") == true })
        let id = try XCTUnwrap(routine["id"] as? String)
        let enabled = routine["enabled"] as? Bool ?? true
        app.buttons[enabled ? "Disable" : "Enable"].firstMatch.tap()
        try eventually("the routine switched on the server") {
            let now = try api("GET", "/api/routines")["routines"] as? [[String: Any]] ?? []
            return now.first { $0["id"] as? String == id }?["enabled"] as? Bool == !enabled
        }
        app.buttons[enabled ? "Enable" : "Disable"].firstMatch.tap()
        try eventually("the routine back as it was") {
            let now = try api("GET", "/api/routines")["routines"] as? [[String: Any]] ?? []
            return now.first { $0["id"] as? String == id }?["enabled"] as? Bool == enabled
        }
    }

    // MARK: Bot-to-bot exchange

    /// Ara's chat shows the exchange Ara opened on Helios; it opens as a
    /// page over the chat column, with both bots' lines and Close Chat.
    @MainActor
    func testBotExchangeOpensAsAPageInTheColumn() throws {
        let bots = try api("GET", "/api/bots")["bots"] as? [[String: Any]] ?? []
        let ara = try XCTUnwrap(bots.first { $0["name"] as? String == "Ara" })
        guard let rows = ara["botConversations"] as? [[String: Any]], !rows.isEmpty else {
            throw XCTSkip("start the fixture with PARITY_EXCHANGE=1 for the exchange lab")
        }
        let app = launch("main")
        let araId = try XCTUnwrap(ara["id"] as? String)
        // Ara is pinned: her tile at the top of the sidebar
        let tile = element(app, "desktop-pinned.\(araId)")
        XCTAssertTrue(tile.waitForExistence(timeout: 15), "Ara's pinned tile")
        tile.tap()
        let line = element(app, "bot-conversation-line")
        if !line.waitForExistence(timeout: 15) {
            let fold = element(app, "chat.earlierConversations")
            XCTAssertTrue(fold.waitForExistence(timeout: 10), "the exchange line or its fold")
            fold.tap()
        }
        XCTAssertTrue(line.waitForExistence(timeout: 10), "the exchange line")
        line.tap()
        let page = element(app, "bot-conversation-page")
        XCTAssertTrue(page.waitForExistence(timeout: 10), "the exchange page")
        XCTAssertTrue(app.staticTexts["Les trois sauvegardes de la nuit sont complètes."].waitForExistence(timeout: 15), "Helios's line")
        XCTAssertTrue(app.staticTexts["Peux-tu vérifier les sauvegardes de la nuit ?"].exists, "Ara's line")
        XCTAssertFalse(element(app, "bot-conversation-readonly").exists, "no phone read-only pill on the iPad")
        XCTAssertTrue(app.buttons["desktop-sidebar-account"].isHittable, "a page in the column, the sidebar still there")
        element(app, "bot-conversation-close").tap()
        try eventually("the page closed", timeout: 5) { !page.exists }
    }

    // MARK: Memory

    /// The Memory page: the right rail folds and opens, Map shows the graph
    /// then Radial and Columns, Tags and Quality (Health, Journal) open.
    @MainActor
    func testMemoryViewsAndTheRightRail() throws {
        let app = launch("memory-page")
        let rail = element(app, "desktop-memory.rail")
        XCTAssertTrue(rail.waitForExistence(timeout: 30), "the right rail")
        element(app, "desktop-memory.rail-hide").tap()
        XCTAssertTrue(element(app, "desktop-memory.rail-show").waitForExistence(timeout: 5), "the folded strip")
        element(app, "desktop-memory.rail-show").tap()
        XCTAssertTrue(rail.waitForExistence(timeout: 5), "the rail again")

        element(app, "desktop-memory.tab.map").tap()
        XCTAssertTrue(element(app, "desktop-memory-map.layout.graph").waitForExistence(timeout: 15), "the Map view and its layouts")
        XCTAssertTrue(element(app, "desktop-memory-map.layout.graph").isSelected, "Graph by default")
        XCTAssertTrue(element(app, "desktop-memory-graph.settings-open").waitForExistence(timeout: 10), "the graph")
        element(app, "desktop-memory-graph.settings-open").tap()
        XCTAssertTrue(element(app, "desktop-memory-graph.settings").waitForExistence(timeout: 5), "the graph settings")
        app.buttons["Close the graph settings"].firstMatch.tap()
        element(app, "desktop-memory-map.layout.brain").tap()
        XCTAssertFalse(element(app, "desktop-memory-graph.settings-open").exists, "Radial in place of the graph")
        element(app, "desktop-memory-map.layout.columns").tap()
        XCTAssertTrue(element(app, "desktop-memory-map.play").exists, "the timeline")

        element(app, "desktop-memory.tab.tags").tap()
        XCTAssertTrue(app.staticTexts["The tags your notes carry, the most used, and those to tidy up."].waitForExistence(timeout: 5), "Tags")
        element(app, "desktop-memory.tab.quality").tap()
        XCTAssertTrue(app.staticTexts["How the memory holds up: its size, its age, its doubles, its writes."].waitForExistence(timeout: 5), "Quality")
        app.buttons["Journal"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Health"].exists, "Health and Journal")
    }
}
