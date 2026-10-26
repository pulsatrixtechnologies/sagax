// Parity lot R7 (O2): the scheduled update of the bot's computer from the
// phone. Payloads in the shape server/routes/computer-care.ts returns.
import Foundation
import XCTest
@testable import CompanionCore

private final class MaintenanceStub: URLProtocol {
    static var responseBody = Data()
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
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.responseBody)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class ParityR7Tests: XCTestCase {
    private var session: URLSession!

    override func setUp() {
        super.setUp()
        MaintenanceStub.captured = nil
        MaintenanceStub.capturedBody = nil
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MaintenanceStub.self]
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

    private let view = #"{"schedule":{"enabled":true,"days":[0,3],"hour":3,"windowHours":2,"timeZone":"America/Toronto"},"nextWindowAt":1792800000000,"lastResult":{"at":1792700000000,"outcome":"postponed"},"running":false}"#

    func testReadsTheScheduleNextWindowAndLastResult() async throws {
        MaintenanceStub.responseBody = Data(view.utf8)
        let maintenance = try await client().computerMaintenance()
        XCTAssertEqual(MaintenanceStub.captured?.httpMethod, "GET")
        XCTAssertEqual(MaintenanceStub.captured?.url?.path, "/api/computer/maintenance")
        XCTAssertEqual(maintenance.schedule.days, [0, 3])
        XCTAssertEqual(maintenance.schedule.timeZone, "America/Toronto")
        XCTAssertEqual(maintenance.nextWindow, Date(timeIntervalSince1970: 1_792_800_000))
        XCTAssertEqual(maintenance.lastResult?.outcome, .postponed)
        XCTAssertFalse(maintenance.running)
    }

    func testAnUnknownOutcomeOrMissingFieldsStillRead() throws {
        let json = #"{"schedule":{"enabled":false,"days":[0],"hour":3,"windowHours":2,"timeZone":"UTC"},"nextWindowAt":null,"lastResult":{"at":1,"outcome":"exploded"}}"#
        let maintenance = try JSONDecoder().decode(ComputerMaintenance.self, from: Data(json.utf8))
        XCTAssertNil(maintenance.nextWindow)
        XCTAssertEqual(maintenance.lastResult?.outcome, .unknown)
        XCTAssertFalse(maintenance.running)
        // never set: the first change starts in the phone's zone, not UTC
        XCTAssertEqual(maintenance.editable(phoneZone: "America/Montreal").timeZone, "America/Montreal")
    }

    func testSavingSendsTheWholeScheduleNormalized() async throws {
        MaintenanceStub.responseBody = Data(view.utf8)
        let schedule = MaintenanceSchedule(enabled: true, days: [5, 3, 3, 9], hour: 27, windowHours: 0, timeZone: "America/Toronto")
        _ = try await client().setComputerMaintenance(schedule)
        XCTAssertEqual(MaintenanceStub.captured?.httpMethod, "PUT")
        XCTAssertEqual(MaintenanceStub.captured?.value(forHTTPHeaderField: "Content-Type"), "application/json")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(MaintenanceStub.capturedBody)) as? [String: Any])
        XCTAssertEqual(Set(body.keys), ["enabled", "days", "hour", "windowHours", "timeZone"])
        XCTAssertEqual(body["days"] as? [Int], [3, 5])
        XCTAssertEqual(body["hour"] as? Int, 23)
        XCTAssertEqual(body["windowHours"] as? Int, 1)
    }

    func testTheLastDayCannotBeTurnedOff() {
        let one = MaintenanceSchedule(enabled: true, days: [0], hour: 3, windowHours: 2, timeZone: "UTC")
        XCTAssertEqual(one.toggling(day: 0).days, [0])
        XCTAssertEqual(one.toggling(day: 6).days, [0, 6])
        XCTAssertEqual(one.toggling(day: 6).toggling(day: 0).days, [6])
        XCTAssertEqual(one.toggling(day: 7).days, [0])
    }
}
