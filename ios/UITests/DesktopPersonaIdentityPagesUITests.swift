import XCTest

/// Edit bot > Identity, Changes and Usage on the iPad desktop shell
/// (PersonaOverview.tsx, HistorySection.tsx, UsageSection.tsx), against the
/// parity fixture: the mascot with the name and label edited in place, the
/// Short description and At a glance; Changes as one card of versions that
/// open on what they changed; Usage as its group.
///
///   bash ipad-uitests-<prefix>.sh DesktopPersonaIdentityPagesUITests
final class DesktopPersonaIdentityPagesUITests: XCTestCase {
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

    private func api(_ method: String, _ path: String, _ body: [String: Any]? = nil) throws -> Any? {
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
        return result.flatMap { try? JSONSerialization.jsonObject(with: $0) }
    }

    private func ara() throws -> [String: Any]? {
        let payload = try api("GET", "/api/bots")
        let bots = (payload as? [[String: Any]]) ?? ((payload as? [String: Any])?["bots"] as? [[String: Any]]) ?? []
        return bots.first { $0["name"] as? String == "Ara" }
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

    @MainActor
    func testIdentityEditsTheLabelInPlaceAndShowsAtAGlance() throws {
        let app = launch("panel-more-overview")
        XCTAssertTrue(element(app, "persona-overview").waitForExistence(timeout: 15), "the Identity page")
        XCTAssertTrue(element(app, "persona-overview.avatar").exists, "the mascot")
        XCTAssertTrue(element(app, "persona-overview.name").exists, "the name")
        XCTAssertTrue(element(app, "persona-overview.description").exists, "Short description")
        XCTAssertTrue(element(app, "settings-group.personaSummary").exists, "At a glance")
        for row in ["engine", "model", "owner", "sharing"] {
            XCTAssertTrue(element(app, "settings-row.persona-overview.\(row)").exists, "the \(row) row")
        }
        XCTAssertTrue(app.staticTexts["At a glance"].exists)
        XCTAssertTrue(app.staticTexts["Short description"].exists)

        let before = try XCTUnwrap(try ara()?["title"] as? String)
        defer { _ = try? api("PATCH", "/api/bots/\((try? ara()?["id"] as? String) ?? "")", ["title": before]) }
        element(app, "persona-overview.title").tap()
        let field = element(app, "persona-overview.title.field")
        XCTAssertTrue(field.waitForExistence(timeout: 5), "the label field in place")
        field.typeText(" Lead\n")
        try eventually("the label saved on the server") { (try ara()?["title"] as? String) == before + " Lead" }
        XCTAssertTrue(element(app, "persona-overview.title").waitForExistence(timeout: 5), "back to the text")

        element(app, "persona-overview.avatar").tap()
        XCTAssertTrue(element(app, "desktop-bot-profile-host").waitForExistence(timeout: 5), "Appearance stays in the main column")
        XCTAssertTrue(element(app, "desktop-persona-window.page.appearance").waitForExistence(timeout: 5), "the mascot opens Appearance")
        XCTAssertFalse(element(app, "desktop-persona-window").exists, "no centred Edit bot window")
    }

    @MainActor
    func testChangesIsOneCardOfVersionsThatOpen() throws {
        let app = launch("panel-more-history")
        let versions = element(app, "persona-changes.versions")
        let empty = element(app, "persona-changes.empty")
        try eventually("the versions or the empty line") { versions.exists || empty.exists }
        guard versions.exists else { return }
        XCTAssertTrue(element(app, "persona-changes.current").exists, "the Current version chip")
        let row = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'persona-changes.version.'")).firstMatch
        XCTAssertTrue(row.exists, "a version row")
        let id = row.identifier.replacingOccurrences(of: "persona-changes.version.", with: "")
        row.tap()
        XCTAssertTrue(element(app, "persona-changes.details.\(id)").waitForExistence(timeout: 5), "the row opens on its changes")
        row.tap()
        XCTAssertFalse(element(app, "persona-changes.details.\(id)").waitForExistence(timeout: 2), "and closes")
    }

    @MainActor
    func testUsageIsItsGroup() throws {
        let app = launch("panel-more-usage")
        XCTAssertTrue(element(app, "settings-group.botUsage").waitForExistence(timeout: 15), "the Usage group")
        XCTAssertTrue(element(app, "persona-usage.empty").exists || element(app, "settings-row.persona-usage.turns").exists,
                      "the empty line or the figures")
    }
}
