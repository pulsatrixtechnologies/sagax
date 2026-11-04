import XCTest
@testable import CompanionCore

final class WorkspaceRestoreTests: XCTestCase {
    func testTheFileGoesUpAsBytesAndTheRestoreNamesReplace() throws {
        let client = CompanionClient(connection: Connection(id: "c", name: "c", host: "example.test", port: 443), token: "t")
        let upload = try client.uploadWorkspaceBackupRequest(Data([1, 2, 3]))
        XCTAssertEqual(upload.value(forHTTPHeaderField: "content-type"), "application/octet-stream")
        XCTAssertEqual(upload.httpBody, Data([1, 2, 3]))
        let restore = try client.restoreWorkspaceBackupRequest(id: "abc123")
        let body = try JSONSerialization.jsonObject(with: restore.httpBody ?? Data()) as? [String: Any]
        XCTAssertEqual(body?["confirmation"] as? String, "REPLACE")
        XCTAssertThrowsError(try client.restoreWorkspaceBackupRequest(id: "../x"))
        XCTAssertFalse(WorkspaceRestore.ready("replace"))
        XCTAssertTrue(WorkspaceRestore.ready("REPLACE"))
    }
}
