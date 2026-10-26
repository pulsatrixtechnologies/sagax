import XCTest

/// The bot panel (03 to 10: Details, Library, More, the avatar editor and
/// the top bar menu) and its routine screens (05, 06) against the parity
/// fixture server: every action is a real request, and each test reads
/// the result back from the server's API.
///
/// Start the fixture first and pass its session to the test runner:
///
///   node ios/parity/fixture-server.mjs &
///   TEST_RUNNER_PARITY_ENDPOINT=... TEST_RUNNER_PARITY_TOKEN=... \
///   TEST_RUNNER_PARITY_ENVIRONMENT=... xcodebuild test \
///     -only-testing:SagaxUITests/ProfileUITests ...
///
/// Without those variables the tests skip.
final class ProfileUITests: XCTestCase {
    private var endpoint = ""
    private var token = ""
    private var environment: String?

    override func setUpWithError() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        guard let endpoint = env["PARITY_ENDPOINT"], let token = env["PARITY_TOKEN"] else {
            throw XCTSkip("no parity fixture: set TEST_RUNNER_PARITY_ENDPOINT and TEST_RUNNER_PARITY_TOKEN")
        }
        self.endpoint = endpoint
        self.token = token
        environment = env["PARITY_ENVIRONMENT"].flatMap { $0.isEmpty ? nil : $0 }
    }

    // MARK: Launch

    @MainActor
    private func launch(screen: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.terminate()
        var arguments = ["-parityEndpoint", endpoint, "-parityToken", token, "-parityScreen", screen]
        if let environment { arguments += ["-parityEnvironment", environment] }
        // PARITY_SKIN=system follows the simulator's light or dark appearance
        if let skin = ProcessInfo.processInfo.environment["PARITY_SKIN"], !skin.isEmpty { arguments += ["-paritySkin", skin] }
        app.launchArguments = arguments
        app.launch()
        return app
    }

    /// Ara's bot panel, opened from her chat by the parity launcher.
    @MainActor
    private func launchProfile() -> XCUIApplication {
        let app = launch(screen: "03-profile-info")
        XCTAssertTrue(element("profile-name", in: app).waitForExistence(timeout: 30))
        return app
    }

    /// The mascot opens the avatar editor, as the desktop's does.
    @MainActor
    private func launchAvatarEditor() -> XCUIApplication {
        let app = launchProfile()
        element("profile-mascot", in: app).tap()
        XCTAssertTrue(element("character-reset", in: app).waitForExistence(timeout: 10))
        return app
    }

    private func element(_ id: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    /// The panel's Routines row opens the routines page.
    private func openRoutines(in app: XCUIApplication) {
        let row = element("panel-overview.routines", in: app)
        XCTAssertTrue(row.waitForExistence(timeout: 15), "the Routines row is listed")
        row.tap()
    }

    private func scrollTo(_ element: XCUIElement, in app: XCUIApplication) {
        let scroll = app.scrollViews["profile-scroll"].firstMatch
        for _ in 0..<6 where !element.isHittable {
            scroll.swipeUp()
        }
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

    private func bot(named name: String) throws -> [String: Any]? {
        try bots().first { $0["name"] as? String == name }
    }

    private func routines() throws -> [[String: Any]] {
        (try api("GET", "/api/routines") as? [String: Any])?["routines"] as? [[String: Any]] ?? []
    }

    /// Poll the server until `check` holds.
    private func eventually(_ what: String, timeout: TimeInterval = 10, _ check: () throws -> Bool) throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if try check() { return }
            RunLoop.current.run(until: Date().addingTimeInterval(0.4))
        }
        XCTFail("never true: \(what)")
    }

    // MARK: Character

    @MainActor
    func testCharacterChangeSavesAtOnceAndResetGoesBackToTheDefault() throws {
        let ara = try XCTUnwrap(try bot(named: "Ara"))
        let id = try XCTUnwrap(ara["id"] as? String)
        defer { _ = try? api("PATCH", "/api/bots/\(id)", ["color": "purple", "mascotLook": ["character": "owl"], "mascotSkin": "none"]) }
        let app = launchAvatarEditor()

        let teal = app.buttons["teal"]
        XCTAssertTrue(teal.waitForExistence(timeout: 10))
        teal.tap()
        try eventually("Ara is teal on the server") { try bot(named: "Ara")?["color"] as? String == "teal" }

        app.buttons["Shape"].tap()
        try eventually("Ara is a shape on the server") {
            ((try bot(named: "Ara")?["mascotLook"] as? [String: Any])?["character"] as? String) == "shape"
        }

        let reset = app.buttons["character-reset"]
        XCTAssertTrue(reset.exists)
        reset.tap()
        try eventually("Ara is the default green owl again") {
            let now = try bot(named: "Ara")
            return now?["color"] as? String == "green"
                && ((now?["mascotLook"] as? [String: Any])?["character"] as? String) == "owl"
        }
    }

    /// A shape plays the fourteen Shapes moves from the mascot's long press
    /// (the desktop editor's Moves), and its colour picker offers the Clay
    /// palette (MS5): a Clay colour saves at once.
    @MainActor
    func testAShapePlaysItsMovesAndWearsAClayColour() throws {
        let ara = try XCTUnwrap(try bot(named: "Ara"))
        let id = try XCTUnwrap(ara["id"] as? String)
        defer { _ = try? api("PATCH", "/api/bots/\(id)", ["color": "purple", "mascotLook": ["character": "owl"], "mascotSkin": "none"]) }
        try api("PATCH", "/api/bots/\(id)", ["mascotLook": ["character": "shape", "shape": "cloud"]])
        let app = launchProfile()

        let mascot = element("profile-mascot", in: app)
        mascot.press(forDuration: 1.2)
        // a context menu keeps its items' names, not their identifiers
        let menu = app.collectionViews.firstMatch
        let orbit = menu.buttons["Orbit"]
        XCTAssertTrue(orbit.waitForExistence(timeout: 10), "the Moves menu lists the Shapes moves")
        for move in ["Thinking", "Wink", "Wide eyes", "Alert", "Notification", "Exclamation", "Sleep", "Egg", "Hexagon", "Play", "Swirl", "Burst", "Comet"] {
            XCTAssertTrue(menu.buttons[move].exists, move)
        }
        orbit.tap()
        // the menu folds away before the mascot takes a tap again
        let gone = Date().addingTimeInterval(5)
        while menu.exists, Date() < gone { RunLoop.current.run(until: Date().addingTimeInterval(0.2)) }
        XCTAssertTrue(mascot.waitForExistence(timeout: 5))
        mascot.tap()
        XCTAssertTrue(element("character-reset", in: app).waitForExistence(timeout: 10))
        let palettes = app.segmentedControls["character-color-palette"]
        XCTAssertTrue(palettes.waitForExistence(timeout: 5), "a shape offers the Clay palette")
        palettes.buttons["Clay"].tap()
        let tomato = app.buttons["tomato"]
        XCTAssertTrue(tomato.waitForExistence(timeout: 5))
        tomato.tap()
        try eventually("Ara wears Clay tomato on the server") { try bot(named: "Ara")?["color"] as? String == "tomato" }
    }

    // MARK: Picture

    /// Generate runs the real route against the fixture's image provider
    /// stub: the bot gets a stored picture, and Frame and Remove appear.
    @MainActor
    func testGenerateGivesTheBotAStoredPicture() throws {
        let ara = try XCTUnwrap(try bot(named: "Ara"))
        let id = try XCTUnwrap(ara["id"] as? String)
        defer { _ = try? api("PATCH", "/api/bots/\(id)", ["avatarUrl": NSNull(), "avatarCrop": "mascot"]) }
        try api("PATCH", "/api/bots/\(id)", ["avatarUrl": NSNull(), "avatarCrop": "mascot"])
        let app = launchAvatarEditor()

        element("avatar-tab.generate", in: app).tap()
        let generate = element("character-photo-generate", in: app)
        XCTAssertTrue(generate.waitForExistence(timeout: 10))
        XCTAssertFalse(element("character-photo-frame", in: app).exists, "no picture yet, nothing to frame")
        let field = element("avatar-generate-prompt", in: app)
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("Une chouette calme")
        generate.tap()

        try eventually("Ara has a generated picture on the server", timeout: 30) {
            (try bot(named: "Ara")?["avatarUrl"] as? String)?.hasPrefix("/api/attachments/") == true
        }
        XCTAssertEqual(try bot(named: "Ara")?["avatarCrop"] as? String, "circle")
        element("avatar-tab.upload", in: app).tap()
        XCTAssertTrue(element("character-photo-frame", in: app).waitForExistence(timeout: 10))
        XCTAssertTrue(element("character-photo-remove", in: app).exists)

        // Remove goes back to the mascot.
        element("character-photo-remove", in: app).tap()
        try eventually("Ara's picture is removed") {
            let now = try bot(named: "Ara")
            return now?["avatarUrl"] as? String == nil && now?["avatarCrop"] as? String == "mascot"
        }
    }

    /// Frame: a pinch and a drag in the framing sheet are saved, and the
    /// server returns the new zoom and focus.
    @MainActor
    func testFramingSavesZoomAndFocus() throws {
        let ara = try XCTUnwrap(try bot(named: "Ara"))
        let id = try XCTUnwrap(ara["id"] as? String)
        defer { _ = try? api("PATCH", "/api/bots/\(id)", ["avatarUrl": NSNull(), "avatarCrop": "mascot"]) }
        // A picture to frame, through the same route the Generate button uses.
        try api("POST", "/api/bots/\(id)/avatar/generate", ["prompt": "Une chouette calme"])
        try api("PATCH", "/api/bots/\(id)", ["avatarZoom": 1, "avatarFocusX": 0.5, "avatarFocusY": 0.5])
        let app = launchAvatarEditor()
        element("avatar-tab.upload", in: app).tap()

        let frame = element("character-photo-frame", in: app)
        XCTAssertTrue(frame.waitForExistence(timeout: 10))
        frame.tap()
        let picture = element("framing-picture", in: app)
        XCTAssertTrue(picture.waitForExistence(timeout: 10))
        picture.pinch(withScale: 2.2, velocity: 1)
        let start = picture.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        start.press(forDuration: 0.1, thenDragTo: picture.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.75)))
        element("framing-save", in: app).tap()

        try eventually("the framing is saved on the server") {
            let now = try bot(named: "Ara")
            let zoom = now?["avatarZoom"] as? Double ?? 1
            let x = now?["avatarFocusX"] as? Double ?? 0.5
            let y = now?["avatarFocusY"] as? Double ?? 0.5
            return zoom > 1.2 && x < 0.5 && y < 0.5
        }
        // Reopened, the sheet starts from what the server holds.
        XCTAssertTrue(frame.waitForExistence(timeout: 10))
    }

    /// Upload: the Photo row offers the system picker (PhotosPicker). The
    /// picker itself runs out of process; what it hands back is covered by
    /// `ProfileClientTests.testUploadAvatarPostsTheBytesAndReturnsTheStoredPath`.
    @MainActor
    func testUploadOpensThePhotoPicker() throws {
        let app = launchAvatarEditor()
        element("avatar-tab.upload", in: app).tap()
        let upload = element("character-photo-upload", in: app)
        XCTAssertTrue(upload.waitForExistence(timeout: 10))
        XCTAssertTrue(upload.isHittable)
        upload.tap()
        // The picker is a remote view: its navigation bar or its "Photos" tab shows.
        let shown = app.navigationBars.matching(NSPredicate(format: "identifier CONTAINS[c] 'photo' OR identifier CONTAINS[c] 'Photos'")).firstMatch
        let cancel = app.buttons["Cancel"]
        XCTAssertTrue(shown.waitForExistence(timeout: 10) || cancel.waitForExistence(timeout: 5), "the photo picker opens")
        if cancel.exists { cancel.tap() }
    }

    // MARK: Instructions

    @MainActor
    func testInstructionsShowTheSoulAndAnEditSaves() throws {
        let ara = try XCTUnwrap(try bot(named: "Ara"))
        let id = try XCTUnwrap(ara["id"] as? String)
        // The fixture saves Ara's instructions (SOUL_ARA) when it creates her.
        let before = try XCTUnwrap((try api("GET", "/api/bots/\(id)/soul") as? [String: Any])?["soul"] as? String)
        XCTAssertTrue(before.contains("Tu coordonnes l'équipe"), "the fixture seeds Ara's soul: \(before)")
        defer { _ = try? api("PATCH", "/api/bots/\(id)", ["soul": before]) }
        let app = launchProfile()

        // Edit persona > Soul (the standing instructions), where the pairing has it
        element("panel-edit-persona", in: app).tap()
        let soul = element("panel-row.soul", in: app)
        guard soul.waitForExistence(timeout: 10) else { throw XCTSkip("this pairing has no Soul section: start the fixture with PARITY_OWNER=1") }
        soul.tap()
        let body = app.staticTexts["text-card-body"]
        XCTAssertTrue(body.waitForExistence(timeout: 10))
        XCTAssertTrue(body.label.contains("Tu coordonnes"), body.label)

        element("instructions-edit", in: app).tap()
        let editor = app.textViews["instructions-editor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        editor.tap()
        editor.typeText(" UIEDIT42")
        element("instructions-save", in: app).tap()
        XCTAssertTrue(app.staticTexts["text-card-body"].waitForExistence(timeout: 10))
        try eventually("the soul carries the edit") {
            ((try api("GET", "/api/bots/\(id)/soul") as? [String: Any])?["soul"] as? String)?.contains("UIEDIT42") == true
        }
    }

    // MARK: Routines

    @MainActor
    func testRoutineDetailShowsTheScheduleAndTheActiveToggleSaves() throws {
        let app = launchProfile()
        openRoutines(in: app)
        let row = element("profile-routine.Scan skills populaires mensuel", in: app)
        scrollTo(row, in: app)
        XCTAssertTrue(row.label.contains("CRON_TZ=America/Toronto 2 7 1-7 * 1"), row.label)
        let paused = element("profile-routine.Planif CW approbation temps lundi", in: app)
        XCTAssertTrue(paused.label.contains("Every Monday at 7:00 AM · Paused"), paused.label)
        row.tap()

        XCTAssertTrue(app.staticTexts["routine-title"].waitForExistence(timeout: 10))
        XCTAssertTrue(element("routine-no-runs", in: app).exists)
        let active = element("routine-active", in: app)
        XCTAssertTrue(active.exists)
        func enabled() throws -> Bool? {
            try routines().first { $0["name"] as? String == "Scan skills populaires mensuel" }?["enabled"] as? Bool
        }
        XCTAssertEqual(try enabled(), true)
        active.tap()
        try eventually("the routine is paused on the server") { try enabled() == false }
        active.tap()
        try eventually("the routine is active again") { try enabled() == true }

        element("routine-instruction", in: app).tap()
        let text = app.staticTexts["text-card-body"]
        XCTAssertTrue(text.waitForExistence(timeout: 5))
        XCTAssertTrue(text.label.contains("Texte de remplacement"))
    }

    @MainActor
    func testAddRoutineCreatesOneForThisBot() throws {
        let ara = try XCTUnwrap(try bot(named: "Ara"))
        let id = try XCTUnwrap(ara["id"] as? String)
        let name = "UI routine \(Int(Date().timeIntervalSince1970) % 100_000)"
        let app = launchProfile()
        openRoutines(in: app)
        let add = element("profile-add-routine", in: app)
        scrollTo(add, in: app)
        add.tap()

        let nameField = app.textFields["Routine name"]
        XCTAssertTrue(nameField.waitForExistence(timeout: 10))
        nameField.tap()
        nameField.typeText(name)
        let prompt = app.textFields["What should the agent do?"]
        prompt.tap()
        prompt.typeText("Placeholder routine made by the UI test.")
        // a new routine's button says "Schedule routine", as on the desktop
        element("routine-editor-save", in: app).tap()

        try eventually("the routine exists on the server for Ara") {
            try routines().contains { $0["name"] as? String == name && $0["botId"] as? String == id }
        }
        XCTAssertTrue(element("profile-routine.\(name)", in: app).waitForExistence(timeout: 10))
        if let created = try routines().first(where: { $0["name"] as? String == name }), let rid = created["id"] as? String {
            try api("DELETE", "/api/routines/\(rid)")
        }
    }

    // MARK: Library

    /// The Links chip (JC 2026-10-18): every link once, without the code
    /// mark a message wrapped it in (no `%60`), a computer-only address
    /// greyed "On the computer" that copies instead of failing to open, and
    /// a web link that opens in the in-app browser. SAGAX_SHOTS keeps the
    /// screens (the first one also runs on builds before the fix).
    @MainActor
    func testLinksOpenInTheAppAndComputerLinksCopy() throws {
        try XCTSkipIf(UIDevice.current.userInterfaceIdiom == .pad, "the iPad's panel: testIPadLibraryShowsTheLinks")
        let app = launchProfile()
        element("panel-tab.library", in: app).tap()
        let chip = element("thread-files-chip.links", in: app)
        XCTAssertTrue(chip.waitForExistence(timeout: 15))
        chip.tap()
        XCTAssertTrue(element("profile-link.1", in: app).waitForExistence(timeout: 10))
        element("profile-show-more", in: app).tap()
        XCTAssertTrue(element("profile-link.5", in: app).waitForExistence(timeout: 10))
        sleep(4) // page previews, or their fallback
        scrollTo(element("profile-link.6", in: app), in: app)
        ParityShots.save("links-list", app)

        let rows = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'profile-link.'"))
        let labels = rows.allElementsBoundByIndex.map(\.label)
        XCTAssertFalse(labels.contains { $0.contains("%60") || $0.contains("`") }, "\(labels)")
        XCTAssertEqual(labels.filter { $0.contains("127.0.0.1:8787") }.count, 1, "\(labels)")

        // a computer-only address copies
        let local = rows.matching(NSPredicate(format: "label CONTAINS '127.0.0.1:8787'")).firstMatch
        XCTAssertTrue(local.label.contains("On the computer"), local.label)
        local.tap()
        XCTAssertTrue(element("profile-links-status", in: app).waitForExistence(timeout: 5))

        // the long press: open in Safari, copy, share, go to the message
        let web = rows.matching(NSPredicate(format: "label CONTAINS 'docs.example.com'")).firstMatch
        scrollTo(web, in: app)
        web.press(forDuration: 1.2)
        XCTAssertTrue(app.buttons["link-menu.safari"].waitForExistence(timeout: 5) || app.buttons["Open in Safari"].waitForExistence(timeout: 2))
        XCTAssertTrue(app.buttons["Copy link"].exists || app.buttons["link-menu.copy"].exists)
        XCTAssertTrue(app.buttons["Go to message"].exists || app.buttons["link-menu.message"].exists)
        ParityShots.save("links-menu", app)
        // choosing an item closes the menu
        app.buttons["Copy link"].firstMatch.tap()
        let closed = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.buttons["Open in Safari"].firstMatch)
        wait(for: [closed], timeout: 5)

        // a tap opens the in-app browser (SFSafariViewController)
        XCTAssertTrue(web.waitForExistence(timeout: 5))
        web.tap()
        // SFSafariViewController draws out of process: what shows is that it
        // covers the list (and its screenshot)
        let covered = expectation(for: NSPredicate(format: "isHittable == false"), evaluatedWith: web)
        wait(for: [covered], timeout: 10)
        sleep(2)
        ParityShots.save("links-browser", app)
    }

    /// Go to message on a link of another of Ara's conversations switches
    /// her chat to it in place: the panel closes onto that conversation and
    /// Back goes home, with no second chat screen over the first one.
    /// Needs the links lab (`PARITY_LINKS=1`, ios/parity/links-lab.mjs).
    @MainActor
    func testGoToMessageSwitchesTheChatToTheLinksConversation() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["PARITY_LINKS"] == "1", "the fixture runs without PARITY_LINKS=1")
        try XCTSkipIf(UIDevice.current.userInterfaceIdiom == .pad, "the phone's chat stack")
        // Ara's chat, her panel opened by hand: the 03 screen's launcher
        // would open the panel again on every thread the chat shows
        let app = launch(screen: "02-chat")
        let name = app.buttons["chat-name"]
        XCTAssertTrue(name.waitForExistence(timeout: 30))
        name.tap()
        XCTAssertTrue(element("profile-name", in: app).waitForExistence(timeout: 10))
        element("panel-tab.library", in: app).tap()
        let chip = element("thread-files-chip.links", in: app)
        XCTAssertTrue(chip.waitForExistence(timeout: 15))
        chip.tap()
        let link = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier BEGINSWITH 'profile-link.' AND label CONTAINS 'links-lab.example.com'")).firstMatch
        XCTAssertTrue(link.waitForExistence(timeout: 10), "the other conversation's link")
        link.press(forDuration: 1.2)
        let go = app.buttons["Go to message"].firstMatch
        XCTAssertTrue(go.waitForExistence(timeout: 5))
        go.tap()

        let reply = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", "Le lien de l'autre conversation est prêt.")).firstMatch
        XCTAssertTrue(reply.waitForExistence(timeout: 15), "the chat shows the link's conversation")
        ParityShots.save("links-go-to-message", app)
        let back = app.buttons["Back"].firstMatch
        XCTAssertTrue(back.waitForExistence(timeout: 5))
        back.tap()
        XCTAssertTrue(app.buttons["home-plus"].waitForExistence(timeout: 10), "one chat screen: Back is home")
    }

    /// The iPad's bot panel has the same Links chip and rows.
    @MainActor
    func testIPadLibraryShowsTheLinks() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "iPad only")
        // Ara's chat, then her panel's Library tab
        let app = launch(screen: "02-chat")
        let toggle = element("desktop-panel-toggle", in: app)
        XCTAssertTrue(toggle.waitForExistence(timeout: 30))
        let library = element("desktop-panel-tab.library", in: app)
        if !library.waitForExistence(timeout: 3) { toggle.tap() }
        XCTAssertTrue(library.waitForExistence(timeout: 10))
        library.tap()
        let chip = element("desktop-files-chip.links", in: app)
        XCTAssertTrue(chip.waitForExistence(timeout: 30))
        chip.tap()
        XCTAssertTrue(element("profile-link.1", in: app).waitForExistence(timeout: 10))
        element("profile-show-more", in: app).tap()
        XCTAssertTrue(element("profile-link.5", in: app).waitForExistence(timeout: 10))
        sleep(4)
        ParityShots.save("links-ipad", app)
        let local = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'profile-link.' AND label CONTAINS '127.0.0.1:8787'")).firstMatch
        XCTAssertTrue(local.label.contains("On the computer"), local.label)
        let web = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'profile-link.' AND label CONTAINS 'docs.example.com'")).firstMatch
        web.tap()
        let covered = expectation(for: NSPredicate(format: "isHittable == false"), evaluatedWith: web)
        wait(for: [covered], timeout: 10)
        sleep(2)
        ParityShots.save("links-ipad-browser", app)
    }

    /// Library: the conversation's files by kind (Images was Media), and the
    /// bot's links behind their own chip (was Links), each paging as before.
    @MainActor
    func testLibraryChipsShowFilesByKindAndTheLinks() throws {
        let app = launchProfile()
        element("panel-tab.library", in: app).tap()
        XCTAssertTrue(element("thread-files", in: app).waitForExistence(timeout: 10))

        let links = element("thread-files-chip.links", in: app)
        XCTAssertTrue(links.waitForExistence(timeout: 15))
        links.tap()
        XCTAssertTrue(element("profile-link.1", in: app).waitForExistence(timeout: 10))
        XCTAssertFalse(element("profile-link.2", in: app).exists)
        XCTAssertTrue(element("profile-link.0", in: app).label.contains("docs.example.com"))
        element("profile-show-more", in: app).tap()
        XCTAssertTrue(element("profile-link.2", in: app).waitForExistence(timeout: 10))

        let images = element("thread-files-chip.image", in: app)
        XCTAssertTrue(images.waitForExistence(timeout: 10))
        images.tap()
        XCTAssertTrue(element("thread-file.parity-media-1.png", in: app).waitForExistence(timeout: 10))
        XCTAssertFalse(element("thread-file.report.md", in: app).exists, "Images keeps the pictures only")

        element("thread-files-chip.all", in: app).tap()
        XCTAssertTrue(element("thread-file.report.md", in: app).waitForExistence(timeout: 10))
        // a file opens in Quick Look
        element("thread-file.EXEC_BRIEF.md", in: app).tap()
        XCTAssertTrue(app.navigationBars.matching(NSPredicate(format: "identifier CONTAINS 'QL' OR identifier == 'EXEC_BRIEF.md'")).firstMatch.waitForExistence(timeout: 10)
            || app.staticTexts["EXEC_BRIEF"].waitForExistence(timeout: 2)
            || app.otherElements["QLPreviewControllerView"].waitForExistence(timeout: 2))
    }

    // MARK: Share and delete

    @MainActor
    func testShareExportsThePackageIntoTheShareSheet() throws {
        let app = launchProfile()
        element("profile-more", in: app).tap()
        element("profile-menu.share-template", in: app).tap()
        // the system share sheet, with the package named after the bot
        let sheet = app.otherElements["ActivityListView"].firstMatch
        let named = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Ara'")).firstMatch
        XCTAssertTrue(sheet.waitForExistence(timeout: 20) || named.waitForExistence(timeout: 5))
    }

    @MainActor
    func testDeleteBotFromTheMenuRemovesItAndGoesHome() throws {
        let name = "Delete UI \(Int(Date().timeIntervalSince1970) % 100_000)"
        try api("POST", "/api/bots", ["name": name, "title": "Temporary"])
        let app = launch(screen: "01-home")
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'chat-row.' AND label CONTAINS %@", name)).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 30))
        row.tap()
        let capsule = element("chat-name", in: app)
        XCTAssertTrue(capsule.waitForExistence(timeout: 10))
        capsule.tap()
        XCTAssertTrue(element("profile-name", in: app).waitForExistence(timeout: 10))

        element("profile-more", in: app).tap()
        let delete = element("profile-menu.delete", in: app)
        XCTAssertTrue(delete.waitForExistence(timeout: 5))
        delete.tap()
        let confirm = app.buttons["Delete Bot"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        confirm.tap()

        try eventually("the bot is gone from the server") { try bot(named: name) == nil }
        XCTAssertTrue(app.buttons["home-plus"].waitForExistence(timeout: 10))
        XCTAssertFalse(row.exists)
    }
}
