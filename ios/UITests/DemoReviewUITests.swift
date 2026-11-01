import XCTest

/// What App Review walks through in the demo (Beta App Review, 2026-10-18):
/// a voice call that answers with no network, Report on a bot's reply, the
/// made-up data in the interface's language, and an Automations day that is
/// never empty. Set SAGAX_SHOTS_DIR (TEST_RUNNER_SAGAX_SHOTS_DIR) to also
/// write PNGs, prefixed by SAGAX_SHOTS_PREFIX.
final class DemoReviewUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func save(_ name: String) {
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        let environment = ProcessInfo.processInfo.environment
        if let dir = environment["SAGAX_SHOTS_DIR"] {
            let prefix = environment["SAGAX_SHOTS_PREFIX"].map { "\($0)-" } ?? ""
            try? shot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(prefix)\(name).png"))
        }
    }

    @MainActor
    private func launch(french: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        // the terms sheet would cover the home (DEBUG flag, CompanionApp)
        app.launchArguments += ["-demo", "-demo-skip-terms"]
        app.launchArguments += french
            ? ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_CA", "-companion.prefs.language", "fr"]
            : ["-AppleLanguages", "(en)", "-AppleLocale", "en_US", "-companion.prefs.language", "en"]
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["demo-banner"].firstMatch.waitForExistence(timeout: 30), "demo home")
        return app
    }

    @MainActor
    private func openChat(_ id: String, in app: XCUIApplication) {
        let row = app.buttons["chat-row.\(id)"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), "row \(id)")
        // the first tap may only put away the "needs you" island
        row.tap()
        if !app.buttons["chat-name"].waitForExistence(timeout: 3) { row.tap() }
        XCTAssertTrue(app.buttons["chat-name"].waitForExistence(timeout: 10), "chat \(id)")
    }

    /// Microphone and speech recognition prompts, if the system asks.
    @MainActor
    private func allowSystemPrompts() {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for _ in 0..<3 {
            let allow = springboard.buttons.matching(NSPredicate(format: "label IN %@", ["Allow", "OK", "Autoriser"])).firstMatch
            guard allow.waitForExistence(timeout: 3) else { return }
            allow.tap()
        }
    }

    // MARK: Voice call

    @MainActor
    func testTheDemoCallAnswersWithoutANetwork() {
        let app = launch()
        openChat("demo-pixel", in: app)
        let voice = app.buttons["composer-voice"]
        XCTAssertTrue(voice.waitForExistence(timeout: 10), "call button")
        voice.tap()
        allowSystemPrompts()
        sleep(3)
        save("call-start")
        XCTAssertFalse(app.alerts.firstMatch.waitForExistence(timeout: 2), "no refusal alert: \(app.alerts.firstMatch.label)")
        XCTAssertTrue(app.descendants(matching: .any)["call-pill"].firstMatch.waitForExistence(timeout: 15), "the call bar")
        sleep(2)
        save("call-open")
        // A typed line on the call is a call turn too: the reply is spoken.
        let fields = app.descendants(matching: .any).matching(NSPredicate(
            format: "elementType == %d OR elementType == %d",
            XCUIElement.ElementType.textField.rawValue, XCUIElement.ElementType.textView.rawValue
        ))
        let field = fields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5), "the composer")
        field.tap()
        field.typeText("Hello, status?")
        app.buttons["composer-send"].tap()
        let reply = app.staticTexts.containing(NSPredicate(format: "label CONTAINS[c] %@", "where things stand")).firstMatch
        XCTAssertTrue(reply.waitForExistence(timeout: 20), "the prepared reply")
        sleep(2)
        save("call-reply")
        app.buttons["call-end"].firstMatch.tap()
        XCTAssertFalse(app.descendants(matching: .any)["call-pill"].firstMatch.waitForExistence(timeout: 3))
    }

    // MARK: Report

    @MainActor
    func testABotReplyCanBeReported() {
        let app = launch()
        openChat("demo-pixel", in: app)
        let bubble = app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "One owl")).firstMatch
        XCTAssertTrue(bubble.waitForExistence(timeout: 10), "Pixel's reply")
        bubble.press(forDuration: 1.2)
        let report = app.buttons["Report"]
        _ = report.waitForExistence(timeout: 5)
        save("report-menu")
        XCTAssertTrue(report.exists, "Report in the message menu")
        report.tap()
        let sheet = app.descendants(matching: .any)["report-sheet"].firstMatch
        XCTAssertTrue(sheet.waitForExistence(timeout: 5), "the report sheet")
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "pixel-2")).firstMatch.exists, "the message id")
        sleep(1)
        save("report-sheet")
        app.buttons["report-cancel"].tap()
        XCTAssertFalse(sheet.waitForExistence(timeout: 2))
        // a line of yours has nothing to report
        let mine = app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "tighten")).firstMatch
        XCTAssertTrue(mine.waitForExistence(timeout: 5))
        mine.press(forDuration: 1.2)
        XCTAssertTrue(app.buttons["Copy"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Report"].exists, "no Report on your own message")
    }

    // MARK: Language

    @MainActor
    func testTheDemoSpeaksFrenchWhenTheInterfaceDoes() {
        let app = launch(french: true)
        sleep(2)
        save("home-fr")
        XCTAssertTrue(app.staticTexts["Salon de lancement"].firstMatch.waitForExistence(timeout: 10), "room name in French")
        openChat("demo-pixel", in: app)
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Un hibou")).firstMatch.waitForExistence(timeout: 10), "Pixel's reply in French")
        sleep(1)
        save("chat-fr")
    }

    // MARK: Automations

    @MainActor
    private func openAutomations(_ app: XCUIApplication) {
        let account = app.buttons["home-apps"]
        XCTAssertTrue(account.waitForExistence(timeout: 10))
        account.tap()
        let automations = app.buttons["account-menu.automations"]
        if !automations.waitForExistence(timeout: 3) { account.tap() }
        XCTAssertTrue(automations.waitForExistence(timeout: 5))
        automations.tap()
        XCTAssertTrue(app.segmentedControls["routines-section"].waitForExistence(timeout: 15))
    }

    @MainActor
    func testEveryDayOfTheWeekHasAutomations() {
        let app = launch(french: true)
        openAutomations(app)
        let events = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'automations-event.'"))
        _ = events.firstMatch.waitForExistence(timeout: 10)
        sleep(1)
        save("automations-today-fr")
        XCTAssertTrue(events.firstMatch.exists, "today has an event")
        let next = app.descendants(matching: .any)["automations-next"].firstMatch
        for day in 1..<7 {
            next.tap()
            XCTAssertTrue(events.firstMatch.waitForExistence(timeout: 5), "day +\(day) has an event")
        }
        app.descendants(matching: .any)["automations-today"].firstMatch.tap()
        let previous = app.descendants(matching: .any)["automations-previous"].firstMatch
        for day in 1..<7 {
            previous.tap()
            XCTAssertTrue(events.firstMatch.waitForExistence(timeout: 5), "day -\(day) has an event")
        }
    }
}
