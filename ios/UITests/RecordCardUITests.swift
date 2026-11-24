import XCTest

/// Record cards (#4572, lot S3) against the offline fixture
/// (`-record-cards-preview`: App/RecordCardPreview.json and
/// RecordCardPreviewData.json, an invented product "Nimbus Desk"). A chip in
/// the bot's text opens the card in a sheet; a record the card names pushes the
/// next card in that sheet; Back returns; a record whose product the person
/// does not hold is plain words.
final class RecordCardUITests: XCTestCase {
    @MainActor
    private func launch(_ language: String = "en") -> XCUIApplication {
        // RECORD_CARD_ARGS: more launch arguments for a capture ("-paritySkin system" wears the simulator's appearance)
        if ProcessInfo.processInfo.environment["RECORD_CARD_LANDSCAPE"] == "1" { XCUIDevice.shared.orientation = .landscapeLeft }
        let more = (ProcessInfo.processInfo.environment["RECORD_CARD_ARGS"] ?? "").split(separator: " ").map(String.init)
        let app = ThreadPreview.launch(["-record-cards-preview", "-AppleLanguages", "(\(language))", "-AppleLocale", language == "fr" ? "fr_CA" : "en_US"] + more)
        ThreadPreview.openPepper(in: app)
        return app
    }

    /// The iPad's shell lists the bots in its sidebar: open Pepper from there when the row is on screen.
    @MainActor
    private func launchOnIPad(_ language: String) -> XCUIApplication {
        XCUIDevice.shared.orientation = .landscapeLeft
        let more = (ProcessInfo.processInfo.environment["RECORD_CARD_ARGS"] ?? "").split(separator: " ").map(String.init)
        let app = XCUIApplication()
        app.terminate()
        app.launchArguments = [
            "-store-preview", "-threads-preview", "-record-cards-preview",
            "-AppleLanguages", "(\(language))", "-AppleLocale", language == "fr" ? "fr_CA" : "en_US",
            "-companion.onboarding.welcomeSeen", "YES", "-companion.onboarding.notificationsSeen", "YES",
        ] + more
        app.launch()
        let row = ThreadPreview.row(app)
        if row.waitForExistence(timeout: 10) { row.tap() }
        record("0-launch", app)
        return app
    }

    /// The bot's reply is one text whose first words are the first chip.
    @MainActor
    private func firstChip(_ app: XCUIApplication) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "BILL-20417")).firstMatch
    }

    /// The chip is the link itself (the same tap RichContentUITests uses), not a point in the text.
    @MainActor
    private func chipLink(_ app: XCUIApplication) -> XCUIElement {
        app.links["BILL-20417"].firstMatch
    }

    @MainActor
    private func tapFirstChip(_ app: XCUIApplication) {
        let link = chipLink(app)
        XCTAssertTrue(link.waitForExistence(timeout: 10), "the bill chip is a link")
        link.tap()
    }

    @MainActor
    private func record(_ name: String, _ app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    func testAChipOpensItsCardAndARefRowPushesTheNextOneAndBackReturns() {
        let app = launch()
        let message = firstChip(app)
        XCTAssertTrue(message.waitForExistence(timeout: 10), "the bot's text with the bill's chip")
        record("Chat with record chips", app)
        tapFirstChip(app)
        let title = app.staticTexts["record-card-title"]
        XCTAssertTrue(title.waitForExistence(timeout: 10))
        XCTAssertEqual(title.label, "Acme Fabrication")
        record("Bill card", app)
        // the contract named on the bill pushes its card
        let contract = app.buttons["record-ref-contract-412"]
        XCTAssertTrue(contract.waitForExistence(timeout: 5))
        contract.tap()
        XCTAssertTrue(app.staticTexts["Managed services"].waitForExistence(timeout: 10))
        XCTAssertFalse(title.exists && title.label == "Acme Fabrication")
        record("Contract card pushed in the sheet", app)
        app.buttons["record-card-back"].tap()
        XCTAssertTrue(app.staticTexts["record-card-title"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.staticTexts["record-card-title"].label, "Acme Fabrication")
        // the company is another product's: plain words, never a row
        XCTAssertFalse(app.buttons["record-ref-company-19301"].exists)
        app.buttons["record-card-done"].tap()
        XCTAssertTrue(firstChip(app).waitForExistence(timeout: 5))
    }

    /// The captures of the card (`RECORD_CARD_CAPTURE=1`): the chat, the bill, its pushed
    /// contract, a compact card and the plain-words case, in the language and appearance
    /// the simulator and the launch ask for. Skipped in the normal run.
    @MainActor
    func testCaptures() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["RECORD_CARD_CAPTURE"] == "1", "captures only")
        let language = ProcessInfo.processInfo.environment["RECORD_CARD_LANGUAGE"] ?? "en"
        let app = ProcessInfo.processInfo.environment["RECORD_CARD_IPAD"] == "1" ? launchOnIPad(language) : launch(language)
        let message = firstChip(app)
        XCTAssertTrue(message.waitForExistence(timeout: 15))
        record("1-chat", app)
        tapFirstChip(app)
        sleep(2)
        record("1b-after-tap", app)
        XCTAssertTrue(app.staticTexts["record-card-title"].waitForExistence(timeout: 10))
        record("2-bill-medium", app)
        app.swipeUp()
        sleep(1)
        record("3-bill-scrolled", app)
        app.swipeUp()
        sleep(1)
        record("3b-bill-end", app)
        let contract = app.buttons["record-ref-contract-412"]
        for _ in 0..<3 where !contract.isHittable { app.scrollViews.firstMatch.swipeDown() }
        contract.tap()
        XCTAssertTrue(app.buttons["record-card-back"].waitForExistence(timeout: 10))
        sleep(1)
        record("4-contract-pushed", app)
    }

    /// Ask puts the record's link at the end of the composer, as on the desktop.
    @MainActor
    func testAskWritesTheRecordLinkIntoTheComposer() {
        let app = launch()
        XCTAssertTrue(firstChip(app).waitForExistence(timeout: 10))
        tapFirstChip(app)
        let ask = app.buttons["record-card-ask"]
        XCTAssertTrue(ask.waitForExistence(timeout: 10))
        ask.tap()
        let field = app.textFields["message-input"]
        let box = app.textViews["message-input"]
        let shown = field.waitForExistence(timeout: 5) ? field : box
        XCTAssertTrue(shown.waitForExistence(timeout: 5), "the composer is back")
        let value = (shown.value as? String) ?? ""
        XCTAssertTrue(value.contains("sagax://record/nimbus_desk/bill/88213"), value)
        record("Ask with the record link in the composer", app)
    }

    @MainActor
    func testACardInFrenchSpeaksFrench() {
        let app = launch("fr")
        let message = firstChip(app)
        XCTAssertTrue(message.waitForExistence(timeout: 10))
        tapFirstChip(app)
        XCTAssertTrue(app.staticTexts["record-card-title"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Entente"].exists || app.buttons["record-ref-contract-412"].exists)
        record("Facture", app)
    }
}
