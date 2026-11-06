// Tabs, doors, voice prefs and privacy line for the Grok Bot panel (#2127).
import XCTest
@testable import CompanionCore

final class BotPanelGrokParityTests: XCTestCase {
    func testVisibleTabsAreActivityAndLibrary() {
        XCTAssertEqual(
            DesktopPanelTab.visible(gate: SurfaceGate(scope: .serverAdmin)),
            [.activity, .library]
        )
    }

    func testLegacyDetailsAndComputerResolveToActivity() {
        XCTAssertEqual(DesktopPanelTab.parse("details"), .activity)
        XCTAssertEqual(DesktopPanelTab.parse("computer"), .activity)
        XCTAssertEqual(DesktopPanelTab.resolve(.computer), .activity)
    }

    func testVoicePrefsFallBackWhenAbsent() throws {
        var json: [String: Any] = [
            "id": "b1", "threadId": "t1", "name": "Ara", "title": "", "description": "",
            "notifications": true, "color": "green", "unread": false,
            "modelSelection": ["instanceId": "claude", "model": "m"], "createdAt": 1,
        ]
        let bare = try JSONDecoder().decode(Bot.self, from: JSONSerialization.data(withJSONObject: json))
        XCTAssertNil(bare.voiceSpeed)
        XCTAssertNil(bare.voiceLanguage)
        XCTAssertEqual(BotVoicePrefs.speed(bot: bare, fallback: 1.25), 1.25)
        XCTAssertEqual(BotVoicePrefs.language(bot: bare, fallback: "fr"), "fr")

        json["voiceSpeed"] = 1.5
        json["voiceLanguage"] = "en"
        let filled = try JSONDecoder().decode(Bot.self, from: JSONSerialization.data(withJSONObject: json))
        XCTAssertEqual(BotVoicePrefs.speed(bot: filled), 1.5)
        XCTAssertEqual(BotVoicePrefs.language(bot: filled), "en")
    }

    func testPrivacyLabelPrivateOnSoloComputer() {
        XCTAssertTrue(BotPrivacyLabel.isPrivateToViewer(visibility: nil, sharedWithOthers: false, organization: false))
        XCTAssertEqual(
            BotPrivacyLabel.text(visibility: nil, sharedWithOthers: false, organization: false),
            "Private to you"
        )
        XCTAssertFalse(BotPrivacyLabel.isPrivateToViewer(visibility: .everyone, sharedWithOthers: false, organization: true))
        XCTAssertFalse(BotPrivacyLabel.isPrivateToViewer(visibility: nil, sharedWithOthers: true, organization: false))
    }

    func testNestedVoicePrefsParse() {
        let nested = BotVoicePrefs.nested(from: ["id": "ara", "speed": 1.25, "language": "auto"])
        XCTAssertEqual(nested?.id, "ara")
        XCTAssertEqual(nested?.speed, 1.25)
        XCTAssertEqual(nested?.language, "auto")
        XCTAssertNil(BotVoicePrefs.nested(from: "ara"))
    }
}
