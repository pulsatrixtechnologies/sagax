import CompanionCore
import Foundation
import XCTest

/// #2614: every missing phone permission has an action (the prompt, else the
/// app's page in the Settings app), checked against the vectors the desktop
/// shares (electron/os-permissions.vectors.json, "ios").
final class PhonePermissionsTests: XCTestCase {
    private struct Vector: Decodable { let id: String; let status: String; let expect: String }
    private struct Vectors: Decodable { let ios: [Vector] }

    func testEverySharedVector() throws {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let data = try Data(contentsOf: root.appendingPathComponent("electron/os-permissions.vectors.json"))
        let vectors = try JSONDecoder().decode(Vectors.self, from: data).ios
        XCTAssertFalse(vectors.isEmpty)
        for vector in vectors {
            let permission = try XCTUnwrap(PhonePermission(rawValue: vector.id), vector.id)
            let status = try XCTUnwrap(PhonePermissionStatus(rawValue: vector.status), vector.status)
            XCTAssertEqual(PhonePermissions.action(for: permission, status: status).rawValue, vector.expect, "\(vector.id) \(vector.status)")
        }
        // every phone permission is covered by the vectors
        XCTAssertEqual(Set(vectors.map(\.id)), Set(PhonePermission.allCases.map(\.rawValue)))
    }

    func testAMissingPermissionIsNeverADeadEnd() {
        for permission in PhonePermission.allCases {
            for status in [PhonePermissionStatus.notDetermined, .denied, .restricted, .unknown] {
                XCTAssertNotEqual(PhonePermissions.action(for: permission, status: status), .none, "\(permission) \(status)")
            }
        }
    }

    func testBotLinks() {
        XCTAssertEqual(PhonePermissions.permission(fromLink: "sagax://permission/microphone"), .microphone)
        XCTAssertEqual(PhonePermissions.permission(fromLink: "sagax://permission/Camera/"), .camera)
        XCTAssertNil(PhonePermissions.permission(fromLink: "sagax://permission/fullDisk"))
        XCTAssertNil(PhonePermissions.permission(fromLink: "https://example.com"))
    }
}
