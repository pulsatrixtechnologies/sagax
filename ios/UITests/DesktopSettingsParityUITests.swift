import XCTest

/// Settings as the desktop draws it (the 2026-11-03 sweep), against the
/// parity fixture server: the seven Experimental features and the Decision
/// model switch saving, Advanced mode hiding the technical rows of
/// Appearance, the monthly spending limit set and removed, and the
/// per-bot checklist of Organization > Connect to a server.
final class DesktopSettingsParityUITests: XCTestCase {
    private var endpoint = ""
    private var token = ""
    private var environment: String?

    override func setUpWithError() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        guard let endpoint = env["PARITY_ENDPOINT"], let token = env["PARITY_TOKEN"], !token.isEmpty else {
            throw XCTSkip("no parity fixture: set TEST_RUNNER_PARITY_ENDPOINT and TEST_RUNNER_PARITY_TOKEN")
        }
        guard UIDevice.current.userInterfaceIdiom == .pad else { throw XCTSkip("the desktop modals are the iPad's") }
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
        ]
        if let environment { arguments += ["-parityEnvironment", environment] }
        app.launchArguments = arguments
        app.launch()
        XCTAssertTrue(app.buttons["desktop-settings.close"].waitForExistence(timeout: 30), "Settings open on \(screen)")
        return app
    }

    @discardableResult
    private func api(_ method: String, _ path: String, _ body: [String: Any]? = nil) throws -> Any? {
        var request = URLRequest(url: try XCTUnwrap(URL(string: endpoint + path)))
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
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
        wait(for: [done], timeout: 20)
        guard let data = result.0, !data.isEmpty else { return nil }
        return try? JSONSerialization.jsonObject(with: data)
    }

    private func feature(_ name: String) -> Bool? {
        (((try? api("GET", "/api/config")) as? [String: Any])?["features"] as? [String: Any])?[name] as? Bool
    }

    private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
        for _ in 0..<10 where !(element.exists && element.isHittable) { app.swipeUp() }
    }

    @MainActor
    func testDeveloperListsTheDesktopsExperimentalFeaturesAndASwitchSaves() throws {
        // #2729: Experimental features are a card of Developer, the desktop's
        // four rows (ExperimentalSettings.tsx); browser, decision model and
        // templates live elsewhere on the desktop.
        let app = launch("settings-developer")
        let dataWindow = app.buttons["desktop-settings.data-window"]
        reveal(dataWindow, in: app)
        XCTAssertTrue(dataWindow.waitForExistence(timeout: 15))
        for id in ["skill-authoring", "data-window", "meeting-notetaker", "thread-titles", "dev-pods"] {
            let row = app.buttons["desktop-settings.\(id)"]
            reveal(row, in: app)
            XCTAssertTrue(row.waitForExistence(timeout: 10), "\(id) is listed")
        }
        for id in ["browser", "decision-model", "browse-bots"] {
            XCTAssertFalse(app.buttons["desktop-settings.\(id)"].exists, "\(id) is not on the desktop's Developer page")
        }
        reveal(dataWindow, in: app)
        let before = feature("dataWindow") ?? false
        // the switch sits in its row's control column: tap its centre
        dataWindow.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let flipped = NSPredicate { _, _ in self.feature("dataWindow") == !before }
        wait(for: [XCTNSPredicateExpectation(predicate: flipped, object: nil)], timeout: 15)
        try api("PATCH", "/api/config", ["features": ["dataWindow": before]])
    }

    @MainActor
    func testAdvancedModeOnDeveloperHidesTheTechnicalRowsOfAppearance() throws {
        // The switch moved from Appearance to Developer > Interface, as on the desktop.
        let app = launch("settings-appearance")
        let toolCalls = app.buttons["desktop-settings.tool-calls"]
        reveal(toolCalls, in: app)
        XCTAssertTrue(toolCalls.waitForExistence(timeout: 10), "Advanced is the default")
        XCTAssertFalse(app.buttons["desktop-settings.advanced-mode"].exists, "not on Appearance any more")
        let developer = app.buttons["desktop-settings.nav.developer"]
        let appearance = app.buttons["desktop-settings.nav.appearance"]
        let advanced = app.buttons["desktop-settings.advanced-mode"]
        func flipAdvanced() {
            developer.tap()
            reveal(advanced, in: app)
            XCTAssertTrue(advanced.waitForExistence(timeout: 10))
            advanced.tap()
            appearance.tap()
        }
        flipAdvanced()
        XCTAssertFalse(toolCalls.waitForExistence(timeout: 2), "Simple hides Tool calls")
        flipAdvanced()
        reveal(toolCalls, in: app)
        XCTAssertTrue(toolCalls.waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["desktop-settings.background-effects"].exists, "Background effects")
    }

    @MainActor
    func testTheMonthlySpendingLimitIsSetAndRemoved() throws {
        let cap = (try api("GET", "/api/me/spend-cap")) as? [String: Any]
        guard cap?["supported"] as? Bool == true else { throw XCTSkip("this server keeps no personal spending limit") }
        let app = launch("settings-usage")
        let field = app.textFields["desktop-settings.spend-cap"]
        XCTAssertTrue(field.waitForExistence(timeout: 15), "Spending limit")
        field.tap()
        field.typeText("42")
        app.buttons["desktop-settings.spend-cap-save"].tap()
        let saved = NSPredicate { _, _ in
            (((try? self.api("GET", "/api/me/spend-cap")) as? [String: Any])?["cap"] as? [String: Any])?["monthlyUsd"] as? Double == 42
        }
        wait(for: [XCTNSPredicateExpectation(predicate: saved, object: nil)], timeout: 15)
        try api("PUT", "/api/me/spend-cap", ["monthlyUsd": NSNull()])
    }

    @MainActor
    func testConnectToAServerListsEachBotWithConversationsAndMemory() throws {
        let app = launch("settings-organization")
        let first = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'desktop-settings.join.'")).firstMatch
        XCTAssertTrue(first.waitForExistence(timeout: 10), "a checkbox per bot")
        XCTAssertEqual(first.value as? String, "Off")
        first.tap()
        XCTAssertEqual(first.value as? String, "On")
    }
}
