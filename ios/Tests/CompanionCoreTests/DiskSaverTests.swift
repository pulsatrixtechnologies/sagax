import XCTest
@testable import CompanionCore

final class DiskSaverTests: XCTestCase {
    func testTheTrashIsNeverPickedByDefaultAndNeedsItsConfirmation() throws {
        let preview = try JSONDecoder().decode(DiskSaverPreview.self, from: Data(#"""
        {"computerRunning":true,"totalBytes":30,"items":[{"id":"packageCaches","bytes":20,"userFiles":false},{"id":"trash","bytes":10,"userFiles":true},{"id":"thumbnails","bytes":0,"userFiles":false}]}
        """#.utf8))
        XCTAssertEqual(preview.defaultSelection, ["packageCaches"])
        XCTAssertEqual(preview.bytes(of: ["packageCaches", "trash"]), 30)
        XCTAssertTrue(preview.touchesUserFiles(["trash"]))
        let client = CompanionClient(connection: Connection(id: "c", name: "c", host: "example.test", port: 443), token: "t")
        let request = try client.diskSaverCleanRequest(["trash"], userFiles: true)
        let body = try JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any]
        XCTAssertEqual(body?["confirmUserFiles"] as? Bool, true)
    }
}
