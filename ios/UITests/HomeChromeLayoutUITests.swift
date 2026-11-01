import XCTest

/// The home's chrome in demo mode. The Updates pill, once its switch is on,
/// is anchored to the bottom safe area and never moves: not with "Search and
/// + at top", not while the list scrolls, not under Settings, Search, +, New
/// bot or New group (open, or closing), not with the keyboard up, not after a
/// thread, a rotation, the background or a large text size (owner, 2026-10-15,
/// 2026-10-16). On an iPad the avatar sits in the top trailing corner, away
/// from the window controls. Set SAGAX_SHOTS_DIR
/// (TEST_RUNNER_SAGAX_SHOTS_DIR) to also write PNGs.
final class HomeChromeLayoutUITests: XCTestCase {
    private var isPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }

    /// The pill (52 pt) sits 8 pt above the bottom safe area (34 pt at most
    /// on a phone with a home indicator): its bottom edge is within this of
    /// the window's.
    private static let bottomSlack: CGFloat = 60

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
    }

    override func tearDown() {
        XCUIDevice.shared.orientation = .portrait
        super.tearDown()
    }

    private func launch(_ extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += [
            // no pairing left by an earlier run: the demo opens only on a
            // phone that is not paired, and a parity run of an older build
            // could leave one (a home with no bots)
            "-reset-pairings",
            "-demo", "-demo-clock", "1791000000", "-demo-skip-terms",
            "-companion.prefs.updatesButton", "YES",
        ] + extra
        app.launch()
        XCTAssertTrue(app.buttons["updates-button"].waitForExistence(timeout: 20), "demo home with the Updates pill")
        // the demo's "needs you" island covers the iPhone's top row
        let deny = app.buttons["Deny"].firstMatch
        if deny.waitForExistence(timeout: 3), deny.isHittable {
            deny.tap()
            sleep(1)
        }
        return app
    }

    private func save(_ name: String) {
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = ProcessInfo.processInfo.environment["SAGAX_SHOTS_DIR"] {
            let device = isPad ? "ipad" : "iphone"
            try? shot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(device)-\(name).png"))
        }
    }

    private func pill(_ app: XCUIApplication) -> XCUIElement { app.buttons["updates-button"] }

    /// The pill's frame when it shows, nil when an overlay hides it.
    private func visiblePillFrame(_ app: XCUIApplication) -> CGRect? {
        let pill = pill(app)
        guard pill.exists else { return nil }
        let frame = pill.frame
        return frame.isEmpty ? nil : frame
    }

    /// The pill shows and touches the bottom of the window; returns its frame.
    @discardableResult
    private func assertPillAtBottom(_ app: XCUIApplication, _ context: String, file: StaticString = #filePath, line: UInt = #line) -> CGRect {
        XCTAssertTrue(pill(app).waitForExistence(timeout: 10), "\(context): the Updates pill shows", file: file, line: line)
        let frame = pill(app).frame
        let window = app.windows.firstMatch.frame
        XCTAssertGreaterThanOrEqual(frame.maxY, window.maxY - Self.bottomSlack, "\(context): the Updates pill left the bottom (\(frame) in \(window))", file: file, line: line)
        XCTAssertLessThanOrEqual(frame.maxY, window.maxY, "\(context): the Updates pill fell off the window", file: file, line: line)
        XCTAssertGreaterThanOrEqual(frame.minY, window.maxY - Self.bottomSlack - 52, "\(context): the Updates pill grew upward", file: file, line: line)
        return frame
    }

    /// Wherever the pill shows (an overlay may hide it), it is exactly where
    /// it was.
    private func assertPillUnmoved(_ app: XCUIApplication, from reference: CGRect, _ context: String, file: StaticString = #filePath, line: UInt = #line) {
        guard let frame = visiblePillFrame(app) else { return }
        XCTAssertEqual(frame.minY, reference.minY, accuracy: 1, "\(context): the Updates pill moved (\(frame) vs \(reference))", file: file, line: line)
        XCTAssertEqual(frame.minX, reference.minX, accuracy: 1, "\(context): the Updates pill moved sideways", file: file, line: line)
        XCTAssertEqual(frame.height, reference.height, accuracy: 1, "\(context): the Updates pill changed height", file: file, line: line)
    }

    /// Samples the pill for about a second (an overlay closing, a thread
    /// popping): it never shows anywhere but its place.
    private func assertPillStillDuringAnimation(_ app: XCUIApplication, from reference: CGRect, _ context: String, file: StaticString = #filePath, line: UInt = #line) {
        let end = Date().addingTimeInterval(1.2)
        var samples = 0
        while Date() < end {
            assertPillUnmoved(app, from: reference, "\(context) (sample \(samples))", file: file, line: line)
            samples += 1
        }
        sleep(1)
        let settled = assertPillAtBottom(app, "\(context), settled", file: file, line: line)
        XCTAssertEqual(settled.minY, reference.minY, accuracy: 1, "\(context): the pill came back elsewhere", file: file, line: line)
    }

    private func tapClose(_ app: XCUIApplication) {
        let closes = app.buttons.matching(NSPredicate(format: "label == 'Close'"))
        XCTAssertTrue(closes.firstMatch.waitForExistence(timeout: 5), "a Close button")
        let all = closes.allElementsBoundByIndex
        // the top-most sheet's button; with the keyboard up, XCUITest may
        // call it not hittable, so tap its centre instead
        let close = all.last { $0.isHittable } ?? all.last!
        close.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
    }

    /// The + menu's entry: by its identifier, or its title where the
    /// system menu (iPad) drops the identifier; a tap that lands while the
    /// home is still settling is retried once.
    private func openPlusEntry(_ app: XCUIApplication, id: String, title: String) -> XCUIElement {
        let entry = app.descendants(matching: .any).matching(NSPredicate(format: "identifier == %@ OR label == %@", id, title)).firstMatch
        let plus = app.buttons["home-plus"]
        let attempts: [() -> Void] = [
            { plus.tap() },
            { plus.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap() },
            { plus.press(forDuration: 0.4) },
        ]
        for attempt in attempts {
            attempt()
            if entry.waitForExistence(timeout: 5) { return entry }
        }
        XCTFail("the + menu shows \(title)")
        return entry
    }

    // MARK: - Home

    @MainActor
    func testTheAvatarSitsInTheRightCornerOnAnIPad() {
        let app = launch()
        let account = app.buttons["home-account"]
        XCTAssertTrue(account.waitForExistence(timeout: 10))
        let window = app.windows.firstMatch.frame
        if isPad {
            XCTAssertGreaterThan(account.frame.midX, window.midX, "iPad: avatar on the trailing side")
        } else {
            XCTAssertLessThan(account.frame.midX, window.midX, "iPhone: avatar stays leading")
        }
        XCTAssertLessThan(account.frame.midY, window.midY, "avatar at the top")
        assertPillAtBottom(app, "home")
        save("home")
    }

    /// The regression the owner saw: "Search and + at top" carried the pill to the
    /// header. Search and + go up; the pill stays down.
    @MainActor
    func testSearchAndPlusAtTopAddNoSpaceAboveThePinnedBots() {
        // search and + share the account row: the pinned bots start where
        // they do with the chrome at the bottom (no empty band, 0.5.9)
        let pinnedTop: ([String]) -> CGFloat = { extra in
            let app = self.launch(extra)
            let pinned = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "pinned.")).firstMatch
            XCTAssertTrue(pinned.waitForExistence(timeout: 10), "a pinned bot")
            let y = pinned.frame.minY
            app.terminate()
            return y
        }
        let atBottom = pinnedTop([])
        let atTop = pinnedTop(["-companion.prefs.rosterChromeAtTop", "YES"])
        XCTAssertEqual(atTop, atBottom, accuracy: 2, "same top for the pinned bots")
    }

    func testThePillStaysAtTheBottomWithSearchAndPlusAtTop() {
        let app = launch(["-companion.prefs.rosterChromeAtTop", "YES"])
        let reference = assertPillAtBottom(app, "chrome at top")
        let search = app.buttons["home-search"].firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        if !isPad {
            // the switch is honoured on the iPhone: search sits above the pill
            XCTAssertLessThan(search.frame.maxY, reference.minY, "search at the top, the pill under it")
            XCTAssertLessThan(search.frame.midY, app.windows.firstMatch.frame.midY, "search at the top")
        }
        save("chrome-at-top")
        search.tap()
        sleep(2)
        assertPillUnmoved(app, from: reference, "chrome at top, search open")
        tapClose(app)
        assertPillStillDuringAnimation(app, from: reference, "chrome at top, search closing")
    }

    @MainActor
    func testThePillDoesNotMoveWhileTheListScrolls() {
        let app = launch()
        let reference = assertPillAtBottom(app, "home")
        let list = app.scrollViews["roster-list"].firstMatch
        XCTAssertTrue(list.waitForExistence(timeout: 5))
        list.swipeUp()
        assertPillUnmoved(app, from: reference, "scrolled down")
        list.swipeUp()
        save("scrolled")
        assertPillUnmoved(app, from: reference, "scrolled to the end")
        list.swipeDown()
        list.swipeDown()
        list.swipeDown()
        assertPillUnmoved(app, from: reference, "back at the top")
        assertPillAtBottom(app, "back at the top")
    }

    // MARK: - Overlays

    @MainActor
    func testThePillStaysAtTheBottomUnderSearch() {
        let app = launch()
        let reference = assertPillAtBottom(app, "home")
        app.buttons["home-search"].firstMatch.tap()
        XCTAssertTrue(app.descendants(matching: .any)["search-sheet"].firstMatch.waitForExistence(timeout: 5))
        sleep(2)
        save("search")
        assertPillUnmoved(app, from: reference, "search open")
        // the field is focused: type so the keyboard (if any) is up
        let field = app.textFields["search-field"].firstMatch
        if field.waitForExistence(timeout: 3) { field.typeText("ow") }
        sleep(1)
        save("search-keyboard")
        assertPillUnmoved(app, from: reference, "search with the keyboard")
        tapClose(app)
        assertPillStillDuringAnimation(app, from: reference, "search closing")
    }

    @MainActor
    func testThePillStaysAtTheBottomUnderSettings() {
        let app = launch()
        let reference = assertPillAtBottom(app, "home")
        app.buttons["home-apps"].tap()
        let settings = app.buttons["account-menu.settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 5))
        settings.tap()
        XCTAssertTrue(app.descendants(matching: .any)["settings-appearance"].waitForExistence(timeout: 10))
        sleep(2)
        save("settings")
        assertPillUnmoved(app, from: reference, "settings")
        app.descendants(matching: .any)["settings-close"].firstMatch.tap()
        assertPillStillDuringAnimation(app, from: reference, "settings closing")
    }

    @MainActor
    func testThePillStaysAtTheBottomUnderPlusAndNewBot() {
        let app = launch()
        let reference = assertPillAtBottom(app, "home")
        let newBot = openPlusEntry(app, id: "plus-menu.new-bot", title: "Create new Bot")
        save("plus")
        assertPillUnmoved(app, from: reference, "plus menu")
        newBot.tap()
        XCTAssertTrue(app.descendants(matching: .any)["create-bot-sheet"].firstMatch.waitForExistence(timeout: 5))
        sleep(2)
        save("new-bot")
        assertPillUnmoved(app, from: reference, "new bot with its field focused")
        tapClose(app)
        assertPillStillDuringAnimation(app, from: reference, "new bot closing")
    }

    @MainActor
    func testThePillStaysAtTheBottomUnderNewGroup() {
        let app = launch()
        let reference = assertPillAtBottom(app, "home")
        let newGroup = openPlusEntry(app, id: "plus-menu.new-group", title: "Create group chat")
        newGroup.tap()
        XCTAssertTrue(app.descendants(matching: .any)["new-group-sheet"].firstMatch.waitForExistence(timeout: 5))
        sleep(2)
        save("new-group")
        assertPillUnmoved(app, from: reference, "new group")
        tapClose(app)
        assertPillStillDuringAnimation(app, from: reference, "new group closing")
    }

    // MARK: - Navigation and system

    @MainActor
    func testThePillComesBackInPlaceFromAThread() {
        let app = launch()
        let reference = assertPillAtBottom(app, "home")
        let pinned = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'pinned.' OR identifier BEGINSWITH 'chat-row.'")).firstMatch
        XCTAssertTrue(pinned.waitForExistence(timeout: 10), "a bot to open")
        pinned.tap()
        let back = app.buttons["Back"].firstMatch
        XCTAssertTrue(back.waitForExistence(timeout: 10), "the thread opened")
        back.tap()
        assertPillStillDuringAnimation(app, from: reference, "back from a thread")
    }

    @MainActor
    func testThePillComesBackInPlaceFromTheBackground() {
        let app = launch()
        let reference = assertPillAtBottom(app, "home")
        XCUIDevice.shared.press(.home)
        sleep(2)
        app.activate()
        XCTAssertTrue(pill(app).waitForExistence(timeout: 10))
        assertPillStillDuringAnimation(app, from: reference, "back from the background")
    }

    @MainActor
    func testThePillStaysAtTheBottomAcrossARotation() {
        let app = launch()
        let reference = assertPillAtBottom(app, "portrait")
        XCUIDevice.shared.orientation = .landscapeLeft
        sleep(2)
        // a wide iPad turns into the desktop shell, which has no pill
        if visiblePillFrame(app) != nil {
            assertPillAtBottom(app, "landscape")
            save("landscape")
        }
        XCUIDevice.shared.orientation = .portrait
        sleep(2)
        let back = assertPillAtBottom(app, "portrait again")
        XCTAssertEqual(back.minY, reference.minY, accuracy: 1, "the pill came back elsewhere after the rotation")
    }

    @MainActor
    func testThePillStaysAtTheBottomWithLargeText() {
        let app = launch(["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXL"])
        assertPillAtBottom(app, "large text")
        save("large-text")
    }
}
