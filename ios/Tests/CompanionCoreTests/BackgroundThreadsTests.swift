import Foundation
import XCTest
@testable import CompanionCore

/// The background-thread rule, the desktop's and the server's cases
/// (shared/background-threads.vectors.json), run here too.
final class BackgroundThreadsTests: XCTestCase {
    private func cases() throws -> [(name: String, task: BotTask, origin: String?, listed: Bool, background: Bool)] {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("shared/background-threads.vectors.json")
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        return try XCTUnwrap(root["cases"] as? [[String: Any]]).map { item in
            var fields = try XCTUnwrap(item["task"] as? [String: Any])
            fields["title"] = fields["title"] ?? ""
            fields.removeValue(forKey: "parallelOf")
            let task = try JSONDecoder().decode(BotTask.self, from: JSONSerialization.data(withJSONObject: fields))
            return (try XCTUnwrap(item["name"] as? String), task, item["origin"] as? String,
                    try XCTUnwrap(item["listed"] as? Bool), try XCTUnwrap(item["background"] as? Bool))
        }
    }

    private func makeBot(threadId: String, tasks: [BotTask]) -> Bot {
        Bot(id: "scout", threadId: threadId, name: "Scout", title: "Assistant",
            description: "", notifications: true, color: "green", unread: false,
            modelSelection: ModelSelection(instanceId: "engine", model: "default"), createdAt: 1,
            tasks: tasks)
    }

    func testSharedVectors() throws {
        let all = try cases()
        XCTAssertGreaterThan(all.count, 8)
        for item in all {
            XCTAssertEqual(item.task.isBackground, item.origin != nil, item.name)
            XCTAssertEqual(item.task.isListedBackground, item.background, item.name)
            let bot = makeBot(threadId: "elsewhere", tasks: [item.task])
            XCTAssertEqual(bot.visibleTasks.count == 1, item.listed, item.name)
            XCTAssertEqual(bot.backgroundTasks.count == 1, item.background, item.name)
        }
    }

    func testThreadOnScreenStaysReachableButARunDoesNot() throws {
        var work = BotTask(threadId: "work", title: "@Parker · work", createdAt: 1)
        work.openedBy = ThreadOpener(botId: "parker", name: "Parker", at: 1, kind: "work")
        var run = BotTask(threadId: "run", title: "Run", createdAt: 1)
        run.routineRunId = "r1"
        XCTAssertEqual(makeBot(threadId: "work", tasks: [work, run]).visibleTasks.map(\.threadId), ["work"])
        XCTAssertEqual(makeBot(threadId: "run", tasks: [work, run]).visibleTasks.map(\.threadId), [])
    }
}
