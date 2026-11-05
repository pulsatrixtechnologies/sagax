import XCTest

/// Edit bot > Bot folder and Access on the iPad desktop shell, against the
/// parity fixture (WorkspaceFilesSection.tsx, AccessSection.tsx): the folder
/// draws Use memory, New / Upload / "...", one card with SOUL.md, MEMORY.md
/// and memory/; a folder made with New lands on the server, the memory
/// switch saves; Access draws MCP servers, the background brief and the
/// folded More options with the working folder.
///
///   bash ipad-uitests-<prefix>.sh DesktopPersonaFolderAccessUITests
final class DesktopPersonaFolderAccessUITests: XCTestCase {
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

    private func workspacePaths(_ id: String) throws -> [String] {
        let listing = try api("GET", "/api/bots/\(id)/workspace") as? [String: Any]
        return ((listing?["entries"] as? [[String: Any]]) ?? []).compactMap { $0["path"] as? String }
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
    func testBotFolderDrawsTheDesktopPageAndItsControlsSave() throws {
        let id = try XCTUnwrap(try ara()?["id"] as? String)
        let folder = "parity-notes"
        defer {
            _ = try? api("DELETE", "/api/bots/\(id)/workspace/entry?path=\(folder)&recursive=1")
            _ = try? api("PATCH", "/api/bots/\(id)", ["memoryEnabled": true])
        }
        _ = try api("DELETE", "/api/bots/\(id)/workspace/entry?path=\(folder)&recursive=1")
        _ = try api("PATCH", "/api/bots/\(id)", ["memoryEnabled": true])

        let app = launch("panel-more-memory")
        XCTAssertTrue(element(app, "desktop-persona-window.page.files").waitForExistence(timeout: 30), "the Bot folder page")
        XCTAssertTrue(element(app, "persona-folder").waitForExistence(timeout: 10), "the desktop's folder page, not the phone's list")
        XCTAssertFalse(app.buttons["Done"].exists, "no phone Done button")
        XCTAssertTrue(element(app, "persona-folder.memory-switch").exists, "Use memory")
        XCTAssertTrue(element(app, "persona-folder.new").exists, "New")
        XCTAssertTrue(element(app, "persona-folder.upload").exists, "Upload")
        XCTAssertTrue(element(app, "persona-folder.options").exists, "the folder's ...")
        XCTAssertTrue(element(app, "persona-folder.row.SOUL.md").waitForExistence(timeout: 10), "SOUL.md")
        XCTAssertTrue(element(app, "persona-folder.row.MEMORY.md").exists, "MEMORY.md")
        XCTAssertTrue(element(app, "persona-folder.row.memory").exists, "memory/")
        XCTAssertTrue(element(app, "persona-folder.select.memory").exists, "memory/ has its checkbox")
        XCTAssertFalse(element(app, "persona-folder.select.MEMORY.md").exists, "a core file has none")
        XCTAssertTrue(element(app, "persona-folder.menu.MEMORY.md").exists, "a row's ...")

        // the ... shows upkeep and the change log
        element(app, "persona-folder.options").tap()
        XCTAssertTrue(element(app, "persona-folder.options-card").waitForExistence(timeout: 5), "the folder options")
        element(app, "persona-folder.options").tap()

        // New > Folder lands on the server
        element(app, "persona-folder.new").tap()
        let newFolder = element(app, "persona-folder.new.folder")
        XCTAssertTrue(newFolder.waitForExistence(timeout: 5), "Folder in the New menu")
        newFolder.tap()
        let name = element(app, "persona-folder.new-name")
        XCTAssertTrue(name.waitForExistence(timeout: 5), "the name field")
        name.tap()
        name.typeText(folder)
        element(app, "persona-folder.create").tap()
        try eventually("the folder exists on the server") { try workspacePaths(id).contains(folder) }
        XCTAssertTrue(element(app, "persona-folder.row.\(folder)").waitForExistence(timeout: 10), "its row")

        // its checkbox offers the bulk bar
        element(app, "persona-folder.select.\(folder)").tap()
        XCTAssertTrue(element(app, "persona-folder.bulk").waitForExistence(timeout: 5), "the bulk bar")

        // the memory switch saves
        element(app, "persona-folder.memory-switch").tap()
        try eventually("memory is off on the server") { (try ara())?["memoryEnabled"] as? Bool == false }

        // MEMORY.md opens in the editor in place
        element(app, "persona-folder.open.MEMORY.md").tap()
        XCTAssertTrue(element(app, "memory-doc-save").waitForExistence(timeout: 10), "the memory editor with its Save")
    }

    @MainActor
    func testAccessDrawsMcpTheBriefAndMoreOptions() throws {
        let app = launch("panel-more-access")
        XCTAssertTrue(element(app, "desktop-persona-window.page.access").waitForExistence(timeout: 30), "the Access page")
        XCTAssertTrue(element(app, "persona-access.mcp").waitForExistence(timeout: 10), "MCP servers")
        XCTAssertTrue(element(app, "persona-access.manage-mcp").exists, "Manage in Capabilities")
        XCTAssertTrue(element(app, "persona-access.brief").exists, "Background brief")
        XCTAssertTrue(element(app, "persona-access.brief-switch").exists, "the brief's switch")
        XCTAssertFalse(element(app, "persona-access.folder").exists, "the working folder is folded")
        element(app, "persona-access.more").tap()
        XCTAssertTrue(element(app, "persona-access.folder").waitForExistence(timeout: 5), "More options shows the working folder")
        XCTAssertTrue(element(app, "persona-access.webhooks").exists, "Webhooks")
        XCTAssertTrue(element(app, "persona-access.always").exists, "Always allowed")
    }
}
