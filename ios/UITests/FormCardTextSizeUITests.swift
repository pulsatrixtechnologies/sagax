import XCTest

/// #4490: the transcript must survive a LIVE text size change. A form (12 rows,
/// or the 7-row time sheet) switched largest accessibility size, large, largest
/// left the lazy transcript with the row heights of the old size and drew
/// nothing, with no crash. A test cannot change the system text size itself, so
/// `ios/parity/form-cards-text-size.sh` runs this around the app: the test asks
/// for each size through files in FORM_SIGNAL_DIR, the script applies it with
/// `xcrun simctl ui <device> content_size <size>` and acknowledges.
/// Without that script (no FORM_SIGNAL_DIR) the tests are skipped.
final class FormCardTextSizeUITests: XCTestCase {
    private var signalDir: String { ProcessInfo.processInfo.environment["FORM_SIGNAL_DIR"] ?? "" }

    private func change(to size: String, step: Int) throws {
        try size.write(toFile: "\(signalDir)/want-\(step)", atomically: true, encoding: .utf8)
        let done = "\(signalDir)/done-\(step)"
        let deadline = Date().addingTimeInterval(30)
        while !FileManager.default.fileExists(atPath: done) {
            XCTAssertLessThan(Date(), deadline, "the script never applied \(size)")
            if Date() >= deadline { return }
            Thread.sleep(forTimeInterval: 0.25)
        }
    }

    private func runSequence(until id: String, title: String) throws {
        try XCTSkipIf(signalDir.isEmpty, "run ios/parity/form-cards-text-size.sh")
        let app = XCUIApplication()
        app.launchArguments = ["-store-preview", "-form-cards-preview", "-open-first", "-form-cards-until", id, "-form-cards-alone",
                               "-companion.prefs.rosterDensity", "standard", "-paritySkin", "system",
                               "-AppleLanguages", "(en)", "-AppleLocale", "en"]
        app.launch()
        XCTAssertTrue(app.buttons["Submit"].waitForExistence(timeout: 25))
        let sizes = ["accessibility-extra-extra-extra-large", "large", "accessibility-extra-extra-extra-large"]
        for (step, size) in sizes.enumerated() {
            try change(to: size, step: step)
            Thread.sleep(forTimeInterval: 4)
            let texts = app.staticTexts.count
            XCTAssertGreaterThan(texts, 3, "after \(size) the transcript has \(texts) text elements")
            XCTAssertGreaterThan(FormCardTallRowUITests.distinctColours(app), 3, "after \(size) the chat draws nothing")
            XCTAssertTrue(app.buttons["Submit"].waitForExistence(timeout: 10), "after \(size) the form is gone")
            _ = title
        }
    }

    func testTwelveRowFormSurvivesTextSizeChanges() throws { try runSequence(until: "f-twelve", title: "Twelve questions") }
    func testTimeSheetSurvivesTextSizeChanges() throws { try runSequence(until: "f-time", title: "Time entries to confirm") }
}
