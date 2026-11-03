import Foundation
import XCTest
@testable import CompanionCore

final class RoutineGroupingTests: XCTestCase {
    private func routine(_ id: String, bot: String, folder: String? = nil, enabled: Bool = true, streak: Int? = nil) throws -> Routine {
        let extra = (folder.map { #","folder":"\#($0)""# } ?? "") + (streak.map { #","failureStreak":\#($0)"# } ?? "")
        let json = #"""
        {"id":"\#(id)","name":"N \#(id)","prompt":"x","botId":"\#(bot)","runOn":"maus","enabled":\#(enabled),
         "schedule":{"type":"interval","everyMinutes":60},"durationMinutes":30,"nextRunAt":null,
         "createdAt":1,"updatedAt":1\#(extra)}
        """#
        return try JSONDecoder().decode(Routine.self, from: Data(json.utf8))
    }

    func testByBotFollowsTheSidebarOrderAndUnknownBotsComeLast() throws {
        let all = [try routine("1", bot: "b"), try routine("2", bot: "x"), try routine("3", bot: "a"), try routine("4", bot: "b")]
        let groups = RoutineGrouping.byBot(all, botOrder: ["a", "b", "c"])
        XCTAssertEqual(groups.map(\.botId), ["a", "b", "x"])
        XCTAssertEqual(groups[1].routines.map(\.id), ["1", "4"])
    }

    func testByFolderMergesCasesAcrossBotsAndLooseFirst() throws {
        let all = [try routine("1", bot: "a", folder: "Reports"), try routine("2", bot: "b", folder: "reports"),
                   try routine("3", bot: "b"), try routine("4", bot: "a", folder: "Home")]
        let groups = RoutineGrouping.byFolder(all, folders: ["a": ["Home", "Reports"]], botOrder: ["a", "b"])
        XCTAssertEqual(groups.map(\.folder), [nil, "Home", "Reports"])
        XCTAssertEqual(groups[2].routines.map(\.id), ["1", "2"])
    }

    func testHealthCountsRunningThenFailing() throws {
        let a = try routine("1", bot: "a"), b = try routine("2", bot: "a", streak: 2), c = try routine("3", bot: "a")
        let run = try JSONDecoder().decode(RoutineRun.self, from: Data(#"""
        {"id":"r","routineId":"1","routineName":"N","botId":"a","runOn":"maus","scheduledFor":1,"status":"running","manual":false,"createdAt":1,"updatedAt":1}
        """#.utf8))
        let health = RoutineGrouping.health([a, b, c], runs: [run])
        XCTAssertEqual(health.running, 1)
        XCTAssertEqual(health.failing, 1)
    }

    func testSidebarOrderPutsChiefThenPinned() throws {
        let bots = try JSONDecoder().decode([Bot].self, from: Data(#"[{"id":"a","threadId":"t","name":"A","title":"","description":"","notifications":true,"color":"purple","unread":false,"modelSelection":{"instanceId":"e","model":"m"},"createdAt":1},{"id":"b","threadId":"t","name":"B","title":"","description":"","notifications":true,"color":"purple","unread":false,"modelSelection":{"instanceId":"e","model":"m"},"createdAt":1,"pinned":true},{"id":"c","threadId":"t","name":"C","title":"","description":"","notifications":true,"color":"purple","unread":false,"modelSelection":{"instanceId":"e","model":"m"},"createdAt":1,"chiefOfStaff":true}]"#.utf8))
        XCTAssertEqual(RoutineGrouping.sidebarOrder(bots), ["c", "b", "a"])
    }
}
