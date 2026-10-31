import Foundation
import XCTest
@testable import CompanionCore

final class BotCapabilitiesTests: XCTestCase {
    private let client = CompanionClient(
        connection: Connection(name: "Test", host: "127.0.0.1", port: 8810),
        token: "paired-token"
    )

    private let json = #"""
    {"botId":"bot_1","engine":{"kind":"claudeAgent","label":"Claude Code"},
     "promptIndex":{"bytes":9000,"maxBytes":8000,"skills":12,"maxSkills":40,"omitted":2},
     "items":[
      {"key":"plugin:bot:lint@acme","form":"plugin","name":"Lint","source":{"kind":"marketplace","label":"acme","version":"1.0.0"},
       "scope":"bot","state":"on","enabled":true,"canToggle":true,"updateAvailable":true,
       "brings":{"skills":["lint"],"commands":["fix"],"agents":["reviewer"],"mcpServers":[]},
       "engine":{"skills":"native","commands":"native","agents":"native","nothing":false},"installedBy":"Alex"},
      {"key":"mcp:installation:docs","form":"mcp","name":"Docs","source":{"kind":"installation","label":"Sagax"},
       "scope":"installation","state":"on","enabled":true,"canToggle":true,"engine":{"mcp":"mounted","nothing":false},"mounts":["docs"]},
      {"key":"mcp:installation:off-one","form":"mcp","name":"Off one","source":{"kind":"installation","label":"Sagax"},
       "scope":"installation","state":"off","enabled":false,"canToggle":true,"reason":"disabled","engine":{"mcp":"mounted","nothing":false}},
      {"key":"plugin:installation:pack@acme","form":"plugin","name":"Pack","source":{"kind":"marketplace","label":"acme"},
       "scope":"installation","state":"off","enabled":false,"canToggle":false,
       "brings":{"skills":[],"commands":[],"agents":[],"mcpServers":["pack-a","docs"]},"engine":{"mcp":"mounted","nothing":false}},
      {"key":"role:bot:1f0e2c1a-0000-4000-8000-000000000001","form":"role","name":"","source":{"kind":"perspicax","label":"Org"},
       "scope":"bot","state":"off","reason":"unknown_profile","enabled":true,"canToggle":true,"engine":{"mcp":"proxied","tools":"proxied","nothing":false}},
      {"key":"role:bot:p2","form":"role","name":"Billing","source":{"kind":"perspicax","label":"Org"},
       "scope":"bot","state":"not_held","enabled":true,"canToggle":true,"engine":{"mcp":"mounted","tools":"mounted","nothing":false}},
      {"key":"skill:bot:notes","form":"skill","name":"notes","source":{"kind":"file","label":"GitHub"},
       "scope":"bot","state":"not_served","enabled":true,"canToggle":true,"engine":{"skills":"none","nothing":true}},
      {"key":"skill:installation:old","form":"skill","name":"old","source":{"kind":"installation","label":"Library"},
       "scope":"installation","state":"off","enabled":true,"canToggle":true,"reason":"library_off","engine":{"skills":"prompt","nothing":false}},
      {"key":"flow:organization:flow","form":"flow","name":"Flow","source":{"kind":"perspicax","label":"Org","version":"0.7.1"},
       "scope":"organization","state":"imposed","enabled":true,"canToggle":false,"engine":{"skills":"native","nothing":false}},
      {"key":"future:x","form":"hologram","name":"Future","scope":"galaxy","state":"shimmering","engine":{"skills":"teleported"}},
      {"form":"plugin","name":"No key"}
     ]}
    """#

    private func list() throws -> BotCapabilityList {
        try JSONDecoder().decode(BotCapabilityList.self, from: Data(json.utf8))
    }

    func testDecodesTheResolvedList() throws {
        let list = try list()
        XCTAssertEqual(list.engine.label, "Claude Code")
        XCTAssertEqual(list.promptIndex?.cuts, true)
        // the row without a key is dropped; the unknown one is kept as other
        XCTAssertEqual(list.items.count, 10)
        let plugin = list.items[0]
        XCTAssertEqual(plugin.form, .plugin)
        XCTAssertEqual(plugin.scope, .bot)
        XCTAssertEqual(plugin.sourceLabel, "acme")
        XCTAssertEqual(plugin.sourceVersion, "1.0.0")
        XCTAssertTrue(plugin.updateAvailable)
        XCTAssertEqual(plugin.installedBy, "Alex")
        XCTAssertEqual(plugin.brings?.agents, ["reviewer"])
        XCTAssertTrue(plugin.served)
        let future = list.items[9]
        XCTAssertEqual(future.form, .other)
        XCTAssertEqual(future.scope, .other)
        XCTAssertEqual(future.state, .other)
        XCTAssertFalse(future.canToggle)
        XCTAssertEqual(future.engine.skills, .unknown)
        XCTAssertTrue(future.engine.nothing)
    }

    func testAMissingOrEmptyBodyIsAnEmptyList() throws {
        let empty = try JSONDecoder().decode(BotCapabilityList.self, from: Data("{}".utf8))
        XCTAssertTrue(empty.items.isEmpty)
        XCTAssertNil(empty.promptIndex)
        XCTAssertTrue(BotCapabilityReceipt(empty).isEmpty)
    }

    func testPartialPluginDiscoveryAndLegacyIndexes() throws {
        let partial = try JSONDecoder().decode(BotCapabilityList.self, from: Data(#"{"promptIndex":{"bytes":900,"maxBytes":4000,"skills":2,"maxSkills":30,"omitted":0,"incomplete":true}}"#.utf8))
        XCTAssertEqual(partial.promptIndex?.incomplete, true)
        XCTAssertEqual(partial.promptIndex?.cuts, true)
        let legacy = try JSONDecoder().decode(BotCapabilityList.self, from: Data(#"{"promptIndex":{"bytes":900,"maxBytes":4000,"skills":2,"maxSkills":30,"omitted":0}}"#.utf8))
        XCTAssertEqual(legacy.promptIndex?.incomplete, false)
        XCTAssertEqual(legacy.promptIndex?.cuts, false)
    }

    func testUnknownReceiptsNeverInventAReceivedCapability() throws {
        let json = #"{"engine":{"kind":"future","label":"Future"},"items":[{"key":"plugin:bot:future","form":"plugin","name":"Future","state":"on","engine":{"skills":"teleported","nothing":false}},{"key":"plugin:bot:mixed","form":"plugin","name":"Mixed","state":"on","engine":{"skills":"teleported","mcp":"mounted","nothing":false}},{"key":"plugin:bot:missing","form":"plugin","name":"Missing","state":"on"}]}"#
        let list = try JSONDecoder().decode(BotCapabilityList.self, from: Data(json.utf8))
        XCTAssertEqual(list.items[0].engine.skills, .unknown)
        XCTAssertFalse(list.items[0].served)
        XCTAssertTrue(list.items[1].served)
        XCTAssertFalse(list.items[2].served)
        let receipt = BotCapabilityReceipt(list)
        XCTAssertEqual(receipt.skillsAndCommands, [])
        XCTAssertEqual(receipt.servers, ["Mixed"])
    }

    func testSwitchesFollowTheKey() throws {
        let items = try list().items
        XCTAssertEqual(items[0].toggle, .plugin(key: "lint@acme"))
        XCTAssertEqual(items[1].toggle, .installationServer(name: "docs"))
        XCTAssertNil(items[2].toggle, "a server the installation turned off has no switch")
        XCTAssertNil(items[3].toggle, "canToggle false")
        XCTAssertEqual(items[5].toggle, .role(id: "p2"))
        XCTAssertEqual(items[6].toggle, .skill(name: "notes"))
        XCTAssertNil(items[7].toggle, "library off: the library routes refuse")
        XCTAssertNil(items[8].toggle)
        XCTAssertTrue(BotCapabilityToggle.skill(name: "notes").needsReview(on: true))
        XCTAssertFalse(BotCapabilityToggle.skill(name: "notes").needsReview(on: false))
        XCTAssertFalse(BotCapabilityToggle.plugin(key: "lint@acme").needsReview(on: true))
    }

    func testTheReceiptGroupsWhatTheEngineGets() throws {
        let receipt = BotCapabilityReceipt(try list())
        XCTAssertEqual(receipt.skillsAndCommands, ["Lint", "Flow"])
        XCTAssertEqual(receipt.agents, ["Lint"])
        XCTAssertEqual(receipt.servers, ["Docs"])
        XCTAssertEqual(receipt.notServed, ["notes"])
    }

    func testTheBotsServerListAfterOneSwitch() throws {
        let list = try list()
        XCTAssertEqual(BotCapabilityRules.installationServerNames(list), ["docs", "off-one", "pack-a"])
        // no list of its own: every server, minus the one switched off
        XCTAssertEqual(BotCapabilityRules.mcpServersAfter(nil, list: list, name: "docs", on: false), ["off-one", "pack-a"])
        XCTAssertEqual(BotCapabilityRules.mcpServersAfter(["pack-a"], list: list, name: "docs", on: true), ["pack-a", "docs"])
        XCTAssertEqual(BotCapabilityRules.mcpServersAfter(["docs"], list: list, name: "docs", on: true), ["docs"])
    }

    func testRolesAfterRemovingOne() throws {
        XCTAssertEqual(BotCapabilityRules.rolesAfter(try list(), removing: "p2"), ["1f0e2c1a-0000-4000-8000-000000000001"])
    }

    func testRequestsMatchTheServerRoutes() throws {
        let load = try client.botCapabilitiesRequest(botId: "bot_1")
        XCTAssertEqual(load.url?.path, "/api/bots/bot_1/capabilities")
        XCTAssertEqual(load.httpMethod, "GET")
        XCTAssertNil(load.url?.query)
        let preview = try client.botCapabilitiesRequest(botId: "bot_1", engine: "codex-1")
        XCTAssertEqual(preview.url?.query, "engine=codex-1")
        XCTAssertThrowsError(try client.botCapabilitiesRequest(botId: "../x"))

        let assign = try client.setBotLibrarySkillsRequest(botId: "bot_1", skills: ["a", "b"])
        XCTAssertEqual(assign.url?.path, "/api/bots/bot_1/skills-library")
        XCTAssertEqual(assign.httpMethod, "PUT")
        let body = try JSONSerialization.jsonObject(with: assign.httpBody ?? Data()) as? [String: [String]]
        XCTAssertEqual(body, ["skills": ["a", "b"]])
    }

    func testTheGateIsTheBotPluginsOne() {
        XCTAssertFalse(BotCapabilityRules.reachable(gate: SurfaceGate(scope: .sidecar)))
        XCTAssertTrue(BotCapabilityRules.reachable(gate: SurfaceGate(scope: .serverAdmin)))
        XCTAssertTrue(BotCapabilityRules.reachable(gate: SurfaceGate(scope: .serverClient, organization: true)))
    }
}
