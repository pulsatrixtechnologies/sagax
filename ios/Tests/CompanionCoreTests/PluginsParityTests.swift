import Foundation
import XCTest
@testable import CompanionCore

/// WP9 (PL7, PL8, PL9): the gate, the person's claude.ai connectors, the MCP
/// servers, and the requests the phone sends.
final class PluginsParityTests: XCTestCase {
    private let client = CompanionClient(connection: Connection(name: "Test", host: "127.0.0.1", port: 8810), token: "t")

    // MARK: Gate

    func testGateMatchesTheSidecarAndClientRoutes() {
        let sidecar = SurfaceGate(scope: .sidecar)
        let client = SurfaceGate(scope: .serverClient)
        let admin = SurfaceGate(scope: .serverAdmin)
        let olderSidecar = SurfaceGate(scope: .sidecar, sidecarRoutes: [])
        XCTAssertTrue(sidecar.allows(.mcpServers))
        XCTAssertFalse(client.allows(.mcpServers))
        XCTAssertTrue(admin.allows(.mcpServers))
        XCTAssertTrue(sidecar.allows(.harnessConnectors))
        XCTAssertFalse(olderSidecar.allows(.harnessConnectors))
        XCTAssertTrue(client.allows(.harnessConnectors))
        XCTAssertTrue(admin.allows(.harnessConnectors))
        XCTAssertFalse(sidecar.allows(.harnessConnectorsSetting))
        XCTAssertFalse(client.allows(.harnessConnectorsSetting))
        XCTAssertTrue(admin.allows(.harnessConnectorsSetting))
    }

    // MARK: Requests

    func testHarnessConnectorsRequest() throws {
        let harness = try client.harnessConnectorsRequest(refresh: true)
        XCTAssertEqual(harness.url?.path, "/api/me/harness-connectors")
        XCTAssertEqual(harness.url?.query, "refresh=1")
        XCTAssertEqual(harness.timeoutInterval, 90)
        XCTAssertNil(try client.harnessConnectorsRequest(refresh: false).url?.query)
    }

    // MARK: Claude connectors (PL7)

    func testHarnessAnswerDecodesAndFallsBackToTheConnectorsPage() throws {
        let json = #"{"manageUrl":"javascript:alert(1)","canManage":false,"enabled":true,"claude":{"available":true,"connectors":[{"name":"Gmail","status":"connected"},{"name":"Drive","status":"needs_auth"}]},"codex":{"available":false,"reason":"no"}}"#
        let answer = try JSONDecoder().decode(HarnessConnectorsAnswer.self, from: Data(json.utf8))
        XCTAssertEqual(answer.claude.connectors.map(\.status), ["connected", "needs_auth"])
        XCTAssertEqual(answer.manageLink.absoluteString, "https://claude.ai/customize/connectors")
        XCTAssertFalse(answer.codex.available)
        let unavailable = try JSONDecoder().decode(HarnessConnectorsAnswer.self, from: Data(#"{"manageUrl":"https://claude.ai/x","canManage":true,"enabled":false,"claude":{"available":false,"reason":"not_signed_in"},"codex":{"available":true}}"#.utf8))
        XCTAssertEqual(unavailable.claude.reason, "not_signed_in")
        XCTAssertTrue(unavailable.claude.connectors.isEmpty)
        XCTAssertEqual(unavailable.manageLink.absoluteString, "https://claude.ai/x")
    }

    // MARK: MCP servers (PL8, PL9)

    func testMCPAuthLineAndSignInPoll() throws {
        let json = #"{"servers":[{"name":"docs","type":"http","url":"https://mcp.example.com/mcp","headerKeys":["Authorization"],"enabled":true,"auth":"required","authIssuer":"login.example.com"},{"name":"notes","command":"npx","args":["-y","notes"],"envKeys":["TOKEN"],"enabled":false},{"name":"old","type":"http","url":"https://old.example.com/mcp","headerKeys":[],"enabled":true,"auth":"expired","authError":"refresh refused"}]}"#
        let servers = try JSONDecoder().decode(MCPServersResponse.self, from: Data(json.utf8)).servers
        XCTAssertEqual(MCPServerRules.authLine(servers[0]), .required(issuer: "login.example.com", detail: nil))
        XCTAssertNil(MCPServerRules.authLine(servers[1]))
        XCTAssertEqual(MCPServerRules.authLine(servers[2]), .expired(detail: "refresh refused"))
        XCTAssertEqual(MCPServerRules.detailLine(servers[1]), "npx -y notes")
        XCTAssertEqual(servers[1].envKeys, ["TOKEN"])
        XCTAssertTrue(MCPServerRules.needsSignIn(servers[0]))
        XCTAssertFalse(MCPServerRules.needsSignIn(servers[1]))
        XCTAssertTrue(MCPServerRules.needsSignIn(servers[2]))

        XCTAssertEqual(MCPServerRules.poll(MCPSignInStatus(auth: "required", pending: true)), .keepWaiting)
        XCTAssertEqual(MCPServerRules.poll(MCPSignInStatus(auth: "connected", pending: false)), .connected)
        XCTAssertEqual(MCPServerRules.poll(MCPSignInStatus(auth: "error", pending: false, authError: "denied")), .stopped(error: "denied"))
    }
}
