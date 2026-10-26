import XCTest

final class GeneratedImageUITests: XCTestCase {
    @MainActor
    func testAgentImageLoadsAndOpensFullScreen() {
        let app = ThreadPreview.launch(["-images-preview"])
        ThreadPreview.openGmail(in: app)
        let image = app.buttons["Image: screenshot.png"]
        let appeared = image.waitForExistence(timeout: 5)
        record("Agent image in transcript", app)
        XCTAssertTrue(appeared)
        guard appeared else { return }
        let loaded = NSPredicate(format: "enabled == true AND value == %@", "Loaded")
        expectation(for: loaded, evaluatedWith: image)
        waitForExpectations(timeout: 10)
        image.tap()
        // full screen is the conversation's lightbox (FindQuoteLightboxUITests)
        let close = app.buttons["lightbox-close"]
        XCTAssertTrue(close.waitForExistence(timeout: 10))
        XCTAssertTrue(app.descendants(matching: .any)["lightbox-image"].waitForExistence(timeout: 10))
        record("Agent image full screen", app)
        close.tap()
        XCTAssertTrue(image.waitForExistence(timeout: 5))
    }

    @MainActor
    private func record(_ name: String, _ app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
