// Sagax in the car: Siri finds the bot it heard, a reply to an announced
// message goes back to that bot's conversation, a CallKit handle names the
// bot, and the CarPlay rules (voice first, nothing to read) hold.
import XCTest
@testable import CompanionCore

final class CarAssistTests: XCTestCase {
    private func bot(_ id: String, name: String, threadId: String? = nil, createdAt: Double = 1, hidden: Bool = false, lastMessageAt: Double? = nil) throws -> Bot {
        var json: [String: Any] = [
            "id": id, "threadId": threadId ?? "t-\(id)", "name": name, "title": "", "description": "", "notifications": true,
            "color": "green", "unread": false, "modelSelection": ["instanceId": "engine", "model": "m"], "createdAt": createdAt,
            "hidden": hidden,
        ]
        if let lastMessageAt {
            json["messages"] = [["id": "m-\(id)", "role": "bot", "kind": "text", "text": "secret words", "at": lastMessageAt]]
        }
        return try JSONDecoder().decode(Bot.self, from: JSONSerialization.data(withJSONObject: json))
    }

    private func room(_ id: String, name: String, peopleDm: Bool = false) throws -> Room {
        var json: [String: Any] = [
            "id": id, "threadId": "rt-\(id)", "name": name, "memberIds": ["b1"], "defaultResponder": ["kind": "first"],
            "bulletin": "", "unread": false, "createdAt": 5,
        ]
        if peopleDm { json["peopleDm"] = true }
        return try JSONDecoder().decode(Room.self, from: JSONSerialization.data(withJSONObject: json))
    }

    private func contacts() throws -> [CarContact] {
        CarDirectory.contacts(
            bots: [
                try bot("b1", name: "Scout", createdAt: 10),
                try bot("b2", name: "Éclaireur", createdAt: 20),
                try bot("b3", name: "Atlas Finance", createdAt: 30),
                try bot("b4", name: "Atlas Support", createdAt: 40),
                try bot("b5", name: "Ghost", hidden: true),
            ],
            rooms: [try room("r1", name: "Ops"), try room("r2", name: "Alex", peopleDm: true)]
        )
    }

    // MARK: - Directory

    func testTheDirectoryLeavesOutHiddenBotsAndPeopleAndPutsTheRecentFirst() throws {
        let rows = CarDirectory.contacts(
            bots: [
                try bot("old", name: "Old", createdAt: 1),
                try bot("talked", name: "Talked", createdAt: 1, lastMessageAt: 500),
                try bot("new", name: "New", createdAt: 100),
                try bot("gone", name: "Gone", createdAt: 900, hidden: true),
            ],
            rooms: [try room("ops", name: "Ops"), try room("dm", name: "Alex", peopleDm: true)]
        )
        XCTAssertEqual(rows.map(\.id), ["talked", "new", "ops", "old"])
        XCTAssertEqual(rows.first?.destination, .bot(id: "talked", threadId: "t-talked"))
        XCTAssertEqual(rows.first { $0.id == "ops" }?.destination, .room(id: "ops", threadId: "rt-ops"))
    }

    func testTheCarListHoldsOnlyBotsAndIsShort() throws {
        let bots = try (0..<20).map { try bot("b\($0)", name: "Bot \($0)", createdAt: Double($0)) }
        let list = CarDirectory.recentBots(CarDirectory.contacts(bots: bots, rooms: [try room("ops", name: "Ops")]))
        XCTAssertEqual(list.count, CarDirectory.carLimit)
        XCTAssertTrue(list.allSatisfy { $0.kind == .bot })
        XCTAssertEqual(list.first?.id, "b19")
    }

    func testACarContactCarriesNoMessageContent() throws {
        // the car's screen never shows a message (CarPlay guideline 6): the
        // row is made of the name and ids only
        let row = try XCTUnwrap(CarDirectory.contacts(bots: [try bot("b", name: "Scout", lastMessageAt: 9)]).first)
        let mirror = Mirror(reflecting: row).children.compactMap { $0.value as? String }
        XCTAssertFalse(mirror.contains { $0.contains("secret") })
    }

    // MARK: - Siri resolution

    func testSiriFindsABotWhateverTheCaseAccentsOrArticle() throws {
        let all = try contacts()
        XCTAssertEqual(CarDirectory.resolve("scout", in: all), .one(all.first { $0.id == "b1" }!))
        XCTAssertEqual(CarDirectory.resolve("l'eclaireur", in: all), .one(all.first { $0.id == "b2" }!))
        XCTAssertEqual(CarDirectory.resolve("the bot Scout", in: all), .one(all.first { $0.id == "b1" }!))
        XCTAssertEqual(CarDirectory.resolve("ops", in: all), .one(all.first { $0.id == "r1" }!))
    }

    func testTwoBotsForOneNameAskWhichOne() throws {
        let all = try contacts()
        guard case let .several(found) = CarDirectory.resolve("Atlas", in: all) else { return XCTFail("expected a choice") }
        XCTAssertEqual(Set(found.map(\.id)), ["b3", "b4"])
        XCTAssertEqual(CarDirectory.resolve("atlas support", in: all), .one(all.first { $0.id == "b4" }!))
        XCTAssertEqual(CarDirectory.resolve("support", in: all), .one(all.first { $0.id == "b4" }!))
    }

    func testANameNobodyHasIsNoneAndHiddenOrPeopleAreNeverReached() throws {
        let all = try contacts()
        XCTAssertEqual(CarDirectory.resolve("Zebra", in: all), .none)
        XCTAssertEqual(CarDirectory.resolve("   ", in: all), .none)
        XCTAssertEqual(CarDirectory.resolve("Ghost", in: all), .none)
        XCTAssertEqual(CarDirectory.resolve("Alex", in: all), .none)
    }

    func testAReplyToAnAnnouncedMessageGoesBackToThatConversation() throws {
        let all = try contacts()
        // Siri's reply carries the donated conversation (the thread) and the sender id
        XCTAssertEqual(CarDirectory.route(conversationId: "t-b2", personIds: [], spokenNames: ["Scout"], in: all),
                       .one(all.first { $0.id == "b2" }!))
        XCTAssertEqual(CarDirectory.route(conversationId: nil, personIds: ["b1"], spokenNames: [], in: all),
                       .one(all.first { $0.id == "b1" }!))
        XCTAssertEqual(CarDirectory.route(conversationId: "unknown", personIds: ["sagax-bot:b3"], spokenNames: [], in: all),
                       .one(all.first { $0.id == "b3" }!))
        XCTAssertEqual(CarDirectory.route(conversationId: nil, personIds: [], spokenNames: ["Scout", "Ops"], in: all),
                       .one(all.first { $0.id == "b1" }!))
        XCTAssertEqual(CarDirectory.route(conversationId: nil, personIds: [], spokenNames: [], in: all), .none)
    }

    // MARK: - CallKit handle

    func testTheCallHandleNamesTheBotAndRoundTrips() {
        let handle = CarCallHandle.value(kind: .bot, id: "b1")
        XCTAssertEqual(handle, "sagax-bot:b1")
        XCTAssertEqual(CarCallHandle.contactId(from: handle), "b1")
        XCTAssertEqual(CarCallHandle.contactId(from: CarCallHandle.value(kind: .room, id: "ops")), "ops")
        XCTAssertNil(CarCallHandle.contactId(from: "Scout"))
        XCTAssertNil(CarCallHandle.contactId(from: "sagax-bot:"))
        XCTAssertNil(CarCallHandle.contactId(from: nil))
    }

    // MARK: - Driving

    func testInTheCarASkillWaitsAndTheRestIsAskedAloud() {
        XCTAssertEqual(DrivingSafety.approval(.skill), .waitsForPhone)
        XCTAssertEqual(DrivingSafety.approval(.command), .byVoice)
        XCTAssertEqual(DrivingSafety.approval(.routine), .byVoice)
        XCTAssertEqual(DrivingSafety.approval(.profile), .byVoice)
    }

    func testACommandIsReadShorterWhileDriving() {
        let long = String(repeating: "word ", count: 60)
        XCTAssertEqual(DrivingSafety.spokenDetail(long, driving: false).count, DrivingSafety.spokenDetailLimit)
        let driving = DrivingSafety.spokenDetail(long, driving: true)
        XCTAssertLessThanOrEqual(driving.count, DrivingSafety.drivingSpokenDetailLimit)
        XCTAssertFalse(driving.hasSuffix(" "))
        XCTAssertTrue(driving.hasSuffix("word"))
        XCTAssertEqual(DrivingSafety.spokenDetail("  ls -la  ", driving: true), "ls -la")
    }

    func testTheVoiceScreenFollowsTheCall() {
        XCTAssertEqual(CarVoiceState(CallState(phase: .connecting)), .connecting)
        XCTAssertEqual(CarVoiceState(CallState(phase: .listening)), .listening)
        XCTAssertEqual(CarVoiceState(CallState(phase: .hearing)), .listening)
        XCTAssertEqual(CarVoiceState(CallState(phase: .interrupted)), .listening)
        XCTAssertEqual(CarVoiceState(CallState(phase: .thinking)), .thinking)
        XCTAssertEqual(CarVoiceState(CallState(phase: .speaking)), .speaking)
        XCTAssertEqual(CarVoiceState(CallState(phase: .held)), .paused)
        XCTAssertEqual(CarVoiceState(CallState(phase: .listening, muted: true)), .paused)
        XCTAssertNil(CarVoiceState(CallState(phase: .ended)))
        // CPVoiceControlTemplate keeps at most five states
        XCTAssertLessThanOrEqual(CarVoiceState.allCases.count, 5)
    }

    // MARK: - Tabs and the To answer list

    func testTheBotsTabIsAlphabeticalAndTheRecentTabFollowsActivity() throws {
        let rows = try contacts()
        XCTAssertEqual(CarDirectory.alphabeticalBots(rows).map(\.name), ["Atlas Finance", "Atlas Support", "Éclaireur", "Scout"])
        XCTAssertEqual(CarDirectory.recentBots(rows).map(\.name), ["Atlas Support", "Atlas Finance", "Éclaireur", "Scout"])
        XCTAssertEqual(CarDirectory.alphabeticalBots(rows, limit: 2).count, 2)
    }

    /// A state where the bot has the card open in its conversation.
    private func state(asking cards: [(id: String, name: String, card: String)]) throws -> CompanionState {
        var state = CompanionState()
        for entry in cards {
            state.bots.append(try bot(entry.id, name: entry.name))
            state.messages["t-\(entry.id)"] = [try JSONDecoder().decode(Message.self, from: Data(
                #"{"id":"m-\#(entry.id)","role":"bot","kind":"options","at":9,"card":\#(entry.card)}"#.utf8))]
        }
        return state
    }

    func testToAnswerListsToolApprovalsByTitleAndLeavesTheOnesThatWaitForThePhone() throws {
        let plain = #"{"title":"Run a command in the shared project folder please","subtitle":"git push","options":["Allow","Deny"],"requestId":"r1","tool":"Bash"}"#
        let question = #"{"title":"Which one?","subtitle":"","options":["A","B"],"requestId":"r2","requestType":"question","questionRequest":{"questions":[]}}"#
        let items = CarApprovals.items(in: try state(asking: [("b1", "Scout", plain), ("b2", "Atlas", question)]))
        XCTAssertEqual(items.map(\.requestId), ["r1"])
        XCTAssertEqual(items.first?.botName, "Scout")
        XCTAssertEqual(items.first?.detail, "git push")
        XCTAssertLessThanOrEqual(items.first?.title.count ?? 99, CarApprovals.titleLimit + 1)
    }

    func testAnAnsweredApprovalLeavesTheList() throws {
        let answered = #"{"title":"Run","subtitle":"","options":["Allow","Deny"],"requestId":"r1","tool":"Bash","answered":"allow"}"#
        XCTAssertTrue(CarApprovals.items(in: try state(asking: [("b1", "Scout", answered)])).isEmpty)
    }
}
