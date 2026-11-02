// BotTailscale decode + Connect apps row (desktop plugins-model Tailscale cases).
import Foundation
import XCTest
@testable import CompanionCore

final class BotTailscaleTests: XCTestCase {
    func testDecodesPublicViewWithoutSecrets() throws {
        let json = """
        {
          "phase": "pending_approval",
          "credentials": { "kind": "authKey", "hint": "9f2a", "tags": ["tag:sagax"] },
          "computer": { "id": "sandbox:p-1", "label": "Bot computer", "place": "sandbox" },
          "keyKind": "ephemeral",
          "device": { "name": "sagax-bot", "addresses": [], "pendingApproval": true, "nodeId": "n1" },
          "error": null,
          "computers": [
            { "id": "sandbox:p-1", "label": "Bot computer", "place": "sandbox" }
          ]
        }
        """.data(using: .utf8)!
        let view = try JSONDecoder().decode(BotTailscaleView.self, from: json)
        XCTAssertEqual(view.phase, .pendingApproval)
        XCTAssertTrue(view.shouldPoll)
        XCTAssertEqual(view.credentials?.hint, "9f2a")
        XCTAssertEqual(view.device?.name, "sagax-bot")
        XCTAssertEqual(view.computers.count, 1)
    }

    func testConnectedPhaseStopsPolling() throws {
        let json = """
        {
          "phase": "connected",
          "credentials": { "kind": "oauth", "hint": "kcli" },
          "computer": { "id": "sandbox:p-1", "label": "Bot computer", "place": "sandbox" },
          "keyKind": "reusable",
          "device": {
            "name": "sagax-bot",
            "addresses": ["100.64.0.12", "fd7a:115c:a1e0::12"],
            "pendingApproval": false
          },
          "computers": []
        }
        """.data(using: .utf8)!
        let view = try JSONDecoder().decode(BotTailscaleView.self, from: json)
        XCTAssertEqual(view.phase, .connected)
        XCTAssertFalse(view.shouldPoll)
        XCTAssertEqual(view.device?.addresses.count, 2)
        XCTAssertEqual(view.credentials?.kind, .oauth)
    }

    func testConnectAppsInjectsTailscaleRowStates() {
        let description = "Join your bot computer to your private tailnet."
        let idle = ConnectApps.items(ConnectAppSources(
            tailscale: BotTailscaleRowState(description: description, connected: false)
        ))
        let idleRow = idle.first { $0.key == tailscaleConnectAppKey }
        XCTAssertEqual(idleRow?.action, .connect)
        XCTAssertEqual(idleRow?.status, .available)
        XCTAssertEqual(idleRow?.category, .other)
        XCTAssertFalse(idleRow?.installed ?? true)

        let waiting = ConnectApps.items(ConnectAppSources(
            tailscale: BotTailscaleRowState(description: description, connected: false, pending: true)
        ))
        XCTAssertEqual(waiting.first { $0.key == tailscaleConnectAppKey }?.status, .pending)
        XCTAssertTrue(waiting.first { $0.key == tailscaleConnectAppKey }?.installed ?? false)
        XCTAssertNil(waiting.first { $0.key == tailscaleConnectAppKey }?.action)

        let on = ConnectApps.items(ConnectAppSources(
            tailscale: BotTailscaleRowState(description: description, connected: true)
        ))
        XCTAssertEqual(on.first { $0.key == tailscaleConnectAppKey }?.status, .connected)
        XCTAssertNil(on.first { $0.key == tailscaleConnectAppKey }?.action)
    }

    func testRowStateFromView() {
        var view = BotTailscaleView(phase: .joining)
        let joining = BotTailscaleRowState(view: view, description: "d")
        XCTAssertTrue(joining.pending)
        XCTAssertFalse(joining.connected)

        view.phase = .connected
        let connected = BotTailscaleRowState(view: view, description: "d")
        XCTAssertTrue(connected.connected)
        XCTAssertFalse(connected.pending)
    }
}
