import XCTest
@testable import CompanionCore

final class BotBubbleTests: XCTestCase {
    private let accent = SkinColor(0x316EF3)

    func testOffKeepsTheSkin() throws {
        let grey = try XCTUnwrap(SkinColor(css: "#252525"))
        XCTAssertNil(BotBubble.paint(enabled: false, accent: accent, base: grey, ink: SkinColor(0xFFFFFF)))
    }

    func testOnMixesFourteenPercentOfTheAccentIntoTheGreyAndKeepsTheInk() throws {
        let grey = try XCTUnwrap(SkinColor(css: "#252525"))
        let ink = SkinColor(0xFFFFFF)
        let painted = try XCTUnwrap(BotBubble.paint(enabled: true, accent: accent, base: grey, ink: ink))
        XCTAssertEqual(BotBubble.tint, 0.14)
        XCTAssertEqual(painted.ink, ink)
        // 0.14 * 0x31 + 0.86 * 0x25 = 38.66 -> 0x27 (red), as the desktop's color-mix
        XCTAssertEqual(painted.fill.red * 255, 0.14 * 0x31 + 0.86 * 0x25, accuracy: 1)
        XCTAssertEqual(painted.fill.blue * 255, 0.14 * 0xF3 + 0.86 * 0x25, accuracy: 1)
    }

    func testTheTintedBubbleKeepsTheInkReadableInEverySkin() {
        for id in SkinID.allCases {
            let palette = id.palette
            guard let painted = BotBubble.paint(enabled: true, accent: palette.accent, base: palette.bubbleAssistant, ink: palette.bubbleAssistantText) else {
                return XCTFail("no paint for \(id)")
            }
            XCTAssertGreaterThanOrEqual(BotAccent.contrast(painted.ink, painted.fill), 4.5, "\(id)")
        }
    }

    func testBothChoicesAreSyncedPreferencesWithTheDesktopDefaults() {
        var prefs = SidebarPrefs()
        XCTAssertFalse(prefs.botBubble)
        XCTAssertTrue(prefs.botReplyBubbles)
        prefs.setBotBubble(true)
        XCTAssertEqual(prefs.values[BotBubble.key], "1")
        prefs.setBotBubble(false)
        XCTAssertNil(prefs.values[BotBubble.key])
        prefs.setBotReplyBubbles(false)
        XCTAssertEqual(prefs.values["sagax.botReplyBubbles.v1"], "off")
        XCTAssertFalse(prefs.botReplyBubbles)
        prefs.setBotReplyBubbles(true)
        XCTAssertEqual(prefs.values["sagax.botReplyBubbles.v1"], "on")
        XCTAssertTrue(SidebarPrefKey.synced.contains("sagax.botReplyBubbles.v1"))
        XCTAssertTrue(SidebarPrefKey.synced.contains(BotBubble.key))
    }

    /// The phone mixes over its palette's grey, the iPad desktop layout over
    /// its own colour set's grey: one mix, two bases, never the other's grey.
    func testTheMixIsTheSameOverThePhoneGreyAndTheDesktopGrey() throws {
        let phoneGrey = try XCTUnwrap(SkinColor(css: "#202020"))
        let desktopGrey = try XCTUnwrap(SkinColor(css: "#252525"))
        let phone = BotBubble.tinted(accent: accent, base: phoneGrey)
        let desktop = BotBubble.tinted(accent: accent, base: desktopGrey)
        XCTAssertNotEqual(phone, desktop)
        XCTAssertEqual(BotBubble.paint(enabled: true, accent: accent, base: phoneGrey, ink: SkinColor(0xFFFFFF))?.fill, phone)
        XCTAssertEqual(BotBubble.paint(enabled: true, accent: accent, base: desktopGrey, ink: SkinColor(0xFFFFFF))?.fill, desktop)
        XCTAssertEqual(desktop.red * 255, 0.14 * 0x31 + 0.86 * 0x25, accuracy: 1)
    }
}
