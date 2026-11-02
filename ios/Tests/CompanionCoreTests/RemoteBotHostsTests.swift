import XCTest
@testable import CompanionCore

final class RemoteBotHostsTests: XCTestCase {
    private let host = "h_" + String(repeating: "ab", count: 16)
    private let other = "h_" + String(repeating: "cd", count: 16)

    func testPlacesOfferCatalogWithAttachStateAndNeverShowOpaqueIds() {
        let catalog = [
            UnattendedHostRow(hostId: host, hostname: "PC-A", state: "enrolled"),
            UnattendedHostRow(hostId: other, hostname: nil, state: "enrolled"),
        ]
        let places = RemoteBotHostsLogic.places(attached: [host], catalog: catalog, fallback: "Remote")
        XCTAssertEqual(places.map(\.hostId), [host, other])
        XCTAssertEqual(places[0].label, "PC-A")
        XCTAssertTrue(places[0].attached)
        XCTAssertEqual(places[1].label, "Remote")
        XCTAssertFalse(places[1].attached)
        XCTAssertFalse(places[1].label.contains(other))
    }

    func testTemporarySessionsHideAttachedHostMatches() {
        let sessions = [
            RemoteSessionView(id: "aaaaaaaaaaaa", code: "ABCDEF", state: "connected", hostname: "PC-A"),
            RemoteSessionView(id: "bbbbbbbbbbbb", code: "GHIJKL", state: "connected", hostname: "Laptop-Guest"),
            RemoteSessionView(id: "cccccccccccc", code: "MNOPQR", state: "ended", hostname: "Laptop-Guest"),
        ]
        let attached = [UnattendedHostRow(hostId: host, hostname: "PC-A", state: "enrolled")]
        let temporary = RemoteBotHostsLogic.temporarySessions(sessions, attachedHosts: attached)
        XCTAssertEqual(temporary.map(\.id), ["bbbbbbbbbbbb"])
        XCTAssertEqual(RemoteBotHostsLogic.sessionTitle(temporary[0]), "Laptop-Guest")
    }

    func testDecodesRemoteHostsAnswer() throws {
        let json = Data("""
        {"available":true,"hosts":[{"hostId":"\(host)","hostname":"PC-A","state":"enrolled","org":null,"scope":"full-control","installedBy":null,"enrolledAt":"2026-10-01T00:00:00.000Z","expiresAt":"2026-12-30T00:00:00.000Z","lastSeenAt":null,"revokedAt":null}],"catalog":[],"attached":["\(host)"]}
        """.utf8)
        let answer = try JSONDecoder().decode(BotRemoteHostsAnswer.self, from: json)
        XCTAssertTrue(answer.available)
        XCTAssertEqual(answer.hosts.first?.hostname, "PC-A")
        XCTAssertEqual(answer.attached, [host])
    }
}
