import XCTest

/// The YouTube player in a bot reply (YouTubeMiniPlayerView) against the
/// parity fixture's rich lab (`PARITY_RICH=1 node ios/parity/fixture-server.mjs`,
/// message `rich-youtube`): the embed fills the 16:9 stage with YouTube's own
/// controls on it (the IFrame API's default 640x390 iframe showed only its
/// top-left quarter), and "Get full transcript" shows real captions read by
/// the server from YouTube, or says why it could not.
///
/// Needs the network (youtube.com). The session comes from
/// TEST_RUNNER_PARITY_ENDPOINT / _TOKEN / _ENVIRONMENT or
/// `ios/parity/out/session.json`; without the rich lab the tests are skipped.
/// With TEST_RUNNER_YT_SHOTS=<dir> each step is also saved there as a PNG.
final class YouTubeEmbedUITests: XCTestCase {
    private struct FixtureSession: Decodable {
        let endpoint: String
        let token: String
        let environmentId: String?
    }

    private struct WireBot: Decodable { let name: String }
    private struct Fleet: Decodable { let bots: [WireBot] }

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

    private func requireRichLab(_ fixture: FixtureSession) throws {
        var request = URLRequest(url: URL(string: fixture.endpoint + "/api/bots")!)
        request.setValue("Bearer \(fixture.token)", forHTTPHeaderField: "Authorization")
        let done = expectation(description: "fleet")
        var names: [String] = []
        URLSession.shared.dataTask(with: request) { data, _, _ in
            names = (data.flatMap { try? JSONDecoder().decode(Fleet.self, from: $0) }?.bots ?? []).map(\.name)
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 30)
        guard names.contains("Rich Lab") else { throw XCTSkip("the fixture runs without PARITY_RICH=1") }
    }

    @MainActor
    private func launch() throws -> XCUIApplication {
        continueAfterFailure = false
        let fixture = try fixtureSession()
        try requireRichLab(fixture)
        let app = XCUIApplication()
        app.terminate()
        var arguments = [
            "-parityEndpoint", fixture.endpoint,
            "-parityToken", fixture.token,
            "-parityScreen", "02-chat",
            "-parityChat", "Rich Lab",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES",
        ]
        if let environment = fixture.environmentId { arguments += ["-parityEnvironment", environment] }
        // TEST_RUNNER_YT_SKIN=daylight (a light skin) or black, for the light and dark captures.
        if let skin = ProcessInfo.processInfo.environment["YT_SKIN"], !skin.isEmpty {
            arguments += ["-companion.prefs.theme.mode", "fixed", "-companion.prefs.theme.fixed", skin]
        }
        app.launchArguments = arguments
        app.launch()
        // iPad draws the conversation in its split layout, without the phone's title button.
        if UIDevice.current.userInterfaceIdiom == .pad {
            XCTAssertTrue(element(app, suffix: "-yt-embed").waitForExistence(timeout: 45), "the player in the iPad layout")
            // the fixture's workspace never finished the desktop's guided first run: skip it as a
            // person would, or its card takes every tap meant for the transcript
            let skip = app.descendants(matching: .any).matching(identifier: "first-run-skip").firstMatch
            if skip.waitForExistence(timeout: 5) {
                skip.tap()
                XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "desktop-first-run").firstMatch.waitForExistence(timeout: 2), "the first run closed")
            }
        } else {
            XCTAssertTrue(app.buttons["chat-name"].waitForExistence(timeout: 30))
        }
        return app
    }

    private func element(_ app: XCUIApplication, suffix: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'message-rich-youtube' AND identifier ENDSWITH %@", suffix)).firstMatch
    }

    /// Scroll the transcript until the element sits in the visible band.
    @MainActor
    @discardableResult
    private func reveal(_ app: XCUIApplication, _ target: XCUIElement) -> XCUIElement {
        _ = target.waitForExistence(timeout: 5)
        let window = app.windows.firstMatch.frame
        let top = window.minY + 110
        let bottom = window.maxY - 160
        for _ in 0..<40 {
            guard target.exists else {
                app.swipeDown(velocity: .slow)
                continue
            }
            let frame = target.frame
            if frame.minY >= top - 10 && frame.maxY <= bottom + 10 { return target }
            let delta = max(-260, min(260, (top + bottom) / 2 - frame.midY))
            let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            start.press(forDuration: 0.1, thenDragTo: start.withOffset(CGVector(dx: 0, dy: delta)), withVelocity: .slow, thenHoldForDuration: 0.2)
        }
        XCTAssertTrue(target.exists, "\(target) on screen")
        return target
    }

    private func shot(_ name: String) {
        let screenshot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = ProcessInfo.processInfo.environment["YT_SHOTS"], !dir.isEmpty {
            try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            try? screenshot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
        }
    }

    private var tag: String {
        let idiom = UIDevice.current.userInterfaceIdiom == .pad ? "ipad" : "iphone"
        let style = ProcessInfo.processInfo.environment["YT_STYLE"] ?? "light"
        return "\(idiom)-\(style)"
    }

    @MainActor
    func testPlayerFillsTheStageWithYouTubeControlsAndTranscriptLoads() throws {
        let app = try launch()
        let embed = reveal(app, element(app, suffix: "-yt-embed"))
        let stage = embed.frame
        XCTAssertGreaterThan(stage.width, 200)
        XCTAssertEqual(stage.height, stage.width * 9 / 16, accuracy: 2, "16:9 stage")

        // YouTube's own big play button, inside the stage and near its
        // middle: with the old fixed 640x390 iframe it sat outside the view.
        let play = embed.descendants(matching: .button).matching(NSPredicate(format: "label CONTAINS[c] 'play' OR label CONTAINS[c] 'lire'")).firstMatch
        XCTAssertTrue(play.waitForExistence(timeout: 30), "YouTube's play button")
        let center = CGPoint(x: play.frame.midX, y: play.frame.midY)
        XCTAssertTrue(stage.contains(center), "play button \(play.frame) inside the stage \(stage)")
        XCTAssertEqual(center.x, stage.midX, accuracy: stage.width * 0.12, "play button centred")
        Thread.sleep(forTimeInterval: 2)
        shot("\(tag)-player")

        let button = element(app, suffix: "-yt-transcript")
        XCTAssertTrue(button.waitForExistence(timeout: 5))
        XCTAssertFalse(stage.intersects(button.frame), "the transcript button sits under the player, not over its controls")
        button.tap()
        let cue = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "in front of the elephants")).firstMatch
        let failure = element(app, suffix: "-yt-transcript-error")
        let deadline = Date().addingTimeInterval(30)
        while Date() < deadline, !cue.exists, !failure.exists { Thread.sleep(forTimeInterval: 0.5) }
        XCTAssertFalse(failure.exists, "transcript error: \(failure.exists ? failure.label : "")")
        XCTAssertTrue(cue.exists, "a real caption line from YouTube")
        reveal(app, button)
        shot("\(tag)-transcript")

        // iPadOS refuses programmatic rotation in its windowing mode
        // (ParityOrientationUITests): the iPad run stops here.
        guard UIDevice.current.userInterfaceIdiom != .pad else { return }
        XCUIDevice.shared.orientation = .landscapeLeft
        Thread.sleep(forTimeInterval: 2)
        let rotated = reveal(app, element(app, suffix: "-yt-embed")).frame
        XCTAssertEqual(rotated.height, rotated.width * 9 / 16, accuracy: 2, "16:9 after rotation")
        shot("\(tag)-landscape")
        XCUIDevice.shared.orientation = .portrait
    }
}
