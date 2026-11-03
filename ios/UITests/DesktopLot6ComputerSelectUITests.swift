import XCTest

/// iPad lot 6 (2026-11-03): the sidebar's multi-select with its grouped
/// action bar, and the bot's computer in its own window, against the parity
/// fixture.
///
///   xcodebuild test -only-testing:SagaxUITests/DesktopLot6ComputerSelectUITests ...
///
/// All skip on an iPhone or without the fixture.
final class DesktopLot6ComputerSelectUITests: XCTestCase {
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
    private func launch(_ screen: String, extra: [String] = []) -> XCUIApplication {
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
        app.launchArguments = arguments + extra
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

    private func botNow(_ id: String) throws -> [String: Any]? {
        let bots = try api("GET", "/api/bots")["bots"] as? [[String: Any]] ?? []
        return bots.first { $0["id"] as? String == id }
    }

    private func bot(named name: String) throws -> [String: Any] {
        let bots = try api("GET", "/api/bots")["bots"] as? [[String: Any]] ?? []
        return try XCTUnwrap(bots.first { $0["name"] as? String == name }, "bot \(name)")
    }

    // MARK: Select

    /// "Select" in a bot row's menu opens the mode with that bot chosen; a
    /// tap on another row joins it; Pin in the bar pins both on the server;
    /// the bar then closes. Clear selection (X) leaves without changing.
    @MainActor
    func testSelectWithAGroupedPinReadBackThroughTheServer() throws {
        let aurora = try bot(named: "Aurora"), helix = try bot(named: "Helix")
        let auroraId = try XCTUnwrap(aurora["id"] as? String), helixId = try XCTUnwrap(helix["id"] as? String)
        let before = [aurora["pinned"] as? Bool ?? false, helix["pinned"] as? Bool ?? false]
        XCTAssertEqual(before, [false, false], "the lab starts with both unpinned")

        let app = launch("main")
        XCTAssertFalse(element(app, "desktop-select-bar").exists, "no bar before Select")
        let actions = element(app, "desktop-row-actions.\(auroraId)")
        XCTAssertTrue(actions.waitForExistence(timeout: 20), "Aurora's row actions")
        actions.tap()
        let select = element(app, "desktop-menu.select")
        XCTAssertTrue(select.waitForExistence(timeout: 5), "Select in the row menu")
        select.tap()
        XCTAssertTrue(element(app, "desktop-select-bar").waitForExistence(timeout: 5), "the action bar")
        for id in ["mark-read", "pin", "edit", "clear"] {
            XCTAssertTrue(element(app, "desktop-select-\(id)").exists, "the bar's \(id)")
        }
        element(app, "desktop-row.\(helixId)").tap()
        XCTAssertTrue(element(app, "desktop-select-bar").exists, "the bar stays while choosing")
        // two chosen: the bar says so
        XCTAssertTrue(app.descendants(matching: .any)["2 selected"].firstMatch.waitForExistence(timeout: 5), "2 selected")

        element(app, "desktop-select-pin").tap()
        try eventually("both bots pinned on the server") {
            let a = try botNow(auroraId)
            let h = try botNow(helixId)
            return a?["pinned"] as? Bool == true && h?["pinned"] as? Bool == true
        }
        try eventually("the bar closed", timeout: 5) { !element(app, "desktop-select-bar").exists }

        // back to the lab's state, through the same Select flow: Unpin
        let again = element(app, "desktop-row-actions.\(auroraId)")
        if again.waitForExistence(timeout: 10) {
            again.tap()
            element(app, "desktop-menu.select").tap()
            XCTAssertTrue(element(app, "desktop-select-bar").waitForExistence(timeout: 5))
            element(app, "desktop-select-clear").tap()
            try eventually("Clear selection closes the bar", timeout: 5) { !element(app, "desktop-select-bar").exists }
        }
        for id in [auroraId, helixId] { _ = try api("PATCH", "/api/bots/\(id)", ["pinned": false]) }
    }

    /// Edit opens Edit N bots; a changed section reviews and applies, and the
    /// server has the change; Undo puts the bots back.
    @MainActor
    func testEditSeveralBotsAppliesAndUndoes() throws {
        let aurora = try bot(named: "Aurora"), helix = try bot(named: "Helix")
        let auroraId = try XCTUnwrap(aurora["id"] as? String), helixId = try XCTUnwrap(helix["id"] as? String)
        let app = launch("sidebar-select")
        XCTAssertTrue(element(app, "desktop-select-bar").waitForExistence(timeout: 20), "the bar, two chosen")
        element(app, "desktop-select-edit").tap()
        XCTAssertTrue(element(app, "desktop-bulk-edit").waitForExistence(timeout: 10), "Edit 2 bots")
        element(app, "desktop-bulk-section.voice").tap()
        let speak = element(app, "desktop-bulk-speak")
        XCTAssertTrue(speak.waitForExistence(timeout: 5), "Read replies aloud")
        speak.coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: 0.5)).tap()
        element(app, "desktop-bulk-review").tap()
        XCTAssertTrue(element(app, "desktop-bulk-summary").waitForExistence(timeout: 5), "the summary line")
        element(app, "desktop-bulk-apply").tap()
        XCTAssertTrue(element(app, "desktop-bulk-counts").waitForExistence(timeout: 30), "the results")
        try eventually("both bots read replies aloud") {
            let a = try botNow(auroraId)
            let h = try botNow(helixId)
            return a?["speakReplies"] as? Bool == true && h?["speakReplies"] as? Bool == true
        }
        element(app, "desktop-bulk-undo").tap()
        XCTAssertTrue(element(app, "desktop-bulk-undone").waitForExistence(timeout: 30), "the bots are back")
        try eventually("both bots back as they were") {
            let a = try botNow(auroraId)
            let h = try botNow(helixId)
            return a?["speakReplies"] as? Bool != true && h?["speakReplies"] as? Bool != true
        }
    }

    // MARK: Computer window

    /// The Computer tab's "Open in a window" opens the bot's computer in the
    /// desktop's large window: the collapse button, the screen and the
    /// Watching / Take control segments; the collapse button closes it.
    @MainActor
    func testTheComputerOpensInItsOwnWindow() throws {
        let app = launch("panel-computer")
        let control = element(app, "desktop-computer-control")
        XCTAssertTrue(control.waitForExistence(timeout: 30), "the Allow control section")
        control.tap()
        app.buttons["Open in a window"].firstMatch.tap()
        let window = element(app, "desktop-computer-window")
        XCTAssertTrue(window.waitForExistence(timeout: 15), "the computer window")
        XCTAssertTrue(element(app, "desktop-computer-window-screen").exists, "the screen well")
        XCTAssertTrue(element(app, "desktop-computer-window-segments").exists, "Watching and Take control")
        element(app, "desktop-computer-window-watch").tap()
        XCTAssertTrue(element(app, "desktop-computer-window-take").exists, "Take control")
        element(app, "desktop-computer-window-close").tap()
        try eventually("the window closed", timeout: 10) { !window.exists }
    }

    /// The same, as a second window scene (the iPadOS multi-window path).
    @MainActor
    func testTheComputerOpensInItsOwnWindowAsASecondScene() throws {
        let app = launch("panel-computer", extra: ["-computerWindowScene", "YES"])
        let control = element(app, "desktop-computer-control")
        XCTAssertTrue(control.waitForExistence(timeout: 30), "the Allow control section")
        control.tap()
        app.buttons["Open in a window"].firstMatch.tap()
        XCTAssertTrue(element(app, "desktop-computer-window").waitForExistence(timeout: 20), "the computer window scene")
        XCTAssertTrue(element(app, "desktop-computer-window-segments").exists, "Watching and Take control")
    }
}
