import Foundation
import XCTest
@testable import CompanionCore

final class RoutineFoldersTests: XCTestCase {
    private func routine(_ id: String, _ name: String, bot: String = "bot-1", folder: String? = nil) -> String {
        let folderField = folder.map { #","folder":"\#($0)""# } ?? ""
        return #"""
        {"id":"\#(id)","name":"\#(name)","prompt":"Do it","botId":"\#(bot)","runOn":"maus","enabled":true,
         "schedule":{"type":"interval","everyMinutes":60},"durationMinutes":30,"nextRunAt":null,
         "createdAt":1,"updatedAt":1\#(folderField)}
        """#
    }

    private func decode(_ json: String) throws -> RoutinesResponse {
        try JSONDecoder().decode(RoutinesResponse.self, from: Data(json.utf8))
    }

    func testDecodesFolderAndFolderOrder() throws {
        let response = try decode(#"""
        {"routines":[\#(routine("r1", "Morning summary", folder: "Reports")),\#(routine("r2", "Water plants"))],
         "runs":[],"folders":{"bot-1":["Reports","Home"]}}
        """#)
        XCTAssertEqual(response.routines.map(\.folder), ["Reports", nil])
        XCTAssertEqual(response.folders, ["bot-1": ["Reports", "Home"]])
    }

    func testAnOlderServerWithoutFoldersStillDecodes() throws {
        let response = try decode(#"{"routines":[\#(routine("r1", "Morning summary"))],"runs":[]}"#)
        XCTAssertNil(response.routines[0].folder)
        XCTAssertNil(response.folders)
        let groups = RoutineFolders.group(response.routines, order: response.folders?["bot-1"] ?? [])
        XCTAssertEqual(groups.count, 1)
        XCTAssertNil(groups[0].folder)
        XCTAssertEqual(groups[0].routines.map(\.id), ["r1"])
    }

    /// A 0.8.7 server (2026-10-28): its listing has no `folders`, and
    /// `POST /api/routines/folders` answers as that tag does. The folder
    /// actions are disabled there, and its answer never reaches the screen.
    func testA087ServerHasNoFoldersAndItsNoRouteIsNeverShown() throws {
        let old = try decode(#"{"routines":[\#(routine("r1", "[Reports] Morning"))],"runs":[],"scope":"mine"}"#)
        XCTAssertFalse(ScopedRoutines(response: old, asked: .mine).foldersSupported)
        let current = try decode(#"{"routines":[],"runs":[],"folders":{}}"#)
        XCTAssertTrue(ScopedRoutines(response: current, asked: .mine).foldersSupported)

        let admin = APIError.status(code: 404, message: "no route: POST /api/routines/folders")
        XCTAssertTrue(admin.isRouteMissing)
        XCTAssertEqual(admin.errorDescription, "Available after the server update.")
        let member = APIError.status(code: 403, message: "forbidden: this session lacks the admin scope")
        XCTAssertTrue(member.isRouteMissing)
        // #4471: the same refusal in plain words from a current server
        let plain = APIError.status(code: 403, message: "Only an administrator can do this: the fleet is every workspace of this installation.")
        XCTAssertTrue(plain.isRouteMissing)
        // Any other refusal keeps its own words.
        let gone = APIError.status(code: 404, message: "no such routine")
        XCTAssertFalse(gone.isRouteMissing)
        XCTAssertEqual(gone.errorDescription, "no such routine")
    }

    func testGroupsLooseFirstThenFoldersInOrderWithEmptyOnesAndCaseInsensitiveNames() throws {
        let response = try decode(#"""
        {"routines":[\#(routine("r1", "Morning summary", folder: "reports")),
                     \#(routine("r2", "Water plants")),
                     \#(routine("r3", "Weekly digest", folder: "Reports")),
                     \#(routine("r4", "Lights off", folder: "Archive"))],
         "runs":[],"folders":{"bot-1":["Home","Reports"]}}
        """#)
        let groups = RoutineFolders.group(response.routines, order: response.folders?["bot-1"] ?? [])
        XCTAssertEqual(groups.map(\.folder), [nil, "Home", "Reports", "Archive"])
        XCTAssertEqual(groups.map { $0.routines.map(\.id) }, [["r2"], [], ["r1", "r3"], ["r4"]])
    }

    func testAcrossBotsKeepsLooseRoutinesTogetherThenEachBotsFolders() throws {
        let response = try decode(#"""
        {"routines":[\#(routine("r1", "Morning summary", bot: "bot-2", folder: "Reports")),
                     \#(routine("r2", "Water plants", bot: "bot-1")),
                     \#(routine("r3", "Lights off", bot: "bot-1", folder: "Home")),
                     \#(routine("r4", "Weekly digest", bot: "bot-2"))],
         "runs":[],"folders":{"bot-1":["Home"],"bot-2":["Reports","Later"]}}
        """#)
        let groups = RoutineFolders.groupAcrossBots(response.routines, folders: response.folders ?? [:], botOrder: ["bot-1", "bot-2"])
        XCTAssertEqual(groups.map(\.folder), [nil, "Home", "Reports", "Later"])
        XCTAssertEqual(groups.map(\.botId), [nil, "bot-1", "bot-2", "bot-2"])
        XCTAssertEqual(groups[0].routines.map(\.id), ["r2", "r4"])
        XCTAssertEqual(groups[2].routines.map(\.id), ["r1"])
    }

    func testMoveOutOfAFolderSendsAnExplicitNull() throws {
        let data = try JSONEncoder().encode(RoutineFolderAction.move(botId: "bot-1", routineIds: ["r1"], folder: nil))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(object["action"] as? String, "move")
        XCTAssertEqual(object["botId"] as? String, "bot-1")
        XCTAssertEqual(object["routineIds"] as? [String], ["r1"])
        XCTAssertTrue(object["folder"] is NSNull)
    }

    func testRenameAndSortByPrefixBodies() throws {
        let rename = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(
            RoutineFolderAction.rename(botId: "bot-1", from: "Home", to: "House"))) as? [String: Any])
        XCTAssertEqual(rename["action"] as? String, "rename")
        XCTAssertEqual(rename["from"] as? String, "Home")
        XCTAssertEqual(rename["to"] as? String, "House")
        let sort = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(
            RoutineFolderAction.sortByPrefix(botId: "bot-1"))) as? [String: Any])
        XCTAssertEqual(sort["action"] as? String, "sort-by-prefix")
    }

    func testDecodesTheActionAnswerWithItsUndo() throws {
        let result = try JSONDecoder().decode(RoutineFolderResult.self, from: Data(#"""
        {"folders":["Reports"],"routines":[\#(routine("r1", "Morning summary", folder: "Reports"))],
         "undo":{"botId":"bot-1","folders":[],"routines":[{"id":"r1","name":"[Reports] Morning summary"}]}}
        """#.utf8))
        XCTAssertEqual(result.folders, ["Reports"])
        XCTAssertEqual(result.routines.first?.folder, "Reports")
        XCTAssertNotNil(result.undo)
    }

    func testCleansNamesLikeTheServer() {
        XCTAssertEqual(RoutineFolders.clean("  Morning \n  reports "), "Morning reports")
        XCTAssertNil(RoutineFolders.clean("   "))
        XCTAssertEqual(RoutineFolders.clean(String(repeating: "a", count: 80))?.count, 60)
        XCTAssertEqual(RoutineFolders.canonical("reports", in: ["Reports"]), "Reports")
    }

    func testCollapsedFoldersAreKeptPerBot() throws {
        let suite = "routine-folders-test-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = RoutineFolderCollapse(defaults: defaults)
        store.setCollapsed(true, botId: "bot-1", folder: "Reports")
        XCTAssertTrue(store.isCollapsed(botId: "bot-1", folder: "reports"))
        XCTAssertFalse(store.isCollapsed(botId: "bot-2", folder: "Reports"))
        store.rename(botId: "bot-1", from: "Reports", to: "Digests")
        XCTAssertFalse(store.isCollapsed(botId: "bot-1", folder: "Reports"))
        XCTAssertTrue(RoutineFolderCollapse(defaults: defaults).isCollapsed(botId: "bot-1", folder: "Digests"))
        store.setCollapsed(false, botId: "bot-1", folder: "Digests")
        XCTAssertFalse(store.isCollapsed(botId: "bot-1", folder: "Digests"))
    }

    /// Sort by prefix stays on offer while a [X] title sits in no folder
    /// (the desktop's `routinePrefixPlan`).
    func testPrefixCandidatesAreTheBracketedTitlesInNoFolder() throws {
        let response = try decode(#"""
        {"routines":[\#(routine("r1", "[Reports] Morning summary")),\#(routine("r2", "[Reports]")),
                     \#(routine("r3", "Water plants")),\#(routine("r4", "[Home] Lights", folder: "Home"))],
         "runs":[]}
        """#)
        XCTAssertEqual(RoutineFolders.prefixFolder("[Reports] - Morning summary")?.folder, "Reports")
        XCTAssertEqual(RoutineFolders.prefixFolder("[Reports] - Morning summary")?.name, "Morning summary")
        XCTAssertNil(RoutineFolders.prefixFolder("[Reports]"))
        XCTAssertEqual(RoutineFolders.prefixCandidates(response.routines).map(\.id), ["r1"])
    }
}
