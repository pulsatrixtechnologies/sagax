import XCTest

/// #4490: two forms waiting in one chat show one "Done" (inside the field that
/// holds the keyboard), and pressing it puts the keyboard away.
final class FormCardKeyboardUITests: XCTestCase {
    func testOneDoneForTwoPendingFormsAndItDismissesTheKeyboard() {
        let app = XCUIApplication()
        app.launchArguments = ["-store-preview", "-form-cards-preview", "-open-first", "-form-cards-until", "f-kinds",
                               "-companion.prefs.rosterDensity", "standard"]
        app.launch()
        let doneQuery = app.buttons.matching(identifier: "form-keyboard-done")
        let done = doneQuery.firstMatch
        let number = app.textFields["How many reviewers?"]
        XCTAssertTrue(number.waitForExistence(timeout: 20))
        XCTAssertEqual(doneQuery.count, 0)
        number.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(done.waitForExistence(timeout: 5))
        XCTAssertEqual(doneQuery.count, 1, "one Done, not one per form")
        done.tap()
        let gone = NSPredicate(format: "count == 0")
        expectation(for: gone, evaluatedWith: app.keyboards, handler: nil)
        waitForExpectations(timeout: 5)
        XCTAssertEqual(doneQuery.count, 0)
    }

    /// The focused row stays visible above the keyboard (the owner's rule for a
    /// form's last row). With FORM_CAPTURE_DIR set the screen is saved there.
    func testFocusedLastRowStaysAboveTheKeyboard() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-store-preview", "-form-cards-preview", "-open-first", "-form-cards-until", "f-kinds",
                               "-form-cards-alone", "-form-cards-fill", "-companion.prefs.rosterDensity", "standard",
                               "-paritySkin", "system"]
        app.launch()
        let field = app.textFields["Anything the reviewers should know?"]
        XCTAssertTrue(field.waitForExistence(timeout: 20))
        field.tap()
        let keyboard = app.keyboards.firstMatch
        try XCTSkipUnless(keyboard.waitForExistence(timeout: 5), "hardware keyboard connected: no software keyboard")
        sleep(2)
        XCTAssertTrue(field.isHittable, "the focused row is hidden")
        XCTAssertLessThanOrEqual(field.frame.maxY, keyboard.frame.minY, "the focused row is under the keyboard")
        if let dir = ProcessInfo.processInfo.environment["FORM_CAPTURE_DIR"] {
            try? app.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "\(dir)/keyboard-last-row.png"))
        }
    }
}
