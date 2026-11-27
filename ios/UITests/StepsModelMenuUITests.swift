import XCTest

/// The bundled offline fleet: one turn's tool steps folded into a single
/// line (#488, #518) and the model menu: short, with favorites, and All
/// models with a star each (#477, #478, #4966). With
/// TEST_RUNNER_SAGAX_SHOTS set, each screen is also saved as a PNG.
final class StepsModelMenuUITests: XCTestCase {
    @MainActor
    func testTurnStepsReadAsOneLineThatOpens() {
        let app = launchPreview()
        let line = app.buttons["step-group.preview-turn"]
        XCTAssertTrue(line.waitForExistence(timeout: 10), "one line for the turn")
        XCTAssertTrue(line.label.contains("6 outils"), line.label)
        XCTAssertTrue(line.label.contains("1 échec"), line.label)
        shot("steps-closed", app)
        line.tap()
        let repeated = app.buttons["step-repeat.step-1"]
        XCTAssertTrue(repeated.waitForExistence(timeout: 5), "the same step three times reads once")
        XCTAssertTrue(repeated.label.hasPrefix("A lu un fichier ×3"), repeated.label)
        XCTAssertTrue(contains("A consulté les billets dans Acme Desk", in: app), "the MCP server is named")
        shot("steps-open", app)
        repeated.tap()
        shot("steps-repeat-open", app)
    }

    @MainActor
    func testModeMenuOpensRunnableProvidersAndStarsEachModel() {
        let app = launchPreview()
        openModelPage(app)
        shot("model-section", app)
        let open = app.buttons["model-menu-open"]
        XCTAssertTrue(open.waitForExistence(timeout: 10))
        open.tap()
        let all = app.buttons["model-all"]
        XCTAssertTrue(all.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["model-mode.auto"].exists)
        XCTAssertTrue(app.buttons["model-mode.fast"].exists)
        // #5338: providers stay inside the All models cascade, not on the root
        XCTAssertFalse(app.buttons["model-provider.Claude"].exists)
        shot("model-menu-modes", app)
        let reasoning = app.buttons["model-mode-reasoning"]
        XCTAssertTrue(reasoning.label.contains("Raisonnement"), reasoning.label)
        reasoning.tap()
        shot("model-menu-reasoning", app)
        let high = app.descendants(matching: .any)["model-reasoning.high"].firstMatch
        XCTAssertTrue(high.waitForExistence(timeout: 5))
        XCTAssertTrue(high.label.contains("Élevé") || high.label.contains("Elev"), high.label)
        // dismiss the reasoning menu; the root modes stay on screen
        if app.buttons["model-mode.auto"].exists { /* root still visible */ } else { app.tap() }
        XCTAssertTrue(app.buttons["model-mode.auto"].waitForExistence(timeout: 5), "the mode menu stays after a cascade level")
        all.tap()
        let claude = app.descendants(matching: .any)["model-provider.Claude"].firstMatch
        XCTAssertTrue(claude.waitForExistence(timeout: 5))
        XCTAssertFalse(app.descendants(matching: .any)["model-provider.OpenAI"].firstMatch.exists)
        XCTAssertFalse(app.descendants(matching: .any)["model-provider.Qwen"].firstMatch.exists)
        XCTAssertTrue(app.descendants(matching: .any)["model-provider.local:this-computer"].firstMatch.exists)
        shot("model-menu-providers", app)
        claude.tap()
        let star = app.descendants(matching: .any)["model-favorite.preview.claude-opus-4-5"].firstMatch
        XCTAssertTrue(star.waitForExistence(timeout: 5))
        shot("model-menu-all", app)
        star.tap()
        shot("model-menu-all-starred", app)
        // reopen All models: the star puts the model under Favorites at the cascade's first level
        XCTAssertTrue(all.waitForExistence(timeout: 5))
        all.tap()
        XCTAssertTrue(app.descendants(matching: .any)["model-row.preview/claude-opus-4-5"].firstMatch.waitForExistence(timeout: 5), "the star puts it under Favorites")
        shot("model-menu-favorite", app)
        // Leave the favorite as it was for the next run.
        app.descendants(matching: .any)["model-favorite.preview.claude-opus-4-5"].firstMatch.tap()
    }

    @MainActor
    private func openModelPage(_ app: XCUIApplication) {
        app.buttons["chat-name"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["profile-name"].firstMatch.waitForExistence(timeout: 10), "bot panel")
        let edit = app.descendants(matching: .any)["panel-edit"].firstMatch
        _ = edit.waitForExistence(timeout: 10)
        for _ in 0..<8 where !(edit.exists && edit.isHittable) { app.swipeUp() }
        edit.tap()
        // the Edit pill opens the bot profile (#2157, #4101): Model is on its General tab
        let tab = app.descendants(matching: .any)["bot-profile-tab.general"].firstMatch
        if tab.waitForExistence(timeout: 10) { tab.tap() }
        let row = app.descendants(matching: .any)["bot-profile-settings.model"].firstMatch
        _ = row.waitForExistence(timeout: 10)
        for _ in 0..<8 where !(row.exists && row.isHittable) { app.swipeUp() }
        row.tap()
    }

    @MainActor
    private func launchPreview() -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = [
            "-store-preview", "-chat-presentation-preview", "-chat-steps-preview", "-model-menu-preview",
            "-AppleLanguages", "(fr)", "-AppleLocale", "fr_CA", "-paritySkin", "system",
            "-companion.prefs.activityDetail", "full",
            "-companion.prefs.rosterDensity", "comfortable",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES",
            "-omb-threads-location", "sidebar",
        ]
        app.launch()
        // Pepper's own thread is the Gmail triage: the row opens it.
        let pepper = app.staticTexts["Pepper"].firstMatch
        XCTAssertTrue(pepper.waitForExistence(timeout: 40))
        pepper.tap()
        return app
    }

    @MainActor
    private func contains(_ text: String, in app: XCUIApplication) -> Bool {
        app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch.waitForExistence(timeout: 3)
            || app.buttons.matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch.exists
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
