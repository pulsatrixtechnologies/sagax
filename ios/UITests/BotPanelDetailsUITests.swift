import XCTest

/// WP7 of the iOS feature parity matrix: the bot panel's details (rows
/// BP6-BP10, BP12, BP14, BF1, BF3, BF4, BA11, SB28) against the parity
/// fixture. Each test acts in the app and then reads the result back through
/// the server's API, so a control that only changed the screen fails.
///
/// The Activity tests need a turn that holds still: start the fixture with
/// the card lab (`PARITY_CARDS=1 node ios/parity/fixture-server.mjs`), whose
/// "Card Lab" bot runs on an engine that never answers until stopped. The
/// session comes from TEST_RUNNER_PARITY_ENDPOINT / _TOKEN / _ENVIRONMENT or
/// `ios/parity/out/session.json`; without a fixture the tests skip.
final class BotPanelDetailsUITests: XCTestCase {
    private struct FixtureSession: Decodable {
        let endpoint: String
        let token: String
        let environmentId: String?
    }

    private var fixture: FixtureSession!

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

    private func bot(named name: String) throws -> [String: Any]? {
        try bots().first { $0["name"] as? String == name }
    }

    private func eventually(_ what: String, timeout: TimeInterval = 30, _ check: () throws -> Bool) throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if try check() { return }
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        }
        XCTFail("never true: \(what)")
    }

    /// Card Lab, busy on a turn that holds still. Skips without the card lab.
    private func busyCardLab() throws -> (id: String, threadId: String) {
        guard let lab = try api("GET", "/__parity/cards", allowFailure: true) as? [String: Any],
              let asks = (lab["bots"] as? [String: Any])?["asks"] as? [String: Any],
              let id = asks["id"] as? String, let threadId = asks["threadId"] as? String
        else { throw XCTSkip("start the fixture with PARITY_CARDS=1 for a turn that holds still") }
        if try bot(named: "Card Lab")?["busy"] as? Bool != true {
            try api("POST", "/api/bots/\(id)/messages", ["threadId": threadId, "text": "Travail de remplacement en cours"])
        }
        try eventually("Card Lab works") { try bot(named: "Card Lab")?["busy"] as? Bool == true }
        return (id, threadId)
    }

    // MARK: App

    @MainActor
    private func launchProfile(_ chat: String = "Ara") -> XCUIApplication {
        let app = XCUIApplication()
        app.terminate()
        var arguments = [
            "-parityEndpoint", fixture.endpoint, "-parityToken", fixture.token,
            "-parityScreen", "03-profile-info", "-parityChat", chat,
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES",
        ]
        if let environment = fixture.environmentId { arguments += ["-parityEnvironment", environment] }
        app.launchArguments = arguments
        app.launch()
        XCTAssertTrue(element("profile-name", in: app).waitForExistence(timeout: 30))
        return app
    }

    private func element(_ id: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    /// One row of the panel's overview list (Coding, Routines, Library,
    /// Computer) opens its page.
    private func openPage(_ id: String, in app: XCUIApplication) {
        let row = element(id, in: app)
        XCTAssertTrue(row.waitForExistence(timeout: 15), "\(id) is listed")
        row.tap()
    }

    private func scrollTo(_ target: XCUIElement, in app: XCUIApplication) {
        let scroll = app.scrollViews["profile-scroll"].firstMatch
        for _ in 0..<8 where !(target.exists && target.isHittable) {
            scroll.swipeUp()
        }
    }

    private func attach(_ name: String, _ app: XCUIApplication) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    // MARK: Activity (BP10)

    /// The Info tab's Activity card lists the running turn; its Stop
    /// interrupts it on the server.
    @MainActor
    func testActivityCardStopsTheRunningTurn() throws {
        let lab = try busyCardLab()
        let app = launchProfile("Card Lab")
        openPage("panel-overview.coding", in: app)
        let stop = element("activity-stop.thread:\(lab.threadId)", in: app)
        scrollTo(element("profile-activity", in: app), in: app)
        XCTAssertTrue(stop.waitForExistence(timeout: 30), "the running turn shows with Stop")
        scrollTo(stop, in: app)
        attach("Activity card, running", app)
        stop.tap()
        try eventually("Card Lab stopped on the server") { try bot(named: "Card Lab")?["busy"] as? Bool != true }
    }

    /// An entry's detail steers the running task with a message the server
    /// receives on that thread, then stops it.
    @MainActor
    func testActivityDetailSteersThenStops() throws {
        let lab = try busyCardLab()
        let app = launchProfile("Card Lab")
        openPage("panel-overview.coding", in: app)
        let row = element("activity-row.thread:\(lab.threadId)", in: app)
        scrollTo(element("profile-activity", in: app), in: app)
        XCTAssertTrue(row.waitForExistence(timeout: 30))
        scrollTo(row, in: app)
        row.tap()

        XCTAssertTrue(element("activity-detail", in: app).waitForExistence(timeout: 15))
        let field = element("activity-steer-field", in: app)
        XCTAssertTrue(field.waitForExistence(timeout: 15), "a running task the viewer may stop takes a message")
        field.tap()
        field.typeText("Pilotage WP7 remplacement")
        attach("Steer typed", app)
        XCTAssertEqual(field.value as? String, "Pilotage WP7 remplacement")
        element("activity-steer-send", in: app).tap()
        XCTAssertTrue(element("activity-steer-sent", in: app).waitForExistence(timeout: 20))
        try eventually("the steer reached Card Lab's thread") {
            let page = try api("GET", "/api/threads/\(lab.threadId)/messages?limit=200") as? [String: Any]
            let texts = (page?["messages"] as? [[String: Any]] ?? []).compactMap { $0["text"] as? String }
            let prompts = (try api("GET", "/__parity/cards") as? [String: Any])?["prompts"] as? [String] ?? []
            return texts.contains { $0.contains("Pilotage WP7") } || prompts.contains { $0.contains("Pilotage WP7") }
        }
        attach("Activity detail, steered", app)

        element("activity-detail-stop", in: app).tap()
        try eventually("Card Lab stopped on the server") { try bot(named: "Card Lab")?["busy"] as? Bool != true }
    }

    /// A section's title opens the history, which lists what the server
    /// lists for that filter.
    @MainActor
    func testHistoryListsWhatTheServerLists() throws {
        let ara = try XCTUnwrap(try bot(named: "Ara"))
        let id = try XCTUnwrap(ara["id"] as? String)
        let listed = (try api("GET", "/api/bots/\(id)/activity?filter=other&limit=50") as? [String: Any])
        let ids = ((listed?["items"] as? [[String: Any]] ?? []) + (listed?["subagents"] as? [[String: Any]] ?? [])).compactMap { $0["id"] as? String }
        let app = launchProfile()
        openPage("panel-overview.coding", in: app)
        let section = element("activity-section.other", in: app)
        scrollTo(section, in: app)
        XCTAssertTrue(section.waitForExistence(timeout: 20))
        section.tap()
        XCTAssertTrue(element("activity-history", in: app).waitForExistence(timeout: 15))
        if let first = ids.first {
            XCTAssertTrue(element("activity-history-row.\(first)", in: app).waitForExistence(timeout: 15), "the server's newest entry is listed")
        } else {
            XCTAssertTrue(element("activity-history-empty", in: app).waitForExistence(timeout: 15))
        }
        attach("Activity history", app)
        element("activity-done", in: app).tap()
    }

    // MARK: Routines (BP12)

    @MainActor
    func testARoutineIsDeletedFromTheProfile() throws {
        let ara = try XCTUnwrap(try bot(named: "Ara"))
        let id = try XCTUnwrap(ara["id"] as? String)
        let created = try api("POST", "/api/routines", [
            "botId": id, "name": "Routine WP7 a supprimer", "prompt": "Texte de remplacement",
            "runOn": "maus", "durationMinutes": 30,
            "schedule": ["type": "daily", "time": "09:00", "weekdays": [2]],
        ]) as? [String: Any]
        let routineId = try XCTUnwrap(((created?["routine"] as? [String: Any]) ?? created)?["id"] as? String)
        defer { _ = try? api("DELETE", "/api/routines/\(routineId)", allowFailure: true) }
        let app = launchProfile()
        openPage("panel-overview.routines", in: app)
        let row = element("profile-routine.Routine WP7 a supprimer", in: app)
        scrollTo(row, in: app)
        XCTAssertTrue(row.waitForExistence(timeout: 20))
        row.press(forDuration: 1.2)
        let delete = app.buttons["Delete routine"].firstMatch
        XCTAssertTrue(delete.waitForExistence(timeout: 10))
        delete.tap()
        // the confirmation's own Delete routine
        let confirm = app.buttons.matching(NSPredicate(format: "label == 'Delete routine'")).firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 10))
        confirm.tap()
        try eventually("the routine is gone on the server") {
            let routines = (try api("GET", "/api/routines") as? [String: Any])?["routines"] as? [[String: Any]] ?? []
            return !routines.contains { $0["id"] as? String == routineId }
        }
    }

    // MARK: Files (BF1, BF3, BF4)

    /// "Search this chat's files" lists the thread's files as the server
    /// does, narrows them by the search, copies a path and shows a file's
    /// message in the chat.
    @MainActor
    func testThisChatsFilesSearchCopyPathAndShowInChat() throws {
        let ara = try XCTUnwrap(try bot(named: "Ara"))
        let threadId = try XCTUnwrap(ara["threadId"] as? String)
        let files = (try api("GET", "/api/threads/\(threadId)/files") as? [String: Any])?["files"] as? [[String: Any]] ?? []
        guard let first = files.first, let name = first["name"] as? String else {
            throw XCTSkip("the fixture seeds no file in Ara's thread")
        }
        let app = launchProfile()
        element("panel-tab.library", in: app).tap()
        XCTAssertTrue(element("thread-files", in: app).waitForExistence(timeout: 15))
        for file in files.prefix(3) {
            let fileName = try XCTUnwrap(file["name"] as? String)
            XCTAssertTrue(element("thread-file.\(fileName)", in: app).waitForExistence(timeout: 15), "\(fileName) is listed")
        }
        attach("This chat's files", app)

        // Copy path, when the server gives one
        let copyable = files.first { file in
            (file["name"] as? String) == name && file["available"] as? Bool == true
                && ((file["localPath"] as? String ?? file["path"] as? String ?? "").hasPrefix("/"))
        }
        let actions = element("thread-file-actions.\(name)", in: app)
        XCTAssertTrue(actions.waitForExistence(timeout: 10))
        if copyable != nil {
            actions.tap()
            let copy = app.buttons["Copy path"].firstMatch
            XCTAssertTrue(copy.waitForExistence(timeout: 10))
            RunLoop.current.run(until: Date().addingTimeInterval(0.8))
            copy.tap()
            // the confirmation stays 2.5 s, as on the desktop: look at once
            let copied = app.staticTexts["thread-files-status"].exists
            attach("Copy path", app)
            XCTAssertTrue(copied, "the path is copied")
        }


        // the search keeps the matching file only
        let search = app.textFields["thread-files-search"].firstMatch
        if !search.isHittable { app.scrollViews["profile-scroll"].firstMatch.swipeDown() }
        XCTAssertTrue(search.waitForExistence(timeout: 10))
        search.tap()
        search.typeText(name)
        XCTAssertTrue(element("thread-file.\(name)", in: app).waitForExistence(timeout: 10))
        for other in files.compactMap({ $0["name"] as? String }) where !other.localizedCaseInsensitiveContains(name) && !name.localizedCaseInsensitiveContains(other) {
            XCTAssertFalse(element("thread-file.\(other)", in: app).exists, "\(other) is filtered out")
        }

        // Show in chat closes the panel over the chat
        actions.tap()
        let show = app.buttons["Show in chat"].firstMatch
        XCTAssertTrue(show.waitForExistence(timeout: 10))
        RunLoop.current.run(until: Date().addingTimeInterval(0.8))
        show.tap()
        XCTAssertTrue(app.buttons["chat-name"].waitForExistence(timeout: 20), "back in the chat")
        let messageId = try XCTUnwrap(first["messageId"] as? String)
        let page = try api("GET", "/api/threads/\(threadId)/messages?around=\(messageId)") as? [String: Any]
        XCTAssertTrue((page?["messages"] as? [[String: Any]] ?? []).contains { $0["id"] as? String == messageId }, "the file's message is on the server")
        attach("Shown in chat", app)
    }

    // MARK: More: voice notes, usage; the menu's Primary Bot (BP14, BA11, SB28)

    @MainActor
    func testVoiceNotesToggleSavesAndUsageShows() throws {
        let ara = try XCTUnwrap(try bot(named: "Ara"))
        let id = try XCTUnwrap(ara["id"] as? String)
        try api("PATCH", "/api/bots/\(id)", ["voiceNotes": true])
        defer { _ = try? api("PATCH", "/api/bots/\(id)", ["voiceNotes": true]) }
        let app = launchProfile()
        element("panel-edit-persona", in: app).tap()
        // Edit persona > Usage
        element("panel-row.usage", in: app).tap()
        XCTAssertTrue(element("bot-usage-empty", in: app).waitForExistence(timeout: 10) || element("bot-usage-turns", in: app).exists, "the usage section shows")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        // Edit persona > Voice & alerts
        element("panel-row.voice", in: app).tap()
        let toggle = app.switches["bot-voice-notes"].firstMatch
        for _ in 0..<8 where !(toggle.exists && toggle.isHittable) { app.swipeUp() }
        XCTAssertTrue(toggle.waitForExistence(timeout: 10))
        attach("More: voice notes", app)
        // the switch's own control sits at its trailing edge
        toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
        try eventually("voice notes are off on the server") { try bot(named: "Ara")?["voiceNotes"] as? Bool == false }
    }

    @MainActor
    func testMakePrimaryBotFromThePanelMenu() throws {
        let before = try bots().first { $0["chiefOfStaff"] as? Bool == true }?["id"] as? String
        let ara = try XCTUnwrap(try bot(named: "Ara"))
        let id = try XCTUnwrap(ara["id"] as? String)
        defer {
            if let before { _ = try? api("POST", "/api/bots/\(before)/primary") }
        }
        if ara["chiefOfStaff"] as? Bool == true, let other = try bots().first(where: { $0["id"] as? String != id && $0["hidden"] as? Bool != true })?["id"] as? String {
            try api("POST", "/api/bots/\(other)/primary")
        }
        let app = launchProfile()
        element("profile-more", in: app).tap()
        let make = element("profile-menu.make-primary", in: app)
        XCTAssertTrue(make.waitForExistence(timeout: 10))
        make.tap()
        try eventually("Ara is the Primary Bot on the server") { try bot(named: "Ara")?["chiefOfStaff"] as? Bool == true }
        XCTAssertEqual(try bots().filter { $0["chiefOfStaff"] as? Bool == true }.count, 1, "one Primary Bot")
    }

    // MARK: Character (BP6-BP8)

    /// A long press on the mascot offers the wing moves. There is no 3D style.
    @MainActor
    func testMovesFromTheMascotMenu() throws {
        let ara = try XCTUnwrap(try bot(named: "Ara"))
        let id = try XCTUnwrap(ara["id"] as? String)
        defer { _ = try? api("PATCH", "/api/bots/\(id)", ["mascotLook": ["character": "owl"], "color": "purple", "mascotSkin": "none"]) }
        try api("PATCH", "/api/bots/\(id)", ["mascotLook": ["character": "owl"]])
        let app = launchProfile()
        let mascot = element("profile-mascot", in: app)
        XCTAssertTrue(mascot.waitForExistence(timeout: 10))
        mascot.press(forDuration: 1.2)
        XCTAssertTrue(app.buttons["Hoot"].firstMatch.waitForExistence(timeout: 10), "the owl's moves")
        XCTAssertFalse(app.buttons["3D (preview)"].firstMatch.exists)
        attach("Mascot menu", app)
    }

    /// Skins earned or not: with achievements on, a locked skin cannot be
    /// worn from the phone either, and the server keeps the skin it had.
    @MainActor
    func testALockedSkinIsNotWorn() throws {
        let rewards = (try api("GET", "/api/me/achievements", allowFailure: true) as? [String: Any])?["rewards"] as? [String]
        guard let rewards else { throw XCTSkip("this server keeps no achievements: nothing is locked") }
        guard !rewards.contains("skin:owl:inferno") else { throw XCTSkip("inferno is unlocked on this fixture") }
        let ara = try XCTUnwrap(try bot(named: "Ara"))
        let id = try XCTUnwrap(ara["id"] as? String)
        try api("PATCH", "/api/bots/\(id)", ["mascotLook": ["character": "owl"], "mascotSkin": "none"])
        defer { _ = try? api("PATCH", "/api/bots/\(id)", ["mascotLook": ["character": "owl"], "mascotSkin": "none"]) }
        let app = launchProfile()
        element("profile-mascot", in: app).tap()
        let inferno = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'inferno'")).firstMatch
        XCTAssertTrue(inferno.waitForExistence(timeout: 15))
        XCTAssertEqual(inferno.value as? String, "Locked")
        inferno.tap()
        RunLoop.current.run(until: Date().addingTimeInterval(2))
        XCTAssertEqual(try bot(named: "Ara")?["mascotSkin"] as? String ?? "none", "none", "a locked skin is not saved")
    }

    /// Character row (BP6, #475): every character shows. Shiba, until
    /// character:shiba (or one of its skins) is in rewards, carries the
    /// padlock: a tap previews it ("nothing is saved") and the server keeps
    /// the owl.
    @MainActor
    func testALockedCharacterShowsWithItsPadlockAndPreviewsOnly() throws {
        let rewards = (try api("GET", "/api/me/achievements", allowFailure: true) as? [String: Any])?["rewards"] as? [String]
        guard let rewards else { throw XCTSkip("this server keeps no achievements: nothing is locked") }
        let ara = try XCTUnwrap(try bot(named: "Ara"))
        let id = try XCTUnwrap(ara["id"] as? String)
        defer { _ = try? api("PATCH", "/api/bots/\(id)", ["mascotLook": ["character": "owl"], "color": "purple", "mascotSkin": "none"]) }
        try api("PATCH", "/api/bots/\(id)", ["mascotLook": ["character": "owl"]])
        let app = launchProfile()
        element("profile-mascot", in: app).tap()
        XCTAssertTrue(app.buttons["Owl"].firstMatch.waitForExistence(timeout: 15), "Owl stays on the row")
        XCTAssertTrue(app.buttons["Crab"].firstMatch.waitForExistence(timeout: 10), "every character is on the row")
        let shiba = app.buttons["Shiba"].firstMatch
        XCTAssertTrue(shiba.waitForExistence(timeout: 10), "every character is on the row")
        guard !rewards.contains(where: { $0 == "character:shiba" || $0.hasPrefix("skin:shiba:") }) else {
            throw XCTSkip("Shiba is unlocked on this fixture")
        }
        XCTAssertEqual(shiba.value as? String, "Locked")
        shiba.tap()
        XCTAssertTrue(element("character-skin-preview", in: app).waitForExistence(timeout: 5), "a locked character previews")
        attach("Locked Shiba preview", app)
        RunLoop.current.run(until: Date().addingTimeInterval(2))
        let worn = (try bot(named: "Ara")?["mascotLook"] as? [String: Any])?["character"] as? String
        XCTAssertEqual(worn ?? "owl", "owl", "a locked character is not saved")
    }
}
