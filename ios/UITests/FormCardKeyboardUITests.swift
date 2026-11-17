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
}
