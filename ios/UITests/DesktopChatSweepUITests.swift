import XCTest

/// iPad 1:1 sweep (2026-11-03): the desktop chat column against the parity
/// fixture. The composer's "/" menu (Goal, /loop, Esc to close), the +
/// menu (Attach files and Teach a task only), the mic beside a draft, the
/// More menu's Split right / Split down, the thread picker's confidential
/// thread, the folded approval command, find's outlined hit and Jump to
/// latest, the message bar beside a reply, a group's banners and composer
/// hint, and a typed /loop writing its routine.
///
///   node ios/parity/fixture-server.mjs &
///   xcodebuild test -only-testing:SagaxUITests/DesktopChatSweepUITests ...
///
/// All skip on an iPhone.
final class DesktopChatSweepUITests: XCTestCase {
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
            "-sagax.notice.dismissed.group-cost", "NO",
        ]
        if let environment { arguments += ["-parityEnvironment", environment] }
        app.launchArguments = arguments
        app.launch()
        XCTAssertTrue(app.buttons["desktop-sidebar-account"].waitForExistence(timeout: 30), "the desktop shell")
        return app
    }

    private func api(_ method: String, _ path: String) throws -> [String: Any] {
        var request = URLRequest(url: try XCTUnwrap(URL(string: endpoint + path)))
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let done = expectation(description: "\(method) \(path)")
        var result: Data?
        URLSession.shared.dataTask(with: request) { data, _, _ in result = data; done.fulfill() }.resume()
        wait(for: [done], timeout: 30)
        return (result.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]) ?? [:]
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    /// "/" lists Goal first, then Sagax's /loop and its subcommands, and the
    /// footer says Esc closes it; the mic stays beside the "/".
    @MainActor
    func testSlashMenuListsGoalAndLoop() throws {
        let app = launch("chat-composer-slash")
        XCTAssertTrue(element(app, "slash-menu").waitForExistence(timeout: 20), "the / menu")
        XCTAssertTrue(element(app, "slash-/goal").exists, "/goal")
        XCTAssertTrue(element(app, "slash-/loop").exists, "/loop")
        XCTAssertTrue(element(app, "slash-menu-esc").exists, "Esc to close")
        XCTAssertTrue(app.buttons["Start dictation"].exists, "the mic beside the draft")
    }

    /// The + menu holds Attach files and Teach a task, no Model row; Attach
    /// files offers the photo library and Files.
    @MainActor
    func testPlusMenuIsAttachAndTeach() throws {
        // chat-model-picker opens the model menu now (ModelPicker windowOnly):
        // open the + menu by hand from the plain chat
        let app = launch("chat-top")
        let plus = element(app, "desktop-composer-plus")
        XCTAssertTrue(plus.waitForExistence(timeout: 20), "the + button")
        plus.tap()
        let attach = element(app, "desktop-composer-attach")
        XCTAssertTrue(attach.waitForExistence(timeout: 20), "Attach files")
        XCTAssertTrue(element(app, "desktop-composer-teach").exists, "Teach a task")
        XCTAssertFalse(element(app, "desktop-composer-model").exists, "no Model row")
        attach.tap()
        XCTAssertTrue(app.buttons["Photo library"].waitForExistence(timeout: 5), "the photo library")
        XCTAssertTrue(app.buttons["Files"].exists, "Files")
    }

    /// A draft keeps the mic.
    @MainActor
    func testDraftKeepsTheMic() throws {
        let app = launch("chat-composer-draft")
        XCTAssertTrue(element(app, "desktop-composer-send").waitForExistence(timeout: 20), "send while drafting")
        XCTAssertTrue(app.buttons["Start dictation"].exists, "the mic beside the draft")
    }

    /// More options: Copy as Markdown, Export, Split right and Split down.
    @MainActor
    func testExportMenuSplits() throws {
        let app = launch("chat-export-menu")
        XCTAssertTrue(element(app, "desktop-split-right").waitForExistence(timeout: 20), "Split right")
        XCTAssertTrue(element(app, "desktop-split-down").exists, "Split down")
    }

    /// The thread picker offers New thread and New confidential thread.
    @MainActor
    func testThreadPickerOffersAConfidentialThread() throws {
        let app = launch("chat-threads")
        XCTAssertTrue(element(app, "desktop-thread-picker-new").waitForExistence(timeout: 20), "New thread")
        XCTAssertTrue(element(app, "desktop-thread-picker-new-confidential").exists, "New confidential thread")
    }

    /// The command waits folded on one line; open, the technical details.
    @MainActor
    func testApprovalCommandFolds() throws {
        let app = launch("chat-approval")
        let fold = element(app, "approval-dock-fold")
        XCTAssertTrue(fold.waitForExistence(timeout: 30), "the folded command")
        XCTAssertFalse(element(app, "approval-dock-detail").exists, "folded")
        fold.tap()
        XCTAssertTrue(element(app, "approval-dock-detail").waitForExistence(timeout: 5), "the command, whole")
        XCTAssertTrue(element(app, "approval-technical-details").exists, "the technical details")
    }

    /// Find outlines its hit and offers Jump to latest.
    @MainActor
    func testFindOutlinesTheHit() throws {
        let app = launch("chat-find")
        XCTAssertTrue(element(app, "desktop-find-hit").waitForExistence(timeout: 20), "the outlined hit")
        XCTAssertTrue(element(app, "jump-to-latest").waitForExistence(timeout: 10), "Jump to latest")
    }

    /// The reply's bar: react, reply and "…" beside the bubble.
    @MainActor
    func testMessageBarBesideTheReply() throws {
        let app = launch("chat-message-hover")
        XCTAssertTrue(element(app, "desktop-message-bar").waitForExistence(timeout: 20), "the bar")
        XCTAssertTrue(element(app, "desktop-message-react").exists, "react")
        XCTAssertTrue(element(app, "desktop-message-reply").exists, "reply")
        XCTAssertTrue(element(app, "desktop-message-actions").exists, "…")
    }

    /// A group: the usage notice, the instructions line and who responds.
    @MainActor
    func testGroupBannersAndHint() throws {
        let app = launch("group-chat")
        XCTAssertTrue(element(app, "desktop-group-cost-notice").waitForExistence(timeout: 20), "the usage notice")
        XCTAssertTrue(element(app, "desktop-group-bulletin").exists, "the instructions line")
        let field = app.textViews["message-input"].exists ? app.textViews["message-input"] : app.textFields["message-input"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        XCTAssertTrue((field.placeholderValue ?? "").contains("responds"), "who responds: \(field.placeholderValue ?? "")")
        // the fixture's members have no voice: the room call says so (the warning dot)
        let voice = app.buttons["desktop-composer-voice"]
        XCTAssertTrue(voice.exists)
        XCTAssertTrue(voice.label.contains("voice in an agent profile"), "the room call's state: \(voice.label)")
    }

    /// A typed /loop writes a routine for this bot, never a message.
    @MainActor
    func testTypedLoopWritesARoutine() throws {
        let app = launch("main")
        let field = app.textViews["message-input"].exists ? app.textViews["message-input"] : app.textFields["message-input"]
        XCTAssertTrue(field.waitForExistence(timeout: 20))
        field.tap()
        field.typeText("/loop 10m sweep check the board")
        let send = element(app, "desktop-composer-send")
        XCTAssertTrue(send.waitForExistence(timeout: 5))
        send.tap()
        var routineId: String?
        let deadline = Date().addingTimeInterval(20)
        while Date() < deadline, routineId == nil {
            let routines = (try api("GET", "/api/routines")["routines"] as? [[String: Any]]) ?? []
            routineId = routines.first { ($0["name"] as? String) == "Loop 10m sweep check the board" }?["id"] as? String
            if routineId == nil { RunLoop.current.run(until: Date().addingTimeInterval(0.5)) }
        }
        let id = try XCTUnwrap(routineId, "the loop's routine")
        _ = try? api("DELETE", "/api/routines/\(id)")
    }

    /// The model menu (ModelPicker windowOnly): search, the models, Providers.
    @MainActor
    func testModelMenuIsThePopover() throws {
        let app = launch("chat-model-picker")
        XCTAssertTrue(element(app, "desktop-model-menu").waitForExistence(timeout: 20), "the model menu")
        XCTAssertTrue(element(app, "desktop-model-search").exists, "its search field")
        XCTAssertTrue(element(app, "model-menu-providers").exists, "Providers at its foot")
    }

    /// The guided first run opens on its first step with the terms over it.
    @MainActor
    func testFirstRunWithTheTerms() throws {
        let app = launch("onboarding-welcome")
        XCTAssertTrue(element(app, "desktop-first-run").waitForExistence(timeout: 20), "the guided first run")
        XCTAssertEqual(element(app, "first-run-progress").label, "Step 1 of 3")
        XCTAssertTrue(element(app, "first-run-skip").exists, "Skip tour")
        XCTAssertTrue(element(app, "first-run-continue").exists, "Continue")
        XCTAssertTrue(element(app, "terms-sheet").exists, "the terms of use")
        XCTAssertTrue(element(app, "terms-accept").exists, "I agree")
        XCTAssertTrue(element(app, "terms-read").exists, "Read the terms")
    }

    /// The tour starts on the composer, Next moves on, Skip closes it.
    @MainActor
    func testTourStepsAndSkips() throws {
        let app = launch("onboarding-tour")
        XCTAssertTrue(element(app, "desktop-tour").waitForExistence(timeout: 20), "the tour")
        XCTAssertEqual(element(app, "tour-progress").label, "Step 1 of 9")
        element(app, "tour-next").tap()
        let second = NSPredicate(format: "label == %@", "Step 2 of 9")
        expectation(for: second, evaluatedWith: element(app, "tour-progress"))
        waitForExpectations(timeout: 10)
        element(app, "tour-skip").tap()
        let gone = NSPredicate(format: "exists == false")
        expectation(for: gone, evaluatedWith: element(app, "desktop-tour"))
        waitForExpectations(timeout: 10)
    }
}
