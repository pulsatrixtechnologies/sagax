import XCTest

/// The bundled ThreadPreview fleet (`-store-preview -threads-preview`): one
/// bot, Pepper, with three threads (Gmail working, iCloud unread, Weekend
/// queued) and a routine run that never lists. No account, no paired
/// computer, no server.
///
/// The phone's home is the standard one since 2026-10-12 (the compact list
/// with its "› N" thread tree is no longer a choice, `RosterDensity.selectable`):
/// a bot row opens the bot, and its threads are in the chat's thread picker
/// (composer "+" > Threads). These helpers take that route.
enum ThreadPreview {
    /// Launches the fleet on the home. `location` "sidebar" adds the thread
    /// count to Pepper's row; "header" puts Threads in the name capsule menu.
    @MainActor
    static func launch(_ extra: [String] = [], location: String = "sidebar") -> XCUIApplication {
        let app = XCUIApplication()
        // Xcode may prelaunch the app after installing an updated build.
        // Restart it so Session initializes with the offline fixture flags.
        app.terminate()
        app.launchArguments = [
            "-store-preview", "-threads-preview",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES",
            "-omb-threads-location", location,
        ] + extra
        app.launch()
        // Simulator installation can restore an unpaired, prewarmed scene
        // without the preview arguments once. Restart only that wrong route.
        if !row(app).waitForExistence(timeout: 10) {
            app.terminate()
            app.launch()
        }
        XCTAssertTrue(row(app).waitForExistence(timeout: 10), "Pepper's row on the home")
        return app
    }

    static func row(_ app: XCUIApplication) -> XCUIElement {
        app.buttons["chat-row.preview-pepper"]
    }

    /// Pepper from her row: the thread she was last left on.
    @MainActor
    static func openPepper(in app: XCUIApplication) {
        let row = row(app)
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.tap()
        XCTAssertTrue(app.buttons["chat-name"].waitForExistence(timeout: 10), "Pepper's chat")
    }

    /// Pepper on Triage Gmail, whatever thread an earlier run left her on.
    @MainActor
    static func openGmail(in app: XCUIApplication) {
        openPepper(in: app)
        if !showsThread("Triage Gmail", in: app, timeout: 3) {
            select("preview-gmail", in: app)
        }
        XCTAssertTrue(showsThread("Triage Gmail", in: app))
    }

    /// The thread picker lives in the composer's "+" sheet (reference 02).
    @MainActor
    static func openPicker(in app: XCUIApplication) {
        let plus = app.buttons["composer-plus"]
        XCTAssertTrue(plus.waitForExistence(timeout: 10))
        plus.tap()
        let threads = app.buttons["plus-tasks"]
        XCTAssertTrue(threads.waitForExistence(timeout: 5))
        threads.tap()
    }

    @MainActor
    static func select(_ id: String, in app: XCUIApplication) {
        openPicker(in: app)
        let row = app.buttons["thread-\(id)"]
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.tap()
    }

    /// The chat header names `title`. Thread headers settle late on a loaded
    /// runner; 5 s timed out on PRs 1576 and 1615 while the switch was right.
    @MainActor
    static func showsThread(_ title: String, in app: XCUIApplication, timeout: TimeInterval = 10) -> Bool {
        let appeared = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", title), object: app.buttons["chat-name"])
        return XCTWaiter.wait(for: [appeared], timeout: timeout) == .completed
    }
}
