// Outline math and object path presets (v2.1). Twin of shared/shape-avatar-outline.test.ts.
import CoreGraphics
import XCTest
@testable import CompanionCore

final class ShapeAvatarOutlineTests: XCTestCase {
    func testFlattensCubicAndLineCommandsIntoClosedRing() {
        let rings = ShapeAvatarOutline.flattenPath("M10 10 L90 10 L90 90 L10 90 Z")
        XCTAssertEqual(rings.count, 1)
        XCTAssertGreaterThanOrEqual(rings[0].count, 4)
        XCTAssertTrue(ShapeAvatarOutline.pointInsideOutline(rings[0], x: 50, y: 50))
        XCTAssertFalse(ShapeAvatarOutline.pointInsideOutline(rings[0], x: 2, y: 2))
    }

    func testResamplesAndBlendsWithoutChangingLength() {
        let a = ShapeAvatarOutline.resampleClosed([
            CGPoint(x: 0, y: 0), CGPoint(x: 100, y: 0), CGPoint(x: 100, y: 100), CGPoint(x: 0, y: 100),
        ], count: 64)
        let b = ShapeAvatarOutline.resampleClosed([
            CGPoint(x: 20, y: 20), CGPoint(x: 80, y: 20), CGPoint(x: 80, y: 80), CGPoint(x: 20, y: 80),
        ], count: 64)
        XCTAssertEqual(a.count, 64)
        XCTAssertEqual(b.count, 64)
        let mid = ShapeAvatarOutline.blendOutlines(a, b, 0.5)
        XCTAssertEqual(mid.count, 64)
        XCTAssertGreaterThan(mid[0].x, 0)
    }

    func testEveryObjectPresetValidPathBodiedEyesInside() {
        for preset in ShapeAvatarPresets.all {
            switch ShapeAvatarValidator.check(preset) {
            case .ok: break
            case let .error(message):
                return XCTFail("\(preset.id ?? "?"): \(message)")
            }
            let live = ShapeAvatarOutline.liveOutline(from: preset)
            XCTAssertTrue(live.pathBody, preset.id ?? "?")
            XCTAssertEqual(live.points.count, 64, preset.id ?? "?")
            XCTAssertGreaterThan(live.path.count, 20, preset.id ?? "?")
            XCTAssertTrue(
                ShapeAvatarOutline.pointInsideOutline(live.points, live.face),
                "\(preset.id ?? "?") face"
            )
            let r = ShapeAvatarOutline.rayRadiusOutline(live.points, angle: 0)
            XCTAssertGreaterThan(r, 5, "\(preset.id ?? "?") up radius")
        }
    }

    func testCupHasTwoSubpathsForHandleHole() {
        let rings = ShapeAvatarOutline.flattenPath(ShapeAvatarPresets.cup.body.pathD!)
        XCTAssertEqual(rings.count, 2, "cup mug + handle ring")
        let live = ShapeAvatarOutline.liveOutline(from: ShapeAvatarPresets.cup)
        XCTAssertTrue(live.pathBody)
        // Face sits in the mug body (largest ring), not the handle.
        XCTAssertTrue(ShapeAvatarOutline.pointInsideOutline(live.points, live.face))
    }

    func testPropertyRandomValidRoundedBlobsKeepEyesInside() {
        for i in 0..<24 {
            let cx = 40.0 + Double(i % 5) * 4
            let cy = 40.0 + Double(i % 7) * 3
            let rx = 18.0 + Double(i % 6) * 2
            let ry = 20.0 + Double(i % 4) * 3
            let d = [
                "M\(cx) \(cy - ry)",
                "C\(cx + rx * 0.55) \(cy - ry) \(cx + rx) \(cy - ry * 0.55) \(cx + rx) \(cy)",
                "C\(cx + rx) \(cy + ry * 0.55) \(cx + rx * 0.55) \(cy + ry) \(cx) \(cy + ry)",
                "C\(cx - rx * 0.55) \(cy + ry) \(cx - rx) \(cy + ry * 0.55) \(cx - rx) \(cy)",
                "C\(cx - rx) \(cy - ry * 0.55) \(cx - rx * 0.55) \(cy - ry) \(cx) \(cy - ry)",
                "Z",
            ].joined()
            let def = ShapeAvatarDef(
                id: "blob\(i)",
                body: .path(d),
                eyes: ShapeAvatarEyes(
                    anchor: [cx, cy - ry * 0.2],
                    size: .init(w: 6, h: 12),
                    shape: .pill,
                    gap: 12
                )
            )
            guard case .ok = ShapeAvatarValidator.check(def) else {
                return XCTFail("blob\(i) invalid")
            }
            let live = ShapeAvatarOutline.liveOutline(from: def)
            XCTAssertTrue(ShapeAvatarOutline.pointInsideOutline(live.points, x: def.eyes.anchor[0], y: def.eyes.anchor[1]))
            let path = ShapeAvatarOutline.smoothClosedOutline(live.points)
            XCTAssertTrue(path.hasPrefix("M"))
            XCTAssertTrue(path.hasSuffix("Z"))
        }
    }

    func testNormalizesWindingSoSample0NearTop() {
        let pts = ShapeAvatarOutline.normalizeOutlineWinding([
            CGPoint(x: 60, y: 60),
            CGPoint(x: 40, y: 60),
            CGPoint(x: 40, y: 40),
            CGPoint(x: 60, y: 40),
        ])
        let minY = pts.map(\.y).min()!
        XCTAssertLessThanOrEqual(pts[0].y, minY + 1e-6)
    }

    func testSamplePathToOutline() {
        let pts = ShapeAvatarOutline.samplePathToOutline("M20 50 C20 20 80 20 80 50 C80 80 20 80 20 50 Z")
        XCTAssertEqual(pts.count, 64)
    }

    func testLocalGenerateMapsKeywordsWithoutProviders() {
        let cup = ShapeAvatarGenerate.generate(direction: "a coffee mug")
        XCTAssertEqual(cup.id, "cup")
        let ship = ShapeAvatarGenerate.generate(direction: "fusée spatiale")
        XCTAssertEqual(ship.id, "ship")
        guard case .ok = ShapeAvatarValidator.check(cup) else {
            return XCTFail("generated cup invalid")
        }
    }

    func testStillFrameWithoutAvatarDefStaysPolar() {
        let frame = ShapeFrames.still(.cup, .neutral, color: "#3b82f6")
        XCTAssertNil(frame.bodyPath)
        XCTAssertEqual(frame.body.count, 64)
    }

    func testStillFrameWithAvatarDefUsesPathBody() {
        let frame = ShapeFrames.still(.cup, .neutral, color: "#3b82f6", avatarDef: ShapeAvatarPresets.cup)
        XCTAssertNotNil(frame.bodyPath)
        XCTAssertFalse(frame.pathMorphing)
        XCTAssertEqual(frame.body.count, 64)
        let pose = ShapeVolume.grounded(ShapeVolume.rest, .cup)
        guard let drawing = ShapeVolume.drawShape(frame, pose, detail: .full) else {
            return XCTFail("no drawing")
        }
        XCTAssertNotNil(drawing.pathD)
        XCTAssertEqual(drawing.eyes.count, 2)
    }

    func testEngineMorphsBetweenPathBodies() {
        let start = ShapeEngineState(shape: .pad, expression: .neutral, color: "#111111", avatarDef: ShapeAvatarPresets.pad)
        let engine = ShapeEngine(start, now: 0, seed: 1)
        engine.set(
            ShapeEngineState(shape: .bulb, expression: .neutral, color: "#111111", avatarDef: ShapeAvatarPresets.bulb),
            now: 0.05
        )
        let mid = engine.frame(0.1)
        XCTAssertTrue(mid.pathMorphing || mid.bodyPath != nil)
        XCTAssertEqual(mid.body.count, 64)
        XCTAssertEqual(mid.eyeShapes.count, 2)
    }
}

private extension ShapeAvatarBody {
    var pathD: String? {
        if case let .path(d) = self { return d }
        return nil
    }
}
