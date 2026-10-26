import XCTest
@testable import CompanionCore

final class BotConversationsTests: XCTestCase {
    private func row(_ id: String, at: Double, direction: String = "out") -> BotConversation {
        BotConversation(threadId: id, otherBotId: "b", otherName: "Bravo", direction: direction, startedAt: at)
    }

    func testDecodesTheServerRow() throws {
        let json = #"{"threadId":"t","otherBotId":"b","otherName":"Bravo","direction":"in","kind":"pair","updatedAt":5,"running":true}"#
        let value = try JSONDecoder().decode(BotConversation.self, from: Data(json.utf8))
        XCTAssertEqual(value.running, true)
        XCTAssertEqual(value.at, 5)
        XCTAssertNil(value.destinationBotId)
    }

    func testAnchorsSitBeforeTheNextRowOrAfterTheLast() {
        let a = BotConversations.anchors([row("x", at: 15), row("y", at: 99)], rowStarts: [10, 20, 30], hasMore: false)
        XCTAssertEqual(a.before[1]?.map(\.threadId), ["x"])
        XCTAssertEqual(a.after.map(\.threadId), ["y"])
    }

    func testOlderThanTheWindowIsLeftOutWhileEarlierPagesRemain() {
        let a = BotConversations.anchors([row("x", at: 1)], rowStarts: [10], hasMore: true)
        XCTAssertTrue(a.before.isEmpty && a.after.isEmpty)
    }

    func testLinesCreditEachBotAndSkipTools() {
        var user = Message(id: "1", role: .user, kind: .text, at: 1); user.text = "Hi"
        var reply = Message(id: "2", role: .bot, kind: .text, at: 2); reply.text = "Hello"
        var tool = Message(id: "3", role: .bot, kind: .activity, at: 3); tool.text = "x"
        let out = BotConversations.lines([user, reply, tool], selfId: "a", selfName: "Alpha", row: row("t", at: 0))
        XCTAssertEqual(out.map(\.speakerName), ["Alpha", "Bravo"])
        let back = BotConversations.lines([user, reply], selfId: "a", selfName: "Alpha", row: row("t", at: 0, direction: "in"))
        XCTAssertEqual(back.map(\.speakerName), ["Bravo", "Alpha"])
    }

    func testPreviewIsTheLatestWordsWithoutTheProvenanceNote() {
        var peer = Message(id: "1", role: .user, kind: .text, at: 1)
        peer.text = "[Message from @Bravo, another bot in this Sagax workspace.] Quel est le total ?"
        peer.peerAsk = PeerAsk(botId: "b", name: "Bravo", unattended: nil)
        var reply = Message(id: "2", role: .bot, kind: .text, at: 2)
        reply.text = "38 heures."
        let text = BotConversations.previewText([peer, reply], selfId: "a", selfName: "Alpha", row: row("t", at: 0))
        XCTAssertEqual(text, "38 heures.")
        let lines = BotConversations.lines([peer], selfId: "a", selfName: "Alpha", row: row("t", at: 0))
        XCTAssertEqual(lines.map(\.text), ["Quel est le total ?"])
        XCTAssertEqual(lines.map(\.speakerName), ["Bravo"])
    }

    func testVisibleOnlyOnTheMainThreadAndSkipsALinkedExchange() {
        let rows = [row("w1", at: 1), row("w2", at: 2)]
        XCTAssertEqual(
            BotConversations.visible(rows, openThreadId: "main", mainThreadId: "main", fallbackThreadId: "main", linkedThreadIds: []).map(\.threadId),
            ["w1", "w2"])
        XCTAssertTrue(BotConversations.visible(rows, openThreadId: "task", mainThreadId: "main", fallbackThreadId: "side", linkedThreadIds: []).isEmpty)
        XCTAssertEqual(
            BotConversations.visible(rows, openThreadId: "main", mainThreadId: nil, fallbackThreadId: "main", linkedThreadIds: ["w1"]).map(\.threadId),
            ["w2"])
        XCTAssertEqual(
            BotConversations.visible(rows, openThreadId: "w2", mainThreadId: "w2", fallbackThreadId: "w2", linkedThreadIds: []).map(\.threadId),
            ["w1"])
    }

    func testLinkedThreadIdsComeFromTheReceiptAndTheComm() throws {
        var ref = Message(id: "1", role: .bot, kind: .activity, at: 1)
        ref.threadRef = ThreadRef(botId: "b", threadId: "w1", title: "x")
        let comm = try JSONDecoder().decode(Message.self, from: Data("""
        {"id":"2","role":"bot","kind":"activity","at":2,"comm":{"groupId":"g","threadId":"w2","withBotId":"b","withName":"Bravo","withColor":"blue"}}
        """.utf8))
        XCTAssertEqual(BotConversations.linkedThreadIds(in: [ref, comm]), Set(["w1", "w2"]))
    }

    func testDecodesTheRowOnTheBotAndItsMainThread() throws {
        let bot = try JSONDecoder().decode(Bot.self, from: Data("""
        {"id":"a","threadId":"selected","mainThreadId":"main","name":"Alpha","title":"",
         "description":"","notifications":true,"color":"green","unread":false,
         "modelSelection":{"instanceId":"e","model":"m"},"createdAt":1,
         "botConversations":[{"threadId":"t","otherBotId":"b","otherName":"Bravo","direction":"out","running":true}]}
        """.utf8))
        XCTAssertEqual(bot.mainThreadId, "main")
        XCTAssertEqual(bot.botConversations?.first?.destinationBotId, "b")
        XCTAssertEqual(bot.botConversations?.first?.running, true)
    }
}
