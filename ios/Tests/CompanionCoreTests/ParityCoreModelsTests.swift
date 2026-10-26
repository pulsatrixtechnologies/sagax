// WP0a: the card kinds, message, thread, room and routine fields the
// renderer reads, decoded from payloads shaped like `shared/wire.ts`,
// `shared/parallel-tasks.ts`, `shared/group-goal-run.ts` and
// `shared/routines.ts`.
import Foundation
import XCTest
@testable import CompanionCore

final class ParityCoreModelsTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    private func roundTrip<T: Codable & Equatable>(_ value: T) throws -> T {
        try JSONDecoder().decode(T.self, from: JSONEncoder().encode(value))
    }

    // MARK: Card kinds

    func testDecodesAnAccessCard() throws {
        let message = try decode(Message.self, #"""
        {"id":"m2","role":"bot","kind":"access","at":2,
         "access":{"reason":"no_access","engine":"Claude","botId":"b1","ownerPrincipalId":"p1",
                   "keysUrl":"https://console.example/keys","payer":"speaker","cause":"no_credentials",
                   "subscriptionSignIn":true}}
        """#)
        XCTAssertEqual(message.kind, .access)
        let access = try XCTUnwrap(message.access)
        XCTAssertEqual(access.kind, .noAccess)
        XCTAssertEqual(access.engine, "Claude")
        XCTAssertEqual(access.payer, "speaker")
        XCTAssertEqual(access.subscriptionSignIn, true)
        XCTAssertEqual(try roundTrip(message), message)
    }

    func testDecodesARoutineDelegationAccessCard() throws {
        let access = try decode(AccessCard.self, #"""
        {"reason":"routine_delegation","engine":"","botId":"b1","ownerPrincipalId":"p1",
         "runAsPrincipalId":"p2","runAsName":"Sam","routineId":"r1","routineName":"Pulse",
         "suspendReason":"delegation_revoked"}
        """#)
        XCTAssertEqual(access.kind, .routineDelegation)
        XCTAssertEqual(access.runAsName, "Sam")
        XCTAssertEqual(access.suspendReason, "delegation_revoked")
    }

    func testDecodesAGoalRunCard() throws {
        let message = try decode(Message.self, #"""
        {"id":"m3","role":"bot","kind":"goal.run","at":3,
         "goalRun":{"runId":"g1","goal":"Ship it","status":"needs-input","coordinatorBotId":"b1",
                    "coordinatorName":"Ara","turnCount":4,"maxTurns":12,"detail":"Which branch?",
                    "startedAt":100,"finishedAt":200}}
        """#)
        XCTAssertEqual(message.kind, .goalRun)
        let run = try XCTUnwrap(message.goalRun)
        XCTAssertEqual(run.state, .needsInput)
        XCTAssertFalse(run.isRunning)
        XCTAssertEqual(run.turnCount, 4)
        XCTAssertEqual(run.maxTurns, 12)
        XCTAssertEqual(try roundTrip(message), message)
    }

    func testDecodesAParallelTaskCard() throws {
        let message = try decode(Message.self, #"""
        {"id":"m4","role":"bot","kind":"text","at":4,
         "parallelTask":{"threadId":"t9","title":"Check logs","requestMessageId":"m0",
                         "role":"card","state":"running","startedAt":10}}
        """#)
        let task = try XCTUnwrap(message.parallelTask)
        XCTAssertTrue(task.isCard)
        XCTAssertEqual(task.recordedState, .running)
        XCTAssertEqual(task.requestMessageId, "m0")
        XCTAssertEqual(try roundTrip(message), message)
    }

    func testDecodesAnOwnerWaitProjection() throws {
        let message = try decode(Message.self, #"""
        {"id":"m5","role":"bot","kind":"options","at":5,"state":"waiting-on-owner","ownerName":"JC",
         "card":{"title":"Run tests?","subtitle":"","options":["Allow","Deny"]}}
        """#)
        XCTAssertEqual(message.ownerWait, .waitingOnOwner)
        XCTAssertEqual(message.ownerName, "JC")
        let settled = try decode(Message.self, #"{"id":"m6","role":"bot","kind":"options","at":6,"state":"owner-settled"}"#)
        XCTAssertEqual(settled.ownerWait, .ownerSettled)
    }

    func testAKindThisBuildDoesNotKnowIsStillUnknown() throws {
        let message = try decode(Message.self, #"{"id":"m7","role":"bot","kind":"hologram","at":7,"text":"hi"}"#)
        XCTAssertEqual(message.kind, .unknown)
        XCTAssertEqual(message.text, "hi")
    }

    func testTheNewKindsPreviewAsTheirTextLikeUnknownDid() throws {
        for kind in ["connector", "access", "goal.run"] {
            let message = try decode(Message.self, #"{"id":"m","role":"bot","kind":"\#(kind)","at":1,"text":"line"}"#)
            XCTAssertEqual(previewText(of: message), "line", kind)
        }
    }

    // MARK: Message fields

    func testDecodesReplyBranchAndAttributionFields() throws {
        let message = try decode(Message.self, #"""
        {"id":"m8","role":"user","kind":"text","at":8,"text":"also this","parentId":"m7",
         "replyToId":"m2","sendId":"s1","steered":true,"aside":false,"via":"api",
         "sender":{"name":"Sam","id":"sam@example.com"},"channelMode":"goal","queued":true,
         "peerAsk":{"botId":"b2","name":"Scout","unattended":true},"peerPost":{"unattended":true},
         "routedBy":{"provider":"jev","probability":0.82},"requestMessageId":"m1","turnSucceeded":true,
         "status":"failed","requestCancelled":true,"reactions":[{"emoji":"👍","by":"user"}]}
        """#)
        XCTAssertEqual(message.replyToId, "m2")
        XCTAssertEqual(message.parentId, "m7")
        XCTAssertEqual(message.sendId, "s1")
        XCTAssertEqual(message.steered, true)
        XCTAssertEqual(message.via, "api")
        XCTAssertEqual(message.sender?.name, "Sam")
        XCTAssertEqual(message.channelMode, "goal")
        XCTAssertEqual(message.peerAsk?.name, "Scout")
        XCTAssertEqual(message.peerPost?.unattended, true)
        XCTAssertEqual(message.routedBy?.provider, "jev")
        XCTAssertEqual(message.routedBy?.probability ?? 0, 0.82, accuracy: 0.0001)
        XCTAssertEqual(message.requestMessageId, "m1")
        XCTAssertEqual(message.turnSucceeded, true)
        XCTAssertTrue(message.isFailed)
        XCTAssertEqual(message.requestCancelled, true)
        XCTAssertEqual(message.reactions?.first?.emoji, "👍")
        XCTAssertEqual(message.reactions?.first?.count, 1)
        XCTAssertEqual(try roundTrip(message), message)
    }

    func testDecodesReactionsWithActors() throws {
        let message = try decode(Message.self, #"""
        {"id":"m9","role":"user","kind":"text","at":9,"text":"shipped",
         "reactions":[{"emoji":"👍","actors":[{"id":"pr_zach","kind":"person","name":"Zachary Sellam"},
         {"id":"bot:cryptic","kind":"bot","name":"Cryptic"}],"at":12}]}
        """#)
        let reaction = try XCTUnwrap(message.reactions?.first)
        XCTAssertNil(reaction.by)
        XCTAssertEqual(reaction.count, 2)
        XCTAssertEqual(reaction.actors?.last?.kind, "bot")
        XCTAssertTrue(reaction.includes("PR_ZACH"))
        XCTAssertFalse(reaction.includes(nil))
        XCTAssertEqual(try roundTrip(message), message)
    }

    // MARK: Threads and rooms

    func testDecodesThreadFoldersPinsUsageAndParallelOrigin() throws {
        let task = try decode(BotTask.self, #"""
        {"threadId":"t1","title":"Logs","createdAt":1,"projectId":"f1","unread":true,
         "pinnedMessageId":"m3","rewound":true,"turnStartedAt":50,"ownerPrincipalId":"p1",
         "parallelOf":{"threadId":"t0","messageId":"m0","cardMessageId":"m1","at":5,"outcome":"done"},
         "usage":{"input":100,"output":20,"cachedInput":40,"costUsd":null,"turns":2,
                  "lastTurn":{"input":60,"output":10,"costUsd":0.01},"context":{"tokens":900,"window":200000}}}
        """#)
        XCTAssertEqual(task.projectId, "f1")
        XCTAssertEqual(task.unread, true)
        XCTAssertEqual(task.pinnedMessageId, "m3")
        XCTAssertEqual(task.parallelOf?.cardMessageId, "m1")
        XCTAssertEqual(task.parallelOf?.outcome, "done")
        XCTAssertEqual(task.usage?.turns, 2)
        XCTAssertNil(task.usage?.costUsd)
        XCTAssertEqual(task.usage?.lastTurn?.costUsd, 0.01)
        XCTAssertEqual(task.usage?.context?.window, 200_000)
        XCTAssertEqual(try roundTrip(task), task)
    }

    func testDecodesBotFolders() throws {
        let project = try decode(BotProject.self, #"{"id":"f1","name":"Clients","emoji":"📁"}"#)
        XCTAssertEqual(project.name, "Clients")
    }

    func testDecodesRoomPeopleAndOwnership() throws {
        let room = try decode(Room.self, #"""
        {"id":"g1","threadId":"t1","name":"Standup","memberIds":["b1","b2"],
         "defaultResponder":{"kind":"mentions"},"bulletin":"Be brief","unread":false,"createdAt":1,
         "humanIds":["p1","p2"],"pinnedMessageId":"m9","createdBy":"p1","ownerId":null,
         "memoryEnabled":false,"working":true,"turnStartedAt":42,"setupCompletedAt":2,"setupSkippedAt":null}
        """#)
        XCTAssertEqual(room.humanIds, ["p1", "p2"])
        XCTAssertEqual(room.pinnedMessageId, "m9")
        XCTAssertEqual(room.createdBy, "p1")
        XCTAssertNil(room.ownerId)
        XCTAssertEqual(room.memoryEnabled, false)
        XCTAssertEqual(room.working, true)
        XCTAssertEqual(room.setupCompletedAt, 2)
        XCTAssertEqual(try roundTrip(room), room)
    }

    // MARK: Routines

    private static let intervalRoutineJSON = #"""
    {"id":"r1","name":"Pulse","prompt":"Check status","botId":"b1","runOn":"maus","enabled":true,
     "schedule":{"type":"interval","everyMinutes":30,"anchorAt":1788384600000,"weekdays":[1,3,5],
                 "window":{"start":"09:00","end":"17:00"},"endsAt":1790000000000},
     "durationMinutes":30,"timeoutMinutes":45,"nextRunAt":1788386400000,"createdAt":1,"updatedAt":2,
     "target":"bot","overlap":"queue","skippedRuns":3,"failureStreak":1,
     "attachments":[{"id":"a1","kind":"file","name":"brief.md","path":"/x/brief.md","size":120}],
     "sourceThreadId":"t0","resultsThreadId":"t5","runAs":{"principalId":"p1","name":"JC"},
     "suspended":{"reason":"person_out","at":9}}
    """#

    func testAnIntervalScheduleRoundTripsWithoutLoss() throws {
        let routine = try decode(Routine.self, Self.intervalRoutineJSON)
        XCTAssertEqual(routine.schedule.weekdays, [1, 3, 5])
        XCTAssertEqual(routine.schedule.window, RoutineIntervalWindow(start: "09:00", end: "17:00"))
        XCTAssertEqual(routine.schedule.endsAt, 1_790_000_000_000)
        XCTAssertEqual(routine.overlap, "queue")
        XCTAssertEqual(routine.attachments?.first?.name, "brief.md")
        XCTAssertEqual(routine.resultsThreadId, "t5")
        XCTAssertEqual(routine.runAs?.name, "JC")
        XCTAssertEqual(routine.suspended?.reason, "person_out")
        XCTAssertEqual(try roundTrip(routine), routine)

        let wire = RoutinePatch.scheduleBody(routine.schedule)
        XCTAssertEqual(wire["weekdays"] as? [Int], [1, 3, 5])
        XCTAssertEqual(wire["window"] as? [String: String], ["start": "09:00", "end": "17:00"])
        XCTAssertEqual((wire["endsAt"] as? Int64), 1_790_000_000_000)
    }

    func testAnUnchangedEditSendsNothing() throws {
        let routine = try decode(Routine.self, Self.intervalRoutineJSON)
        let input = RoutineInput(
            name: routine.name, prompt: routine.prompt, botId: routine.botId, runOn: routine.runOn,
            enabled: routine.enabled,
            // what the phone's editor rebuilds: no days, window or end date
            schedule: .interval(everyMinutes: 30, anchorAt: Date(timeIntervalSince1970: 1_788_384_600)),
            durationMinutes: 30, timeoutMinutes: 45, clearTimeout: false
        )
        XCTAssertTrue(RoutinePatch.body(original: routine, input: input).isEmpty)
    }

    func testARenameSendsOnlyTheName() throws {
        let routine = try decode(Routine.self, Self.intervalRoutineJSON)
        let input = RoutineInput(
            name: "Pulse 2", prompt: routine.prompt, botId: routine.botId, runOn: routine.runOn,
            enabled: routine.enabled,
            schedule: .interval(everyMinutes: 30, anchorAt: Date(timeIntervalSince1970: 1_788_384_600)),
            durationMinutes: 30, timeoutMinutes: 45
        )
        let body = RoutinePatch.body(original: routine, input: input)
        XCTAssertEqual(Set(body.keys), ["name"])
        XCTAssertEqual(body["name"] as? String, "Pulse 2")
    }

    func testAnIntervalChangeKeepsTheDaysWindowAndEndDate() throws {
        let routine = try decode(Routine.self, Self.intervalRoutineJSON)
        let input = RoutineInput(
            name: routine.name, prompt: routine.prompt, botId: routine.botId, runOn: routine.runOn,
            schedule: .interval(everyMinutes: 60, anchorAt: Date(timeIntervalSince1970: 1_788_384_600)),
            durationMinutes: 30, timeoutMinutes: 45
        )
        let body = RoutinePatch.body(original: routine, input: input)
        XCTAssertEqual(Set(body.keys), ["schedule"])
        let schedule = try XCTUnwrap(body["schedule"] as? [String: Any])
        XCTAssertEqual(schedule["everyMinutes"] as? Int, 60)
        XCTAssertEqual(schedule["weekdays"] as? [Int], [1, 3, 5])
        XCTAssertEqual(schedule["window"] as? [String: String], ["start": "09:00", "end": "17:00"])
        XCTAssertEqual(schedule["endsAt"] as? Int64, 1_790_000_000_000)
    }

    func testChangingTheKindDropsIntervalRestrictions() throws {
        let routine = try decode(Routine.self, Self.intervalRoutineJSON)
        let input = RoutineInput(
            name: routine.name, prompt: routine.prompt, botId: routine.botId, runOn: routine.runOn,
            schedule: .daily(time: "08:00", weekdays: [1, 2]), durationMinutes: 30, timeoutMinutes: 45
        )
        let schedule = try XCTUnwrap(RoutinePatch.body(original: routine, input: input)["schedule"] as? [String: Any])
        XCTAssertEqual(schedule["type"] as? String, "daily")
        XCTAssertNil(schedule["window"])
        XCTAssertNil(schedule["endsAt"])
    }

    func testTheTimeoutIsSentOnlyWhenItChanged() throws {
        let routine = try decode(Routine.self, Self.intervalRoutineJSON)
        let schedule = RoutineSchedule.interval(everyMinutes: 30, anchorAt: Date(timeIntervalSince1970: 1_788_384_600))
        let cleared = RoutinePatch.body(original: routine, input: RoutineInput(
            name: routine.name, prompt: routine.prompt, botId: routine.botId, runOn: routine.runOn,
            schedule: schedule, durationMinutes: 30, timeoutMinutes: nil, clearTimeout: true
        ))
        XCTAssertTrue(cleared["timeoutMinutes"] is NSNull)
        let untouched = RoutinePatch.body(original: routine, input: RoutineInput(
            name: routine.name, prompt: routine.prompt, botId: routine.botId, runOn: routine.runOn,
            schedule: schedule, durationMinutes: 30, timeoutMinutes: nil, clearTimeout: false
        ))
        XCTAssertNil(untouched["timeoutMinutes"])
    }

    func testAOnceScheduleSurvivesTheDateRoundTrip() throws {
        var routine = try decode(Routine.self, Self.intervalRoutineJSON)
        routine.schedule = .init(type: .once, at: 1_788_384_600_123)
        let input = RoutineInput(
            name: routine.name, prompt: routine.prompt, botId: routine.botId, runOn: routine.runOn,
            schedule: .once(at: Date(timeIntervalSince1970: 1_788_384_600_123 / 1_000)),
            durationMinutes: 30, timeoutMinutes: 45
        )
        XCTAssertNil(RoutinePatch.body(original: routine, input: input)["schedule"])
    }
}

// MARK: - Capability gate

final class SurfaceGateTests: XCTestCase {
    private let sidecar = SurfaceGate(scope: .sidecar)
    private let client = SurfaceGate(scope: .serverClient)
    private let admin = SurfaceGate(scope: .serverAdmin)

    func testTheScopeComesFromTheConnection() {
        let paired = Connection(name: "Mac", host: "127.0.0.1", port: 8810)
        XCTAssertEqual(SurfaceGate(connection: paired).scope, .sidecar)
        let chatOnly = Connection(name: "Srv", host: "srv.example", port: 443, serverEnvironmentId: "env", serverScopes: ["client"])
        XCTAssertEqual(SurfaceGate(connection: chatOnly).scope, .serverClient)
        let owner = Connection(name: "Srv", host: "srv.example", port: 443, serverEnvironmentId: "env", serverScopes: ["admin"])
        XCTAssertEqual(SurfaceGate(connection: owner).scope, .serverAdmin)
        let legacy = Connection(name: "Srv", host: "srv.example", port: 443, serverEnvironmentId: "env")
        XCTAssertEqual(SurfaceGate(connection: legacy).scope, .serverClient)
    }

    func testAnOrganizationIsAServerWhoseSessionNamesAPrincipal() throws {
        let account = try JSONDecoder().decode(AuthSession.self, from: Data(#"{"kind":"session","scopes":["client"],"principalId":"p1"}"#.utf8))
        let server = Connection(name: "Org", host: "org.example", port: 443, serverEnvironmentId: "env", serverScopes: ["client"])
        XCTAssertTrue(SurfaceGate(connection: server, account: account).organization)
        let sidecar = Connection(name: "Mac", host: "127.0.0.1", port: 8810)
        XCTAssertFalse(SurfaceGate(connection: sidecar, account: account).organization)
    }

    func testTheVoiceEngineIsNeverAConfigWriteOnASidecar() {
        XCTAssertTrue(sidecar.allows(.voiceEngineSettings), "this release's desktop serves PUT /api/tts/provider")
        XCTAssertFalse(SurfaceGate(scope: .sidecar, sidecarRoutes: []).allows(.voiceEngineSettings), "an older desktop does not")
        XCTAssertFalse(client.allows(.voiceEngineSettings))
        XCTAssertTrue(admin.allows(.voiceEngineSettings))
        XCTAssertTrue(SurfaceGate(scope: .sidecar, sidecarRoutes: .voiceEngine).allows(.voiceEngineSettings))
    }

    func testTheOverviewFollowsTheRoutes() {
        XCTAssertTrue(sidecar.allows(.botOverview))
        XCTAssertFalse(client.allows(.botOverview))
        XCTAssertTrue(admin.allows(.botOverview))
    }

    func testJCsDecisions() {
        // D1: the advanced panel opens on a sidecar once its routes do
        XCTAssertTrue(sidecar.allows(.advancedBotPanel))
        XCTAssertFalse(SurfaceGate(scope: .sidecar, sidecarRoutes: []).allows(.advancedBotPanel))
        XCTAssertTrue(SurfaceGate(scope: .sidecar, sidecarRoutes: .advancedPanel).allows(.advancedBotPanel))
        XCTAssertFalse(client.allows(.advancedBotPanel))
        // D2: message pin everywhere
        XCTAssertTrue([sidecar, client, admin].allSatisfy { $0.allows(.messagePin) })
        // D3: room memory on a sidecar once S1 lands; servers already serve it
        XCTAssertTrue(sidecar.allows(.roomMemory))
        XCTAssertFalse(SurfaceGate(scope: .sidecar, sidecarRoutes: []).allows(.roomMemory))
        XCTAssertTrue(SurfaceGate(scope: .sidecar, sidecarRoutes: .roomMemory).allows(.roomMemory))
        XCTAssertTrue(client.allows(.roomMemory))
        // D4: the phone's extras for the owner or an admin
        XCTAssertTrue(sidecar.allows(.botOwnerExtras))
        XCTAssertTrue(admin.allows(.botOwnerExtras))
        XCTAssertFalse(client.allows(.botOwnerExtras))
    }

    func testRemoteClientHiddenFeaturesNeedAdminOrAnOrganization() {
        XCTAssertFalse(sidecar.allows(.roomManagement))
        XCTAssertFalse(client.allows(.roomManagement))
        XCTAssertTrue(SurfaceGate(scope: .serverClient, organization: true).allows(.roomManagement))
        XCTAssertTrue(admin.allows(.roomManagement))
        XCTAssertFalse(sidecar.allows(.inspector))
        XCTAssertTrue(admin.allows(.inspector))
        XCTAssertFalse(admin.allows(.webhooks))
        XCTAssertFalse(admin.allows(.orgRoutineDelegation))
        XCTAssertTrue(SurfaceGate(scope: .serverClient, organization: true).allows(.orgRoutineDelegation))
    }

    func testRouteGapsStayHiddenUntilTheRouteExists() {
        XCTAssertTrue(sidecar.allows(.parallelTaskStop))
        XCTAssertFalse(SurfaceGate(scope: .sidecar, sidecarRoutes: []).allows(.parallelTaskStop))
        XCTAssertTrue(client.allows(.parallelTaskStop))
        XCTAssertTrue([sidecar, client, admin].allSatisfy { $0.allows(.createBot) })
    }
}

// MARK: - Requests

private final class CoreRequestStub: URLProtocol {
    static var requests: [(request: URLRequest, body: Data?)] = []
    static var response = Data("{}".utf8)

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.requests.append((request, Self.body(of: request)))
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.response)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    private static func body(of request: URLRequest) -> Data? {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 1_024)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count <= 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }
}

final class ParityCoreRequestTests: XCTestCase {
    private var session: URLSession!
    private var client: CompanionClient!

    override func setUp() {
        super.setUp()
        CoreRequestStub.requests = []
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CoreRequestStub.self]
        session = URLSession(configuration: configuration)
        client = CompanionClient(connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810), token: "t", session: session)
    }

    override func tearDown() {
        session.invalidateAndCancel()
        super.tearDown()
    }

    private func lastBody() throws -> [String: Any] {
        let data = try XCTUnwrap(CoreRequestStub.requests.last?.body)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    func testARoomIsCreatedWithTheRemoteClientsSetup() async throws {
        CoreRequestStub.response = Data(#"""
        {"group":{"id":"g1","threadId":"t1","name":"Ara & co.","memberIds":["b1"],
          "defaultResponder":{"kind":"mentions"},"bulletin":"","unread":false,"createdAt":1}}
        """#.utf8)
        _ = try await client.createRoom(name: nil, memberIds: ["b1"])
        let body = try lastBody()
        let setup = try XCTUnwrap(body["setup"] as? [String: Any])
        XCTAssertEqual(setup["bulletin"] as? String, "")
        XCTAssertEqual((setup["defaultResponder"] as? [String: String])?["kind"], "mentions")
        XCTAssertEqual(body["memberIds"] as? [String], ["b1"])
    }

    func testARoutineEditPatchesOnlyWhatChanged() async throws {
        let json = #"""
        {"id":"r1","name":"Pulse","prompt":"Check","botId":"b1","runOn":"maus","enabled":true,
         "schedule":{"type":"interval","everyMinutes":30,"anchorAt":1788384600000,
                     "window":{"start":"09:00","end":"17:00"},"endsAt":1790000000000},
         "durationMinutes":30,"createdAt":1,"updatedAt":2}
        """#
        let original = try JSONDecoder().decode(Routine.self, from: Data(json.utf8))
        CoreRequestStub.response = Data(#"{"routine":\#(json)}"#.utf8)
        let anchor = Date(timeIntervalSince1970: 1_788_384_600)

        let unchanged = RoutineInput(name: "Pulse", prompt: "Check", botId: "b1", enabled: true,
                                     schedule: .interval(everyMinutes: 30, anchorAt: anchor), clearTimeout: true)
        _ = try await client.updateRoutine(original, input: unchanged)
        XCTAssertTrue(CoreRequestStub.requests.isEmpty, "nothing changed, nothing sent")

        var renamed = unchanged
        renamed.prompt = "Check twice"
        _ = try await client.updateRoutine(original, input: renamed)
        let request = try XCTUnwrap(CoreRequestStub.requests.last?.request)
        XCTAssertEqual(request.httpMethod, "PATCH")
        XCTAssertEqual(request.url?.path, "/api/routines/r1")
        XCTAssertEqual(Set(try lastBody().keys), ["prompt"])
    }

    func testSendOptionsReachTheRouteThatReadsThem() async throws {
        CoreRequestStub.response = Data(#"{"ok":true}"#.utf8)
        _ = try? await client.send(
            text: "and this", to: .bot(id: "b1", threadId: "t1"), sendId: "send-0000000000000001",
            options: SendOptions(replyToId: "m2", busyMode: .parallel, goal: true)
        )
        var body = try lastBody()
        XCTAssertEqual(body["replyToId"] as? String, "m2")
        XCTAssertEqual(body["busyMode"] as? String, "parallel")
        XCTAssertNil(body["mode"])

        _ = try? await client.send(
            text: "ship it", to: .room(id: "g1", threadId: "t2"), sendId: "send-0000000000000002",
            options: SendOptions(busyMode: .after, goal: true)
        )
        body = try lastBody()
        XCTAssertEqual(body["mode"] as? String, "goal")
        XCTAssertNil(body["busyMode"])
        XCTAssertNil(body["replyToId"])

        _ = try? await client.send(text: "plain", to: .bot(id: "b1", threadId: "t1"), sendId: "send-0000000000000003")
        body = try lastBody()
        XCTAssertEqual(Set(body.keys), ["text", "threadId", "sendId"])
    }
}
