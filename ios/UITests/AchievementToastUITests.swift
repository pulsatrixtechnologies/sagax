import UIKit
import XCTest

/// An unlock banner over the home (ST9). The banner lives in a window of its
/// own above the app; once it is gone the app below must still be seen and
/// still answer touches. TestFlight 0.4.9 (14) left a black window over
/// everything after the first unlock: the banner's window painted the skin's
/// desktop colour full screen and kept every touch until the app was killed.
///
///   node ios/parity/fixture-server.mjs &
///   TEST_RUNNER_PARITY_ENDPOINT=... TEST_RUNNER_PARITY_TOKEN=... \
///   TEST_RUNNER_PARITY_ENVIRONMENT=... xcodebuild test \
///     -only-testing:SagaxUITests/AchievementToastUITests ...
///
/// TEST_RUNNER_ACHIEVEMENT_SHOTS=<dir> also writes the screens it saw there.
final class AchievementToastUITests: XCTestCase {
    private var endpoint = ""
    private var token = ""
    private var arguments: [String] = []

    /// Client events that unlock an achievement on their first report.
    private let unlocks: [(event: String, id: String)] = [
        ("palette.opened", "palette"),
        ("shortcuts.opened", "keyboard-ninja"),
        ("files.opened", "librarian"),
        ("grok.linked", "grok-linked"),
    ]

    override func setUpWithError() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        guard let endpoint = env["PARITY_ENDPOINT"], let token = env["PARITY_TOKEN"] else {
            throw XCTSkip("no parity fixture: set TEST_RUNNER_PARITY_ENDPOINT and TEST_RUNNER_PARITY_TOKEN")
        }
        self.endpoint = endpoint
        self.token = token
        arguments = [
            "-parityEndpoint", endpoint, "-parityToken", token, "-parityScreen", "01-home",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US", "-achievementsLive",
        ]
        if let environment = env["PARITY_ENVIRONMENT"], !environment.isEmpty {
            arguments += ["-parityEnvironment", environment]
        }
    }

    @MainActor
    func testTheAppStillAnswersAfterAnUnlockBanner() throws {
        let (status, snapshot) = api("GET", "/api/me/achievements")
        guard status == 200 else { throw XCTSkip("this pairing keeps no achievements (\(status))") }
        let unlocked = Set((snapshot["items"] as? [[String: Any]] ?? [])
            .filter { $0["unlockedAt"] != nil }.compactMap { $0["id"] as? String })
        guard let next = unlocks.first(where: { !unlocked.contains($0.id) }) else {
            throw XCTSkip("every test unlock is already earned: restart the fixture")
        }

        let app = launchHome()
        let plus = app.buttons["home-plus"]
        // The first snapshot only seeds what is known: let it land first.
        Thread.sleep(forTimeInterval: 4)

        // Earned on another device; the phone hears of it when it comes back.
        XCTAssertEqual(api("POST", "/api/me/achievements/events", body: ["events": [["type": next.event]]]).0, 200)
        XCUIDevice.shared.press(.home)
        Thread.sleep(forTimeInterval: 1.5)
        app.activate()

        let toast = app.descendants(matching: .any)["achievement-toast"]
        XCTAssertTrue(toast.waitForExistence(timeout: 15), "the unlock banner shows")
        let during = shot(app, "1-banner")
        XCTAssertGreaterThan(colours(during, below: 0.25), 8, "the home shows under the banner, not a blank window")
        XCTAssertTrue(waitGone(toast, timeout: 12), "the banner goes away on its own")
        Thread.sleep(forTimeInterval: 1)
        let after = shot(app, "2-after-banner")
        XCTAssertGreaterThan(colours(after, below: 0.1), 8, "the home shows again once the banner is gone, not a blank window")

        // The home is still there and still answers a touch.
        plus.tap()
        XCTAssertTrue(app.buttons["plus-menu.new-bot"].waitForExistence(timeout: 5), "a touch reaches the app after the banner")
        shot(app, "3-touch-after-banner")
    }

    /// While the banner shows, nothing under it gets a touch (owner
    /// 2026-10-19): a touch on the card stays on the card (the account
    /// button under it does not open its menu), the close button closes
    /// the banner only, and a touch outside the card closes the banner
    /// without opening the chat under it.
    @MainActor
    func testTouchesOnTheBannerNeverReachTheAppUnderIt() throws {
        let app = launchHome()
        let plus = app.buttons["home-plus"]
        Thread.sleep(forTimeInterval: 4)
        let toast = app.descendants(matching: .any)["achievement-toast"]
        // the photo opens Settings itself since the Grok Bot home (2026-11-01)
        let accountMenu = app.descendants(matching: .any).matching(NSPredicate(format: "identifier IN %@", ["account-menu.settings", "settings-close"])).firstMatch

        // the card over the account button, then its close button
        try unlockNext(in: app)
        XCTAssertTrue(toast.waitForExistence(timeout: 15), "the unlock banner shows")
        shot(app, "4-banner-over-the-home")
        toast.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.5)).tap()
        XCTAssertFalse(accountMenu.waitForExistence(timeout: 2), "a touch on the card stays on the card")
        XCTAssertTrue(toast.exists, "a touch on the card keeps the banner")
        app.buttons["achievement-toast-dismiss"].tap()
        XCTAssertTrue(waitGone(toast, timeout: 5), "the close button closes the banner")
        XCTAssertFalse(accountMenu.exists, "the close button's touch reached nothing under it")
        XCTAssertFalse(app.buttons["chat-name"].exists)

        // a touch outside the card closes it and goes no further
        try unlockNext(in: app)
        XCTAssertTrue(toast.waitForExistence(timeout: 15), "the second banner shows")
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'chat-row.'")).firstMatch
        XCTAssertTrue(row.exists, "a chat row under the backdrop")
        // the backdrop covers it: XCTest no longer calls the row hittable
        row.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(waitGone(toast, timeout: 5), "a touch outside the card closes the banner")
        XCTAssertFalse(app.buttons["chat-name"].waitForExistence(timeout: 2), "the touch did not open the chat under it")

        // and the app answers again
        plus.tap()
        XCTAssertTrue(app.buttons["plus-menu.new-bot"].waitForExistence(timeout: 5), "a touch reaches the app after the banner")
    }

    /// The parity home. The first launch after an install can restore a
    /// prewarmed scene without the launch arguments (the unpaired welcome):
    /// that wrong route is restarted once.
    @MainActor
    private func launchHome() -> XCUIApplication {
        let app = XCUIApplication()
        app.terminate()
        app.launchArguments = arguments
        app.launch()
        if !app.buttons["home-plus"].waitForExistence(timeout: 20) {
            app.terminate()
            app.launch()
        }
        XCTAssertTrue(app.buttons["home-plus"].waitForExistence(timeout: 30))
        return app
    }

    /// Earns the next test unlock on the server and brings the app back to
    /// the front, which reloads the achievements.
    @MainActor
    private func unlockNext(in app: XCUIApplication) throws {
        let (status, snapshot) = api("GET", "/api/me/achievements")
        guard status == 200 else { throw XCTSkip("this pairing keeps no achievements (\(status))") }
        let unlocked = Set((snapshot["items"] as? [[String: Any]] ?? [])
            .filter { $0["unlockedAt"] != nil }.compactMap { $0["id"] as? String })
        guard let next = unlocks.first(where: { !unlocked.contains($0.id) }) else {
            throw XCTSkip("every test unlock is already earned: restart the fixture")
        }
        XCTAssertEqual(api("POST", "/api/me/achievements/events", body: ["events": [["type": next.event]]]).0, 200)
        XCUIDevice.shared.press(.home)
        Thread.sleep(forTimeInterval: 1.5)
        app.activate()
    }

    // MARK: Helpers

    private func waitGone(_ element: XCUIElement, timeout: TimeInterval) -> Bool {
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: element)
        return XCTWaiter().wait(for: [gone], timeout: timeout) == .completed
    }

    /// How many distinct colours a coarse sample of the screen holds below
    /// `below` (a fraction of the height, past the status bar and banner).
    /// A blank window over the app is one colour; the home is dozens.
    private func colours(_ screenshot: XCUIScreenshot, below: CGFloat) -> Int {
        guard let image = screenshot.image.cgImage else { return 0 }
        let width = 48, height = 96
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let drawn = pixels.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = CGContext(data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8,
                                          bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            context.interpolationQuality = .none
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        guard drawn else { return 0 }
        // Rows run top down in memory; skip the top `below` of the screen.
        let firstRow = Int(CGFloat(height) * below)
        var seen = Set<UInt32>()
        for row in firstRow..<height {
            for column in 0..<width {
                let i = (row * width + column) * 4
                // Coarse buckets: anti-aliasing alone does not count.
                seen.insert(UInt32(pixels[i] >> 3) << 10 | UInt32(pixels[i + 1] >> 3) << 5 | UInt32(pixels[i + 2] >> 3))
            }
        }
        return seen.count
    }

    @MainActor
    @discardableResult
    private func shot(_ app: XCUIApplication, _ name: String) -> XCUIScreenshot {
        let screenshot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = ProcessInfo.processInfo.environment["ACHIEVEMENT_SHOTS"], !dir.isEmpty {
            try? screenshot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
        }
        return screenshot
    }

    @discardableResult
    private func api(_ method: String, _ path: String, body: [String: Any]? = nil) -> (Int, [String: Any]) {
        var request = URLRequest(url: URL(string: endpoint + path)!, timeoutInterval: 60)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        let done = DispatchSemaphore(value: 0)
        var result: (Int, [String: Any]) = (0, [:])
        URLSession.shared.dataTask(with: request) { data, response, _ in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
            result = (status, json)
            done.signal()
        }.resume()
        _ = done.wait(timeout: .now() + 70)
        return result
    }
}
