import XCTest

/// The group's docked panel (GroupPanel.tsx) on the iPad desktop shell,
/// against the parity fixture: the room chat's header pill opens it and
/// closes it, its tabs switch the body, the Details tab lists the people and
/// the bots, the instructions save through the room's PATCH, and a bot's ×
/// takes it out of the room on the server.
///
///   bash ipad-uitests-<prefix>.sh DesktopGroupPanelUITests
final class DesktopGroupPanelUITests: XCTestCase {
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

    private func list(_ path: String, key: String) throws -> [[String: Any]] {
        let payload = try api("GET", path)
        return (payload as? [[String: Any]]) ?? ((payload as? [String: Any])?[key] as? [[String: Any]]) ?? []
    }

    private func room() throws -> [String: Any]? {
        try list("/api/groups", key: "groups").first { $0["name"] as? String == "Peer Managers" }
    }

    private func botId(_ name: String) throws -> String? {
        try list("/api/bots", key: "bots").first { $0["name"] as? String == name }?["id"] as? String
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
    func testHeaderPillTogglesTheGroupPanel() throws {
        let app = launch("group-chat")
        let pill = element(app, "desktop-chat-pill")
        XCTAssertTrue(pill.waitForExistence(timeout: 30), "the room's header pill")
        XCTAssertFalse(element(app, "desktop-group-panel").exists, "closed at first")
        pill.tap()
        XCTAssertTrue(element(app, "desktop-group-panel").waitForExistence(timeout: 10), "the pill opens the group panel")
        XCTAssertFalse(element(app, "desktop-bot-panel").exists, "not the bot panel")
        element(app, "group-panel-close").tap()
        try eventually("Close closes the panel", timeout: 5) { !element(app, "desktop-group-panel").exists }
        pill.tap()
        XCTAssertTrue(element(app, "desktop-group-panel").waitForExistence(timeout: 10), "the pill opens it again")
        pill.tap()
        try eventually("the pill closes it", timeout: 5) { !element(app, "desktop-group-panel").exists }
    }

    @MainActor
    func testDetailsTabsAndWrites() throws {
        let roomBefore = try XCTUnwrap(try room())
        let roomId = try XCTUnwrap(roomBefore["id"] as? String)
        let members = roomBefore["memberIds"] as? [String] ?? []
        let bulletin = roomBefore["bulletin"] as? String ?? ""
        let liora = try XCTUnwrap(try botId("Liora"))
        defer { _ = try? api("PATCH", "/api/groups/\(roomId)", ["memberIds": members, "bulletin": bulletin]) }

        let app = launch("group-panel")
        let panel = element(app, "desktop-group-panel")
        XCTAssertTrue(panel.waitForExistence(timeout: 30), "the group panel, open")
        XCTAssertTrue(element(app, "group-panel-count").exists, "the count under the faces")
        XCTAssertTrue(element(app, "group-panel-name").exists, "the name")
        XCTAssertTrue(element(app, "group-panel-instructions-info").exists, "the (i) beside the name")
        XCTAssertTrue(app.staticTexts["3 bots"].exists, "the bot count")
        XCTAssertTrue(element(app, "group-panel-menu").exists, "the ... menu")
        for tab in ["details", "instructions", "memory", "advanced"] {
            XCTAssertTrue(element(app, "group-panel-tab.\(tab)").exists, "the \(tab) tab")
        }
        XCTAssertTrue(element(app, "group-panel-tab.details").isSelected, "Details first")
        XCTAssertTrue(app.staticTexts["People"].exists, "the People card")
        XCTAssertTrue(app.staticTexts["parity@example.com"].exists, "the viewer's email")
        for name in ["Ara", "Helios", "Liora"] {
            XCTAssertTrue(element(app, "group-panel-bot-\(try XCTUnwrap(try botId(name)))").exists, "\(name) in Bots")
        }
        XCTAssertTrue(element(app, "group-panel-add-person").exists, "People's Add")
        XCTAssertTrue(element(app, "group-panel-add-bot").exists, "Bots' Add")
        XCTAssertTrue(element(app, "group-panel-manage-members").exists, "Manage members")

        // the ... menu: the export rows
        element(app, "group-panel-menu").tap()
        XCTAssertTrue(element(app, "group-panel-export.copy").waitForExistence(timeout: 5), "Copy as Markdown")
        XCTAssertTrue(element(app, "group-panel-export.export").exists, "Export")
        element(app, "group-panel-menu").tap()

        // Instructions: the editor saves the brief on the server
        element(app, "group-panel-tab.instructions").tap()
        let editor = element(app, "group-panel-instructions-editor")
        XCTAssertTrue(editor.waitForExistence(timeout: 5), "the instructions editor")
        let field = editor.descendants(matching: .textView).firstMatch
        (field.exists ? field : editor).tap()
        (field.exists ? field : editor).typeText("Ship on Fridays.")
        element(app, "group-panel-tab.memory").tap()
        try eventually("the brief is saved") { ((try room())?["bulletin"] as? String ?? "").contains("Ship on Fridays.") }
        XCTAssertTrue(element(app, "group-panel-memory").waitForExistence(timeout: 10), "the Memory tab")

        element(app, "group-panel-tab.advanced").tap()
        XCTAssertTrue(element(app, "group-panel-advanced").waitForExistence(timeout: 5), "the Advanced tab")
        XCTAssertTrue(element(app, "group-panel-responder").exists, "the default responder")
        XCTAssertTrue(element(app, "group-panel-turn-limit").exists, "the turn limit")

        // Details: a bot's × takes it out of the room
        element(app, "group-panel-tab.details").tap()
        let remove = element(app, "group-panel-remove-bot-\(liora)")
        XCTAssertTrue(remove.waitForExistence(timeout: 5), "Liora's ×")
        remove.tap()
        try eventually("Liora left the room") { !(((try room())?["memberIds"] as? [String]) ?? []).contains(liora) }
        try eventually("the row is gone", timeout: 10) { !element(app, "group-panel-bot-\(liora)").exists }
    }
}
