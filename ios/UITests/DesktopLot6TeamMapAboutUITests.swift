import XCTest

/// iPad lot 6 (2026-11-03): the Team map's Add and Computers buttons, its
/// zoom controls and help line, and the About and Release notes windows,
/// against the parity fixture (TEST_RUNNER_PARITY_ENDPOINT and _TOKEN).
final class DesktopLot6TeamMapAboutUITests: XCTestCase {
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

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    @MainActor
    func testTeamMapHasAddComputersZoomAndTheHelpLine() throws {
        let app = launch("team-map")
        XCTAssertTrue(element(app, "desktop-team-map").waitForExistence(timeout: 30), "the Team map page")
        XCTAssertTrue(element(app, "team-map-add").waitForExistence(timeout: 10), "Add")
        XCTAssertTrue(element(app, "team-map-computers").exists, "the Computers button")
        XCTAssertTrue(app.staticTexts["Drag within a team to arrange · Drop in another team to move · Wheel zooms · Trackpad or Shift+wheel pans"].exists, "the desktop's help line")
        let fit = app.buttons["Fit teams to view"].firstMatch
        XCTAssertTrue(fit.waitForExistence(timeout: 5), "the % button")
        let before = fit.value as? String ?? ""
        app.buttons["Zoom in"].firstMatch.tap()
        let after = app.buttons["Fit teams to view"].firstMatch
        XCTAssertTrue(after.exists)
        XCTAssertNotEqual(after.value as? String, before, "zoom changes the percentage")
        element(app, "team-map-add").tap()
        XCTAssertTrue(app.buttons["Create team"].firstMatch.waitForExistence(timeout: 5), "Add > Create team")
    }

    @MainActor
    func testAboutIsTheDesktopsSmallWindowAndOpensReleaseNotes() throws {
        let app = launch("about-dialog")
        XCTAssertTrue(element(app, "desktop-about").waitForExistence(timeout: 30), "the About window")
        XCTAssertEqual(element(app, "about-title").label, "Sagax")
        let version = element(app, "about-version").label
        XCTAssertTrue(version.hasPrefix("Version ") && version.hasSuffix(" · iPadOS"), version)
        for id in ["about-release-notes", "about-github", "about-docs", "about-license", "about-footer"] {
            XCTAssertTrue(element(app, id).exists, id)
        }
        XCTAssertTrue(element(app, "about-footer").label.contains("Apache License 2.0"), "the Apache 2.0 mention")
        XCTAssertTrue(app.staticTexts["Documentation"].exists)
        element(app, "about-release-notes").tap()
        XCTAssertTrue(element(app, "release-notes-version").waitForExistence(timeout: 10), "Release notes with its version picker")
        XCTAssertFalse(element(app, "desktop-about").exists, "About closed")
        element(app, "release-notes-close").tap()
        XCTAssertFalse(element(app, "desktop-release-notes").waitForExistence(timeout: 2))
    }

    @MainActor
    func testTheAccountMenuHasNoHelpCenter() throws {
        let app = launch("main")
        app.buttons["desktop-sidebar-account"].tap()
        let help = app.buttons["desktop-menu.help"]
        XCTAssertTrue(help.waitForExistence(timeout: 10))
        help.tap()
        XCTAssertTrue(app.buttons["About"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Help Center"].exists, "the desktop has no Help Center")
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

    /// The Computers button opens the shelf (CanvasComputers.tsx) beside
    /// the canvas and closes it again.
    @MainActor
    func testTheComputersShelfOpensBesideTheCanvas() throws {
        let app = launch("team-map")
        let button = element(app, "team-map-computers")
        XCTAssertTrue(button.waitForExistence(timeout: 30), "the Computers button")
        button.tap()
        let shelf = element(app, "team-computers")
        XCTAssertTrue(shelf.waitForExistence(timeout: 10), "the Computers shelf")
        XCTAssertTrue(app.staticTexts["Drag a computer onto a team, or choose its team below. Bots on Auto will use it."].exists, "its intro")
        XCTAssertTrue(app.buttons["Local VM and other computers…"].exists, "its foot")
        app.buttons["Close computers"].firstMatch.tap()
        XCTAssertFalse(shelf.waitForExistence(timeout: 2), "closed")
    }

    /// A team's ⋯ menu: Move bots to, Shared instructions (saved on the
    /// server) and Team memory, then Rename and Delete.
    @MainActor
    func testTheTeamMenuOpensItsThreeEditors() throws {
        let app = launch("team-map")
        XCTAssertTrue(element(app, "desktop-team-map").waitForExistence(timeout: 30), "the Team map page")
        let menu = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Manage ' AND label ENDSWITH ' team' AND NOT (label CONTAINS 'Unassigned')")).firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 10), "a team's ⋯ menu")
        let team = String(menu.label.dropFirst("Manage ".count).dropLast(" team".count))
        menu.tap()
        XCTAssertTrue(app.buttons["Move bots to \(team)"].waitForExistence(timeout: 5), "Move bots to")
        XCTAssertTrue(app.buttons["Team memory"].exists, "Team memory")
        app.buttons["Shared instructions"].firstMatch.tap()
        let text = element(app, "section-context.text")
        XCTAssertTrue(text.waitForExistence(timeout: 10), "the shared instructions editor")
        text.tap()
        let words = "Parity sweep \(Int(Date().timeIntervalSince1970))"
        text.typeText(" " + words)
        element(app, "section-context.save").tap()
        let deadline = Date().addingTimeInterval(15)
        var saved = ""
        while Date() < deadline {
            saved = try api("GET", "/api/section-context?section=\(team.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? team)")["text"] as? String ?? ""
            if saved.contains(words) { break }
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        }
        XCTAssertTrue(saved.contains(words), "the instructions saved on the server")
        app.buttons["Close shared instructions"].firstMatch.tap()

        menu.tap()
        app.buttons["Team memory"].firstMatch.tap()
        XCTAssertTrue(element(app, "team-memory.add").waitForExistence(timeout: 10), "the team memory panel")
        app.buttons["Close team memory"].firstMatch.tap()
        menu.tap()
        app.buttons["Move bots to \(team)"].firstMatch.tap()
        XCTAssertTrue(element(app, "team-bots.save").waitForExistence(timeout: 10), "the bots panel")
        app.buttons["Close team dialog"].firstMatch.tap()
    }
}
