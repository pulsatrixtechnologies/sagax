// The phone's half of the desktop approval screens (CustomRulesCard.tsx,
// AllowedRecipientsRow.tsx, shared/custom-rules.ts compileRule,
// shared/allowed-recipients.ts). The server still decides. These tests
// lock the editor's words and the requests, with no simulator.
import Foundation
import XCTest
@testable import CompanionCore

final class ApprovalGrantsTests: XCTestCase {
    func testRecipientEntriesMatchTheDesktop() {
        XCTAssertEqual(AllowedRecipients.parse("Email: Ana@Example.COM "), RecipientEntry(kind: .email, value: "ana@example.com"))
        XCTAssertEqual(AllowedRecipients.parse("ana@example.com"), RecipientEntry(kind: .email, value: "ana@example.com"))
        XCTAssertEqual(AllowedRecipients.parse("(514) 555-1234"), RecipientEntry(kind: .phone, value: "+15145551234"))
        XCTAssertEqual(AllowedRecipients.parse("phone:+33 6 12 34 56 78"), RecipientEntry(kind: .phone, value: "+33612345678"))
        XCTAssertEqual(AllowedRecipients.parse("bot:bot_123"), RecipientEntry(kind: .bot, value: "bot_123"))
        XCTAssertNil(AllowedRecipients.parse("bot:../x"))
        XCTAssertNil(AllowedRecipients.parse("not a recipient"))
        XCTAssertNil(AllowedRecipients.normalizePhone("12"))
        XCTAssertEqual(AllowedRecipients.normalizePhone("+1 (514) 555-1234"), "+15145551234")
    }

    func testRecipientListDedupesAndRefusesABadEntry() {
        XCTAssertEqual(AllowedRecipients.normalize(["a@b.co", "email:A@B.CO", "514-555-1234"]), ["email:a@b.co", "phone:+15145551234"])
        XCTAssertNil(AllowedRecipients.normalize(["a@b.co", "nope"]))
        XCTAssertNil(AllowedRecipients.normalize((0..<201).map { "p\($0)@b.co" }))
        XCTAssertEqual(AllowedRecipients.addingPerson("bot:other", to: []), .invalid)
        XCTAssertEqual(AllowedRecipients.addingPerson("a@b.co", to: ["email:a@b.co"]), .unchanged)
        XCTAssertEqual(AllowedRecipients.addingBot(id: "other", to: []), ["bot:other"])
        XCTAssertNil(AllowedRecipients.addingBot(id: "../x", to: []))
    }

    func testRecipientLabelUsesTheBotName() {
        let named = AllowedRecipients.label("bot:b1") { $0 == "b1" ? "Ada" : nil }
        XCTAssertEqual(named.text, "Ada")
        XCTAssertEqual(named.title, "b1")
        XCTAssertFalse(named.deleted)
        let gone = AllowedRecipients.label("bot:missing") { _ in nil }
        XCTAssertTrue(gone.deleted)
        XCTAssertEqual(AllowedRecipients.label("email:a@b.co") { _ in nil }.text, "a@b.co")
    }

    func testCompileMatchesTheEditor() {
        let read = CustomRuleEditor.compile("la lecture de fichiers dans ~/Documents")
        XCTAssertEqual(read.actions, ["read"])
        XCTAssertEqual(read.paths, ["~/Documents"])
        XCTAssertTrue(read.recognized)
        XCTAssertFalse(read.shellFamily)
        XCTAssertFalse(CustomRuleEditor.compile("blabla sans rien").recognized)
        XCTAssertEqual(CustomRuleEditor.compile("la lecture avec `cw_psa__query`").tools, ["cw_psa__query"])
        XCTAssertTrue(CustomRuleEditor.compile("utiliser github").recognized)
        let home = "/Users/jc"
        XCTAssertEqual(CustomRuleEditor.normalizePath("/Users/jc/Documents/../Documents/a", home: home), "~/Documents/a")
        XCTAssertEqual(CustomRuleEditor.normalizePath("$HOME/Documents", home: home), "~/Documents")
        XCTAssertNil(CustomRuleEditor.normalizePath("../etc/passwd", home: home))
        XCTAssertNil(CustomRuleEditor.normalizePath("relative/file", home: home))
    }

    func testShellFamilyAndExactCommandBlockAllowOnly() {
        let family = CustomRuleEditor.compile("run commands")
        XCTAssertTrue(family.shellFamily)
        XCTAssertTrue(family.recognized)
        XCTAssertTrue(CustomRuleEditor.isBlocked(when: "run commands", behavior: .allow, choosing: false, chosenEmpty: false, allowOff: false))
        XCTAssertFalse(CustomRuleEditor.isBlocked(when: "run commands", behavior: .ask, choosing: false, chosenEmpty: false, allowOff: false))
        let exact = CustomRuleEditor.compile("the exact command `git status`")
        XCTAssertEqual(exact.commands, ["git status"])
        XCTAssertFalse(exact.shellFamily)
        XCTAssertTrue(CustomRuleEditor.isBlocked(when: "the exact command `git status`", behavior: .allow, choosing: false, chosenEmpty: false, allowOff: false))
        XCTAssertFalse(CustomRuleEditor.isBlocked(when: "the exact command `git status`", behavior: .allow, choosing: false, chosenEmpty: false, allowOff: false, fromCard: true))
        XCTAssertTrue(CustomRuleEditor.isBlocked(when: "read files", behavior: .allow, choosing: false, chosenEmpty: false, allowOff: true))
        XCTAssertTrue(CustomRuleEditor.isBlocked(when: "read files", behavior: .ask, choosing: true, chosenEmpty: true, allowOff: false))
    }

    func testOrderPutsTheOrganizationFirst() {
        let rules = [
            CustomRuleRow(id: "own", botId: "b", when: "read files", behavior: .allow, createdAt: 1),
            CustomRuleRow(id: "all", botId: nil, when: "send mail", behavior: .ask, createdAt: 2),
            CustomRuleRow(id: "org", botId: nil, when: "delete files", behavior: .deny, org: true, createdAt: 5),
            CustomRuleRow(id: "other", botId: "z", when: "pay", behavior: .deny, createdAt: 0),
        ]
        XCTAssertEqual(CustomRuleEditor.ordered(rules, forBot: "b").map(\.id), ["org", "own", "all"])
        XCTAssertEqual(CustomRuleEditor.saveTargets(botId: "b", allBots: true, chosen: nil), [nil])
        XCTAssertEqual(CustomRuleEditor.saveTargets(botId: "b", allBots: false, chosen: ["b", "c"]), ["b", "c"])
    }

    func testTextDiffMarksAddedAndRemovedWords() {
        let parts = CustomRuleEditor.textDiff(before: "read files", after: "read mail")
        XCTAssertEqual(parts.map(\.kind), [.same, .removed, .added])
        XCTAssertTrue(parts.contains { $0.kind == .removed && $0.text.contains("files") })
        XCTAssertTrue(parts.contains { $0.kind == .added && $0.text.contains("mail") })
    }

    func testFailureSentencesMatchTheDesktop() {
        XCTAssertEqual(CustomRuleEditor.failureText(apiCode: "shell_family_allow", serverMessage: "no"), "For the shell, only exact commands can be allowed automatically. Write \"the exact command `...`\", or choose Ask first or Refuse.")
        XCTAssertEqual(CustomRuleEditor.failureText(apiCode: "org_rule_locked", serverMessage: nil), "Required by your administrator. You cannot change or delete this rule.")
        XCTAssertEqual(AllowedRecipients.failureText(apiCode: "invalid_recipients", serverMessage: "no"), "Enter an email address or a phone number.")
        XCTAssertTrue(AllowedRecipients.failureText(apiCode: "standing_grants_off", serverMessage: nil).contains("paused"))
    }

    func testGateFollowsOwnership() {
        XCTAssertTrue(ApprovalGrantGate.managesRules(role: nil, principalId: nil, ownerUserId: "someone"))
        XCTAssertTrue(ApprovalGrantGate.managesRules(role: "member", principalId: "Ada", ownerUserId: "ada"))
        XCTAssertFalse(ApprovalGrantGate.managesRules(role: "member", principalId: "ada", ownerUserId: "beau"))
        XCTAssertFalse(ApprovalGrantGate.editsRecipients(role: nil, botsReadOnly: true, principalId: nil, ownerUserId: nil))
        XCTAssertTrue(ApprovalGrantGate.editsRecipients(role: "admin", botsReadOnly: false, principalId: "a", ownerUserId: "b"))
        XCTAssertFalse(ApprovalGrantGate.editsRecipients(role: "member", botsReadOnly: false, principalId: "a", ownerUserId: "b"))
    }

    func testRulesPayloadDecodesAndBotKeepsRecipients() throws {
        let list = try JSONDecoder().decode(CustomRuleList.self, from: Data(#"""
        {"rules":[{"id":"crule_1","ownerId":"me","botId":null,"when":"read files","behavior":"ask","riskScope":["external-send"],"enabled":true,"org":true,"createdAt":3,"updatedAt":4,"compiled":{"recognized":false,"shellFamily":false,"commands":[]}}],"orgPolicy":{"alwaysAllow":false}}
        """#.utf8))
        XCTAssertEqual(list.rules.first?.behavior, .ask)
        XCTAssertEqual(list.rules.first?.riskScope, [.externalSend])
        XCTAssertEqual(list.rules.first?.org, true)
        XCTAssertEqual(list.rules.first?.recognized, false)
        XCTAssertFalse(list.alwaysAllow)
        let bot = try JSONDecoder().decode(Bot.self, from: Data(#"""
        {"id":"b1","threadId":"t1","name":"Ada","title":"","description":"","notifications":true,"color":"purple","unread":false,"modelSelection":{"instanceId":"e","model":"m"},"createdAt":1,"allowedRecipients":["email:a@b.co"]}
        """#.utf8))
        XCTAssertEqual(bot.allowedRecipients, ["email:a@b.co"])
    }
}

private final class GrantStub: URLProtocol {
    static var status = 200
    static var body = Data("{}".utf8)
    static var captured: URLRequest?
    static var capturedBody: Data?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.captured = request
        Self.capturedBody = request.httpBody
        let response = HTTPURLResponse(url: request.url!, statusCode: Self.status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class ApprovalGrantClientTests: XCTestCase {
    private var session: URLSession!

    override func setUp() {
        super.setUp()
        GrantStub.status = 200
        GrantStub.body = Data("{}".utf8)
        GrantStub.captured = nil
        GrantStub.capturedBody = nil
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [GrantStub.self]
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

    func testCreateSendsNullBotAndDropsRisksOnAsk() async throws {
        let request = try client().createCustomRuleRequest(when: " read files ", behavior: .ask, botId: nil, riskScope: [.money], stepUp: nil)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/custom-rules")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: request.httpBody!) as? [String: Any])
        XCTAssertEqual(body["when"] as? String, "read files")
        XCTAssertEqual(body["behavior"] as? String, "ask")
        XCTAssertTrue(body["botId"] is NSNull)
        XCTAssertEqual(body["riskScope"] as? [String], [])
        XCTAssertThrowsError(try client().createCustomRuleRequest(when: " ", behavior: .ask, botId: nil, riskScope: [], stepUp: nil))
        XCTAssertThrowsError(try client().deleteCustomRuleRequest(id: "../x", stepUp: nil))
    }

    func testAllowKeepsRiskScopeAndStepUp() throws {
        let request = try client().createCustomRuleRequest(when: "read files", behavior: .allow, botId: "ada", riskScope: [.externalSend, .money], stepUp: "cer")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: request.httpBody!) as? [String: Any])
        XCTAssertEqual(body["botId"] as? String, "ada")
        XCTAssertEqual(body["riskScope"] as? [String], ["external-send", "money"])
        XCTAssertEqual(body["stepUp"] as? String, "cer")
        let patch = try client().patchAllowedRecipientsRequest(botId: "ada", recipients: ["Ana@Example.com"], stepUp: "cer")
        XCTAssertEqual(patch.httpMethod, "PATCH")
        XCTAssertEqual(patch.url?.path, "/api/bots/ada")
        let saved = try XCTUnwrap(JSONSerialization.jsonObject(with: patch.httpBody!) as? [String: Any])
        XCTAssertEqual(saved["allowedRecipients"] as? [String], ["email:ana@example.com"])
        XCTAssertThrowsError(try client().patchAllowedRecipientsRequest(botId: "ada", recipients: ["nope"], stepUp: nil))
    }

    func testRefusalKeepsTheCodeAndStepUpStaysAStepUp() async throws {
        GrantStub.status = 400
        GrantStub.body = Data(#"{"error":"family","code":"shell_family_allow"}"#.utf8)
        do {
            try await client().createCustomRule(when: "run commands", behavior: .allow, botId: "ada", riskScope: [])
            XCTFail("expected a refusal")
        } catch let error as ApprovalGrantError {
            XCTAssertEqual(error, .status(code: 400, apiCode: "shell_family_allow", message: "family", recipients: false))
            XCTAssertTrue(error.localizedDescription.contains("exact command"))
        }
        GrantStub.status = 403
        GrantStub.body = Data(#"{"error":"key","code":"step_up_required","target":{"kind":"settings","action":"custom-rules.allow"}}"#.utf8)
        do {
            try await client().createCustomRule(when: "read files", behavior: .allow, botId: "ada", riskScope: [])
            XCTFail("expected a step-up")
        } catch is StepUpRequired {
        } catch {
            XCTFail("unexpected \(error)")
        }
    }

    func testGetDecodesTheList() async throws {
        GrantStub.body = Data(#"{"rules":[],"orgPolicy":{"alwaysAllow":true}}"#.utf8)
        let list = try await client().customRules(botId: "ada")
        XCTAssertTrue(list.alwaysAllow)
        XCTAssertEqual(GrantStub.captured?.url?.path, "/api/custom-rules")
        XCTAssertEqual(GrantStub.captured?.url?.query, "botId=ada")
    }
}
