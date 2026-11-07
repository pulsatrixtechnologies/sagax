import XCTest

/// The welcome, connect, organization sign-in and demo screens.
///
/// Every test starts from a fresh install (no saved pairing). The
/// organization test needs the isolated fixture server with the fake
/// Perspicax (`node --experimental-strip-types scripts/serve-ios-org-fixture.ts`)
/// and its address in `TEST_RUNNER_ORG_FIXTURE` (xcodebuild passes it to the
/// runner as `ORG_FIXTURE`); without it that test is skipped. Screenshots
/// are kept in the result bundle under the names below.
final class OnboardingUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testWelcomeOffersThreeWaysIn() {
        let app = launch()
        XCTAssertTrue(app.buttons["welcome-organization"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["welcome-computer"].exists)
        XCTAssertTrue(app.buttons["welcome-demo"].exists)
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'OpenMausBot'")).firstMatch.exists)
        snapshot("onboarding-01-welcome", app)
    }

    @MainActor
    func testComputerPageAndBack() {
        let app = launch()
        app.buttons["welcome-computer"].tap()
        XCTAssertTrue(app.buttons["pairing-scan"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.textFields["pairing-address"].exists)
        snapshot("onboarding-02-computer", app)
        app.buttons["pairing-close"].tap()
        XCTAssertTrue(app.buttons["welcome-computer"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testOrganizationPageNeedsAnAddressAndExplainsAnUnreachableServer() {
        let app = launch()
        app.buttons["welcome-organization"].tap()
        let field = app.textFields["org-address"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["org-continue"].isEnabled)
        snapshot("onboarding-03-organization", app)
        field.tap()
        // Nothing listens there: the screen says so instead of going back.
        field.typeText("http://127.0.0.1:9")
        app.buttons["org-continue"].tap()
        let error = app.descendants(matching: .any)["connect-error"].firstMatch
        XCTAssertTrue(error.waitForExistence(timeout: 15))
        XCTAssertTrue(error.label.contains("Can't reach") || error.label.contains("Impossible de joindre"), error.label)
        XCTAssertTrue(app.textFields["org-address"].exists, "the page stays")
        snapshot("onboarding-04-organization-unreachable", app)
    }

    @MainActor
    func testOrganizationSignInCancelThenSignInLoadsChats() throws {
        guard let fixture = ProcessInfo.processInfo.environment["ORG_FIXTURE"], !fixture.isEmpty else {
            throw XCTSkip("Set TEST_RUNNER_ORG_FIXTURE to the fixture server's address.")
        }
        let app = launch()
        app.buttons["welcome-organization"].tap()
        let field = app.textFields["org-address"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText(fixture)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")

        // 1. The person cancels the system prompt: said on screen, page kept.
        app.buttons["org-continue"].tap()
        let cancel = springboard.buttons["Cancel"]
        XCTAssertTrue(cancel.waitForExistence(timeout: 10))
        cancel.tap()
        let error = app.descendants(matching: .any)["connect-error"].firstMatch
        XCTAssertTrue(error.waitForExistence(timeout: 10))
        snapshot("onboarding-05-organization-cancelled", app)

        // 2. Signing in: the fake Perspicax signs the person in at once, the
        // server hands back sagax://pair, the phone redeems it and loads chats.
        app.buttons["org-continue"].tap()
        let proceed = springboard.buttons["Continue"]
        XCTAssertTrue(proceed.waitForExistence(timeout: 10))
        proceed.tap()
        let signedIn = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'chat-row.' OR identifier BEGINSWITH 'home-'")).firstMatch
        let notifications = app.buttons["notifications-enable"]
        XCTAssertTrue(signedIn.waitForExistence(timeout: 30) || notifications.exists, app.debugDescription)
        snapshot("onboarding-06-organization-signed-in", app)
    }

    @MainActor
    func testDemoOpensWithBannerAnswersAndExits() {
        let app = launch()
        app.buttons["welcome-demo"].tap()
        // first run of this install: the notifications step comes once
        let notNow = app.buttons["Not now"].firstMatch
        if notNow.waitForExistence(timeout: 5) { notNow.tap() }
        // the one-time terms of use (guideline 1.2) come first, as for anyone
        let accept = app.buttons["terms-accept"]
        XCTAssertTrue(accept.waitForExistence(timeout: 15), "the demo asks for the terms of use once")
        accept.tap()
        let termsGone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: accept)
        XCTAssertEqual(XCTWaiter.wait(for: [termsGone], timeout: 10), .completed, "the terms sheet closed")
        let banner = app.descendants(matching: .any)["demo-banner"].firstMatch
        XCTAssertTrue(banner.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Scout"].firstMatch.waitForExistence(timeout: 5))
        snapshot("onboarding-07-demo-home", app)

        // Approve Scout's request: the card settles and Scout answers.
        // The first tap may only put away the "needs you" island.
        let row = app.buttons["chat-row.demo-scout"]
        row.tap()
        // the approval dock: Allow once, Always allow, Deny
        let allow = app.buttons["approval-allow-once"].firstMatch
        if !allow.waitForExistence(timeout: 3) { row.tap() }
        XCTAssertTrue(allow.waitForExistence(timeout: 10), app.debugDescription)
        snapshot("onboarding-08-demo-approval", app)
        allow.tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'Approved, thank you'")).firstMatch.waitForExistence(timeout: 15), app.debugDescription)
        snapshot("onboarding-09-demo-approved", app)

        // Leave the demo: back to the three choices, nothing kept.
        let exit = app.buttons["demo-exit"].firstMatch
        if !exit.exists { app.buttons["chevron.left"].firstMatch.tap() }
        XCTAssertTrue(exit.waitForExistence(timeout: 5), app.debugDescription)
        exit.tap()
        XCTAssertTrue(app.buttons["welcome-demo"].waitForExistence(timeout: 10))

        // A relaunch does not come back to the demo.
        app.terminate()
        let again = launch(reset: false)
        XCTAssertTrue(again.buttons["welcome-demo"].waitForExistence(timeout: 10))
    }

    // MARK: -

    @MainActor
    private func launch(reset: Bool = true) -> XCUIApplication {
        let app = XCUIApplication()
        if reset { app.launchArguments += ["-reset-pairings", "-companion.onboarding.welcomeSeen", "NO"] }
        app.launchArguments += ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        return app
    }

    @MainActor
    private func snapshot(_ name: String, _ app: XCUIApplication) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }
}
