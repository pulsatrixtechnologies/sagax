import XCTest

/// The bot's profile page in the main column (#2136 / #1939): a tap on the
/// bot panel's mascot opens Appearance there, X returns to the chat, and
/// the panel's "..." Edit bot opens the profile root (General | Knowledge).
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
    func testAvatarTapOpensProfileOnAppearanceAndEditBotOpensRoot() throws {
        let before = try XCTUnwrap(try ara())
        let id = try XCTUnwrap(before["id"] as? String)
        defer { _ = try? api("PATCH", "/api/bots/\(id)", ["color": "purple", "mascotLook": ["character": "owl"], "mascotSkin": "none"]) }
        _ = try api("PATCH", "/api/bots/\(id)", ["color": "purple", "mascotLook": ["character": "owl"], "mascotSkin": "none"])

        let app = launch("panel-details")
        let avatar = element(app, "desktop-panel-avatar")
        XCTAssertTrue(avatar.waitForExistence(timeout: 30), "the panel's mascot")
        avatar.tap()

        let host = element(app, "desktop-bot-profile-host")
        let appearancePage = element(app, "desktop-persona-window.page.appearance")
        let appearanceHero = element(app, "persona-appearance.hero")
        try eventually("the profile fills the main column on Appearance", timeout: 15) {
            host.exists || appearancePage.exists || appearanceHero.exists
        }
        XCTAssertFalse(element(app, "desktop-persona-window").exists, "no centred Edit bot window")

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

        // X closes the profile and brings the chat back (panel stays closed, #2136)
        let close = element(app, "window-close")
        XCTAssertTrue(close.waitForExistence(timeout: 10), "the page X")
        close.tap()
        try eventually("X returns to the chat", timeout: 5) {
            !host.exists && !appearanceHero.exists
        }

        // Re-open the panel from the chat pill, then ... Edit bot opens the profile root
        let pill = element(app, "desktop-chat-pill")
        XCTAssertTrue(pill.waitForExistence(timeout: 10), "the chat pill after X")
        pill.tap()
        // No ... in the top bar: the bot's menu is a long press on its identity
        let identity = element(app, "bot-panel.identity")
        XCTAssertTrue(identity.waitForExistence(timeout: 10), "the panel's identity")
        identity.press(forDuration: 1.2)
        // Context menu rows keep their label; the identifier may not reach them
        let byId = element(app, "bot-panel.action.editBot")
        let editBot = byId.waitForExistence(timeout: 3) ? byId : app.buttons["Edit bot"].firstMatch
        XCTAssertTrue(editBot.waitForExistence(timeout: 5), "Edit bot in the menu")
        editBot.tap()
        XCTAssertTrue(element(app, "desktop-bot-profile-host").waitForExistence(timeout: 10), "Edit bot opens the profile")
        XCTAssertTrue(element(app, "bot-profile-page").waitForExistence(timeout: 5), "the bot profile page")
        let general = element(app, "bot-profile-tab.general")
        let knowledge = element(app, "bot-profile-tab.knowledge")
        let name = element(app, "bot-profile-name")
        try eventually("profile root shows General / Knowledge", timeout: 10) {
            (general.exists && knowledge.exists) || name.exists
        }
        XCTAssertFalse(element(app, "bot-profile-tab.settings").exists, "Settings is folded into General")
    }
}
