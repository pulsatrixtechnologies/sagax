import XCTest

/// Settings (12, 14), Account (16), Bot Computer (21) and Plugins (15)
/// against the parity fixture server: every action is a real request to the
/// real server, and each write is read back through the API.
///
///   node ios/parity/fixture-server.mjs &
///   TEST_RUNNER_PARITY_ENDPOINT=... TEST_RUNNER_PARITY_TOKEN=... \
///   TEST_RUNNER_PARITY_ENVIRONMENT=... xcodebuild test \
///     -only-testing:SagaxCompanionUITests/SettingsUITests ...
///
/// Without those variables the tests skip. The sign-out test ends the
/// in-memory session only (the fixture's pairing stays valid), so the
/// order of the tests does not matter.
final class SettingsUITests: XCTestCase {
    private var arguments: [String] = []
    private var endpoint = ""
    private var token = ""

    override func setUpWithError() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        guard let endpoint = env["PARITY_ENDPOINT"], let token = env["PARITY_TOKEN"] else {
            throw XCTSkip("no parity fixture: set TEST_RUNNER_PARITY_ENDPOINT and TEST_RUNNER_PARITY_TOKEN")
        }
        self.endpoint = endpoint
        self.token = token
        arguments = ["-parityEndpoint", endpoint, "-parityToken", token, "-parityScreen", "12-settings-top"]
        if let environment = env["PARITY_ENVIRONMENT"], !environment.isEmpty {
            arguments += ["-parityEnvironment", environment]
        }
    }

    @MainActor
    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.terminate()
        app.launchArguments = arguments
        app.launch()
        XCTAssertTrue(app.element("settings-close").waitForExistence(timeout: 20))
        XCTAssertTrue(app.element("settings-appearance").waitForExistence(timeout: 20))
        return app
    }

    /// Settings > Permissions (the rules): the root's Bot card row opens
    /// them (#4103).
    @MainActor
    private func launchBotCard() -> XCUIApplication {
        let app = launch()
        rootRow("settings-bots", in: app).tap()
        XCTAssertTrue(app.element("settings-rules").waitForExistence(timeout: 20))
        return app
    }

    /// A row of the root's cards, scrolled into reach: the time zone and
    /// the bot's computer sit in the root's Bot card (#4103).
    @MainActor
    private func rootRow(_ identifier: String, in app: XCUIApplication) -> XCUIElement {
        let row = app.element(identifier)
        XCTAssertTrue(row.waitForExistence(timeout: 20), identifier)
        for _ in 0..<8 where !row.isHittable {
            let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7))
            start.press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.45)), withVelocity: .slow, thenHoldForDuration: 0.3)
        }
        return row
    }

    // MARK: API

    private func api(_ method: String, _ path: String, body: [String: Any]? = nil) -> (Int, [String: Any]) {
        var request = URLRequest(url: URL(string: endpoint + path)!, timeoutInterval: 140)
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
        _ = done.wait(timeout: .now() + 150)
        return result
    }

    private func botSettings() -> [String: Any] {
        api("GET", "/api/settings/bot").1["settings"] as? [String: Any] ?? [:]
    }

    /// Polls the server until `check` holds.
    private func eventually(_ timeout: TimeInterval = 10, _ check: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if check() { return true }
            Thread.sleep(forTimeInterval: 0.3)
        }
        return check()
    }

    // MARK: Bot section

    @MainActor
    func testTimeZoneIsSetFromThePickerAndAutomatically() {
        // the time zone rows are the root's Bot card (#4103)
        let app = launch()
        if botSettings()["timeZoneAuto"] as? Bool == true {
            rootRow("settings-time-zone-auto.toggle", in: app).tap()
            XCTAssertTrue(eventually { (self.botSettings()["timeZoneAuto"] as? Bool) == false })
        }
        let row = rootRow("settings-time-zone", in: app)
        XCTAssertTrue(eventually(5) { row.isHittable })
        row.tap()
        let search = app.textFields["time-zone-search"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("Tokyo")
        let tokyo = app.element("time-zone.Asia/Tokyo")
        XCTAssertTrue(tokyo.waitForExistence(timeout: 5))
        tokyo.tap()
        XCTAssertTrue(eventually { (self.botSettings()["timeZone"] as? String) == "Asia/Tokyo" })
        XCTAssertTrue(eventually { app.element("settings-time-zone").label.contains("Asia/Tokyo") })

        // Automatic again: the phone sends its own zone.
        rootRow("settings-time-zone-auto.toggle", in: app).tap()
        let phoneZone = TimeZone.current.identifier
        XCTAssertTrue(eventually {
            let settings = self.botSettings()
            return settings["timeZoneAuto"] as? Bool == true && settings["timeZone"] as? String == phoneZone
        })
    }

    @MainActor
    func testRulesListAndSwipeToDelete() {
        let app = launchBotCard()
        let before = api("GET", "/api/auto-review/rules").1["total"] as? Int ?? 0
        XCTAssertGreaterThan(before, 0, "the fixture seeds saved command rules")
        app.element("settings-rules").tap()
        let list = app.element("rules-list")
        XCTAssertTrue(list.waitForExistence(timeout: 10))
        let first = list.cells.firstMatch
        XCTAssertTrue(first.waitForExistence(timeout: 5))
        first.swipeLeft()
        let delete = app.buttons["Delete"]
        XCTAssertTrue(delete.waitForExistence(timeout: 5))
        delete.tap()
        XCTAssertTrue(eventually { (self.api("GET", "/api/auto-review/rules").1["total"] as? Int) == before - 1 })
        // Back on Bots, the count follows.
        app.element("settings-back").firstMatch.tap()
        XCTAssertTrue(app.element("settings-rules").waitForExistence(timeout: 5))
        XCTAssertTrue(app.element("settings-rules").label.contains("\(before - 1)"))
    }

    @MainActor
    func testBotComputerShowsStatusAndUpdateAndResetReachTheServer() {
        // the bot's computer is a row of the root's Bot card (#4103)
        let app = launch()
        rootRow("settings-bot-computer", in: app).tap()
        let disk = app.otherElements["computer-disk"].exists ? app.otherElements["computer-disk"] : app.staticTexts["Disk space"]
        XCTAssertTrue(disk.waitForExistence(timeout: 10))
        let status = api("GET", "/api/computer/status").1
        XCTAssertNotNil(status["diskState"], "the server reports the disk state")
        XCTAssertTrue(app.staticTexts["Normal"].waitForExistence(timeout: 10) || app.staticTexts["Almost full"].exists || app.staticTexts["Full"].exists)

        // a small phone keeps the actions under the fold; a computer that
        // needs recovering offers Recover in Update's place
        let reset = app.element("computer-reset")
        for _ in 0..<6 where !(reset.exists && reset.isHittable) { app.swipeUp() }
        XCTAssertTrue(reset.waitForExistence(timeout: 5), app.debugDescription)
        let actions = app.element("computer-recover").exists
            ? [("computer-reset", "Reset Computer")]
            : [("computer-update", "Update Computer"), ("computer-reset", "Reset Computer")]
        for (row, confirm) in actions {
            // a small phone keeps the actions under the fold
            for _ in 0..<6 where !(app.element(row).exists && app.element(row).isHittable) { app.swipeUp() }
            app.element(row).tap()
            let matches = app.buttons.matching(NSPredicate(format: "label == %@", confirm))
            XCTAssertTrue(matches.firstMatch.waitForExistence(timeout: 5))
            matches.allElementsBoundByIndex.last!.tap()
            // Either the computer answers with a fresh status, or the server's
            // own refusal is shown (the fixture runs without Docker:
            // "Start docker first"). Both prove the call went through.
            let alert = app.alerts["Bot Computer"]
            if alert.waitForExistence(timeout: 60) {
                XCTAssertFalse(alert.staticTexts.allElementsBoundByIndex.map(\.label).joined().isEmpty)
                alert.buttons["OK"].tap()
            }
            XCTAssertTrue(app.element(row).waitForExistence(timeout: 30))
            XCTAssertTrue(app.staticTexts["The one computer your Bots share."].waitForExistence(timeout: 30))
        }
    }

    // MARK: Plugins

    @MainActor
    func testAddingANoSignInPluginInstallsItOnTheServer() {
        // Start clean: an earlier run may have left it added.
        _ = api("DELETE", "/api/mcp/servers/deepwiki")
        addTeardownBlock { _ = self.api("DELETE", "/api/mcp/servers/deepwiki") }
        let app = launch()
        rootRow("settings-plugins", in: app).tap()
        // Settings > Connect apps (#203, #218): search across apps and skills
        XCTAssertTrue(app.element("connect-apps-manage").waitForExistence(timeout: 10))
        // the floating search at the sheet's foot (#4103)
        let search = app.textFields["connect-apps-search"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("deepwiki\n")
        let add = app.element("connect-apps-action.featured:deepwiki")
        XCTAssertTrue(add.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertEqual(add.label, "Add")
        add.tap()
        XCTAssertTrue(eventually(30) {
            let plugins = self.api("GET", "/api/plugins/installed").1["plugins"] as? [[String: Any]] ?? []
            return plugins.contains { ($0["url"] as? String)?.contains("deepwiki") == true }
        })
        // added: no Add button any more
        XCTAssertTrue(eventually(15) { !app.element("connect-apps-action.featured:deepwiki").exists })
        // its page, as the reference design iOS 1.14 draws the plugin sheet: the header,
        // Added in the floating capsule, Uninstall in the "..." menu
        // added, it leaves Discover for Installed ("N connected" opens it)
        app.element("connect-apps-manage").tap()
        let row = app.descendants(matching: .any).matching(NSPredicate(
            format: "identifier BEGINSWITH 'connect-apps-installed.' AND identifier CONTAINS 'deepwiki'"
        )).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), app.debugDescription)
        row.tap()
        XCTAssertTrue(app.element("connect-apps-detail-header").waitForExistence(timeout: 10))
        XCTAssertTrue(app.element("connect-apps-detail-added").waitForExistence(timeout: 5))
        XCTAssertFalse(app.element("connect-apps-detail-action").exists)
        let more = app.element("connect-apps-detail-more")
        XCTAssertTrue(more.waitForExistence(timeout: 5))
        more.tap()
        let uninstall = app.element("connect-apps-uninstall")
        XCTAssertTrue(uninstall.waitForExistence(timeout: 5))
        uninstall.tap()
        let confirm = app.sheets.buttons["Uninstall"].firstMatch
        if confirm.waitForExistence(timeout: 5) { confirm.tap() } else { app.buttons["Uninstall"].firstMatch.tap() }
        XCTAssertTrue(eventually(30) {
            let plugins = self.api("GET", "/api/plugins/installed").1["plugins"] as? [[String: Any]] ?? []
            return !plugins.contains { ($0["url"] as? String)?.contains("deepwiki") == true }
        })
    }

    /// Add from a catalog entry's own page: the blue capsule installs it and
    /// the page follows the installed server (Added, no dead end).
    @MainActor
    func testAddFromThePluginPageFollowsTheInstalledItem() {
        _ = api("DELETE", "/api/mcp/servers/deepwiki")
        addTeardownBlock { _ = self.api("DELETE", "/api/mcp/servers/deepwiki") }
        let app = launch()
        rootRow("settings-plugins", in: app).tap()
        XCTAssertTrue(app.element("connect-apps-manage").waitForExistence(timeout: 10))
        // the floating search at the sheet's foot (#4103)
        let search = app.textFields["connect-apps-search"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("deepwiki\n")
        // a search hit is the result row (connect-apps-app-<key>)
        let row = app.element("connect-apps-app-featured:deepwiki")
        XCTAssertTrue(row.waitForExistence(timeout: 10), app.debugDescription)
        row.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.5)).tap()
        let action = app.element("connect-apps-detail-action")
        XCTAssertTrue(action.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertFalse(app.element("connect-apps-detail-more").exists, "nothing to uninstall yet")
        action.tap()
        XCTAssertTrue(eventually(30) {
            let plugins = self.api("GET", "/api/plugins/installed").1["plugins"] as? [[String: Any]] ?? []
            return plugins.contains { ($0["url"] as? String)?.contains("deepwiki") == true }
        })
        XCTAssertTrue(app.element("connect-apps-detail-added").waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertTrue(app.element("connect-apps-detail-header").exists)
    }

    // MARK: Account

    @MainActor
    func testAccountListsThePairedComputersWithTheCurrentChecked() {
        let app = launch()
        app.element("settings-account").tap()
        let current = app.element("account-switch.parity-harness")
        XCTAssertTrue(current.waitForExistence(timeout: 10))
        XCTAssertTrue(current.isSelected || current.images["checkmark"].exists || current.label.contains("Parity"))
        XCTAssertTrue(app.element("account-add").exists)
        XCTAssertTrue(app.element("account-sign-out").exists)
        XCTAssertTrue(app.element("account-delete").exists)
    }

    @MainActor
    func testSignOutEndsTheSession() {
        let app = launch()
        // Sign Out lives with the paired computers (Pair devices)
        app.element("settings-account").tap()
        let signOut = app.element("account-sign-out")
        XCTAssertTrue(signOut.waitForExistence(timeout: 10))
        for _ in 0..<6 where !signOut.isHittable { app.swipeUp() }
        signOut.tap()
        let confirm = app.buttons.matching(NSPredicate(format: "label == 'Sign Out' AND identifier != 'account-sign-out'")).firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        confirm.tap()
        XCTAssertTrue(waitForDisappearance(app.buttons["home-plus"], timeout: 10))
        XCTAssertFalse(app.element("settings-close").exists)
    }

    // MARK: App section

    /// Turns notifications on through the system prompt (granted once per
    /// simulator; afterwards the switch simply reads On).
    @MainActor
    func testNotificationsSwitchAsksTheSystem() {
        let app = launch()
        // the root says On or Off; the switch is the first row of its page
        app.element("settings-notifications").tap()
        let toggle = app.element("settings-notifications-system.toggle")
        XCTAssertTrue(toggle.waitForExistence(timeout: 5))
        if toggle.value as? String == "1" { return }
        toggle.tap()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let allow = springboard.alerts.buttons["Allow"]
        if allow.waitForExistence(timeout: 10) { allow.tap() }
        let on = NSPredicate(format: "value == '1'")
        expectation(for: on, evaluatedWith: toggle)
        waitForExpectations(timeout: 15)
    }

    /// Dim is not only the settings sheet: closing it, the home behind is
    /// drawn on the Dim background too, Black puts back exactly #141414, and
    /// following the phone again wears the default pair.
    @MainActor
    func testDimSkinAppliesToTheHomeAndSystemRestoresBlack() {
        let app = launch()
        defer { setSkin(nil, in: app) }
        setSkin("dim", in: app)
        XCTAssertTrue(app.buttons["home-plus"].waitForExistence(timeout: 10))
        XCTAssertTrue(eventually(5) { self.homeBackground(app) == 0x1C1C1E }, "home background \(String(homeBackground(app), radix: 16))")

        setSkin("black", in: app)
        XCTAssertTrue(eventually(5) { self.homeBackground(app) == 0x141414 }, "home background \(String(homeBackground(app), radix: 16))")

        // setSkin(nil) writes Black fixed (the phone's own look). Black on a
        // dark simulator and on a light one alike.
        setSkin(nil, in: app)
        XCTAssertTrue(eventually(5) { self.homeBackground(app) == 0x141414 }, "home background \(String(homeBackground(app), radix: 16))")
    }

    /// Picking a skin redraws everything at once, the page doing the picking
    /// included: no relaunch, no leaving Settings, light and dark skins alike.
    /// A skin is a family, a variant and a mode (2026-10-19).
    @MainActor
    func testSkinsSwitchLiveInsideSettings() {
        let app = launch()
        defer { setSkin(nil, in: app) }
        openAppearance(in: app)
        for (family, variant, mode, ground) in [
            ("atelier", "lagoon", "light", UInt32(0xDFECEB)),
            ("atelier", "brass", "dark", 0x100E0B),
            ("atelier", "brass", "light", 0xF5F1EB),
            ("studio", "neutral", "dark", 0x121212),
        ] {
            wear(family: family, variant: variant, mode: mode, in: app)
            // the sheet's own ground, beside the cards
            XCTAssertTrue(eventually(5) { self.pixel(app, x: 16, y: 300) == ground }, "\(family)/\(variant)/\(mode): \(String(self.pixel(app, x: 16, y: 300), radix: 16))")
            XCTAssertTrue(app.element("skin.family.\(family)").exists, "still on Appearance")
        }
        // the root row names the skin worn now
        for _ in 0..<8 where !app.element("settings-back").firstMatch.isHittable { app.swipeDown() }
        app.element("settings-back").firstMatch.tap()
        let row = app.element("settings-appearance")
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        XCTAssertTrue(row.label.contains("Midnight") || (row.value as? String ?? "").contains("Midnight"), row.label)
    }

    /// The secret skin is not offered until it is found.
    @MainActor
    func testHibou98IsHiddenUntilUnlocked() {
        let app = launch()
        defer { setSkin(nil, in: app) }
        openAppearance(in: app)
        let studio = app.element("skin.family.studio")
        for _ in 0..<8 where !studio.isHittable { app.swipeUp() }
        XCTAssertTrue(studio.waitForExistence(timeout: 5))
        XCTAssertFalse(app.element("skin.family.retro98").exists)
    }

    /// Opens Settings > Appearance from the home or the settings root.
    @MainActor
    private func openAppearance(in app: XCUIApplication) {
        if app.element("skin.family.phone").exists { return }
        if !app.element("settings-close").exists {
            // the apps button opens the account menu, which holds Settings (the photo opens Settings itself)
            let open = app.element("home-apps")
            XCTAssertTrue(open.waitForExistence(timeout: 10))
            open.tap()
            let settings = app.buttons["account-menu.settings"]
            XCTAssertTrue(settings.waitForExistence(timeout: 5))
            settings.tap()
        }
        let row = app.element("settings-appearance")
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        for _ in 0..<6 where !row.isHittable { settle(app) }
        row.tap()
        XCTAssertTrue(app.element("skin.family.phone").waitForExistence(timeout: 5))
    }

    /// A slow half-page drag: a swipe's momentum keeps the list moving, and
    /// the next tap only stops it instead of pressing the row.
    @MainActor
    private func settle(_ app: XCUIApplication) {
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7))
        start.press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.45)), withVelocity: .slow, thenHoldForDuration: 0.3)
    }

    /// Picks a family, then its variant (when it has several), then the mode.
    @MainActor
    private func wear(family: String, variant: String?, mode: String?, in app: XCUIApplication) {
        let card = app.element("skin.family.\(family)")
        for _ in 0..<8 where !card.isHittable { settle(app) }
        XCTAssertTrue(card.waitForExistence(timeout: 5), family)
        card.tap()
        if let variant {
            let swatch = app.element("skin.variant.\(variant)")
            if swatch.waitForExistence(timeout: 5) {
                for _ in 0..<8 where !swatch.isHittable { settle(app) }
                swatch.tap()
            }
        }
        if let mode {
            let menu = app.element("theme.mode")
            for _ in 0..<8 where !menu.isHittable { settle(app) }
            XCTAssertTrue(menu.waitForExistence(timeout: 5))
            menu.tap()
            // menu items can lose their identifier: fall back to the label
            let label = ["light": "Light", "dark": "Dark", "auto": "Auto (follow the phone)"][mode] ?? mode
            var option = app.buttons["theme.mode.\(mode)"]
            if !option.waitForExistence(timeout: 3) { option = app.buttons[label] }
            XCTAssertTrue(option.waitForExistence(timeout: 5), mode)
            option.tap()
        }
    }

    /// Wears one skin (nil: the phone's own Black again) and closes the sheet.
    @MainActor
    private func setSkin(_ skin: String?, in app: XCUIApplication) {
        openAppearance(in: app)
        let places: [String: (String, String?, String)] = [
            "lagoon": ("atelier", "lagoon", "light"), "foundry": ("atelier", "brass", "dark"),
            "atelier": ("atelier", "brass", "light"), "midnight": ("studio", "neutral", "dark"),
            "daylight": ("studio", "neutral", "light"), "graphite": ("studio", "slate", "dark"),
            "linen": ("studio", "slate", "light"), "dusk": ("studio", "plum", "dark"),
            "pulsatrix": ("pulsatrix", nil, "dark"), "pulsatrix-light": ("pulsatrix", nil, "light"),
            "dim": ("phone", "dim", "dark"),
        ]
        if let skin, let place = places[skin] {
            wear(family: place.0, variant: place.1, mode: place.2, in: app)
        } else {
            wear(family: "phone", variant: "black", mode: nil, in: app)
        }
        for _ in 0..<8 where !app.element("settings-back").firstMatch.isHittable { app.swipeDown() }
        app.element("settings-back").firstMatch.tap()
        let close = app.element("settings-close")
        XCTAssertTrue(close.waitForExistence(timeout: 5))
        close.tap()
        XCTAssertTrue(waitForDisappearance(close, timeout: 5))
    }

    /// The home's background between the header and the first section
    /// label, as 0xRRGGBB.
    private func homeBackground(_ app: XCUIApplication) -> UInt32 { pixel(app, x: 130, y: 128) }

    /// One screen pixel at a point, as 0xRRGGBB.
    private func pixel(_ app: XCUIApplication, x px: CGFloat, y py: CGFloat) -> UInt32 {
        guard let image = app.screenshot().image.cgImage else { return 0 }
        let scale = CGFloat(image.width) / app.frame.width
        let x = Int(px * scale), y = Int(py * scale)
        var pixel = [UInt8](repeating: 0, count: 4)
        let space = CGColorSpace(name: CGColorSpace.sRGB)!
        guard let context = CGContext(
            data: &pixel, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
            space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return 0 }
        context.draw(image, in: CGRect(x: -x, y: -(image.height - 1 - y), width: image.width, height: image.height))
        return UInt32(pixel[0]) << 16 | UInt32(pixel[1]) << 8 | UInt32(pixel[2])
    }

    private func waitForDisappearance(_ element: XCUIElement, timeout: TimeInterval) -> Bool {
        let gone = NSPredicate(format: "exists == false")
        let expectation = XCTNSPredicateExpectation(predicate: gone, object: element)
        return XCTWaiter().wait(for: [expectation], timeout: timeout) == .completed
    }
}

private extension XCUIApplication {
    /// Any element by accessibility identifier: SwiftUI exposes the same
    /// control as a button, a switch or a cell depending on its style.
    func element(_ identifier: String) -> XCUIElement {
        descendants(matching: .any).matching(identifier: identifier).firstMatch
    }
}
