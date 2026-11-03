import XCTest

/// The iPad's Settings and Plugins modals (I5) against the parity fixture
/// server: ⌘, opens Settings, the nav and its search move between sections,
/// a switch saves through `PUT /api/config` (checked on the server, then put
/// back), and Connected apps opens the Plugins modal on its two tabs.
///
///   node ios/parity/fixture-server.mjs &
///   TEST_RUNNER_PARITY_ENDPOINT=... TEST_RUNNER_PARITY_TOKEN=... \
///   xcodebuild test -only-testing:SagaxUITests/DesktopSettingsUITests \
///     -destination 'platform=iOS Simulator,name=<an iPad>' ...
///
/// Skipped on an iPhone (the desktop shell is iPad only) and without a fixture.
final class DesktopSettingsUITests: XCTestCase {
    private var endpoint = ""
    private var token = ""
    private var environment: String?

    override func setUpWithError() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        guard let endpoint = env["PARITY_ENDPOINT"], let token = env["PARITY_TOKEN"], !token.isEmpty else {
            throw XCTSkip("no parity fixture: set TEST_RUNNER_PARITY_ENDPOINT and TEST_RUNNER_PARITY_TOKEN")
        }
        guard UIDevice.current.userInterfaceIdiom == .pad else {
            throw XCTSkip("the desktop modals are the iPad's")
        }
        self.endpoint = endpoint
        self.token = token
        environment = env["PARITY_ENVIRONMENT"].flatMap { $0.isEmpty ? nil : $0 }
    }

    @MainActor
    private func launch() -> XCUIApplication {
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication()
        app.terminate()
        var arguments = [
            "-parityEndpoint", endpoint, "-parityToken", token, "-parityIPadScreen", "main",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES",
        ]
        if let environment { arguments += ["-parityEnvironment", environment] }
        app.launchArguments = arguments
        app.launch()
        XCTAssertTrue(app.buttons["desktop-sidebar-account"].waitForExistence(timeout: 30), "the desktop shell")
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
        let status = (result.1 as? HTTPURLResponse)?.statusCode ?? 0
        XCTAssertTrue((200...299).contains(status), "\(method) \(path) -> \(status)")
        guard let data = result.0, !data.isEmpty else { return nil }
        return try JSONSerialization.jsonObject(with: data)
    }

    private func feature(_ name: String) throws -> Bool? {
        ((try api("GET", "/api/config") as? [String: Any])?["features"] as? [String: Any])?[name] as? Bool
    }

    @MainActor
    func testCommandCommaOpensSettingsAndASwitchSaves() throws {
        let app = launch()
        // The simulator's first key event after launch only gives the window
        // the keyboard: ⌘\ twice (rail and back) takes it, then ⌘,.
        app.typeKey("\\", modifierFlags: .command)
        app.typeKey("\\", modifierFlags: .command)
        XCTAssertTrue(app.otherElements["desktop-sidebar-full"].waitForExistence(timeout: 5))
        app.typeKey(",", modifierFlags: .command)
        let settings = app.buttons["desktop-settings.close"]
        XCTAssertTrue(settings.waitForExistence(timeout: 10), "⌘, opens Settings")

        // the nav moves between sections
        app.buttons["desktop-settings.nav.experimental"].tap()
        let skills = app.buttons["desktop-settings.skill-authoring"]
        XCTAssertTrue(skills.waitForExistence(timeout: 10))
        let before = try feature("skillAuthoring") ?? true
        skills.tap()
        let flipped = NSPredicate { _, _ in (try? self.feature("skillAuthoring")) == !before }
        wait(for: [XCTNSPredicateExpectation(predicate: flipped, object: nil)], timeout: 15)
        try api("PUT", "/api/config", ["features": ["skillAuthoring": before]])

        // the search keeps the matching sections only
        let search = app.textFields["desktop-settings.search"]
        search.tap()
        search.typeText("openrouter")
        // API keys is a card of Providers (the desktop's page of 2026-10-30)
        XCTAssertTrue(app.buttons["desktop-settings.nav.providers"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["desktop-settings.nav.backups"].exists)
        XCTAssertFalse(app.buttons["desktop-settings.nav.companion"].exists, "Pair devices left the app")
        // the search opens the API keys card
        let key = app.secureTextFields["settings-key.openrouter"]
        _ = key.waitForExistence(timeout: 5)
        for _ in 0..<8 where !(key.exists && key.isHittable) { app.swipeUp() }
        XCTAssertTrue(key.waitForExistence(timeout: 5), "API keys opens")

        settings.tap()
        XCTAssertFalse(settings.waitForExistence(timeout: 2))
    }

    @MainActor
    func testConnectedAppsOpensPluginsOnBothTabs() throws {
        let app = launch()
        // the foot's round Capabilities button (2026-10-27)
        app.buttons["desktop-sidebar-capabilities"].tap()
        let close = app.buttons["desktop-plugins.close"]
        XCTAssertTrue(close.waitForExistence(timeout: 10), "Capabilities opens")
        // Me: Connect apps (Discover, Bots, Installed, Sources), one search
        XCTAssertTrue(app.descendants(matching: .any)["connect-apps-tabs"].firstMatch.waitForExistence(timeout: 10))
        // This bot: the open bot's capabilities
        let thisBot = app.buttons["desktop-capabilities.scope.bot"]
        XCTAssertTrue(thisBot.waitForExistence(timeout: 5), "This bot while a bot is open")
        thisBot.tap()
        XCTAssertFalse(app.descendants(matching: .any)["connect-apps-tabs"].firstMatch.waitForExistence(timeout: 2))
        close.tap()
        XCTAssertFalse(close.waitForExistence(timeout: 2))
    }
}
