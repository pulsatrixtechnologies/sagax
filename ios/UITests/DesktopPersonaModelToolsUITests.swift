import XCTest

/// Edit bot > Model, Permissions and Voice on the iPad desktop shell
/// (bot-settings/ModelSection.tsx, PermissionsSection.tsx, VoiceSection.tsx),
/// against the parity fixture: each page draws the desktop's groups, and a
/// switch saves on the server through the bot's own route.
///
///   bash ipad-uitests-<prefix>.sh DesktopPersonaModelToolsUITests
final class DesktopPersonaModelToolsUITests: XCTestCase {
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

    /// Model: the "Model" group, Automatic recovery and the keep-warm card.
    @MainActor
    func testModelPageDrawsTheDesktopGroups() throws {
        let app = launch("panel-more-model")
        XCTAssertTrue(element(app, "persona-page.model").waitForExistence(timeout: 20), "the Model page")
        XCTAssertTrue(element(app, "settings-group.botModel").exists, "the Model group")
        XCTAssertTrue(element(app, "persona-model.default").exists, "Default model")
        XCTAssertTrue(element(app, "persona-model.recovery").exists, "Automatic recovery")
        XCTAssertTrue(element(app, "persona-model.keep-warm-card").exists, "Keep prompt cache warm")
        XCTAssertFalse(element(app, "desktop-panel-fallback").exists, "the old backup text block is gone")
    }

    /// Permissions: Email drafts saves `emailDrafts` on the bot, and back.
    @MainActor
    func testPermissionsEmailDraftsSaves() throws {
        _ = try api("PATCH", "/api/bots/\(XCTUnwrap(ara()?["id"] as? String))", ["emailDrafts": true])
        let app = launch("panel-more-permissions")
        XCTAssertTrue(element(app, "persona-page.permissions").waitForExistence(timeout: 20), "the Permissions page")
        XCTAssertTrue(element(app, "settings-group.approvals").exists, "the Approvals group")
        XCTAssertTrue(element(app, "settings-group.ownerRules").exists, "Rules")
        XCTAssertTrue(element(app, "persona-permissions.approval").exists, "the approval level pill")
        XCTAssertTrue(element(app, "persona-recipients.input").exists, "the allowed recipients field")
        let drafts = element(app, "persona-permissions.email-drafts")
        XCTAssertTrue(drafts.waitForExistence(timeout: 10), "Email drafts")
        drafts.tap()
        try eventually("emailDrafts saved off") { try ara()?["emailDrafts"] as? Bool == false }
        drafts.tap()
        try eventually("emailDrafts saved on") { try ara()?["emailDrafts"] as? Bool != false }
    }

    /// Voice: the provider card, then Voice notes saves `voiceNotes`, and back.
    @MainActor
    func testVoiceNotesSaves() throws {
        let app = launch("panel-more-voice")
        XCTAssertTrue(element(app, "persona-page.voice").waitForExistence(timeout: 20), "the Voice page")
        XCTAssertTrue(element(app, "settings-group.botNotifications").exists, "Notifications")
        let notes = element(app, "persona-voice.notes")
        XCTAssertTrue(notes.waitForExistence(timeout: 10), "Voice notes")
        let before = try ara()?["voiceNotes"] as? Bool != false
        notes.tap()
        try eventually("voiceNotes flipped") { (try ara()?["voiceNotes"] as? Bool != false) != before }
        notes.tap()
        try eventually("voiceNotes back") { (try ara()?["voiceNotes"] as? Bool != false) == before }
    }
}
