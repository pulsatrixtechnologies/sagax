import XCTest

/// iPad lot 6 (2026-11-03): the Team map's Add and Computers buttons, its
/// zoom controls and help line, and the About and Release notes windows,
/// against the parity fixture (TEST_RUNNER_PARITY_ENDPOINT and _TOKEN).
final class DesktopLot6TeamMapAboutUITests: XCTestCase {
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

    @MainActor
    func testTeamMapHasAddComputersZoomAndTheHelpLine() throws {
        let app = launch("team-map")
        XCTAssertTrue(element(app, "desktop-team-map").waitForExistence(timeout: 30), "the Team map page")
        XCTAssertTrue(element(app, "team-map-add").waitForExistence(timeout: 10), "Add")
        XCTAssertTrue(element(app, "team-map-computers").exists, "the Computers button")
        XCTAssertTrue(app.staticTexts["Drag within a team to arrange · Drop in another team to move · Wheel zooms · Trackpad or Shift+wheel pans"].exists, "the desktop's help line")
        let fit = app.buttons["Fit teams to view"].firstMatch
        XCTAssertTrue(fit.waitForExistence(timeout: 5), "the % button")
        let before = fit.value as? String ?? ""
        app.buttons["Zoom in"].firstMatch.tap()
        let after = app.buttons["Fit teams to view"].firstMatch
        XCTAssertTrue(after.exists)
        XCTAssertNotEqual(after.value as? String, before, "zoom changes the percentage")
        element(app, "team-map-add").tap()
        XCTAssertTrue(app.buttons["Create team"].firstMatch.waitForExistence(timeout: 5), "Add > Create team")
    }

    @MainActor
    func testAboutIsTheDesktopsSmallWindowAndOpensReleaseNotes() throws {
        let app = launch("about-dialog")
        XCTAssertTrue(element(app, "desktop-about").waitForExistence(timeout: 30), "the About window")
        XCTAssertEqual(element(app, "about-title").label, "Sagax")
        let version = element(app, "about-version").label
        XCTAssertTrue(version.hasPrefix("Version ") && version.hasSuffix(" · iPadOS"), version)
        for id in ["about-release-notes", "about-github", "about-docs", "about-license", "about-footer"] {
            XCTAssertTrue(element(app, id).exists, id)
        }
        XCTAssertTrue(element(app, "about-footer").label.contains("Apache License 2.0"), "the Apache 2.0 mention")
        XCTAssertTrue(app.staticTexts["Documentation"].exists)
        element(app, "about-release-notes").tap()
        XCTAssertTrue(element(app, "release-notes-version").waitForExistence(timeout: 10), "Release notes with its version picker")
        XCTAssertFalse(element(app, "desktop-about").exists, "About closed")
        element(app, "release-notes-close").tap()
        XCTAssertFalse(element(app, "desktop-release-notes").waitForExistence(timeout: 2))
    }

    @MainActor
    func testTheAccountMenuHasNoHelpCenter() throws {
        let app = launch("main")
        app.buttons["desktop-sidebar-account"].tap()
        let help = app.buttons["desktop-menu.help"]
        XCTAssertTrue(help.waitForExistence(timeout: 10))
        help.tap()
        XCTAssertTrue(app.buttons["About"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Help Center"].exists, "the desktop has no Help Center")
    }
}
