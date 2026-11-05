import XCTest

/// The iPad desktop sidebar (I2) against the parity fixture server: the row
/// and section menus, a bot dragged onto another team (DD1), the rail, and
/// the ⌘ keys (KB1, KB2). Each write is checked on the server (`/api/bots`,
/// `/api/sidebar-sections`) and put back through the API.
///
///   node ios/parity/fixture-server.mjs &
///   TEST_RUNNER_PARITY_ENDPOINT=... TEST_RUNNER_PARITY_TOKEN=... \
///   xcodebuild test -only-testing:SagaxUITests/DesktopSidebarUITests \
///     -destination 'platform=iOS Simulator,name=<an iPad>' ...
///
/// Skipped on an iPhone (the desktop shell is iPad only) and without a fixture.
final class DesktopSidebarUITests: XCTestCase {
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
            throw XCTSkip("the desktop sidebar is the iPad's")
        }
        self.endpoint = endpoint
        self.token = token
        environment = env["PARITY_ENVIRONMENT"].flatMap { $0.isEmpty ? nil : $0 }
    }

    // MARK: Launch

    @MainActor
    private func launch(_ extra: [String] = []) -> XCUIApplication {
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication()
        app.terminate()
        var arguments = [
            "-parityEndpoint", endpoint, "-parityToken", token, "-parityIPadScreen", "main",
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

    // MARK: API

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

    private func bots() throws -> [[String: Any]] {
        (try api("GET", "/api/bots") as? [String: Any])?["bots"] as? [[String: Any]] ?? []
    }

    private func bot(named name: String) throws -> [String: Any] {
        try XCTUnwrap(try bots().first { $0["name"] as? String == name }, "no bot named \(name)")
    }

    private func eventually(_ what: String, timeout: TimeInterval = 15, _ check: () throws -> Bool) throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if try check() { return }
            Thread.sleep(forTimeInterval: 0.4)
        }
        XCTFail("never happened: \(what)")
    }

    // MARK: Helpers

    @MainActor
    private func row(_ id: String, in app: XCUIApplication) -> XCUIElement {
        let element = app.buttons["desktop-row.\(id)"].firstMatch
        XCTAssertTrue(element.waitForExistence(timeout: 10), "row \(id)")
        return element
    }

    @MainActor
    private func header(_ name: String, in app: XCUIApplication) -> XCUIElement {
        app.buttons["desktop-section-header.section:\(name)"].firstMatch
    }

    @MainActor
    private func tapMenuItem(_ label: String, in app: XCUIApplication) {
        // a system menu's item, never a sidebar button of the same name (a
        // section header reads as its title alone since it lost its count)
        let item = app.buttons.matching(NSPredicate(format: "label == %@ AND NOT (identifier BEGINSWITH 'desktop-')", label)).firstMatch
        XCTAssertTrue(item.waitForExistence(timeout: 5), "menu item \(label)")
        item.tap()
    }

    // MARK: Tests

    /// A long press on a row opens the bot menu: Pin pins it on the server
    /// and the tile's own menu unpins it; Move to files it in another team.
    @MainActor
    func testBotMenuPinsAndMovesToATeam() throws {
        let helix = try bot(named: "Helix")
        let helixId = try XCTUnwrap(helix["id"] as? String)
        let originalSection = helix["section"] as? String ?? ""
        let target = try XCTUnwrap(try bots().compactMap { $0["section"] as? String }.first { !$0.isEmpty && $0 != originalSection })
        defer {
            _ = try? api("PATCH", "/api/bots/\(helixId)", ["pinned": false])
            if !originalSection.isEmpty { _ = try? api("POST", "/api/sidebar-sections", ["name": originalSection, "botIds": [helixId]]) }
        }
        let app = launch()

        row(helixId, in: app).press(forDuration: 1.2)
        tapMenuItem("Pin", in: app)
        try eventually("Helix pinned on the server") { try bot(named: "Helix")["pinned"] as? Bool == true }
        let tile = app.buttons["desktop-pinned.\(helixId)"].firstMatch
        XCTAssertTrue(tile.waitForExistence(timeout: 10), "Helix's pinned tile")

        tile.press(forDuration: 1.2)
        tapMenuItem("Unpin", in: app)
        try eventually("Helix unpinned") { try bot(named: "Helix")["pinned"] as? Bool != true }

        row(helixId, in: app).press(forDuration: 1.2)
        tapMenuItem("Move to", in: app)
        tapMenuItem(target, in: app)
        try eventually("Helix filed in \(target)") { try bot(named: "Helix")["section"] as? String == target }
    }

    /// DD1: a row dragged onto another section's header files the bot there
    /// (`POST /api/sidebar-sections`), as the desktop's drop does.
    @MainActor
    func testDraggingABotOntoAnotherSectionFilesIt() throws {
        let aurora = try bot(named: "Aurora")
        let auroraId = try XCTUnwrap(aurora["id"] as? String)
        let originalSection = try XCTUnwrap(aurora["section"] as? String)
        let target = try XCTUnwrap(try bots().compactMap { $0["section"] as? String }.first { !$0.isEmpty && $0 != originalSection })
        defer { _ = try? api("POST", "/api/sidebar-sections", ["name": originalSection, "botIds": [auroraId]]) }
        let app = launch()

        let source = row(auroraId, in: app)
        let destination = header(target, in: app)
        XCTAssertTrue(destination.waitForExistence(timeout: 10), "the \(target) header")
        // A touch drag lifts after a short press; a longer one opens the
        // row's context menu first, whose preview then carries the drag.
        for hold in [0.35, 1.2] {
            source.press(forDuration: hold, thenDragTo: destination, withVelocity: .slow, thenHoldForDuration: 1.0)
            if (try? bot(named: "Aurora")["section"] as? String) == target { break }
            Thread.sleep(forTimeInterval: 2)
            if (try? bot(named: "Aurora")["section"] as? String) == target { break }
        }
        try eventually("Aurora filed in \(target)", timeout: 20) { try bot(named: "Aurora")["section"] as? String == target }
    }

    /// The section menu's Rename team renames it on the server.
    @MainActor
    func testSectionMenuRenamesTheTeamOnTheServer() throws {
        let aurora = try bot(named: "Aurora")
        let team = try XCTUnwrap(aurora["section"] as? String)
        let renamed = "\(team) bis"
        defer {
            let encoded = renamed.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? renamed
            _ = try? api("PATCH", "/api/sidebar-sections?section=\(encoded)", ["name": team])
        }
        let app = launch()

        let teamHeader = header(team, in: app)
        XCTAssertTrue(teamHeader.waitForExistence(timeout: 10), "the \(team) header")
        teamHeader.press(forDuration: 1.2)
        tapMenuItem("Rename team", in: app)
        let alert = app.alerts.firstMatch
        XCTAssertTrue(alert.waitForExistence(timeout: 5))
        let field = alert.textFields.firstMatch
        field.tap()
        field.typeText(" bis")
        alert.buttons["Save"].firstMatch.tap()
        try eventually("the team renamed") { try bot(named: "Aurora")["section"] as? String == renamed }
    }

    /// A double tap on the sidebar's edge folds it to the rail and back
    /// (there is no collapse button any more); ⌘1 and ⌘⇧] select bots in
    /// the roster's order.
    @MainActor
    func testRailAndKeyboardShortcuts() throws {
        let visible = try bots().filter { $0["hidden"] as? Bool != true }
        let first = try XCTUnwrap(visible.first?["id"] as? String)
        let second = try XCTUnwrap(visible.dropFirst().first?["id"] as? String)
        let app = launch()

        XCTAssertTrue(app.buttons["desktop-sidebar-search"].exists, "the round search button")
        XCTAssertTrue(app.buttons["desktop-sidebar-new"].exists, "the round New button")
        XCTAssertFalse(app.buttons["desktop-sidebar-collapse"].exists, "no collapse button")
        let edge = app.otherElements["desktop-sidebar-edge"].firstMatch
        XCTAssertTrue(edge.waitForExistence(timeout: 5), "the sidebar's edge")
        edge.doubleTap()
        XCTAssertTrue(app.otherElements["desktop-sidebar-rail"].waitForExistence(timeout: 5), "the rail")
        app.otherElements["desktop-sidebar-edge"].firstMatch.doubleTap()
        XCTAssertTrue(app.otherElements["desktop-sidebar-full"].waitForExistence(timeout: 5), "the full sidebar")

        app.typeKey("1", modifierFlags: .command)
        try eventually("bot 1 selected") { self.isSelected(first, in: app) }
        app.typeKey("]", modifierFlags: [.command, .shift])
        try eventually("bot 2 selected") { self.isSelected(second, in: app) }
    }

    /// New opens the inline "To:" picker (the desktop's compose-to): the
    /// create rows and the bots, group mode collects members, Close puts
    /// the header back.
    @MainActor
    func testNewOpensTheToPicker() throws {
        let app = launch()
        app.buttons["desktop-sidebar-new"].firstMatch.tap()
        XCTAssertTrue(app.textFields["desktop-compose-field"].waitForExistence(timeout: 5), "the To: field")
        XCTAssertTrue(app.buttons["desktop-compose.create-bot"].exists)
        XCTAssertTrue(app.buttons["desktop-compose.create-bot-wizard"].exists, "the wizard beside the quick creation")
        let group = app.buttons["desktop-compose.create-group"].firstMatch
        XCTAssertTrue(group.exists)
        group.tap()
        XCTAssertFalse(app.buttons["desktop-compose.create-bot"].exists, "group mode keeps the confirm row and the bots")
        XCTAssertFalse(app.buttons["desktop-compose.create-group"].firstMatch.isEnabled, "no member yet")
        app.buttons["desktop-compose-close"].firstMatch.tap()
        XCTAssertFalse(app.textFields["desktop-compose-field"].waitForExistence(timeout: 2))
    }

    /// Connected apps and Templates wait for Settings > Experimental
    /// features, as on the desktop; the footer shows the achievements
    /// points from the server.
    @MainActor
    func testExperimentalPlacesAndGamertag() throws {
        let config = try api("GET", "/api/config") as? [String: Any]
        let features = config?["features"] as? [String: Any]
        let apps = features?["connectedApps"] as? Bool ?? false
        let templates = features?["templates"] as? Bool ?? false
        addTeardownBlock {
            _ = try? self.api("PUT", "/api/config", ["features": ["connectedApps": apps, "templates": templates]])
        }
        try api("PUT", "/api/config", ["features": ["connectedApps": false, "templates": false]])
        var app = launch()
        // The foot (2026-10-27): the account row and the round Capabilities
        // button, no places; Team map and Automations are under Tools ›.
        XCTAssertTrue(app.buttons["desktop-sidebar-capabilities"].waitForExistence(timeout: 10), "the round Capabilities button")
        XCTAssertFalse(app.buttons["desktop-sidebar-team-map"].exists)
        XCTAssertFalse(app.buttons["desktop-sidebar-automations"].exists)
        XCTAssertFalse(app.buttons["desktop-sidebar-templates"].exists, "no places in the foot")
        let points = app.buttons["desktop-sidebar-points"].firstMatch
        XCTAssertTrue(points.waitForExistence(timeout: 10), "the gamertag")
        app.buttons["desktop-sidebar-account"].tap()
        let tools = app.buttons["desktop-menu.tools"]
        XCTAssertTrue(tools.waitForExistence(timeout: 10), "Tools in the account menu")
        tools.tap()
        XCTAssertTrue(app.buttons["Team map"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Automations"].firstMatch.exists)
        XCTAssertFalse(app.buttons["Browse Bots"].firstMatch.exists, "Templates is experimental")

        try api("PUT", "/api/config", ["features": ["connectedApps": true, "templates": true]])
        app = launch()
        app.buttons["desktop-sidebar-account"].tap()
        let toolsOn = app.buttons["desktop-menu.tools"]
        XCTAssertTrue(toolsOn.waitForExistence(timeout: 10))
        toolsOn.tap()
        XCTAssertTrue(app.buttons["Browse Bots"].firstMatch.waitForExistence(timeout: 5), "switched on (the parity pairing is an administrator's)")
    }

    /// The desktop's two row layouts: with a pointer a row's "⋯" shows on
    /// hover only (the parity launch draws the pointer layout); on touch
    /// it stays on screen, and its menu has Put on the desktop.
    @MainActor
    func testRowActionsFollowThePointerAndTheMenuPutsTheBotOnTheDesktop() throws {
        let aurora = try XCTUnwrap(try bot(named: "Aurora")["id"] as? String)
        var app = launch()
        _ = row(aurora, in: app)
        XCTAssertFalse(app.buttons["desktop-row-actions.\(aurora)"].exists, "pointer layout: no \u{22EF} until hovered")
        XCTAssertFalse(app.buttons["desktop-row-new-folder.\(aurora)"].exists, "no New folder on the row")
        app = launch(["-desktop.touchRows", "YES"])
        let actions = app.buttons["desktop-row-actions.\(aurora)"].firstMatch
        XCTAssertTrue(actions.waitForExistence(timeout: 10), "touch layout: the \u{22EF} stays")
        actions.tap()
        XCTAssertTrue(app.buttons["desktop-menu.put-on-desktop"].waitForExistence(timeout: 5), "Put on the desktop")
        XCTAssertTrue(app.buttons["desktop-menu.select"].exists)
    }

    /// The rail's » button, ⌘B, ⌘⇧N and the shortcuts window (the
    /// desktop's catalog, its title and Done).
    @MainActor
    func testRailExpandButtonShortcutsAndTheirWindow() throws {
        let app = launch()
        app.typeKey("b", modifierFlags: .command)
        XCTAssertTrue(app.otherElements["desktop-sidebar-rail"].waitForExistence(timeout: 5), "⌘B folds the sidebar")
        let expand = app.buttons["desktop-sidebar-expand"].firstMatch
        XCTAssertTrue(expand.waitForExistence(timeout: 5), "the rail's » button")
        expand.tap()
        XCTAssertTrue(app.otherElements["desktop-sidebar-full"].waitForExistence(timeout: 5), "» unfolds it")

        app.typeKey("n", modifierFlags: [.command, .shift])
        XCTAssertTrue(app.textFields["desktop-compose-field"].waitForExistence(timeout: 5), "⌘⇧N opens the To: picker")
        XCTAssertFalse(app.buttons["desktop-compose.create-bot"].exists, "in group mode")
        app.buttons["desktop-compose-close"].firstMatch.tap()

        app.typeKey("/", modifierFlags: .command)
        let sheet = app.otherElements["desktop-shortcuts"].firstMatch
        XCTAssertTrue(sheet.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Keyboard shortcuts"].exists, "the desktop's title")
        for id in ["search-everything", "new-group", "toggle-sidebar", "focus-composer", "quote-selection", "dictate", "live-call-mute", "reorder-section"] {
            XCTAssertTrue(app.descendants(matching: .any)["desktop-shortcut.\(id)"].exists, "row \(id)")
        }
        let sidebarRow = app.descendants(matching: .any)["desktop-shortcut.toggle-sidebar"]
        XCTAssertTrue(sidebarRow.label.contains("B"), sidebarRow.label)
        XCTAssertFalse(app.staticTexts["Workspace"].exists, "no Workspace section")
        app.buttons["desktop-shortcuts-done"].tap()
        XCTAssertFalse(sheet.waitForExistence(timeout: 2))
    }

    @MainActor
    private func isSelected(_ id: String, in app: XCUIApplication) -> Bool {
        let tile = app.buttons["desktop-pinned.\(id)"].firstMatch
        if tile.exists { return tile.isSelected }
        let row = app.buttons["desktop-row.\(id)"].firstMatch
        return row.exists && row.isSelected
    }
}
