import XCTest

/// M-20261119-015: two Claude accounts of one person, each with its own list
/// (the bundled -model-accounts-preview fleet). Each provider page names its
/// accounts, and only the team account lists its exclusive model. With TEST_RUNNER_SAGAX_SHOTS set,
/// each screen is also saved as a PNG.
final class ModelAccountsUITests: XCTestCase {
    @MainActor
    func testEachAccountListsItsOwnModelsAndTheSharedModelUnderBoth() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = [
            // the steps preview leaves Pepper's turn done, so the model can change
            "-store-preview", "-chat-presentation-preview", "-chat-steps-preview", "-model-accounts-preview",
            "-AppleLanguages", "(fr)", "-AppleLocale", "fr_CA", "-paritySkin", "system",
            "-companion.prefs.activityDetail", "full",
            "-companion.prefs.rosterDensity", "comfortable",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES",
            "-sagax.interfaceMode.v1", "advanced",
            "-omb-threads-location", "sidebar",
        ]
        app.launch()
        let pepper = app.staticTexts["Pepper"].firstMatch
        XCTAssertTrue(pepper.waitForExistence(timeout: 40))
        pepper.tap()
        app.buttons["chat-name"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["profile-name"].firstMatch.waitForExistence(timeout: 10), "bot panel")
        let edit = app.descendants(matching: .any)["panel-edit"].firstMatch
        _ = edit.waitForExistence(timeout: 10)
        for _ in 0..<8 where !(edit.exists && edit.isHittable) { app.swipeUp() }
        edit.tap()
        // the Edit pill opens the bot profile: Model is on its General tab
        let tab = app.descendants(matching: .any)["bot-profile-tab.general"].firstMatch
        if tab.waitForExistence(timeout: 10) { tab.tap() }
        let modelRow = app.descendants(matching: .any)["bot-profile-settings.model"].firstMatch
        _ = modelRow.waitForExistence(timeout: 10)
        for _ in 0..<8 where !(modelRow.exists && modelRow.isHittable) { app.swipeUp() }
        modelRow.tap()
        let open = app.buttons["model-menu-open"]
        XCTAssertTrue(open.waitForExistence(timeout: 10))
        open.tap()
        let all = app.buttons["model-all"]
        XCTAssertTrue(all.waitForExistence(timeout: 5))
        all.tap()
        let claude = app.descendants(matching: .any)["model-provider.Claude"].firstMatch
        XCTAssertTrue(claude.waitForExistence(timeout: 5))
        claude.tap()
        let personal = app.descendants(matching: .any)["model-account.preview"].firstMatch
        let team = app.descendants(matching: .any)["model-account.preview-team"].firstMatch
        XCTAssertTrue(personal.waitForExistence(timeout: 5))
        XCTAssertTrue(personal.label.contains("ada@example.com"))
        XCTAssertTrue(team.label.contains("ada.admin@acme.test"))
        shot("model-accounts", app)
        personal.tap()
        XCTAssertTrue(app.descendants(matching: .any)["model-row.preview/claude-opus-4-5"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertFalse(app.descendants(matching: .any)["model-row.preview/claude-mythos-5-2"].firstMatch.exists)
        shot("model-accounts-personal", app)
        // #5338: reopen the cascade for the other account (no back row)
        if !team.waitForExistence(timeout: 2) {
            all.tap()
            XCTAssertTrue(claude.waitForExistence(timeout: 5))
            claude.tap()
            XCTAssertTrue(team.waitForExistence(timeout: 5))
        }
        team.tap()
        XCTAssertTrue(app.descendants(matching: .any)["model-row.preview-team/claude-mythos-5-2"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["model-row.preview-team/claude-opus-4-5"].firstMatch.exists)
        shot("model-accounts-team", app)
    }

    @MainActor
    private func shot(_ name: String, _ app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        ParityShots.save(name, app)
    }
}
