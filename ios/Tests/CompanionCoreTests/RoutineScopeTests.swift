import Foundation
import XCTest
@testable import CompanionCore

// AU20: the Automations scope (Mine, My teams, Everyone) over the scoped
// listing of GET /api/routines (server/routines/routine-scope.ts).
final class RoutineScopeTests: XCTestCase {
    private let listing = Data(#"""
    {
      "routines": [
        {
          "id":"r-mine","name":"Mine","prompt":"Check status","botId":"bot-1","runOn":"maus","enabled":true,
          "schedule":{"type":"daily","time":"09:00"},"durationMinutes":30,"createdAt":1,"updatedAt":1,
          "owner":{"id":"pr_me","name":"Me"},"teamIds":["t1"],"bot":{"id":"bot-1","name":"Atlas"},
          "canRun":true,"canEdit":true
        },
        {
          "id":"r-other","name":"Bob's digest","prompt":"","botId":"bot-9","runOn":"maus","enabled":false,
          "schedule":{"type":"daily","time":"08:00"},"durationMinutes":30,"createdAt":1,"updatedAt":1,
          "owner":{"id":"pr_bob","name":"Bob","avatarUrl":"/api/people/pr_bob/avatar?v=1"},"teamIds":["t1"],
          "bot":{"id":"bot-9","name":"Beacon"},"canRun":false,"canEdit":false,"redacted":true
        }
      ],
      "runs": [
        {"id":"run-1","routineId":"r-other","routineName":"Bob's digest","botId":"bot-9","runOn":"maus",
         "scheduledFor":1,"status":"completed","manual":false,"createdAt":1,"redacted":true}
      ],
      "scope":"team",
      "allowed":{"mine":true,"team":true,"all":false},
      "facets":{
        "teams":[{"id":"t1","name":"Dispatch"}],
        "owners":[{"id":"pr_bob","name":"Bob"},{"id":"pr_me","name":"Me"}],
        "botChoices":[{"id":"bot-1","name":"Atlas"},{"id":"bot-9","name":"Beacon"}]
      }
    }
    """#.utf8)

    func testDecodesTheScopedListing() throws {
        let response = try JSONDecoder().decode(RoutinesResponse.self, from: listing)
        let scoped = ScopedRoutines(response: response, asked: .team)
        XCTAssertEqual(scoped.scope, .team)
        XCTAssertEqual(scoped.allowed, RoutineScopeAllowed(mine: true, team: true, all: false))
        XCTAssertEqual(scoped.facets.teams, [RoutineScopeChoice(id: "t1", name: "Dispatch")])
        XCTAssertEqual(scoped.facets.owners.map(\.id), ["pr_bob", "pr_me"])
        XCTAssertEqual(scoped.facets.botChoices.map(\.name), ["Atlas", "Beacon"])
        XCTAssertEqual(scoped.runs.first?.redacted, true)

        let mine = try XCTUnwrap(scoped.routines.first { $0.id == "r-mine" })
        XCTAssertTrue(mine.mayEdit)
        XCTAssertTrue(mine.mayRun)
        XCTAssertNil(mine.foreignOwnerName)

        let other = try XCTUnwrap(scoped.routines.first { $0.id == "r-other" })
        XCTAssertFalse(other.mayEdit)
        XCTAssertFalse(other.mayRun)
        XCTAssertEqual(other.foreignOwnerName, "Bob")
        XCTAssertEqual(other.owner?.avatarUrl, "/api/people/pr_bob/avatar?v=1")
        XCTAssertEqual(other.bot?.name, "Beacon")
    }

    func testAnOlderServerListsMineOnlyAndEveryActionStays() throws {
        let plain = Data(#"""
        {"routines":[{"id":"r","name":"Pulse","prompt":"x","botId":"b","runOn":"maus","enabled":true,
          "schedule":{"type":"daily","time":"09:00"},"durationMinutes":30,"createdAt":1,"updatedAt":1}],"runs":[]}
        """#.utf8)
        let scoped = ScopedRoutines(response: try JSONDecoder().decode(RoutinesResponse.self, from: plain), asked: .mine)
        XCTAssertEqual(scoped.scope, .mine)
        XCTAssertEqual(scoped.allowed, .mineOnly)
        XCTAssertEqual(scoped.facets, RoutineScopeFacets())
        XCTAssertTrue(scoped.routines[0].mayEdit)
        XCTAssertTrue(scoped.routines[0].mayRun)
        XCTAssertNil(scoped.routines[0].foreignOwnerName)
    }

    func testQueryItems() {
        XCTAssertEqual(RoutineScopeQuery().queryItems, [])
        // Team and Owner belong to the wider scopes
        XCTAssertEqual(RoutineScopeQuery(scope: .mine, teamId: "t1", ownerId: "pr_bob").queryItems, [])
        XCTAssertEqual(
            RoutineScopeQuery(scope: .team, teamId: "t1", botId: "bot-1", ownerId: "pr_bob", status: .failing).queryItems,
            [URLQueryItem(name: "scope", value: "team"), URLQueryItem(name: "teamId", value: "t1"),
             URLQueryItem(name: "ownerId", value: "pr_bob"), URLQueryItem(name: "status", value: "failing")]
        )
        XCTAssertEqual(RoutineScopeQuery(scope: .mine, status: .paused).queryItems, [URLQueryItem(name: "status", value: "paused")])
    }

    func testChoosingAndAllowingAScope() {
        let wide = RoutineScopeQuery(scope: .all, teamId: "t1", ownerId: "pr_bob", status: .active)
        XCTAssertEqual(wide.choosing(.mine), RoutineScopeQuery(scope: .mine, status: .active))
        XCTAssertEqual(wide.choosing(.team).teamId, "t1")
        XCTAssertEqual(wide.allowed(by: RoutineScopeAllowed(team: true)), RoutineScopeQuery(scope: .mine, status: .active))
        XCTAssertEqual(wide.allowed(by: RoutineScopeAllowed(team: true, all: true)), wide)
        XCTAssertNil(RoutineScope.mine.permission)
        XCTAssertEqual(RoutineScope.team.permission, "routines.viewTeam")
        XCTAssertEqual(RoutineScope.all.permission, "routines.viewAll")
        XCTAssertTrue(wide.hasFilters)
        XCTAssertFalse(RoutineScopeQuery(scope: .all).hasFilters)
    }
}
