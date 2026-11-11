import XCTest

/// #3465 (lot 8 of #3408): the choice card's three answers, Settings,
/// Notifications, « Ce que je reçois » and a bot's « Ce que ce bot suit pour
/// toi », on the demo's made-up choices. Set SAGAX_SHOTS_DIR
/// (TEST_RUNNER_SAGAX_SHOTS_DIR) to write PNGs, SAGAX_SHOTS_LANG to fr or en.
final class ProactiveReceiveShotsUITests: XCTestCase {
    private var language: String { ProcessInfo.processInfo.environment["SAGAX_SHOTS_LANG"] ?? "en" }

    private func save(_ name: String) {
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = ProcessInfo.processInfo.environment["SAGAX_SHOTS_DIR"] {
            try? shot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
        }
    }

    @MainActor
    private func launch(card: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-demo", "-demo-clock", "1791000000", "-demo-skip-terms",
                                "-AppleLanguages", "(\(language))", "-AppleLocale", language == "fr" ? "fr_CA" : "en_US",
                                // the skin follows the simulator's light or dark appearance
                                "-paritySkin", "system"]
        if card { app.launchArguments.append("-demo-proactive-card") }
        app.launch()
        return app
    }

    @MainActor
    private func reveal(_ element: XCUIElement, in app: XCUIApplication, up: Bool = true) {
        for _ in 0..<12 where !(element.exists && element.isHittable) {
            if up { app.swipeUp() } else { app.swipeDown() }
        }
    }

    @MainActor
    private func element(_ id: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    @MainActor
    private func openPixel(_ app: XCUIApplication) {
        let row = app.buttons["chat-row.demo-pixel"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 20), "demo home")
        row.tap()
        if !app.buttons["chat-name"].waitForExistence(timeout: 3), row.exists { row.tap() }
        XCTAssertTrue(app.buttons["chat-name"].waitForExistence(timeout: 10), "Pixel's chat")
    }

    @MainActor
    func testChoiceCardShowsItsThreeAnswersAndSwitches() throws {
        guard UIDevice.current.userInterfaceIdiom == .phone else { throw XCTSkip("phone only") }
        let app = launch(card: true)
        openPixel(app)
        // labels, never an identifier (the card is one accessibility element)
        let never = app.buttons["proactive-never-demo-proactive-choice"].firstMatch
        if !never.waitForExistence(timeout: 8) { reveal(never, in: app) }
        XCTAssertTrue(never.exists, "the third answer")
        XCTAssertEqual(never.label, language == "fr" ? "Ne plus proposer" : "Never suggest again", "a label, never an id")
        // the watch alert above it carries its two exits
        XCTAssertTrue(app.buttons["watch-alert-stop-watch"].firstMatch.exists, "Stop this watch")
        XCTAssertTrue(app.buttons["watch-alert-stop-domain"].firstMatch.exists, "Stop this domain")
        sleep(1)
        save("card-\(language)")
        // the folded details: each watch with its switch and its tools in words
        element("proactive-choice-details", in: app).tap()
        let watch = app.staticTexts[language == "fr" ? "Billets sans technicien" : "Tickets with no technician"].firstMatch
        XCTAssertTrue(watch.waitForExistence(timeout: 5), "a watch switch")
        reveal(element("proactive-yes-demo-proactive-choice", in: app), in: app)
        sleep(1)
        save("card-open-\(language)")
        // an exit acts at once and says what stopped, by its label
        app.buttons["watch-alert-stop-watch"].firstMatch.tap()
        XCTAssertTrue(element("watch-alert-stopped", in: app).waitForExistence(timeout: 5), "the stopped line")
        sleep(1)
        save("alert-stopped-\(language)")
    }

    @MainActor
    func testSettingsListWhatIReceive() throws {
        guard UIDevice.current.userInterfaceIdiom == .phone else { throw XCTSkip("phone only") }
        let app = launch()
        let apps = app.buttons["home-apps"]
        XCTAssertTrue(apps.waitForExistence(timeout: 20))
        apps.tap()
        let settings = app.buttons["account-menu.settings"]
        if !settings.waitForExistence(timeout: 3) { apps.tap() }
        XCTAssertTrue(settings.waitForExistence(timeout: 5))
        settings.tap()
        let notifications = element("settings-notifications", in: app)
        XCTAssertTrue(notifications.waitForExistence(timeout: 10))
        notifications.tap()
        let domain = app.staticTexts[language == "fr" ? "Répartition" : "Dispatch"].firstMatch
        reveal(domain, in: app)
        XCTAssertTrue(domain.exists, "the organization's alerts")
        // the domain on: its watches with their switches
        let toggle = app.switches[language == "fr" ? "Répartition" : "Dispatch"].firstMatch
        if toggle.exists { toggle.tap() }
        sleep(1)
        save("settings-\(language)")
        app.swipeUp()
        sleep(1)
        save("settings-bottom-\(language)")
    }

    @MainActor
    func testBotPageListsWhatItFollows() throws {
        guard UIDevice.current.userInterfaceIdiom == .phone else { throw XCTSkip("phone only") }
        let app = launch()
        openPixel(app)
        app.buttons["chat-name"].tap()
        let gear = element("panel-gear", in: app)
        XCTAssertTrue(gear.waitForExistence(timeout: 10), "the profile's gear")
        gear.tap()
        let general = element("bot-profile-tab.general", in: app)
        if general.waitForExistence(timeout: 10) { general.tap() }
        let actsAlone = element("bot-profile-more.acts-alone", in: app)
        reveal(actsAlone, in: app)
        XCTAssertTrue(actsAlone.exists, "When it acts alone")
        actsAlone.tap()
        let follows = element("bot-follows-dispatch", in: app)
        XCTAssertTrue(follows.waitForExistence(timeout: 10), "What this bot follows for you")
        reveal(follows, in: app)
        sleep(1)
        save("bot-page-\(language)")
    }

    // MARK: tablet (the desktop shell)

    @MainActor
    func testTabletChoiceCardAndWhatIReceive() throws {
        guard UIDevice.current.userInterfaceIdiom == .pad else { throw XCTSkip("tablet only") }
        let app = launch(card: true)
        XCTAssertTrue(app.buttons["desktop-sidebar-account"].waitForExistence(timeout: 30), "the desktop shell")
        // the tablet can still show the terms once over the shell
        let agree = element("terms-accept", in: app)
        if agree.waitForExistence(timeout: 3) { agree.tap() }
        let pixel = app.buttons.matching(NSPredicate(format: "identifier IN %@",
                                                     ["desktop-row.demo-pixel", "desktop-pinned.demo-pixel"])).firstMatch
        XCTAssertTrue(pixel.waitForExistence(timeout: 10), "Pixel in the sidebar")
        pixel.tap()
        // the desktop shell's transcript does not expose the card's rows to the test runner:
        // the phone test asserts the three answers, this one keeps the tablet capture
        sleep(4)
        save("tablet-card-\(language)")
        app.typeKey("\\", modifierFlags: .command)
        app.typeKey("\\", modifierFlags: .command)
        app.typeKey(",", modifierFlags: .command)
        let nav = app.buttons["desktop-settings.nav.notifications"]
        // without a hardware keyboard the shortcut does nothing: the account menu's Settings
        if !nav.waitForExistence(timeout: 4) {
            app.buttons["desktop-sidebar-account"].firstMatch.tap()
            let settings = element("desktop-menu.settings", in: app)
            if settings.waitForExistence(timeout: 5) { settings.tap() }
        }
        XCTAssertTrue(nav.waitForExistence(timeout: 10), "Settings")
        nav.tap()
        // the page from its top, then « Ce que je reçois » one screen at a time
        sleep(2)
        save("tablet-settings-\(language)")
        let domain = element(language == "fr" ? "Répartition" : "Dispatch", in: app)
        for step in 1...2 {
            app.swipeUp()
            sleep(1)
            save("tablet-settings-\(step)-\(language)")
        }
        XCTAssertTrue(domain.exists, "the organization's alerts")
    }

    /// The tablet's bot page: « Ce que ce bot suit pour toi » beside
    /// Proactive, and the alert's exit acting at once.
    @MainActor
    func testTabletBotPageAndAlertExit() throws {
        guard UIDevice.current.userInterfaceIdiom == .pad else { throw XCTSkip("tablet only") }
        let app = launch(card: true)
        XCTAssertTrue(app.buttons["desktop-sidebar-account"].waitForExistence(timeout: 30), "the desktop shell")
        let agree = element("terms-accept", in: app)
        if agree.waitForExistence(timeout: 3) { agree.tap() }
        let pixel = app.buttons.matching(NSPredicate(format: "identifier IN %@",
                                                     ["desktop-row.demo-pixel", "desktop-pinned.demo-pixel"])).firstMatch
        XCTAssertTrue(pixel.waitForExistence(timeout: 10), "Pixel in the sidebar")
        pixel.tap()
        sleep(2)
        // the alert's exit acts at once and says what stopped
        let stop = app.buttons["watch-alert-stop-watch"].firstMatch
        XCTAssertTrue(stop.waitForExistence(timeout: 5), "Stop this watch")
        stop.tap()
        XCTAssertTrue(element("watch-alert-stopped", in: app).waitForExistence(timeout: 5), "the stopped line")
        sleep(1)
        save("tablet-alert-stopped-\(language)")
        // Pixel's own pill (the home bot has one too), its panel, then the
        // gear to the profile page; a first tap can land while the chat settles
        let pill = app.buttons.matching(NSPredicate(format: "identifier == 'desktop-chat-pill' AND label CONTAINS 'Pixel'")).firstMatch
        XCTAssertTrue(pill.waitForExistence(timeout: 10), "the bot's pill")
        let gear = element("desktop-panel-gear", in: app)
        let actsAlone = element("bot-profile-more.acts-alone", in: app)
        for _ in 0..<3 where !actsAlone.exists {
            if !gear.exists, pill.exists { pill.tap() }
            if gear.waitForExistence(timeout: 5) { gear.tap() }
            _ = actsAlone.waitForExistence(timeout: 8)
        }
        XCTAssertTrue(actsAlone.exists, "When it acts alone")
        actsAlone.tap()
        let follows = app.descendants(matching: .any).matching(NSPredicate(format: "identifier IN %@",
                                                                           ["persona-follows-dispatch", "desktop-panel-follows-dispatch"])).firstMatch
        XCTAssertTrue(follows.waitForExistence(timeout: 10), "What this bot follows for you")
        // scroll the page on the right, never the sidebar
        for _ in 0..<8 where !follows.isHittable {
            let from = app.coordinate(withNormalizedOffset: CGVector(dx: 0.65, dy: 0.75))
            from.press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.65, dy: 0.4)))
        }
        sleep(1)
        save("tablet-bot-page-\(language)")
    }
}
