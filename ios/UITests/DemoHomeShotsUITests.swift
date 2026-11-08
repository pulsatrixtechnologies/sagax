import XCTest

/// Demo-mode regression shots (TestFlight 26): the home shows no Pin button
/// at rest, and the bot panel's Computer card wears the app's theme.
/// Set SAGAX_SHOTS_DIR (TEST_RUNNER_SAGAX_SHOTS_DIR) to also write PNGs.
final class DemoHomeShotsUITests: XCTestCase {
    private func save(_ name: String) {
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = ProcessInfo.processInfo.environment["SAGAX_SHOTS_DIR"] {
            try? shot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
        }
    }

    @MainActor
    func testDemoHomeHasNoPinButtonsAtRestAndComputerCard() throws {
        continueAfterFailure = true
        let app = XCUIApplication()
        app.launchArguments += ["-demo", "-demo-clock", "1791000000", "-demo-skip-terms"]
        app.launch()
        // rows read "Pixel · Designer" since the reference app home (2026-11-01)
        let pixel = app.buttons["chat-row.demo-pixel"].firstMatch
        XCTAssertTrue(pixel.waitForExistence(timeout: 20), "demo home")
        sleep(2)
        save("home")
        XCTAssertFalse(app.buttons["sidebar-swipe-pin"].exists, "no Pin button at rest")
        XCTAssertFalse(app.buttons["sidebar-swipe-unpin"].exists, "no Unpin button at rest")

        pixel.tap()
        if !app.buttons["chat-name"].waitForExistence(timeout: 3) { pixel.tap() }
        let name = app.buttons["chat-name"]
        XCTAssertTrue(name.waitForExistence(timeout: 10), "Pixel's chat")
        name.tap()
        let computer = app.descendants(matching: .any)["panel-overview.computer"].firstMatch
        XCTAssertTrue(computer.waitForExistence(timeout: 10), "profile Computer row")
        computer.tap()
        // Computer page: help, back, or the live/embedded screen (Lot 4)
        let onComputer = app.descendants(matching: .any).matching(NSPredicate(format: "identifier == 'computer-help' OR identifier == 'computer-back' OR identifier BEGINSWITH 'panel-computer'")).firstMatch
        XCTAssertTrue(onComputer.waitForExistence(timeout: 10))
        sleep(2)
        save("computer")
    }
}
