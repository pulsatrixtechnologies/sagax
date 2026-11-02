import CoreGraphics
import XCTest
@testable import CompanionCore

/// Object mascots keep their eyes at their own anchor (port of desktop
/// 081cef893, 2026-11-01). A path body is fitted against its own outline with
/// the eye margin, its width is read across the face row, and eyes too close
/// shrink before moving. The polar bodies are untouched.
final class ShapeObjectEyeAnchorTests: XCTestCase {
    private static let objects: [MascotShape] = [.pad, .cup, .bulb, .say, .sprout, .tin, .tome, .ship]

    /// `stillFrame` on the desktop for each object preset, neutral face
    /// (x, y, w, h of each eye, box units), after 081cef893.
    private static let desktop: [MascotShape: [[Double]]] = [
        .pad: [[38.033, 45.423, 9.2, 18.768], [61.967, 45.423, 9.2, 18.768]],
        .cup: [[33.4, 48.109, 9.2, 18.768], [54.861, 48.109, 9.2, 18.768]],
        .bulb: [[38.474, 35.423, 9.2, 18.768], [61.526, 35.423, 9.2, 18.768]],
        .say: [[36.817, 39.423, 9.2, 18.768], [63.183, 39.423, 9.2, 18.768]],
        .sprout: [[40.382, 73.423, 9.2, 18.768], [59.618, 73.423, 9.2, 18.768]],
        .tin: [[44.008, 51.423, 7.452, 15.202], [55.992, 51.423, 7.452, 15.202]],
        .tome: [[47.116, 47.423, 9.2, 18.768], [72.884, 47.423, 9.2, 18.768]],
        .ship: [[44.008, 37.423, 7.452, 15.202], [55.992, 37.423, 7.452, 15.202]],
    ]

    private func def(_ shape: MascotShape) throws -> ShapeAvatarDef {
        try XCTUnwrap(ShapeAvatarPresets.all.first { $0.id == shape.rawValue }, shape.rawValue)
    }

    func testObjectEyesMatchTheDesktop() throws {
        for shape in Self.objects {
            let eyes = ShapeFrames.still(shape, .neutral, avatarDef: try def(shape)).eyeShapes
            let want = try XCTUnwrap(Self.desktop[shape])
            XCTAssertEqual(eyes.count, 2, shape.rawValue)
            for (eye, w) in zip(eyes, want) {
                XCTAssertEqual(eye.x, w[0], accuracy: 0.002, "\(shape.rawValue) x")
                XCTAssertEqual(eye.y, w[1], accuracy: 0.002, "\(shape.rawValue) y")
                XCTAssertEqual(eye.w, w[2], accuracy: 0.002, "\(shape.rawValue) w")
                XCTAssertEqual(eye.h, w[3], accuracy: 0.002, "\(shape.rawValue) h")
            }
        }
    }

    /// The sprout's eyes used to shrink to a dot: now full size, apart, and inside its body.
    func testSproutEyesAreVisibleAndInsideTheBody() throws {
        let sprout = try def(.sprout)
        let frame = ShapeFrames.still(.sprout, .neutral, avatarDef: sprout)
        let eyes = frame.eyeShapes.sorted { $0.x < $1.x }
        XCTAssertEqual(eyes.count, 2)
        guard eyes.count == 2 else { return }
        for eye in eyes {
            XCTAssertGreaterThan(eye.w, 6, "a real eye, not a dot")
            XCTAssertGreaterThan(eye.h, eye.w * 1.4, "a pill, taller than wide")
        }
        XCTAssertGreaterThan(eyes[1].x - eyes[1].w / 2, eyes[0].x + eyes[0].w / 2, "the eyes never touch")
        XCTAssertEqual(eyes[0].y, eyes[1].y, accuracy: 0.01, "one level pair")
        let body = ShapeAvatarOutline.liveOutline(from: sprout).points
        for eye in frame.eyes {
            for p in eye {
                XCTAssertTrue(ShapeAvatarOutline.pointInsideOutline(body, p), "sprout eye point \(p) inside the body")
            }
        }
    }

    /// Every object's eyes sit wholly inside its own outline.
    func testEveryObjectEyeIsInsideItsOutline() throws {
        for shape in Self.objects {
            let d = try def(shape)
            let frame = ShapeFrames.still(shape, .neutral, avatarDef: d)
            let body = ShapeAvatarOutline.liveOutline(from: d).points
            XCTAssertEqual(frame.eyes.count, 2, shape.rawValue)
            for eye in frame.eyes {
                XCTAssertTrue(eye.allSatisfy { ShapeAvatarOutline.pointInsideOutline(body, $0) }, "\(shape.rawValue): eye inside")
            }
        }
    }

    /// The polar (round) bodies are identical to before the fix:
    /// Fixtures/shape-polar-eyes.json holds every polar shape and face from the solver before 2026-11-01.
    func testPolarShapesAreUnchanged() throws {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "shape-polar-eyes", withExtension: "json", subdirectory: "Fixtures"))
        let before = try JSONDecoder().decode([String: [[Double]]].self, from: Data(contentsOf: url))
        var seen = 0
        for shape in MascotShape.allCases where !Self.objects.contains(shape) {
            for expression in ShapeExpression.allCases {
                let key = "\(shape.rawValue)|\(expression.rawValue)"
                let want = try XCTUnwrap(before[key], key)
                let eyes = ShapeFrames.still(shape, expression).eyeShapes.map { [$0.x, $0.y, $0.w, $0.h, $0.tilt] }
                XCTAssertEqual(eyes, want, key)
                seen += 1
            }
        }
        XCTAssertEqual(seen, before.count)
    }
}
