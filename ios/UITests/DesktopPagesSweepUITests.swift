import XCTest

/// iPad pages sweep (2026-11-03): the Automations header (the ☰ menu's
/// sections, its paused count, the run logs' breadcrumb and filters, the
/// calendar rail's fold), New bot as the desktop's window, and the thread
/// notice, against the parity fixture. All skip on an iPhone.
final class DesktopPagesSweepUITests: XCTestCase {
    private var endpoint = ""
    private var token = ""
    private var environment: String?

    override func setUpWithError() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        guard let endpoint = env["PARITY_ENDPOINT"], let token = env["PARITY_TOKEN"], !token.isEmpty else {
            throw XCTSkip("no parity fixture: set TEST_RUNNER_PARITY_ENDPOINT and TEST_RUNNER_PARITY_TOKEN")
        }
        guard UIDevice.current.userInterfaceIdiom == .pad else { throw XCTSkip("the desktop shell is the iPad's") }
        self.endpoint = endpoint
        self.token = token
        environment = env["PARITY_ENVIRONMENT"].flatMap { $0.isEmpty ? nil : $0 }
    }

    @MainActor
    private func launch(_ screen: String) -> XCUIApplication {
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication()
        app.terminate()
        var arguments = [
            "-parityEndpoint", endpoint, "-parityToken", token, "-parityIPadScreen", screen,
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES",
            "-companion.sidebarPrefs.parity-harness", "{}",
        ]
        if let environment { arguments += ["-parityEnvironment", environment] }
        app.launchArguments = arguments
        app.launch()
        XCTAssertTrue(app.buttons["desktop-sidebar-account"].waitForExistence(timeout: 30), "the desktop shell")
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    /// The ☰ menu switches to Run logs: the breadcrumb, the search field and
    /// the empty card; Schedule comes back to the calendar, whose rail folds
    /// to its strip and opens again.
    @MainActor
    func testAutomationsMenuLogsAndRail() throws {
        let app = launch("routines-calendar")
        XCTAssertTrue(element(app, "desktop-page-header").waitForExistence(timeout: 20))
        // the fixture has one paused routine: the ☰ button counts it
        XCTAssertTrue(element(app, "desktop-page-menu-badge").waitForExistence(timeout: 20))
        element(app, "automations-menu").tap()
        app.buttons["automations-logs"].firstMatch.tap()
        XCTAssertTrue(element(app, "desktop-page-section").waitForExistence(timeout: 10), "Automations › Run logs")
        XCTAssertTrue(element(app, "routines-logs-search").waitForExistence(timeout: 10))
        XCTAssertTrue(element(app, "routines-clear-logs").exists)
        XCTAssertTrue(element(app, "routines-logs-empty").waitForExistence(timeout: 10))
        element(app, "automations-menu").tap()
        app.buttons["automations-menu-schedule"].firstMatch.tap()
        XCTAssertFalse(element(app, "desktop-page-section").waitForExistence(timeout: 3))
        let hide = element(app, "automations-rail-hide")
        XCTAssertTrue(hide.waitForExistence(timeout: 10))
        hide.tap()
        let show = element(app, "automations-rail-show")
        XCTAssertTrue(show.waitForExistence(timeout: 5))
        show.tap()
        XCTAssertTrue(element(app, "automations-rail-hide").waitForExistence(timeout: 5))
    }

    /// The paused routine shows in the ☰ menu's Paused routines, in the side panel.
    @MainActor
    func testAutomationsPausedPanel() throws {
        let app = launch("routines-list")
        XCTAssertTrue(element(app, "desktop-page-menu-badge").waitForExistence(timeout: 20))
        element(app, "automations-menu").tap()
        app.buttons["automations-menu-paused"].firstMatch.tap()
        XCTAssertTrue(element(app, "automations-paused-panel").waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Planif CW approbation temps lundi"].firstMatch.waitForExistence(timeout: 5))
    }

    /// New bot is the desktop's window: Create waits for a name, a shape
    /// and a colour are picked, Later closes it.
    @MainActor
    func testNewBotWindow() throws {
        let app = launch("new-bot")
        XCTAssertTrue(element(app, "desktop-new-bot").waitForExistence(timeout: 20))
        let create = app.buttons["desktop-new-bot.create"].firstMatch
        XCTAssertTrue(create.exists)
        XCTAssertFalse(create.isEnabled, "no name yet")
        app.buttons["desktop-new-bot.shape.hexagon"].firstMatch.tap()
        XCTAssertTrue(app.buttons["desktop-new-bot.shape.hexagon"].firstMatch.isSelected)
        app.buttons["desktop-new-bot.color.blue"].firstMatch.tap()
        XCTAssertTrue(app.buttons["desktop-new-bot.color.blue"].firstMatch.isSelected)
        let name = app.textFields["desktop-new-bot.name"].firstMatch
        name.tap()
        name.typeText("Osprey")
        XCTAssertTrue(create.isEnabled)
        XCTAssertTrue(app.buttons["desktop-new-bot.mode.guided"].exists)
        XCTAssertTrue(app.buttons["desktop-new-bot.mode.manual"].exists)
        app.buttons["desktop-new-bot.later"].firstMatch.tap()
        XCTAssertFalse(element(app, "desktop-new-bot").waitForExistence(timeout: 3))
    }

    /// The notice of a thread that is gone, in the chat column.
    @MainActor
    func testThreadGoneNotice() throws {
        let app = launch("notice-thread-gone")
        let notice = element(app, "desktop-chat-notice")
        XCTAssertTrue(notice.waitForExistence(timeout: 20))
        XCTAssertTrue(notice.label.contains("Helix"))
    }
}
