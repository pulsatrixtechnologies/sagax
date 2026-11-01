// Validator and decode parity for portable Shape avatar definitions
// (shared/shape-avatar-def.ts). Geometry only; colour is separate.
import XCTest
@testable import CompanionCore

final class ShapeAvatarDefTests: XCTestCase {
    private func samplePartsJSON() -> Data {
        let json = """
        {
          "schemaVersion": 1,
          "id": "cup",
          "name": "Cup",
          "body": {
            "kind": "parts",
            "parts": [
              { "type": "ellipse", "cx": 46, "cy": 50, "rx": 22, "ry": 30 },
              { "type": "ellipse", "cx": 68, "cy": 50, "rx": 12, "ry": 14 }
            ]
          },
          "eyes": {
            "anchor": [46, 42],
            "size": { "w": 7, "h": 15 },
            "shape": "pill",
            "gap": 14
          }
        }
        """
        return Data(json.utf8)
    }

    func testAcceptsValidObjectDefinition() {
        let result = ShapeAvatarValidator.validateJSON(samplePartsJSON())
        guard case let .ok(def) = result else {
            return XCTFail("expected ok, got \(result)")
        }
        XCTAssertEqual(def.id, "cup")
        XCTAssertEqual(def.schemaVersion, 1)
    }

    func testRejectsColourInsideDefinition() {
        let json = Data(#"{"schemaVersion":1,"body":{"kind":"parts","parts":[{"type":"circle","cx":50,"cy":50,"r":20}]},"eyes":{"anchor":[50,42],"size":{"w":7,"h":14}},"color":"teal"}"#.utf8)
        let result = ShapeAvatarValidator.validateJSON(json)
        guard case let .error(message) = result else {
            return XCTFail("expected error")
        }
        XCTAssertTrue(message.contains("geometry only"))
    }

    func testRejectsGUIDId() {
        var object = try! JSONSerialization.jsonObject(with: samplePartsJSON()) as! [String: Any]
        object["id"] = "550e8400-e29b-41d4-a716-446655440000"
        let result = ShapeAvatarValidator.validate(object)
        guard case .error = result else {
            return XCTFail("GUID ids must be refused")
        }
    }

    func testRejectsOpenPath() {
        XCTAssertNotNil(ShapeAvatarValidator.assertSafePath("M10 10 L20 20"))
        XCTAssertNil(ShapeAvatarValidator.assertSafePath("M10 10 L20 20 Z"))
    }

    func testObjectShapesAreKnownMascotShapes() {
        for id in ["pad", "cup", "bulb", "say", "sprout", "tin", "tome", "ship"] {
            XCTAssertNotNil(MascotShape.stored(id), "missing shape \(id)")
        }
        XCTAssertEqual(MascotShape.allCases.count, 40)
    }

    func testMascotLookKeepsAvatarDef() throws {
        let def = ShapeAvatarValidator.validateJSON(samplePartsJSON()).def!
        let look = MascotLook(character: .shape, shape: .cup, avatarDef: def)
        let data = try JSONEncoder().encode(look)
        let decoded = try JSONDecoder().decode(MascotLook.self, from: data)
        XCTAssertEqual(decoded.character, .shape)
        XCTAssertEqual(decoded.shape, .cup)
        XCTAssertEqual(decoded.avatarDef?.id, "cup")
        XCTAssertEqual(decoded.complete.avatarDef?.id, "cup")
    }

    func testMascotLookDropsInvalidAvatarDefButKeepsShape() throws {
        let json = Data(#"{"character":"shape","shape":"pad","avatarDef":{"schemaVersion":1,"body":{"kind":"parts","parts":[]},"eyes":{"anchor":[50,42],"size":{"w":7,"h":14}}}}"#.utf8)
        let decoded = try JSONDecoder().decode(MascotLook.self, from: json)
        XCTAssertEqual(decoded.character, .shape)
        XCTAssertEqual(decoded.shape, .pad)
        XCTAssertNil(decoded.avatarDef)
    }

    func testPathPresetsMatchObjectIds() {
        for shape in ShapeAvatarPresets.objectIds {
            let preset = ShapeAvatarPresets.byShape(shape)
            XCTAssertNotNil(preset, shape.rawValue)
            XCTAssertEqual(preset?.id, shape.rawValue)
            guard case .ok = ShapeAvatarValidator.check(preset!) else {
                return XCTFail("invalid preset \(shape.rawValue)")
            }
        }
    }

    func testShareRoundTrip() throws {
        let payload = try ShapeAvatarShareCodec.encode(ShapeAvatarPresets.ship, color: "teal", mood: "happy")
        let decoded = ShapeAvatarShareCodec.decode(payload)
        guard case let .ok(def) = decoded.validation else {
            return XCTFail("share decode failed")
        }
        XCTAssertEqual(def.id, "ship")
        XCTAssertEqual(decoded.color, "teal")
        XCTAssertEqual(decoded.mood, "happy")
    }
}
