// "Only when something changes" (#1202) on the phone: the draft reads and
// writes the shapes of shared/routine-watch.ts as the desktop's WatchFields
// does, an edit preserves what was not touched, and Check now calls
// POST /api/routines/watch-check.
import Foundation
import XCTest
@testable import CompanionCore

private final class WatchStub: URLProtocol {
    static var responseBody = Data()
    static var statusCode = 200
    static var captured: URLRequest?
    static var capturedBody: Data?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.captured = request
        Self.capturedBody = request.httpBody ?? request.httpBodyStream.map { stream in
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
        let response = HTTPURLResponse(url: request.url!, statusCode: Self.statusCode, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.responseBody)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class RoutineWatchTests: XCTestCase {
    private func json(_ text: String) throws -> WidgetJSON {
        try JSONDecoder().decode(WidgetJSON.self, from: Data(text.utf8))
    }

    private func routine(precheck: String?) throws -> Routine {
        let text = """
        {"id":"r1","name":"Watch","prompt":"Report","botId":"bot-1","runOn":"maus","enabled":true,
         "schedule":{"type":"daily","time":"09:00"},"durationMinutes":30,"createdAt":0,"updatedAt":0\(precheck.map { ",\"precheck\":\($0)" } ?? "")}
        """
        return try JSONDecoder().decode(Routine.self, from: Data(text.utf8))
    }

    private func object(_ value: WidgetJSON?) -> [String: WidgetJSON] { value?.object ?? [:] }

    // MARK: Reading

    func testReadsEachSourceAndItsOptions() throws {
        let tool = RoutineWatchDraft(precheck: try json(#"""
        {"kind":"watch","source":{"type":"tool","tool":"server__search_items","args":{"status":"open","limit":5}},
         "wakeOn":"match","condition":{"test":"json_path","path":"$.items.length","op":"gte","value":3},
         "track":{"items":"$.items","key":"id","fields":["status","priority"]},"firstRun":"wake"}
        """#))
        XCTAssertTrue(tool.on)
        XCTAssertEqual(tool.type, .tool)
        XCTAssertEqual(tool.tool, "server__search_items")
        XCTAssertTrue(tool.args.contains("\"status\" : \"open\""))
        XCTAssertEqual(tool.condition, .jsonPath)
        XCTAssertEqual(tool.conditionOp, .gte)
        XCTAssertEqual(tool.conditionValue, "3")
        XCTAssertEqual(tool.wakeOn, "match")
        XCTAssertEqual(tool.trackItems, "$.items")
        XCTAssertEqual(tool.trackKey, "id")
        XCTAssertEqual(tool.trackFields, "status, priority")
        XCTAssertEqual(tool.firstRun, "wake")

        let files = RoutineWatchDraft(precheck: try json(#"{"kind":"watch","source":{"type":"files","path":"reports","recursive":true},"whenAsleep":"wake"}"#))
        XCTAssertEqual(files.type, .files)
        XCTAssertEqual(files.path, "reports")
        XCTAssertTrue(files.recursive)
        XCTAssertEqual(files.whenAsleep, "wake")
        XCTAssertTrue(files.showsWakeCost)

        let command = RoutineWatchDraft(precheck: try json(#"{"kind":"watch","source":{"type":"command","command":"git status --short"},"condition":{"test":"exit_code","op":"eq","value":1}}"#))
        XCTAssertEqual(command.command, "git status --short")
        XCTAssertEqual(command.condition, .exitCode)
        XCTAssertEqual(command.exitOp, "eq")
        XCTAssertEqual(command.exitValue, "1")
    }

    func testAConditionPrecheckIsNotAWatch() throws {
        let draft = RoutineWatchDraft(precheck: try json(#"{"kind":"condition","test":"weekday"}"#))
        XCTAssertFalse(draft.on)
        XCTAssertEqual(draft, RoutineWatchDraft())
        XCTAssertFalse(try routine(precheck: #"{"kind":"condition","test":"weekday"}"#).runsOnChange)
        XCTAssertTrue(try routine(precheck: #"{"kind":"watch","source":{"type":"files","path":""}}"#).runsOnChange)
        XCTAssertFalse(try routine(precheck: nil).runsOnChange)
    }

    // MARK: Building (watchFromDraft)

    func testBuildsWhatTheDesktopBuilds() throws {
        var draft = RoutineWatchDraft()
        draft.on = true
        draft.setType(.tool)
        draft.tool = " server__search_items "
        draft.args = #"{ "status": "open" }"#
        draft.condition = .jsonPath
        draft.conditionPath = "$.items.length"
        draft.conditionOp = .gt
        draft.conditionValue = " 2 "
        draft.wakeOn = "match"
        draft.trackFields = "status, , priority"
        draft.whenAsleep = "wake"
        let watch = object(try draft.build().get())
        XCTAssertEqual(watch["kind"], .string("watch"))
        XCTAssertEqual(object(watch["source"])["tool"], .string("server__search_items"))
        XCTAssertEqual(object(object(watch["source"])["args"])["status"], .string("open"))
        XCTAssertEqual(object(watch["condition"])["value"], .number(2))
        XCTAssertEqual(watch["wakeOn"], .string("match"))
        XCTAssertEqual(object(watch["track"])["fields"], .array([.string("status"), .string("priority")]))
        XCTAssertNil(watch["whenAsleep"], "a tool never wakes a computer")
        XCTAssertNil(watch["firstRun"], "baseline is the default, left out")

        draft.conditionOp = .exists
        XCTAssertNil(object(object(try draft.build().get())["condition"])["value"], "exists has no value")
        draft.condition = .none
        XCTAssertNil(object(try draft.build().get())["wakeOn"], "match needs a condition")
    }

    func testTypedValuesAndExitCode() throws {
        XCTAssertEqual(RoutineWatchRules.typed("true"), .bool(true))
        XCTAssertEqual(RoutineWatchRules.typed("false"), .bool(false))
        XCTAssertEqual(RoutineWatchRules.typed("4.5"), .number(4.5))
        XCTAssertEqual(RoutineWatchRules.typed("open "), .string("open "))
        XCTAssertEqual(RoutineWatchRules.typed(""), .string(""))
        var draft = RoutineWatchDraft()
        draft.on = true
        draft.setType(.command)
        draft.command = "make check"
        draft.condition = .exitCode
        draft.exitValue = "300"
        XCTAssertEqual(object(object(try draft.build().get())["condition"])["value"], .number(255))
        draft.exitValue = "nope"
        XCTAssertEqual(object(object(try draft.build().get())["condition"])["value"], .number(0))
    }

    func testFilesBuildAndPathsStayInsideTheFolder() throws {
        var draft = RoutineWatchDraft()
        draft.on = true
        draft.path = " reports "
        draft.recursive = true
        draft.trackItems = "$.items"
        draft.whenAsleep = "wake"
        let watch = object(try draft.build().get())
        XCTAssertEqual(object(watch["source"])["path"], .string("reports"))
        XCTAssertEqual(object(watch["source"])["recursive"], .bool(true))
        XCTAssertNil(watch["track"], "no track for files")
        XCTAssertEqual(watch["whenAsleep"], .string("wake"))
        draft.path = ""
        XCTAssertNotNil(try? draft.build().get(), "empty: the bot's folder")
        for bad in ["../secrets", "a/../../b", "/etc", ".."] {
            draft.path = bad
            XCTAssertEqual(draft.problem, .path, bad)
        }
        draft.path = "notes..md"
        XCTAssertNil(draft.problem, "two dots inside a name are fine")
    }

    func testMissingFieldsAreNamed() {
        var draft = RoutineWatchDraft()
        draft.on = true
        draft.setType(.command)
        XCTAssertEqual(draft.problem, .command)
        draft.setType(.tool)
        XCTAssertEqual(draft.problem, .tool)
        draft.tool = "server__list"
        draft.args = "[1, 2]"
        XCTAssertEqual(draft.problem, .args)
        draft.args = "{ not json"
        XCTAssertEqual(draft.problem, .args)
        draft.args = ""
        draft.condition = .jsonPath
        XCTAssertEqual(draft.problem, .conditionPath)
        draft.condition = .contains
        XCTAssertEqual(draft.problem, .contains)
        draft.on = false
        XCTAssertNil(draft.problem, "off: nothing to check")
    }

    func testAnotherSourceDropsAConditionItDoesNotOffer() {
        var draft = RoutineWatchDraft()
        draft.setType(.command)
        draft.condition = .exitCode
        draft.setType(.tool)
        XCTAssertEqual(draft.condition, .none)
        XCTAssertEqual(draft.conditionChoices, [.none, .jsonPath, .contains])
        draft.condition = .contains
        draft.setType(.files)
        XCTAssertEqual(draft.condition, .none)
        XCTAssertEqual(RoutineWatchDraft().conditionChoices, [.none, .jsonPath])
    }

    // MARK: Editing preserves

    func testAnUntouchedWatchIsNeverSent() throws {
        let original = try routine(precheck: #"{"kind":"watch","source":{"type":"tool","tool":"server__list","args":{"b":1,"a":2}},"future":"kept"}"#)
        let initial = RoutineWatchDraft(precheck: original.precheck)
        let edit = try RoutineWatchRules.edit(original: original.precheck, initial: initial, draft: initial, allowed: true).get()
        XCTAssertEqual(edit, .keep)
        var input = RoutineInput(name: "Renamed", prompt: original.prompt, botId: original.botId, schedule: original.schedule)
        input.watch = edit
        let body = RoutinePatch.body(original: original, input: input)
        XCTAssertNil(body["precheck"], "a field the person did not touch stays on the server")
        XCTAssertEqual(body["name"] as? String, "Renamed")
    }

    func testAConditionPrecheckSurvivesAnEdit() throws {
        let original = try routine(precheck: #"{"kind":"condition","test":"weekday"}"#)
        let initial = RoutineWatchDraft(precheck: original.precheck)
        XCTAssertEqual(try RoutineWatchRules.edit(original: original.precheck, initial: initial, draft: initial, allowed: true).get(), .keep)
        XCTAssertEqual(try RoutineWatchRules.edit(original: original.precheck, initial: initial, draft: initial, allowed: false).get(), .keep,
                       "not a watch: never removed")
    }

    func testChangingSendsTheWholeWatchAndOffRemovesIt() throws {
        let original = try routine(precheck: #"{"kind":"watch","source":{"type":"files","path":"reports"}}"#)
        let initial = RoutineWatchDraft(precheck: original.precheck)
        var draft = initial
        draft.recursive = true
        let edit = try RoutineWatchRules.edit(original: original.precheck, initial: initial, draft: draft, allowed: true).get()
        var input = RoutineInput(name: original.name, prompt: original.prompt, botId: original.botId, schedule: original.schedule)
        input.watch = edit
        let sent = try XCTUnwrap(RoutinePatch.body(original: original, input: input)["precheck"] as? [String: Any])
        XCTAssertEqual(sent["kind"] as? String, "watch")
        XCTAssertEqual((sent["source"] as? [String: Any])?["recursive"] as? Bool, true)

        draft.on = false
        input.watch = try RoutineWatchRules.edit(original: original.precheck, initial: initial, draft: draft, allowed: true).get()
        XCTAssertEqual(input.watch, .remove)
        XCTAssertTrue(RoutinePatch.body(original: original, input: input)["precheck"] is NSNull)

        // a team goal or a one-time routine has no watch: it goes, as on the desktop
        XCTAssertEqual(try RoutineWatchRules.edit(original: original.precheck, initial: initial, draft: initial, allowed: false).get(), .remove)
        XCTAssertTrue(RoutineWatchRules.allowed(target: "bot", repeats: true))
        XCTAssertFalse(RoutineWatchRules.allowed(target: "room-goal", repeats: true))
        XCTAssertFalse(RoutineWatchRules.allowed(target: "bot", repeats: false))
    }

    func testAnIncompleteWatchBlocksTheSave() throws {
        let initial = RoutineWatchDraft()
        var draft = initial
        draft.on = true
        draft.setType(.command)
        XCTAssertEqual(RoutineWatchRules.edit(original: nil, initial: initial, draft: draft, allowed: true), .failure(.command))
    }

    func testANewRoutineCarriesItsWatch() throws {
        var draft = RoutineWatchDraft()
        draft.on = true
        draft.setType(.command)
        draft.command = "ls reports"
        var input = RoutineInput(name: "New", prompt: "Tell me", botId: "bot-1", schedule: RoutineSchedule(type: .daily, time: "09:00"))
        input.watch = try RoutineWatchRules.edit(original: nil, initial: RoutineWatchDraft(), draft: draft, allowed: true).get()
        let sent = try XCTUnwrap(RoutinePatch.createBody(input)["precheck"] as? [String: Any])
        XCTAssertEqual((sent["source"] as? [String: Any])?["command"] as? String, "ls reports")
        input.watch = .keep
        XCTAssertNil(RoutinePatch.createBody(input)["precheck"])
    }

    // MARK: Check now

    private var session: URLSession!

    override func setUp() {
        super.setUp()
        WatchStub.captured = nil
        WatchStub.capturedBody = nil
        WatchStub.statusCode = 200
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [WatchStub.self]
        session = URLSession(configuration: configuration)
    }

    override func tearDown() {
        session.invalidateAndCancel()
        session = nil
        super.tearDown()
    }

    private func client() -> CompanionClient {
        CompanionClient(connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810), token: "paired-token", session: session)
    }

    func testCheckNowSendsTheWatchAndReadsEachAnswer() async throws {
        WatchStub.responseBody = Data(#"{"ok":true,"summary":"3 files","excerpt":"a.txt\nb.txt","items":3,"condition":{"holds":true,"seen":"3"},"ms":12}"#.utf8)
        let watch = try json(#"{"kind":"watch","source":{"type":"files","path":"reports"}}"#)
        let answer = try await client().checkRoutineWatch(botId: "bot-1", watch: watch, routineId: "r1", runOn: "maus")
        XCTAssertEqual(answer, .read(summary: "3 files", excerpt: "a.txt\nb.txt", items: 3, condition: .init(holds: true, seen: "3"), ms: 12))
        XCTAssertEqual(WatchStub.captured?.httpMethod, "POST")
        XCTAssertEqual(WatchStub.captured?.url?.path, "/api/routines/watch-check")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(WatchStub.capturedBody)) as? [String: Any])
        XCTAssertEqual(body["botId"] as? String, "bot-1")
        XCTAssertEqual(body["routineId"] as? String, "r1")
        XCTAssertEqual(body["runOn"] as? String, "maus")
        XCTAssertEqual((body["precheck"] as? [String: Any])?["kind"] as? String, "watch")

        WatchStub.responseBody = Data(#"{"ok":true,"skipped":"asleep: not checked"}"#.utf8)
        let skipped = try await client().checkRoutineWatch(botId: "bot-1", watch: watch)
        XCTAssertEqual(skipped, .skipped("asleep: not checked"))
        WatchStub.responseBody = Data(#"{"ok":false,"error":"That tool changes something."}"#.utf8)
        let failed = try await client().checkRoutineWatch(botId: "bot-1", watch: watch)
        XCTAssertEqual(failed, .failed("That tool changes something."))
    }

    func testAReadingWithMissingPiecesKeepsItsDefaults() throws {
        let decode = { (text: String) throws -> RoutineWatchCheck in
            try JSONDecoder().decode(RoutineWatchCheck.self, from: Data(text.utf8))
        }
        XCTAssertEqual(try decode(#"{"ok":true}"#), .read(summary: "", excerpt: "", items: nil, condition: nil, ms: 0))
        XCTAssertEqual(
            try decode(#"{"ok":true,"summary":"1 file","items":"many","condition":{},"ms":7.9}"#),
            .read(summary: "1 file", excerpt: "", items: nil, condition: .init(holds: false, seen: ""), ms: 7)
        )
        XCTAssertEqual(try decode(#"{"ok":true,"condition":{"holds":false,"seen":"0"},"ms":"slow"}"#),
                       .read(summary: "", excerpt: "", items: nil, condition: .init(holds: false, seen: "0"), ms: 0))
        XCTAssertEqual(try decode(#"{}"#), .failed("The check failed."))
    }

    func testARefusedCheckCarriesTheServersSentence() async throws {
        WatchStub.statusCode = 400
        WatchStub.responseBody = Data(#"{"error":"Choose a watch to check"}"#.utf8)
        do {
            _ = try await client().checkRoutineWatch(botId: "bot-1", watch: try json(#"{"kind":"watch","source":{"type":"files","path":""}}"#))
            XCTFail("expected a refusal")
        } catch {
            XCTAssertEqual(error.localizedDescription, "Choose a watch to check")
        }
    }
}
