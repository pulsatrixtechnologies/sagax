import XCTest

/// Edit bot > Personality and Skills on the iPad desktop shell, against the
/// parity fixture (bot-settings/SoulSection.tsx, SkillsSection.tsx): the
/// SOUL.md editor's toolbar, tabs and counters save as the person types,
/// "Do not finish until" saves its condition, and "Write a command" stores
/// the command as one of the bot's skills.
///
///   bash ipad-uitests-<prefix>.sh DesktopPersonaInstructionsUITests
final class DesktopPersonaInstructionsUITests: XCTestCase {
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

    private func api(_ method: String, _ path: String, _ body: [String: Any]? = nil) throws -> Any? {
        var request = URLRequest(url: try XCTUnwrap(URL(string: endpoint + path)))
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let done = expectation(description: "\(method) \(path)")
        var result: Data?
        URLSession.shared.dataTask(with: request) { data, _, _ in result = data; done.fulfill() }.resume()
        wait(for: [done], timeout: 30)
        return result.flatMap { try? JSONSerialization.jsonObject(with: $0) }
    }

    private func ara() throws -> [String: Any]? {
        let payload = try api("GET", "/api/bots")
        let bots = (payload as? [[String: Any]]) ?? ((payload as? [String: Any])?["bots"] as? [[String: Any]]) ?? []
        return bots.first { $0["name"] as? String == "Ara" }
    }

    private func eventually(_ what: String, timeout: TimeInterval = 20, _ check: () throws -> Bool) throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if try check() { return }
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        }
        XCTFail("never true: \(what)")
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    @MainActor
    func testPersonalityEditorSavesAsYouTypeAndTheConditionSaves() throws {
        let id = try XCTUnwrap(try ara()?["id"] as? String)
        let original = try XCTUnwrap((try api("GET", "/api/bots/\(id)/soul") as? [String: Any])?["soul"] as? String)
        defer {
            _ = try? api("PATCH", "/api/bots/\(id)", ["soul": original])
            _ = try? api("PATCH", "/api/bots/\(id)", ["finishUntil": ""])
        }

        let app = launch("panel-more-soul")
        let editor = element(app, "desktop-panel-soul")
        XCTAssertTrue(editor.waitForExistence(timeout: 30), "the SOUL.md editor")
        for tool in ["bold", "italic", "heading", "bullet", "numbered", "task", "quote", "code", "link", "table", "rule", "format"] {
            XCTAssertTrue(element(app, "desktop-panel-soul.tool.\(tool)").exists, "the \(tool) button")
        }
        for view in ["write", "preview", "split"] {
            XCTAssertTrue(element(app, "desktop-panel-soul.view.\(view)").exists, "the \(view) tab")
        }
        XCTAssertTrue(element(app, "desktop-panel-soul.bytes").exists, "the byte counter")
        XCTAssertTrue(element(app, "desktop-panel-soul.count").exists, "the word and character counts")

        // typing saves the instructions without a Save button
        editor.tap()
        editor.typeText(" Osprey")
        try eventually("the typed word reaches SOUL.md") {
            ((try api("GET", "/api/bots/\(id)/soul") as? [String: Any])?["soul"] as? String)?.contains("Osprey") == true
        }

        // Preview renders the text, Write brings the editor back
        element(app, "desktop-panel-soul.view.preview").tap()
        XCTAssertTrue(element(app, "desktop-panel-soul.preview").waitForExistence(timeout: 5), "the preview")
        element(app, "desktop-panel-soul.view.write").tap()
        XCTAssertTrue(editor.waitForExistence(timeout: 5), "the editor again")

        // Do not finish until: the condition and Save
        let condition = element(app, "finish-until-condition")
        XCTAssertTrue(condition.waitForExistence(timeout: 5), "the condition field")
        XCTAssertTrue(element(app, "finish-until-rounds").exists, "Relaunches at most")
        condition.tap()
        condition.typeText("the tests pass")
        element(app, "finish-until-save").tap()
        try eventually("the condition is stored") { (try ara())?["finishUntil"] as? String == "the tests pass" }
        XCTAssertTrue(element(app, "finish-until-clear").waitForExistence(timeout: 10), "Clear once set")
    }

    @MainActor
    func testSkillsPageWritesACommand() throws {
        let id = try XCTUnwrap(try ara()?["id"] as? String)
        let command = "osprey-check"
        defer { _ = try? api("DELETE", "/api/bots/\(id)/skills/\(command)") }

        let app = launch("panel-more-skills")
        XCTAssertTrue(element(app, "desktop-skills.learned").waitForExistence(timeout: 30), "Learned skills")
        XCTAssertTrue(element(app, "desktop-skills.upload").exists, "Upload")
        XCTAssertTrue(
            element(app, "desktop-skills.manage-in-capabilities").exists || element(app, "desktop-skills.import-field").exists,
            "the library link or the import field"
        )

        let name = element(app, "desktop-skills.command-name")
        XCTAssertTrue(name.waitForExistence(timeout: 10), "the command's name")
        name.tap()
        name.typeText(command)
        let description = element(app, "desktop-skills.command-description")
        description.tap()
        description.typeText("Checks the fixture")
        let body = element(app, "desktop-skills.command-instructions")
        body.tap()
        body.typeText("Run the fixture check and report.")
        let save = element(app, "desktop-skills.command-save")
        XCTAssertTrue(save.isEnabled, "Save command once the draft is complete")
        save.tap()
        try eventually("the command is one of Ara's skills") {
            let skills = ((try api("GET", "/api/bots/\(id)/skills") as? [String: Any])?["skills"] as? [[String: Any]]) ?? []
            return skills.contains { $0["name"] as? String == command }
        }
        XCTAssertTrue(element(app, "desktop-skills.row.\(command)").waitForExistence(timeout: 10), "the command in the list")
    }
}
