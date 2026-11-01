import XCTest

/// WP15 (feature parity matrix TM1, TM2, RM21, RM22) against the parity
/// fixture server. Each test acts in the app, then reads the server's own
/// state through the API, so a control that only changed the screen fails.
///
///   node ios/parity/fixture-server.mjs &                                  # Team map
///   PARITY_ORG=1 PARITY_ORG_PHONE=1 PARITY_PEOPLE=1 node ios/parity/fixture-server.mjs &  # people
///   TEST_RUNNER_PARITY_ENDPOINT=... TEST_RUNNER_PARITY_TOKEN=... [TEST_RUNNER_PARITY_ORG=1] \
///   xcodebuild test -only-testing:SagaxUITests/TeamMapPeopleUITests ...
///
/// The Team map tests need the solo fixture's admin pairing (moving a bot to
/// another team is an admin's); the people tests need the organization
/// fixture with Sam's direct conversation (PARITY_PEOPLE=1). Each skips on
/// the other fixture.
final class TeamMapPeopleUITests: XCTestCase {
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

    // MARK: Launch and API

    @MainActor
    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.terminate()
        var arguments = [
            "-parityEndpoint", endpoint, "-parityToken", token, "-parityScreen", "01-home",
            "-companion.prefs.rosterDensity", "standard",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES",
            "-companion.sidebarPrefs.parity-harness", "{}",
        ]
        if let environment { arguments += ["-parityEnvironment", environment] }
        app.launchArguments = arguments
        app.launch()
        XCTAssertTrue(app.buttons["home-plus"].waitForExistence(timeout: 30))
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

    private func fleet() throws -> [String: Any] { (try api("GET", "/api/bots") as? [String: Any]) ?? [:] }
    private func bots() throws -> [[String: Any]] { try fleet()["bots"] as? [[String: Any]] ?? [] }
    private func groups() throws -> [[String: Any]] { try fleet()["groups"] as? [[String: Any]] ?? [] }

    private func eventually(_ what: String, timeout: TimeInterval = 15, _ check: () throws -> Bool) throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if try check() { return }
            Thread.sleep(forTimeInterval: 0.4)
        }
        XCTFail("never happened: \(what)")
    }

    @MainActor
    private func openTeamMap(_ app: XCUIApplication) {
        // Team map: the account menu, under Settings
        app.buttons["home-apps"].tap()
        let item = app.buttons["account-menu.teamMap"]
        XCTAssertTrue(item.waitForExistence(timeout: 5), "the account menu offers the Team map")
        item.tap()
        XCTAssertTrue(app.descendants(matching: .any)["team-map"].waitForExistence(timeout: 10))
    }

    @MainActor
    private func scrollTo(_ element: XCUIElement, in app: XCUIApplication) {
        for _ in 0..<10 where !(element.exists && element.isHittable) {
            app.swipeUp()
        }
    }

    // MARK: Team map (TM1, TM2)

    @MainActor
    func testTeamMapListsEveryTeamAndArrangesInsideATeam() throws {
        if organization { throw XCTSkip("the Team map tests run on the solo fixture") }
        let all = try bots().filter { ($0["hidden"] as? Bool) != true }
        let section = try XCTUnwrap(
            Dictionary(grouping: all.filter { ($0["chiefOfStaff"] as? Bool) != true }, by: { ($0["section"] as? String) ?? "" })
                .first { $0.value.count >= 2 },
            "the fixture has a team with two bots"
        )
        let first = try XCTUnwrap(section.value[0]["id"] as? String)
        let second = try XCTUnwrap(section.value[1]["id"] as? String)

        let app = launch()
        openTeamMap(app)
        let count = app.staticTexts["team-map-count"]
        XCTAssertTrue(count.waitForExistence(timeout: 5))
        XCTAssertEqual(count.label, "\(all.count) bots", "the count is the server's visible bots")

        let firstRow = app.buttons["team-map-bot-\(first)"]
        let secondRow = app.buttons["team-map-bot-\(second)"]
        scrollTo(secondRow, in: app)
        XCTAssertTrue(firstRow.waitForExistence(timeout: 5) && secondRow.exists)
        // whatever this phone kept from an earlier run, move the lower one up
        let secondIsLower = firstRow.frame.minY < secondRow.frame.minY
        let (upper, lower) = secondIsLower ? (firstRow, secondRow) : (secondRow, firstRow)
        let lowerId = secondIsLower ? second : first

        // TM2: touch and hold > Move up puts the second bot above the first,
        // on this phone only: the team does not change on the server.
        lower.press(forDuration: 1.0)
        let up = app.buttons["team-map-move-up"]
        XCTAssertTrue(up.waitForExistence(timeout: 5))
        up.tap()
        try eventually("the lower bot moved above the other") { lower.frame.minY < upper.frame.minY }
        let after = try bots()
        XCTAssertEqual(after.first { $0["id"] as? String == lowerId }?["section"] as? String, section.key.isEmpty ? nil : section.key)

        // the order is personal and kept: it survives a relaunch
        app.terminate()
        let again = XCUIApplication()
        again.launchArguments = app.launchArguments.filter { $0 != "-companion.sidebarPrefs.parity-harness" && $0 != "{}" }
        again.launch()
        XCTAssertTrue(again.buttons["home-plus"].waitForExistence(timeout: 30))
        openTeamMap(again)
        let upperId = lowerId == first ? second : first
        let lowerAgain = again.buttons["team-map-bot-\(lowerId)"]
        let upperAgain = again.buttons["team-map-bot-\(upperId)"]
        scrollTo(upperAgain, in: again)
        XCTAssertTrue(lowerAgain.waitForExistence(timeout: 5))
        XCTAssertLessThan(lowerAgain.frame.minY, upperAgain.frame.minY, "the personal order is kept")
    }

    @MainActor
    func testAnAdminMovesABotToAnotherTeamAfterConfirming() throws {
        if organization { throw XCTSkip("the Team map tests run on the solo fixture") }
        let all = try bots().filter { ($0["hidden"] as? Bool) != true && ($0["chiefOfStaff"] as? Bool) != true }
        let bot = try XCTUnwrap(all.first { (($0["section"] as? String) ?? "").isEmpty == false }, "a bot in a team")
        let id = try XCTUnwrap(bot["id"] as? String)
        let home = try XCTUnwrap(bot["section"] as? String)
        let sections = (try api("GET", "/api/sidebar-sections") as? [String: Any])?["sections"] as? [String] ?? []
        let destination = try XCTUnwrap(sections.first { $0 != home }, "a second team")
        defer { _ = try? api("POST", "/api/sidebar-sections", ["name": home, "botIds": [id]]) }

        let app = launch()
        openTeamMap(app)
        let row = app.buttons["team-map-bot-\(id)"]
        scrollTo(row, in: app)
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.press(forDuration: 1.0)
        let move = app.buttons["team-map-move-team"]
        XCTAssertTrue(move.waitForExistence(timeout: 5), "an admin pairing may move a bot to another team")
        move.tap()
        // the submenu's item (a team header carries the same name)
        let named = app.buttons.matching(NSPredicate(format: "label == %@", destination))
        XCTAssertTrue(named.firstMatch.waitForExistence(timeout: 5))
        let target = try XCTUnwrap(named.allElementsBoundByIndex.last { $0.isHittable }, "the team in the submenu")
        target.tap()
        let confirm = app.alerts.buttons["Move bot"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5), "the desktop's confirmation")
        let alert = app.alerts.firstMatch
        XCTAssertEqual(alert.label, "Move \(bot["name"] as? String ?? "") to \(destination)?")
        confirm.tap()
        try eventually("the server moved the bot") {
            try bots().first { $0["id"] as? String == id }?["section"] as? String == destination
        }
    }

    // MARK: People (RM21, RM22)

    private func directory() throws -> [[String: Any]] {
        (try api("GET", "/api/org/directory") as? [String: Any])?["people"] as? [[String: Any]] ?? []
    }

    private func principal(_ login: String) throws -> String {
        try XCTUnwrap(try directory().first { $0["login"] as? String == login }?["principalId"] as? String, "no \(login)")
    }

    private func peopleConversation(with id: String) throws -> [String: Any]? {
        try groups().first { group in
            group["peopleDm"] as? Bool == true
                && ((group["humanIds"] as? [String]) ?? []).contains { $0.lowercased() == id.lowercased() }
        }
    }

    /// The people hidden in the person's synced sidebar (`sagax.sidebarHidden.v1`).
    private func hiddenPeople() throws -> [String] {
        let prefs = (try api("GET", "/api/me/preferences") as? [String: Any])?["preferences"] as? [String: String] ?? [:]
        guard let raw = prefs["sagax.sidebarHidden.v1"]?.data(using: .utf8),
              let record = try JSONSerialization.jsonObject(with: raw) as? [String: Any] else { return [] }
        return (record["items"] as? [[String: Any]] ?? []).compactMap { item in
            item["kind"] as? String == "person" ? (item["id"] as? String)?.lowercased() : nil
        }
    }

    @MainActor
    func testAPersonsConversationReadsAsThemAndTheirNameOpensTheirSheet() throws {
        guard organization else { throw XCTSkip("the people tests run on the organization fixture") }
        let sam = try principal("sam.rivera")
        let dm = try XCTUnwrap(try peopleConversation(with: sam), "start the fixture with PARITY_PEOPLE=1")
        let dmId = try XCTUnwrap(dm["id"] as? String)
        // a rerun starts with the conversation shown
        var record = (try api("GET", "/api/me/preferences") as? [String: Any])?["preferences"] as? [String: String] ?? [:]
        if record["sagax.sidebarHidden.v1"] != nil {
            record["sagax.sidebarHidden.v1"] = #"{"items":[],"unhideOnMessage":{"bots":false,"people":true}}"#
            try api("PUT", "/api/me/preferences", ["preferences": record])
        }

        let app = launch()
        let row = app.buttons["chat-row.\(dmId)"]
        scrollTo(row, in: app)
        XCTAssertTrue(row.waitForExistence(timeout: 15))
        XCTAssertTrue(row.label.contains("Sam Rivera"), "the row reads as the other person: \(row.label)")
        row.tap()

        // RM21: Sam's line carries his name; it opens his sheet
        let label = app.buttons["room-person-\(sam)"]
        XCTAssertTrue(label.waitForExistence(timeout: 15))
        label.tap()
        let name = app.staticTexts["person-name"]
        XCTAssertTrue(name.waitForExistence(timeout: 10))
        XCTAssertEqual(name.label, "Sam Rivera")
        // #219: a plain member shows no role line
        XCTAssertFalse(app.staticTexts["person-role"].exists)
        let teams = app.descendants(matching: .any).matching(identifier: "person-teams").firstMatch
        XCTAssertTrue(teams.label.contains("Service Desk (manager)"), "teams: \(teams.label)")
        // the sheet offers Message only, no Close conversation (owner 2026-10-14)
        XCTAssertFalse(app.buttons["person-close-conversation"].exists)
        XCTAssertTrue(app.buttons["person-message"].waitForExistence(timeout: 5))
    }

    /// Search lists the members beside the bots (type "Member" on the
    /// right), filters them as one types, and a member opens the direct
    /// conversation; New chat says nothing about Sagax Business here.
    @MainActor
    func testSearchFindsAMemberAndOpensTheirConversation() throws {
        guard organization else { throw XCTSkip("the people tests run on the organization fixture") }
        let sam = try principal("sam.rivera")
        let app = launch()
        app.buttons["home-search"].tap()
        let field = app.textFields["search-field"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.typeText("Sam")
        let row = app.buttons["search-person.\(sam)"]
        XCTAssertTrue(row.waitForExistence(timeout: 10), "a member is a search result")
        XCTAssertTrue((row.value as? String)?.hasPrefix("Member") ?? false, "typed as a member: \(String(describing: row.value))")
        if let dir = ProcessInfo.processInfo.environment["SAGAX_SHOTS_DIR"] {
            try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("org-search-member.png"))
        }
        row.tap()
        XCTAssertTrue(app.buttons["chat-name"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["chat-name"].label.contains("Sam"), "the header reads as the person")
        try eventually("the server holds the conversation with Sam") { try peopleConversation(with: sam) != nil }

        app.terminate()
        let again = launch()
        again.buttons["home-plus"].tap()
        XCTAssertTrue(again.otherElements["new-chat-sheet"].waitForExistence(timeout: 5))
        XCTAssertFalse(again.descendants(matching: .any)["new-chat-solo-note"].exists, "an organization lists its members")
        if let dir = ProcessInfo.processInfo.environment["SAGAX_SHOTS_DIR"] {
            sleep(1)
            try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("org-new-chat.png"))
        }
    }

    @MainActor
    func testMessageAPersonOpensANewConversationOnTheServer() throws {
        guard organization else { throw XCTSkip("the people tests run on the organization fixture") }
        // someone the viewer has not written to yet (a rerun takes the next)
        var candidate: (id: String, name: String)?
        for (login, name) in [("jordan.lee", "Jordan Lee"), ("taylor.kim", "Taylor Kim"), ("morgan.chen", "Morgan Chen")] {
            let id = try principal(login)
            if try peopleConversation(with: id) == nil { candidate = (id, name); break }
        }
        let (jordan, jordanName) = try XCTUnwrap(candidate, "restart the fixture: every person already has a conversation")
        let disabled = try principal("casey.brooks")

        let app = launch()
        // New lists the people after the bots (ComposeToPicker)
        app.buttons["home-plus"].tap()
        // New chat (the search sheet): the people follow the bots; typing
        // their name brings them up above the keyboard
        let person = app.buttons["plus-menu.person.\(jordan)"]
        XCTAssertTrue(person.waitForExistence(timeout: 10), "an organization server lists its people in New")
        XCTAssertFalse(app.buttons["plus-menu.person.\(disabled)"].exists, "a disabled person is not offered")
        app.textFields["search-field"].typeText(jordanName)
        XCTAssertTrue(person.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["plus-menu.person.\(disabled)"].exists)
        person.tap()

        try eventually("the server holds the conversation with Jordan") { try peopleConversation(with: jordan) != nil }
        XCTAssertTrue(app.buttons["chat-name"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["chat-name"].label.contains(jordanName), "the header reads as the person")
        let field = app.textFields["message-input"].exists ? app.textFields["message-input"] : app.textViews["message-input"]
        XCTAssertTrue(field.waitForExistence(timeout: 10), "the composer field")
        field.tap()
        field.typeText("Hi from the phone")
        let send = app.descendants(matching: .any).matching(identifier: "composer-send").firstMatch
        XCTAssertTrue(send.waitForExistence(timeout: 5))
        send.tap()
        let threadId = try XCTUnwrap(try peopleConversation(with: jordan)?["threadId"] as? String)
        try eventually("the message is on the server") {
            let page = (try api("GET", "/api/threads/\(threadId)/messages?limit=50") as? [String: Any])?["messages"] as? [[String: Any]] ?? []
            return page.contains { ($0["text"] as? String)?.contains("Hi from the phone") == true }
        }
    }

    private func waitForDisappearance(_ element: XCUIElement, timeout: TimeInterval = 8) -> Bool {
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: element)
        return XCTWaiter().wait(for: [gone], timeout: timeout) == .completed
    }
}
