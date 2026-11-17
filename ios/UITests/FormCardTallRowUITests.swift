import XCTest

/// #4490: a tall row must render, whatever its height. A form whose answered
/// date picker was wider than the card at the largest text size left the whole
/// chat blank (no crash); the picker is now capped. Each case opens a chat
/// that ends on the tall row at the largest accessibility text size and finds
/// the row's last control hittable and its title reachable by scrolling up.
final class FormCardTallRowUITests: XCTestCase {
    private func launch(until id: String, extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [
            "-store-preview", "-form-cards-preview", "-open-first", "-form-cards-until", id, "-form-cards-alone",
            "-companion.prefs.rosterDensity", "standard",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
            "-paritySkin", "system", "-AppleLanguages", "(en)", "-AppleLocale", "en",
        ] + extra
        app.launch()
        return app
    }

    /// How many different colours a grid of pixels between the header and the
    /// composer holds: a blank chat is one flat fill (a drawn card has text,
    /// pills and fields), which the accessibility tree cannot tell.
    private func distinctColours(_ app: XCUIApplication) -> Int {
        guard let image = app.screenshot().image.cgImage,
              let data = image.dataProvider?.data, let bytes = CFDataGetBytePtr(data) else { return 0 }
        let bytesPerPixel = image.bitsPerPixel / 8
        var seen = Set<UInt32>()
        let top = image.height * 15 / 100, bottom = image.height * 85 / 100
        for row in stride(from: top, to: bottom, by: 12) {
            for column in stride(from: 0, to: image.width, by: 12) {
                let offset = row * image.bytesPerRow + column * bytesPerPixel
                // quantised so a gradient or anti-aliasing is not counted as content
                seen.insert(UInt32(bytes[offset] / 24) << 16 | UInt32(bytes[offset + 1] / 24) << 8 | UInt32(bytes[offset + 2] / 24))
            }
        }
        return seen.count
    }

    private func assertRenders(_ app: XCUIApplication, title: String, file: StaticString = #filePath, line: UInt = #line) {
        let submit = app.buttons["Submit"]
        defer { add(XCTAttachment(screenshot: app.screenshot())) }
        XCTAssertTrue(submit.waitForExistence(timeout: 25), "the form drew nothing: \(app.debugDescription.suffix(1500))", file: file, line: line)
        XCTAssertTrue(submit.isHittable, "the last control is not on screen", file: file, line: line)
        sleep(2)
        XCTAssertGreaterThan(distinctColours(app), 3, "the chat is blank: one flat colour where the card should be", file: file, line: line)
        let heading = app.staticTexts[title]
        var swipes = 0
        while !heading.isHittable && swipes < 40 {
            app.swipeDown(velocity: .fast)
            swipes += 1
        }
        XCTAssertTrue(heading.isHittable, "the title is not reachable", file: file, line: line)
    }

    func testFiveRowFormWithAnAnsweredDateRenders() {
        assertRenders(launch(until: "f-kinds", extra: ["-form-cards-fill"]), title: "Report details")
    }

    func testTwelveRowFormRenders() {
        assertRenders(launch(until: "f-twelve", extra: ["-form-cards-fill"]), title: "Twelve questions")
    }

    func testALongOlderMessageRenders() {
        let app = launch(until: "f-long-text")
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Here is a very long note'")).firstMatch.waitForExistence(timeout: 25))
    }
}
