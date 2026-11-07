import XCTest

/// The person's own photo on an organization server: their Perspicax avatar,
/// read by the phone from the Sagax server it is paired with (never from
/// Perspicax), in the home's top-left button, the Settings account card,
/// Account and its Switch Account row.
///
/// Start the organization fixture (a fake Perspicax whose avatar for the
/// person is one solid colour) and pass its session to the test runner:
///
///   PARITY_ORG=avatar node ios/parity/fixture-server.mjs &
///   TEST_RUNNER_PARITY_ORG=avatar TEST_RUNNER_PARITY_ENDPOINT=... \
///   TEST_RUNNER_PARITY_TOKEN=... TEST_RUNNER_PARITY_ENVIRONMENT=... \
///   TEST_RUNNER_PARITY_AVATAR_RGB=236,18,196 xcodebuild test \
///     -only-testing:SagaxUITests/OrgAvatarUITests ...
///
/// The personal computer whose desktop app is signed in to an organization
/// runs the same test through the companion sidecar (its server holds the
/// owner identity the desktop handed it; no environment id):
///
///   PARITY_OWNER=1 node ios/parity/fixture-server.mjs &
///   TEST_RUNNER_PARITY_OWNER=1 TEST_RUNNER_PARITY_ENDPOINT=<sidecar> \
///   TEST_RUNNER_PARITY_TOKEN=<device token> \
///   TEST_RUNNER_PARITY_AVATAR_RGB=236,18,196 xcodebuild test ...
///
/// Without those variables the tests skip.
final class OrgAvatarUITests: XCTestCase {
    private var arguments: [String] = []
    private var avatar: (r: Int, g: Int, b: Int) = (0, 0, 0)

    override func setUpWithError() throws {
        continueAfterFailure = false
        // phone shell only: home-account, the Settings card and Account are the phone's; the iPad runs the desktop shell
        try XCTSkipIf(UIDevice.current.userInterfaceIdiom == .pad, "the phone's home, Settings and Account; the iPad runs the desktop shell")
        let env = ProcessInfo.processInfo.environment
        guard env["PARITY_ORG"] == "avatar" || env["PARITY_OWNER"] == "1", let endpoint = env["PARITY_ENDPOINT"], let token = env["PARITY_TOKEN"],
              let rgb = env["PARITY_AVATAR_RGB"]?.split(separator: ",").compactMap({ Int($0) }), rgb.count == 3
        else {
            throw XCTSkip("no avatar fixture: set TEST_RUNNER_PARITY_ORG=avatar (or _OWNER=1), _ENDPOINT, _TOKEN and _AVATAR_RGB")
        }
        avatar = (rgb[0], rgb[1], rgb[2])
        arguments = ["-parityEndpoint", endpoint, "-parityToken", token, "-parityScreen", "01-home"]
        if let environment = env["PARITY_ENVIRONMENT"], !environment.isEmpty {
            arguments += ["-parityEnvironment", environment]
        }
    }

    @MainActor
    func testThePersonsPerspicaxAvatarShowsEverywhereTheirPhotoDoes() {
        let app = XCUIApplication()
        app.terminate()
        app.launchArguments = arguments
        app.launch()

        // Home, top left.
        let home = app.buttons["home-account"]
        XCTAssertTrue(home.waitForExistence(timeout: 30))
        XCTAssertTrue(waitForPhoto(home), "the home shows no photo")
        assertShowsAvatar(home, "home")
        let center = pixel(of: home, atX: 0.5, y: 0.5)
        XCTAssertTrue(matches(center), "the home photo's centre is \(center), not the Perspicax avatar")

        // Settings, the account card.
        home.tap()
        let card = app.buttons["settings-account"]
        XCTAssertTrue(card.waitForExistence(timeout: 10))
        XCTAssertTrue(waitForPhoto(card), "the Settings account card shows no photo")
        assertShowsAvatar(card, "the Settings account card")

        // Account, and its Switch Account row for this connection.
        card.tap()
        let account = app.descendants(matching: .any)["account-card"].firstMatch
        XCTAssertTrue(account.waitForExistence(timeout: 10))
        XCTAssertTrue(waitForPhoto(account), "Account shows no photo")
        assertShowsAvatar(account, "Account")
        let row = app.buttons["account-switch.parity-harness"]
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        XCTAssertTrue(waitForPhoto(row), "the Switch Account row shows no photo")
        assertShowsAvatar(row, "the Switch Account row")
    }

    // MARK: Pixels

    private func waitForPhoto(_ element: XCUIElement, timeout: TimeInterval = 20) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == 'photo'"), object: element)
        return XCTWaiter().wait(for: [expectation], timeout: timeout) == .completed
    }

    /// The avatar's colour covers a real part of the element: not a stray
    /// pixel of a mascot or a tint, the picture itself.
    private func assertShowsAvatar(_ element: XCUIElement, _ place: String, file: StaticString = #filePath, line: UInt = #line) {
        let (pixels, width, height) = rgba(element.screenshot().image)
        var hits = 0
        for index in stride(from: 0, to: width * height * 4, by: 4)
        where matches((Int(pixels[index]), Int(pixels[index + 1]), Int(pixels[index + 2]))) {
            hits += 1
        }
        // A 28 pt photo in a 44 pt row is the smallest: well over 1 % of it.
        let share = Double(hits) / Double(max(width * height, 1))
        XCTAssertGreaterThan(share, 0.01, "\(place) shows \(hits) pixels of the Perspicax avatar's colour", file: file, line: line)
    }

    private func pixel(of element: XCUIElement, atX x: Double, y: Double) -> (Int, Int, Int) {
        let (pixels, width, height) = rgba(element.screenshot().image)
        let px = min(width - 1, Int(Double(width) * x)), py = min(height - 1, Int(Double(height) * y))
        let index = (py * width + px) * 4
        return (Int(pixels[index]), Int(pixels[index + 1]), Int(pixels[index + 2]))
    }

    private func matches(_ color: (Int, Int, Int)) -> Bool {
        abs(color.0 - avatar.r) <= 28 && abs(color.1 - avatar.g) <= 28 && abs(color.2 - avatar.b) <= 28
    }

    /// The screenshot as sRGB RGBA8 bytes.
    private func rgba(_ image: UIImage) -> ([UInt8], Int, Int) {
        guard let cgImage = image.cgImage else { return ([], 0, 0) }
        let width = cgImage.width, height = cgImage.height
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let space = CGColorSpace(name: CGColorSpace.sRGB)!
        pixels.withUnsafeMutableBytes { buffer in
            guard let context = CGContext(
                data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ) else { return }
            context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
        }
        return (pixels, width, height)
    }
}
