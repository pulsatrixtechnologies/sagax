import XCTest

/// Runs exclusively against the bundled RosterPreview fleet: a Chief of
/// Staff, a bot with three threads, one waiting on you, one working, groups
/// and named sections. No account, paired computer, or server is involved,
/// and the preview has no API client, so nothing can be sent anywhere.
final class RosterDensityUITests: XCTestCase {
    @MainActor
    func testCompactRoster() {
        let app = launchRoster(density: nil)
        let pepper = app.buttons["threads-toggle.roster-pepper"]
        XCTAssertTrue(pepper.waitForExistence(timeout: 10))
        XCTAssertEqual(pepper.value as? String, "Collapsed, 3 threads")
        // One line per bot: no last-message preview under the name.
        XCTAssertTrue(app.buttons["chat-row.roster-atlas"].exists)
        XCTAssertFalse(contains("Three reviews and one approval", in: app))
        // Groups are rows, made from the "+" on their title.
        XCTAssertTrue(app.buttons["chat-row.roster-general"].exists)
        XCTAssertTrue(app.buttons["new-group"].exists)
        // The Primary Bot wears the orange star right after its name.
        let star = app.buttons["chat-row.roster-atlas"].descendants(matching: .any)["primary-bot-badge"]
        XCTAssertTrue(star.exists)
        XCTAssertEqual(star.label, "Primary Bot")
        recordScreenshot("Compact roster by default", in: app)
    }

    /// #143, #210: with Threads location "In the chat header" (the default)
    /// nothing is listed under a bot row; the chat header reaches the
    /// threads. Settings > Appearance offers both places.
    @MainActor
    func testHeaderLocationListsNoThreadsUnderBotRows() {
        let app = launchRoster(density: "comfortable", location: "header")
        XCTAssertTrue(app.buttons["chat-row.roster-pepper"].waitForExistence(timeout: 10) || app.buttons.containing(.staticText, identifier: "Pepper").firstMatch.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["threads-toggle.roster-pepper"].exists)
        XCTAssertFalse(app.buttons["thread.roster-pepper-gmail"].exists)
        recordScreenshot("Threads in the chat header: nothing under a bot row", in: app)

        app.buttons["home-apps"].tap()
        let settings = app.buttons["account-menu.settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 5))
        settings.tap()
        let appearance = app.descendants(matching: .any)["settings-appearance"].firstMatch
        XCTAssertTrue(appearance.waitForExistence(timeout: 10))
        appearance.tap()
        let header = app.descendants(matching: .any)["settings.threadsLocation.header"].firstMatch
        for _ in 0..<12 where !header.exists || !header.isHittable { app.swipeUp() }
        XCTAssertTrue(header.exists)
        XCTAssertTrue(app.descendants(matching: .any)["settings.threadsLocation.sidebar"].firstMatch.exists)
        recordScreenshot("Settings > Appearance > Threads location", in: app)
    }

    @MainActor
    func testSingleThreadBotHasNoThreadsRowAndStillStartsAThread() {
        let app = launchRoster(density: nil)
        let atlas = app.buttons["chat-row.roster-atlas"]
        XCTAssertTrue(atlas.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["threads-toggle.roster-atlas"].exists)
        XCTAssertFalse(app.buttons["threads-toggle.roster-scout"].exists)
        XCTAssertFalse(app.buttons["thread.roster-atlas-plan"].exists)

        atlas.press(forDuration: 1.2)
        // the desktop's bot menu (#182): no New thread or New folder on the
        // row, no Threads entry, Hide from sidebar below
        XCTAssertTrue(app.buttons["Hide from sidebar"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["New thread"].exists)
        XCTAssertFalse(app.buttons["New folder"].exists)
        XCTAssertFalse(app.buttons["Manage threads"].exists)
        recordScreenshot("Long press offers no new thread", in: app)
        // close the menu without choosing: start over
        app.terminate()
        app.launch()
        XCTAssertTrue(atlas.waitForExistence(timeout: 10))

        // The row itself opens the bot's one thread.
        atlas.tap()
        assertThread("Weekly plan", in: app)
    }

    @MainActor
    func testMultiThreadBotListsItsThreadsUnderItsName() {
        let app = launchRoster(density: nil)
        let toggle = app.buttons["threads-toggle.roster-pepper"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["thread.roster-pepper-gmail"].exists)
        // Pepper starts near the floating bar; bring it up so its threads
        // open on screen.
        scrollToUpperHalf(toggle, in: app)

        toggle.tap()
        XCTAssertEqual(toggle.value as? String, "Expanded, 3 threads")
        let gmail = app.buttons["thread.roster-pepper-gmail"]
        XCTAssertTrue(gmail.waitForExistence(timeout: 5))
        XCTAssertTrue(gmail.label.contains("Working"))
        XCTAssertTrue(app.buttons["thread.roster-pepper-icloud"].label.contains("Unread"))
        XCTAssertTrue(app.buttons["thread.roster-pepper-weekend"].label.contains("Queued"))
        XCTAssertFalse(app.buttons["thread.roster-pepper-routine"].exists)
        let newThread = app.buttons["new-thread.roster-pepper"]
        XCTAssertTrue(newThread.exists)
        XCTAssertTrue(newThread.label.contains("New thread"))

        // Threads start where the bot's name starts: no deeper indent.
        let name = app.buttons["chat-row.roster-pepper"].staticTexts["Pepper"]
        XCTAssertTrue(name.exists)
        XCTAssertEqual(gmail.frame.minX, name.frame.minX, accuracy: 1)
        XCTAssertEqual(newThread.frame.minX, name.frame.minX, accuracy: 1)
        // "Plan weekend" is in no folder: it sits under its own label, on
        // the name's edge, and stays when the Email folder closes.
        let unfiled = app.descendants(matching: .any)["unfiled-threads.roster-pepper"]
        XCTAssertTrue(unfiled.exists)
        XCTAssertEqual(unfiled.label, "Threads")
        XCTAssertEqual(unfiled.frame.minX, name.frame.minX, accuracy: 1)
        XCTAssertLessThan(unfiled.frame.maxY, app.buttons["thread.roster-pepper-weekend"].frame.minY + 1)
        recordScreenshot("Pepper's threads opened in place", in: app)

        let email = app.buttons["folder.roster-pepper.email"]
        email.tap()
        XCTAssertEqual(email.value as? String, "Collapsed")
        assertMissing(gmail)
        XCTAssertTrue(app.buttons["thread.roster-pepper-weekend"].exists)
        XCTAssertTrue(unfiled.exists)
        recordScreenshot("Email folder closed, unfiled thread under its label", in: app)
        email.tap()
        XCTAssertTrue(gmail.waitForExistence(timeout: 5))

        app.buttons["thread.roster-pepper-icloud"].tap()
        assertThread("Triage iCloud", in: app)
        app.buttons["Back"].tap()
        XCTAssertTrue(toggle.waitForExistence(timeout: 5))
        XCTAssertEqual(toggle.value as? String, "Expanded, 3 threads")
        toggle.tap()
        XCTAssertEqual(toggle.value as? String, "Collapsed, 3 threads")
        assertMissing(app.buttons["thread.roster-pepper-gmail"])
    }

    @MainActor
    func testSettingSwitchesBackToComfortableAndIsRemembered() {
        // The density this test saves would outlive it on the simulator and
        // turn the other suites' standard home into this list: put the
        // install default back afterwards.
        addTeardownBlock { @MainActor in
            let reset = XCUIApplication()
            reset.terminate()
            reset.launchArguments = Self.baseArguments + ["-reset-list-density"]
            // threads under each bot row (#210: the default is the chat header)
            reset.launchArguments += ["-omb-threads-location", "sidebar"]
            reset.launch()
            reset.terminate()
        }
        let app = launchRoster(density: nil, saved: true)
        XCTAssertTrue(app.buttons["threads-toggle.roster-pepper"].waitForExistence(timeout: 10))

        chooseDensity("Comfortable", in: app)
        // Comfortable is the original look: a Threads row under every bot,
        // the last message under each name, and groups as tiles.
        XCTAssertTrue(app.buttons["threads-toggle.roster-atlas"].waitForExistence(timeout: 5))
        XCTAssertTrue(contains("Three reviews and one approval", in: app))
        XCTAssertFalse(app.buttons["new-group"].exists)
        recordScreenshot("Comfortable roster after the switch", in: app)

        // Kept on this device across launches.
        app.terminate()
        app.launchArguments = Self.baseArguments
        // threads under each bot row (#210: the default is the chat header)
        app.launchArguments += ["-omb-threads-location", "sidebar"]
        app.launch()
        XCTAssertTrue(app.buttons["threads-toggle.roster-atlas"].waitForExistence(timeout: 10))

        chooseDensity("Compact", in: app)
        XCTAssertTrue(app.buttons["threads-toggle.roster-pepper"].waitForExistence(timeout: 5))
        assertMissing(app.buttons["threads-toggle.roster-atlas"])
    }

    /// The floating Updates bar must never cover the last row: scrolled to
    /// the end, the row sits wholly above the bar and takes a tap.
    @MainActor
    func testLastRowClearsTheBottomBarInBothDensities() {
        for (density, lastRow) in [("compact", "chat-row.roster-sage"), ("comfortable", "threads-toggle.roster-sage")] {
            let app = launchRoster(density: density)
            let bar = app.buttons["updates-button"]
            XCTAssertTrue(bar.waitForExistence(timeout: 10))
            let last = app.buttons[lastRow]
            // Scroll until the last row shows, then on to the list's end.
            var swipes = 0
            while !(last.exists && last.isHittable), swipes < 12 {
                app.swipeUp()
                swipes += 1
            }
            app.swipeUp()
            app.swipeUp()
            XCTAssertTrue(last.waitForExistence(timeout: 5), density)
            // let the list settle at its end before measuring
            Thread.sleep(forTimeInterval: 1)
            XCTAssertTrue(last.isHittable, density)
            XCTAssertLessThanOrEqual(last.frame.maxY, bar.frame.minY - 8, density)
            recordScreenshot("Last row above the bar, \(density)", in: app)
        }
    }

    /// The list starts where the header's glass buttons end. Its first
    /// title must start well inside it, clear of the buttons' shadow along
    /// that edge, not tucked against it.
    @MainActor
    func testFirstSectionTitleClearsTheHeaderInBothDensities() {
        for density in ["compact", "comfortable"] {
            let app = launchRoster(density: density)
            let list = app.scrollViews["roster-list"]
            let settings = app.buttons["home-account"]
            let title = app.staticTexts.matching(NSPredicate(format: "label ==[c] %@", "Inbox")).firstMatch
            XCTAssertTrue(title.waitForExistence(timeout: 10), density)
            XCTAssertTrue(list.exists, density)
            XCTAssertGreaterThanOrEqual(list.frame.minY, settings.frame.maxY, density)
            XCTAssertGreaterThanOrEqual(title.frame.minY - list.frame.minY, 12, density)
            recordScreenshot("First title below the header, \(density)", in: app)
        }
    }

    // MARK: - Helpers

    private static let baseArguments = [
        "-store-preview", "-roster-preview",
        "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
        "-companion.onboarding.welcomeSeen", "YES",
        "-companion.onboarding.notificationsSeen", "YES",
    ]

    /// `nil` is compact: the install default is now the standard home
    /// (HomeUITests), and these tests cover the compact and comfortable lists.
    /// `saved` stores the density instead of pinning it for the launch.
    @MainActor
    private func launchRoster(density: String?, saved: Bool = false, location: String = "sidebar") -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.terminate()
        app.launchArguments = Self.baseArguments
            // Pinned for this launch only; the switching test instead saves
            // it, as a choice made in Settings, so Settings can change it.
            + [saved ? "-set-list-density" : "-companion.prefs.rosterDensity", density ?? "compact"]
        // threads under each bot row (#210: the default is the chat header)
        app.launchArguments += ["-omb-threads-location", location]
        app.launch()
        if app.buttons["Connect computer"].exists {
            app.terminate()
            app.launch()
        }
        XCTAssertTrue(app.buttons["updates-button"].waitForExistence(timeout: 10))
        return app
    }

    @MainActor
    private func chooseDensity(_ label: String, in app: XCUIApplication) {
        // the photo's account menu > Settings > Appearance > List density
        app.buttons["home-apps"].tap()
        let settings = app.buttons["account-menu.settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 5))
        settings.tap()
        let appearance = app.descendants(matching: .any)["settings-appearance"].firstMatch
        XCTAssertTrue(appearance.waitForExistence(timeout: 10))
        appearance.tap()
        let row = app.buttons["list-density"]
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        for _ in 0..<10 where !row.isHittable { app.swipeUp() }
        let picker = app.buttons["list-density"]
        XCTAssertTrue(picker.waitForExistence(timeout: 5))
        func chosen() -> Bool { (picker.value as? String)?.contains(label) == true || picker.label.contains(label) }
        // The menu morphs open from the row (iOS 26 and later); a tap that
        // lands while it is still opening closes it without choosing, so
        // let it settle, and try once more if the value did not change.
        for _ in 0..<2 where !chosen() {
            picker.tap()
            let option = app.buttons.matching(NSPredicate(format: "label == %@ AND identifier != 'list-density'", label)).firstMatch
            XCTAssertTrue(option.waitForExistence(timeout: 5))
            RunLoop.current.run(until: Date().addingTimeInterval(0.8))
            option.tap()
            RunLoop.current.run(until: Date().addingTimeInterval(0.8))
        }
        XCTAssertTrue(picker.waitForExistence(timeout: 5))
        XCTAssertTrue(chosen())
        // back to the Settings list, then close the card sheet
        let back = app.descendants(matching: .any)["settings-back"].firstMatch
        for _ in 0..<10 where !back.isHittable { app.swipeDown() }
        back.tap()
        let close = app.descendants(matching: .any)["settings-close"].firstMatch
        XCTAssertTrue(close.waitForExistence(timeout: 5))
        close.tap()
        XCTAssertTrue(app.buttons["updates-button"].waitForExistence(timeout: 5))
    }

    @MainActor
    private func scrollToUpperHalf(_ element: XCUIElement, in app: XCUIApplication) {
        var swipes = 0
        while element.frame.minY > app.frame.midY, swipes < 6 {
            app.swipeUp(velocity: .slow)
            swipes += 1
        }
    }

    @MainActor
    private func assertThread(_ title: String, in app: XCUIApplication) {
        let header = app.buttons["chat-name"]
        let expected = NSPredicate(format: "value == %@", title)
        let appeared = XCTNSPredicateExpectation(predicate: expected, object: header)
        XCTAssertEqual(XCTWaiter.wait(for: [appeared], timeout: 10), .completed)
    }

    @MainActor
    private func assertMissing(_ element: XCUIElement) {
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"), object: element
        )
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 5), .completed)
    }

    @MainActor
    private func contains(_ text: String, in app: XCUIApplication) -> Bool {
        app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch.exists
    }

    @MainActor
    private func recordScreenshot(_ name: String, in app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
