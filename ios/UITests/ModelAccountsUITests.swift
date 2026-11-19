import XCTest

/// M-20261119-015: two Claude accounts of one person, each with its own list
/// (the bundled -model-accounts-preview fleet). Each provider page names its
/// account, every row says the account it runs on, and a model only the team
/// account offers wears "Accès spécial". With TEST_RUNNER_SAGAX_SHOTS set,
/// each screen is also saved as a PNG.
final class ModelAccountsUITests: XCTestCase {
    @MainActor
    func testEachAccountSaysItsModelsAndTheTeamOnlyModelWearsTheBadge() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = [
            // the steps preview leaves Pepper's turn done, so the model can change
            "-store-preview", "-chat-presentation-preview", "-chat-steps-preview", "-model-accounts-preview",
            "-AppleLanguages", "(fr)", "-AppleLocale", "fr_CA",
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
        // the short menu: the model in use says its account
        let all = app.buttons["model-all"]
        XCTAssertTrue(all.waitForExistence(timeout: 5))
        let current = app.buttons["model-row.current"]
        if current.exists { XCTAssertTrue(current.label.contains("ada@example.com"), current.label) }
        shot("model-accounts-short", app)
        all.tap()

        let team = app.buttons["model-provider.preview-team"]
        XCTAssertTrue(team.waitForExistence(timeout: 5), "a segment per account")
        XCTAssertTrue(team.label.contains("ada.admin@acme.test"), team.label)
        XCTAssertTrue(app.buttons["model-provider.preview"].label.contains("ada@example.com"), app.buttons["model-provider.preview"].label)
        XCTAssertTrue(app.buttons["model-row.preview.claude-opus-4-5"].waitForExistence(timeout: 5))
        shot("model-accounts-personal", app)
        team.tap()
        let mythos = app.buttons["model-row.preview-team.claude-mythos-5-2"]
        XCTAssertTrue(mythos.waitForExistence(timeout: 5))
        XCTAssertTrue(mythos.label.contains("Accès spécial"), mythos.label)
        let shared = app.buttons["model-row.preview-team.claude-opus-4-5"]
        XCTAssertTrue(shared.exists)
        XCTAssertFalse(shared.label.contains("Accès spécial"), shared.label)
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
