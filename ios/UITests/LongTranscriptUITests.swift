import XCTest

/// Headless before/after measure of a synthetic ~2000-message transcript.
/// Store-preview only; no paired computer, no network, no user data.
final class LongTranscriptUITests: XCTestCase {
    @MainActor
    func testLazyTranscriptOpensAtBottomAndJumpWorks() {
        let app = launch(eager: false, measure: true, out: "/tmp/sagax-long-transcript-after.json")
        assertChatOpen(in: app)
        assertAtBottom(in: app)
        scrollUp(in: app)
        let jump = app.buttons["jump-to-latest"]
        if jump.waitForExistence(timeout: 3) {
            jump.tap()
        }
        assertAtBottom(in: app)
        let value = waitForMetrics(in: app, timeout: 15)
        XCTAssertTrue(value.contains("lazy=true"), value)
        XCTAssertTrue(rowCount(from: value) >= 1500, "expected ~2000 rows, got \(value)")
        attachMetrics(value, name: "after-metrics")
        screenshot("Long transcript lazy at bottom", in: app)
    }

    @MainActor
    func testEagerTranscriptBaselineMeasure() {
        let app = launch(eager: true, measure: true, out: "/tmp/sagax-long-transcript-before.json")
        assertChatOpen(in: app)
        assertAtBottom(in: app)
        let value = waitForMetrics(in: app, timeout: 60)
        XCTAssertTrue(value.contains("lazy=false"), value)
        XCTAssertTrue(rowCount(from: value) >= 1500, "expected ~2000 rows, got \(value)")
        attachMetrics(value, name: "before-metrics")
        screenshot("Long transcript eager baseline", in: app)
    }

    private func rowCount(from value: String) -> Int {
        guard let part = value.split(separator: ";").first(where: { $0.hasPrefix("rows=") }),
              let n = Int(part.dropFirst("rows=".count)) else { return 0 }
        return n
    }

    @MainActor
    private func waitForMetrics(in app: XCUIApplication, timeout: TimeInterval) -> String {
        let metrics = app.descendants(matching: .any)["long-transcript-metrics"]
        XCTAssertTrue(metrics.waitForExistence(timeout: timeout), "metrics probe")
        // First layout may land a moment after the chat chrome.
        let deadline = Date().addingTimeInterval(min(timeout, 10))
        var value = metrics.value as? String ?? ""
        while Date() < deadline {
            value = metrics.value as? String ?? ""
            if value.contains("firstLayout=") || value.contains("rss=") { break }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        return value
    }

    private func attachMetrics(_ value: String, name: String) {
        let attachment = XCTAttachment(string: value)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    private func launch(eager: Bool, measure: Bool, out: String) -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.terminate()
        var args = [
            "-store-preview",
            "-long-transcript-preview", "2000",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES",
        ]
        if eager { args.append("-transcript-eager") }
        if measure {
            args += ["-long-transcript-measure", "-long-transcript-measure-out", out]
        }
        app.launchArguments = args
        let started = CFAbsoluteTimeGetCurrent()
        app.launch()
        var row = app.buttons["chat-row.preview-scout"]
        if !row.waitForExistence(timeout: 20) {
            // Same recovery as ThreadPreviewHarness: a prewarmed scene can
            // miss the store-preview flags once.
            app.terminate()
            app.launch()
            row = app.buttons["chat-row.preview-scout"]
        }
        XCTAssertTrue(row.waitForExistence(timeout: 30), "Scout on the home roster")
        row.tap()
        // Eager VStack of ~2000 rows can take a long time to first paint.
        XCTAssertTrue(app.buttons["chat-name"].waitForExistence(timeout: eager ? 180 : 60), "chat opened")
        let ttfr = CFAbsoluteTimeGetCurrent() - started
        let attachment = XCTAttachment(string: String(format: "uiTestTtfrSeconds=%.3f eager=%@", ttfr, eager ? "true" : "false"))
        attachment.name = eager ? "before-ttfr" : "after-ttfr"
        attachment.lifetime = .keepAlways
        add(attachment)
        return app
    }

    @MainActor
    private func assertChatOpen(in app: XCUIApplication) {
        XCTAssertTrue(app.buttons["chat-name"].waitForExistence(timeout: 10))
        XCTAssertTrue(
            app.textViews["composer-field"].waitForExistence(timeout: 5)
                || app.textFields["composer-field"].waitForExistence(timeout: 1)
                || app.descendants(matching: .any)["composer-field"].waitForExistence(timeout: 1)
                || app.buttons["composer-plus"].waitForExistence(timeout: 5),
            "composer chrome"
        )
    }

    @MainActor
    private func assertAtBottom(in app: XCUIApplication) {
        // Newest synthetic line, or the composer sitting under the transcript.
        let newest = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Synthetic bot reply 1999")).firstMatch
        let composer = app.buttons["composer-plus"]
        XCTAssertTrue(
            newest.waitForExistence(timeout: 8) || composer.waitForExistence(timeout: 2),
            "expected bottom of the long transcript"
        )
    }

    @MainActor
    private func scrollUp(in app: XCUIApplication) {
        let mid = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let low = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2))
        mid.press(forDuration: 0.05, thenDragTo: low)
        mid.press(forDuration: 0.05, thenDragTo: low)
    }

    @MainActor
    private func screenshot(_ name: String, in app: XCUIApplication) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }
}
