import CoreGraphics
import XCTest
@testable import CompanionCore

/// Every object body wears the desktop's pill eyes (2026-11-01). The still
/// SVG and the iOS evidence stills used to draw each eye as a rect twice its
/// width rounded by that width: round dots touching each other. Both now
/// draw the engine's own capsules, the ones the phone animates.
final class ShapeObjectPillEyesTests: XCTestCase {
    func testEveryObjectStillHasTwoUprightSeparatePills() {
        for def in ShapeAvatarPresets.all {
            let id = def.id ?? "?"
            let eyes = ShapeAvatarPresets.stillEyes(def).sorted { $0.x < $1.x }
            XCTAssertEqual(eyes.count, 2, id)
            guard eyes.count == 2 else { continue }
            for eye in eyes {
                XCTAssertGreaterThan(eye.h, eye.w * 1.6, "\(id): a pill stands taller than it is wide")
                XCTAssertTrue((0...100).contains(eye.x) && (0...100).contains(eye.y), "\(id): inside the box")
            }
            XCTAssertGreaterThan(eyes[1].x - eyes[1].w / 2, eyes[0].x + eyes[0].w / 2, "\(id): the eyes never touch")
            XCTAssertEqual(eyes[0].y, eyes[1].y, accuracy: 0.01, "\(id): one level pair")
        }
    }

    func testTheStillSvgDrawsThoseSamePills() throws {
        let pattern = try NSRegularExpression(pattern: #"<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)" rx="([\d.]+)""#)
        for def in ShapeAvatarPresets.all {
            let id = def.id ?? "?"
            let svg = ShapeAvatarPresets.stillSvg(def, fill: "#3b82f6")
            let matches = pattern.matches(in: svg, range: NSRange(svg.startIndex..., in: svg))
            XCTAssertEqual(matches.count, 2, id)
            let eyes = ShapeAvatarPresets.stillEyes(def).sorted { $0.x < $1.x }
            for (match, eye) in zip(matches, eyes) {
                func value(_ i: Int) -> Double { Double((svg as NSString).substring(with: match.range(at: i))) ?? -1 }
                XCTAssertEqual(value(3), eye.w, accuracy: 0.01, "\(id): width")
                XCTAssertEqual(value(4), eye.h, accuracy: 0.01, "\(id): height")
                XCTAssertEqual(value(5), eye.w / 2, accuracy: 0.01, "\(id): rounded by half its width, a pill")
                XCTAssertLessThan(value(3), value(4), "\(id): never a round dot")
            }
            XCTAssertFalse(svg.range(of: #"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}"#, options: .regularExpression) != nil, "\(id): no GUID")
        }
    }

    /// The body stays whole: the still's eyes sit on its outline's inside.
    func testThePillsSitOnTheBody() {
        for def in ShapeAvatarPresets.all {
            let id = def.id ?? "?"
            let live = ShapeAvatarOutline.liveOutline(from: def)
            let body = CGMutablePath()
            if let first = live.points.first {
                body.move(to: first)
                live.points.dropFirst().forEach { body.addLine(to: $0) }
                body.closeSubpath()
            }
            for eye in ShapeAvatarPresets.stillEyes(def) {
                XCTAssertTrue(body.contains(CGPoint(x: eye.x, y: eye.y)), "\(id): eye centre on the body")
            }
        }
    }

    /// Two custom bodies without an id never share a cached still.
    func testCustomDefsDoNotShareAStill() throws {
        let presets = ShapeAvatarPresets.all.filter { $0.id == "cup" || $0.id == "tome" }
        XCTAssertEqual(presets.count, 2)
        var a = presets[0], b = presets[1]
        a.id = nil
        b.id = nil
        let fa = ShapeFrames.still(.circle, .neutral, avatarDef: a)
        let fb = ShapeFrames.still(.circle, .neutral, avatarDef: b)
        XCTAssertNotEqual(fa.eyeShapes, fb.eyeShapes)
    }
}
