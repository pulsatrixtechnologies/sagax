// Push to Talk: the bot of the channel, the registration the server expects,
// and what an incoming PTT push says.
import Foundation
import XCTest
@testable import CompanionCore

final class PushToTalkTests: XCTestCase {
    private let client = CompanionClient(connection: Connection(name: "Example", host: "bot.example.test", port: 443), token: "t")

    private func bot(_ id: String, primary: Bool = false) -> Bot {
        var bot = Bot(id: id, threadId: "t-" + id, name: id, title: id, description: "", notifications: true, color: "green", unread: false,
                      modelSelection: ModelSelection(instanceId: "engine", model: "default"), createdAt: 0)
        bot.chiefOfStaff = primary
        return bot
    }

    func testTheVoiceEntryTalksToTheChosenBotElseThePrimaryElseTheFirst() {
        let bots = [bot("a"), bot("b", primary: true), bot("c")]
        XCTAssertEqual(PrimaryBotChoice.bot(chosenId: "c", bots: bots)?.id, "c")
        XCTAssertEqual(PrimaryBotChoice.bot(chosenId: "gone", bots: bots)?.id, "b")
        XCTAssertEqual(PrimaryBotChoice.bot(chosenId: nil, bots: bots)?.id, "b")
        XCTAssertEqual(PrimaryBotChoice.bot(chosenId: nil, bots: [bot("a")])?.id, "a")
        XCTAssertNil(PrimaryBotChoice.bot(chosenId: nil, bots: []))
    }

    func testARegistrationIsWhatTheServerExpects() throws {
        let id = UUID()
        let request = try client.registerPushToTalkRequest(PushToTalkRegistration(token: "abcd", channelId: id, botId: "b1", environment: .sandbox, appVersion: "1.0 (1)"))
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/push/ptt")
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any])
        XCTAssertEqual(Set(json.keys), ["token", "channelId", "botId", "environment", "appVersion"])
        XCTAssertEqual(json["channelId"] as? String, id.uuidString.lowercased())
        XCTAssertEqual(json["environment"] as? String, "sandbox")
    }

    func testTheCallIdIsThePrefixTheServerKnows() {
        XCTAssertTrue(PushToTalkChannel.callId().hasPrefix("ptt-"))
    }

    func testAnIncomingPushNamesTheSpeakerAndCarriesTheWords() {
        let incoming = PushToTalkIncoming(payload: ["activeSpeaker": "Scout", "botId": "b1", "threadId": "t1", "text": " Done. "])
        XCTAssertEqual(incoming, PushToTalkIncoming(payload: ["activeSpeaker": "Scout", "botId": "b1", "threadId": "t1", "text": "Done."]))
        XCTAssertEqual(incoming?.text, "Done.")
        // no speaker: the channel is left, never a mystery voice
        XCTAssertNil(PushToTalkIncoming(payload: ["text": "x"]))
        XCTAssertNil(PushToTalkIncoming(payload: ["activeSpeaker": "  "]))
    }

    func testTheWordsAreSpokenSentenceBySentence() {
        XCTAssertEqual(PushToTalkSpeech.sentences("First one. Second one! Third?"), ["First one.", "Second one!", "Third?"])
        XCTAssertEqual(PushToTalkSpeech.sentences("  "), [])
    }

    func testThePrefsKeepTheChoiceAndOneStableChannel() {
        let defaults = UserDefaults(suiteName: "ptt-tests-" + UUID().uuidString)!
        let prefs = PushToTalkPrefs(defaults: defaults)
        XCTAssertFalse(prefs.enabled)
        XCTAssertNil(prefs.botId)
        let first = prefs.channelUUID
        XCTAssertEqual(prefs.channelUUID, first)
        prefs.enabled = true; prefs.botId = "b2"
        XCTAssertTrue(prefs.enabled)
        XCTAssertEqual(prefs.botId, "b2")
        prefs.botId = nil
        XCTAssertNil(prefs.botId)
    }
}
