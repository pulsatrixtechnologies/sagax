import XCTest

/// The bot editor ("Edit bot", PersonaEditorModal.tsx) on the iPad desktop
/// shell, against the parity fixture: a tap on the bot panel's mascot opens
/// the centred window on Appearance (the mascot gallery), a nav entry
/// switches the page, a pick saves the look on the server, and the panel's
/// "..." Edit bot opens it on Identity.
///
///   bash ipad-uitests-<prefix>.sh DesktopPersonaWindowUITests
final class DesktopPersonaWindowUITests: XCTestCase {
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
    func testAvatarTapOpensEditBotOnAppearanceAndTheNavSwitchesPages() throws {
        let before = try XCTUnwrap(try ara())
        let id = try XCTUnwrap(before["id"] as? String)
        defer { _ = try? api("PATCH", "/api/bots/\(id)", ["color": "purple", "mascotLook": ["character": "owl"], "mascotSkin": "none"]) }
        _ = try api("PATCH", "/api/bots/\(id)", ["color": "purple", "mascotLook": ["character": "owl"], "mascotSkin": "none"])

        let app = launch("panel-details")
        let avatar = element(app, "desktop-panel-avatar")
        XCTAssertTrue(avatar.waitForExistence(timeout: 30), "the panel's mascot")
        avatar.tap()

        let window = element(app, "desktop-persona-window")
        XCTAssertTrue(window.waitForExistence(timeout: 10), "the Edit bot window")
        XCTAssertTrue(element(app, "desktop-persona-window.bot").exists, "the bot's name under Edit bot")
        XCTAssertTrue(element(app, "desktop-persona-window.page.appearance").waitForExistence(timeout: 5), "opened on Appearance")
        XCTAssertTrue(element(app, "desktop-persona-window.nav.appearance").isSelected, "Appearance is the current entry")
        for page in ["overview", "summary", "soul", "rules", "skills", "files", "model", "worksOn", "access", "voice", "permissions", "perspicax"] {
            XCTAssertTrue(element(app, "desktop-persona-window.nav.\(page)").exists, "the \(page) entry")
        }

        // the Appearance page: the modes, the hero and the gallery
        XCTAssertTrue(element(app, "persona-appearance.mode.mascot").isSelected, "Mascot is the source")
        XCTAssertTrue(element(app, "persona-appearance.hero").waitForExistence(timeout: 10), "the preview band")
        XCTAssertTrue(element(app, "persona-appearance.play").exists, "Play a move")
        XCTAssertTrue(element(app, "persona-appearance.randomize").exists, "Randomize")
        XCTAssertTrue(element(app, "persona-appearance.tab.color").exists, "the Color tab")
        XCTAssertTrue(element(app, "persona-appearance.filter.all").exists, "the All chip")
        XCTAssertTrue(element(app, "persona-appearance.shelf.yours").exists, "the Yours shelf")
        let owl = element(app, "persona-appearance.character.owl")
        XCTAssertTrue(owl.exists, "the owl tile")

        // a pick saves the look through the profile route
        let shapes = element(app, "persona-appearance.character.shape")
        XCTAssertTrue(shapes.exists, "the Shapes tile")
        shapes.tap()
        try eventually("Ara wears Shapes on the server") {
            ((try ara())?["mascotLook"] as? [String: Any])?["character"] as? String == "shape"
        }
        XCTAssertTrue(element(app, "persona-appearance.tab.shape").waitForExistence(timeout: 5), "Shapes offers its Shape tab")

        // the nav switches the page
        element(app, "desktop-persona-window.nav.skills").tap()
        XCTAssertTrue(element(app, "desktop-persona-window.page.skills").waitForExistence(timeout: 5), "the Skills page")
        XCTAssertTrue(element(app, "desktop-persona-window.nav.skills").isSelected)
        XCTAssertFalse(element(app, "persona-appearance").exists, "Appearance left the pane")
        element(app, "desktop-persona-window.nav.overview").tap()
        XCTAssertTrue(element(app, "desktop-persona-window.page.overview").waitForExistence(timeout: 5), "the Identity page")
        XCTAssertTrue(element(app, "persona-overview.name").waitForExistence(timeout: 5), "Identity edits the name in place")

        // the search narrows the column
        let search = element(app, "desktop-persona-window.search")
        search.tap()
        search.typeText("rules")
        XCTAssertTrue(element(app, "desktop-persona-window.nav.rules").waitForExistence(timeout: 5))
        XCTAssertFalse(element(app, "desktop-persona-window.nav.model").exists, "Model is filtered out")

        element(app, "desktop-persona-close").tap()
        XCTAssertFalse(window.waitForExistence(timeout: 2), "Close closes the window")

        // the panel's ... Edit bot opens it on Identity
        let more = element(app, "desktop-panel-menu")
        XCTAssertTrue(more.waitForExistence(timeout: 5), "the panel's ... menu")
        more.tap()
        let editBot = element(app, "desktop-panel-action.editBot")
        XCTAssertTrue(editBot.waitForExistence(timeout: 5), "Edit bot in the menu")
        editBot.tap()
        XCTAssertTrue(element(app, "desktop-persona-window.page.overview").waitForExistence(timeout: 10), "Edit bot opens on Identity")
    }
}
