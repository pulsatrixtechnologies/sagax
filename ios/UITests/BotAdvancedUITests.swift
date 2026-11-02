import XCTest

/// WP16 of the iOS feature parity matrix: the advanced bot panel (rows BA2,
/// BA4-BA7, BA9, BA14-BA19) against the parity fixture. Each test acts in
/// the app and reads the result back through the server's API.
///
/// Decision D1 opens the panel on the owner's sidecar: start the fixture
/// with the real sidecar in front (`PARITY_OWNER=1 node
/// ios/parity/fixture-server.mjs`), which also seeds a disabled imported
/// skill on Ara. The session comes from TEST_RUNNER_PARITY_ENDPOINT /
/// _TOKEN (/ _ENVIRONMENT) or `ios/parity/out/session.json`; without a
/// fixture the tests skip.
final class BotAdvancedUITests: XCTestCase {
    private struct FixtureSession: Decodable {
        let endpoint: String
        let token: String
        let environmentId: String?
    }

    private var fixture: FixtureSession!
    private static let skill = "fixture-check"

    override func setUpWithError() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        if let endpoint = env["PARITY_ENDPOINT"], let token = env["PARITY_TOKEN"] {
            fixture = FixtureSession(endpoint: endpoint, token: token, environmentId: env["PARITY_ENVIRONMENT"].flatMap { $0.isEmpty ? nil : $0 })
            return
        }
        let file = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("parity/out/session.json")
        guard let data = try? Data(contentsOf: file) else { throw XCTSkip("no parity fixture: set TEST_RUNNER_PARITY_ENDPOINT and TEST_RUNNER_PARITY_TOKEN") }
        fixture = try JSONDecoder().decode(FixtureSession.self, from: data)
    }

    // MARK: API

    @discardableResult
    private func api(_ method: String, _ path: String, _ body: [String: Any]? = nil, allowFailure: Bool = false) throws -> Any? {
        var request = URLRequest(url: try XCTUnwrap(URL(string: fixture.endpoint + path)))
        request.httpMethod = method
        request.timeoutInterval = 60
        request.setValue("Bearer \(fixture.token)", forHTTPHeaderField: "Authorization")
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
        wait(for: [done], timeout: 70)
        let status = (result.1 as? HTTPURLResponse)?.statusCode ?? 0
        if !allowFailure {
            XCTAssertTrue((200...299).contains(status), "\(method) \(path) -> \(status): \(String(data: result.0 ?? Data(), encoding: .utf8) ?? "")")
        }
        guard let data = result.0, !data.isEmpty else { return nil }
        return try? JSONSerialization.jsonObject(with: data)
    }

    private func bots() throws -> [[String: Any]] {
        (try api("GET", "/api/bots") as? [String: Any])?["bots"] as? [[String: Any]] ?? []
    }

    private func araId() throws -> String {
        try XCTUnwrap(try bots().first { $0["name"] as? String == "Ara" }?["id"] as? String)
    }

    private func eventually(_ what: String, timeout: TimeInterval = 30, _ check: () throws -> Bool) throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if try check() { return }
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        }
        XCTFail("never true: \(what)")
    }

    /// The panel is the owner's sidecar's (D1) or an admin's: a fixture
    /// paired as a client skips.
    private func requirePanel() throws {
        guard try api("GET", "/api/bots/\(try araId())/skills", allowFailure: true) is [String: Any] else {
            throw XCTSkip("this pairing has no advanced panel: start the fixture with PARITY_OWNER=1")
        }
    }

    // MARK: App

    @MainActor
    private func launchAdvanced() -> XCUIApplication {
        let app = XCUIApplication()
        app.terminate()
        var arguments = [
            "-parityEndpoint", fixture.endpoint, "-parityToken", fixture.token,
            "-parityScreen", "03-profile-info", "-parityChat", "Ara",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES",
        ]
        if let environment = fixture.environmentId { arguments += ["-parityEnvironment", environment] }
        app.launchArguments = arguments
        app.launch()
        XCTAssertTrue(element("profile-name", in: app).waitForExistence(timeout: 30))
        // the bot panel's Edit bot (the Grok Bot layout: main sections, then pages)
        element("panel-edit-persona", in: app).tap()
        XCTAssertTrue(element("panel-persona", in: app).waitForExistence(timeout: 10))
        return app
    }

    private func element(_ id: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    /// Lists are lazy: an off-screen row does not exist until scrolled to.
    @discardableResult
    private func reveal(_ target: XCUIElement, in app: XCUIApplication, swipes: Int = 12) -> Bool {
        _ = target.waitForExistence(timeout: 3)
        for _ in 0..<swipes where !(target.exists && target.isHittable) {
            app.swipeUp()
            _ = target.waitForExistence(timeout: 1)
        }
        return target.exists
    }

    /// The Edit bot page a section's row sits on (`BotEditTree`); nil is
    /// the first page.
    private func page(of row: String) -> String? {
        switch row.replacingOccurrences(of: "panel-row.", with: "") {
        case "soul", "skills", "memory": "panel-edit-page.personality"
        case "worksOn", "access", "perspicax", "slack": "panel-edit-page.toolsApps"
        case "sharing", "visibility": "panel-edit-page.sharing"
        case "overview", "usage", "history": "panel-edit-page.advanced"
        case "voice": "panel-edit-page.identity"
        default: nil
        }
    }

    @MainActor
    private func open(_ row: String, in app: XCUIApplication) {
        if let page = page(of: row), !element(row, in: app).exists {
            let pageRow = element(page, in: app)
            reveal(pageRow, in: app)
            pageRow.tap()
        }
        let link = element(row, in: app)
        reveal(link, in: app)
        XCTAssertTrue(link.waitForExistence(timeout: 10), "\(row) shows on this pairing")
        link.tap()
    }

    private func attach(_ name: String, _ app: XCUIApplication) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    // MARK: Skills (BA4)

    /// A disabled import is reviewed in full before it is switched on; then
    /// it is removed. The server says so each time.
    /// #153: Auto heads the Model page; on, the server keeps `auto` on the
    /// bot's selection; off pins the model again.
    @MainActor
    func testAutoModelIsSavedOnTheServer() throws {
        try requirePanel()
        let id = try araId()
        func auto() throws -> Bool {
            let bot = try bots().first { $0["id"] as? String == id }
            let selections = [(bot?["modelSelection"] as? [String: Any])] + ((bot?["tasks"] as? [[String: Any]]) ?? []).map { $0["modelSelection"] as? [String: Any] }
            return selections.contains { $0?["auto"] as? Bool == true }
        }
        let app = launchAdvanced()
        open("panel-row.model", in: app)
        let toggle = app.switches["model-auto"].firstMatch
        XCTAssertTrue(toggle.waitForExistence(timeout: 15), app.debugDescription)
        let was = try auto()
        toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        try eventually("auto flipped on the server") { try auto() == !was }
        toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        try eventually("auto back") { try auto() == was }
    }

    @MainActor
    func testSkillIsReviewedEnabledThenRemoved() throws {
        try requirePanel()
        let id = try araId()
        let listed = ((try api("GET", "/api/bots/\(id)/skills") as? [String: Any])?["skills"] as? [[String: Any]]) ?? []
        guard let skill = listed.first(where: { $0["name"] as? String == Self.skill }) else {
            throw XCTSkip("the fixture's seeded skill is gone (a previous run removed it)")
        }
        if skill["enabled"] as? Bool == true {
            try api("PATCH", "/api/bots/\(id)/skills/\(Self.skill)", ["enabled": false])
        }
        let app = launchAdvanced()
        open("panel-row.skills", in: app)
        let toggle = app.switches["skill-toggle.\(Self.skill)"].firstMatch
        XCTAssertTrue(toggle.waitForExistence(timeout: 15))
        attach("Skills", app)
        toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let enable = element("skill-enable-reviewed", in: app)
        XCTAssertTrue(enable.waitForExistence(timeout: 10), "the review shows before enabling")
        XCTAssertTrue(app.staticTexts["Full SKILL.md for \(Self.skill)"].firstMatch.exists, "the full SKILL.md shows")
        attach("Skill review", app)
        enable.tap()
        try eventually("the skill is on on the server") {
            let skills = ((try api("GET", "/api/bots/\(id)/skills") as? [String: Any])?["skills"] as? [[String: Any]]) ?? []
            return skills.first { $0["name"] as? String == Self.skill }?["enabled"] as? Bool == true
        }

        let row = element("skill-open.\(Self.skill)", in: app)
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.swipeLeft()
        app.buttons["Remove"].firstMatch.tap()
        let confirm = element("skills-remove-confirm", in: app)
        XCTAssertTrue(confirm.waitForExistence(timeout: 10))
        confirm.tap()
        try eventually("the skill is gone on the server") {
            let skills = ((try api("GET", "/api/bots/\(id)/skills") as? [String: Any])?["skills"] as? [[String: Any]]) ?? []
            return !skills.contains { $0["name"] as? String == Self.skill }
        }
        XCTAssertTrue(element("skills-empty", in: app).waitForExistence(timeout: 10) || reveal(element("skills-empty", in: app), in: app))
    }

    // MARK: Memory (BA5)

    /// MEMORY.md saves with its hash; a bot's write in between is a
    /// conflict, and "Overwrite with mine" saves the person's words.
    @MainActor
    func testMemorySavesAndAConflictIsOverwritten() throws {
        try requirePanel()
        let id = try araId()
        let doc = try XCTUnwrap(try api("GET", "/api/bots/\(id)/memory/file?path=MEMORY.md") as? [String: Any])
        try api("PUT", "/api/bots/\(id)/memory/file", ["path": "MEMORY.md", "text": "- Placeholder fact one\n", "expectedHash": doc["hash"] as? String ?? ""])
        let app = launchAdvanced()
        open("panel-row.memory", in: app)
        XCTAssertTrue(element("memory-gauge", in: app).waitForExistence(timeout: 15), "the gauge shows")
        let file = element("memory-file.MEMORY.md", in: app)
        XCTAssertTrue(reveal(file, in: app))
        file.tap()
        let editor = element("memory-editor", in: app)
        XCTAssertTrue(editor.waitForExistence(timeout: 10))
        editor.tap()
        app.typeText("- Placeholder from the phone\n")
        element("memory-save", in: app).tap()
        try eventually("the phone's line is saved") {
            ((try api("GET", "/api/bots/\(id)/memory/file?path=MEMORY.md") as? [String: Any])?["text"] as? String ?? "").contains("Placeholder from the phone")
        }

        // the bot writes meanwhile: the phone's next save is refused (409)
        let now = try XCTUnwrap(try api("GET", "/api/bots/\(id)/memory/file?path=MEMORY.md") as? [String: Any])
        try api("PUT", "/api/bots/\(id)/memory/file", ["path": "MEMORY.md", "text": "- The bot's own rewrite\n", "expectedHash": now["hash"] as? String ?? ""])
        editor.tap()
        app.typeText("- Second phone line\n")
        element("memory-save", in: app).tap()
        let overwrite = element("memory-conflict-overwrite", in: app)
        XCTAssertTrue(overwrite.waitForExistence(timeout: 10), "the conflict shows")
        attach("Memory conflict", app)
        let unchanged = (try api("GET", "/api/bots/\(id)/memory/file?path=MEMORY.md") as? [String: Any])?["text"] as? String
        XCTAssertEqual(unchanged, "- The bot's own rewrite\n", "nothing was saved over the bot's version")
        overwrite.tap()
        try eventually("the phone's words win") {
            ((try api("GET", "/api/bots/\(id)/memory/file?path=MEMORY.md") as? [String: Any])?["text"] as? String ?? "").contains("Second phone line")
        }
    }

    /// The upkeep switch writes `memoryUpkeep` (a companion field).
    @MainActor
    func testMemoryUpkeepSwitchSaves() throws {
        try requirePanel()
        let id = try araId()
        try api("PATCH", "/api/bots/\(id)", ["memoryUpkeep": true])
        defer { _ = try? api("PATCH", "/api/bots/\(id)", ["memoryUpkeep": true]) }
        let app = launchAdvanced()
        open("panel-row.memory", in: app)
        let toggle = app.switches["memory-upkeep"].firstMatch
        XCTAssertTrue(reveal(toggle, in: app))
        toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
        try eventually("upkeep is off on the server") {
            try bots().first { $0["id"] as? String == id }?["memoryUpkeep"] as? Bool == false
        }
    }

    // MARK: History (BA18)

    /// "Undo this change" on the newest instructions row restores the text
    /// from before it.
    @MainActor
    func testHistoryUndoRestoresTheInstructions() throws {
        try requirePanel()
        let id = try araId()
        let before = try XCTUnwrap((try api("GET", "/api/bots/\(id)/soul") as? [String: Any])?["soul"] as? String)
        try api("PATCH", "/api/bots/\(id)", ["soul": before + "\nPlaceholder: a change to undo."])
        defer { _ = try? api("PATCH", "/api/bots/\(id)", ["soul": before]) }
        let history = try XCTUnwrap(try api("GET", "/api/bots/\(id)/history?limit=100") as? [String: Any])
        let newest = try XCTUnwrap((history["rows"] as? [[String: Any]])?
            .filter { $0["field"] as? String == "soul" && $0["canRestore"] as? Bool == true }
            .max { ($0["at"] as? Double ?? 0) < ($1["at"] as? Double ?? 0) }?["id"] as? String)

        let app = launchAdvanced()
        open("panel-row.history", in: app)
        let undo = element("history-undo.\(newest)", in: app)
        XCTAssertTrue(undo.waitForExistence(timeout: 15) || reveal(undo, in: app))
        attach("History", app)
        undo.tap()
        let confirm = app.buttons["Restore instructions"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 10))
        confirm.tap()
        try eventually("the instructions are back") {
            (try api("GET", "/api/bots/\(id)/soul") as? [String: Any])?["soul"] as? String == before
        }
    }

    // MARK: Prompt preview (BA2), Access (BA6)

    @MainActor
    func testPromptPreviewAndOwnerAccess() throws {
        try requirePanel()
        let app = launchAdvanced()
        // the prompt preview is on Overview, as OverviewSection.tsx draws it
        open("panel-row.overview", in: app)
        XCTAssertTrue(reveal(element("prompt-preview-header", in: app), in: app), "the sizes show")
        XCTAssertTrue(element("prompt-preview-part.soul", in: app).exists, "the instructions part shows")
        attach("Prompt preview", app)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        open("panel-row.access", in: app)
        XCTAssertTrue(element("access-folder", in: app).waitForExistence(timeout: 10))
        // Lot 1: the owner's sidecar edits Access (browser switch), no read-only note
        XCTAssertFalse(element("access-read-only", in: app).exists, "the owner edits Access on the phone")
        XCTAssertTrue(app.switches["access-browser"].waitForExistence(timeout: 5), "browser switch for the owner")
        attach("Access", app)
    }

    // MARK: Command allowlist (BA9)

    @MainActor
    func testAllowlistRuleIsRemoved() throws {
        try requirePanel()
        let id = try araId()
        let rules = ((try api("GET", "/api/bots/\(id)/command-allowlist") as? [String: Any])?["rules"] as? [[String: Any]]) ?? []
        guard let rule = rules.first, let ruleId = rule["id"] as? String else { throw XCTSkip("no saved rule left on Ara") }
        let app = launchAdvanced()
        // Permissions > Command allowlist (PermissionsSection.tsx)
        open("panel-row.permissions", in: app)
        open("permissions-allowlist", in: app)
        let remove = element("allowlist-remove.\(ruleId)", in: app)
        XCTAssertTrue(remove.waitForExistence(timeout: 15) || reveal(remove, in: app))
        attach("Allowed commands", app)
        remove.tap()
        try eventually("the rule is gone on the server") {
            let after = ((try api("GET", "/api/bots/\(id)/command-allowlist") as? [String: Any])?["rules"] as? [[String: Any]]) ?? []
            return !after.contains { $0["id"] as? String == ruleId }
        }
    }

    // MARK: Display hygiene (Lot 8)

    /// Changes and Memory never show a UUID/GUID on the open surface. Ids
    /// and paths stay behind Show details / Show path. Skips without a
    /// parity fixture (same as the other advanced panel tests).
    @MainActor
    func testChangesAndMemoryHideUuidsOnTheOpenSurface() throws {
        try requirePanel()
        let id = try araId()
        let uuidPattern = try NSRegularExpression(
            pattern: "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
            options: [.caseInsensitive]
        )
        func hasUuid(_ text: String) -> Bool {
            let range = NSRange(text.startIndex..., in: text)
            return uuidPattern.firstMatch(in: text, range: range) != nil
        }

        let app = launchAdvanced()
        open("panel-row.history", in: app)
        XCTAssertTrue(element("history-page", in: app).waitForExistence(timeout: 15)
                      || app.navigationBars["Changes"].waitForExistence(timeout: 5))
        // Open-surface labels only: skip identifiers that name a folded row.
        let historyTree = app.debugDescription
        let historyOpen = historyTree
            .components(separatedBy: .newlines)
            .filter { line in
                line.contains("StaticText") && !line.contains("history-details") && !line.contains("history-undo")
            }
            .joined(separator: "\n")
        XCTAssertFalse(hasUuid(historyOpen), "Changes open surface shows UUID:\n\(historyOpen)")
        attach("Changes hygiene", app)

        app.navigationBars.buttons.element(boundBy: 0).tap()
        open("panel-row.memory", in: app)
        XCTAssertTrue(element("memory-show-path", in: app).waitForExistence(timeout: 15)
                      || reveal(element("memory-show-path", in: app), in: app)
                      || element("memory-enabled", in: app).waitForExistence(timeout: 5),
                      "Memory page opens")
        // Collapsed: the scrubbed path (and the raw UUID path) stay hidden.
        XCTAssertFalse(element("memory-path-display", in: app).exists,
                       "path stays behind Show path until opened")
        let memoryTree = app.debugDescription
        XCTAssertFalse(hasUuid(memoryTree.replacingOccurrences(of: id, with: "")),
                       "Memory open surface shows UUID:\n\(memoryTree)")
        // Bot id must not appear as readable path text (identifier suffixes are fine).
        let memoryLabels = memoryTree
            .components(separatedBy: .newlines)
            .filter { $0.contains("StaticText") && !$0.contains("Identifier") }
            .joined(separator: "\n")
        XCTAssertFalse(memoryLabels.contains(id), "Memory open surface shows bot id:\n\(memoryLabels)")
        attach("Memory hygiene", app)
    }

    // MARK: The bot's one "..." menu (#518)

    /// The menu holds Edit bot, Rename, the export and Archive (Duplicate
    /// left it with the desktop's); Rename saves through the server.
    @MainActor
    func testTheBotMenuRenamesTheBot() throws {
        try requirePanel()
        let id = try araId()
        let app = launchAdvanced()
        app.navigationBars.buttons.firstMatch.tap()
        element("profile-more", in: app).tap()
        XCTAssertTrue(element("profile-menu.edit-bot", in: app).waitForExistence(timeout: 10))
        XCTAssertTrue(element("profile-menu.copy-markdown", in: app).exists)
        XCTAssertFalse(element("profile-menu.duplicate", in: app).exists)
        element("profile-menu.rename", in: app).tap()
        let field = element("panel-rename-field", in: app)
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 12) + "Ara renamed")
        app.alerts.buttons["Save"].tap()
        try eventually("the server has the new name") {
            (try bots().first { $0["id"] as? String == id }?["name"] as? String) == "Ara renamed"
        }
        try api("PATCH", "/api/bots/\(id)/profile", ["name": "Ara"])
    }
}
