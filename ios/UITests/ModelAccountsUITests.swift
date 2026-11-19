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
            "-store-preview", "-chat-presentation-preview", "-model-accounts-preview",
            "-AppleLanguages", "(fr)", "-AppleLocale", "fr_CA",
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
        let persona = app.descendants(matching: .any)["panel-edit-persona"].firstMatch
        for _ in 0..<8 where !(persona.exists && persona.isHittable) { app.swipeUp() }
        persona.tap()
        let modelRow = app.descendants(matching: .any)["panel-row.model"].firstMatch
        _ = modelRow.waitForExistence(timeout: 10)
        for _ in 0..<8 where !(modelRow.exists && modelRow.isHittable) { app.swipeUp() }
        modelRow.tap()
        let open = app.buttons["model-menu-open"]
        XCTAssertTrue(open.waitForExistence(timeout: 10))
        open.tap()

        let team = app.buttons["model-provider.preview-team"]
        XCTAssertTrue(team.waitForExistence(timeout: 5), "one page per account")
        XCTAssertTrue(team.label.contains("ada.admin@acme.test"), team.label)
        XCTAssertTrue(app.buttons["model-provider.preview"].label.contains("ada@example.com"), app.buttons["model-provider.preview"].label)
        shot("model-accounts-menu", app)
        team.tap()
        let mythos = app.buttons["model-row.preview-team.claude-mythos-5-2"]
        XCTAssertTrue(mythos.waitForExistence(timeout: 5))
        XCTAssertTrue(mythos.label.contains("Accès spécial"), mythos.label)
        let shared = app.buttons["model-row.preview-team.claude-opus-4-5"]
        XCTAssertTrue(shared.exists)
        XCTAssertFalse(shared.label.contains("Accès spécial"), shared.label)
        shot("model-accounts-team", app)
        app.buttons["model-menu-back"].tap()
        app.buttons["model-provider.preview"].tap()
        XCTAssertTrue(app.buttons["model-row.preview.claude-opus-4-5"].waitForExistence(timeout: 5))
        shot("model-accounts-personal", app)
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
