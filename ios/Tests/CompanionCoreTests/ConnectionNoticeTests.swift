// #2013: the connection notice's state machine (ConnectionNotice.swift,
// desktop src/lib/connection-notice.ts).
import XCTest
@testable import CompanionCore

final class ConnectionNoticeTests: XCTestCase {
    typealias Machine = ConnectionNoticeMachine

    func testABlipShowsNothing() {
        var machine = Machine()
        machine.streamDisconnected(at: 1_000)
        XCTAssertNil(machine.evaluate(now: 2_000))
        XCTAssertNil(machine.evaluate(now: 3_400))
        machine.streamConnected(at: 3_450)
        XCTAssertNil(machine.evaluate(now: 3_500))
        XCTAssertNil(machine.evaluate(now: 4_000))
    }

    func testUnreachableThenReconnectedForThreeSeconds() {
        var machine = Machine()
        machine.streamDisconnected(at: 1_000)
        machine.streamDisconnected(at: 2_000) // a retry keeps the outage's start
        XCTAssertEqual(machine.evaluate(now: 3_600)?.kind, .serverUnreachable)
        XCTAssertEqual(machine.evaluate(now: 3_600)?.occurrence, "unreachable:1000")
        machine.streamConnected(at: 10_000)
        XCTAssertEqual(machine.evaluate(now: 10_000)?.kind, .reconnected)
        XCTAssertEqual(machine.evaluate(now: 12_900)?.kind, .reconnected)
        XCTAssertNil(machine.evaluate(now: 13_000))
        XCTAssertNil(machine.evaluate(now: 20_000))
    }

    func testAnnouncedRestartIsUpdatingThenUnreachableAfterFiveMinutes() {
        var machine = Machine()
        machine.restartAnnounced(at: 1_000)
        machine.streamDisconnected(at: 1_100)
        XCTAssertNil(machine.evaluate(now: 2_000))
        XCTAssertEqual(machine.evaluate(now: 4_000)?.kind, .updating)
        XCTAssertEqual(machine.evaluate(now: 1_100 + 299_000)?.kind, .updating)
        XCTAssertEqual(machine.evaluate(now: 1_100 + 300_000)?.kind, .serverUnreachable)
    }

    func testAnOldAnnouncementIsNotAnUpdate() {
        var machine = Machine()
        machine.restartAnnounced(at: 0)
        machine.streamDisconnected(at: 700_000)
        XCTAssertEqual(machine.evaluate(now: 703_000)?.kind, .serverUnreachable)
    }

    func testHealthProbeDecides() {
        var machine = Machine()
        machine.streamDisconnected(at: 0)
        machine.probed(.failed, at: 1_000)
        XCTAssertEqual(machine.evaluate(now: 3_000)?.kind, .serverUnreachable)
        machine.probed(.draining, at: 5_000)
        XCTAssertEqual(machine.evaluate(now: 6_000)?.kind, .updating)
        // five minutes after the probe first said draining
        XCTAssertEqual(machine.evaluate(now: 5_000 + 300_000)?.kind, .serverUnreachable)
        // a probe while the stream is up changes nothing
        var up = Machine()
        up.probed(.draining, at: 0)
        XCTAssertNil(up.evaluate(now: 5_000))
    }

    func testClassifyHealth() {
        let draining = Data(#"{"ok":false,"shuttingDown":true}"#.utf8)
        XCTAssertEqual(Machine.classifyHealth(status: 503, maintenanceHeader: false, body: draining), .draining)
        XCTAssertEqual(Machine.classifyHealth(status: 503, maintenanceHeader: true, body: nil), .draining)
        XCTAssertEqual(Machine.classifyHealth(status: 503, maintenanceHeader: false, body: Data("<html>".utf8)), .failed)
        XCTAssertEqual(Machine.classifyHealth(status: 502, maintenanceHeader: false, body: nil), .failed)
        XCTAssertEqual(Machine.classifyHealth(status: 504, maintenanceHeader: false, body: nil), .failed)
        XCTAssertEqual(Machine.classifyHealth(status: 200, maintenanceHeader: false, body: nil), .ok)
    }

    func testPerspicaxUnreachable() {
        var machine = Machine()
        machine.perspicax(unreachable: true, since: 500, at: 1_000)
        XCTAssertEqual(machine.evaluate(now: 1_000), .init(kind: .perspicaxUnreachable, occurrence: "perspicax:500"))
        // the server going down takes over once it is not a blip
        machine.streamDisconnected(at: 2_000)
        XCTAssertEqual(machine.evaluate(now: 2_500)?.kind, .perspicaxUnreachable)
        XCTAssertEqual(machine.evaluate(now: 5_000)?.kind, .serverUnreachable)
        machine.streamConnected(at: 6_000)
        XCTAssertEqual(machine.evaluate(now: 6_000)?.kind, .perspicaxUnreachable)
        machine.perspicax(unreachable: false, since: 7_000, at: 7_000)
        XCTAssertEqual(machine.evaluate(now: 7_000)?.kind, .reconnected)
        // no connector: nothing
        var none = Machine()
        none.perspicax(unreachable: nil, since: nil, at: 0)
        XCTAssertNil(none.evaluate(now: 0))
    }

    func testDismissedStaysDismissedForThatOccurrenceOnly() {
        var machine = Machine()
        machine.streamDisconnected(at: 0)
        let shown = try! XCTUnwrap(machine.evaluate(now: 3_000))
        machine.dismiss(shown)
        XCTAssertNil(machine.evaluate(now: 4_000))
        machine.streamConnected(at: 5_000)
        // dismissed: it was not on screen, so no Reconnected either
        XCTAssertNil(machine.evaluate(now: 5_000))
        // a new outage is a new occurrence
        machine.streamDisconnected(at: 10_000)
        XCTAssertEqual(machine.evaluate(now: 13_000)?.occurrence, "unreachable:10000")
    }

    func testReconnectedCanBeDismissed() {
        var machine = Machine()
        machine.streamDisconnected(at: 0)
        _ = machine.evaluate(now: 3_000)
        machine.streamConnected(at: 4_000)
        let reconnected = try! XCTUnwrap(machine.evaluate(now: 4_000))
        XCTAssertEqual(reconnected.kind, .reconnected)
        machine.dismiss(reconnected)
        XCTAssertNil(machine.evaluate(now: 4_500))
    }

    func testDeviceOfflineAddsNothing() {
        var machine = Machine()
        machine.network(offline: true)
        machine.streamDisconnected(at: 0)
        XCTAssertNil(machine.evaluate(now: 10_000))
        XCTAssertFalse(machine.probing)
        machine.network(offline: false)
        XCTAssertEqual(machine.evaluate(now: 11_000)?.kind, .serverUnreachable)
    }

    func testTheSettingTurnsItOff() {
        var machine = Machine(enabled: false)
        machine.streamDisconnected(at: 0)
        XCTAssertNil(machine.evaluate(now: 10_000))
        machine.setEnabled(true)
        XCTAssertEqual(machine.evaluate(now: 10_000)?.kind, .serverUnreachable)
        machine.setEnabled(false)
        machine.streamConnected(at: 11_000)
        machine.setEnabled(true)
        XCTAssertNil(machine.evaluate(now: 11_000))
    }

    func testFrames() throws {
        let restarting = try JSONDecoder().decode(StreamFrame.self, from: Data(#"{"kind":"server.restarting","at":1800000000000}"#.utf8))
        guard case let .serverRestarting(at) = restarting.frame else { return XCTFail("\(restarting.frame)") }
        XCTAssertEqual(at, 1_800_000_000_000)
        XCTAssertNil(restarting.seq)
        let status = try JSONDecoder().decode(StreamFrame.self, from: Data(#"{"kind":"connector.status","perspicax":{"state":"unreachable","since":42}}"#.utf8))
        guard case let .connectorStatus(value) = status.frame else { return XCTFail("\(status.frame)") }
        XCTAssertEqual(value, ConnectorStatus(perspicaxUnreachable: true, since: 42))
        XCTAssertEqual(ConnectorStatus.parse(Data(#"{"perspicax":null}"#.utf8)), ConnectorStatus(perspicaxUnreachable: nil, since: nil))
        XCTAssertEqual(ConnectorStatus.parse(Data(#"{"perspicax":{"state":"ok","since":1}}"#.utf8)), ConnectorStatus(perspicaxUnreachable: false, since: 1))
    }

    func testSettingOnByDefaultAndKeptOnThisDevice() {
        let name = "connection-notices-\(UUID().uuidString)"
        let store = UserDefaults(suiteName: name)!
        store.removePersistentDomain(forName: name)
        XCTAssertTrue(ConnectionNoticePrefs.isEnabled(store))
        XCTAssertEqual(DeviceSettings.answer(.init(id: "r1", op: "get", key: "omb-connection-notices"), defaults: store).value, "true")
        XCTAssertEqual(DeviceSettings.answer(.init(id: "r2", op: "set", key: "omb-connection-notices", value: "false"), defaults: store).value, "false")
        XCTAssertFalse(ConnectionNoticePrefs.isEnabled(store))
    }
}
