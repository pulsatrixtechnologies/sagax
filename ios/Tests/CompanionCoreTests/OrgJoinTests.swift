import XCTest
@testable import CompanionCore

final class OrgJoinTests: XCTestCase {
    private func bot(_ id: String, owner: String? = nil, hidden: Bool? = nil) throws -> Bot {
        var bot = Bot(id: id, threadId: "t-\(id)", name: id, title: "", description: "", notifications: true, color: "blue",
                      unread: false, modelSelection: ModelSelection(instanceId: "own", model: "m"), createdAt: 0)
        bot.ownerUserId = owner
        bot.hidden = hidden
        return bot
    }

    func testOnlyThePersonsOwnVisibleBotsAreOffered() throws {
        let bots = [try bot("Ara"), try bot("Helios", owner: "local-owner"), try bot("Osprey", owner: "someone"), try bot("Lux", hidden: true)]
        XCTAssertEqual(OrgJoin.offered(bots, principalId: nil).map(\.id), ["Ara", "Helios"])
        XCTAssertEqual(OrgJoin.offered(bots, principalId: "Someone").map(\.id), ["Ara", "Helios", "Osprey"])
    }

    func testChoosingConversationsChoosesTheBotAndTheRequestKeepsListOrder() throws {
        let bots = [try bot("Ara"), try bot("Helios")]
        var choices = OrgJoin.with([:], bot: "Helios", threads: true)
        XCTAssertEqual(choices["Helios"], OrgJoinChoice(copy: true, threads: true, memory: true))
        choices = OrgJoin.with(choices, bot: "Ara", copy: true)
        let request = OrgJoin.request(bots, choices)
        XCTAssertEqual(request.compactMap { $0["id"] as? String }, ["Ara", "Helios"])
        XCTAssertTrue(OrgJoin.request(bots, [:]).isEmpty)
    }
}
