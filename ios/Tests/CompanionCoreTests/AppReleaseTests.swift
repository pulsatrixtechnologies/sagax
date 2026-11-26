import XCTest
@testable import CompanionCore

/// D-20261126-004: the phone says its release on every request, so the
/// server can ask an app older than its minimum to update before it sends.
final class AppReleaseTests: XCTestCase {
    func testReadsTheReleaseOfTheBundleAndNothingElse() {
        XCTAssertEqual(AppRelease.current(info: ["CFBundleShortVersionString": "0.8.174", "CFBundleVersion": "236"]), "0.8.174")
        XCTAssertNil(AppRelease.current(info: ["CFBundleShortVersionString": "dev"]))
        XCTAssertNil(AppRelease.current(info: ["CFBundleShortVersionString": "16.0"]))
        XCTAssertNil(AppRelease.current(info: ["CFBundleShortVersionString": "0.8.174 (236)"]))
        XCTAssertNil(AppRelease.current(info: ["CFBundleVersion": "236"]))
        XCTAssertNil(AppRelease.current(info: nil))
        XCTAssertEqual(AppRelease.header, "x-sagax-app-version")
    }

    func testEveryRequestCarriesTheReleaseWhenTheAppNamesOne() throws {
        let client = CompanionClient(connection: Connection(name: "Org", host: "127.0.0.1", port: 8810), token: "t")
        let named = try client.makeRequest("POST", "/api/bots/b1/messages", body: ["text": "hi"], release: "0.8.174")
        XCTAssertEqual(named.value(forHTTPHeaderField: "x-sagax-app-version"), "0.8.174")
        let unnamed = try client.makeRequest("GET", "/api/bots", release: nil)
        XCTAssertNil(unnamed.value(forHTTPHeaderField: "x-sagax-app-version"))
        // by default it is the running bundle's own
        let usual = try client.makeRequest("GET", "/api/bots")
        XCTAssertEqual(usual.value(forHTTPHeaderField: "x-sagax-app-version"), AppRelease.current())
    }
}
