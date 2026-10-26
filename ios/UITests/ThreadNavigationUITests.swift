import XCTest

/// Runs exclusively against the bundled ThreadPreview fleet
/// (ThreadPreviewHarness.swift). No account, paired computer, message
/// sends, or server mutations are involved. The phone's home lists no
/// threads under a bot row (the standard home, the only one since
/// 2026-10-12): threads are reached from the chat's picker, home search,
/// Updates, or the name capsule with Threads location "header".
final class ThreadNavigationUITests: XCTestCase {
    @MainActor
    func testReopeningBotRemembersSelectedThreadAcrossAppLaunches() {
        let app = launchPreview()
        openGmail(in: app)
        selectThread("preview-icloud", title: "Triage iCloud", in: app)
        app.buttons["Back"].tap()
        ThreadPreview.openPepper(in: app)
        recordScreenshot("Bot reopened after choosing iCloud", in: app)
        assertThread("Triage iCloud", in: app)
        app.terminate()
        app.launch()
        ThreadPreview.openPepper(in: app)
        assertThread("Triage iCloud", in: app)
        recordScreenshot("Remembered iCloud thread after relaunch", in: app)
    }

    @MainActor
    func testTopBarOpensThreadsWithHeaderLocationAndSwitches() {
        // #210: the name capsule carries Threads while Threads location is
        // the chat header (nothing is listed under the bot row then)
        let app = launchPreview(location: "header")
        // nothing about threads on the row then, not even their count
        XCTAssertFalse(ThreadPreview.row(app).label.contains("threads"), ThreadPreview.row(app).label)
        ThreadPreview.openPepper(in: app)
        if !ThreadPreview.showsThread("Triage Gmail", in: app, timeout: 3) {
            selectThread("preview-gmail", title: "Triage Gmail", in: app)
        }

        // Touch and hold the name capsule: its menu carries Threads. The
        // chat header settles late on a loaded CI runner. 5s timed out here
        // while the thread open itself was correct, same as assertThread.
        let nameCapsule = app.buttons["chat-name"]
        XCTAssertTrue(nameCapsule.waitForExistence(timeout: 10))
        nameCapsule.press(forDuration: 1.0)
        let menuThreads = app.buttons["Threads"]
        XCTAssertTrue(menuThreads.waitForExistence(timeout: 5))
        menuThreads.tap()
        let iCloud = app.buttons["thread-preview-icloud"]
        XCTAssertTrue(iCloud.waitForExistence(timeout: 5))
        recordScreenshot("Top bar opens the thread picker", in: app)
        iCloud.tap()
        assertThread("Triage iCloud", in: app)
        XCTAssertTrue(transcriptContains("I am reviewing iCloud here", in: app))

        openThreadPicker(in: app)
        let weekend = app.buttons["thread-preview-weekend"]
        XCTAssertTrue(weekend.waitForExistence(timeout: 5))
        weekend.tap()
        assertThread("Plan weekend", in: app)
        XCTAssertFalse(transcriptContains("I am reviewing iCloud here", in: app))
    }

    /// Threads hidden (the desktop's default, JC 2026-10-19): every thread
    /// of the bot is still one touch from its chat, the threads button in
    /// the header, and one more touch switches the chat there in place.
    @MainActor
    func testThreadsHiddenStillListEveryThreadOneTouchFromTheChat() {
        let app = launchPreview(extraArguments: ["-threads-hidden"])
        ThreadPreview.openPepper(in: app)
        let threads = app.buttons["chat-threads"]
        XCTAssertTrue(threads.waitForExistence(timeout: 5), "the threads button in the chat header")
        // iCloud is unread and Weekend queued beside the thread on screen
        XCTAssertTrue((threads.value as? String)?.contains("with news") ?? false, "\(String(describing: threads.value))")
        threads.tap()
        for id in ["preview-gmail", "preview-icloud", "preview-weekend"] {
            XCTAssertTrue(app.buttons["thread-\(id)"].waitForExistence(timeout: 5), id)
        }
        XCTAssertFalse(app.buttons["thread-preview-routine"].exists)
        recordScreenshot("Threads hidden: the list from the header", in: app)
        let target = ThreadPreview.showsThread("Triage iCloud", in: app, timeout: 0.1) ? "preview-weekend" : "preview-icloud"
        app.buttons["thread-\(target)"].tap()
        assertThread(target == "preview-icloud" ? "Triage iCloud" : "Plan weekend", in: app)
        // switched in place: Back is the home, not the thread before
        app.buttons["Back"].firstMatch.tap()
        XCTAssertTrue(ThreadPreview.row(app).waitForExistence(timeout: 5))
    }

    @MainActor
    func testRosterShowsFolderThreadsAndSwitchesLocally() {
        let app = launchPreview()
        // Threads location "sidebar": the row says how many threads Pepper has
        XCTAssertTrue(ThreadPreview.row(app).label.contains("3 threads"), ThreadPreview.row(app).label)
        openGmail(in: app)
        assertThread("Triage Gmail", in: app)
        XCTAssertTrue(transcriptContains("I’m reviewing Gmail here", in: app))

        openThreadPicker(in: app)
        let iCloud = app.buttons["thread-preview-icloud"]
        XCTAssertTrue(iCloud.waitForExistence(timeout: 5))
        XCTAssertTrue(iCloud.label.contains("Unread"))
        XCTAssertTrue(app.buttons["thread-preview-weekend"].label.contains("Queued"))
        XCTAssertFalse(app.buttons["thread-preview-routine"].exists)
        recordScreenshot("Thread picker with folder and runtime states", in: app)
        iCloud.tap()
        assertThread("Triage iCloud", in: app)
        XCTAssertTrue(transcriptContains("I am reviewing iCloud here", in: app))
        XCTAssertFalse(transcriptContains("I’m reviewing Gmail here", in: app))

        selectThread("preview-gmail", title: "Triage Gmail", in: app)
        XCTAssertTrue(transcriptContains("I’m reviewing Gmail here", in: app))
        XCTAssertFalse(transcriptContains("I am reviewing iCloud here", in: app))
    }

    @MainActor
    func testGmailRendersATableAndTasks() {
        let app = launchPreview()
        openGmail(in: app)
        let wide = String(repeating: "W", count: 80)

        let grid = app.descendants(matching: .any)["message-preview-gmail-grid"]
        XCTAssertTrue(grid.waitForExistence(timeout: 5))
        func cell(_ label: String) -> XCUIElement {
            grid.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
        }
        let labels = ["Alpha", "Beta", "one", wide]
        for label in labels {
            XCTAssertTrue(cell(label).waitForExistence(timeout: 5), label)
        }
        let alpha = cell("Alpha")
        let beta = cell("Beta")
        let one = cell("one")
        let token = cell(wide)
        XCTAssertEqual(alpha.frame.midY, beta.frame.midY, accuracy: 1)
        XCTAssertEqual(one.frame.midY, token.frame.midY, accuracy: 1)
        XCTAssertGreaterThan(one.frame.midY, alpha.frame.midY)
        // iOS 27 pads a small element's accessibility frame by an amount that
        // depends on its text, so widths no longer describe the cell. A grid
        // column shows as a shared leading edge.
        XCTAssertEqual(alpha.frame.minX, one.frame.minX, accuracy: 1)
        XCTAssertEqual(beta.frame.minX, token.frame.minX, accuracy: 1)
        XCTAssertGreaterThan(beta.frame.minX, alpha.frame.minX)
        XCTAssertEqual(token.frame.height, one.frame.height, accuracy: 1)
        let cellIds = [
            "message-preview-gmail-grid-scroll-cell-0-0",
            "message-preview-gmail-grid-scroll-cell-0-1",
            "message-preview-gmail-grid-scroll-cell-1-0",
            "message-preview-gmail-grid-scroll-cell-1-1",
        ]
        let identified = cellIds.map { grid.descendants(matching: .any)[$0] }
        for (element, label) in zip(identified, labels) {
            XCTAssertTrue(element.waitForExistence(timeout: 5))
            XCTAssertEqual(element.label, label)
        }
        let order = identified.map(\.label)
        XCTAssertEqual(order, labels)
        func absent(_ label: String, in element: XCUIElement) {
            let match = element.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", label)).firstMatch
            XCTAssertFalse(match.exists, label)
        }
        absent("DATA TABLE", in: grid)
        absent("Copy CSV", in: grid)
        absent("rows", in: grid)
        absent("| --- | --- |", in: grid)

        let scroll = app.descendants(matching: .any)["message-preview-gmail-grid-scroll"]
        XCTAssertTrue(scroll.waitForExistence(timeout: 5))
        let before = token.frame.origin.x
        token.swipeLeft()
        XCTAssertLessThan(token.frame.origin.x, before)

        let tasks = app.descendants(matching: .any)["message-preview-gmail-tasks"]
        XCTAssertTrue(tasks.waitForExistence(timeout: 5))
        XCTAssertTrue(tasks.descendants(matching: .any)["Quant baskets"].waitForExistence(timeout: 5))
        XCTAssertTrue(tasks.staticTexts["1."].exists)
        XCTAssertTrue(tasks.descendants(matching: .any)["completed, Ship the notes"].exists)
        XCTAssertFalse(tasks.buttons["completed, Ship the notes"].exists)
        XCTAssertTrue(tasks.descendants(matching: .any)["not completed, waiting"].exists)
        XCTAssertFalse(tasks.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "**")).firstMatch.exists)
        XCTAssertFalse(tasks.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "[x] Ship the notes")).firstMatch.exists)

        let mine = app.descendants(matching: .any)["message-preview-gmail-user-md"]
        XCTAssertTrue(mine.waitForExistence(timeout: 5))
        XCTAssertTrue(mine.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "| --- | --- |")).firstMatch.exists)
        XCTAssertTrue(mine.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "[x] done")).firstMatch.exists)
        recordScreenshot("Gmail table and task list", in: app)
    }

    /// Home search (the full screen sheet, #772) lists Pepper's threads by
    /// title (opening one asks the computer, so a fixture has no tap).
    @MainActor
    func testHomeSearchFindsSiblingTitles() {
        let app = launchPreview()
        let thread = { (id: String) in app.descendants(matching: .any)["search-thread.preview-pepper.\(id)"] }
        openHomeSearch(in: app)
        app.typeText("iCloud")
        recordScreenshot("Home search for iCloud", in: app)
        XCTAssertTrue(thread("preview-icloud").waitForExistence(timeout: 5))
        XCTAssertFalse(thread("preview-gmail").exists)
        XCTAssertFalse(thread("preview-weekend").exists)

        // the clear button empties the field and keeps the caret there
        app.buttons["search-clear"].firstMatch.tap()
        if !app.keyboards.firstMatch.waitForExistence(timeout: 2) {
            app.descendants(matching: .any)["search-field"].firstMatch.tap()
        }
        app.typeText("Gmail")
        XCTAssertTrue(thread("preview-gmail").waitForExistence(timeout: 10))
        XCTAssertFalse(thread("preview-icloud").exists)
        XCTAssertFalse(thread("preview-weekend").exists)
        recordScreenshot("Home search for Gmail", in: app)

        // the sheet (#772) matches thread titles only, as the reference does:
        // a folder's name lists none of its threads
        app.buttons["search-clear"].firstMatch.tap()
        if !app.keyboards.firstMatch.waitForExistence(timeout: 2) {
            app.descendants(matching: .any)["search-field"].firstMatch.tap()
        }
        app.typeText("iCloud")
        XCTAssertTrue(thread("preview-icloud").waitForExistence(timeout: 10))

        // opening the row switches the thread on the computer: the offline
        // fixture has none, so the tap itself is not part of this test
    }

    @MainActor
    func testSwitchingThreadsKeepsSeparateUnsentDrafts() {
        let app = launchPreview()
        openGmail(in: app)
        let input = app.descendants(matching: .any).matching(identifier: "message-input").firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        input.tap()
        input.typeText("Gmail draft only")

        selectThread("preview-icloud", title: "Triage iCloud", in: app)
        XCTAssertNotEqual(input.value as? String, "Gmail draft only")
        input.tap()
        input.typeText("iCloud draft only")

        selectThread("preview-gmail", title: "Triage Gmail", in: app)
        XCTAssertEqual(input.value as? String, "Gmail draft only")
        selectThread("preview-icloud", title: "Triage iCloud", in: app)
        XCTAssertEqual(input.value as? String, "iCloud draft only")
        recordScreenshot("Restored iCloud draft after switching threads", in: app)
    }

    @MainActor
    func testFailedCreationKeepsThreadPickerOpenWithError() {
        let app = launchPreview()
        openGmail(in: app)
        openThreadPicker(in: app)
        let create = app.buttons["new-thread"]
        XCTAssertTrue(create.waitForExistence(timeout: 5))
        // The preview deliberately has no API client, so this cannot write
        // anywhere and exercises the failure path deterministically.
        create.tap()
        let error = app.descendants(matching: .any).matching(identifier: "thread-action-error").firstMatch
        XCTAssertTrue(error.waitForExistence(timeout: 5))
        XCTAssertTrue(error.label.contains("Couldn't create the thread"))
        XCTAssertTrue(create.exists)
        XCTAssertTrue(create.isEnabled)
        XCTAssertTrue(app.buttons["thread-preview-gmail"].exists)
        recordScreenshot("Failed creation keeps thread picker open", in: app)
        app.buttons["Done"].tap()
        assertThread("Triage Gmail", in: app)
    }

    @MainActor
    func testUpdatesKeepSiblingThreadsSeparate() {
        let app = launchPreview(extraArguments: ["-companion.prefs.updatesButton", "YES"])
        app.buttons["updates-button"].tap()
        let gmail = app.buttons["update-preview-gmail"]
        let iCloud = app.buttons["update-preview-icloud"]
        let weekend = app.buttons["update-preview-weekend"]
        XCTAssertTrue(gmail.waitForExistence(timeout: 5))
        XCTAssertTrue(iCloud.exists)
        XCTAssertTrue(weekend.exists)
        XCTAssertTrue(gmail.label.contains("Triage Gmail"))
        XCTAssertTrue(iCloud.label.contains("Triage iCloud"))
        XCTAssertTrue(weekend.label.contains("Plan weekend"))
        XCTAssertFalse(app.buttons["update-preview-routine"].exists)
        XCTAssertTrue(app.staticTexts["3 active"].exists)
        if !iCloud.isHittable { app.swipeUp() }
        recordScreenshot("Separate updates for sibling threads", in: app)
        iCloud.tap()
        assertThread("Triage iCloud", in: app)
    }

    @MainActor
    func testBulkDeletionKeepsCurrentAndWorkingThread() {
        let app = launchPreview(extraArguments: ["-threads-preview-deletion"])
        openGmail(in: app)
        openThreadPicker(in: app)
        app.buttons["select-threads"].tap()

        XCTAssertFalse(app.buttons["select-thread-preview-gmail"].isEnabled)
        XCTAssertFalse(app.buttons["select-thread-preview-routine"].exists)
        app.buttons["select-all-threads"].tap()
        XCTAssertTrue(app.buttons["delete-selected-threads"].label.contains("2"))
        app.buttons["delete-selected-threads"].tap()
        let confirmation = app.buttons["Delete 2 threads"]
        XCTAssertTrue(confirmation.waitForExistence(timeout: 5))
        recordScreenshot("Bulk delete confirmation with count", in: app)
        confirmation.tap()

        assertMissing(app.buttons["select-thread-preview-icloud"])
        assertMissing(app.buttons["select-thread-preview-weekend"])
        XCTAssertTrue(app.buttons["thread-preview-gmail"].waitForExistence(timeout: 5))
        app.buttons["Done"].tap()
        assertThread("Triage Gmail", in: app)
        XCTAssertTrue(transcriptContains("I’m reviewing Gmail here", in: app))
        app.buttons["Back"].tap()
        // One thread left is the bot itself: the row drops the thread
        // count, and opens that thread.
        XCTAssertTrue(ThreadPreview.row(app).waitForExistence(timeout: 5))
        XCTAssertFalse(ThreadPreview.row(app).label.contains("threads"), ThreadPreview.row(app).label)
        ThreadPreview.openPepper(in: app)
        assertThread("Triage Gmail", in: app)
    }

    @MainActor
    func testBulkDeletionStopsOnFailureAndKeepsRemainingSelection() {
        let app = launchPreview(extraArguments: [
            "-threads-preview-deletion", "-threads-preview-deletion-fails-weekend"
        ])
        openGmail(in: app)
        openThreadPicker(in: app)
        app.buttons["select-threads"].tap()
        app.buttons["select-all-threads"].tap()
        app.buttons["delete-selected-threads"].tap()
        let confirmation = app.buttons["Delete 2 threads"]
        XCTAssertTrue(confirmation.waitForExistence(timeout: 5))
        confirmation.tap()

        let error = app.descendants(matching: .any).matching(identifier: "thread-action-error").firstMatch
        XCTAssertTrue(error.waitForExistence(timeout: 5))
        XCTAssertTrue(error.label.contains("Deleted 1 of 2 threads"))
        XCTAssertTrue(error.label.contains("Synthetic deletion failure"))
        assertMissing(app.buttons["select-thread-preview-icloud"])
        let remaining = app.buttons["select-thread-preview-weekend"]
        XCTAssertTrue(remaining.exists)
        XCTAssertTrue(remaining.label.contains("Deselect"))
        XCTAssertTrue(app.buttons["delete-selected-threads"].label.contains("1"))
        recordScreenshot("Partial bulk deletion keeps the remaining thread selected", in: app)
    }

    @MainActor
    private func launchPreview(extraArguments: [String] = [], location: String = "sidebar") -> XCUIApplication {
        continueAfterFailure = false
        return ThreadPreview.launch(extraArguments, location: location)
    }

    @MainActor
    private func openGmail(in app: XCUIApplication) {
        ThreadPreview.openGmail(in: app)
    }

    /// The home's search sheet: it opens with its field focused and the
    /// keyboard up, so typing goes there.
    @MainActor
    private func openHomeSearch(in app: XCUIApplication) {
        let search = app.buttons["home-search"].firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        let field = app.descendants(matching: .any)["search-field"].firstMatch
        // a tap while the last sheet still settles opens nothing: once more
        if !field.waitForExistence(timeout: 3) { search.tap() }
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        // the caret lands once the sheet has settled; a slow runner gets a tap
        if !app.keyboards.firstMatch.waitForExistence(timeout: 3) { field.tap() }
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "the field takes the keyboard")
    }

    @MainActor
    private func selectThread(_ id: String, title: String, in app: XCUIApplication) {
        openThreadPicker(in: app)
        let row = app.buttons["thread-\(id)"]
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.tap()
        assertThread(title, in: app)
    }

    @MainActor
    private func openThreadPicker(in app: XCUIApplication) {
        ThreadPreview.openPicker(in: app)
    }

    @MainActor
    private func assertThread(_ title: String, in app: XCUIApplication) {
        XCTAssertTrue(ThreadPreview.showsThread(title, in: app), "the chat shows \(title)")
    }

    @MainActor
    private func transcriptContains(_ text: String, in app: XCUIApplication) -> Bool {
        app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch.exists
    }

    @MainActor
    private func assertMissing(_ element: XCUIElement) {
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"), object: element
        )
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 5), .completed)
    }

    @MainActor
    private func recordScreenshot(_ name: String, in app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
