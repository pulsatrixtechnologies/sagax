import XCTest

/// Memory > a source opens its notes without a crash (#5159).
///
/// TestFlight 0.8.42: "opening memory make app crash". The pages the memory
/// manager's NavigationStack pushes read its model from the environment, and
/// the model was set on the first page only, so the push trapped in
/// `EnvironmentObject.error()` (MemoryBrowsePage.body). Store preview with one
/// bot memory source (`-memory-preview`): no computer, no network.
final class MemoryManagerUITests: XCTestCase {
    @MainActor
    func testOpeningASourceShowsItsNotes() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.terminate()
        app.launchArguments = [
            "-store-preview", "-memory-preview",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES",
        ]
        app.launch()
        let apps = app.buttons["home-apps"]
        if !apps.waitForExistence(timeout: 20) {
            app.terminate()
            app.launch()
        }
        XCTAssertTrue(apps.waitForExistence(timeout: 20), "the home")
        apps.tap()
        let memory = app.buttons["account-menu.memory"]
        XCTAssertTrue(memory.waitForExistence(timeout: 5), "Memory in the account menu")
        memory.tap()
        let source = app.buttons["memory-source.preview-memory"]
        XCTAssertTrue(source.waitForExistence(timeout: 10), "the preview source")
        source.tap()
        XCTAssertTrue(app.descendants(matching: .any)["memory-empty-notes"].waitForExistence(timeout: 10), "the source's page (no notes in the preview)")
        XCTAssertEqual(app.state, .runningForeground, "the app is still running")
    }
}
