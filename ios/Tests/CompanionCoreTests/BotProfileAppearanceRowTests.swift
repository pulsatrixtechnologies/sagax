// #4162 (follow-up of #4147 on the desktop and the web): the phone and
// tablet bot page still had an Appearance tab beside General, Knowledge and
// Analytics, and a request to open Appearance landed on that tab. Now
// Appearance is a row of General's Settings card right after Personality
// and Model (glyph, name, grey line, the mascot's name as its value,
// chevron) that pushes the Appearance pane as a sub-page, and every way
// that opened the tab (the avatar, a deep link, `openAppearance`) opens
// that sub-page. The views live in the app target, so these checks read
// its sources, as PhoneLayoutTests does.
import Foundation
import XCTest

final class BotProfileAppearanceRowTests: XCTestCase {
    private func source(_ path: String) throws -> String {
        let ios = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try String(contentsOf: ios.appendingPathComponent(path), encoding: .utf8)
    }

    /// The text of one member: from `start` to the next member at the same indent.
    private func member(_ text: String, from start: String) throws -> String {
        let begin = try XCTUnwrap(text.range(of: start), "\(start) is gone")
        let rest = text[begin.upperBound...]
        let end = ["\n    private var ", "\n    private func ", "\n    private static ", "\n    // MARK: ", "\n    var ", "\n    static "]
            .compactMap { rest.range(of: $0)?.lowerBound }.min() ?? rest.endIndex
        return String(rest[..<end])
    }

    private func position(_ text: String, _ needle: String) throws -> String.Index {
        try XCTUnwrap(text.range(of: needle), "\(needle) is missing").lowerBound
    }

    func testTheAppearanceTabLeavesTheTabRow() throws {
        let page = try source("App/Profile/BotProfilePage.swift")
        let tabs = try member(page, from: "enum BotProfileTab:")
        XCTAssertFalse(tabs.contains("appearance"), "no Appearance tab: \(tabs)")
        XCTAssertTrue(page.contains("static var visible: [BotProfileTab] { [.general, .knowledge, .stats] }"))
        // the pane is no longer a tab body of the page
        XCTAssertFalse(page.contains("case .appearance: appearanceBody"))
        XCTAssertFalse(page.contains("tab = .appearance"))
    }

    func testAppearanceIsASettingsRowRightAfterPersonalityAndModel() throws {
        let page = try source("App/Profile/BotProfilePage.swift")
        let rows = try member(page, from: "private var settingsRows: [LinkRow] {")
        let soul = try position(rows, "\"bot-profile-settings.soul\"")
        let model = try position(rows, "\"bot-profile-settings.model\"")
        let appearance = try position(rows, "\"bot-profile-settings.appearance\"")
        let before = try position(rows, "\"bot-profile-settings.permissions\"")
        XCTAssertTrue(soul < model && model < appearance && appearance < before, "Personality, Model, Appearance, Before acting")
        // the same row style: a glyph, the name, the mascot's name as its value
        let row = String(rows[appearance..<before])
        XCTAssertTrue(row.contains("title: \"Appearance\""))
        XCTAssertTrue(row.contains("symbol: \"paintpalette\""))
        XCTAssertTrue(row.contains("PersonaWardrobe.lookName(current)"))
        // it pushes the sub-page, like Personality and Model
        XCTAssertTrue(row.contains("openAppearance()"))
        // the grey line of the desktop's row
        XCTAssertTrue(page.contains("\"bot-profile-settings.appearance\": \"Mascot, shape, color, skin\""))
        // what the tab's search found still finds the row
        XCTAssertTrue(row.contains("keywords: Self.appearanceWords"))
    }

    func testTheRowValueIsTheMascotsNameOrPicture() throws {
        let pane = try source("App/Desktop/PersonaAppearancePane.swift")
        let value = try member(pane, from: "static func lookName(_ bot: Bot) -> String {")
        XCTAssertTrue(value.contains("resolveBotAvatarOutcome("))
        XCTAssertTrue(value.contains("\"Picture\""))
        XCTAssertTrue(value.contains("shapeName(look.shape)"))
        XCTAssertTrue(value.contains("characterName(look.character)"))
    }

    func testThePhonePushesTheAppearancePane() throws {
        let panel = try source("App/Profile/BotPanelPhone.swift")
        XCTAssertTrue(panel.contains("openAppearance: { path.append(PanelOverviewPage.appearance) }"))
        let pages = try member(panel, from: "private func overviewPage(")
        XCTAssertTrue(pages.contains("case .appearance: AnyView(BotAppearancePane(bot: current).phonePanelColumn())"))
        XCTAssertTrue(panel.contains("case .appearance: \"Appearance\""))
    }

    func testTheTabletOpensAppearanceAsASubPage() throws {
        let host = try source("App/Desktop/DesktopBotProfileHost.swift")
        // Appearance is a sub-page of the profile (back to Profile), no longer unfolded in the page
        XCTAssertFalse(host.contains("model.personaPage == .appearance && model.panelSection == nil"))
        XCTAssertFalse(host.contains("openAppearance: model.personaPage"))
        XCTAssertTrue(host.contains("openAppearance: { showAppearance() }"))
        XCTAssertTrue(host.contains("editAvatar: { showAppearance() }"))
        let page = try source("App/Profile/BotProfilePage.swift")
        XCTAssertFalse(page.contains("var openAppearance = false"))
        XCTAssertFalse(page.contains("onAppearanceOpened"))
        let actions = try source("App/Profile/BotEditPhone.swift")
        XCTAssertTrue(actions.contains("var openAppearance: (() -> Void)? = nil"))
    }

    func testTheRowIsTranslated() throws {
        let data = try Data(contentsOf: URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("App/Localizable.xcstrings"))
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let strings = try XCTUnwrap(root["strings"] as? [String: Any])
        let entry = try XCTUnwrap(strings["Mascot, shape, color, skin"] as? [String: Any])
        let fr = try XCTUnwrap(((entry["localizations"] as? [String: Any])?["fr"] as? [String: Any])?["stringUnit"] as? [String: Any])
        XCTAssertEqual(fr["value"] as? String, "Mascotte, forme, couleur, skin")
    }
}
