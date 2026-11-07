import XCTest

/// Rich content in bot replies (WP14, feature parity matrix rows CA16, CA21,
/// CA23-CA28, ST4) against the parity fixture's rich lab
/// (`PARITY_RICH=1 node ios/parity/fixture-server.mjs`, ios/parity/rich-lab.mjs):
/// code block actions, table CSV / Markdown / sort / filter, CSV fences,
/// charts, mermaid, the email card, callouts, spoilers, footnotes, pictures,
/// the turn's paid-with line and the run card.
///
/// What a copy put on the clipboard is read from the "Copied" badge's
/// accessibility value (DEBUG builds only), so no paste prompt gets in the way.
/// The session comes from TEST_RUNNER_PARITY_ENDPOINT / _TOKEN / _ENVIRONMENT
/// or `ios/parity/out/session.json`; without the rich lab the tests are skipped.
final class RichContentUITests: XCTestCase {
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
    private func launch(_ extra: [String] = []) throws -> XCUIApplication {
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
            "-companion.prefs.activityDetail", "full",
            "-companion.prefs.showRunCard", "YES",
        ] + extra
        if let environment = fixture.environmentId { arguments += ["-parityEnvironment", environment] }
        app.launchArguments = arguments
        app.launch()
        // the iPad draws the conversation in the desktop shell, without the phone's title button
        if UIDevice.current.userInterfaceIdiom == .pad {
            XCTAssertTrue(element(app, "desktop-chat-pill").waitForExistence(timeout: 45), "the iPad's desktop chat")
            // the fixture's workspace never finished the desktop's guided first run: skip it as a
            // person would (it saves the completion, so the next launch opens straight on the chat)
            let skip = element(app, "first-run-skip")
            if skip.waitForExistence(timeout: 5) {
                skip.tap()
                XCTAssertFalse(element(app, "desktop-first-run").waitForExistence(timeout: 2), "the first run closed")
            }
        } else {
            XCTAssertTrue(app.buttons["chat-name"].waitForExistence(timeout: 30))
        }
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    /// The desktop's Settings > Appearance > Tool calls, on the server.
    private func setShowToolCalls(_ fixture: FixtureSession, _ on: Bool) throws {
        var request = URLRequest(url: try XCTUnwrap(URL(string: fixture.endpoint + "/api/config")))
        request.httpMethod = "PATCH"
        request.setValue("Bearer \(fixture.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["features": ["showToolCalls": on]])
        let done = expectation(description: "PATCH /api/config")
        var status = 0
        URLSession.shared.dataTask(with: request) { _, response, _ in
            status = (response as? HTTPURLResponse)?.statusCode ?? 0
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 30)
        XCTAssertTrue((200...299).contains(status), "PATCH /api/config showToolCalls -> \(status)")
    }

    /// Scroll the transcript back until the element is on screen.
    @MainActor
    @discardableResult
    private func reveal(_ app: XCUIApplication, _ id: String, file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        let target = element(app, id)
        _ = target.waitForExistence(timeout: 3)
        let window = app.windows.firstMatch.frame
        // the visible transcript band: under the top bar, over the composer
        let top = window.minY + 110
        let bottom = window.maxY - 160
        // the transcript opens at its end, so a missing row is usually above; once a swipe
        // moves nothing the top is reached and the row lies below, not built yet by the lazy
        // stack (the iPad's charts sit under the CSV the test reveals first)
        var older = true
        for _ in 0..<60 {
            guard target.exists else {
                let before = older ? app.windows.firstMatch.screenshot().pngRepresentation : Data()
                if older { app.swipeDown(velocity: .slow) } else { app.swipeUp(velocity: .slow) }
                if older, app.windows.firstMatch.screenshot().pngRepresentation == before { older = false }
                continue
            }
            let frame = target.frame
            // the band first: the iPad's desktop transcript keeps far-off rows in the tree, and
            // asking one of those whether it is hittable fails the test ("Activation point invalid")
            let inBand = frame.minY >= top - 10 && (frame.maxY <= bottom || frame.height > bottom - top)
            if inBand && target.isHittable {
                // the transcript may still jump to its end right after the
                // launch: only a frame that holds still is on screen
                Thread.sleep(forTimeInterval: 0.6)
                if target.exists && target.frame == frame { return target }
                continue
            }
            // drag the element toward the band's middle, a bounded step at a
            // time and held at the end so nothing flings past it
            let delta = max(-260, min(260, (top + bottom) / 2 - frame.midY))
            let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            let end = start.withOffset(CGVector(dx: 0, dy: delta))
            start.press(forDuration: 0.1, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.2)
        }
        XCTAssertTrue(target.exists && target.isHittable, "\(id) on screen", file: file, line: line)
        return target
    }

    @MainActor
    private func copied(_ app: XCUIApplication, _ id: String) -> String {
        // the badge says "Copied" for a moment; its clipboard probe stays
        let probe = element(app, "\(id)-clipboard")
        XCTAssertTrue(probe.waitForExistence(timeout: 5), "\(id): a copy happened")
        return probe.value as? String ?? ""
    }

    @MainActor
    private func menu(_ app: XCUIApplication, on target: XCUIElement, choose title: String) {
        // the block may hold a button of the same name (the phone's code block "Copy code", the
        // iPad's desktop table "Copy as CSV" / "Copy as Markdown"): the menu's item is the one
        // that is not inside the block, measured after the press since the menu's preview moves it
        target.press(forDuration: 1.2)
        let all = app.buttons.matching(identifier: title)
        XCTAssertTrue(all.firstMatch.waitForExistence(timeout: 5), "\(title) in the long-press menu")
        let inBlock = Set(target.buttons.matching(identifier: title).allElementsBoundByIndex.map { "\($0.frame)" })
        // outside the block, and the menu's row itself (its label is the title; the row's
        // symbol may answer to the same name with its image's label)
        let outside = all.allElementsBoundByIndex.filter { !inBlock.contains("\($0.frame)") }
        let item = outside.first { $0.label == title } ?? outside.first ?? all.firstMatch
        XCTAssertTrue(item.exists, "\(title) in the long-press menu")
        item.tap()
    }

    // MARK: - CA21 code block

    @MainActor
    func testCodeBlockFoldsCopiesWrapsAndSaves() throws {
        // the phone's block (fold + long-press menu); the iPad draws the desktop's block, a
        // toolbar with Wrap, Save and Copy and no fold button (CodeBlockView.desktopBody)
        try XCTSkipIf(UIDevice.current.userInterfaceIdiom == .pad, "the phone's code block; the iPad draws the desktop's toolbar block")
        let app = try launch()
        let id = "message-rich-code-rich-1"
        let fold = reveal(app, "\(id)-fold")
        XCTAssertTrue(fold.label.contains("Show all 36 lines"), fold.label)
        fold.tap()
        XCTAssertTrue(element(app, "\(id)-fold").label.contains("Collapse"))
        let block = reveal(app, id)
        menu(app, on: block, choose: "Copy code")
        let text = copied(app, "\(id)-copied")
        XCTAssertTrue(text.hasPrefix("print(\"ligne 1\")"), text)
        XCTAssertTrue(text.hasSuffix("print(\"ligne 36\")"), text)
        menu(app, on: reveal(app, id), choose: "Wrap long lines")
        reveal(app, id).press(forDuration: 1.2)
        XCTAssertTrue(app.buttons["Disable line wrapping"].waitForExistence(timeout: 5), "wrapped: the menu offers to unwrap")
        app.buttons["Save as file"].tap()
        let share = app.otherElements["ActivityListView"]
        XCTAssertTrue(share.waitForExistence(timeout: 10), "Save opens the share sheet with the snippet file")
        attach("Code block saved through the share sheet", app)
    }

    // MARK: - CA23 tables and CSV fences

    @MainActor
    func testTableCopiesSortsAndFilters() throws {
        let app = try launch()
        let id = "message-rich-table-rich-1"
        let table = reveal(app, id)
        menu(app, on: table, choose: "Copy as CSV")
        let csv = copied(app, "\(id)-copied")
        XCTAssertTrue(csv.hasPrefix("Poste,Montant,Note\r\nLoyer,1200,a\r\n"), csv)
        // sort by Montant: numeric, ascending
        menu(app, on: reveal(app, id), choose: "Sort by Montant")
        XCTAssertEqual(element(app, "message-rich-table-scroll-cell-1-0").label, "Divers")
        menu(app, on: reveal(app, id), choose: "Copy as Markdown")
        let markdown = copied(app, "\(id)-copied")
        XCTAssertTrue(markdown.hasPrefix("| Poste | Montant | Note |\n| --- | --- | :---: |\n| Divers | 15 | i |"), markdown)
        // nine rows: the filter is offered
        menu(app, on: reveal(app, id), choose: "Filter rows")
        let field = app.alerts.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.typeText("Lo")
        app.alerts.buttons["Filter"].tap()
        let filtered = element(app, "\(id)-filtered")
        XCTAssertTrue(filtered.waitForExistence(timeout: 5))
        XCTAssertTrue(filtered.label.contains("2 of 9 rows"), filtered.label)
        element(app, "\(id)-clear-filter").tap()
        XCTAssertFalse(element(app, "\(id)-filtered").exists)
        attach("Table sorted by amount", app)
    }

    @MainActor
    func testCSVFenceIsATable() throws {
        let app = try launch()
        let id = "message-rich-csv-rich-1"
        let table = reveal(app, id)
        XCTAssertTrue(table.staticTexts["Nord"].exists || element(app, id).descendants(matching: .any)["Nord"].exists)
        menu(app, on: table, choose: "Copy as CSV")
        XCTAssertEqual(copied(app, "\(id)-copied"), "région,ventes,coût\r\nNord,120,80\r\nSud,95,70\r\nEst,140,\"1,100\"")
    }

    // MARK: - CA24 charts

    @MainActor
    func testChartsDrawAndShowTheirNumbers() throws {
        let app = try launch()
        let id = "message-rich-chart-rich-1"
        reveal(app, "\(id)-plot")
        XCTAssertTrue(app.staticTexts["Ventes par trimestre"].exists)
        reveal(app, "\(id)-table-toggle").tap()
        XCTAssertTrue(element(app, "\(id)-table").waitForExistence(timeout: 5), "the table view of the same numbers")
        reveal(app, "\(id)-source-toggle").tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "type: bar")).firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(reveal(app, "message-rich-chart-rich-2-plot").exists, "the donut")
        attach("Charts", app)
    }

    // MARK: - CA25 mermaid

    @MainActor
    func testMermaidDrawsOfflineOpensFullScreenAndCopies() throws {
        let app = try launch()
        let id = "message-rich-mermaid-rich-1"
        reveal(app, id)
        XCTAssertTrue(app.staticTexts["Mermaid diagram"].exists)
        // drawn by the bundled mermaid, fitted to the column
        let diagram = element(app, "\(id)-diagram")
        XCTAssertTrue(diagram.waitForExistence(timeout: 45), "the diagram is drawn")
        let column = element(app, id).frame
        XCTAssertGreaterThan(diagram.frame.height, 40)
        XCTAssertLessThanOrEqual(diagram.frame.width, column.width)
        XCTAssertLessThanOrEqual(diagram.frame.height, app.windows.firstMatch.frame.height * 0.6 + 1)
        attach("Mermaid", app)
        reveal(app, "\(id)-diagram").tap()
        XCTAssertTrue(app.buttons["mermaid-fullscreen-close"].waitForExistence(timeout: 5))
        Thread.sleep(forTimeInterval: 1.5)
        attach("Mermaid full screen", app)
        app.buttons["mermaid-fullscreen-close"].tap()
        reveal(app, "\(id)-copy").tap()
        let value = element(app, "\(id)-copy").value as? String ?? ""
        XCTAssertTrue(value.hasPrefix("graph TD"), value)
    }

    // MARK: - CA26 email card

    @MainActor
    func testEmailCardCopiesTheDraft() throws {
        let app = try launch()
        let id = "message-rich-email-rich-1"
        reveal(app, id)
        XCTAssertTrue(app.staticTexts["Renouvellement T3"].exists)
        reveal(app, "\(id)-copy").tap()
        let plain = element(app, "\(id)-copy").value as? String ?? ""
        XCTAssertTrue(plain.hasPrefix("To: Ana <ana@example.com>, bo@example.com\nCc: sam@example.com\nSubject: Renouvellement T3\n\nBonjour Ana,"), plain)
        XCTAssertTrue(plain.contains("Merci pour l'appel."), "Markdown stripped: \(plain)")
        reveal(app, "\(id)-copy-rich").tap()
        let body = element(app, "\(id)-copy-rich").value as? String ?? ""
        XCTAssertTrue(body.hasPrefix("Bonjour Ana,"), body)
        XCTAssertTrue(element(app, "\(id)-open").exists, "Open in mail app")
    }

    // MARK: - CA27 callouts, spoilers, footnotes

    @MainActor
    func testCalloutsSpoilersAndFootnotes() throws {
        let app = try launch()
        reveal(app, "message-rich-extras-rich-0")
        XCTAssertTrue(app.staticTexts["Attention requise"].exists, "the alert's own title")
        XCTAssertTrue(app.staticTexts["Tip"].exists, "the kind's word when no title is written")
        let spoiler = NSPredicate(format: "label CONTAINS %@", "quarante-deux")
        XCTAssertFalse(app.staticTexts.matching(spoiler).firstMatch.exists, "the spoiler starts hidden")
        let paragraph = reveal(app, "message-rich-extras-rich-2")
        let mask = paragraph.links.element(boundBy: 0)
        XCTAssertTrue(mask.waitForExistence(timeout: 5), "the hidden spoiler is a tappable chip")
        mask.tap()
        XCTAssertTrue(app.staticTexts.matching(spoiler).firstMatch.waitForExistence(timeout: 5), "revealed")
        // the mark's link holds the digit between a hair and an en space (MarkdownText.styleFootnotes)
        let note = element(app, "message-rich-extras-rich-2").links.matching(NSPredicate(format: "label MATCHES %@", "\\s*1\\s*")).firstMatch
        XCTAssertTrue(note.waitForExistence(timeout: 5), "the footnote mark")
        note.tap()
        let alert = app.alerts["Footnote 1"]
        XCTAssertTrue(alert.waitForExistence(timeout: 5))
        XCTAssertTrue(alert.staticTexts["Guide de remplacement, page 12."].exists)
        alert.buttons["OK"].tap()
        XCTAssertTrue(element(app, "footnote-1").exists, "the footnote section")
        attach("Callouts, spoiler and footnote", app)
    }

    // MARK: - CA28 pictures

    @MainActor
    func testPicturesInAReply() throws {
        let app = try launch()
        reveal(app, "message-rich-images-rich-1")
        XCTAssertTrue(reveal(app, "message-rich-images-rich-2-load").exists, "a web picture waits for Load image")
        XCTAssertTrue(app.staticTexts["External image hidden for privacy"].exists)
        let local = reveal(app, "message-rich-images-rich-3")
        XCTAssertTrue(local.buttons["Image: Échantillon"].waitForExistence(timeout: 10), "a computer path loads through the message's file route")
        let loaded = NSPredicate(format: "value == %@", "Loaded")
        expectation(for: loaded, evaluatedWith: local.buttons["Image: Échantillon"])
        waitForExpectations(timeout: 20)
        attach("Pictures", app)
    }

    // MARK: - #201: no Paid with

    @MainActor
    func testTheDigestNamesNoPayer() throws {
        // the turn's receipt shows under the server's Tool calls switch, as
        // on the desktop (MessagesListItem.tsx), off by default
        let fixture = try fixtureSession()
        try setShowToolCalls(fixture, true)
        addTeardownBlock { [weak self] in try? self?.setShowToolCalls(fixture, false) }
        let app = try launch(["-companion.prefs.showToolCalls", "YES"])
        let chip = reveal(app, "digest-chip-rich-digest")
        XCTAssertFalse(chip.label.contains("Paid with"), chip.label)
        chip.tap()
        XCTAssertTrue(app.navigationBars["What I did"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Paid with"].exists)
    }

    // MARK: - ST4 run card

    @MainActor
    func testRunCardListsTheRunAndDismisses() throws {
        let app = try launch()
        let card = element(app, "run-card")
        XCTAssertTrue(card.waitForExistence(timeout: 10))
        XCTAssertEqual(element(app, "run-card-summary").label, "3 steps · 2 verified · 1 failed")
        XCTAssertTrue(element(app, "run-step-rich-step-1").label.contains("doctor"))
        XCTAssertFalse(element(app, "run-step-rich-step-2").exists, "git status only looked")
        element(app, "run-card-toggle").tap()
        XCTAssertFalse(element(app, "run-step-rich-step-1").waitForExistence(timeout: 1), "collapsed")
        attach("Run card", app)
        element(app, "run-card-dismiss").tap()
        XCTAssertFalse(element(app, "run-card").waitForExistence(timeout: 2), "dismissed")
    }

    @MainActor
    func testRunCardFollowsTheSetting() throws {
        let app = try launch(["-companion.prefs.showRunCard", "NO"])
        XCTAssertTrue(element(app, "message-rich-digest").waitForExistence(timeout: 10) || app.scrollViews.firstMatch.exists)
        XCTAssertFalse(element(app, "run-card").waitForExistence(timeout: 3), "Settings > Appearance > This run off")
    }

    private func attach(_ name: String, _ app: XCUIApplication) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }
}
