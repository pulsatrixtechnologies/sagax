// WP16 of the iOS feature parity matrix: the advanced bot panel, against the
// desktop's own logic (src/lib/memory.ts, src/lib/perspicax-org.ts,
// bot-settings/VisibilitySection.tsx, PerspicaxSection.tsx,
// useSlackManagement.ts, ModelPicker.tsx, store.tsx duplicateBot) and the
// wire shapes of the server's routes.
import Foundation
import XCTest
@testable import CompanionCore

private final class AdvancedRequestStub: URLProtocol {
    static var responses: [String: (Int, String)] = [:]
    static var captured: [(request: URLRequest, body: Data?)] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        var body = request.httpBody
        if body == nil, let stream = request.httpBodyStream {
            stream.open()
            var data = Data()
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let read = stream.read(&buffer, maxLength: buffer.count)
                if read <= 0 { break }
                data.append(buffer, count: read)
            }
            stream.close()
            body = data
        }
        Self.captured.append((request, body))
        let key = "\(request.httpMethod ?? "GET") \(request.url!.path)"
        let (status, text) = Self.responses[key] ?? (404, #"{"error":"not found"}"#)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(text.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class BotAdvancedTests: XCTestCase {
    private var session: URLSession!
    private var client: CompanionClient!

    override func setUp() {
        super.setUp()
        AdvancedRequestStub.responses = [:]
        AdvancedRequestStub.captured = []
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AdvancedRequestStub.self]
        session = URLSession(configuration: configuration)
        client = CompanionClient(connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810), token: "t", session: session)
    }

    override func tearDown() {
        session.invalidateAndCancel()
        super.tearDown()
    }

    private func json(_ data: Data?) -> [String: Any] {
        (data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]) ?? [:]
    }

    private func bot(_ extra: String = "") throws -> Bot {
        try JSONDecoder().decode(Bot.self, from: Data(#"""
        {"id":"b1","threadId":"t1","name":"Ara","title":"Ops","description":"Runs things","notifications":true,"color":"blue",
        "unread":false,"modelSelection":{"instanceId":"claude","model":"opus"},"createdAt":1\#(extra)}
        """#.utf8))
    }

    // MARK: Bot record

    func testBotDecodesTheAdvancedFieldsAndToleratesOddVisibility() throws {
        let full = try bot(#","cwd":"/work","browser":false,"mcpServers":["a"],"memoryEnabled":false,"memoryUpkeep":true,"visibility":{"people":["x@y.z"]},"grants":[{"target":"team:t1","level":"edit","by":"o","at":1}]"#)
        XCTAssertEqual(full.cwd, "/work")
        XCTAssertEqual(full.browser, false)
        XCTAssertEqual(full.mcpServers, ["a"])
        XCTAssertEqual(full.memoryEnabled, false)
        XCTAssertEqual(full.visibility, .people(["x@y.z"]))
        XCTAssertEqual(full.grants?.first?.level, .edit)
        XCTAssertEqual(try bot(#","visibility":"admins""#).visibility, .admins)
        XCTAssertEqual(try bot(#","visibility":42"#).visibility, .everyone, "an unknown shape never fails the fleet")
        XCTAssertNil(try bot().visibility)
    }

    // MARK: Prompt preview and history

    func testPromptPreviewAndHistoryDecodeAndRollbackSendsTheRevision() async throws {
        let prompt = try JSONDecoder().decode(PromptPreview.self, from: Data(#"""
        {"sections":[{"id":"soul","label":"Soul","text":"Be kind","bytes":7}],"totalBytes":7,"approxTokens":2,"note":"Tools are added at run time."}
        """#.utf8))
        XCTAssertEqual(prompt.sections.first?.label, "Soul")
        XCTAssertEqual(prompt.approxTokens, 2)

        let history = try JSONDecoder().decode(BotHistory.self, from: Data(#"""
        {"rows":[{"id":"h1","at":1,"actor":"You","via":"phone","field":"name","summary":"Renamed"},
        {"id":"h2","at":5,"actor":"You","via":"desktop","field":"soul","summary":"Changed instructions","canRestore":true},
        {"id":"h3","at":3,"actor":"You","via":"desktop","field":"soul","summary":"Changed","canRestore":false,"restoreUnavailableReason":"Too old"}],
        "revision":"r9"}
        """#.utf8))
        XCTAssertEqual(history.sorted.map(\.id), ["h2", "h3", "h1"])
        XCTAssertTrue(history.rows[1].restorable)
        XCTAssertTrue(history.rows[2].showsRestoreReason)
        XCTAssertFalse(history.rows[0].restorable || history.rows[0].showsRestoreReason)

        AdvancedRequestStub.responses["POST /api/bots/b1/history/rollback"] = (200, #"{"ok":true}"#)
        try await client.rollbackHistory(botId: "b1", rowId: "h2", expectedRevision: "r9")
        let sent = try XCTUnwrap(AdvancedRequestStub.captured.last)
        XCTAssertEqual(json(sent.body)["id"] as? String, "h2")
        XCTAssertEqual(json(sent.body)["expectedRevision"] as? String, "r9")
    }

    // MARK: Skills

    func testSkillsListToggleImportAndRemove() async throws {
        AdvancedRequestStub.responses["GET /api/bots/b1/skills"] = (200, #"""
        {"skills":[{"name":"deploy-check","description":"Checks","enabled":false,"source":"owner/repo","warnings":["Unsigned"]}],
        "staged":[{"id":"s1","name":"x","gist":"y"}]}
        """#)
        let list = try await client.botSkills(botId: "b1")
        XCTAssertEqual(list.skills.first?.warnings, ["Unsigned"])
        XCTAssertEqual(list.staged.count, 1)

        AdvancedRequestStub.responses["PATCH /api/bots/b1/skills/deploy-check"] = (200, "{}")
        try await client.setSkillEnabled(botId: "b1", name: "deploy-check", enabled: true)
        XCTAssertEqual(json(AdvancedRequestStub.captured.last?.body)["enabled"] as? Bool, true)

        AdvancedRequestStub.responses["POST /api/bots/b1/skills"] = (200, #"{"installed":[{"name":"a"},{"name":"b"}]}"#)
        let count = try await client.importSkill(botId: "b1", source: "owner/repo")
        XCTAssertEqual(count, 2)

        do {
            try await client.removeSkill(botId: "b1", name: "../etc")
            XCTFail("a name outside the route's pattern is refused locally")
        } catch APIError.badURL {}
        XCTAssertEqual(SkillRules.importSource("  owner/repo \n"), "owner/repo")
        XCTAssertNil(SkillRules.importSource("   "))
    }

    // MARK: Memory

    func testMemorySaveCarriesTheHashAndAConflictIsAnAnswer() async throws {
        AdvancedRequestStub.responses["PUT /api/bots/b1/memory/file"] = (409, #"{"error":"changed","current":"bot text","currentHash":"h2"}"#)
        let conflict = try await client.saveMemoryDoc(botId: "b1", path: "MEMORY.md", text: "mine", expectedHash: "h1")
        guard case let .conflict(current, hash) = conflict else { return XCTFail("a 409 is the conflict") }
        XCTAssertEqual(current, "bot text")
        XCTAssertEqual(hash, "h2")
        let body = json(AdvancedRequestStub.captured.last?.body)
        XCTAssertEqual(body["expectedHash"] as? String, "h1")
        XCTAssertEqual(body["path"] as? String, "MEMORY.md")

        AdvancedRequestStub.responses["PUT /api/bots/b1/memory/file"] = (200, #"""
        {"path":"MEMORY.md","text":"mine","hash":"h3","exists":true,"overview":{"botId":"b1","workspacePath":"/m",
        "index":{"lines":1,"bytes":4,"maxLines":200,"maxBytes":25000,"loadedLines":1,"loadedBytes":4,"truncated":false,"hash":"h3"},
        "topics":[],"logs":[]}}
        """#)
        let saved = try await client.saveMemoryDoc(botId: "b1", path: "MEMORY.md", text: "mine", expectedHash: "h2")
        guard case let .saved(doc, overview) = saved else { return XCTFail("saved") }
        XCTAssertEqual(doc.hash, "h3")
        XCTAssertEqual(overview?.index.lines, 1)

        AdvancedRequestStub.responses["PUT /api/bots/b1/memory/file"] = (403, #"{"error":"no"}"#)
        do {
            _ = try await client.saveMemoryDoc(botId: "b1", path: "MEMORY.md", text: "x", expectedHash: nil)
            XCTFail("a refusal throws")
        } catch let APIError.status(code, message) {
            XCTAssertEqual(code, 403)
            XCTAssertEqual(message, "no")
        }
    }

    func testCaptureReportCarriesTheAlreadyKnownCount() throws {
        // parity M3: "3 added, 2 already known"; an older report has no count
        let receipt = try JSONDecoder().decode(CaptureReport.self, from: Data(#"{"at": 1, "added": 2, "topics": 1, "known": 2}"#.utf8))
        XCTAssertEqual(receipt.noticed, 3)
        XCTAssertEqual(receipt.known, 2)
        let older = try JSONDecoder().decode(CaptureReport.self, from: Data(#"{"at": 1, "added": 0}"#.utf8))
        XCTAssertNil(older.known)
    }

    func testMemoryFileRequestsCarryThePathInTheQuery() throws {
        let request = try client.memoryFileRequest("DELETE", botId: "b1", path: "memory/clients.md")
        XCTAssertEqual(request.httpMethod, "DELETE")
        XCTAssertEqual(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first?.value, "memory/clients.md")
    }

    func testMemoryWordingMatchesTheDesktop() throws {
        XCTAssertEqual(MemoryRules.topicFileName("  Clients & co "), "Clients - co.md")
        XCTAssertEqual(MemoryRules.topicFileName("notes.md"), "notes.md")
        XCTAssertEqual(MemoryRules.topicFileName("!!!"), nil)
        XCTAssertEqual(MemoryRules.topicFileName("--x"), "x.md")
        XCTAssertEqual(MemoryRules.topicTemplate("clients.md"), "---\ntitle: clients\ndescription: \naliases: []\n---\n\n")
        XCTAssertTrue(MemoryRules.readOnly("memory/log/2026-10-03.md"))
        XCTAssertFalse(MemoryRules.readOnly("memory/clients.md"))
        XCTAssertEqual(MemoryRules.formatBytes(1536), "1.5 KB")

        let now = Date(timeIntervalSince1970: 1_000_000)
        let ms = now.timeIntervalSince1970 * 1000
        XCTAssertEqual(MemoryRules.ago(ms - 10_000, now: now), .justNow)
        XCTAssertEqual(MemoryRules.ago(ms - 180_000, now: now), .minutes(3))
        XCTAssertEqual(MemoryRules.ago(ms - 2 * 3_600_000, now: now), .hours(2))
        XCTAssertEqual(MemoryRules.ago(ms - 30 * 3_600_000, now: now), .yesterday)
        XCTAssertEqual(MemoryRules.ago(ms - 3 * 86_400_000, now: now), .days(3))

        func row(_ kind: MemoryJournalRow.Kind, actor: String = "bot", via: String = "tool", path: String = "MEMORY.md", added: Int = 0, removed: Int = 0, title: String? = nil) -> MemoryJournalRow {
            MemoryJournalRow(id: "j", at: 0, path: path, actor: actor, via: via, threadTitle: title, kind: kind, added: added, removed: removed)
        }
        XCTAssertEqual(row(.created, added: 2).change, .created(lines: 2))
        XCTAssertEqual(row(.edited, added: 2).change, .added(2))
        XCTAssertEqual(row(.edited, removed: 1).change, .removed(1))
        XCTAssertEqual(row(.edited, added: 1, removed: 3).change, .rewrote(3))
        XCTAssertEqual(row(.deleted, path: "memory/clients.md").target, .topic("clients"))
        XCTAssertEqual(row(.edited, path: "memory/log/2026-10-03.md").target, .log("2026-10-03"))
        XCTAssertEqual(row(.edited, actor: "person", via: "ui").who, .you)
        XCTAssertEqual(row(.edited, actor: "person", via: "ui").source, .settings)
        XCTAssertEqual(row(.edited, via: "revert").source, .undo)
        XCTAssertEqual(row(.edited, via: "capture", title: "Q3").source, .noticed("Q3"))
        XCTAssertEqual(row(.edited, title: "Q3").source, .chat("Q3"))
        XCTAssertEqual(row(.edited).source, .task)
        XCTAssertEqual(TidyReport(at: 0, expired: 1, duplicates: 2).parts, [.expired(1), .duplicates(2)])
        XCTAssertEqual(TidyReport(at: 0).parts, [])
    }

    // MARK: Sharing and Perspicax

    func testGrantCandidatesAndEditabilityFollowTheDesktop() {
        let directory = OrgShareDirectory(
            people: [
                .init(principalId: "pr_owner", name: "Owner", login: "owner"),
                .init(principalId: "pr_a", name: "Alice", login: "alice"),
                .init(principalId: "pr_b", name: "Bob", login: "bob", disabled: true),
                .init(principalId: "pr_c", name: "Carol", login: "carol"),
            ],
            teams: [.init(id: "t1", name: "Ops", managers: ["pr_c"], members: ["pr_a"]), .init(id: "t2", name: "Sales")]
        )
        let all = GrantRules.candidates(directory, ownerId: "PR_OWNER", taken: ["user:pr_c"], query: "", administer: .owner)
        XCTAssertEqual(all.map(\.target), ["team:t1", "team:t2", "user:pr_a"])
        XCTAssertEqual(all.first?.count, 1)
        let manager = GrantAdministration(any: false, teamIds: ["t1"], maxLevel: .edit)
        XCTAssertEqual(GrantRules.candidates(directory, ownerId: nil, taken: [], query: "", administer: manager).map(\.target),
                       ["team:t1", "user:pr_a", "user:pr_c"])
        XCTAssertEqual(GrantRules.candidates(directory, ownerId: nil, taken: [], query: "ali", administer: nil).map(\.target), ["user:pr_a"])
        let manage = WireGrant(target: "user:pr_a", level: .manage, label: "Alice", kind: .user)
        XCTAssertFalse(GrantRules.editable(manage, administer: manager))
        XCTAssertTrue(GrantRules.editable(manage, administer: .owner))
        XCTAssertFalse(GrantRules.editable(manage, administer: nil))
        XCTAssertTrue(GrantLevel.run.allowed(by: .edit))
        XCTAssertFalse(GrantLevel.manage.allowed(by: .edit))
    }

    func testGrantRemovalEscapesTheTarget() throws {
        let request = try client.removeGrantRequest(botId: "b1", target: "user:pr_0000")
        XCTAssertEqual(request.url?.absoluteString.hasSuffix("/api/bots/b1/grants/user%3Apr_0000"), true)
    }

    func testPerspicaxRowsAndRefusals() async throws {
        let answer = PerspicaxAnswer(
            selected: [.init(profile: .init(id: "p1", name: "One"), heldByMe: true), .init(profile: .init(id: "p9", name: "Theirs"), heldByMe: false)],
            available: [.init(id: "p1", name: "One"), .init(id: "p2", name: "Two")],
            canEdit: true
        )
        let rows = PerspicaxRules.rows(answer, draft: answer.selectedIds)
        XCTAssertEqual(rows.map(\.id), ["p1", "p2", "p9"])
        XCTAssertEqual(rows.map(\.checked), [true, false, true])
        XCTAssertEqual(rows.last?.notHeld, true)
        XCTAssertEqual(rows.last?.disabled, true)
        let draft = PerspicaxRules.toggled(answer.selectedIds, id: "p2", on: true)
        XCTAssertEqual(draft, ["p1", "p9", "p2"])
        XCTAssertTrue(PerspicaxRules.changed(draft, from: answer))

        AdvancedRequestStub.responses["PUT /api/bots/b1/perspicax"] = (403, #"{"error":"x","code":"profile_not_held"}"#)
        do {
            _ = try await client.setBotPerspicax(botId: "b1", profiles: ["p2"])
            XCTFail("refused")
        } catch let error as PerspicaxRefusalError {
            XCTAssertEqual(error.refusal, .profileNotHeld)
        }
        XCTAssertEqual(PerspicaxRules.refusal(code: "nope"), .failed)
    }

    // MARK: Visibility, Slack, duplicate, variants, access, allowlist

    func testVisibilityFormAndPatch() throws {
        XCTAssertEqual(VisibilityRules.form(nil).mode, .everyone)
        XCTAssertEqual(VisibilityRules.form(.people(["a@b.c", "@d.e"])).people, "a@b.c\n@d.e")
        XCTAssertEqual(VisibilityRules.value(mode: .people, people: "A@b.c, a@b.c;\n@d.e"), .people(["a@b.c", "@d.e"]))
        XCTAssertNil(VisibilityRules.value(mode: .people, people: "  "))
        XCTAssertTrue(VisibilityRules.dirty(mode: .admins, people: "", saved: nil))
        XCTAssertFalse(VisibilityRules.dirty(mode: .people, people: "a@b.c ", saved: .people(["a@b.c"])))
        let request = try client.setVisibilityRequest(botId: "b1", visibility: .people(["a@b.c"]))
        XCTAssertEqual((json(request.httpBody)["visibility"] as? [String: Any])?["people"] as? [String], ["a@b.c"])
        XCTAssertEqual(json(try client.setVisibilityRequest(botId: "b1", visibility: .admins).httpBody)["visibility"] as? String, "admins")
    }

    func testSlackLinkIsHttpsOnly() {
        XCTAssertEqual(SlackRules.managementURL(available: true, managementUrl: "https://admin.example/bots/1")?.host, "admin.example")
        XCTAssertNil(SlackRules.managementURL(available: true, managementUrl: "http://admin.example"))
        XCTAssertNil(SlackRules.managementURL(available: false, managementUrl: "https://admin.example"))
        XCTAssertNil(SlackRules.managementURL(available: true, managementUrl: nil))
    }

    func testDuplicateCreatesThenPatchesTheMemberFields() async throws {
        let source = try bot(#","visibility":"admins","computer":"cloud","avatarCrop":"circle""#)
        AdvancedRequestStub.responses["POST /api/bots"] = (200, #"{"bot":{"id":"b2","threadId":"t2","name":"New bot","title":"","description":"","notifications":true,"color":"blue","unread":false,"modelSelection":{"instanceId":"claude","model":"opus"},"createdAt":2}}"#)
        AdvancedRequestStub.responses["PATCH /api/bots/b2"] = (200, #"{"bot":{"id":"b2","threadId":"t2","name":"Ara copy","title":"Ops","description":"Runs things","notifications":true,"color":"blue","unread":false,"modelSelection":{"instanceId":"claude","model":"opus"},"createdAt":2}}"#)
        let copy = try await client.duplicateBot(source, soul: "Be kind", computerFields: false, carryVisibility: true)
        XCTAssertEqual(copy.name, "Ara copy")
        let create = json(AdvancedRequestStub.captured[0].body)
        XCTAssertEqual(create["visibility"] as? String, "admins", "a copy of a restricted bot is restricted from its first moment")
        let patch = json(AdvancedRequestStub.captured[1].body)
        XCTAssertEqual(patch["name"] as? String, "Ara copy")
        XCTAssertEqual(patch["soul"] as? String, "Be kind")
        XCTAssertEqual(patch["avatarCrop"] as? String, "circle")
        XCTAssertNil(patch["computer"], "where it works is an admin's field")
        XCTAssertNotNil(BotDuplicatePatch(source: source, soul: nil, computerFields: true).computer)
    }

    func testModelVariantsComeFromTheCatalog() throws {
        let instances = try JSONDecoder().decode([Instance].self, from: Data(#"""
        [{"instanceId":"oc","driverKind":"acp","snapshot":{"state":"available"},"capabilities":{"modelVariants":true},
        "models":{"default":"m1","options":[{"id":"m1","label":"M1","variants":[{"id":"default","label":"Default"},{"id":"high","label":"High"}]}]}},
        {"instanceId":"claude","driverKind":"cli","snapshot":{"state":"available"},"capabilities":{"effortLevels":["low"]},
        "models":{"default":"opus","options":[{"id":"opus","label":"Opus"}]}}]
        """#.utf8))
        let selection = ModelSelection(instanceId: "oc", model: "m1", variant: "gone")
        let options = try XCTUnwrap(ModelVariantRules.options(for: selection, instances: instances))
        XCTAssertEqual(options.map(\.id), ["default", "high"])
        XCTAssertTrue(ModelVariantRules.missing(selection, options: options))
        XCTAssertEqual(ModelVariantRules.label(options[0]), "OpenCode default")
        XCTAssertNil(ModelVariantRules.options(for: ModelSelection(instanceId: "claude", model: "opus"), instances: instances))
        let picked = ModelVariantRules.choosing("high", in: ModelSelection(instanceId: "oc", model: "m1", effort: "low"))
        XCTAssertNil(picked.effort)
        let wire = json(try JSONEncoder().encode(picked))
        XCTAssertEqual(wire["variant"] as? String, "high")
        XCTAssertNil(json(try JSONEncoder().encode(ModelSelection(instanceId: "a", model: "b")))["variant"], "no variant, no key")
    }

    func testAccessMountsAndAllowlistAdd() throws {
        let servers = try JSONDecoder().decode(MCPServersResponse.self, from: Data(#"""
        {"servers":[{"name":"a","enabled":true},{"name":"b","enabled":false},{"name":"c"}]}
        """#.utf8)).servers
        XCTAssertEqual(AccessRules.mounted(servers, own: nil).map(\.name), ["a", "c"])
        XCTAssertEqual(AccessRules.mounted(servers, own: ["c", "b"]).map(\.name), ["c"])
        XCTAssertEqual(AccessRules.toggledMcp(servers, own: nil, name: "a"), ["c"])
        XCTAssertEqual(AccessRules.toggledMcp(servers, own: ["c"], name: "a"), ["c", "a"])

        let list = try JSONDecoder().decode(CommandAllowlist.self, from: Data(#"""
        {"rules":[],"context":{"providerInstanceId":"claude","cwd":"/w"},"supported":true}
        """#.utf8))
        XCTAssertTrue(CommandAllowRules.canAdd(command: "npm test", cwd: "/w", list: list))
        XCTAssertFalse(CommandAllowRules.canAdd(command: " ", cwd: "/w", list: list))
        XCTAssertFalse(CommandAllowRules.canAdd(command: "npm test", cwd: "/w", list: nil))
    }

    // MARK: Gates

    func testGatesFollowTheRoutes() {
        let sidecar = SurfaceGate(scope: .sidecar)
        let client = SurfaceGate(scope: .serverClient)
        let orgClient = SurfaceGate(scope: .serverClient, organization: true)
        let admin = SurfaceGate(scope: .serverAdmin)
        let orgAdmin = SurfaceGate(scope: .serverAdmin, organization: true)
        XCTAssertTrue(sidecar.allows(.advancedBotPanel))
        XCTAssertFalse(SurfaceGate(scope: .sidecar, sidecarRoutes: []).allows(.advancedBotPanel))
        XCTAssertFalse(client.allows(.advancedBotPanel))
        XCTAssertFalse(sidecar.allows(.botAccessEdit), "the sidecar refuses folder, MCP and access fields")
        XCTAssertTrue(admin.allows(.botAccessEdit))
        XCTAssertTrue(admin.allows(.botVisibility))
        XCTAssertFalse(orgAdmin.allows(.botVisibility), "the grants replace it on an organization server")
        XCTAssertFalse(sidecar.allows(.botVisibility))
        XCTAssertTrue(orgClient.allows(.botSharing))
        XCTAssertFalse(admin.allows(.botSharing))
        XCTAssertFalse(sidecar.allows(.botSlack))
        XCTAssertTrue(client.allows(.botSlack))
        XCTAssertTrue(sidecar.allows(.commandAllowlist))
        XCTAssertFalse(sidecar.allows(.commandAllowlistAdd))
        XCTAssertTrue(sidecar.allows(.duplicateBot))
        XCTAssertFalse(client.allows(.duplicateBot))
        XCTAssertTrue(orgClient.allows(.duplicateBot))
        XCTAssertFalse(sidecar.allows(.orgSkillsLibrary))
    }
}
