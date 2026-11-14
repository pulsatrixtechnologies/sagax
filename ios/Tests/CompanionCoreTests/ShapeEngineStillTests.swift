// The phone draws every shape with the open-bot-avatar engine's own frames
// (#4159), the stills the desktop draws: src/components/shape-avatar.ts and
// ShapeMascot.tsx. ShapeEngineStillData is generated from the desktop's
// baked files (ios-mascot-export.test.ts); these tests read it back.
import CoreGraphics
import XCTest
@testable import CompanionCore

final class ShapeEngineStillTests: XCTestCase {
    /// The repository's root, from this file (ios/Tests/CompanionCoreTests).
    private let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

    func testEveryShapeOfTheDesktopIsAShapeOfThePhoneInTheSameOrder() {
        // MASCOT_SHAPES: ours, then the engine's gallery; a desktop shape the phone did not know turned the whole look into the owl
        XCTAssertEqual(MascotShape.allCases.map(\.rawValue), ShapeEngineStillData.order)
        XCTAssertEqual(MascotShape.gallery.map(\.rawValue), ["brain", "bull", "bunny", "camera", "magnifier", "paint-brush", "palette", "witch-hat", "barbell", "watering-can"])
        XCTAssertFalse(MascotShape.paintBrush.isBody)
        XCTAssertTrue(MascotShape.ship.isBody)
    }

    func testAGalleryShapeKeepsTheLookOnThePhone() throws {
        for shape in MascotShape.gallery {
            let json = #"{"character":"shape","shape":"\#(shape.rawValue)","skins":{"shape":"gold"}}"#
            let look = try JSONDecoder().decode(MascotLook.self, from: Data(json.utf8))
            XCTAssertEqual(look.character, .shape, shape.rawValue)
            XCTAssertEqual(look.shape, shape)
            XCTAssertEqual(look.skins?.shape, .gold)
            let data = try JSONEncoder().encode(look)
            XCTAssertTrue(String(decoding: data, as: UTF8.self).contains(#""\#(shape.rawValue)""#))
        }
    }

    func testEveryShapeHasTheEnginesStillInEachMoodAndFlat() {
        for shape in MascotShape.allCases {
            for flat in [false, true] {
                guard let still = ShapeEngineStill.of(shape, flat: flat) else { return XCTFail("\(shape.rawValue) flat \(flat)") }
                XCTAssertFalse(still.outlines.isEmpty, shape.rawValue)
                for mood in ShapeEngineMood.allCases {
                    let frame = still.frame(mood)
                    var eyes = 0
                    for part in frame.parts {
                        switch part {
                        case let .slice(index, _): XCTAssertTrue(still.outlines.indices.contains(index), shape.rawValue)
                        case .eye: eyes += 1
                        }
                    }
                    XCTAssertEqual(eyes, 2, "\(shape.rawValue) \(mood) flat \(flat)")
                    for outline in still.outlines {
                        let box = SVGPath.cached(outline.d).boundingBoxOfPath
                        XCTAssertGreaterThan(box.width, 1, shape.rawValue)
                    }
                }
            }
        }
    }

    func testTheStillIsTheDesktopsFileAsItIs() throws {
        // the very file the desktop loads for the star and for a gallery shape
        for shape in [MascotShape.star, .paintBrush, .triangle] {
            let url = root.appendingPathComponent("src/components/shape-stills/\(shape.rawValue).json")
            let file = try String(contentsOf: url, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
            XCTAssertEqual(ShapeEngineStillData.stills[shape.rawValue], file, shape.rawValue)
            let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(file.utf8)) as? [String: Any])
            let paths = try XCTUnwrap(object["p"] as? [[Any]])
            XCTAssertEqual(ShapeEngineStill.of(shape)?.outlines.map(\.d), paths.map { $0[0] as! String })
        }
    }

    func testTheMoodsFollowTheBotsStateAsOnTheDesktop() {
        // engineMood: at work it thinks, done it is happy, else at rest
        XCTAssertEqual(ShapeMood.working.engine, .thinking)
        XCTAssertEqual(ShapeMood.thinking.engine, .thinking)
        XCTAssertEqual(ShapeMood.streaming.engine, .thinking)
        XCTAssertEqual(ShapeMood.blocked.engine, .thinking)
        XCTAssertEqual(ShapeMood.happy.engine, .happy)
        XCTAssertEqual(ShapeMood.idle.engine, .idle)
        XCTAssertEqual(ShapeMood.sleeping.engine, .idle)
        // happy draws the engine's arcs, at rest its pills
        let star = try! XCTUnwrap(ShapeEngineStill.of(.star))
        func marks(_ mood: ShapeEngineMood) -> [ShapeEngineStill.Eye] {
            star.frame(mood).parts.compactMap { if case let .eye(mark, _) = $0 { return mark }; return nil }
        }
        XCTAssertTrue(marks(.happy).allSatisfy { if case .arc = $0 { return true }; return false })
        XCTAssertTrue(marks(.idle).allSatisfy { if case .pill = $0 { return true }; return false })
    }

    func testASkinPaintsTheLargestCrossSection() throws {
        let still = try XCTUnwrap(ShapeEngineStill.of(.circle))
        let frame = still.frame(.idle)
        let face = try XCTUnwrap(still.face(of: frame))
        XCTAssertEqual(face.outline.area, still.outlines.map(\.area).max())
        // the Outline skin's body is flat: one outline, no turned cross-sections
        let flat = try XCTUnwrap(ShapeEngineStill.of(.circle, flat: true))
        XCTAssertEqual(flat.outlines.count, 1)
    }

    func testAMoveClosesAPillEyeAroundItsMiddleAndKeepsAnArc() {
        let pill = ShapeEngineStill.Eye.pill(x: 10, y: 20, width: 4, height: 10, radius: 2)
        XCTAssertEqual(pill.opened(0.5), .pill(x: 10, y: 22.5, width: 4, height: 5, radius: 2))
        guard case let .pill(_, _, _, height, _) = pill.opened(0.01) else { return XCTFail("a pill stays a pill") }
        XCTAssertEqual(height, 0.6, "never shut to nothing")
        let arc = ShapeEngineStill.Eye.arc(d: "M0 0Q1 1 2 0", strokeWidth: 4)
        XCTAssertEqual(arc.opened(0.2), arc)
    }
}
