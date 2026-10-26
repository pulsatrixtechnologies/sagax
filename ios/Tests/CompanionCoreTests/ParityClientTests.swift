// Client calls and wire models for the visual-parity screens. Payloads are
// written in the shapes the server's handlers return (server/index.ts,
// server/user-sandbox-routes.ts, server/routes/user-preferences.ts,
// shared/command-allowlist.ts), one test per decoder and request builder.
import Foundation
import XCTest
@testable import CompanionCore

private final class ParityRequestStub: URLProtocol {
    static var responseBody = Data()
    static var statusCode = 200
    static var capturedRequest: URLRequest?
    static var capturedBody: Data?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.capturedRequest = request
        Self.capturedBody = Self.readBody(from: request)
        let response = HTTPURLResponse(
            url: request.url!, statusCode: Self.statusCode, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.responseBody)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    private static func readBody(from request: URLRequest) -> Data? {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 1_024)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            guard count >= 0 else { return nil }
            if count == 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }
}

final class ParityClientTests: XCTestCase {
    private var session: URLSession!
    private var client: CompanionClient!

    private static let botJSON = #"""
    {"bot":{"id":"bot-1","threadId":"thread-1","name":"Ara","title":"Admin","description":"",
    "notifications":true,"color":"purple","unread":false,"pinned":true,
    "modelSelection":{"instanceId":"claude","model":"default"},"createdAt":1,
    "speakReplies":false,"voice":"voice-1"}}
    """#

    override func setUp() {
        super.setUp()
        ParityRequestStub.capturedRequest = nil
        ParityRequestStub.capturedBody = nil
        ParityRequestStub.statusCode = 200
        ParityRequestStub.responseBody = Data("{}".utf8)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ParityRequestStub.self]
        session = URLSession(configuration: configuration)
        client = CompanionClient(
            connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810),
            token: "paired-token",
            session: session
        )
    }

    override func tearDown() {
        session.invalidateAndCancel()
        session = nil
        client = nil
        super.tearDown()
    }

    private func respond(_ json: String, status: Int = 200) {
        ParityRequestStub.responseBody = Data(json.utf8)
        ParityRequestStub.statusCode = status
    }

    private func capturedJSON() throws -> [String: Any] {
        let body = try XCTUnwrap(ParityRequestStub.capturedBody)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
    }

    private var captured: URLRequest { ParityRequestStub.capturedRequest! }

    // MARK: Bots

    func testDeleteBotSendsDeleteToTheBotRoute() async throws {
        respond(#"{"ok":true}"#)
        try await client.deleteBot(botId: "bot-1")
        XCTAssertEqual(captured.httpMethod, "DELETE")
        XCTAssertEqual(captured.url?.path, "/api/bots/bot-1")
        XCTAssertEqual(captured.value(forHTTPHeaderField: "Authorization"), "Bearer paired-token")
    }

    func testDeleteBotRefusesAPathLikeId() {
        XCTAssertThrowsError(try client.deleteBotRequest(botId: "../config"))
    }

    func testDeleteBotSurfacesTheServersRefusal() async {
        respond(#"{"error":"forbidden: only the bot owner or an admin can delete it"}"#, status: 403)
        do {
            try await client.deleteBot(botId: "bot-1")
            XCTFail("expected a refusal")
        } catch let APIError.status(code, message) {
            XCTAssertEqual(code, 403)
            XCTAssertEqual(message, "forbidden: only the bot owner or an admin can delete it")
        } catch {
            XCTFail("unexpected \(error)")
        }
    }

    func testPatchBotSendsOnlyTheFieldsSet() async throws {
        respond(Self.botJSON)
        let bot = try await client.patchBot(botId: "bot-1", patch: BotPatch(pinned: true, title: "Admin"))
        XCTAssertEqual(captured.httpMethod, "PATCH")
        XCTAssertEqual(captured.url?.path, "/api/bots/bot-1")
        XCTAssertEqual(captured.value(forHTTPHeaderField: "Content-Type"), "application/json")
        let body = try capturedJSON()
        XCTAssertEqual(Set(body.keys), ["pinned", "title"])
        XCTAssertEqual(body["pinned"] as? Bool, true)
        XCTAssertEqual(body["title"] as? String, "Admin")
        XCTAssertEqual(bot.id, "bot-1")
        XCTAssertEqual(bot.name, "Ara")
    }

    func testBotPatchEncodesEveryField() throws {
        let patch = BotPatch(pinned: false, color: "blue", notifications: true, soul: "Be brief.", title: "Ops", name: "Helios")
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(patch)) as? [String: Any])
        XCTAssertEqual(Set(object.keys), ["pinned", "color", "notifications", "soul", "title", "name"])
        XCTAssertEqual(object["color"] as? String, "blue")
        XCTAssertEqual(object["notifications"] as? Bool, true)
    }

    func testAnEmptyPatchIsNotSent() {
        XCTAssertTrue(BotPatch().isEmpty)
        XCTAssertThrowsError(try client.patchBotRequest(botId: "bot-1", patch: BotPatch()))
    }

    func testSetPinnedIsAPinnedOnlyPatch() async throws {
        respond(Self.botJSON)
        _ = try await client.setPinned(botId: "bot-1", pinned: false)
        XCTAssertEqual(try capturedJSON().keys.sorted(), ["pinned"])
    }

    func testSoulDecodesTheHandlersShape() async throws {
        respond(#"""
        {"soul":"# Ara\nYou run the team.\n","revision":"r-12","bytes":24,"limit":65536,
         "file":"/data/bots/bot-1/SOUL.md","drift":false}
        """#)
        let soul = try await client.soul(botId: "bot-1")
        XCTAssertEqual(captured.httpMethod, "GET")
        XCTAssertEqual(captured.url?.path, "/api/bots/bot-1/soul")
        XCTAssertEqual(soul.soul, "# Ara\nYou run the team.\n")
        XCTAssertEqual(soul.bytes, 24)
        XCTAssertEqual(soul.limit, 65536)
        XCTAssertEqual(soul.drift, false)
        XCTAssertEqual(soul.revision, "r-12")
        XCTAssertEqual(soul.lead, "Ara")
    }

    func testSoulToleratesANumericRevisionAndEmptyText() throws {
        let soul = try JSONDecoder().decode(BotSoul.self, from: Data(#"{"revision":7}"#.utf8))
        XCTAssertEqual(soul.soul, "")
        XCTAssertEqual(soul.revision, "7")
        XCTAssertNil(soul.lead)
    }

    func testCommandAllowlistDecodesRulesAndContext() async throws {
        respond(#"""
        {"rules":[{"id":"r1","command":"git status","cwd":"/work","providerInstanceId":"claude"}],
         "context":{"providerInstanceId":"claude","cwd":null},"supported":true}
        """#)
        let list = try await client.commandAllowlist(botId: "bot-1")
        XCTAssertEqual(captured.url?.path, "/api/bots/bot-1/command-allowlist")
        XCTAssertEqual(list.rules.map(\.command), ["git status"])
        XCTAssertEqual(list.context?.providerInstanceId, "claude")
        XCTAssertNil(list.context?.cwd)
        XCTAssertTrue(list.supported)
    }

    // MARK: Thread files

    func testThreadFilesDecodesAndClassifiesMedia() async throws {
        respond(#"""
        {"files":[
          {"id":"0123456789abcdef01234567","messageId":"m2","source":"attachment","path":"/x/a.png",
           "name":"a.png","mime":"image/png","at":20,"size":1024,"available":true,"localPath":"/x/a.png"},
          {"id":"89abcdef0123456789abcdef","messageId":"m1","source":"link","path":"/x/plan.pdf",
           "name":"plan.pdf","at":10,"size":null,"available":false},
          {"id":"fedcba9876543210fedcba98","messageId":"m0","source":"future","path":"/x/b.jpg",
           "name":"b.jpg","at":5,"size":3,"available":true}
        ]}
        """#)
        let files = try await client.threadFiles(threadId: "thread-1")
        XCTAssertEqual(captured.url?.path, "/api/threads/thread-1/files")
        XCTAssertEqual(files.count, 3)
        XCTAssertEqual(files[0].source, .attachment)
        XCTAssertTrue(files[0].isImage)
        XCTAssertEqual(files[0].size, 1024)
        XCTAssertFalse(files[1].isImage)
        XCTAssertNil(files[1].size)
        XCTAssertFalse(files[1].available)
        XCTAssertEqual(files[2].source, .unknown)
        XCTAssertTrue(files[2].isImage, "no mime: the extension decides")
    }

    func testThreadFilePreviewRequest() throws {
        let request = try client.threadFileRequest(threadId: "thread-1", fileId: "0123456789abcdef01234567", preview: true)
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.url?.path, "/api/threads/thread-1/files/0123456789abcdef01234567")
        XCTAssertEqual(request.url?.query, "preview=1")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer paired-token")

        let download = try client.threadFileRequest(threadId: "thread-1", fileId: "0123456789abcdef01234567", preview: false)
        XCTAssertNil(download.url?.query)
    }

    func testThreadFileRequestRejectsAnythingButTheOpaqueId() {
        XCTAssertThrowsError(try client.threadFileRequest(threadId: "thread-1", fileId: "../../etc/passwd", preview: true))
        XCTAssertThrowsError(try client.threadFileRequest(threadId: "thread-1", fileId: "0123456789ABCDEF01234567", preview: true))
        XCTAssertThrowsError(try client.threadFileRequest(threadId: "a/b", fileId: "0123456789abcdef01234567", preview: true))
    }

    func testThreadFileDataReturnsTheBytes() async throws {
        respond("PNGBYTES")
        let data = try await client.threadFileData(threadId: "thread-1", fileId: "0123456789abcdef01234567")
        XCTAssertEqual(String(decoding: data, as: UTF8.self), "PNGBYTES")
        XCTAssertEqual(captured.url?.query, "preview=1")
    }

    // MARK: Account and settings

    func testAuthSessionDecodesAServerSession() async throws {
        respond(#"""
        {"kind":"session","id":"s1","label":"iPhone","scopes":["client"],"expiresAt":1790000000000,
         "via":"bearer","environmentId":"env-1","email":"person@example.com","name":"Ada","role":"member",
         "principalId":"pr_00000000-0000-0000-0000-000000000000"}
        """#)
        let auth = try await client.authSession()
        XCTAssertEqual(captured.url?.path, "/api/auth/session")
        XCTAssertEqual(auth.kind, "session")
        XCTAssertEqual(auth.label, "iPhone")
        XCTAssertEqual(auth.email, "person@example.com")
        XCTAssertEqual(auth.name, "Ada")
        XCTAssertFalse(auth.isAdmin)
    }

    func testAuthSessionDecodesLoopbackAndIgnoresOddShapes() throws {
        let auth = try JSONDecoder().decode(AuthSession.self, from: Data(#"""
        {"kind":"loopback","scopes":["admin","client"],"environmentId":"env-1","owner":{"id":1}}
        """#.utf8))
        XCTAssertEqual(auth.kind, "loopback")
        XCTAssertTrue(auth.isAdmin)
        XCTAssertNil(auth.owner)
    }

    func testUsageReadsTheBudgetPercent() async throws {
        respond(#"""
        {"from":"2026-10-01T00:00:00.000Z","to":"2026-10-31T00:00:00.000Z","groupBy":"bot","rows":[],
         "budget":{"month":"2026-10","monthlyUsd":100,"spentUsd":35,"percent":35,"warnAtPercent":80,"warn":false,"exceeded":false},
         "billing":null}
        """#)
        let usage = try await client.usage()
        XCTAssertEqual(captured.url?.path, "/api/usage")
        XCTAssertEqual(usage.budgetPercent, 35)
        XCTAssertEqual(usage.budget?.warnAtPercent, 80)
    }

    func testUsageWithoutABudgetHidesTheRow() throws {
        let usage = try JSONDecoder().decode(UsageSummary.self, from: Data(#"{"budget":null,"billing":null}"#.utf8))
        XCTAssertNil(usage.budgetPercent)
    }

    func testPreferencesGetAndPut() async throws {
        respond(#"{"stored":true,"preferences":{"omb-language":"fr"},"updatedAt":5}"#)
        let got = try await client.preferences()
        XCTAssertEqual(captured.httpMethod, "GET")
        XCTAssertEqual(captured.url?.path, "/api/me/preferences")
        XCTAssertTrue(got.stored)
        XCTAssertEqual(got.preferences[UserPreferences.languageKey], "fr")

        respond(#"{"stored":true,"preferences":{"omb-language":"en"},"updatedAt":6}"#)
        let put = try await client.putPreferences(["omb-language": "en"])
        XCTAssertEqual(captured.httpMethod, "PUT")
        XCTAssertEqual(captured.value(forHTTPHeaderField: "Content-Type"), "application/json")
        let body = try capturedJSON()
        XCTAssertEqual(body["preferences"] as? [String: String], ["omb-language": "en"])
        XCTAssertEqual(put.updatedAt, 6)
    }

    func testPreferencesDefaultWhenNothingIsStored() throws {
        let prefs = try JSONDecoder().decode(UserPreferences.self, from: Data(#"{"stored":false,"preferences":{},"updatedAt":null}"#.utf8))
        XCTAssertFalse(prefs.stored)
        XCTAssertTrue(prefs.preferences.isEmpty)
        XCTAssertNil(prefs.updatedAt)
    }

    func testServerEnvironmentStatusAndDiskSpace() async throws {
        respond(#"""
        {"configured":true,"state":"running","lastUsedAt":10,"workspaceBytes":950,"overQuota":false,
         "limits":{"workspaceBytes":1000},"idleMinutes":30,"pendingDeletionAt":null}
        """#)
        let status = try await client.serverEnvironment()
        XCTAssertEqual(captured.url?.path, "/api/me/server-environment")
        XCTAssertTrue(status.configured)
        XCTAssertEqual(status.state, "running")
        XCTAssertEqual(status.diskSpace, .almostFull)
    }

    func testServerEnvironmentDiskSpaceStates() throws {
        func decode(_ json: String) throws -> ServerEnvironmentStatus {
            try JSONDecoder().decode(ServerEnvironmentStatus.self, from: Data(json.utf8))
        }
        XCTAssertEqual(try decode(#"{"configured":false}"#).diskSpace, .unknown)
        XCTAssertEqual(try decode(#"{"configured":true,"state":"stopped","workspaceBytes":null,"limits":null}"#).diskSpace, .normal)
        XCTAssertEqual(try decode(#"{"configured":true,"state":"running","workspaceBytes":10,"limits":{"workspaceBytes":1000}}"#).diskSpace, .normal)
        XCTAssertEqual(try decode(#"{"configured":true,"state":"running","overQuota":true}"#).diskSpace, .full)
    }

    func testResetServerEnvironmentSendsTheConfirmation() async throws {
        respond(#"{"configured":true,"state":"starting"}"#)
        let status = try await client.resetServerEnvironment()
        XCTAssertEqual(captured.httpMethod, "POST")
        XCTAssertEqual(captured.url?.path, "/api/me/server-environment/reset")
        XCTAssertEqual(try capturedJSON()["confirm"] as? Bool, true)
        XCTAssertEqual(status.state, "starting")
    }

    func testPowerServerEnvironmentPostsTheAction() async throws {
        respond(#"{"configured":true,"state":"running"}"#)
        let status = try await client.powerServerEnvironment(.start)
        XCTAssertEqual(captured.httpMethod, "POST")
        XCTAssertEqual(captured.url?.path, "/api/me/server-environment/power")
        XCTAssertEqual(try capturedJSON()["action"] as? String, "start")
        XCTAssertEqual(status?.state, "running")
    }

    func testPowerServerEnvironmentTreats409AsConfirmRunning() async throws {
        respond(#"{"error":"confirm_running"}"#, status: 409)
        let status = try await client.powerServerEnvironment(.shutdown)
        XCTAssertNil(status)
        XCTAssertEqual(captured.url?.path, "/api/me/server-environment/power")
    }

    func testSandboxViewerAsksForControlAndBuildsAWebSocket() async throws {
        respond(#"{"password":"secret","viewOnly":true}"#)
        let config = try await client.sandboxViewer(control: true)
        XCTAssertEqual(captured.httpMethod, "GET")
        XCTAssertEqual(captured.url?.path, "/api/desktop-viewer/sandbox/me")
        XCTAssertEqual(captured.url?.query, "control=1")
        XCTAssertEqual(config.password, "secret")
        XCTAssertEqual(config.viewOnly, true)
        let socket = try client.sandboxViewerSocketRequest(control: true)
        XCTAssertEqual(socket.url?.scheme, "ws")
        XCTAssertEqual(socket.url?.path, "/api/desktop-viewer/sandbox/me/websockify")
        XCTAssertEqual(socket.url?.query, "control=1")
        XCTAssertEqual(socket.value(forHTTPHeaderField: "Authorization"), "Bearer paired-token")
    }

    func testMcpServersDecodesLocalAndRemote() async throws {
        respond(#"""
        {"servers":[
          {"name":"files","command":"npx","args":["-y","server"],"envKeys":[],"enabled":true},
          {"name":"crm","type":"http","url":"https://mcp.example.com","headerKeys":[],"enabled":true,"auth":"required","managedBy":"Org"}
        ],"managed":{"organizationName":"Org","allowlist":[]}}
        """#)
        let response = try await client.mcpServers()
        XCTAssertEqual(captured.url?.path, "/api/mcp/servers")
        XCTAssertEqual(response.servers.map(\.name), ["files", "crm"])
        XCTAssertFalse(response.servers[0].isRemote)
        XCTAssertTrue(response.servers[1].isRemote)
        XCTAssertEqual(response.servers[1].auth, "required")
        XCTAssertEqual(response.managed?.organizationName, "Org")
    }

    // MARK: Routines

    func testRoutineRunsAreFilteredByRoutineNewestFirst() async throws {
        respond(#"""
        {"routines":[],"runs":[
          {"id":"a","routineId":"r1","routineName":"Scan","botId":"b","runOn":"maus","scheduledFor":10,
           "status":"completed","manual":false,"createdAt":10},
          {"id":"b","routineId":"r2","routineName":"Other","botId":"b","runOn":"maus","scheduledFor":30,
           "status":"completed","manual":false,"createdAt":30},
          {"id":"c","routineId":"r1","routineName":"Scan","botId":"b","runOn":"maus","scheduledFor":20,
           "startedAt":25,"status":"failed","manual":true,"createdAt":20}
        ]}
        """#)
        let runs = try await client.routineRuns(routineId: "r1")
        XCTAssertEqual(captured.url?.path, "/api/routines")
        XCTAssertEqual(runs.map(\.id), ["c", "a"])
    }

    func testCronScheduleDecodes() throws {
        let routine = try JSONDecoder().decode(Routine.self, from: Data(#"""
        {"id":"r1","name":"Scan skills populaires mensuel","prompt":"p","botId":"b","runOn":"maus","enabled":true,
         "schedule":{"type":"cron","expression":"2 7 1-7 * 1","timeZone":"America/Toronto"},
         "durationMinutes":30,"nextRunAt":1,"createdAt":1,"updatedAt":1}
        """#.utf8))
        XCTAssertEqual(routine.schedule.type, .cron)
        XCTAssertEqual(routine.schedule.expression, "2 7 1-7 * 1")
        XCTAssertEqual(routine.schedule.timeZone, "America/Toronto")
        XCTAssertEqual(routine.schedule.cronDisplay, "CRON_TZ=America/Toronto 2 7 1-7 * 1")
        XCTAssertTrue(routine.canToggle())
    }

    func testCronDisplayIsNilForOtherKindsAndBareWithoutAZone() {
        XCTAssertNil(RoutineSchedule.daily(time: "07:00", weekdays: [1]).cronDisplay)
        var schedule = RoutineSchedule.cron(expression: "0 9 * * *", timeZone: "")
        XCTAssertEqual(schedule.cronDisplay, "0 9 * * *")
        schedule.timeZone = "UTC"
        XCTAssertEqual(schedule.cronDisplay, "CRON_TZ=UTC 0 9 * * *")
    }

    func testCronScheduleRoundTripsThroughRoutineUpdate() async throws {
        respond(#"""
        {"routine":{"id":"r1","name":"Scan","prompt":"p","botId":"b","runOn":"maus","enabled":false,
         "schedule":{"type":"cron","expression":"2 7 1-7 * 1","timeZone":"America/Toronto"},
         "durationMinutes":30,"createdAt":1,"updatedAt":2}}
        """#)
        let input = RoutineInput(
            name: "Scan", prompt: "p", botId: "b",
            schedule: .cron(expression: "2 7 1-7 * 1", timeZone: "America/Toronto")
        )
        let routine = try await client.updateRoutine(id: "r1", input: input)
        let schedule = try XCTUnwrap(try capturedJSON()["schedule"] as? [String: Any])
        XCTAssertEqual(schedule["type"] as? String, "cron")
        XCTAssertEqual(schedule["expression"] as? String, "2 7 1-7 * 1")
        XCTAssertEqual(schedule["timeZone"] as? String, "America/Toronto")
        XCTAssertEqual(routine.schedule.type, .cron)
    }

    func testAnUnknownScheduleStillDegradesToUnknown() throws {
        let schedule = try JSONDecoder().decode(RoutineSchedule.self, from: Data(#"{"type":"lunar"}"#.utf8))
        XCTAssertEqual(schedule.type, .unknown)
    }
}

// MARK: - Roster preview kind

final class RosterPreviewKindTests: XCTestCase {
    private func message(_ id: String, role: Message.Role = .bot, kind: Message.Kind = .text, text: String? = nil) -> Message {
        var message = Message(id: id, role: role, kind: kind, at: 1)
        message.text = text
        return message
    }

    func testPlainTextHasNoIcon() {
        let line = rosterPreviewLine([message("a", text: "Bonjour")], detail: .full)
        XCTAssertEqual(line, RosterPreviewLine(text: "Bonjour", kind: .plain))
    }

    func testABotAttachmentIsAnAttachment() throws {
        var reply = message("a", text: "Voici le rapport")
        reply.attachments = [try JSONDecoder().decode(
            MessageImageAttachment.self,
            from: Data(#"{"kind":"image","path":"/data/attachments/x.png","mime":"image/png"}"#.utf8)
        )]
        let line = rosterPreviewLine([reply], detail: .full)
        XCTAssertEqual(line.kind, .attachment)
        XCTAssertEqual(line.text, "Voici le rapport")
    }

    func testAPersonsUploadShowsTheWordsOrTheFileName() {
        let tagged = message("a", role: .user, text: "Budget\n<attached-file path=\"/tmp/q3.xlsx\" name=\"q3.xlsx\" />")
        XCTAssertEqual(rosterPreviewLine([tagged], detail: .full), RosterPreviewLine(text: "Budget", kind: .attachment))

        let bare = message("b", role: .user, text: "<attached-file path=\"/tmp/q3.xlsx\" name=\"q3.xlsx\" />")
        XCTAssertEqual(rosterPreviewLine([bare], detail: .full), RosterPreviewLine(text: "q3.xlsx", kind: .attachment))
    }

    func testAMessageToAnotherBotIsSentToBot() throws {
        var chip = message("a", kind: .activity)
        chip.tool = ToolActivity(name: "Message Helix", ok: true)
        chip.comm = try JSONDecoder().decode(
            CommChip.self,
            from: Data(#"{"groupId":"g","withBotId":"helix","withName":"Helix","withColor":"blue"}"#.utf8)
        )
        XCTAssertEqual(rosterPreviewKind(of: chip), .sentToBot)
        XCTAssertEqual(rosterPreviewLine([chip], detail: .full).kind, .sentToBot)
    }

    func testASentNoteShowsWhatItSentAndAReceivedOneHasNoSendIcon() throws {
        var sent = message("a", kind: .activity)
        sent.tool = ToolActivity(name: "Messaged @Cryptic", ok: true)
        sent.comm = try JSONDecoder().decode(
            CommChip.self,
            from: Data(#"{"groupId":"g","withBotId":"c","withName":"Cryptic","withColor":"blue","direction":"sent","text":"Peux-tu vérifier le billet ?"}"#.utf8)
        )
        XCTAssertEqual(rosterPreviewLine([sent], detail: .full), RosterPreviewLine(text: "Messaged @Cryptic: Peux-tu vérifier le billet ?", kind: .sentToBot))

        var received = message("b", kind: .activity)
        received.tool = ToolActivity(name: "Message from @Cryptic", ok: true)
        received.comm = try JSONDecoder().decode(
            CommChip.self,
            from: Data(#"{"groupId":"g","withBotId":"c","withName":"Cryptic","withColor":"blue","direction":"received"}"#.utf8)
        )
        XCTAssertEqual(rosterPreviewKind(of: received), .plain)

        // an older server: no direction, the note's own words tell
        var legacy = message("c", kind: .activity)
        legacy.tool = ToolActivity(name: "Message from @Cryptic", ok: true)
        legacy.comm = try JSONDecoder().decode(
            CommChip.self,
            from: Data(#"{"groupId":"g","withBotId":"c","withName":"Cryptic","withColor":"blue"}"#.utf8)
        )
        XCTAssertEqual(rosterPreviewKind(of: legacy), .plain)
    }

    func testTheKindFollowsTheFoldedRowNotTheRawLastMessage() {
        var tool = message("b", kind: .activity)
        tool.tool = ToolActivity(name: "shell", ok: true)
        let line = rosterPreviewLine([message("a", text: "Fini"), tool], detail: .hidden)
        XCTAssertEqual(line, RosterPreviewLine(text: "Fini", kind: .plain))
    }

    func testAnEmptyThreadIsPlainAndEmpty() {
        XCTAssertEqual(rosterPreviewLine([], detail: .full), RosterPreviewLine(text: "", kind: .plain))
    }
}

final class HomeSelectionTests: XCTestCase {
    func testOffscreenUnreadCountsAndPicksTheNearest() {
        let rows = [
            UnreadRowBox(id: "a", top: -200, bottom: -140, unread: true),
            UnreadRowBox(id: "b", top: -100, bottom: -40, unread: true),
            UnreadRowBox(id: "c", top: 10, bottom: 70, unread: true),
            UnreadRowBox(id: "d", top: 90, bottom: 150, unread: false),
            UnreadRowBox(id: "e", top: 700, bottom: 760, unread: true),
            UnreadRowBox(id: "f", top: 800, bottom: 860, unread: true),
        ]
        let result = OffscreenUnread.compute(rows: rows, viewportTop: 0, viewportBottom: 600)
        XCTAssertEqual(result, OffscreenUnread(above: 2, below: 2, nearestAbove: "b", nearestBelow: "e"))
    }

    func testARowHalfShownCountsAsSeen() {
        let rows = [UnreadRowBox(id: "a", top: -30, bottom: 30, unread: true)]
        XCTAssertEqual(OffscreenUnread.compute(rows: rows, viewportTop: 0, viewportBottom: 600).above, 0)
    }
}

final class CommPreviewTests: XCTestCase {
    private func note(_ name: String, text: String? = nil) throws -> Message {
        var message = Message(id: "n", role: .bot, kind: .activity, at: 1)
        message.tool = ToolActivity(name: name, ok: true)
        var json = #"{"groupId":"g","withBotId":"x","withName":"Cryptic","withColor":"blue""#
        if let text { json += #","text":"\#(text)""# }
        json += "}"
        message.comm = try JSONDecoder().decode(CommChip.self, from: Data(json.utf8))
        return message
    }

    func testSentShowsTheTextAndThePaperPlane() throws {
        let line = rosterPreviewLine([try note("Messaged @Cryptic", text: "Bonjour")], detail: .full)
        XCTAssertEqual(line, RosterPreviewLine(text: "Messaged @Cryptic: Bonjour", kind: .sentToBot))
    }

    func testSentWithoutTextKeepsTheName() throws {
        let line = rosterPreviewLine([try note("Messaged @Cryptic")], detail: .full)
        XCTAssertEqual(line, RosterPreviewLine(text: "Messaged @Cryptic", kind: .sentToBot))
    }

    func testReceivedHasNoPaperPlane() throws {
        let line = rosterPreviewLine([try note("Message from @Cryptic", text: "Salut")], detail: .full)
        XCTAssertEqual(line.kind, .plain)
        XCTAssertEqual(line.text, "Message from @Cryptic")
    }
}
