import XCTest
@testable import CompanionCore

final class DeliveredNotificationsTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_000_000)

    func testWithdrawsOnlySettledBotConversationsPastTheGrace() {
        let alpha = bot("a", tasks: [
            task("read"),
            task("unread", unread: true),
            task("waiting", activity: "waiting-on-you"),
            task("fresh"),
        ])
        let delivered = [
            item("1", "a", "read", age: 60),
            item("2", "a", "unread", age: 60),
            item("3", "a", "waiting", age: 60),
            item("4", "a", "fresh", age: 2),
            item("5", "room", "dm", age: 60),
            item("6", "a", "unknown", age: 60),
            item("7", nil, "read", age: 60),
        ]
        XCTAssertEqual(DeliveredNotifications.settled(delivered, bots: [alpha], now: now), ["1"])
    }

    func testAReadPushWithdrawsThatConversationsBanners() {
        let delivered = [item("1", "a", "t1", age: 0), item("2", "a", "t2", age: 0), item("3", nil, "t1", age: 0)]
        XCTAssertEqual(DeliveredNotifications.forThread(delivered, threadId: "t1"), ["1", "3"])
    }

    func testReadPushKindParses() {
        let payload = PushPayload(userInfo: ["aps": ["content-available": 1], "kind": "read", "threadId": "t1", "at": 5])
        XCTAssertEqual(payload?.kind, .read)
        XCTAssertEqual(payload?.threadId, "t1")
    }

    func testHiddenConversationsStayOutOfTheListAndBadge() {
        var hidden = task("h", unread: true)
        hidden.hidden = true
        let alpha = bot("a", tasks: [task("t"), hidden])
        XCTAssertEqual(alpha.visibleTasks.map(\.threadId), ["t"])
        XCTAssertTrue(alpha.attentionTasks().isEmpty)
        XCTAssertTrue(hidden.isHiddenFromPerson)
    }

    /// 2026-10-22 (JC): a routine's automatic results thread is no row, no
    /// badge and never the single chat's home; reports go to the person's chat.
    func testRoutineResultsThreadsStayOutOfTheListBadgeAndStream() throws {
        var results = task("r", unread: true)
        results.routineResults = true
        let alpha = bot("a", tasks: [task("t"), results])
        XCTAssertEqual(alpha.visibleTasks.map(\.threadId), ["t"])
        XCTAssertTrue(alpha.attentionTasks().isEmpty)
        XCTAssertFalse(FreshTopic.isSegment(results))
        let json = #"{"threadId":"r","title":"t","createdAt":0,"modelSelection":{"instanceId":"e","model":"m"},"routineResults":true}"#
        XCTAssertEqual(try JSONDecoder().decode(BotTask.self, from: Data(json.utf8)).routineResults, true)
    }

    func testDecodesTheHiddenFlag() throws {
        let json = #"{"threadId":"h","title":"t","createdAt":0,"modelSelection":{"instanceId":"e","model":"m"},"hidden":true}"#
        let decoded = try JSONDecoder().decode(BotTask.self, from: Data(json.utf8))
        XCTAssertEqual(decoded.hidden, true)
    }

    private func item(_ id: String, _ botId: String?, _ threadId: String, age: TimeInterval) -> DeliveredNotifications.Delivered {
        .init(id: id, botId: botId, threadId: threadId, date: now.addingTimeInterval(-age))
    }

    private func task(_ id: String, activity: String? = nil, unread: Bool? = false) -> BotTask {
        var task = BotTask(threadId: id, title: id, createdAt: 0)
        task.activity = activity
        task.unread = unread
        return task
    }

    private func bot(_ id: String, tasks: [BotTask]) -> Bot {
        Bot(
            id: id, threadId: tasks.first?.threadId ?? "", name: id, title: id,
            description: "", notifications: true, color: "green", unread: false,
            modelSelection: ModelSelection(instanceId: "engine", model: "default"),
            createdAt: 0, tasks: tasks
        )
    }
}
