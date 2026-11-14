import CoreGraphics
import Foundation
import XCTest
@testable import CompanionCore

/// The shapes in volume on the phone are the desktop's: Fixtures/shape-volume.json
/// holds what shape-volume.ts and shape-motion.ts compute (src/components/
/// ios-mascot-export.test.ts): the slices' and the face's matrices for every
/// detail, three poses and four depths; one drawing (drawShape) per shape and
/// pose, with its bent outline, its eyes in the face's space, its stem and
/// its matrices; the inks, the ground, and each mood's poses over twelve
/// seconds with a mood change, a pointer and a tap.
final class ShapeVolumeTests: XCTestCase {
    private struct Fixture: Decodable {
        struct Pose: Decodable { let yaw, pitch, roll, scale, lift: Double }
        struct Matrices: Decodable {
            let detail, pose: String
            let depth: Double
            let slices: [String]
            let face: String
        }
        struct Motion3: Decodable { let x, y, rot, sx, sy: Double }
        struct Warp: Decodable {
            let shape, expression, pose, style: String
            let open: Double
            let motion: Motion3
            let body, eyes, flatEyes: String
            let stem: String?
            let slices: [String]
            let face, motionTransform: String
        }
        struct Ink: Decodable { let hex, fill, side, eyes: String; let edge: String? }
        struct Step: Decodable { let t: Double; let pose: Pose }
        struct Motion: Decodable { let mood: String; let seed: Double; let poses: [Step] }
        let matrices: [Matrices]
        let warps: [Warp]
        let ground: [String: Double]
        let inks: [Ink]
        let upright: Pose
        let motion: [Motion]
    }

    static let poses: [String: ShapePose] = [
        "rest": ShapeVolumeData.rest,
        "turned": ShapePose(yaw: 28, pitch: 18, roll: 8, scale: ShapeVolumeData.rest.scale, lift: ShapeVolumeData.rest.lift),
        "away": ShapePose(yaw: -22, pitch: -6, roll: -14, scale: 0.79, lift: -3.1),
    ]

    private func fixture() throws -> Fixture {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "shape-volume", withExtension: "json", subdirectory: "Fixtures"))
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }

    private static let number = try! NSRegularExpression(pattern: #"-?[0-9]*\.?[0-9]+(?:e[-+]?[0-9]+)?"#)

    static func numbers(_ text: String) -> [Double] {
        let range = NSRange(text.startIndex..., in: text)
        return number.matches(in: text, range: range).compactMap { Range($0.range, in: text).flatMap { Double(text[$0]) } }
    }

    /// An SVG `matrix(a b c d e f)` and a transform agree to four decimals (the desktop writes four).
    private func assertMatrix(_ t: CGAffineTransform, _ svg: String, _ message: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(svg.hasPrefix("matrix("), "\(message): \(svg)", file: file, line: line)
        let want = Self.numbers(svg)
        let got = [t.a, t.b, t.c, t.d, t.tx, t.ty].map(Double.init)
        XCTAssertEqual(got.count, want.count, message, file: file, line: line)
        for (a, b) in zip(got, want) { XCTAssertEqual(a, b, accuracy: 1e-4, message, file: file, line: line) }
    }

    /// Two paths agree: the same commands, every number within `tolerance` (the two platforms' sine and cosine may land a rounding step apart).
    private func assertPath(_ swift: String, _ desktop: String, tolerance: Double = 0.011, _ message: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(swift.filter(\.isLetter), desktop.filter(\.isLetter), "\(message): commands", file: file, line: line)
        let a = Self.numbers(swift), b = Self.numbers(desktop)
        XCTAssertEqual(a.count, b.count, "\(message): number count", file: file, line: line)
        guard a.count == b.count else { return }
        let worst = zip(a, b).map { abs($0 - $1) }.max() ?? 0
        XCTAssertLessThanOrEqual(worst, tolerance, "\(message): largest difference", file: file, line: line)
    }

    func testTheSlicesAndFaceMatricesAreTheDesktops() throws {
        let fixture = try fixture()
        XCTAssertEqual(fixture.matrices.count, 3 * 3 * 4)
        for entry in fixture.matrices {
            let detail = try XCTUnwrap(ShapeVolumeDetail(rawValue: entry.detail))
            let pose = try XCTUnwrap(Self.poses[entry.pose])
            let m = ShapeVolume.matrices(detail, pose, depth: entry.depth)
            let name = "\(entry.detail) \(entry.pose) \(entry.depth)"
            XCTAssertEqual(m.slices.count, entry.slices.count, name)
            for (t, svg) in zip(m.slices, entry.slices) { assertMatrix(t, svg, "\(name) slice") }
            assertMatrix(m.face, entry.face, "\(name) face")
            assertMatrix(ShapeVolume.face(pose, depth: entry.depth), entry.face, "\(name) face alone")
        }
    }

    func testTheDrawingIsTheDesktops() throws {
        let fixture = try fixture()
        XCTAssertEqual(fixture.warps.count, MascotShape.bodies.count * 3)
        for entry in fixture.warps {
            let shape = try XCTUnwrap(MascotShape(rawValue: entry.shape))
            let face = try XCTUnwrap(ShapeExpression(rawValue: entry.expression))
            let pose = try XCTUnwrap(Self.poses[entry.pose])
            let style = try XCTUnwrap(ShapeEyeStyle(rawValue: entry.style))
            let still = ShapeFrames.still(shape, face, color: "#000000", open: entry.open)
            var frame = still
            let m = entry.motion
            frame.x = m.x / ShapeEngineData.bodyUnit
            frame.y = m.y / ShapeEngineData.bodyUnit
            frame.rot = m.rot
            frame.sx = m.sx
            frame.sy = m.sy
            let name = "\(entry.shape) \(entry.expression) \(entry.pose) \(entry.style)"
            let drawing = try XCTUnwrap(ShapeVolume.drawShape(frame, pose, detail: .full, style: style, bend: true), name)
            assertPath(drawing.outline.d, entry.body, "\(name) body")
            assertPath(ShapeVolume.d(drawing.eyes), entry.eyes, "\(name) eyes")
            XCTAssertEqual(drawing.stem == nil, entry.stem == nil, "\(name) stem")
            if let stem = drawing.stem, let wanted = entry.stem { assertPath(stem.outline.d, wanted, "\(name) stem") }
            XCTAssertEqual(drawing.slices.count, entry.slices.count, "\(name) slices")
            for (t, svg) in zip(drawing.slices, entry.slices) { assertMatrix(t, svg, "\(name) slice") }
            assertMatrix(drawing.face, entry.face, "\(name) face")
            // the desktop's fixture spreads the motion numbers over the still frame and keeps its transform
            // string (ShapeDrawing.motion is frame.transform): the still's string is what it wrote
            assertPath(still.transform, entry.motionTransform, tolerance: 0.003, "\(name) motion")
            let motion = ShapeVolume.motion((m.x, m.y, m.rot, m.sx, m.sy))
            for (a, b) in zip([drawing.motion.a, drawing.motion.b, drawing.motion.c, drawing.motion.d, drawing.motion.tx, drawing.motion.ty],
                              [motion.a, motion.b, motion.c, motion.d, motion.tx, motion.ty]) {
                XCTAssertEqual(Double(a), Double(b), accuracy: 1e-9, "\(name) motion matrix", file: #filePath, line: #line)
            }
            // the flat skins' eyes: the engine's capsules, or an oval or an arch on each one's box
            let eyes = frame.eyes.compactMap { ShapeOutline(points: $0) }
            assertPath(ShapeVolume.d(ShapeVolume.styledEyes(eyes, style)), entry.flatEyes, tolerance: 0.06, "\(name) flat eyes")
        }
    }

    func testTheInksTheGroundAndTheUprightPoseAreTheDesktops() throws {
        let fixture = try fixture()
        for ink in fixture.inks {
            let paint = ShapeVolume.ink(ink.hex)
            XCTAssertEqual(paint.fill, ink.fill.lowercased(), ink.hex)
            XCTAssertEqual(paint.side, ink.side.lowercased(), ink.hex)
            XCTAssertEqual(paint.edge, ink.edge, ink.hex)
            XCTAssertEqual(paint.eyes, ink.eyes, ink.hex)
        }
        XCTAssertEqual(Set(fixture.ground.keys), Set(MascotShape.bodies.map(\.rawValue)))
        for (shape, lift) in fixture.ground {
            XCTAssertEqual(ShapeVolume.groundLift(try XCTUnwrap(MascotShape(rawValue: shape))), lift, accuracy: 1e-9, shape)
        }
        let upright = ShapeVolume.upright(try XCTUnwrap(Self.poses["away"]))
        XCTAssertEqual(upright.yaw, fixture.upright.yaw)
        XCTAssertEqual(upright.pitch, fixture.upright.pitch)
        XCTAssertEqual(upright.roll, fixture.upright.roll)
        XCTAssertEqual(upright.scale, fixture.upright.scale)
        XCTAssertEqual(upright.lift, fixture.upright.lift)
    }

    func testEveryMoodMovesAsOnTheDesktopThroughAMoodChangeAPointerAndATap() throws {
        let fixture = try fixture()
        XCTAssertEqual(Set(fixture.motion.map(\.mood)), Set(ShapeMotionMood.allCases.map(\.rawValue)))
        for entry in fixture.motion {
            let mood = try XCTUnwrap(ShapeMotionMood(rawValue: entry.mood))
            let run = ShapeMotion(mood, seed: entry.seed, start: 0)
            for (k, step) in entry.poses.enumerated() {
                if k == 20 { run.setMood(mood == .working ? .idle : .working, now: step.t) }
                if k == 30 { run.pointer(CGPoint(x: 0.8, y: -0.5)) }
                if k == 40 { run.pointer(nil) }
                if k == 45 { run.pokeAt(step.t) }
                let pose = run.pose(step.t)
                let name = "\(entry.mood) t=\(step.t)"
                XCTAssertEqual(pose.yaw, step.pose.yaw, accuracy: 1e-6, "\(name) yaw")
                XCTAssertEqual(pose.pitch, step.pose.pitch, accuracy: 1e-6, "\(name) pitch")
                XCTAssertEqual(pose.roll, step.pose.roll, accuracy: 1e-6, "\(name) roll")
                XCTAssertEqual(pose.scale, step.pose.scale, accuracy: 1e-9, "\(name) scale")
                XCTAssertEqual(pose.lift, step.pose.lift, accuracy: 1e-6, "\(name) lift")
            }
        }
    }

    func testEveryShapeMoodHasAMotionAndEyes() {
        for mood in ShapeMood.allCases {
            XCTAssertNotNil(ShapeVolumeData.moodMotion[mood], mood.rawValue)
            XCTAssertNotNil(ShapeVolumeData.moodEyes[mood], mood.rawValue)
        }
        XCTAssertEqual(ShapeMood.working.motion, .working)
        XCTAssertEqual(ShapeMood.happy.motion, .done)
        XCTAssertEqual(ShapeVolume.eyeStyle(.streaming), .oval)
        XCTAssertEqual(ShapeVolume.eyeStyle(.happy), .arc)
        XCTAssertEqual(ShapeVolume.eyeStyle(.idle), .capsule)
    }

    /// The body's thickness (`bodyDepth`) still thins the slices of a
    /// naturally thin body (a tube, a teardrop's tip), measured on its own radii.
    func testAThinBodyThinsItsSlices() {
        for shape in MascotShape.bodies {
            let thinnest = ShapeEngineData.radii[shape]!.min()!
            XCTAssertEqual(ShapeFrames.still(shape, .neutral).depth, min(1, thinnest / ShapeEngineData.depthFull), accuracy: 1e-12, shape.rawValue)
        }
        XCTAssertEqual(ShapeFrames.bodyDepth([ShapeEngineData.depthFull / 2, ShapeEngineData.depthFull / 2]), 0.5)
        XCTAssertEqual(ShapeFrames.bodyDepth([2, 2]), 1)
    }
}
