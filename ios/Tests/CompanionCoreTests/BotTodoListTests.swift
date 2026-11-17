// The bot's task list on iOS (shared/bot-task-list.ts): the `bot.tasks`
// frame, the GET /api/bots/:id/task-list body, the panel's order and how a
// failed read shows.
import Foundation
import XCTest
@testable import CompanionCore

final class BotTodoListTests: XCTestCase {
    private func frame(_ json: String) throws -> Frame {
        try JSONDecoder().decode(Frame.self, from: Data(json.utf8))
    }

    func testBotTasksFrameDecodes() throws {
        guard case let .botTasks(botId) = try frame(#"{"kind":"bot.tasks","seq":7,"botId":"bot-1","audience":"person-1"}"#) else {
            return XCTFail("expected .botTasks")
        }
        XCTAssertEqual(botId, "bot-1")
    }

    func testBotTasksFrameWithoutBotStaysUnknown() throws {
        guard case let .unknown(kind) = try frame(#"{"kind":"bot.tasks","seq":7}"#) else {
            return XCTFail("expected .unknown")
        }
        XCTAssertEqual(kind, "bot.tasks")
        guard case .unknown = try frame(#"{"kind":"bot.tasks.later","seq":8,"botId":"b"}"#) else {
            return XCTFail("an unknown kind stays unknown")
        }
    }

    func testTaskListResponseDecodes() throws {
        let body = #"""
        {"tasks":[
          {"id":"task_aaaaaa","botId":"b1","ownerId":"p1","threadId":"t1","title":"Renew the domain","state":"waiting","createdAt":1000,"updatedAt":2000},
          {"id":"task_bbbbbb","botId":"b1","title":"Write the report","state":"doing","createdAt":1000,"updatedAt":1500},
          {"id":"task_cccccc","botId":"b1","title":"Unknown state","state":"later","createdAt":1,"updatedAt":1}
        ]}
        """#
        struct Body: Decodable { var tasks: [Lossy<BotTodo>] }
        let tasks = try JSONDecoder().decode(Body.self, from: Data(body.utf8)).tasks.compactMap(\.value)
        XCTAssertEqual(tasks.count, 2)
        XCTAssertEqual(tasks[0], BotTodo(id: "task_aaaaaa", botId: "b1", ownerId: "p1", threadId: "t1",
                                         title: "Renew the domain", state: .waiting, createdAt: 1000, updatedAt: 2000))
        XCTAssertNil(tasks[1].threadId)
        XCTAssertEqual(tasks[1].state, .doing)
    }

    func testGroupingOrderWaitingDoingDoneNewestFirst() {
        func task(_ id: String, _ state: BotTodoState, _ at: Double) -> BotTodo {
            BotTodo(id: id, botId: "b", title: id, state: state, createdAt: 0, updatedAt: at)
        }
        let groups = BotTodoList.grouped([
            task("d1", .done, 10), task("w1", .waiting, 1), task("p1", .doing, 5),
            task("w2", .waiting, 9), task("d2", .done, 30), task("p2", .doing, 7),
        ])
        XCTAssertEqual(BotTodoList.groupOrder, [.waiting, .doing, .done])
        XCTAssertEqual(groups.waiting.map(\.id), ["w2", "w1"])
        XCTAssertEqual(groups.doing.map(\.id), ["p2", "p1"])
        XCTAssertEqual(groups.done.map(\.id), ["d2", "d1"])
        XCTAssertTrue(BotTodoList.grouped([]).isEmpty)
    }

    func testListedIsNeedsYouThenInProgressWithNoDoneTask() {
        func task(_ id: String, _ state: BotTodoState, _ at: Double) -> BotTodo {
            BotTodo(id: id, botId: "b", title: id, state: state, createdAt: 0, updatedAt: at)
        }
        let all = [
            task("d1", .done, 10), task("w1", .waiting, 1), task("p1", .doing, 5),
            task("w2", .waiting, 9), task("d2", .done, 30), task("p2", .doing, 7),
        ]
        XCTAssertEqual(BotTodoList.listed(all).map(\.id), ["w2", "w1", "p2", "p1"])
        // the one that just finished stays until its row folds
        XCTAssertEqual(BotTodoList.listed(all, finishing: ["d2"]).map(\.id), ["w2", "w1", "d2", "p2", "p1"])
        XCTAssertTrue(BotTodoList.listed([task("d1", .done, 1)]).isEmpty)
    }

    func testJustFinishedSeesOnlyTheMoveToDone() {
        func task(_ id: String, _ state: BotTodoState) -> BotTodo {
            BotTodo(id: id, botId: "b", title: id, state: state, createdAt: 0, updatedAt: 0)
        }
        let before = [task("a", .doing), task("b", .waiting), task("c", .done)]
        let after = [task("a", .done), task("b", .waiting), task("c", .done), task("d", .done)]
        XCTAssertEqual(BotTodoList.justFinished(from: before, to: after), ["a"])
        // first read, and a task that was never seen open: nothing
        XCTAssertTrue(BotTodoList.justFinished(from: nil, to: after).isEmpty)
    }

    func testAnswerOpensTheTaskThreadElseTheBotThread() {
        var task = BotTodo(id: "task_aaaaaa", botId: "b", threadId: "t1", title: "x", state: .waiting, createdAt: 0, updatedAt: 0)
        XCTAssertEqual(BotTodoList.answerThread(task, botThreadId: "main"), "t1")
        task.threadId = nil
        XCTAssertEqual(BotTodoList.answerThread(task, botThreadId: "main"), "main")
        XCTAssertNil(BotTodoList.answerThread(task, botThreadId: ""))
    }

    func testFailureOutcomes() {
        XCTAssertEqual(BotTodoList.outcome(of: APIError.status(code: 404, message: "no route: GET /api/bots/b/task-list")), .needsUpdate)
        XCTAssertEqual(BotTodoList.outcome(of: APIError.status(code: 403, message: "session lacks the admin scope")), .needsUpdate)
        XCTAssertEqual(BotTodoList.outcome(of: APIError.status(code: 403, message: "Only an administrator can do this: it reaches everyone.")), .needsUpdate)
        XCTAssertEqual(BotTodoList.outcome(of: APIError.status(code: 404, message: "no such bot")), .loaded([]))
        XCTAssertEqual(BotTodoList.outcome(of: APIError.status(code: 500, message: nil)), .failed)
        XCTAssertEqual(BotTodoList.outcome(of: APIError.transport("offline")), .failed)
    }

    /// A list that cannot be read is hidden like an empty one: only the older
    /// server's line shows, and the read comes back by itself (backoff).
    func testFailedReadHidesTheSectionAndRetriesWithBackoff() {
        XCTAssertTrue(BotTodoList.sectionHidden(needsUpdate: false, listedIsEmpty: true))
        XCTAssertFalse(BotTodoList.sectionHidden(needsUpdate: false, listedIsEmpty: false), "the last known list stays")
        XCTAssertFalse(BotTodoList.sectionHidden(needsUpdate: true, listedIsEmpty: true))
        XCTAssertEqual([0, 1, 2, 3, 10].map { BotTodoList.retryDelay(attempt: $0) }, [2, 4, 8, 16, 60])
    }

    func testPathsAndMethods() {
        XCTAssertEqual(BotTodoList.listPath(botId: "bot-1"), "/api/bots/bot-1/task-list")
        XCTAssertNil(BotTodoList.listPath(botId: "../x"))
        let expected: [BotTodoAction: (String, String)] = [
            .complete: ("POST", "/api/bots/bot-1/task-list/task_abc123/complete"),
            .resume: ("POST", "/api/bots/bot-1/task-list/task_abc123/resume"),
            .reopen: ("POST", "/api/bots/bot-1/task-list/task_abc123/reopen"),
            .remove: ("DELETE", "/api/bots/bot-1/task-list/task_abc123"),
        ]
        for (action, want) in expected {
            let route = action.request(botId: "bot-1", taskId: "task_abc123")
            XCTAssertEqual(route?.method, want.0, "\(action)")
            XCTAssertEqual(route?.path, want.1, "\(action)")
        }
        XCTAssertNil(BotTodoAction.remove.request(botId: "b", taskId: "a/b"))
        XCTAssertNil(BotTodoAction.resume.request(botId: "b/../c", taskId: "task_abc123"))
    }

    func testActionsPerState() {
        XCTAssertEqual(BotTodoList.moves(for: .doing), [.complete])
        XCTAssertEqual(BotTodoList.moves(for: .waiting), [.complete, .resume])
        XCTAssertEqual(BotTodoList.moves(for: .done), [.reopen])
        XCTAssertEqual(BotTodoList.actions(for: .waiting), [.complete, .resume, .remove])
        XCTAssertEqual(BotTodoList.actions(for: .done), [.reopen, .remove])
    }

    func testNoteAndHistoryDecode() throws {
        let body = #"""
        {"id":"task_aaaaaa","botId":"b1","title":"Renew the domain","state":"waiting",
         "note":"\n  Which registrar?\nThe old one expired.\n","createdAt":1000,"updatedAt":3000,
         "history":[{"state":"doing","at":1000,"by":"bot"},{"state":"later","at":1500,"by":"bot"},
                    {"state":"waiting","at":3000,"by":"bot"},{"state":"doing","at":2000,"by":"person"}]}
        """#
        let task = try JSONDecoder().decode(BotTodo.self, from: Data(body.utf8))
        XCTAssertEqual(task.noteText, "Which registrar?\nThe old one expired.")
        XCTAssertEqual(task.notePreview, "Which registrar?")
        XCTAssertEqual(task.history?.count, 3, "an entry this build cannot read drops out")
        XCTAssertEqual(task.historyNewestFirst.map(\.at), [3000, 2000, 1000])
        XCTAssertEqual(task.historyNewestFirst[1], BotTodoEvent(state: .doing, at: 2000, by: .person))

        let old = try JSONDecoder().decode(BotTodo.self, from: Data(#"{"id":"task_bbbbbb","botId":"b1","title":"x","state":"doing","createdAt":1,"updatedAt":1}"#.utf8))
        XCTAssertNil(old.history)
        XCTAssertNil(old.noteText)
        XCTAssertNil(old.notePreview)
        XCTAssertTrue(old.historyNewestFirst.isEmpty)
    }

    func testAnswerDraft() {
        XCTAssertEqual(BotTodoList.answerDraft(title: "Renew the domain"), "About the task “Renew the domain”: ")
        XCTAssertEqual(BotTodoList.answerDraft(title: " Two\nlines ", format: "À propos de la tâche « %@ » : "),
                       "À propos de la tâche « Two lines » : ")
        let draft = "About the task “x”: "
        XCTAssertEqual(BotTodoList.merge(draft: draft, into: ""), draft)
        XCTAssertEqual(BotTodoList.merge(draft: draft, into: "  \n"), draft)
        XCTAssertEqual(BotTodoList.merge(draft: draft, into: draft + "yes"), draft + "yes")
        XCTAssertEqual(BotTodoList.merge(draft: draft, into: "hello"), draft + "hello")
    }
}
