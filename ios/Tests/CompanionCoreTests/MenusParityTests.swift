// The desktop's simplified menus (#518) on iOS: the bot's one "..." menu,
// the editor's six groups and Settings > Usage for the signed-in person.
import XCTest
@testable import CompanionCore

final class MenusParityTests: XCTestCase {
    private func bot(_ id: String, owner: String? = nil, primary: Bool = false) throws -> Bot {
        var json: [String: Any] = [
            "id": id, "threadId": "t-\(id)", "name": id.capitalized, "title": "", "description": "", "notifications": true,
            "color": "green", "unread": false, "modelSelection": ["instanceId": "claude", "model": "m"], "createdAt": 1,
            "chiefOfStaff": primary,
        ]
        if let owner { json["ownerUserId"] = owner }
        return try JSONDecoder().decode(Bot.self, from: JSONSerialization.data(withJSONObject: json))
    }

    // MARK: The bot's "..." menu

    /// The iPad desktop shell's panel menu opens with Edit bot, as the
    /// desktop's (`BotActionsMenu.tsx` "edit-bot"); the phone's does not.
    func testTheDesktopShellMenuOpensWithEditBot() throws {
        let mine = try bot("mine", owner: "pr_me")
        let plan = BotActionsMenuPlan(gate: SurfaceGate(scope: .serverAdmin), bot: mine, viewerId: "pr_me",
                                      editable: true, zipExport: true, activeBotCount: 3, wizard: true, editBot: true)
        XCTAssertEqual(plan.groups.first, [.editBot, .makePrimary, .redoWizard])
        XCTAssertFalse(plan.items.contains(.rename))
    }

    func testTheOwnerGetsTheDesktopMenuInOrder() throws {
        let mine = try bot("mine", owner: "pr_me")
        let plan = BotActionsMenuPlan(gate: SurfaceGate(scope: .serverAdmin), bot: mine, viewerId: "pr_me",
                                      editable: true, zipExport: true, activeBotCount: 3, wizard: true)
        // Lot 6: Edit bot and Rename left; Redo the wizard and Delete joined.
        let expected: [[BotActionsMenuItem]] = [
            [.makePrimary, .redoWizard],
            [.copyConversation, .downloadConversation, .exportZip],
            [.archive, .delete],
        ]
        XCTAssertEqual(plan.groups, expected)
        XCTAssertFalse(plan.items.contains(.editBot))
        XCTAssertFalse(plan.items.contains(.rename))
        XCTAssertNil(plan.archiveBlock)
        XCTAssertTrue(plan.enables(.archive))
    }

    func testThePrimaryBotHandsTheRoleOverAndCannotBeArchived() throws {
        let star = try bot("star", owner: "pr_me", primary: true)
        let plan = BotActionsMenuPlan(gate: SurfaceGate(scope: .serverAdmin), bot: star, viewerId: "pr_me",
                                      editable: true, zipExport: false, activeBotCount: 3)
        XCTAssertTrue(plan.items.contains(.replacePrimary))
        XCTAssertFalse(plan.items.contains(.makePrimary))
        XCTAssertFalse(plan.items.contains(.exportZip))
        XCTAssertTrue(plan.items.contains(.delete))
        XCTAssertEqual(plan.archiveBlock, .primary)
        XCTAssertFalse(plan.enables(.archive))
    }

    func testTheLastActiveBotStaysAndAClientCannotDeleteAnotherOnesBot() throws {
        let theirs = try bot("theirs", owner: "pr_other")
        let plan = BotActionsMenuPlan(gate: SurfaceGate(scope: .serverClient), bot: theirs, viewerId: "pr_me",
                                      editable: false, zipExport: false, activeBotCount: 1)
        XCTAssertFalse(plan.items.contains(.editBot))
        XCTAssertFalse(plan.items.contains(.rename))
        XCTAssertFalse(plan.items.contains(.makePrimary))
        XCTAssertFalse(plan.items.contains(.delete), "another member's bot stays theirs")
        XCTAssertEqual(plan.items.prefix(2), [.copyConversation, .downloadConversation])
        if plan.items.contains(.archive) { XCTAssertEqual(plan.archiveBlock, .lastActive) }
    }

    // MARK: The editor's six groups

    func testEverySectionBelongsToOneGroupInTheDesktopOrder() {
        XCTAssertEqual(DesktopPanelGroup.allCases, [.profile, .instructions, .memoryFiles, .modelTools, .behavior, .activity])
        for section in DesktopPanelSection.allCases {
            XCTAssertEqual(DesktopPanelGroup.allCases.filter { $0.sections.contains(section) }.count, 1, "\(section)")
        }
        XCTAssertEqual(DesktopPanelGroup.of(.soul), .instructions)
        XCTAssertEqual(DesktopPanelGroup.of(.history), .activity)
        XCTAssertEqual(DesktopPanelGroup.of(.sharing), .profile)
    }

    func testAGroupWithNothingToShowIsLeftOut() {
        let visible: [DesktopPanelSection] = [.overview, .voice, .usage]
        XCTAssertEqual(DesktopPanelGroup.visible(visible), [.profile, .behavior, .activity])
        XCTAssertEqual(DesktopPanelGroup.behavior.sections(in: visible), [.voice])
        XCTAssertTrue(DesktopPanelGroup.behavior.matches("alerts", label: "Behavior", visible: visible) { _ in "Voice & alerts" })
        XCTAssertFalse(DesktopPanelGroup.profile.matches("alerts", label: "Profile", visible: visible) { _ in "Overview" })
    }

    // MARK: Usage for the signed-in person

    func testThePeriodsAreThisMonthTheSameDaysBeforeAndThirtyDays() {
        let now = ISO8601DateFormatter().date(from: "2026-03-31T12:00:00Z")!
        let periods = PersonalUsagePeriods(now: now)
        XCTAssertEqual(periods.month.from, "2026-03-01")
        XCTAssertEqual(periods.month.to, "2026-03-31")
        XCTAssertEqual(periods.previous.from, "2026-02-01")
        XCTAssertEqual(periods.previous.to, "2026-02-28", "the same day, kept inside a shorter month")
        XCTAssertEqual(periods.days30.from, "2026-03-02")
    }

    func testTheRequestAsksForTheRequestersOwnTurns() throws {
        let client = CompanionClient(connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810), token: "t")
        let request = try client.personalUsageRequest((from: "2026-03-01", to: "2026-03-31"), groupBy: .model)
        let items = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
        XCTAssertEqual(request.url?.path, "/api/me/usage", "any member reads their own usage (#524)")
        XCTAssertFalse(items.contains { $0.name == "mine" })
        XCTAssertTrue(items.contains(URLQueryItem(name: "groupBy", value: "model")))
        let legacy = try client.personalUsageRequest((from: "2026-03-01", to: "2026-03-31"), groupBy: .bot, legacy: true)
        XCTAssertEqual(legacy.url?.path, "/api/usage")
        XCTAssertTrue((URLComponents(url: legacy.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []).contains(URLQueryItem(name: "mine", value: "1")))
    }

    func testAnOlderServerFallsBackToTheAdminRouteOn404() async throws {
        UsageRouteStub.reset()
        UsageRouteStub.missing = ["/api/me/usage"]
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [UsageRouteStub.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let client = CompanionClient(connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810), token: "t", session: session)
        let usage = try await client.personalUsage()
        XCTAssertEqual(usage.month.total?.turns, 3)
        let paths = UsageRouteStub.paths()
        XCTAssertEqual(paths.first, "/api/me/usage", "the new route first")
        XCTAssertEqual(paths.filter { $0 == "/api/me/usage" }.count, 1, "one try, then the fallback")
        XCTAssertEqual(paths.filter { $0 == "/api/usage" }.count, 5)
    }

    func testANewServerAnswersFromMeUsageOnly() async throws {
        UsageRouteStub.reset()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [UsageRouteStub.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let client = CompanionClient(connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810), token: "t", session: session)
        _ = try await client.personalUsage()
        XCTAssertEqual(Set(UsageRouteStub.paths()), ["/api/me/usage"])
        XCTAssertEqual(UsageRouteStub.paths().count, 5)
    }

    func testTrendDailyCostsAndRanking() throws {
        XCTAssertNil(PersonalUsageRules.trend(current: 5, previous: 0))
        XCTAssertEqual(PersonalUsageRules.trend(current: 15, previous: 10), 50)
        XCTAssertEqual(PersonalUsageRules.trend(current: 5, previous: 10), -50)
        let json = #"""
        {"groupBy":"day","groups":[
          {"key":"day:2026-03-02","label":"2026-03-02","turns":2,"costUsd":1.5},
          {"key":"day:2026-03-04","label":"2026-03-04","turns":9,"costUsd":0.25}],
         "total":{"key":"total","label":"Total","turns":11,"costUsd":1.75}}
        """#
        let summary = try JSONDecoder().decode(UsageHistory.self, from: Data(json.utf8))
        XCTAssertEqual(PersonalUsageRules.dailyCosts(summary, range: (from: "2026-03-01", to: "2026-03-04")), [0, 1.5, 0, 0.25])
        XCTAssertEqual(PersonalUsageRules.ranked(summary).map(\.key), ["day:2026-03-02", "day:2026-03-04"])
        XCTAssertEqual(PersonalUsageRules.cost(summary), 1.75)
    }
}

/// Answers every usage read with a small summary, or 404 for `missing` paths.
private final class UsageRouteStub: URLProtocol {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var seen: [String] = []
    nonisolated(unsafe) static var missing: Set<String> = []

    static func reset() {
        lock.lock(); defer { lock.unlock() }
        seen = []
        missing = []
    }

    static func paths() -> [String] {
        lock.lock(); defer { lock.unlock() }
        return seen
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let path = request.url?.path ?? ""
        Self.lock.lock()
        Self.seen.append(path)
        let absent = Self.missing.contains(path)
        Self.lock.unlock()
        let body = absent
            ? #"{"error":"not found"}"#
            : #"{"groupBy":"day","groups":[],"total":{"key":"total","label":"Total","turns":3,"costUsd":0.5}}"#
        let response = HTTPURLResponse(url: request.url!, statusCode: absent ? 404 : 200, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
