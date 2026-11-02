import XCTest

/// The chat screen (reference 02) against the parity fixture server: a real
/// server on throwaway data with the repository's fake engine, so a send
/// gets a real streamed reply and nothing reaches a provider.
///
/// Start the fixture first (`node ios/parity/fixture-server.mjs`) and pass its
/// session as TEST_RUNNER_PARITY_ENDPOINT / _TOKEN / _ENVIRONMENT, or leave the
/// `ios/parity/out/session.json` it writes in place; without either the test
/// is skipped.
final class ParityChatUITests: XCTestCase {
    private struct FixtureSession: Decodable {
        let endpoint: String
        let token: String
        let environmentId: String?
    }

    private func fixtureSession() throws -> FixtureSession {
        // The runner's environment first (TEST_RUNNER_PARITY_*, as the other
        // parity suites read it), so a stale session file from an earlier
        // run cannot point the test at a server that is gone.
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

    @MainActor
    private func launchChat() throws -> XCUIApplication {
        continueAfterFailure = false
        let session = try fixtureSession()
        let app = XCUIApplication()
        app.terminate()
        var arguments = [
            "-parityEndpoint", session.endpoint,
            "-parityToken", session.token,
            "-parityScreen", "02-chat",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES",
            // a call here never asks for the simulator's microphone
            "-callInjectAudio", URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("CallAudio/bot").path,
            "-callCaptureSpeech",
        ]
        if let environment = session.environmentId { arguments += ["-parityEnvironment", environment] }
        app.launchArguments = arguments
        app.launch()
        XCTAssertTrue(app.buttons["chat-name"].waitForExistence(timeout: 20))
        return app
    }

    /// Typing turns the white capsule into send; the fake engine's reply
    /// streams back into the transcript.
    @MainActor
    func testSendStreamsAReply() throws {
        let app = try launchChat()
        XCTAssertTrue(app.buttons["composer-voice"].exists, "an empty composer offers voice mode")
        let input = app.descendants(matching: .any).matching(identifier: "message-input").firstMatch
        input.tap()
        input.typeText("Bonjour Ara")
        let send = app.buttons["composer-send"]
        XCTAssertTrue(send.waitForExistence(timeout: 5), "text turns the capsule into send")
        send.tap()
        let reply = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "hello from fake claude")).firstMatch
        XCTAssertTrue(reply.waitForExistence(timeout: 45))
        XCTAssertTrue(app.buttons["composer-voice"].waitForExistence(timeout: 5), "sent: back to voice")
        attach("Reply streamed from the fake engine", app)
    }

    /// The name capsule opens the bot panel; the computer entry in "..."
    /// opens the Computer page (Lot 4: a pushed page with Back and help);
    /// the white capsule opens voice mode.
    @MainActor
    func testTopBarAndVoiceOpenTheirScreens() throws {
        let app = try launchChat()

        app.buttons["chat-name"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["profile-name"].firstMatch.waitForExistence(timeout: 10), "bot panel")
        attach("Bot panel from the name capsule", app)
        app.buttons["panel-close"].tap()
        // the computer is in the header's "..." menu (the reference design iOS 1.14)
        XCTAssertTrue(app.buttons["chat-more"].waitForExistence(timeout: 10))
        app.buttons["chat-more"].tap()
        XCTAssertTrue(app.buttons["header-computer"].waitForExistence(timeout: 5))
        attach("The header's more menu", app)
        app.buttons["header-computer"].tap()
        // Lot 4: the Computer door opens the computer page directly
        let back = app.buttons["computer-back"]
        let help = app.descendants(matching: .any)["computer-help"].firstMatch
        XCTAssertTrue(back.waitForExistence(timeout: 10) || help.waitForExistence(timeout: 2), "computer page")
        attach("Computer page", app)
        if back.exists { back.tap() }
        XCTAssertTrue(app.buttons["panel-close"].waitForExistence(timeout: 10))
        app.buttons["panel-close"].tap()
        XCTAssertTrue(app.buttons["composer-voice"].waitForExistence(timeout: 10))

        app.buttons["composer-voice"].tap()
        let pill = app.descendants(matching: .any)["call-pill"]
        XCTAssertTrue(pill.waitForExistence(timeout: 10), "voice mode: the call pill")
        attach("Voice mode from the white capsule", app)
        app.buttons["composer-end-call"].tap()
        XCTAssertTrue(app.buttons["composer-voice"].waitForExistence(timeout: 10), "hung up")
        XCTAssertTrue(app.buttons["chat-name"].exists)
    }

    /// Threads and slash commands moved into the "+" sheet; threads also
    /// sit behind a touch and hold on the name.
    @MainActor
    func testPlusSheetCarriesThreadsAndSlashCommands() throws {
        let app = try launchChat()

        app.buttons["composer-plus"].tap()
        let commands = app.buttons["plus-commands"]
        XCTAssertTrue(commands.waitForExistence(timeout: 5))
        commands.tap()
        // the real "/" menu (WP3): Sagax's own commands, then the engine's
        let menu = app.descendants(matching: .any).matching(identifier: "slash-menu").firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 10), "slash command menu")
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "slash-/compact").firstMatch.waitForExistence(timeout: 15), "the engine's commands")
        attach("Slash commands from the + sheet", app)

        app.buttons["composer-plus"].tap()
        let threads = app.buttons["plus-tasks"]
        XCTAssertTrue(threads.waitForExistence(timeout: 5))
        threads.tap()
        XCTAssertTrue(app.buttons["new-thread"].waitForExistence(timeout: 10), "thread picker")
        attach("Threads from the + sheet", app)
        app.swipeDown(velocity: .fast)

        let name = app.buttons["chat-name"]
        XCTAssertTrue(name.waitForExistence(timeout: 10))
        name.press(forDuration: 1.0)
        let menuThreads = app.buttons["Threads"]
        XCTAssertTrue(menuThreads.waitForExistence(timeout: 5), "touch and hold menu")
        menuThreads.tap()
        XCTAssertTrue(app.buttons["new-thread"].waitForExistence(timeout: 10))
    }

    @MainActor
    private func attach(_ name: String, _ app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
