import XCTest

/// The approval dock and interactive cards of WP2 (feature parity matrix rows
/// CA3-CA5, CA8-CA12, CA14, CA17, TH8) against the parity fixture's card lab
/// (`PARITY_CARDS=1 node ios/parity/fixture-server.mjs`, ios/parity/card-lab.mjs).
/// Each test acts in the app and then reads the server's own state through the
/// API (and what the fake engine received, through the lab's hook), so a
/// button that only changed the screen fails.
///
/// The session comes from TEST_RUNNER_PARITY_ENDPOINT / _TOKEN / _ENVIRONMENT
/// or `ios/parity/out/session.json`; without a card lab the tests are skipped.
final class CardsUITests: XCTestCase {
    private struct FixtureSession: Decodable {
        let endpoint: String
        let token: String
        let environmentId: String?
    }

    private struct LabBot: Decodable { let id: String; let threadId: String; let name: String }
    private struct EngineAnswer: Decodable { let behavior: String?; let always: Bool? }
    private struct Broker: Decodable { let authorizes: [String]; let connected: [String] }
    private struct Lab: Decodable {
        let bots: [String: LabBot]
        let answers: [String: EngineAnswer]
        let broker: Broker
    }

    private struct Card: Decodable {
        let requestId: String?
        let answered: String?
        let dismissed: Bool?
    }
    private struct Connector: Decodable { let status: String; let dismissed: Bool?; let resumed: Bool? }
    private struct Secret: Decodable { let dismissed: Bool?; let resumed: Bool?; let provided: Bool? }
    private struct Parallel: Decodable { let threadId: String; let role: String; let state: String? }
    private struct WireMessage: Decodable {
        let id: String
        let role: String
        let kind: String
        let text: String?
        let parentId: String?
        let card: Card?
        let connector: Connector?
        let secret: Secret?
        let parallelTask: Parallel?
    }
    private struct Page: Decodable { let messages: [WireMessage]; let activeLeafId: String? }
    private struct WireBot: Decodable { let id: String; let busy: Bool? }
    private struct Fleet: Decodable { let bots: [WireBot] }
    private struct Rule: Decodable { let command: String }
    private struct Rules: Decodable { let rules: [Rule] }

    private var fixture: FixtureSession!

    private func fixtureSession() throws -> FixtureSession {
        let env = ProcessInfo.processInfo.environment
        if let endpoint = env["PARITY_ENDPOINT"], let token = env["PARITY_TOKEN"] {
            return FixtureSession(endpoint: endpoint, token: token, environmentId: env["PARITY_ENVIRONMENT"].flatMap { $0.isEmpty ? nil : $0 })
        }
        let file = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("parity/out/session.json")
        guard let data = try? Data(contentsOf: file) else {
            throw XCTSkip("parity fixture server is not running (\(file.path))")
        }
        return try JSONDecoder().decode(FixtureSession.self, from: data)
    }

    // MARK: - The server

    private func request(_ method: String, _ path: String, body: [String: Any]? = nil) throws -> Data {
        var request = URLRequest(url: URL(string: fixture.endpoint + path)!)
        request.httpMethod = method
        request.timeoutInterval = 60
        request.setValue("Bearer \(fixture.token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let done = expectation(description: "\(method) \(path)")
        var result: Result<Data, Error> = .failure(URLError(.unknown))
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error { result = .failure(error) }
            else if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                result = .failure(NSError(domain: "fixture", code: http.statusCode, userInfo: [
                    NSLocalizedDescriptionKey: String(data: data ?? Data(), encoding: .utf8) ?? "",
                ]))
            } else { result = .success(data ?? Data()) }
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 70)
        return try result.get()
    }

    private func lab() throws -> Lab {
        do {
            return try JSONDecoder().decode(Lab.self, from: request("GET", "/__parity/cards"))
        } catch let error as NSError where error.domain == "fixture" && error.code == 404 {
            throw XCTSkip("start the fixture with PARITY_CARDS=1 for the card lab")
        }
    }

    private func bot(_ key: String) throws -> LabBot {
        try XCTUnwrap(lab().bots[key], "the card lab seeds \(key)")
    }

    private func page(_ threadId: String) throws -> Page {
        try JSONDecoder().decode(Page.self, from: request("GET", "/api/threads/\(threadId)/messages?limit=200"))
    }

    private func message(_ id: String, in threadId: String) throws -> WireMessage? {
        try page(threadId).messages.first { $0.id == id }
    }

    private func card(_ requestId: String, in threadId: String) throws -> Card? {
        try page(threadId).messages.compactMap(\.card).first { $0.requestId == requestId }
    }

    private func busy(_ botId: String) throws -> Bool {
        try JSONDecoder().decode(Fleet.self, from: request("GET", "/api/bots")).bots.first { $0.id == botId }?.busy == true
    }

    /// Fresh asks on Card Lab: the previous turn (and any ask it left open)
    /// is stopped first, so each test starts with exactly its own asks.
    private func asks(_ list: [[String: Any]]) throws -> [String] {
        let lab = try bot("asks")
        _ = try? request("POST", "/api/bots/\(lab.id)/interrupt", body: ["threadId": lab.threadId])
        try eventually("Card Lab idle") { try !busy(lab.id) }
        struct Created: Decodable { let requestIds: [String] }
        return try JSONDecoder().decode(Created.self, from: request("POST", "/__parity/cards/asks", body: ["asks": list])).requestIds
    }

    private func eventually(_ what: String, timeout: TimeInterval = 45, _ check: () throws -> Bool) rethrows {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if try check() { return }
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        }
        XCTFail("timed out waiting for: \(what)")
    }

    // MARK: - The app

    @MainActor
    private func launch(_ chatName: String) throws -> XCUIApplication {
        continueAfterFailure = false
        fixture = try fixtureSession()
        _ = try lab()
        let app = XCUIApplication()
        app.terminate()
        var arguments = [
            "-parityEndpoint", fixture.endpoint,
            "-parityToken", fixture.token,
            "-parityScreen", "02-chat",
            "-parityChat", chatName,
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES",
        ]
        if let environment = fixture.environmentId { arguments += ["-parityEnvironment", environment] }
        app.launchArguments = arguments
        app.launch()
        XCTAssertTrue(app.buttons["chat-name"].waitForExistence(timeout: 30))
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    @MainActor
    private func tap(_ app: XCUIApplication, _ id: String, timeout: TimeInterval = 20) {
        let target = element(app, id)
        XCTAssertTrue(target.waitForExistence(timeout: timeout), "\(id) on screen")
        reveal(app, target)
        target.tap()
    }

    /// The transcript scrolls under the glass header and above the
    /// composer: bring a row into the open middle before touching it.
    @MainActor
    private func reveal(_ app: XCUIApplication, _ target: XCUIElement) {
        let height = app.frame.height
        let middle = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        for _ in 0..<8 {
            let frame = target.frame
            let offset: CGFloat
            if frame.minY < 160 {
                offset = min(250, 300 - frame.minY)
            } else if frame.maxY > height - 180 {
                offset = -min(250, frame.maxY - (height - 300))
            } else {
                return
            }
            middle.press(forDuration: 0.05, thenDragTo: middle.withOffset(CGVector(dx: 0, dy: offset)))
            RunLoop.current.run(until: Date().addingTimeInterval(0.6))
        }
    }

    private func attach(_ name: String, _ app: XCUIApplication) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    private func setUpFixture() throws {
        fixture = try fixtureSession()
        _ = try lab()
    }

    // MARK: - Approval dock (CA2-CA5)

    /// The stepper walks the open asks; Allow once and Deny answer the one
    /// on screen, and the engine receives exactly that.
    @MainActor
    func testDockStepperAllowOnceAndDeny() throws {
        try setUpFixture()
        let ids = try asks([
            ["tool": "Read", "input": ["file_path": "/tmp/notes-remplacement.md"]],
            ["tool": "Bash", "input": ["command": "printf 'stepper'"]],
        ])
        let thread = try bot("asks").threadId
        let app = try launch("Card Lab")
        XCTAssertTrue(element(app, "approval-dock").waitForExistence(timeout: 20))
        XCTAssertEqual(element(app, "approval-position").label, "1 of 2")
        attach("Dock, first of two", app)
        tap(app, "approval-next")
        XCTAssertEqual(element(app, "approval-position").label, "2 of 2")
        XCTAssertTrue(element(app, "approval-dock-detail").label.contains("printf 'stepper'"))
        tap(app, "approval-allow-once")
        try eventually("the Bash ask allowed") { try card(ids[1], in: thread)?.answered == "allow" }
        try eventually("the engine received allow") { try lab().answers[ids[1]]?.behavior == "allow" }
        XCTAssertNil(try card(ids[0], in: thread)?.answered, "only the request on screen is answered")

        XCTAssertFalse(element(app, "approval-position").waitForExistence(timeout: 3), "one left: no stepper")
        tap(app, "approval-deny")
        try eventually("the Read ask denied") { try card(ids[0], in: thread)?.answered == "deny" }
        try eventually("the engine received deny") { try lab().answers[ids[0]]?.behavior == "deny" }
        try eventually("the dock leaves") { !element(app, "approval-dock").exists }
        attach("Dock gone, cards settled", app)
    }

    /// Always allow this session hands the provider its own allow; Always
    /// allow this command saves the exact command for the bot.
    @MainActor
    func testDockAlwaysAllowSessionAndCommand() throws {
        try setUpFixture()
        let command = "printf 'toujours-\(Int(Date().timeIntervalSince1970))'"
        let ids = try asks([
            ["tool": "Read", "input": ["file_path": "/tmp/session.md"]],
            ["tool": "Bash", "input": ["command": command]],
        ])
        let lab = try bot("asks")
        let app = try launch("Card Lab")
        tap(app, "approval-always-session")
        try eventually("the Read ask allowed") { try card(ids[0], in: lab.threadId)?.answered == "allow" }
        try eventually("the engine kept the allow for its session") {
            let answer = try self.lab().answers[ids[0]]
            return answer?.behavior == "allow" && answer?.always == true
        }

        tap(app, "approval-always-command")
        try eventually("the Bash ask allowed") { try card(ids[1], in: lab.threadId)?.answered == "allow" }
        try eventually("the exact command saved") {
            try JSONDecoder().decode(Rules.self, from: request("GET", "/api/bots/\(lab.id)/command-allowlist")).rules
                .contains { $0.command == command }
        }
        XCTAssertNotEqual(try self.lab().answers[ids[1]]?.always, true, "a saved command is not a session allow")
    }

    /// Allow all read-only answers the reads and nothing else.
    @MainActor
    func testDockAllowAllReadOnly() throws {
        try setUpFixture()
        let ids = try asks([
            ["tool": "Read", "input": ["file_path": "/tmp/a.md"]],
            ["tool": "Glob", "input": ["pattern": "**/*.md"]],
            ["tool": "Bash", "input": ["command": "printf 'pas-lecture'"]],
        ])
        let thread = try bot("asks").threadId
        let app = try launch("Card Lab")
        XCTAssertTrue(element(app, "approval-allow-read-only").waitForExistence(timeout: 20))
        XCTAssertEqual(element(app, "approval-allow-read-only").label, "Allow all read-only (2)")
        tap(app, "approval-allow-read-only")
        try eventually("both reads allowed") {
            try card(ids[0], in: thread)?.answered == "allow" && card(ids[1], in: thread)?.answered == "allow"
        }
        XCTAssertNil(try card(ids[2], in: thread)?.answered, "the command still waits")
        XCTAssertTrue(element(app, "approval-dock").exists)
        XCTAssertTrue(element(app, "approval-dock-detail").label.contains("pas-lecture"))
    }

    // MARK: - Parallel task (TH8)

    @MainActor
    func testParallelTaskStopAndOpen() throws {
        try setUpFixture()
        let lab = try bot("asks")
        _ = try? request("POST", "/api/bots/\(lab.id)/interrupt", body: ["threadId": lab.threadId])
        try eventually("Card Lab idle") { try !busy(lab.id) }
        let title = "Inventaire \(Int(Date().timeIntervalSince1970) % 100_000)"
        struct Opened: Decodable { let threadId: String }
        let task = try JSONDecoder().decode(Opened.self, from: request("POST", "/__parity/cards/parallel", body: ["title": title])).threadId
        let app = try launch("Card Lab")
        XCTAssertTrue(element(app, "parallel-open-\(task)").waitForExistence(timeout: 20))
        XCTAssertTrue(element(app, "parallel-state-\(task)").label.hasPrefix("Running"))
        attach("Parallel task running", app)
        tap(app, "parallel-stop-\(task)")
        try eventually("the task recorded stopped") {
            try page(lab.threadId).messages.contains { $0.parallelTask?.threadId == task && $0.parallelTask?.role == "card" && $0.parallelTask?.state == "stopped" }
        }
        try eventually("Stop leaves with the live state") { !element(app, "parallel-stop-\(task)").exists }
        tap(app, "parallel-open-\(task)")
        let request = app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
        XCTAssertTrue(request.waitForExistence(timeout: 20), "the task's own thread opens")
        XCTAssertFalse(element(app, "parallel-open-\(task)").exists)
        attach("Parallel task thread", app)
    }

    // MARK: - Option card (CA8)

    @MainActor
    func testOptionCardDismiss() throws {
        try setUpFixture()
        let quiz = try bot("quiz")
        let app = try launch("Quiz Lab")
        tap(app, "card-dismiss-lab-quiz-card")
        try eventually("the card dismissed on the server") { try message("lab-quiz-card", in: quiz.threadId)?.card?.dismissed == true }
        try eventually("the card leaves") { !element(app, "card-dismiss-lab-quiz-card").exists }
    }

    // MARK: - Access, owner wait, goal run (CA11, CA12, CA14)

    @MainActor
    func testAccessOwnerWaitAndGoalRunCards() throws {
        try setUpFixture()
        let quiz = try bot("quiz")
        let kinds = Dictionary(try page(quiz.threadId).messages.map { ($0.id, $0.kind) }, uniquingKeysWith: { a, _ in a })
        XCTAssertEqual(kinds["lab-access"], "access")
        XCTAssertEqual(kinds["lab-goal"], "goal.run")
        let app = try launch("Quiz Lab")
        let access = app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH %@", "No Claude access for this turn")).firstMatch
        XCTAssertTrue(access.waitForExistence(timeout: 20), "the access card speaks to the viewer")
        XCTAssertEqual(element(app, "owner-wait-lab-owner-wait").label, "Waiting on Liora")
        XCTAssertTrue(app.staticTexts["Quiz Lab coordinating · 3 turns"].exists)
        XCTAssertEqual(element(app, "goal-run-status").label, "Completed")
        attach("Access, owner wait, goal run", app)
    }

    // MARK: - Credential card (CA9)

    @MainActor
    func testCredentialCardDismissAndResume() throws {
        try setUpFixture()
        let connect = try bot("connect")
        let app = try launch("Connect Lab")
        tap(app, "secret-dismiss-lab-secret-waiting")
        try eventually("the request declined on the server") { try message("lab-secret-waiting", in: connect.threadId)?.secret?.dismissed == true }
        XCTAssertNotEqual(try message("lab-secret-waiting", in: connect.threadId)?.secret?.provided, true)

        tap(app, "secret-resume-lab-secret-failed")
        try eventually("the task resumed") { try message("lab-secret-failed", in: connect.threadId)?.secret?.resumed == true }
        try eventually("a resumed decline leaves nothing to show") { !element(app, "secret-resume-lab-secret-failed").exists }
    }

    // MARK: - Connector card (CA10)

    /// Connect asks the computer for the sign-in page (the card turns
    /// authorizing) and opens it; once the provider reports the app
    /// connected, the card's own check settles it and the task resumes.
    @MainActor
    func testConnectorCardConnectAndDismiss() throws {
        try setUpFixture()
        let connect = try bot("connect")
        let app = try launch("Connect Lab")
        tap(app, "connector-connect-lab-connector-gmail")
        // ASWebAuthenticationSession's consent: the page itself is never loaded here.
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let cancel = springboard.buttons["Cancel"]
        if cancel.waitForExistence(timeout: 10) { cancel.tap() }
        try eventually("the card authorizing on the server") { try message("lab-connector-gmail", in: connect.threadId)?.connector?.status == "authorizing" }
        try eventually("the broker asked for the sign-in link") { try lab().broker.authorizes.contains("gmail") }

        _ = try request("POST", "/__parity/cards/connect", body: ["slug": "gmail"])
        try eventually("connected and resumed through the card's own check", timeout: 30) {
            let card = try message("lab-connector-gmail", in: connect.threadId)?.connector
            return card?.status == "connected" && card?.resumed == true
        }
        XCTAssertTrue(element(app, "connector-continuing-lab-connector-gmail").waitForExistence(timeout: 15))
        attach("Connector connected", app)

        tap(app, "connector-dismiss-lab-connector-slack")
        try eventually("Not now recorded") { try message("lab-connector-slack", in: connect.threadId)?.connector?.dismissed == true }
        try eventually("the card leaves") { !element(app, "connector-dismiss-lab-connector-slack").exists }
    }

    // MARK: - Error row (CA17)

    @MainActor
    func testErrorRowRetry() throws {
        try setUpFixture()
        let retry = try bot("retry")
        let app = try launch("Retry Lab")
        tap(app, "error-retry-lab-retry-error")
        try eventually("the last user line sent again on a new branch") {
            let page = try page(retry.threadId)
            let byId = Dictionary(page.messages.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
            guard var cursor = page.activeLeafId.flatMap({ byId[$0] }) else { return false }
            var path = [cursor]
            while let parent = cursor.parentId, let next = byId[parent] { path.insert(next, at: 0); cursor = next }
            guard let user = path.lastIndex(where: { $0.role == "user" }) else { return false }
            return path[user].id != "lab-retry-1" && path[user].text == "Résume la semaine de remplacement."
                && path[(user + 1)...].contains { $0.role == "bot" && $0.kind == "text" }
        }
        try eventually("Retry leaves with the error") { !element(app, "error-retry-lab-retry-error").exists }
    }
}
