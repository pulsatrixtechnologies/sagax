import CoreGraphics
import Foundation
import XCTest
@testable import CompanionCore

/// Every shape holds together and keeps its face (2026-10-28, one drawing):
/// the Swift twin of src/components/shape-set.regression.test.ts. Measured on
/// the drawing itself (`ShapeVolume.drawShape`: what ShapeMascotView puts on
/// screen), in the drawing's own space, for every shape of the set, every
/// face, a blink, the gaze's four corners, and each of the fourteen moves at
/// five moments, on a resting and on a rolled, squashed body:
/// - the body is one closed outline that never shrinks to a dot or a bar;
/// - the two eyes sit inside the face, are the same capsule, level, upright
///   at rest, and come back to rest after every move;
/// - every slice of the body touches the face (its middle and its outline at
///   half size sit in the face), so no piece ever stands beside the body;
/// - the pumpkin's stem stands in the body.
final class ShapeSetRegressionTests: XCTestCase {
    private static let color = "#3b82f6"
    private static let details: [ShapeVolumeDetail] = [.tiny, .small, .full]
    /// A body rolled hard and squashed (a move's sway at its widest, a poke): the pose, and the motion in box units.
    private static func rolled(_ shape: MascotShape) -> ShapePose {
        ShapeVolume.grounded(ShapePose(yaw: 40, pitch: -22, roll: 12, scale: ShapeVolumeData.rest.scale, lift: ShapeVolumeData.rest.lift), shape)
    }

    private static let squashed = (x: 3.0, y: -2.0, rot: 18.0, sx: 1.08, sy: 0.9)
    private static func restPose(_ shape: MascotShape) -> ShapePose { ShapeVolume.grounded(ShapeVolumeData.rest, shape) }

    /// The frame with a motion of its own (box units).
    private static func moved(_ frame: ShapeFrame, _ m: (x: Double, y: Double, rot: Double, sx: Double, sy: Double)) -> ShapeFrame {
        var out = frame
        out.x = m.x / ShapeEngineData.bodyUnit
        out.y = m.y / ShapeEngineData.bodyUnit
        out.rot = m.rot
        out.sx = m.sx
        out.sy = m.sy
        return out
    }

    private static func inside(_ poly: [CGPoint], _ p: CGPoint) -> Bool {
        var hit = false
        var j = poly.count - 1
        for i in poly.indices {
            let a = poly[i], b = poly[j]
            if (a.y > p.y) != (b.y > p.y), p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x { hit.toggle() }
            j = i
        }
        return hit
    }

    /// The bounding box of an eye's points.
    private static func box(_ points: [CGPoint]) -> (x: Double, y: Double, w: Double, h: Double) {
        let xs = points.map { Double($0.x) }, ys = points.map { Double($0.y) }
        let x0 = xs.min()!, x1 = xs.max()!, y0 = ys.min()!, y1 = ys.max()!
        return ((x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0)
    }

    /// One drawing checked whole: outline, eyes, slices, stem. The face's
    /// outline is taken in the drawing's space (the body's motion, then the
    /// face's matrix) and everything else is mapped there the same way.
    @discardableResult
    private func expectHolds(_ frame: ShapeFrame, _ pose: ShapePose, _ label: String, detail: ShapeVolumeDetail = .full, bend: Bool = true,
                             style: ShapeEyeStyle = .capsule, file: StaticString = #filePath, line: UInt = #line) -> ShapeDrawing? {
        guard let drawing = ShapeVolume.drawShape(frame, pose, detail: detail, style: style, bend: bend) else {
            XCTFail("\(label): no drawing", file: file, line: line)
            return nil
        }
        // the drawing's face matrix is the pose's (the motion is the group above it)
        let expected = ShapeVolume.face(pose, depth: frame.depth)
        for (a, b) in zip([drawing.face.a, drawing.face.b, drawing.face.c, drawing.face.d, drawing.face.tx, drawing.face.ty],
                          [expected.a, expected.b, expected.c, expected.d, expected.tx, expected.ty]) {
            XCTAssertEqual(Double(a), Double(b), accuracy: 1e-3, "\(label) face matrix", file: file, line: line)
        }
        let T = drawing.face.concatenating(drawing.motion)
        let outline = drawing.outline.onCurve
        XCTAssertGreaterThan(outline.count, 3, "\(label) outline", file: file, line: line)
        let poly = outline.map { $0.applying(T) }
        var faults: [String] = []
        // the eyes: two, inside the face
        XCTAssertEqual(drawing.eyes.count, 2, "\(label) eyes", file: file, line: line)
        for eye in drawing.eyes {
            for p in ShapeVolume.eyePoints(eye) where !Self.inside(poly, p.applying(T)) {
                faults.append("eye point \(p.x),\(p.y) outside the face")
            }
        }
        // the slices touch the face: each one's middle and its half-size outline sit in the face
        for (i, t) in drawing.slices.enumerated() {
            let S = t.concatenating(drawing.motion)
            if !Self.inside(poly, CGPoint(x: 50, y: 50).applying(S)) { faults.append("slice \(i) middle outside the face") }
            for p in outline {
                let q = CGPoint(x: 50 + (p.x - 50) * 0.5, y: 50 + (p.y - 50) * 0.5).applying(S)
                if !Self.inside(poly, q) {
                    faults.append("slice \(i) outside the face at \(p.x),\(p.y)")
                    break
                }
            }
        }
        XCTAssertEqual(faults, [], label, file: file, line: line)
        // the stem's foot in the body, its tip above it
        if let stem = drawing.stem {
            let points = stem.outline.onCurve
            XCTAssertTrue(points.contains { Self.inside(outline, $0) }, "\(label) stem foot in the body", file: file, line: line)
            XCTAssertLessThan(points.map(\.y).min()!, outline.map(\.y).min()!, "\(label) stem tip above", file: file, line: line)
        }
        return drawing
    }

    /// The two eyes as one pair: the same capsule, level, upright at rest.
    private func expectPair(_ eyes: [ShapeStyledEye], _ label: String, rest: Bool, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(eyes.count, 2, label, file: file, line: line)
        guard eyes.count == 2 else { return }
        let l = Self.box(ShapeVolume.eyePoints(eyes[0])), r = Self.box(ShapeVolume.eyePoints(eyes[1]))
        XCTAssertLessThan(abs(l.w - r.w), 0.02, "\(label) same width", file: file, line: line)
        XCTAssertLessThan(abs(l.h - r.h), 0.02, "\(label) same height", file: file, line: line)
        XCTAssertLessThan(abs(l.y - r.y), 0.02, "\(label) level", file: file, line: line)
        XCTAssertGreaterThan(r.x - l.x, (l.w + r.w) / 2, "\(label) apart", file: file, line: line)
        if rest { XCTAssertGreaterThan(l.h, l.w * 1.4, "\(label) taller than wide", file: file, line: line) }
    }

    /// A moment with no blink on this seed, after `from` s.
    private func openMoment(_ seed: Double, _ from: Double) throws -> Double {
        let starts = ShapeIdle.blinkSchedule(seed, until: from + 30)
        var t = from
        while t < from + 30 {
            if ShapeIdle.blinkOpen(t, starts) == 1, ShapeIdle.blinkOpen(t - 0.3, starts) == 1 { return t }
            t += 0.05
        }
        throw XCTSkip("no open moment")
    }

    func testAtRestInEveryFaceBlinkingAndLookingAroundOnARestingAndARolledSquashedBody() {
        for shape in MascotShape.bodies {
            var frames: [(String, ShapeFrame)] = ShapeExpression.allCases.map { ($0.rawValue, ShapeFrames.still(shape, $0, color: Self.color)) }
            frames.append(("blink", ShapeFrames.still(shape, .neutral, color: Self.color, open: 0.06)))
            for (x, y) in [(1.0, 1.0), (-1.0, -1.0), (1.0, -1.0), (-1.0, 1.0)] {
                frames.append(("look \(x),\(y)", ShapeFrames.gaze(shape, .neutral, color: Self.color, nx: x, ny: y)))
            }
            for (name, frame) in frames {
                XCTAssertEqual(frame.body.count, ShapeEngineData.radiiCount, "\(shape) \(name)")
                // every face at full detail; the small and tiny slices (fewer of them) on the neutral face
                for detail in name == "neutral" ? Self.details : [.full] {
                    expectHolds(frame, Self.restPose(shape), "\(shape) \(name) rest \(detail)", detail: detail)
                    expectHolds(Self.moved(frame, Self.squashed), Self.rolled(shape), "\(shape) \(name) rolled \(detail)", detail: detail)
                }
            }
            let still = ShapeFrames.still(shape, .neutral, color: Self.color)
            expectPair(ShapeVolume.drawShape(still, Self.restPose(shape), detail: .full)?.eyes ?? [], "\(shape) rest", rest: true)
            expectPair(ShapeVolume.drawShape(Self.moved(still, Self.squashed), Self.rolled(shape), detail: .full)?.eyes ?? [], "\(shape) rolled", rest: true)
            let looking = ShapeFrames.gaze(shape, .neutral, color: Self.color, nx: 0.8, ny: -0.7)
            expectPair(ShapeVolume.drawShape(looking, Self.rolled(shape), detail: .full)?.eyes ?? [], "\(shape) looking", rest: true)
        }
    }

    func testThroughEveryMoveAtFiveMomentsTheBodyStaysOneWholeOutlineWithItsTwoEyesAndComesBackToRest() throws {
        let seed = 7.0
        for shape in MascotShape.bodies {
            for move in ShapeMove.allCases {
                let state = ShapeEngineState(shape: shape, expression: .neutral, color: Self.color)
                let run = ShapeEngine(state, now: 0, seed: seed)
                let calm = ShapeEngine(state, now: 0, seed: seed)
                let timing = ShapeEngineData.moveTiming[move]!
                run.play(move, now: 0.5)
                let moments = [timing.morph / 2, timing.morph + 0.05, timing.duration / 2, timing.duration, timing.duration + timing.morph / 2].map { 0.5 + $0 }
                var at = 0.0
                for t in moments {
                    while at < t {
                        _ = run.frame(at)
                        _ = calm.frame(at)
                        at += 0.1
                    }
                    let frame = run.frame(t)
                    let nearest = ShapeOutline(points: frame.body)!.allPoints.map { hypot(Double($0.x) - 50, Double($0.y) - 50) }.min()!
                    XCTAssertGreaterThan(nearest, 14, "\(shape) \(move) \(t) body never a dot")
                    for pose in [Self.restPose(shape), Self.rolled(shape)] {
                        expectHolds(frame, pose, "\(shape) \(move) \(t)", detail: .full, style: ShapeVolume.eyeStyle(.idle))
                        expectHolds(frame, pose, "\(shape) \(move) \(t) ovals", detail: .full, style: .oval)
                        expectHolds(frame, pose, "\(shape) \(move) \(t) arcs", detail: .small, style: .arc)
                    }
                    XCTAssertEqual(ShapeVolume.drawShape(frame, Self.restPose(shape), detail: .full)?.eyes.count, 2, "\(shape) \(move) \(t) two eyes")
                }
                let settled = try openMoment(seed, 0.5 + timing.duration + ShapeEngineData.morphSeconds + 0.2)
                while at < settled {
                    _ = run.frame(at)
                    _ = calm.frame(at)
                    at += 0.1
                }
                let after = run.frame(settled), quiet = calm.frame(settled)
                XCTAssertEqual(after.eyeShapes, quiet.eyeShapes, "\(shape) \(move) back to rest")
                XCTAssertEqual(after.bodyD, quiet.bodyD, "\(shape) \(move) body back to rest")
                expectPair(ShapeVolume.drawShape(after, Self.restPose(shape), detail: .full)?.eyes ?? [], "\(shape) after \(move)", rest: true)
            }
        }
    }

    /// The web's "in every skin" case, on the drawing: a flat skin (anything
    /// but plain) draws the face without the bend, and the eyes still sit
    /// inside the outline it draws.
    func testInEverySkinTheEyesSitInsideTheOutlineTheSkinDraws() {
        for shape in MascotShape.bodies {
            let frame = ShapeFrames.still(shape, .neutral, color: Self.color)
            for skin in ShapeSkin.allCases {
                let paint = ShapeArt.paint(skin, hex: Self.color)
                XCTAssertFalse(paint.fill.isEmpty, "\(shape) \(skin) paint")
                expectHolds(frame, Self.restPose(shape), "\(shape) \(skin)", detail: .full, bend: skin == .plain)
            }
        }
    }

    func testOnlyThePumpkinWearsAStem() {
        for shape in MascotShape.bodies {
            let frame = ShapeFrames.still(shape, .neutral, color: Self.color)
            let drawing = ShapeVolume.drawShape(frame, Self.restPose(shape), detail: .full)
            XCTAssertEqual(frame.stem != nil, shape == .pumpkin, "\(shape) frame stem")
            XCTAssertEqual(drawing?.stem != nil, shape == .pumpkin, "\(shape) drawing stem")
        }
    }

    func testEveryShapeHasItsArtFromTheGeometry() {
        for shape in MascotShape.bodies {
            let art = ShapeArt.art[shape]
            XCTAssertNotNil(art, shape.rawValue)
            guard let art else { continue }
            XCTAssertTrue(art.d.hasPrefix("M") && art.d.hasSuffix("Z"), shape.rawValue)
            XCTAssertEqual(art.d, ShapeFrames.still(shape, .neutral).bodyD, "\(shape) outline is the engine's resting body")
            let face = ShapeGeometryData.faceAnchor[shape]!
            XCTAssertEqual(Double(art.eyes.x), 50 + face.x * ShapeEngineData.bodyUnit, accuracy: 1e-9, shape.rawValue)
            XCTAssertEqual(Double(art.eyes.y), 50 + face.y * ShapeEngineData.bodyUnit, accuracy: 1e-9, shape.rawValue)
        }
    }
}
