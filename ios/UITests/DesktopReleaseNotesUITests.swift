import XCTest

/// Release notes on the large layout (P2-3, `ReleaseNotesPrompt.tsx`):
/// What's new opens by itself once after an update, and the account menu's
/// Release notes opens the same dialog with a version picker and "Changes
/// since my last version". Against the parity fixture server:
///
///   node ios/parity/fixture-server.mjs &
///   TEST_RUNNER_PARITY_ENDPOINT=... TEST_RUNNER_PARITY_TOKEN=... \
///   xcodebuild test -only-testing:SagaxUITests/DesktopReleaseNotesUITests \
///     -destination 'platform=iOS Simulator,name=<a large layout simulator>' ...
///
/// Skipped on a phone layout and without a fixture.
final class DesktopReleaseNotesUITests: XCTestCase {
    private var endpoint = ""
    private var token = ""
    private var environment: String?

    override func setUpWithError() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        guard let endpoint = env["PARITY_ENDPOINT"], let token = env["PARITY_TOKEN"], !token.isEmpty else {
            throw XCTSkip("no parity fixture: set TEST_RUNNER_PARITY_ENDPOINT and TEST_RUNNER_PARITY_TOKEN")
        }
        guard UIDevice.current.userInterfaceIdiom == .pad else {
            throw XCTSkip("the desktop shell is the large layout's")
        }
        self.endpoint = endpoint
        self.token = token
        environment = env["PARITY_ENVIRONMENT"].flatMap { $0.isEmpty ? nil : $0 }
    }

    @MainActor
    private func launch(_ extra: [String] = []) -> XCUIApplication {
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication()
        app.terminate()
        var arguments = [
            "-parityEndpoint", endpoint, "-parityToken", token, "-parityIPadScreen", "main",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES",
        ]
        if let environment { arguments += ["-parityEnvironment", environment] }
        app.launchArguments = arguments + extra
        app.launch()
        XCTAssertTrue(app.buttons["desktop-sidebar-account"].waitForExistence(timeout: 30), "the desktop shell")
        return app
    }

    private func element(_ id: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    @MainActor
    func testWhatsNewOpensOnceAfterAnUpdateAndCloses() throws {
        let app = launch(["-releaseNotesWhatsNew", "-releaseNotesSeen", "0.4.10"])
        let title = element("release-notes-title", in: app)
        XCTAssertTrue(title.waitForExistence(timeout: 15), "What's new after an update")
        XCTAssertTrue(title.label.hasPrefix("What's new in "), title.label)
        XCTAssertFalse(element("release-notes-version", in: app).exists, "What's new shows the running version only")
        element("release-notes-close", in: app).tap()
        XCTAssertFalse(title.waitForExistence(timeout: 2), "Close dismisses it")

        // the same version again: no dialog
        let again = launch(["-releaseNotesWhatsNew"])
        XCTAssertFalse(element("release-notes-title", in: again).waitForExistence(timeout: 4), "once per version")
    }

    @MainActor
    func testTheAccountMenuOpensReleaseNotesWithAVersionPicker() throws {
        let app = launch(["-releaseNotesWhatsNew", "-releaseNotesSeen", "0.4.10"])
        let close = element("release-notes-close", in: app)
        if close.waitForExistence(timeout: 10) { close.tap() }

        app.buttons["desktop-sidebar-account"].tap()
        // Help › Release notes, as the desktop's account menu (2026-10-28)
        let help = app.buttons["desktop-menu.help"]
        XCTAssertTrue(help.waitForExistence(timeout: 10), "Help in the account menu")
        help.tap()
        let entry = app.buttons["Release notes"].firstMatch
        XCTAssertTrue(entry.waitForExistence(timeout: 10), "Release notes under Help")
        entry.tap()

        let title = element("release-notes-title", in: app)
        XCTAssertTrue(title.waitForExistence(timeout: 10))
        XCTAssertEqual(title.label, "Release notes")
        let picker = element("release-notes-version", in: app)
        XCTAssertTrue(picker.exists, "the version picker")
        XCTAssertTrue((picker.value as? String)?.isEmpty == false)
        let since = element("release-notes-since", in: app)
        XCTAssertTrue(since.exists, "Changes since my last version (0.4.10)")
        XCTAssertTrue(since.label.contains("0.4.10"), since.label)
        since.tap()
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'release-notes-text.'")).count > 1,
                      "several versions since 0.4.10")
        close.tap()
        XCTAssertFalse(title.waitForExistence(timeout: 2))
    }
}
