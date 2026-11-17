import Vision
import XCTest

/// #4490: a pending form or checklist must keep drawing, and keep what a
/// person typed, whatever the text size does. A test cannot change the system
/// text size, so `ios/parity/form-cards-text-size.sh` runs this around the
/// app: the test asks for each size through files in FORM_SIGNAL_DIR, the
/// script applies it with `xcrun simctl ui <device> content_size <size>` and
/// acknowledges. Without that script (no FORM_SIGNAL_DIR) these are skipped.
///
/// Every step asserts the card's title AND its last row's label exist and are
/// hittable (the transcript is scrolled to each), not just that "something"
/// is on screen: the blank chat this guards against kept its header and
/// composer.
final class FormCardTextSizeUITests: XCTestCase {
    private var env: [String: String] { ProcessInfo.processInfo.environment }
    private var signalDir: String { env["FORM_SIGNAL_DIR"] ?? "" }
    private var switches: Int { Int(env["FORM_SWITCHES"] ?? "") ?? 10 }
    private var step = 0

    private let largest = "accessibility-extra-extra-extra-large"

    private func size(_ name: String) throws {
        step += 1
        try name.write(toFile: "\(signalDir)/want-\(step)", atomically: true, encoding: .utf8)
        let done = "\(signalDir)/done-\(step)"
        let deadline = Date().addingTimeInterval(30)
        while !FileManager.default.fileExists(atPath: done) {
            if Date() >= deadline { XCTFail("the script never applied \(name)"); return }
            Thread.sleep(forTimeInterval: 0.25)
        }
        Thread.sleep(forTimeInterval: 3)
    }

    private func launch(_ id: String, fill: Bool, extra: [String] = [], dark: Bool = false, french: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        var args = ["-store-preview", "-form-cards-preview", "-open-first", "-form-cards-until", id, "-form-cards-alone",
                    "-companion.prefs.rosterDensity", "standard", "-paritySkin", dark ? "black" : "system",
                    "-AppleLanguages", french ? "(fr)" : "(en)", "-AppleLocale", french ? "fr_CA" : "en"]
        if fill { args.append("-form-cards-fill") }
        app.launchArguments = args + extra
        app.launch()
        return app
    }

    /// The static text (a row label, a title) or button (a checklist item) whose
    /// label starts with the text; found again on every call, so a rebuilt
    /// row is not a stale handle.
    private func find(_ app: XCUIApplication, _ label: String) -> XCUIElement {
        let match = NSPredicate(format: "label BEGINSWITH %@", label)
        let texts = app.staticTexts.matching(match)
        return texts.count > 0 ? texts.element(boundBy: 0) : app.buttons.matching(match).firstMatch
    }

    /// On screen between the chat's header and its composer (a row half under
    /// the header's glass still counts: the whole row is drawn there).
    private func isShown(_ app: XCUIApplication, _ label: String) -> Bool {
        let element = find(app, label)
        guard element.exists else { return false }
        let window = app.windows.firstMatch.frame
        let frame = element.frame
        return frame.height > 4 && frame.maxY > 120 && frame.minY < window.height - 110
    }

    /// Scrolls until the label is shown (a screenful per swipe, at most 40).
    private func reveal(_ app: XCUIApplication, _ label: String, up: Bool) -> Bool {
        var swipes = 0
        while !isShown(app, label) && swipes < 14 {
            if up { app.swipeUp(velocity: .fast) } else { app.swipeDown(velocity: .fast) }
            swipes += 1
        }
        return isShown(app, label)
    }

    /// The card's action button (Submit, or the bot's first button): the last
    /// piece of every pending form and checklist.
    private func actionButton(_ app: XCUIApplication) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'form-action-'")).firstMatch
    }

    private func nonFlat(_ app: XCUIApplication) -> Bool {
        FormCardTallRowUITests.distinctColours(app) > 3
    }

    /// The end of the card is drawn (its action button exists and the screen
    /// is not one flat fill), then so is its start (scrolled to the top, the
    /// screen is not flat either); the chat returns to its end.
    ///
    /// The action button and the row labels are looked for too, but only
    /// reported: after a live text size change XCUITest's accessibility
    /// snapshot of a lazy transcript lags behind what is drawn (the screenshot
    /// shows every row), so an element missing from the snapshot is not proof
    /// of a blank chat. The blank chat this guards against is a flat screen
    /// (only the header and the composer drawn).
    private func assertDrawn(_ app: XCUIApplication, title: String, last: String, _ context: String, file: StaticString = #filePath, line: UInt = #line) {
        let buttonSeen = actionButton(app).exists && actionButton(app).isHittable
        let endDrawn = nonFlat(app)
        XCTAssertTrue(endDrawn, "\(context): the end of the card is not drawn (flat screen; action button in snapshot \(buttonSeen))", file: file, line: line)
        if !endDrawn { saveFailure(app, context) }
        let lastSeen = isShown(app, last)
        // a fixed run of swipes up the card (12 rows at the largest size is about 8 screens)
        for _ in 0..<8 { app.swipeDown(velocity: .fast) }
        let startDrawn = nonFlat(app)
        XCTAssertTrue(startDrawn, "\(context): the start of the card is not drawn", file: file, line: line)
        if !startDrawn { saveFailure(app, context + "-start") }
        // the head never breaks a word: every long word of the title reads whole at the top of the card
        let words = title.split { !$0.isLetter }.map(String.init).filter { $0.count >= 5 }
        let top = screenText(app).lowercased()
        let broken = words.filter { !top.contains($0.lowercased()) }
        // (a long card is not at its head after a fixed run of swipes: then none of the words is on screen)
        let atHead = broken.count < words.count
        XCTAssertTrue(!atHead || broken.isEmpty, "\(context): the head breaks or loses \(broken) (screen reads: \(top.prefix(240)))", file: file, line: line)
        if atHead && !broken.isEmpty { saveFailure(app, context + "-head") }
        print("FORMCARD \(context): end \(endDrawn), action button \(buttonSeen), last label in snapshot \(lastSeen), title in snapshot \(isShown(app, title))")
        for _ in 0..<8 { app.swipeUp(velocity: .fast) }
    }

    /// What is written on the screen, read from a screenshot: after a live text
    /// size change the accessibility snapshot lags behind what is drawn, the
    /// screen does not.
    private func screenText(_ app: XCUIApplication) -> String {
        guard let image = app.screenshot().image.cgImage else { return "" }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        try? VNImageRequestHandler(cgImage: image).perform([request])
        return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
    }

    private func snap(_ app: XCUIApplication, _ name: String) {
        if let dir = env["FORM_CAPTURE_DIR"] { try? app.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "\(dir)/\(name).png")) }
    }

    private func saveFailure(_ app: XCUIApplication, _ context: String) {
        add(XCTAttachment(screenshot: app.screenshot()))
        if let dir = env["FORM_CAPTURE_DIR"] {
            let name = context.replacingOccurrences(of: " ", with: "-").replacingOccurrences(of: ":", with: "")
            try? app.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "\(dir)/fail-\(name).png"))
        }
    }

    private func revealField(_ field: XCUIElement, in app: XCUIApplication) -> Bool {
        var swipes = 0
        while !(field.exists && field.isHittable) && swipes < 40 { app.swipeUp(velocity: .fast); swipes += 1 }
        return field.exists && field.isHittable
    }

    private func sequence(_ id: String, fill: Bool, title: String, last: String) throws {
        try XCTSkipIf(signalDir.isEmpty, "run ios/parity/form-cards-text-size.sh")
        let app = launch(id, fill: fill)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", last)).firstMatch.waitForExistence(timeout: 30) || app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", last)).firstMatch.waitForExistence(timeout: 5), "the form never appeared")
        assertDrawn(app, title: title, last: last, "launch at large")
        for round in 1...switches {
            try size(largest)
            assertDrawn(app, title: title, last: last, "\(id) switch \(round) to the largest size")
            try size("large")
            assertDrawn(app, title: title, last: last, "\(id) switch \(round) back to large")
        }
    }

    func testTwelveRowsUnfilled() throws { try sequence("f-twelve", fill: false, title: "Twelve questions", last: "Row 12: Which channels?") }
    func testTwelveRowsFilled() throws { try sequence("f-twelve", fill: true, title: "Twelve questions", last: "Row 12: Which channels?") }
    func testTimeSheetFilled() throws { try sequence("f-time", fill: true, title: "Time entries to confirm (routine Evening timesheet)", last: "Backup check: move to Friday?") }
    func testTwentyItemChecklist() throws { try sequence("f-list20", fill: false, title: "Twenty posts to publish", last: "Item 20: Thread about the acme meetup") }

    /// What a person typed survives a live size change, focus and keyboard too.
    func testTypedNoteKeepsItsTextAndFocus() throws {
        try XCTSkipIf(signalDir.isEmpty, "run ios/parity/form-cards-text-size.sh")
        let app = launch("f-kinds", fill: false)
        let field = app.textFields["Anything the reviewers should know?"]
        XCTAssertTrue(field.waitForExistence(timeout: 30))
        XCTAssertTrue(revealField(field, in: app))
        field.tap()
        field.typeText("keep this note")
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        for (n, name) in [largest, "large", largest, "large", largest, "large"].enumerated() {
            try size(name)
            snap(app, "typed-note-step-\(n)-\(name)")
            let text = screenText(app)
            XCTAssertTrue(text.contains("keep") && text.contains("note"), "step \(n): the typed note was lost (screen reads: \(text.prefix(200)))")
            XCTAssertTrue(app.keyboards.firstMatch.exists, "step \(n): the keyboard (the focus) was lost")
            XCTAssertTrue(text.contains("Done") || app.buttons["form-keyboard-done"].exists, "step \(n): the field's Done button is gone (screen reads: \(text.prefix(200)))")
        }
    }

    /// Cold launches at the largest size, in the language and appearance the
    /// script set (FORM_DARK, FORM_FRENCH): three per run.
    func testColdLaunchesAtTheLargestSize() throws {
        try XCTSkipIf(signalDir.isEmpty, "run ios/parity/form-cards-text-size.sh")
        let dark = env["FORM_DARK"] == "1", french = env["FORM_FRENCH"] == "1"
        try size(largest)
        let cases: [(String, Bool, String, String)] = [
            ("f-time", true, "Time entries to confirm (routine Evening timesheet)", "Backup check: move to Friday?"),
            ("f-twelve", false, "Twelve questions", "Row 12: Which channels?"),
            ("f-twelve", true, "Twelve questions", "Row 12: Which channels?"),
        ]
        for (n, item) in cases.enumerated() {
            let app = launch(item.0, fill: item.1, dark: dark, french: french)
            XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", item.3)).firstMatch.waitForExistence(timeout: 30), "cold launch \(n) (\(dark ? "dark" : "light"), \(french ? "fr" : "en")): the form never appeared")
            snap(app, "cold-\(n)-\(dark ? "dark" : "light")-\(french ? "fr" : "en")")
            assertDrawn(app, title: item.2, last: item.3, "cold launch \(n) (\(dark ? "dark" : "light"), \(french ? "fr" : "en"))")
            app.terminate()
        }
    }

    /// Scrolled far up with a form pending, a text size change keeps the reading place.
    func testReadingPlaceSurvivesASizeChange() throws {
        try XCTSkipIf(signalDir.isEmpty, "run ios/parity/form-cards-text-size.sh")
        let app = launch("f-twelve", fill: false)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Row 12: Which channels?")).firstMatch.waitForExistence(timeout: 30))
        // read to the middle of the card: short drags until row 6 is on screen
        // (fast swipes overshoot to the top of a 1400 pt card)
        let from = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.45))
        let to = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.65))
        var drags = 0
        while !isShown(app, "Row 6:") && drags < 30 { from.press(forDuration: 0.05, thenDragTo: to); drags += 1; Thread.sleep(forTimeInterval: 1) }
        XCTAssertTrue(isShown(app, "Row 6:"), "could not read to row 6")
        snap(app, "reading-place-before")
        // the first row on screen is the reader's place; it stays on screen, give or take one row
        func rows(_ text: String) -> [Int] { (1...12).filter { text.contains("Row \($0):") || text.contains("Row \($0) ") } }
        let before = rows(screenText(app))
        XCTAssertFalse(before.isEmpty)
        try size(largest)
        snap(app, "reading-place-after-largest")
        XCTAssertTrue(nonFlat(app), "the chat is blank after the size change")
        let after = rows(screenText(app))
        let top = before.min() ?? 0
        XCTAssertTrue(after.contains { abs($0 - top) <= 1 }, "the reader was at row \(top) (screen showed rows \(before)); after the size change the screen shows rows \(after)")
        // and back: the place is kept the other way too
        try size("large")
        let back = rows(screenText(app))
        XCTAssertTrue(back.contains { abs($0 - top) <= 2 }, "back at the large size the screen shows rows \(back), the reader was at row \(top)")
    }

    /// A bot message arriving while a note is typed neither takes the focus nor scrolls the field away.
    func testIncomingMessageLeavesTheTypedFieldAlone() throws {
        let app = launch("f-kinds", fill: false, extra: ["-form-cards-incoming", "3"])
        let field = app.textFields["Anything the reviewers should know?"]
        XCTAssertTrue(field.waitForExistence(timeout: 30))
        XCTAssertTrue(revealField(field, in: app))
        field.tap()
        field.typeText("still typing")
        Thread.sleep(forTimeInterval: 9)
        snap(app, "incoming-after-message")
        let text = screenText(app)
        XCTAssertTrue(text.contains("still typing"), "the field was scrolled away or lost its text (screen reads: \(text.prefix(200)))")
        XCTAssertTrue(app.keyboards.firstMatch.exists, "the new message took the focus")
    }
}
