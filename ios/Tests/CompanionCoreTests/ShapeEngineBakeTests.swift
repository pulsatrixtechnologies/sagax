// A person's own shape on the phone, as the desktop keeps and draws it
// (#4159, #4160): a definition pasted on the desktop (the engine's format,
// `version` 1, no `schemaVersion`) decodes, survives a save made on the
// phone, and is drawn from the engine's own frames. The expected frames
// (Fixtures/own-shape-stills.json) are the desktop's
// `bakeStill(lookDefinition(...))`, written by ios-mascot-export.test.ts.
import XCTest
@testable import CompanionCore

final class ShapeEngineBakeTests: XCTestCase {
    private struct Fixture: Decodable {
        struct Case: Decodable {
            var name: String
            var shape: String
            var avatarDef: MascotAvatarDef
            var flat: Bool
        }
        var cases: [Case]
    }

    private func fixtureData() throws -> Data {
        let url = try XCTUnwrap(
            Bundle.module.url(forResource: "own-shape-stills", withExtension: "json", subdirectory: "Fixtures")
                ?? Bundle.module.url(forResource: "own-shape-stills", withExtension: "json")
        )
        return try Data(contentsOf: url)
    }

    /// The expected stills, read by the same JSON reader as the engine's answer so numbers compare alike.
    private func expectedStills(_ data: Data) throws -> [NSDictionary] {
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let cases = try XCTUnwrap(root["cases"] as? [[String: Any]])
        return try cases.map { try XCTUnwrap($0["still"] as? NSDictionary) }
    }

    private static let pasted = #"{"character":"shape","shape":"pumpkin","skins":{"shape":"neon"},"avatarDef":{"version":1,"id":"my-ghost","name":"My ghost","body":{"path":"M24 50C24 28 35 12 50 12C65 12 76 28 76 50L77 80C77 85 73 88 68 88C63 88 61 84 59 81C57 84 54 88 50 88C46 88 43 84 41 81C39 84 37 88 32 88C27 88 23 85 23 80Z"},"eyes":{"x":50,"y":42,"spacing":16,"scale":1.15}}}"#

    func testAPastedDefinitionDecodesAndIsKept() throws {
        let look = try JSONDecoder().decode(MascotLook.self, from: Data(Self.pasted.utf8))
        let engine = try XCTUnwrap(look.avatarDef?.engine, "the engine's format is kept, never dropped")
        XCTAssertEqual(engine.id, "my-ghost")
        XCTAssertEqual(engine.name, "My ghost")
        XCTAssertEqual(engine.eyes, EngineAvatarDef.Eyes(x: 50, y: 42, spacing: 16, scale: 1.15))
        XCTAssertEqual(look.complete.avatarDef, look.avatarDef)
    }

    /// A skin changed on the phone saves the whole look (`CompleteMascotLook.stored`): the definition goes back as it came.
    func testASaveOnThePhoneSendsThePastedDefinitionBack() throws {
        let look = try JSONDecoder().decode(MascotLook.self, from: Data(Self.pasted.utf8))
        var complete = look.complete
        complete.shapeSkin = .gold
        let sent = try JSONSerialization.jsonObject(with: JSONEncoder().encode(complete.stored)) as? [String: Any]
        let original = try JSONSerialization.jsonObject(with: Data(Self.pasted.utf8)) as? [String: Any]
        XCTAssertEqual(sent?["avatarDef"] as? NSDictionary, original?["avatarDef"] as? NSDictionary)
        XCTAssertEqual((sent?["skins"] as? [String: Any])?["shape"] as? String, "gold")
    }

    func testAnEngineDefinitionThatIsNotOneIsDropped() throws {
        let json = #"{"character":"shape","shape":"pumpkin","avatarDef":{"version":1,"id":"no-eyes","name":"No eyes","body":{"path":"M20 20H80V80H20Z"}}}"#
        let look = try JSONDecoder().decode(MascotLook.self, from: Data(json.utf8))
        XCTAssertEqual(look.shape, .pumpkin)
        XCTAssertNil(look.avatarDef)
    }

    /// The engine runs here and gives the very frames the desktop draws, pasted or drawn, in volume and flat;
    /// a definition the engine refuses falls back to the bot's shape, as on the desktop.
    func testOwnShapesAreDrawnFromTheEnginesFrames() throws {
        let data = try fixtureData()
        let f = try JSONDecoder().decode(Fixture.self, from: data)
        let stills = try expectedStills(data)
        XCTAssertEqual(f.cases.count, 6)
        XCTAssertEqual(stills.count, f.cases.count)
        for (c, expected) in zip(f.cases, stills) {
            let shape = try XCTUnwrap(MascotShape.stored(c.shape))
            let encoder = JSONEncoder()
            encoder.outputFormatting = .sortedKeys
            let def = try XCTUnwrap(String(data: try encoder.encode(c.avatarDef), encoding: .utf8))
            let file = try XCTUnwrap(ShapeEngineBake.stillFile(shape.rawValue, def, c.flat), c.name)
            let got = try JSONSerialization.jsonObject(with: Data(file.utf8)) as? NSDictionary
            XCTAssertEqual(got, expected, c.name)
        }
    }

    /// A view bakes a person's own shape off the main thread: not ready before, ready (and kept) after.
    func testABakedOwnShapeIsReadyAfterwards() throws {
        let look = try JSONDecoder().decode(MascotLook.self, from: Data(Self.pasted.utf8))
        let def = try XCTUnwrap(look.avatarDef)
        XCTAssertFalse(ShapeEngineBake.isReady(.star, avatarDef: def))
        XCTAssertNotNil(ShapeEngineBake.still(.star, avatarDef: def))
        XCTAssertTrue(ShapeEngineBake.isReady(.star, avatarDef: def))
        XCTAssertFalse(ShapeEngineBake.isReady(.star, avatarDef: def, flat: true))
    }

    /// A look with a person's own shape draws the engine's still of it, never the catalog shape's.
    func testALookWithItsOwnShapeDrawsIt() throws {
        let look = try JSONDecoder().decode(MascotLook.self, from: Data(Self.pasted.utf8))
        XCTAssertNil(ShapeEngineStill.bakedShape(.pumpkin, avatarDef: look.avatarDef))
        let own = try XCTUnwrap(ShapeEngineStill.of(.pumpkin, avatarDef: look.avatarDef))
        let catalog = try XCTUnwrap(ShapeEngineStill.of(.pumpkin))
        XCTAssertNotEqual(own.outlines, catalog.outlines)
        XCTAssertFalse(own.frame(.idle).parts.isEmpty)
        let flat = try XCTUnwrap(ShapeEngineStill.of(.pumpkin, avatarDef: look.avatarDef, flat: true))
        XCTAssertNotEqual(flat.outlines, own.outlines)
        // a saved copy of an object preset still draws that preset's baked still
        let cup = try XCTUnwrap(ShapeAvatarPresets.byShape(.cup))
        XCTAssertEqual(ShapeEngineStill.bakedShape(.circle, avatarDef: .own(cup)), .cup)
    }
}
