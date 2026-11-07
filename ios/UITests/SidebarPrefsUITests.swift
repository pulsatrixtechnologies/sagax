import XCTest

/// Synced sidebar preferences and the section menu (matrix package WP6)
/// against the parity fixture server. The team menu's writes are checked on
/// the server (`GET /api/sidebar-sections`, `/api/bots`); on an organization
/// server the person's record (`GET /api/me/preferences`) proves what the
/// phone saved, and a change written there the way the desktop writes it
/// shows on the phone.
///
///   node ios/parity/fixture-server.mjs &                       # solo tests
///   PARITY_ORG=1 PARITY_ORG_PHONE=1 node ios/parity/fixture-server.mjs &  # org test
///   TEST_RUNNER_PARITY_ENDPOINT=... TEST_RUNNER_PARITY_TOKEN=... \
///   [TEST_RUNNER_PARITY_ORG=1] xcodebuild test -only-testing:SagaxUITests/SidebarPrefsUITests ...
///
/// The solo tests skip on an organization fixture and the other way round.
final class SidebarPrefsUITests: XCTestCase {
    private var endpoint = ""
    private var token = ""
    private var environment: String?
    private var organization = false

    override func setUpWithError() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        guard let endpoint = env["PARITY_ENDPOINT"], let token = env["PARITY_TOKEN"], !token.isEmpty else {
            throw XCTSkip("no parity fixture: set TEST_RUNNER_PARITY_ENDPOINT and TEST_RUNNER_PARITY_TOKEN")
        }
        self.endpoint = endpoint
        self.token = token
        environment = env["PARITY_ENVIRONMENT"].flatMap { $0.isEmpty ? nil : $0 }
        organization = env["PARITY_ORG"] == "1"
    }

    // MARK: Launch

    /// `fresh` forgets what this phone stored for the fixture's pairing.
    @MainActor
    private func launch(fresh: Bool = true, screen: String = "01-home") -> XCUIApplication {
        let app = XCUIApplication()
        app.terminate()
        var arguments = [
            "-parityEndpoint", endpoint, "-parityToken", token, "-parityScreen", screen,
            "-companion.prefs.rosterDensity", "standard",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES",
        ]
        if fresh { arguments += ["-companion.sidebarPrefs.parity-harness", "{}"] }
        if let environment { arguments += ["-parityEnvironment", environment] }
        app.launchArguments = arguments
        // threads under each bot row (#210: the default is the chat header)
        app.launchArguments += ["-omb-threads-location", "sidebar"]
        app.launch()
        XCTAssertTrue(app.buttons["home-plus"].waitForExistence(timeout: 30))
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

    private func serverSections() throws -> [String] {
        (try api("GET", "/api/sidebar-sections") as? [String: Any])?["sections"] as? [String] ?? []
    }

    private func preferences() throws -> [String: String] {
        (try api("GET", "/api/me/preferences") as? [String: Any])?["preferences"] as? [String: String] ?? [:]
    }

    private func eventually(_ what: String, timeout: TimeInterval = 15, _ check: () throws -> Bool) throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if try check() { return }
            Thread.sleep(forTimeInterval: 0.4)
        }
        XCTFail("never showed: \(what)")
    }

    // MARK: Helpers

    private func header(_ name: String, in app: XCUIApplication) -> XCUIElement {
        app.buttons["section.\(name)"].firstMatch
    }

    private func row(_ name: String, in app: XCUIApplication) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'chat-row.' AND label CONTAINS %@", name)).firstMatch
    }

    @MainActor
    private func reveal(_ element: XCUIElement, in app: XCUIApplication, _ what: String) {
        let roster = app.scrollViews["roster-list"].firstMatch
        let list: XCUIElement = roster.exists ? roster : app
        for step in 0..<12 where !element.waitForExistence(timeout: 1) || !element.isHittable {
            if step < 6 { list.swipeUp() } else { list.swipeDown() }
        }
        XCTAssertTrue(element.waitForExistence(timeout: 10), what)
    }

    @MainActor
    private func sectionMenu(_ name: String, in app: XCUIApplication) {
        let target = header(name, in: app)
        reveal(target, in: app, "section \(name)")
        target.press(forDuration: 1.2)
    }

    @MainActor
    private func tapMenuItemAfter(sectionMenu name: String, _ label: String, in app: XCUIApplication) {
        sectionMenu(name, in: app)
        tapMenuItem(label, in: app)
    }

    @MainActor
    private func tapMenuItem(_ label: String, in app: XCUIApplication) {
        let item = app.buttons[label].firstMatch
        XCTAssertTrue(item.waitForExistence(timeout: 5), "menu item \(label)")
        item.tap()
    }

    @MainActor
    private func enterName(_ name: String, in app: XCUIApplication) {
        // an alert's field and buttons go by their labels, not identifiers
        let alert = app.alerts.firstMatch
        XCTAssertTrue(alert.waitForExistence(timeout: 5))
        let field = alert.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        if let value = field.value as? String, !value.isEmpty {
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: value.count))
        }
        field.typeText(name)
        alert.buttons["Save"].firstMatch.tap()
    }

    // MARK: Solo server: the team menu (SB4)

    @MainActor
    func testTeamMenuRenamesAddsBotsAndDeletesOnTheServer() throws {
        if organization { throw XCTSkip("solo fixture test") }
        let app = launch()

        // Rename team: the server renames it, the bots follow
        sectionMenu("Administration", in: app)
        tapMenuItem("Rename team", in: app)
        enterName("Admin QC", in: app)
        try eventually("section renamed on the server") { try serverSections().contains("Admin QC") }
        XCTAssertEqual(try bot(named: "Helix")["section"] as? String, "Admin QC")
        XCTAssertTrue(header("Admin QC", in: app).waitForExistence(timeout: 10))

        // Add bots: the first bot of the list joins it
        tapMenuItemAfter(sectionMenu: "Admin QC", "Add bots", in: app)
        let first = try XCTUnwrap(try bots().first { ($0["section"] as? String) != "Admin QC" })
        let movedId = try XCTUnwrap(first["id"] as? String)
        let movedSection = first["section"] as? String
        let pick = app.buttons["section-bot.\(movedId)"]
        XCTAssertTrue(pick.waitForExistence(timeout: 5))
        pick.tap()
        app.buttons["section-bots-save"].tap()
        try eventually("bot filed in the section") {
            try bots().first { $0["id"] as? String == movedId }?["section"] as? String == "Admin QC"
        }

        // Delete team: its bots go to General
        sectionMenu("Admin QC", in: app)
        tapMenuItem("Delete team", in: app)
        let confirm = app.alerts.firstMatch.buttons["Delete team"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        confirm.tap()
        try eventually("section deleted") { try !serverSections().contains("Admin QC") }
        XCTAssertNil(try bot(named: "Helix")["section"] as? String)

        // put the dataset back for the next tests
        let helix = try XCTUnwrap(try bot(named: "Helix")["id"] as? String)
        let aurora = try XCTUnwrap(try bot(named: "Aurora")["id"] as? String)
        try api("POST", "/api/sidebar-sections", ["name": "Administration", "botIds": [helix, aurora]])
        if let movedSection { try api("POST", "/api/sidebar-sections", ["name": movedSection, "botIds": [movedId]]) }
    }

    // MARK: Order and folding (SB7, SB8)

    @MainActor
    func testMoveUpAndDownAndFoldingSurviveARelaunch() throws {
        if organization { throw XCTSkip("solo fixture test") }
        var app = launch()
        let security = header("Sécurité", in: app)
        reveal(security, in: app, "Sécurité")
        let other = header("Transformation Numérique", in: app)
        reveal(other, in: app, "Transformation Numérique")
        XCTAssertLessThan(other.frame.minY, security.frame.minY)

        sectionMenu("Sécurité", in: app)
        tapMenuItem("Move up", in: app)
        reveal(other, in: app, "Transformation Numérique")
        try eventually("Sécurité above Transformation Numérique") {
            header("Sécurité", in: app).frame.minY < header("Transformation Numérique", in: app).frame.minY
        }

        // folded with a tap on its title; Rigel is in it
        reveal(header("Sécurité", in: app), in: app, "Sécurité")
        XCTAssertTrue(row("Rigel", in: app).exists)
        header("Sécurité", in: app).tap()
        try eventually("Rigel folded away") { !row("Rigel", in: app).exists }

        // the phone kept both for this pairing
        app = launch(fresh: false)
        reveal(header("Sécurité", in: app), in: app, "Sécurité after relaunch")
        XCTAssertFalse(row("Rigel", in: app).exists)
        XCTAssertLessThan(header("Sécurité", in: app).frame.minY, header("Transformation Numérique", in: app).frame.minY)

        sectionMenu("Sécurité", in: app)
        tapMenuItem("Move down", in: app)
        header("Sécurité", in: app).tap()
        try eventually("Rigel back") { row("Rigel", in: app).exists }
    }

    // MARK: Hidden (SB25) and the thread switch (SB10)

    @MainActor
    func testHideFromSidebarAndShowItBack() throws {
        if organization { throw XCTSkip("solo fixture test") }
        // the fixture pins its one group since the home's reference set
        // (#754, 2026-10-18): unpin it so it has an ordinary row to hide
        let seeded = (try api("GET", "/api/groups") as? [String: Any])?["groups"] as? [[String: Any]] ?? []
        for group in seeded where group["dm"] as? Bool != true && group["pinned"] as? Bool == true {
            if let id = group["id"] as? String { _ = try api("PATCH", "/api/groups/\(id)", ["pinned": false]) }
        }
        let app = launch()
        let lux = row("Lux", in: app)
        reveal(lux, in: app, "Lux")
        lux.press(forDuration: 1.2)
        tapMenuItem("Hide from sidebar", in: app)
        try eventually("Lux hidden") { !row("Lux", in: app).exists }

        let hidden = app.buttons["section.__hidden"]
        reveal(hidden, in: app, "the Hidden row")
        XCTAssertTrue(hidden.label.contains("Hidden (1)"))
        hidden.tap()
        let show = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'hidden-show.bot:'")).firstMatch
        XCTAssertTrue(show.waitForExistence(timeout: 5))
        show.tap()
        try eventually("Lux back") { row("Lux", in: app).exists }
        XCTAssertFalse(app.buttons["section.__hidden"].exists)

        // a group chat hides from its own row menu (RM13), the same way
        let groups = (try api("GET", "/api/groups") as? [String: Any])?["groups"] as? [[String: Any]] ?? []
        // unpinned before launch (top of the test)
        let group = try XCTUnwrap(groups.first { $0["dm"] as? Bool != true })
        let groupId = try XCTUnwrap(group["id"] as? String)
        let groupRow = app.buttons["chat-row.\(groupId)"]
        reveal(groupRow, in: app, "group row")
        groupRow.press(forDuration: 1.2)
        tapMenuItem("Hide from sidebar", in: app)
        try eventually("group hidden") { !app.buttons["chat-row.\(groupId)"].exists }
        let hiddenGroup = app.buttons["section.__hidden"]
        reveal(hiddenGroup, in: app, "the Hidden row")
        hiddenGroup.tap()
        let showGroup = app.buttons["hidden-show.group:\(groupId)"]
        XCTAssertTrue(showGroup.waitForExistence(timeout: 5))
        showGroup.tap()
        try eventually("group back") { app.buttons["chat-row.\(groupId)"].exists }
    }

    @MainActor
    func testTheThreadSwitchHidesThreadEntries() throws {
        if organization { throw XCTSkip("solo fixture test") }
        let app = launch(screen: "22-appearance")
        let toggle = app.switches["settings.showThreads.toggle"].firstMatch
        for _ in 0..<8 where !toggle.exists || !toggle.isHittable { app.swipeUp() }
        XCTAssertTrue(toggle.waitForExistence(timeout: 5), "Show threads switch")
        // threads are off by default, as on the desktop (SHOW_THREADS_DEFAULT,
        // single stream): turn them on first, then check the switch hides them
        if toggle.value as? String == "0" {
            toggle.tap()
            try eventually("switch on") { toggle.value as? String == "1" }
        }
        XCTAssertEqual(toggle.value as? String, "1")
        toggle.tap()
        try eventually("switch off") { toggle.value as? String == "0" }

        let home = launch(fresh: false)
        let orion = row("Orion", in: home)
        reveal(orion, in: home, "Orion")
        orion.press(forDuration: 1.2)
        XCTAssertTrue(home.buttons["Hide from sidebar"].waitForExistence(timeout: 5))
        XCTAssertFalse(home.buttons["New thread"].exists)
        XCTAssertFalse(home.buttons["New folder"].exists)
    }

    // MARK: Organization server: what follows the person (SB2, SB7, SB10, SB25)

    @MainActor
    func testPersonalSectionsFoldsAndHiddenEntriesFollowThePerson() throws {
        guard organization else { throw XCTSkip("needs PARITY_ORG=1 PARITY_ORG_PHONE=1") }
        let app = launch()

        // the person's own sections start from the server's (seeded once)
        try eventually("sections seeded into the record", timeout: 20) {
            (try preferences()["sagax.sidebarSections.v1"] ?? "").contains("Sécurité")
        }

        // Rename… is the person's own: the server's section keeps its name
        sectionMenu("Sécurité", in: app)
        tapMenuItem("Rename…", in: app)
        enterName("Sécu QC", in: app)
        try eventually("renamed in the record") { (try preferences()["sagax.sidebarSections.v1"] ?? "").contains("Sécu QC") }
        XCTAssertTrue(try serverSections().contains("Sécurité"), "a personal rename never touches the server's sections")

        // New section… (empty), then Collapse all
        sectionMenu("Sécu QC", in: app)
        tapMenuItem("New section…", in: app)
        enterName("Mes favoris", in: app)
        try eventually("new section in the record") { (try preferences()["sagax.sidebarSections.v1"] ?? "").contains("Mes favoris") }
        sectionMenu("Sécu QC", in: app)
        tapMenuItem("Collapse all", in: app)
        try eventually("folds in the record") {
            (try preferences()["openmausbot.sidebarCollapsedSections.v1"] ?? "").contains("section:Sécu QC")
        }

        // Hide from sidebar lands in the record too
        sectionMenu("Sécu QC", in: app)
        tapMenuItem("Expand all", in: app)
        let lux = row("Lux", in: app)
        reveal(lux, in: app, "Lux")
        lux.press(forDuration: 1.2)
        tapMenuItem("Hide from sidebar", in: app)
        let luxId = try XCTUnwrap(try bot(named: "Lux")["id"] as? String)
        try eventually("hidden in the record") { (try preferences()["sagax.sidebarHidden.v1"] ?? "").contains(luxId) }

        // the desktop turns threads off: the phone follows on its next read,
        // and every key the phone did not write is still there
        var record = try preferences()
        XCTAssertNotNil(record["sagax.sidebarSections.v1"])
        record["omb-show-threads"] = "0"
        try api("PUT", "/api/me/preferences", ["preferences": record])
        let again = launch(fresh: false)
        let orion = row("Orion", in: again)
        reveal(orion, in: again, "Orion")
        orion.press(forDuration: 1.2)
        XCTAssertTrue(again.buttons["Hide from sidebar"].waitForExistence(timeout: 5))
        XCTAssertFalse(again.buttons["New thread"].exists)
        XCTAssertEqual(try preferences()["omb-show-threads"], "0")
    }
}
