import XCTest

/// Edit bot > Skills on the iPad desktop shell with the skills lab
/// (ios/parity/skills-lab.mjs, fixture PARITY_SKILLS=1): the compact skill
/// row of #4165 (the desktop profile's, #4148). The skills that need the
/// person come first and say Needs review, an off skill says Off, a shared
/// skill has its glyph, the engine's own skill has no menu, the more menu
/// carries Review changes and Turn on / Turn off, and the opened skill says
/// who it is shared with. With TEST_RUNNER_SAGAX_SHOTS each step is also a
/// PNG (the UX gate's iPad captures of the open menu and the opened skill);
/// TEST_RUNNER_PARITY_LANGUAGE=fr runs it in French, TEST_RUNNER_PARITY_SKIN=system
/// on a light simulator in the light look.
final class DesktopPersonaSkillRowsUITests: XCTestCase {
    private var endpoint = ""
    private var token = ""
    private var environment: String?
    private var language = "en"
    /// PARITY_SKIN (`system` with a light simulator for the light look).
    private var skin: String?

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
        language = env["PARITY_LANGUAGE"].flatMap { $0.isEmpty ? nil : $0 } ?? "en"
        skin = env["PARITY_SKIN"].flatMap { $0.isEmpty ? nil : $0 }
    }

    @MainActor
    private func launch(_ screen: String) -> XCUIApplication {
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication()
        app.terminate()
        var arguments = [
            "-parityEndpoint", endpoint, "-parityToken", token, "-parityIPadScreen", screen,
            "-AppleLanguages", "(\(language))", "-AppleLocale", language == "fr" ? "fr_CA" : "en_US",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES",
            "-companion.sidebarPrefs.parity-harness", "{}",
        ]
        if let environment { arguments += ["-parityEnvironment", environment] }
        if let skin { arguments += ["-paritySkin", skin] }
        app.launchArguments = arguments
        app.launch()
        XCTAssertTrue(app.buttons["desktop-sidebar-account"].waitForExistence(timeout: 30), "the desktop shell")
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    private func shot(_ name: String, _ app: XCUIApplication) {
        ParityShots.save("ipad-\(skin == nil ? "dark" : "light")-\(language)-\(name)", app)
    }

    @MainActor
    func testCompactRowsMenuAndOpenedSkill() throws {
        let app = launch("panel-more-skills")
        let changed = element(app, "desktop-skills.row.meeting-notes-summarizer")
        XCTAssertTrue(changed.waitForExistence(timeout: 30), "the lab's skills (fixture PARITY_SKILLS=1)")

        // folded after four rows (#4104): the two that need review and two
        // others, then Show N more; the needs-review ones are never hidden
        let fold = element(app, "desktop-skills.fold")
        XCTAssertTrue(fold.exists, "Show N more")
        XCTAssertEqual(fold.value as? String, "more")
        XCTAssertFalse(element(app, "desktop-skills.row.ticket-triage").exists, "behind the fold")
        shot("skills-folded", app)
        fold.tap()
        XCTAssertTrue(element(app, "desktop-skills.row.ticket-triage").waitForExistence(timeout: 10))
        XCTAssertEqual(fold.value as? String, "less")

        // the states the grey line says
        XCTAssertEqual(changed.value as? String, "needs-person")
        XCTAssertEqual(element(app, "desktop-skills.row.download-installer").value as? String, "needs-person")
        XCTAssertEqual(element(app, "desktop-skills.row.invoice-reconciliation-assistant").value as? String, "off")
        XCTAssertEqual(element(app, "desktop-skills.row.ticket-triage").value as? String, "on")
        // needs review first: above every skill that does not
        XCTAssertLessThan(changed.frame.minY, element(app, "desktop-skills.row.calendar-conflict-checker").frame.minY)
        // one line per row: no switch, no Shared with line, no Review changes button
        XCTAssertFalse(element(app, "desktop-skills.toggle.ticket-triage").exists)
        XCTAssertFalse(element(app, "desktop-skill-source.ticket-triage").exists)
        // the shared glyph on the shared skills only
        XCTAssertTrue(element(app, "desktop-skills.shared.password-rotation-reminder").exists)
        XCTAssertTrue(element(app, "desktop-skills.shared.network-health-morning-check").exists)
        XCTAssertFalse(element(app, "desktop-skills.shared.ticket-triage").exists)
        // the engine's own skill: no more menu
        XCTAssertFalse(element(app, "desktop-skills.menu.engine-code-review").exists)
        shot("skills-rows", app)

        // the more menu: Review changes and Turn on for a skill changed after its review
        element(app, "desktop-skills.menu.meeting-notes-summarizer").tap()
        XCTAssertTrue(element(app, "desktop-skills.menu-item.review").waitForExistence(timeout: 10))
        XCTAssertTrue(element(app, "desktop-skills.menu-item.turnOn").exists)
        XCTAssertTrue(element(app, "desktop-skills.menu-item.remove").exists)
        shot("skills-menu", app)
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: 0.5)).tap()
        XCTAssertTrue(element(app, "desktop-skills.menu-item.review").waitForNonExistence(timeout: 10))

        // the opened skill: who it is shared with, where it came from
        let open = element(app, "desktop-skills.open.password-rotation-reminder")
        if !open.isHittable { app.swipeUp() }
        open.tap()
        XCTAssertTrue(element(app, "desktop-skills.details.password-rotation-reminder").waitForExistence(timeout: 15))
        XCTAssertTrue(element(app, "desktop-skills.detail-origin").exists)
        shot("skills-open", app)
    }
}
