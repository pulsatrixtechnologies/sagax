// iPad I5: the Settings and Plugins modals' rules (DesktopSettings.swift).
import Foundation
import XCTest
@testable import CompanionCore

final class DesktopSettingsTests: XCTestCase {
    private let client = CompanionClient(
        connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810),
        token: "paired-token"
    )

    // MARK: Sections per pairing

    func testAnAdminSessionListsTheDesktopSectionsInOrder() {
        let expected: [DesktopSettingsSection] = [
            .general, .organization, .appearance, .experimental, .engines, .computer, .usage, .backups,
        ]
        XCTAssertEqual(DesktopSettingsSection.available(for: SurfaceGate(scope: .serverAdmin)), expected)
        // an organization server adds My connections after Models and voice
        var organization = expected
        organization.insert(.myConnections, at: 5)
        XCTAssertEqual(DesktopSettingsSection.available(for: SurfaceGate(scope: .serverAdmin, organization: true)), organization)
    }

    func testAClientOnAnOrganizationServerGetsMyConnections() {
        XCTAssertEqual(
            DesktopSettingsSection.available(for: SurfaceGate(scope: .serverClient, organization: true)),
            [.organization, .myConnections, .appearance]
        )
        XCTAssertTrue(DesktopSettingsSection.myConnections.matches("mes connexions", label: "My connections"))
    }

    func testASidecarAndAClientSessionGetTheRemoteClientSections() {
        for scope in [PairingScope.sidecar, .serverClient] {
            XCTAssertEqual(DesktopSettingsSection.available(for: SurfaceGate(scope: scope)), [.organization, .appearance])
        }
    }

    func testAFormerSectionOpensThePageThatHoldsItsCard() {
        let all = DesktopSettingsSection.available(for: SurfaceGate(scope: .serverAdmin))
        XCTAssertEqual(DesktopSettingsSection.resolve(.connections, available: all, visible: all), .engines)
        XCTAssertEqual(DesktopSettingsSection.resolve(.decisionModel, available: all, visible: all), .engines)
        XCTAssertEqual(DesktopSettingsSection.resolve(.companion, available: all, visible: all), .organization)
        XCTAssertTrue(DesktopSettingsSection.engines.matches("jev", label: "Models and voice"))
        XCTAssertTrue(DesktopSettingsSection.engines.matches("OpenRouter", label: "Models and voice"))
    }

    func testSearchMatchesTheLabelOrAKeywordIgnoringCase() {
        XCTAssertTrue(DesktopSettingsSection.connections.matches("OpenRouter", label: "API keys"))
        XCTAssertTrue(DesktopSettingsSection.engines.matches("model prov", label: "Model providers"))
        XCTAssertTrue(DesktopSettingsSection.general.matches("  ", label: "General"))
        XCTAssertFalse(DesktopSettingsSection.backups.matches("skin", label: "Backups"))
    }

    func testResolveKeepsTheRequestOrFallsToTheFirstMatch() {
        let all = DesktopSettingsSection.available(for: SurfaceGate(scope: .serverAdmin))
        XCTAssertEqual(DesktopSettingsSection.resolve(.usage, available: all, visible: all), .usage)
        XCTAssertEqual(DesktopSettingsSection.resolve(.usage, available: all, visible: [.appearance]), .appearance)
        // a section the pairing does not list opens its first one
        let remote = DesktopSettingsSection.available(for: SurfaceGate(scope: .sidecar))
        XCTAssertEqual(DesktopSettingsSection.resolve(.general, available: remote, visible: []), .organization)
    }

    func testPluginsTabsFollowTheConnectorGates() {
        XCTAssertEqual(DesktopPluginsTab.available(for: SurfaceGate(scope: .serverAdmin)), [.mcp])
        XCTAssertEqual(DesktopPluginsTab.available(for: SurfaceGate(scope: .sidecar)), [.mcp])
        XCTAssertEqual(DesktopPluginsTab.available(for: SurfaceGate(scope: .serverClient)), [])
    }

    // MARK: Config

    func testConfigDecodesTheSectionsSlice() throws {
        let json = #"""
        {"profile":{"name":"Parity Person","email":"parity@example.com","aboutMe":""},"language":"",
         "features":{"skillAuthoring":true,"routinesInConversation":false,"browser":false},
         "rooms":{"turnTimeoutMinutes":5},"threads":{"maxConcurrentPerBot":3},"budgets":{"monthlyUsd":100},
         "decider":{"provider":"jev","configured":false,"enabled":false,"jobs":{"roomRouting":true}},
         "openai":{"configured":true},"mistral":{"configured":false},
         "browserEngine":{"kind":"unavailable","installable":true},"localVm":{"mode":"shared"}}
        """#
        let config = try JSONDecoder().decode(DesktopSettingsConfig.self, from: Data(json.utf8))
        XCTAssertEqual(config.profile?.name, "Parity Person")
        XCTAssertEqual(config.features?.skillAuthoring, true)
        XCTAssertEqual(config.rooms?.turnTimeoutMinutes, 5)
        XCTAssertEqual(config.threads?.maxConcurrentPerBot, 3)
        XCTAssertEqual(config.budgets?.monthlyUsd, 100)
        XCTAssertEqual(config.decider?.jobs?.roomRouting, true)
        XCTAssertTrue(config.keyConfigured(.openai))
        XCTAssertFalse(config.keyConfigured(.mistral))
        XCTAssertFalse(config.keyConfigured(.decider))
    }

    func testChangesBuildTheDesktopBodies() throws {
        func json(_ change: DesktopConfigChange) throws -> [String: Any] {
            let request = try client.desktopSettingsRequest(change)
            XCTAssertEqual(request.url?.path, "/api/config")
            return try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any])
        }
        XCTAssertEqual((try json(.feature("skillAuthoring", false))["features"] as? [String: Bool])?["skillAuthoring"], false)
        XCTAssertEqual((try json(.roomTurnMinutes(10))["rooms"] as? [String: Int])?["turnTimeoutMinutes"], 10)
        XCTAssertEqual((try json(.parallelThreads(4))["threads"] as? [String: Int])?["maxConcurrentPerBot"], 4)
        XCTAssertEqual((try json(.profileName("  Ada  "))["profile"] as? [String: String])?["name"], "Ada")
        let routing = try json(.deciderRoomRouting(false))["decider"] as? [String: Any]
        XCTAssertEqual((routing?["jobs"] as? [String: Bool])?["roomRouting"], false)
        XCTAssertEqual((try json(.apiKey(.mistral, " key "))["mistral"] as? [String: String])?["key"], "key")
        XCTAssertEqual(try client.desktopSettingsRequest(.monthlyBudget(50)).httpMethod, "PUT")
        // the desktop's one PATCH, and null for the provider default
        let effort = try client.desktopSettingsRequest(.newBotEffort(nil))
        XCTAssertEqual(effort.httpMethod, "PATCH")
        XCTAssertTrue((try json(.newBotEffort(nil))["newBots"] as? [String: Any])?["effort"] is NSNull)
    }

    func testEventLogCleanupAndRecoveryBodies() throws {
        let off = try client.desktopSettingsRequest(.eventLogRetention(nil))
        XCTAssertEqual(off.httpMethod, "PATCH")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(off.httpBody)) as? [String: Any])
        XCTAssertTrue((body["threads"] as? [String: Any])?["eventLogRetentionDays"] is NSNull)
        XCTAssertNil(DesktopConfigChange.eventLogRetention(0).body)
        let recovery = DesktopConfigChange.automaticRecoveryOff.body?["automaticRecovery"] as? [String: Bool]
        XCTAssertEqual(recovery?["enabled"], false)
    }

    func testBackupExportRequestsAndFileName() throws {
        XCTAssertThrowsError(try client.exportWorkspaceBackupRequest(password: "short"))
        let request = try client.exportWorkspaceBackupRequest(password: "twelve chars!")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/workspace-backup/export")
        XCTAssertEqual(try client.workspaceBackupDownloadRequest(id: "b-1").url?.path, "/api/workspace-backup/download/b-1")
        XCTAssertThrowsError(try client.workspaceBackupDownloadRequest(id: "../etc"))
        XCTAssertEqual(WorkspaceBackupExport.safeFilename("../x/sagax-2026.ombbackup"), "sagax-2026.ombbackup")
        XCTAssertEqual(WorkspaceBackupExport.safeFilename(nil), "sagax-backup.ombbackup")
        XCTAssertEqual(WorkspaceBackupExport.safeFilename(".hidden"), "sagax-backup.ombbackup")
    }

    func testOutOfRangeChangesAreRefusedBeforeTheNetwork() {
        XCTAssertNil(DesktopConfigChange.feature("vpsComputer", true).body)
        XCTAssertNil(DesktopConfigChange.roomTurnMinutes(0).body)
        XCTAssertNil(DesktopConfigChange.parallelThreads(11).body)
        XCTAssertNil(DesktopConfigChange.newBotEffort("turbo").body)
        XCTAssertNil(DesktopConfigChange.monthlyBudget(-1).body)
        XCTAssertThrowsError(try client.desktopSettingsRequest(.parallelThreads(0)))
    }

    func testSpendSummaryReadsLikeTheDesktop() {
        XCTAssertEqual(DesktopSettingsSummary.spend(0, of: 100), "$0 of $100.00 (0%)")
        XCTAssertEqual(DesktopSettingsSummary.spend(25.5, of: 100), "$25.50 of $100.00 (26%)")
        XCTAssertEqual(DesktopSettingsSummary.spend(3, of: nil), "$3.00")
    }
}

final class DesktopSettingsEnginesAndPairingTests: XCTestCase {
    private let client = CompanionClient(
        connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810),
        token: "paired-token"
    )

    func testEnginesGroupAndLabelLikeTheDesktop() throws {
        let json = #"""
        {"instances":[
         {"instanceId":"claude","driverKind":"claudeAgent","displayName":"Fixture engine","access":"subscription",
          "snapshot":{"state":"available","version":"2.1.232 (Claude Code)","authenticated":true}},
         {"instanceId":"pi","driverKind":"piAgent","displayName":"pi","access":"custom","snapshot":{"state":"available","version":"0.87.1"}},
         {"instanceId":"chatgpt","driverKind":"codex","displayName":"ChatGPT plan","access":"subscription",
          "snapshot":{"state":"available","authenticated":false}},
         {"instanceId":"mistral","driverKind":"mistral","displayName":"Mistral (API)","access":"api","snapshot":{"state":"unavailable"}}]}
        """#
        struct List: Decodable { var instances: [DesktopEngine] }
        let engines = try JSONDecoder().decode(List.self, from: Data(json.utf8)).instances
        XCTAssertEqual(engines.filter(\.ready).map(\.name), ["Fixture engine", "pi"])
        XCTAssertEqual(engines[0].providerLine, "Anthropic")
        XCTAssertNil(engines[1].providerLine)
        XCTAssertEqual(engines[0].versionNumber, "2.1.232")
        XCTAssertEqual(engines[3].apiKeyProvider, .mistral)
        XCTAssertNil(engines[2].apiKeyProvider)
        XCTAssertFalse(engines[0].interactiveSignIn)
        XCTAssertTrue(engines[3].wantsAccessKey)
    }

    func testInteractiveSignInAndHiddenCommands() throws {
        let json = #"""
        {"instances":[
         {"instanceId":"cursor","driverKind":"cursorAgent","displayName":"Cursor","snapshot":{"state":"available","authenticated":false},
          "authentication":{"method":"open-link"},"install":{"apiKey":true,"signInCommand":"cursor-agent login","command":{"shell":"ignored"}}},
         {"instanceId":"kimi","driverKind":"kimiAgent","displayName":"Kimi","snapshot":{"state":"available","authenticated":false},
          "authentication":{"method":"device-code"},"install":{"signInCommand":"kimi login"}},
         {"instanceId":"minimax","driverKind":"minimax","displayName":"MiniMax","snapshot":{"state":"unavailable"},
          "install":{"apiKey":true,"signInCommand":"mmx auth login --api-key YOUR_MINIMAX_API_KEY"}},
         {"instanceId":"mistral","driverKind":"mistral","displayName":"Mistral","snapshot":{"state":"unavailable"},
          "install":{"signInCommand":"Add a key in Settings → API keys"}}]}
        """#
        struct List: Decodable { var instances: [DesktopEngine] }
        let engines = try JSONDecoder().decode(List.self, from: Data(json.utf8)).instances
        XCTAssertTrue(engines[0].interactiveSignIn)
        XCTAssertTrue(engines[0].wantsAccessKey)
        XCTAssertEqual(engines[0].manualCommand, "cursor-agent login")
        XCTAssertEqual(engines[1].manualCommand, "kimi login")
        XCTAssertTrue(engines[1].interactiveSignIn)
        XCTAssertNil(engines[2].manualCommand)
        XCTAssertTrue(engines[2].wantsAccessKey)
        XCTAssertNil(engines[3].manualCommand)
    }

    func testEngineSignInRequestsStayOnTheInstance() throws {
        let start = try client.startEngineSignInRequest(instanceId: "cursor")
        XCTAssertEqual(start.httpMethod, "POST")
        XCTAssertEqual(start.url?.path, "/api/instances/cursor/auth/start")
        let status = try client.engineSignInStatusRequest(instanceId: "grok", flowId: "11111111-1111-1111-1111-111111111111")
        XCTAssertEqual(status.url?.path, "/api/instances/grok/auth/status")
        XCTAssertTrue(status.url?.query?.contains("flowId=") == true)
        let cancel = try client.cancelEngineSignInRequest(instanceId: "kimi", flowId: "flow-1")
        XCTAssertEqual(cancel.url?.path, "/api/instances/kimi/auth/cancel")
        let complete = try client.completeEngineSignInRequest(instanceId: "claude", flowId: "flow-1", code: "abcd")
        let completeBody = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(complete.httpBody)) as? [String: String])
        XCTAssertEqual(completeBody["flowId"], "flow-1")
        XCTAssertEqual(completeBody["code"], "abcd")
        XCTAssertEqual(try client.engineAccessKeyStatusRequest(instanceId: "gemini").url?.path, "/api/instances/gemini/api-key")
        let saved = try client.saveEngineAccessKeyRequest(instanceId: "cursor", key: "")
        XCTAssertEqual(saved.httpMethod, "POST")
        XCTAssertEqual(saved.url?.path, "/api/instances/cursor/api-key")
        for id in ["..", "...", "a/b", ""] {
            XCTAssertThrowsError(try client.startEngineSignInRequest(instanceId: id))
            XCTAssertThrowsError(try client.saveEngineAccessKeyRequest(instanceId: id, key: "x"))
        }
        XCTAssertThrowsError(try client.engineSignInStatusRequest(instanceId: "cursor", flowId: "../x"))
        XCTAssertThrowsError(try client.completeEngineSignInRequest(instanceId: "cursor", flowId: "flow-1", code: " "))
    }

    func testSignInPagesAreAllowlisted() {
        XCTAssertNotNil(EngineSignInLink.allowed("https://cursor.com/loginDeepControl?challenge=abc&uuid=def&mode=login"))
        XCTAssertNotNil(EngineSignInLink.allowed("https://authenticator.cursor.sh/login"))
        XCTAssertNotNil(EngineSignInLink.allowed("https://auth.openai.com/codex/device"))
        XCTAssertNotNil(EngineSignInLink.allowed("https://auth.openai.com/api/accounts/authorize"))
        XCTAssertNotNil(EngineSignInLink.allowed("https://www.kimi.com/code/authorize_device?user_code=ABCD-EF12"))
        XCTAssertNotNil(EngineSignInLink.allowed("https://accounts.x.ai/device"))
        XCTAssertNil(EngineSignInLink.allowed("https://evilx.ai/login"))
        XCTAssertNil(EngineSignInLink.allowed("https://cursor.com.evil.test/loginDeepControl"))
        XCTAssertNil(EngineSignInLink.allowed("https://user:pass@cursor.com/login"))
        XCTAssertNil(EngineSignInLink.allowed("https://cursor.com:443/login"))
        XCTAssertNil(EngineSignInLink.allowed("https://cursor.com/login#token"))
        XCTAssertNil(EngineSignInLink.allowed("http://cursor.com/login"))
        XCTAssertNil(EngineSignInLink.allowed("https://cursor.com/admin"))
        XCTAssertNil(EngineSignInLink.allowed("https://www.kimi.com/login"))
    }

    func testPairingRequestsAndTimes() throws {
        let full = try client.createPairingCodeRequest(fullAccess: true)
        XCTAssertEqual(full.url?.path, "/api/auth/pairing")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(full.httpBody)) as? [String: [String]])
        XCTAssertEqual(body["scopes"], ["admin", "client"])
        let chat = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(client.createPairingCodeRequest(fullAccess: false).httpBody)) as? [String: [String]])
        XCTAssertEqual(chat["scopes"], ["client"])
        XCTAssertEqual(try client.signOutDeviceRequest(id: "s-1").httpMethod, "DELETE")
        XCTAssertThrowsError(try client.signOutDeviceRequest(id: "a/b"))

        let now = Date(timeIntervalSince1970: 1_000_000)
        let ms = now.timeIntervalSince1970 * 1000
        XCTAssertEqual(LastSeen(lastSeenAt: ms - 30_000, now: now), .justNow)
        XCTAssertEqual(LastSeen(lastSeenAt: ms - 13 * 60_000, now: now), .minutes(13))
        XCTAssertEqual(LastSeen(lastSeenAt: ms - 150 * 60_000, now: now), .hours(3))
        XCTAssertEqual(LastSeen(lastSeenAt: ms - 3 * 1_440 * 60_000, now: now), .days(3))
        let offer = ServerPairingOffer(id: "p", code: "ABCD", expiresAt: ms + 4.2 * 60_000, url: nil, hint: nil)
        XCTAssertEqual(offer.minutesLeft(now: now), 5)
        XCTAssertFalse(offer.expired(now: now))
    }
}

final class DesktopLocalComputerTests: XCTestCase {
    func testStatusStepsAndRecreate() throws {
        func status(_ json: String) throws -> LocalComputerStatus {
            try JSONDecoder().decode(LocalComputerStatus.self, from: Data(json.utf8))
        }
        let older = try status(#"{"ready":false,"runtime":"podman","daemonUp":true,"image":"cua:1","container":"running","imageMatches":false,"managed":true,"problem":"The existing Local VM uses an older desktop or Cua Driver; recreate it"}"#)
        XCTAssertTrue(older.image)
        XCTAssertTrue(older.needsRecreate)
        XCTAssertEqual(older.setupStep, 4)
        let fresh = try status(#"{"ready":false,"daemonUp":false,"image":false,"container":"missing"}"#)
        XCTAssertFalse(fresh.needsRecreate)
        XCTAssertEqual(fresh.setupStep, 1)
        let started = try status(#"{"runtime":"docker","daemonUp":false}"#)
        XCTAssertEqual(started.setupStep, 2)
    }
}

final class DesktopMCPAdminTests: XCTestCase {
    private let client = CompanionClient(
        connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810),
        token: "paired-token"
    )

    func testServerActionRequests() throws {
        let toggle = try client.mcpServerRequest("PATCH", "docs-wiki", body: ["enabled": false])
        XCTAssertEqual(toggle.url?.path, "/api/mcp/servers/docs-wiki")
        XCTAssertEqual(toggle.httpMethod, "PATCH")
        XCTAssertEqual(try client.mcpServerRequest("POST", "docs-wiki", suffix: "/test").url?.path, "/api/mcp/servers/docs-wiki/test")
        XCTAssertThrowsError(try client.mcpServerRequest("DELETE", "../config"))
        XCTAssertNotNil(DesktopConfigChange.feature("claudeUserMcp", true).body)
        let probe = try JSONDecoder().decode(MCPProbeResult.self, from: Data(#"{"ok":true,"tools":[{"name":"search"}]}"#.utf8))
        XCTAssertEqual(probe.tools?.map(\.name), ["search"])
    }
}

final class MCPServerDraftTests: XCTestCase {
    private let client = CompanionClient(
        connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810),
        token: "paired-token"
    )

    private func listing(_ json: String) throws -> MCPServerListing {
        try JSONDecoder().decode(MCPServerListing.self, from: Data(json.utf8))
    }

    func testURLServerHeadersKeepSavedValuesWhenBlank() throws {
        let existing = try listing(#"{"name":"docs","type":"http","url":"https://docs.example.test/mcp","headerKeys":["Authorization"],"enabled":true}"#)
        var draft = MCPServerDraft(editing: existing)
        XCTAssertEqual(draft.transport, .url)
        XCTAssertEqual(draft.headers, "Authorization: ")
        draft.headers += "\nX-Team: ops"
        let body = try draft.body(existing: existing).get()
        let headers = try XCTUnwrap(body["headers"] as? [String: Any])
        XCTAssertEqual(headers["Authorization"] as? Bool, true)
        XCTAssertEqual(headers["X-Team"] as? String, "ops")
        let request = try client.saveMCPServerRequest(draft, existing: existing)
        XCTAssertEqual(request.httpMethod, "PUT")
        XCTAssertEqual(request.url?.path, "/api/mcp/servers/docs")
    }

    func testCommandServerBodyAndProblems() throws {
        var draft = MCPServerDraft()
        draft.name = "files"
        draft.command = "npx"
        draft.args = "-y\n @scope/server \n"
        draft.env = "ROOT=/tmp\n"
        let body = try draft.body(existing: nil).get()
        XCTAssertEqual(body["args"] as? [String], ["-y", "@scope/server"])
        XCTAssertEqual((body["env"] as? [String: Any])?["ROOT"] as? String, "/tmp")
        let request = try client.saveMCPServerRequest(draft, existing: nil)
        XCTAssertEqual(request.httpMethod, "POST")
        let sent = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any])
        XCTAssertEqual(sent["name"] as? String, "files")

        draft.env = "1BAD=x"
        XCTAssertEqual(draft.body(existing: nil).failureValue, .invalidName("1BAD"))
        draft.env = "NOEQUALS"
        XCTAssertEqual(draft.body(existing: nil).failureValue, .line("NOEQUALS"))
        draft.env = "A=1\nA=2"
        XCTAssertEqual(draft.body(existing: nil).failureValue, .duplicate("A"))
        draft.command = " "
        XCTAssertEqual(draft.body(existing: nil).failureValue, .nameAndCommand)
        var remote = MCPServerDraft()
        remote.transport = .url
        remote.name = "x"
        remote.url = "ftp://nope"
        XCTAssertEqual(remote.body(existing: nil).failureValue, .nameAndURL)
    }
}

private extension Result {
    var failureValue: Failure? {
        if case let .failure(error) = self { return error }
        return nil
    }
}

final class DeciderTestTests: XCTestCase {
    func testResultsAndRequest() throws {
        func result(_ json: String) throws -> DeciderTestResult {
            try JSONDecoder().decode(DeciderTestResult.self, from: Data(json.utf8))
        }
        XCTAssertNil(try result(#"{"ok":true,"latencyMs":212}"#).failure)
        XCTAssertEqual(try result(#"{"ok":false,"reason":"rate_limited"}"#).failure, .rateLimited)
        XCTAssertEqual(try result(#"{"ok":false,"reason":"http_error","status":502}"#).failure, .http(502))
        XCTAssertEqual(try result(#"{"ok":false,"reason":"something_new"}"#).failure, .other)
        let client = CompanionClient(connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810), token: "t")
        let saved = try client.testDeciderRequest(key: "  ")
        XCTAssertEqual(saved.url?.path, "/api/decider/test")
        XCTAssertEqual(try JSONSerialization.jsonObject(with: XCTUnwrap(saved.httpBody)) as? [String: String], [:])
        let pasted = try client.testDeciderRequest(key: " k ")
        XCTAssertEqual(try JSONSerialization.jsonObject(with: XCTUnwrap(pasted.httpBody)) as? [String: String], ["key": "k"])
    }
}
