// The Shapes engine on the phone: a port of the desktop's
// `src/components/shape-engine.ts` and `shape-moves.ts` (clean room,
// 2026-10-08, #187). Everything that moves a shape is a pure function of
// time, as on the desktop:
//
// - The face: two rounded bars on the body, always the same two capsules
//   (2026-10-28: no eye ever fades, shrinks or tilts on its own). Their
//   middle rests on the body's face anchor (shared/mascot-geometry.json) and
//   moves from there with the gaze; the bounds solver keeps both eyes inside
//   the outline (`solveEyes`).
// - Idle: the gaze wanders on five slow loops, the body drifts and breathes,
//   the eyes blink on a seeded schedule.
// - A pointer (a large layout with a trackpad or a mouse): the gaze turns
//   toward it; the body's lean (ShapeMotion) moves the gaze too (`lean`).
// - Changes of shape, face and colour slide over `morphSeconds`.
// - The fourteen one-shot moves, blended over the resting pose. A move never
//   takes the body apart: it stays one whole outline with its two eyes; what
//   a move adds (thought dots, a mark, rings, ribbons, specks) is drawn
//   around it.
//
// The numbers (radii, faces, timings, rings, loops) are the desktop's own,
// generated into `ShapeEngineData.swift`; ShapeEngineTests checks the frames
// this file draws against frames the desktop's engine drew
// (Fixtures/shape-frames.json, both from src/components/ios-mascot-export.test.ts).
// All lengths are in R (the circle's radius) until a frame turns them into
// the 0..100 box.
import CoreGraphics
import Foundation

// MARK: - Data types (filled by ShapeEngineData.swift)

public struct ShapeBlink: Sendable {
    public let first, minGap, maxGap, length, closing, doubleChance, doubleAfter, floor: Double
}

public struct ShapeLoop: Sendable {
    public let period, reach: Double
}

/// One eye: width and height (R), a tilt (degrees, clockwise) and how open it is (0...1).
public struct ShapeEye: Equatable, Sendable {
    public var w, h, tilt, open: Double
}

/// A face: where it looks (degrees, over the head's own turn) and its two eyes.
public struct ShapeFace: Equatable, Sendable {
    public var yaw, pitch, roll: Double
    /// Half the angle between the two eyes on the head, degrees.
    public var split: Double
    public var left, right: ShapeEye
}

/// A ring around the body (`RingSpec`).
public struct ShapeRingSpec: Sendable {
    public let a, tiltX, tiltZ, speed, phase, sweep, hue, hueSpan, width: Double
}

// MARK: - Math (shape-art.ts)

public enum ShapeMath {
    public static let rad = Double.pi / 180

    public static func clamp01(_ t: Double) -> Double { min(1, max(0, t)) }
    public static func easeOutQuint(_ t: Double) -> Double { 1 - pow(1 - clamp01(t), 5) }
    public static func easeInOut(_ t: Double) -> Double {
        let x = clamp01(t)
        return x * x * (3 - 2 * x)
    }
    public static func lerp(_ a: Double, _ b: Double, _ t: Double) -> Double { a + (b - a) * t }

    /// The body's radius toward any angle (radians, 0 up, clockwise), read between the two nearest radii.
    public static func radiusAt(_ radii: [Double], _ angle: Double) -> Double {
        let n = radii.count
        let turn = ((angle / (Double.pi * 2)).truncatingRemainder(dividingBy: 1) + 1).truncatingRemainder(dividingBy: 1)
        let at = turn * Double(n)
        let i = Int(at.rounded(.down)) % n
        let j = (i + 1) % n
        let f = at - at.rounded(.down)
        return radii[i] * (1 - f) + radii[j] * f
    }

    /// The body's radius toward a point (R units).
    public static func radiusToward(_ radii: [Double], _ x: Double, _ y: Double) -> Double {
        radiusAt(radii, atan2(x, -y))
    }

    public static func blendRadii(_ from: [Double], _ to: [Double], _ t: Double) -> [Double] {
        zip(from, to).map { $0 + ($1 - $0) * t }
    }

    /// A point in R units in the 0...100 box.
    public static func toBox(_ p: CGPoint) -> CGPoint {
        CGPoint(x: ShapeEngineData.bodyCenter.x + p.x * ShapeEngineData.bodyUnit,
                y: ShapeEngineData.bodyCenter.y + p.y * ShapeEngineData.bodyUnit)
    }

    /// `Math.round`: halves go up, toward positive infinity.
    public static func jsRound(_ v: Double) -> Double { (v + 0.5).rounded(.down) }

    /// `Math.round(v * 100) / 100`.
    static func round2(_ v: Double) -> Double { jsRound(v * 100) / 100 }

    /// A number as JavaScript prints it (integers without a fraction, no negative zero).
    public static func js(_ v: Double) -> String {
        if v == v.rounded(), abs(v) < 1e15 { return String(Int(v)) }
        return String(v)
    }

    /// The cubic segments of a closed, smooth path through the points
    /// (`smoothClosed`: Catmull-Rom turned into cubic Beziers).
    public static func smoothSegments(_ points: [CGPoint], tension: Double = 1) -> [(c1: CGPoint, c2: CGPoint, to: CGPoint)] {
        let n = points.count
        guard n > 0 else { return [] }
        return (0..<n).map { i in
            let p0 = points[(i - 1 + n) % n], p1 = points[i], p2 = points[(i + 1) % n], p3 = points[(i + 2) % n]
            let c1 = CGPoint(x: p1.x + (p2.x - p0.x) / 6 * tension, y: p1.y + (p2.y - p0.y) / 6 * tension)
            let c2 = CGPoint(x: p2.x - (p3.x - p1.x) / 6 * tension, y: p2.y - (p3.y - p1.y) / 6 * tension)
            return (c1, c2, p2)
        }
    }

    /// `smoothClosed` as the desktop writes it (two decimals).
    public static func smoothClosed(_ points: [CGPoint]) -> String {
        guard let first = points.first else { return "" }
        var d = "M\(js(round2(first.x))) \(js(round2(first.y)))"
        for s in smoothSegments(points) {
            d += "C\(js(round2(s.c1.x))) \(js(round2(s.c1.y))) \(js(round2(s.c2.x))) \(js(round2(s.c2.y))) \(js(round2(s.to.x))) \(js(round2(s.to.y)))"
        }
        return d + "Z"
    }

    /// The same closed curve as a path to draw.
    public static func smoothClosedPath(_ points: [CGPoint], into path: CGMutablePath) {
        guard let first = points.first else { return }
        path.move(to: first)
        for s in smoothSegments(points) { path.addCurve(to: s.to, control1: s.c1, control2: s.c2) }
        path.closeSubpath()
    }

    // MARK: Colours

    static func rgb(_ hex: String) -> (Double, Double, Double) {
        let h = hex.replacingOccurrences(of: "#", with: "").prefix(6)
        let n = Int(h, radix: 16) ?? 0
        return (Double((n >> 16) & 255), Double((n >> 8) & 255), Double(n & 255))
    }

    /// Two colours blended (t 0...1), as #rrggbb (`mixHex`).
    public static func mixHex(_ a: String, _ b: String, _ t: Double) -> String {
        let x = rgb(a), y = rgb(b), k = clamp01(t)
        func ch(_ p: Double, _ q: Double) -> String {
            let v = Int(jsRound(lerp(p, q, k)))
            return String(format: "%02x", v)
        }
        return "#" + ch(x.0, y.0) + ch(x.1, y.1) + ch(x.2, y.2)
    }

    /// A ring or ribbon's three hue stops (`rainbowStops`): hsl(h, 55%, 62%).
    public static func rainbowStops(_ hue: Double, _ span: Double) -> [Double] {
        [0, 0.5, 1].map { k in jsRound((hue + span * k).truncatingRemainder(dividingBy: 360)) }
    }
}

// MARK: - Frames

/// A round part drawn on its own (a thinking dot, the exclamation's dot), or a speck; box units in a frame.
public struct ShapeDot: Equatable, Sendable {
    public var x, y, r, opacity: Double
}

/// A ring at a moment: its back and front runs (box units, two decimals).
public struct ShapeRingDraw: Equatable, Sendable {
    public var back: [[CGPoint]]
    public var front: [[CGPoint]]
    public var hue, hueSpan, width, opacity, x1, x2: Double

    /// `pathOf`, as the desktop writes it.
    public static func d(_ runs: [[CGPoint]]) -> String {
        runs.filter { $0.count > 1 }.map { run in
            run.enumerated().map { i, p in "\(i == 0 ? "M" : "L")\(ShapeMath.js(p.x)) \(ShapeMath.js(p.y))" }.joined()
        }.joined()
    }
}

/// A ribbon: a quadratic curve from `from` through `control` to `to` (box units, two decimals).
public struct ShapeRibbonDraw: Equatable, Sendable {
    public var from, control, to: CGPoint
    public var hue, hueSpan, width, opacity: Double
    /// The visible part of the ribbon, as a dash over a path of length 1.
    public var dash, offset: Double
    public var x1, x2: Double

    public var d: String {
        "M\(ShapeMath.js(from.x)) \(ShapeMath.js(from.y))Q\(ShapeMath.js(control.x)) \(ShapeMath.js(control.y)) \(ShapeMath.js(to.x)) \(ShapeMath.js(to.y))"
    }

    /// The part drawn (fractions of the length): one dash from `offset`, or the whole ribbon.
    public var visible: ClosedRange<Double>? {
        if dash >= 1 { return 0...1 }
        let start = max(0, offset), end = min(1, offset + dash)
        return end > start ? start...end : nil
    }
}

/// A mark in the body's colour beside the body (the exclamation's bar): a closed polygon (`Mark`).
public struct ShapeMark: Equatable, Sendable {
    public var points: [CGPoint]
    public var opacity: Double

    public init(points: [CGPoint], opacity: Double) {
        self.points = points
        self.opacity = opacity
    }

    /// `smoothClosed` of the points, as the desktop writes it.
    public var d: String { ShapeMath.smoothClosed(points) }
}

/// One drawn frame in the 0...100 box (`ShapeFrame`).
public struct ShapeFrame: Sendable {
    /// The body's outline points (smoothed when drawn; also morph probes for path bodies).
    public var body: [CGPoint]
    /// Exact path silhouette when a path/parts avatarDef is live (may be multi-subpath).
    public var bodyPath: String? = nil
    /// Extra filled body pieces (parts after the first).
    public var bodyExtras: [String] = []
    /// True while morphing between path outlines (draw resampled smooth ring).
    public var pathMorphing: Bool = false
    /// Each shown eye's outline points (cut out with the even-odd rule).
    public var eyes: [[CGPoint]]
    /// The same eyes as upright capsules in the box (`eyeShapes`): the volume
    /// places each one on the face from these (`ShapeVolume.faceEyes`).
    public var eyeShapes: [ShapeEyeBox] = []
    /// The pumpkin's stem: its outline points in the box (before the move) and how much of it shows (`stem`).
    public var stem: (points: [CGPoint], opacity: Double)?
    /// The body's move: offset (R), turn (degrees) and scale, around the body's middle.
    public var x, y, rot, sx, sy: Double
    public var color: String
    /// How far the body is from its resting outline (0...1).
    public var morphed: Double
    /// The body's thickness (0...1, `bodyDepth`): its thinnest half-width over
    /// `depthFull`, so a thin body and a body a move shrinks thin their slices.
    public var depth: Double = 1
    public var light: (x: Double, y: Double, r: Double)
    public var dots: [ShapeDot]
    public var specks: [ShapeDot]
    public var badge: (x: Double, y: Double, r: Double, notch: Double)?
    /// A move's marks in the body's colour beside the body (the exclamation mark), box units (`marks`).
    public var marks: [ShapeMark] = []
    public var rings: [ShapeRingDraw]
    public var ribbons: [ShapeRibbonDraw]

    /// Path string for drawing: exact when settled path body, else smooth of points.
    public var bodyD: String {
        if let bodyPath, !pathMorphing { return bodyPath }
        if pathMorphing || bodyPath != nil {
            return ShapeAvatarOutline.smoothClosedOutline(body)
        }
        return ShapeMath.smoothClosed(body)
    }
    public var stemD: String? { stem.map { ShapeMath.smoothClosed($0.points) } }
    /// The body's motion in box units (`motion`): shift, turn and scale about the middle.
    public var motion: (x: Double, y: Double, rot: Double, sx: Double, sy: Double) {
        (x * ShapeEngineData.bodyUnit, y * ShapeEngineData.bodyUnit, rot, sx, sy)
    }
    public var eyesD: String { eyes.map { ShapeMath.smoothClosed($0) }.joined() }

    /// The SVG transform the desktop writes for the body.
    public var transform: String {
        let fmt = { (v: Double) in ShapeMath.js(ShapeMath.jsRound(v * 1000) / 1000) }
        let c = ShapeEngineData.bodyCenter, u = ShapeEngineData.bodyUnit
        return "translate(\(fmt(x * u)) \(fmt(y * u))) rotate(\(fmt(rot)) \(ShapeMath.js(c.x)) \(ShapeMath.js(c.y))) translate(\(ShapeMath.js(c.x)) \(ShapeMath.js(c.y))) scale(\(fmt(sx)) \(fmt(sy))) translate(\(ShapeMath.js(-c.x)) \(ShapeMath.js(-c.y)))"
    }

    /// The body's transform in the box (applied to the body, its eyes, dots and the badge's notch).
    public var affine: CGAffineTransform {
        let c = ShapeEngineData.bodyCenter, u = ShapeEngineData.bodyUnit
        return CGAffineTransform.identity
            .translatedBy(x: x * u, y: y * u)
            .translatedBy(x: c.x, y: c.y).rotated(by: rot * ShapeMath.rad).translatedBy(x: -c.x, y: -c.y)
            .translatedBy(x: c.x, y: c.y).scaledBy(x: sx, y: sy).translatedBy(x: -c.x, y: -c.y)
    }
}

// MARK: - Moves (shape-moves.ts)

/// What a move changes on the face (`Partial<Expression>`).
public struct ShapeFacePatch: Sendable {
    public var yaw, pitch, roll, split: Double?
    public var left, right: ShapeEye?

    func applied(to face: ShapeFace) -> ShapeFace {
        ShapeFace(yaw: yaw ?? face.yaw, pitch: pitch ?? face.pitch, roll: roll ?? face.roll, split: split ?? face.split,
                  left: left ?? face.left, right: right ?? face.right)
    }
}

/// What a move does at a moment (`MovePose`), R units: the whole body it
/// takes (another body of the set, never a dot or a bar), the face, the
/// motion, and what it adds around the body.
public struct ShapeMovePose: Sendable {
    public var radii: [Double]?
    public var x, y, rot, scale: Double?
    /// 0 hides the eyes (no move does any more; kept for a skin's own effects).
    public var eyes: Double?
    public var face: ShapeFacePatch?
    public var dots: [ShapeDot]?
    public var specks: [ShapeDot]?
    /// Marks in the body's colour beside the body (the exclamation's bar), R units.
    public var marks: [ShapeMark]?
    public var badge: (angle: Double, r: Double, scale: Double)?
    public var rings: [(spec: ShapeRingSpec, opacity: Double)]?
    public var ribbons: [ShapeRibbonDraw]?
}

public enum ShapeMoves {
    private static func moveRadii(_ name: String) -> [Double] { ShapeEngineData.moveRadii[name] ?? [] }

    /// How long a move shows in all, s (its duration, then the slide back).
    public static func length(_ move: ShapeMove) -> Double {
        let t = ShapeEngineData.moveTiming[move]!
        return t.duration + t.morph
    }

    /// How far a move shows at `u` s (`moveWeight`).
    public static func weight(_ move: ShapeMove, _ u: Double) -> Double {
        let t = ShapeEngineData.moveTiming[move]!
        if u < 0 || u > t.duration + t.morph { return 0 }
        let enter = ShapeMath.easeOutQuint(u / t.morph)
        let leave = u > t.duration ? 1 - ShapeMath.easeOutQuint((u - t.duration) / t.morph) : 1
        return min(enter, leave)
    }

    /// A ring in 3D around the body at time t (s), split into its back and front by depth (`ringAt`).
    public static func ringAt(_ spec: ShapeRingSpec, _ t: Double, _ opacity: Double, center: CGPoint = .zero) -> ShapeRingDraw {
        let count = 72
        let start = (spec.phase + spec.speed * t) * Double.pi * 2
        let tx = spec.tiltX * ShapeMath.rad, tz = spec.tiltZ * ShapeMath.rad
        var back: [[CGPoint]] = [[]]
        var front: [[CGPoint]] = [[]]
        var wasFront: Bool?
        for i in 0...count {
            let f = start + Double(i) / Double(count) * spec.sweep * Double.pi * 2
            let x0 = cos(f) * spec.a, y0 = sin(f) * spec.a
            let y1 = y0 * cos(tx), z1 = y0 * sin(tx)
            let x2 = x0 * cos(tz) - y1 * sin(tz)
            let y2 = x0 * sin(tz) + y1 * cos(tz)
            let b = ShapeMath.toBox(CGPoint(x: center.x + x2, y: center.y + y2))
            let p = CGPoint(x: ShapeMath.round2(b.x), y: ShapeMath.round2(b.y))
            let isFront = z1 >= 0
            if let was = wasFront, was != isFront {
                if was { front[front.count - 1].append(p) } else { back[back.count - 1].append(p) }
                if isFront { front.append([]) } else { back.append([]) }
            }
            if isFront { front[front.count - 1].append(p) } else { back[back.count - 1].append(p) }
            wasFront = isFront
        }
        let span = spec.a * ShapeEngineData.bodyUnit
        let cx = ShapeEngineData.bodyCenter.x + center.x * ShapeEngineData.bodyUnit
        return ShapeRingDraw(back: back.filter { $0.count > 1 }, front: front.filter { $0.count > 1 }, hue: spec.hue, hueSpan: spec.hueSpan,
                             width: spec.width * ShapeEngineData.bodyUnit, opacity: opacity, x1: cx - span, x2: cx + span)
    }

    /// A bundle of `count` ribbons along a curve from `from` to `to` (`ribbons`).
    public static func ribbons(_ from: CGPoint, _ to: CGPoint, bow: Double, count: Int, spread: Double, hue: Double, opacity: Double,
                               dash: Double, offset: Double, width: Double = 0.06) -> [ShapeRibbonDraw] {
        let dx = to.x - from.x, dy = to.y - from.y
        let len = hypot(dx, dy) == 0 ? 1 : hypot(dx, dy)
        let nx = -dy / len, ny = dx / len
        let r = { (p: CGPoint) in CGPoint(x: ShapeMath.round2(p.x), y: ShapeMath.round2(p.y)) }
        return (0..<count).map { i in
            let k = Double(i) - Double(count - 1) / 2
            let off = k * spread
            let a = ShapeMath.toBox(CGPoint(x: from.x + nx * off * 0.4, y: from.y + ny * off * 0.4))
            let c = ShapeMath.toBox(CGPoint(x: (from.x + to.x) / 2 + nx * (bow + off), y: (from.y + to.y) / 2 + ny * (bow + off)))
            let b = ShapeMath.toBox(CGPoint(x: to.x + nx * off, y: to.y + ny * off))
            return ShapeRibbonDraw(from: r(a), control: r(c), to: r(b), hue: (hue + Double(i) * 62).truncatingRemainder(dividingBy: 360), hueSpan: 70,
                                   width: width * ShapeEngineData.bodyUnit * (1 - abs(k) * 0.12), opacity: opacity, dash: dash,
                                   offset: offset + Double(i) * 0.04, x1: min(a.x, b.x), x2: max(a.x, b.x) + 0.01)
        }
    }

    /// A rounded bar standing at x from y0 (top) to y1 (bottom), `w` wide (R), as polygon points (`barPoints`).
    static func barPoints(_ x: Double, _ y0: Double, _ y1: Double, _ w: Double, count: Int = 20) -> [CGPoint] {
        let r = w / 2
        let long = max(0, (y1 - y0) / 2 - r)
        let cy = (y0 + y1) / 2
        return (0..<count).map { i in
            let a = Double(i) / Double(count) * Double.pi * 2
            let px = cos(a) * r, py = sin(a) * r
            return CGPoint(x: x + px, y: cy + py + (py >= 0 ? long : -long))
        }
    }

    /// The exclamation mark above the body's right shoulder: a bar and a dot, in the body's colour (`exclamation`).
    private static func exclamation(_ opacity: Double) -> (marks: [ShapeMark], dots: [ShapeDot]) {
        let e = ShapeEngineData.exclaim
        return (
            marks: [ShapeMark(points: barPoints(e.x, e.barTop, e.barBottom, e.width), opacity: opacity)],
            dots: [ShapeDot(x: e.x, y: e.dotY, r: e.dotR, opacity: opacity)]
        )
    }

    /// The eyes shut (the sleep): the neutral capsule closed to a line (`SHUT`), and wide open (`WIDE`).
    private static let shut = ShapeEye(w: 0.26, h: 0.46, tilt: 0, open: 0.06)
    private static let wide = ShapeEye(w: 0.3, h: 0.56, tilt: 0, open: 1)

    /// A move's pose `at` seconds in (`moveAt`). `rest` is the body at rest, which a morph comes back to.
    public static func at(_ move: ShapeMove, _ at: Double, rest: [Double] = ShapeEngineData.radii[.circle]!) -> ShapeMovePose {
        let d = ShapeEngineData.moveTiming[move]!.duration
        let u = min(at, d)
        let pi2 = Double.pi * 2
        switch move {
        case .thinking:
            // the body stays, looks up and away; three thought dots pulse one after the other
            let pulse = { (k: Double) in 0.5 + 0.5 * sin(((u - k * 0.25) / 1.5) * pi2 - Double.pi / 2) }
            let dots = ShapeEngineData.thoughtDots.enumerated().map { k, dot in
                ShapeDot(x: dot.x, y: dot.y, r: dot.r * (1 + 0.12 * pulse(Double(k))), opacity: 0.5 + 0.5 * pulse(Double(k)))
            }
            return ShapeMovePose(scale: 1 + 0.025 * pulse(1), face: ShapeFacePatch(yaw: 7, pitch: 9), dots: dots)
        case .wink:
            return ShapeMovePose(face: ShapeFacePatch(roll: -10, right: ShapeEye(w: 0.34, h: 0.09, tilt: -6, open: 1)))
        case .wide:
            let eye = ShapeEye(w: 0.27, h: 0.62, tilt: 0, open: 1)
            return ShapeMovePose(scale: 1.02, face: ShapeFacePatch(pitch: 2, split: 17, left: eye, right: eye))
        case .alert:
            // the body rocks and hops, eyes wide; an exclamation mark pops up beside it
            let sway = sin(u * pi2 * 2.5) * 4 * (1 - ShapeMath.clamp01(u / d) * 0.6)
            let hop = -0.07 * abs(sin(u * Double.pi * 1.25)) * (1 - ShapeMath.clamp01(u / d) * 0.5)
            let mark = exclamation(1)
            return ShapeMovePose(y: hop, rot: sway, face: ShapeFacePatch(split: 17, left: wide, right: wide), dots: mark.dots, marks: mark.marks)
        case .notify:
            let pop = u < 0.45 ? 1.14 * ShapeMath.easeOutQuint(u / 0.3) - max(0, (u - 0.3) / 0.15) * 0.14 : 1
            let eye = ShapeEye(w: 0.42, h: 0.42, tilt: 0, open: 1)
            return ShapeMovePose(face: ShapeFacePatch(split: 19, left: eye, right: eye), badge: (angle: 42, r: 0.17, scale: max(0, pop)))
        case .exclaim:
            // a startled jump, eyes round; the exclamation mark beside the body
            let jump = max(0, sin(u * pi2))
            let eye = ShapeEye(w: 0.4, h: 0.44, tilt: 0, open: 1)
            let mark = exclamation(1)
            return ShapeMovePose(y: -0.06 * jump, scale: 1 + 0.03 * jump, face: ShapeFacePatch(pitch: 3, split: 18, left: eye, right: eye),
                                 dots: mark.dots, marks: mark.marks)
        case .sleep:
            // eyes shut, a slow bob, two small dots drifting up like a snore
            let breath = sin((u / 1.2) * pi2)
            let rise = (u / 1.2).truncatingRemainder(dividingBy: 1)
            return ShapeMovePose(y: 0.05 * breath, scale: 1 - 0.015 * breath, face: ShapeFacePatch(pitch: -8, left: shut, right: shut), dots: [
                ShapeDot(x: 1.02, y: -0.85 - rise * 0.25, r: 0.06, opacity: 0.8 * (1 - rise)),
                ShapeDot(x: 1.26, y: -1.12 - rise * 0.25, r: 0.085, opacity: 0.6 * (1 - rise)),
            ])
        case .egg:
            return ShapeMovePose(radii: moveRadii("egg"), y: -0.02)
        case .hexagon:
            return ShapeMovePose(radii: moveRadii("hexagon"))
        case .play:
            let slide = (u / d) * 1.3
            return ShapeMovePose(radii: moveRadii("triangle"), rot: -8,
                                 ribbons: ribbons(CGPoint(x: 1.35, y: -0.7), CGPoint(x: -1.55, y: 0.42), bow: -0.32, count: 4, spread: 0.075, hue: 280,
                                                  opacity: 1, dash: 0.7, offset: -0.35 + slide, width: 0.055))
        case .orbit:
            let spinFor = d - 1.1
            let rot = u < spinFor ? 360 * 1.25 * u : 360 * 1.25 * spinFor
            let settle = ShapeMath.clamp01((u - spinFor) / 0.6)
            // the spinning triangle settles back into this body's own outline, never a circle
            let radii = settle < 1 ? ShapeMath.blendRadii(moveRadii("triangle"), rest, ShapeMath.easeOutQuint(settle)) : nil
            return ShapeMovePose(radii: radii, rot: rot * (1 - ShapeMath.easeOutQuint(settle)),
                                 rings: ShapeEngineData.orbitRings.map { ($0, 1 - settle) })
        case .swirl:
            let fade = 1 - ShapeMath.clamp01((u - d * 0.55) / (d * 0.45))
            return ShapeMovePose(rings: ShapeEngineData.swirlRings.map { ($0, fade) })
        case .burst:
            let back = 1.85
            let specks: [ShapeDot] = (0..<5).map { i in
                let k = ShapeMath.clamp01(u / 1.6)
                let reach = 0.75 * (1 - ShapeMath.easeInOut(k)) + 0.2
                let turn = Double(i) * (pi2 / 5) + k * Double.pi * 2.2
                return ShapeDot(x: sin(turn) * reach, y: -cos(turn) * reach, r: 0.05,
                                opacity: u < 1.7 ? ShapeMath.clamp01(u / 0.2) : ShapeMath.clamp01((back - u) / 0.15))
            }
            // the body squeezes down while the specks fly, then springs back from 1.4 s
            let squeeze = ShapeMath.easeInOut(ShapeMath.clamp01(u / 0.4))
            let grow = ShapeMath.easeOutQuint((u - 1.4) / 0.35)
            let scale = ShapeMath.lerp(ShapeMath.lerp(1, 0.86, squeeze), 1, grow)
            guard u < back else { return ShapeMovePose(specks: []) }
            let eye = ShapeEye(w: 0.3, h: 0.3, tilt: 0, open: 1)
            return ShapeMovePose(scale: scale, face: ShapeFacePatch(left: eye, right: eye), specks: specks)
        case .comet:
            let back = 2.0
            if u >= back { return ShapeMovePose() }
            // the body leans and drifts a little; the tail swings across behind it, one diagonal to the other
            let k = ShapeMath.easeInOut(ShapeMath.clamp01(u / 1.9))
            let x = ShapeMath.lerp(-0.08, 0.12, k)
            let y = ShapeMath.lerp(0.05, -0.05, k)
            let a = ShapeMath.lerp(212, 148, k) * ShapeMath.rad
            let reach = 0.95
            let from = CGPoint(x: x + cos(a) * reach, y: y + sin(a) * reach * 0.8 - 0.16)
            let to = CGPoint(x: x - cos(a) * reach * 0.75, y: y - sin(a) * reach * 0.6 - 0.04)
            let fade = ShapeMath.clamp01(u / 0.2) * ShapeMath.clamp01((back - u) / 0.25)
            return ShapeMovePose(x: x, y: y, rot: ShapeMath.lerp(-6, 6, k), face: ShapeFacePatch(yaw: ShapeMath.lerp(-8, 8, k), pitch: 4),
                                 ribbons: ribbons(from, to, bow: -0.14, count: 4, spread: 0.06, hue: 300, opacity: fade, dash: 1, offset: 0, width: 0.08))
        }
    }
}

// MARK: - Idle, blinks, the gaze

public enum ShapeIdle {
    /// A smooth loop of period `period` s (`loopNoise`).
    public static func loopNoise(_ t: Double, _ period: Double, _ seed: Double) -> Double {
        let x = (t / period) * Double.pi * 2
        return 0.6 * sin(x + seed) + 0.27 * sin(2 * x + 1.7 * seed + 0.9) + 0.13 * sin(3 * x + 0.4 - seed)
    }

    /// The gaze's slow wander, degrees (`wander`).
    public static func wander(_ t: Double, _ seed: Double) -> (yaw: Double, pitch: Double, roll: Double) {
        func sum(_ loops: [ShapeLoop], _ k: Double) -> Double {
            loops.enumerated().reduce(0) { total, item in
                total + item.element.reach * loopNoise(t, item.element.period, seed * (k + 1) + Double(item.offset) * 2.3)
            }
        }
        return (sum(ShapeEngineData.wanderYaw, 0), sum(ShapeEngineData.wanderPitch, 1), sum(ShapeEngineData.wanderRoll, 2))
    }

    /// The body's slow drift (R) and its breath (`drift`).
    public static func drift(_ t: Double, _ seed: Double) -> (x: Double, y: Double, breath: Double) {
        (0.006 * loopNoise(t, 7.7, seed + 0.5), 0.007 * loopNoise(t, 5.5, seed + 1.9),
         1 + ShapeEngineData.breathAmount * sin((t / ShapeEngineData.breathSeconds) * Double.pi * 2))
    }

    /// The desktop's xorshift (`seededRandom`), bit for bit.
    public static func seededRandom(_ seed: Double) -> () -> Double {
        let f = (seed * 2654435761).rounded(.down)
        var m = f.truncatingRemainder(dividingBy: 4294967296)
        if m < 0 { m += 4294967296 }
        var s = UInt32(m) ^ 0x9e37_79b9
        if s == 0 { s = 1 }
        return {
            s ^= s << 13
            s ^= s >> 17
            s ^= s << 5
            return Double(s) / 4294967296
        }
    }

    /// The blink start times up to `until` s (`blinkSchedule`).
    public static func blinkSchedule(_ seed: Double, until: Double) -> [Double] {
        let random = seededRandom(seed)
        let b = ShapeEngineData.blink
        var times: [Double] = []
        var t = b.first
        while t <= until {
            times.append(t)
            if random() < b.doubleChance { times.append(t + b.doubleAfter) }
            t += b.minGap + random() * (b.maxGap - b.minGap)
        }
        return times
    }

    /// How open the eyes are at `t` (`blinkOpen`).
    public static func blinkOpen(_ t: Double, _ starts: [Double]) -> Double {
        let b = ShapeEngineData.blink
        var open = 1.0
        for start in starts {
            let p = (t - start) / b.length
            if p < 0 || p > 1 { continue }
            let value = p < b.closing ? 1 - ShapeMath.easeInOut(p / b.closing) : ShapeMath.easeInOut((p - b.closing) / (1 - b.closing))
            open = min(open, b.floor + (1 - b.floor) * value)
        }
        return open
    }

    /// The pointer (-1...1 on each axis around the mascot, y down) as a gaze turn, degrees (`hoverGaze`).
    public static func hoverGaze(_ nx: Double, _ ny: Double) -> (yaw: Double, pitch: Double) {
        let x = max(-1, min(1, nx)), y = max(-1, min(1, ny))
        return (ShapeEngineData.hover.yaw * x, -ShapeEngineData.hover.pitch * y)
    }
}

/// A value that follows its target with a smooth exponential ease (`Follower`).
final class ShapeFollower {
    var value: Double
    var target: Double
    private let settle: Double

    init(_ value: Double = 0, settle: Double = ShapeEngineData.hover.turn) {
        self.value = value
        self.target = value
        self.settle = settle
    }

    func step(_ dt: Double) -> Double {
        let k = 1 - exp((-max(0, dt) * 4.6) / settle)
        value += (target - value) * k
        return value
    }
}

// MARK: - The face (solveEyes)

/// One eye as an upright capsule in the 0...100 box (`EyeBox`).
public struct ShapeEyeBox: Equatable, Sendable {
    public var x, y, w, h, tilt: Double

    public init(x: Double, y: Double, w: Double, h: Double, tilt: Double) {
        self.x = x
        self.y = y
        self.w = w
        self.h = h
        self.tilt = tilt
    }
}

/// One eye as the viewer sees it, R units.
public struct ShapePlacedEye: Sendable {
    public var points: [CGPoint]
    public var center: CGPoint
    /// The capsule's width and height (R), after the blink, and the face's tilt (degrees).
    public var w: Double
    public var h: Double
    public var tilt: Double
    /// 0 (hidden by a move) ... 1; never less than 1 from the gaze alone (2026-10-28: an eye never fades away).
    public var alpha: Double
    public var depth: Double
}

public enum ShapeGaze {
    private typealias Vec3 = (x: Double, y: Double, z: Double)

    private static func direction(_ yaw: Double, _ pitch: Double) -> Vec3 {
        let r = ShapeMath.rad
        return (sin(yaw * r) * cos(pitch * r), -sin(pitch * r), cos(yaw * r) * cos(pitch * r))
    }

    private static func toView(_ p: Vec3, _ roll: Double) -> Vec3 {
        let b = ShapeEngineData.head.yaw * ShapeMath.rad
        let x1 = p.x * cos(b) - p.z * sin(b)
        let z1 = p.x * sin(b) + p.z * cos(b)
        let a = -ShapeEngineData.head.pitch * ShapeMath.rad
        let y2 = p.y * cos(a) - z1 * sin(a)
        let z2 = p.y * sin(a) + z1 * cos(a)
        let r = roll * ShapeMath.rad
        return (x1 * cos(r) - y2 * sin(r), x1 * sin(r) + y2 * cos(r), z2)
    }

    /// A rounded bar's outline (`stadium`), around its middle.
    static func stadium(_ w: Double, _ h: Double, count: Int = 28) -> [CGPoint] {
        let r = min(w, h) / 2
        let long = max(w, h) / 2 - r
        let tall = h >= w
        return (0..<count).map { i in
            let a = Double(i) / Double(count) * Double.pi * 2
            let x = cos(a) * r, y = sin(a) * r
            return tall ? CGPoint(x: x, y: y + (y >= 0 ? long : -long)) : CGPoint(x: x + (x >= 0 ? long : -long), y: y)
        }
    }

    /// An eye's outline (`eyeOutline`): an upright capsule w x h around (cx, cy),
    /// turned only by the face's own tilt; never sheared nor foreshortened.
    public static func eyeOutline(_ cx: Double, _ cy: Double, _ w: Double, _ h: Double, _ tilt: Double) -> [CGPoint] {
        let t = tilt * ShapeMath.rad
        let c = cos(t), s = sin(t)
        return stadium(w, h).map { p in CGPoint(x: cx + p.x * c - p.y * s, y: cy + p.x * s + p.y * c) }
    }

    private static func placeEye(_ yaw: Double, _ pitch: Double, _ roll: Double, _ shape: ShapeEye, _ open: Double) -> ShapePlacedEye {
        let c = toView(direction(yaw, pitch), roll)
        // the size: the face's own capsule, the blink closing its height; the turn only moves it
        let w = shape.w * ShapeEngineData.eyeScale.w
        let h = max(shape.h * ShapeEngineData.eyeScale.h * ShapeEngineData.eyeLength * max(open, ShapeEngineData.blink.floor), 0.012)
        return ShapePlacedEye(points: eyeOutline(c.x, c.y, w, h, shape.tilt), center: CGPoint(x: c.x, y: c.y), w: w, h: h, tilt: shape.tilt, alpha: 1, depth: c.z)
    }

    private static func nonZero(_ v: Double) -> Double { v == 0 || v.isNaN ? -1e-6 : v }

    /// The face's middle at rest (no look, no face of its own): where a turn is measured from (`solveRest`).
    private static func restMid(_ roll: Double) -> CGPoint {
        let yaw = ShapeEngineData.head.yaw
        let pitch = ShapeEngineData.head.pitch + ShapeEngineData.faceDrop
        let eye = ShapeEngineData.expressions[.neutral]!.left
        return placeEye(yaw, pitch, roll, eye, 1).center
    }

    /// Half the width of a path body (box units) on the row through `at`, from the inside run that holds `at` (`outlineHalfWidth`).
    static func outlineHalfWidth(_ outline: [CGPoint], _ at: CGPoint) -> Double {
        let x = Double(at.x), y = Double(at.y)
        guard ShapeAvatarOutline.pointInsideOutline(outline, x: x, y: y) else { return 0 }
        func reach(_ dir: Double) -> Double {
            var lo = 0.0, hi = 60.0
            for _ in 0..<18 {
                let mid = (lo + hi) / 2
                if ShapeAvatarOutline.pointInsideOutline(outline, x: x + dir * mid, y: y) { lo = mid } else { hi = mid }
            }
            return lo
        }
        return (reach(1) + reach(-1)) / 2
    }

    /// Both eyes for a face on a body (`solveEyes`): one level pair, inside the outline, never touching.
    /// `anchor` is where the face rests on this body (R, shared/mascot-geometry.json).
    /// `outline` is a path body's silhouette (box units); a polar body passes nil.
    public static func solveEyes(_ radii: [Double], _ face: ShapeFace, gaze: (yaw: Double, pitch: Double, roll: Double), open: (left: Double, right: Double),
                                 anchor: (x: Double, y: Double) = ShapeEngineData.eyeShift, outline: [CGPoint]? = nil) -> [ShapePlacedEye] {
        let path = outline.flatMap { $0.count >= 3 ? $0 : nil }
        let yaw = ShapeEngineData.head.yaw + face.yaw + gaze.yaw
        let pitch = ShapeEngineData.head.pitch + ShapeEngineData.faceDrop + face.pitch + gaze.pitch
        let roll = face.roll * ShapeEngineData.eyeRoll + gaze.roll
        let split = face.split * ShapeEngineData.eyeSpread
        let left = placeEye(yaw - split, pitch, roll, face.left, face.left.open * open.left)
        let right = placeEye(yaw + split, pitch, roll, face.right, face.right.open * open.right)
        // the face seen from the front: its middle rests at the anchor and moves as much as the head's turn moves it
        let mid = CGPoint(x: (left.center.x + right.center.x) / 2, y: (left.center.y + right.center.y) / 2)
        let rest = restMid(roll)
        // a path body's width is read on its own outline, across the face's row: its polar
        // radii from the box's middle can miss the body there (a sprout's leaf seam, a tin's
        // narrow can), which gathered the eyes until they no longer fit apart (2026-11-01)
        let spread = path.map { outlineHalfWidth($0, ShapeMath.toBox(CGPoint(x: anchor.x, y: anchor.y))) / ShapeEngineData.bodyUnit }
            ?? ShapeMath.radiusToward(radii, 1, 0) * 0.5 + ShapeMath.radiusToward(radii, -1, 0) * 0.5
        let sx = max(0.35, min(1.25, spread))
        let target = CGPoint(x: anchor.x + (mid.x - rest.x) * ShapeEngineData.eyeGaze,
                             y: anchor.y + (mid.y - rest.y) * ShapeEngineData.eyeGaze)
        func place(_ eye: ShapePlacedEye, _ s: Double, _ k: Double = 1) -> ShapePlacedEye {
            let nx = target.x * s + (eye.center.x - mid.x) * sx
            let ny = target.y * s
            var out = eye
            out.center = CGPoint(x: nx, y: ny)
            out.w = eye.w * k
            out.h = eye.h * k
            out.points = eyeOutline(nx, ny, out.w, out.h, eye.tilt)
            return out
        }
        func apart(_ eyes: [ShapePlacedEye]) -> Bool {
            guard eyes.count == 2 else { return true }
            return abs(eyes[1].center.x - eyes[0].center.x) >= (eyes[0].w + eyes[1].w) / 2 + ShapeEngineData.eyeGap * max(eyes[0].w, eyes[1].w)
        }
        // A path body (an object silhouette) is not star-shaped around the box's middle: a
        // sprout's leaves pinch there, so its polar radii say "nothing fits" and the eyes
        // collapsed to a dot (2026-11-01). Such a body is tested against its own outline,
        // each eye point keeping eyeMargin inside in every direction.
        let margin = ShapeEngineData.eyeMargin * ShapeEngineData.bodyUnit
        let probes: [(Double, Double)] = [(0, 0), (margin, 0), (-margin, 0), (0, margin), (0, -margin)]
        func inside(_ p: CGPoint) -> Bool {
            guard let path else {
                return hypot(p.x, p.y) <= ShapeMath.radiusToward(radii, p.x, nonZero(p.y)) - ShapeEngineData.eyeMargin
            }
            let b = ShapeMath.toBox(p)
            return probes.allSatisfy { d in ShapeAvatarOutline.pointInsideOutline(path, x: Double(b.x) + d.0, y: Double(b.y) + d.1) }
        }
        func fits(_ eyes: [ShapePlacedEye]) -> Bool {
            apart(eyes) && eyes.allSatisfy { e in e.points.allSatisfy(inside) }
        }
        // the eyes' distance does not move with the face (only their size does): a narrow path body
        // that keeps them too close shrinks them first, so the face stays at its own anchor instead of
        // collapsing to the box's middle (a tin, a ship, 2026-11-01). A polar body keeps k = 1.
        var start = 1.0
        if path != nil {
            while start > 0.1, !apart([place(left, 1, start), place(right, 1, start)]) { start *= 0.9 }
        }
        var lo = 0.0, hi = 1.0
        if !fits([place(left, 1, start), place(right, 1, start)]) {
            for _ in 0..<18 {
                let s = (lo + hi) / 2
                if fits([place(left, s, start), place(right, s, start)]) { lo = s } else { hi = s }
            }
            hi = lo
        }
        var placed = [place(left, hi, start), place(right, hi, start)]
        // a body too small for these eyes even with the face in the middle: shrink both eyes alike
        var shrink = start
        while shrink > 0.1, !fits(placed) {
            shrink *= 0.9
            placed = [place(left, hi, shrink), place(right, hi, shrink)]
        }
        return placed
    }
}

/// The pumpkin's stem (`stemPath`): a short dark stalk standing in the dip on
/// top, leaning a little to the left, riding on the body's top radius.
public enum ShapeStem {
    public static func points(_ radii: [Double]) -> [CGPoint] {
        let k = ShapeEngineData.stem
        let top = ShapeMath.radiusAt(radii, 0)
        let foot = CGPoint(x: k.footX, y: -top + k.sink)
        let tip = CGPoint(x: foot.x + k.tipX, y: foot.y + k.tipY)
        let control = CGPoint(x: (foot.x + tip.x) / 2 + k.bow, y: (foot.y + tip.y) / 2)
        func at(_ t: Double) -> CGPoint {
            let a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t
            return CGPoint(x: a * foot.x + b * control.x + c * tip.x, y: a * foot.y + b * control.y + c * tip.y)
        }
        let steps = [0, 0.35, 0.7, 1.0]
        func side(_ sign: Double) -> [CGPoint] {
            steps.map { t in
                let p = at(t), p2 = at(min(1, t + 0.01)), p1 = at(max(0, t - 0.01))
                let dx = p2.x - p1.x, dy = p2.y - p1.y
                let len = hypot(dx, dy) == 0 ? 1 : hypot(dx, dy)
                let half = k.footWidth + (k.tipWidth - k.footWidth) * t
                return CGPoint(x: p.x + (-dy / len) * half * sign, y: p.y + (dx / len) * half * sign)
            }
        }
        let left = side(1)
        let right = Array(side(-1).reversed())
        let t1 = at(1), t0 = at(0.97)
        let len = hypot(t1.x - t0.x, t1.y - t0.y) == 0 ? 1 : hypot(t1.x - t0.x, t1.y - t0.y)
        let cap = CGPoint(x: t1.x + (t1.x - t0.x) / len * k.tipWidth * 0.8, y: t1.y + (t1.y - t0.y) / len * k.tipWidth * 0.8)
        return (left + [cap] + right).map(ShapeMath.toBox)
    }
}

// MARK: - Composing a frame

public enum ShapeFrames {
    struct PathOutline {
        var path: String
        var extras: [String]
        var points: [CGPoint]
        var face: CGPoint
        var morphing: Bool
    }

    struct Inputs {
        /// The body the face anchor is read for.
        var shape: MascotShape
        var radii: [Double]
        var rest: [Double]
        var face: ShapeFace
        var gaze: (yaw: Double, pitch: Double, roll: Double)
        var open: (left: Double, right: Double)
        var color: String
        var body: (x: Double, y: Double, rot: Double, sx: Double, sy: Double)
        var eyes: Double
        var pose: (pose: ShapeMovePose, weight: Double)?
        var t: Double
        /// How much of the pumpkin's stem shows (0 for every other body).
        var stem: Double = 0
        /// Path body: exact silhouette (and morph points). When set, frame.body prefers path.
        var outline: PathOutline? = nil
    }

    /// The body's thickness now (`bodyDepth`): its thinnest half-width over
    /// `depthFull`, measured on its own radii (a naturally thin body thins its
    /// slices too, or they spread wider than it and it comes apart).
    public static func bodyDepth(_ radii: [Double]) -> Double {
        guard let thinnest = radii.min() else { return 1 }
        return ShapeMath.clamp01(thinnest / ShapeEngineData.depthFull)
    }

    public static func blend(_ a: ShapeFace, _ b: ShapeFace, _ t: Double) -> ShapeFace {
        func eye(_ x: ShapeEye, _ y: ShapeEye) -> ShapeEye {
            ShapeEye(w: ShapeMath.lerp(x.w, y.w, t), h: ShapeMath.lerp(x.h, y.h, t), tilt: ShapeMath.lerp(x.tilt, y.tilt, t), open: ShapeMath.lerp(x.open, y.open, t))
        }
        return ShapeFace(yaw: ShapeMath.lerp(a.yaw, b.yaw, t), pitch: ShapeMath.lerp(a.pitch, b.pitch, t), roll: ShapeMath.lerp(a.roll, b.roll, t),
                         split: ShapeMath.lerp(a.split, b.split, t), left: eye(a.left, b.left), right: eye(a.right, b.right))
    }

    static func compose(_ input: Inputs) -> ShapeFrame {
        let unit = ShapeEngineData.bodyUnit
        let pathFace: (x: Double, y: Double)? = input.outline.map {
            (($0.face.x - ShapeEngineData.bodyCenter.x) / unit, ($0.face.y - ShapeEngineData.bodyCenter.y) / unit)
        }
        let anchor = pathFace ?? ShapeEngineData.faceAnchor[input.shape] ?? ShapeEngineData.eyeShift
        let placed = input.eyes > 0.02 ? ShapeGaze.solveEyes(input.radii, input.face, gaze: input.gaze, open: input.open, anchor: anchor, outline: input.outline?.points) : []
        // eyes fading out with a move shrink to nothing about their middle (no move does any more)
        let s = ShapeMath.clamp01(input.eyes)
        let shown = placed.map { e -> ShapePlacedEye in
            guard s < 1 else { return e }
            var out = e
            out.alpha = e.alpha * s
            out.w = e.w * s
            out.h = e.h * s
            out.points = ShapeGaze.eyeOutline(e.center.x, e.center.y, out.w, out.h, e.tilt)
            return out
        }
        let round3 = { (v: Double) in ShapeMath.jsRound(v * 1000) / 1000 }
        let eyeShapes = shown.filter { $0.alpha > 0.001 }.map { e -> ShapeEyeBox in
            let b = ShapeMath.toBox(e.center)
            return ShapeEyeBox(x: round3(b.x), y: round3(b.y), w: round3(e.w * ShapeEngineData.bodyUnit), h: round3(e.h * ShapeEngineData.bodyUnit), tilt: e.tilt)
        }
        let c = ShapeEngineData.bodyCenter
        let morphed = ShapeMath.clamp01(zip(input.radii, input.rest).reduce(0) { max($0, abs($1.0 - $1.1)) } / 0.08)
        let depth = ShapeFrames.bodyDepth(input.radii)
        let w = input.pose?.weight ?? 0
        let pose = input.pose?.pose
        let dots = (pose?.dots ?? []).map { dot -> ShapeDot in
            let p = ShapeMath.toBox(CGPoint(x: dot.x, y: dot.y))
            return ShapeDot(x: p.x, y: p.y, r: dot.r * unit * w, opacity: dot.opacity * w)
        }
        let specks = (pose?.specks ?? []).map { speck -> ShapeDot in
            let p = ShapeMath.toBox(CGPoint(x: speck.x, y: speck.y))
            return ShapeDot(x: p.x, y: p.y, r: speck.r * unit, opacity: speck.opacity * w)
        }
        var badge: (x: Double, y: Double, r: Double, notch: Double)?
        if let b = pose?.badge, b.scale > 0.001 {
            let a = b.angle * ShapeMath.rad
            let edge = ShapeMath.radiusToward(input.radii, sin(a), -cos(a)) * 0.93
            let p = ShapeMath.toBox(CGPoint(x: sin(a) * edge, y: -cos(a) * edge))
            badge = (x: Double(p.x), y: Double(p.y), r: b.r * unit * b.scale * w, notch: 0.054 * unit * w)
        }
        let rings = (pose?.rings ?? []).map { ShapeMoves.ringAt($0.spec, input.t, $0.opacity * w, center: CGPoint(x: input.body.x, y: input.body.y)) }
        let ribbons = (pose?.ribbons ?? []).map { ribbon -> ShapeRibbonDraw in
            var out = ribbon
            out.opacity = ribbon.opacity * w
            return out
        }
        let marks = (pose?.marks ?? []).map { mark in
            ShapeMark(points: mark.points.map(ShapeMath.toBox), opacity: round3(mark.opacity * w))
        }.filter { $0.opacity > 0.001 }
        let n = Double(input.radii.count)
        let polarBody = input.radii.enumerated().map { i, r in
            ShapeMath.toBox(CGPoint(x: r * sin(Double(i) / n * Double.pi * 2), y: -r * cos(Double(i) / n * Double.pi * 2)))
        }
        let body = input.outline?.points ?? polarBody
        return ShapeFrame(
            body: body,
            bodyPath: input.outline?.path,
            bodyExtras: input.outline?.extras ?? [],
            pathMorphing: input.outline?.morphing ?? false,
            eyes: shown.filter { $0.alpha > 0.001 }.map { $0.points.map(ShapeMath.toBox) },
            eyeShapes: eyeShapes,
            stem: input.stem > 0.01 ? (ShapeStem.points(input.radii), round3(input.stem)) : nil,
            x: input.body.x, y: input.body.y, rot: input.body.rot, sx: input.body.sx, sy: input.body.sy,
            color: input.color, morphed: morphed, depth: depth,
            light: (c.x + ShapeEngineData.clayLight.x * unit, c.y + ShapeEngineData.clayLight.y * unit, ShapeEngineData.clayLight.r * unit),
            dots: dots, specks: specks, badge: badge, marks: marks, rings: rings, ribbons: ribbons
        )
    }

    /// The still frames already composed, per shape and face.
    private final class Stills: @unchecked Sendable {
        let lock = NSLock()
        var frames: [String: ShapeFrame] = [:]
    }

    private static let stills = Stills()

    private static func pathInputs(shape: MascotShape, avatarDef: ShapeAvatarDef?) -> (radii: [Double], rest: [Double], outline: PathOutline?, stem: Double) {
        // Polar catalog stays when no avatarDef is passed (regression / thumbnails).
        // Callers that want object path bodies (ShapeMascotView) pass a resolved def.
        if let def = avatarDef {
            let live = ShapeAvatarOutline.liveOutline(from: def)
            if live.pathBody {
                let radii = ShapeAvatarOutline.radiiFromOutlinePoints(live.points)
                return (
                    radii,
                    radii,
                    PathOutline(path: live.path, extras: live.extras, points: live.points, face: live.face, morphing: false),
                    0
                )
            }
        }
        let radii = ShapeEngineData.radii[shape] ?? ShapeEngineData.radii[.circle]!
        return (radii, radii, nil, ShapeEngine.stemOf(shape))
    }

    /// Le repos d'une forme avec les yeux ouverts de `open` (0...1) : un clignement
    /// des petites tailles (`gazeFrame` avec `open` sur le desktop). Mémoïsé
    /// seulement à `open` 1 (le still ordinaire).
    public static func still(_ shape: MascotShape, _ expression: ShapeExpression, color: String, open: Double, avatarDef: ShapeAvatarDef? = nil) -> ShapeFrame {
        if open >= 1 { return still(shape, expression, color: color, avatarDef: avatarDef) }
        let path = pathInputs(shape: shape, avatarDef: avatarDef)
        return compose(Inputs(shape: shape, radii: path.radii, rest: path.rest, face: ShapeEngineData.expressions[expression]!, gaze: (0, 0, 0), open: (open, open),
                              color: color, body: (0, 0, 0, 1, 1), eyes: 1, pose: nil, t: 0, stem: path.stem, outline: path.outline))
    }

    /// The resting frame looking toward a pointer (-1...1 each axis), with a rigid lean on the body (`gazeFrame`).
    public static func gaze(_ shape: MascotShape, _ expression: ShapeExpression, color: String, nx: Double, ny: Double,
                            body: (rot: Double, sx: Double, sy: Double) = (0, 1, 1), open: (left: Double, right: Double) = (1, 1),
                            avatarDef: ShapeAvatarDef? = nil) -> ShapeFrame {
        let path = pathInputs(shape: shape, avatarDef: avatarDef)
        let look = ShapeIdle.hoverGaze(nx, ny)
        return compose(Inputs(shape: shape, radii: path.radii, rest: path.rest, face: ShapeEngineData.expressions[expression]!, gaze: (look.yaw, look.pitch, 0), open: open,
                              color: color, body: (0, 0, body.rot, body.sx, body.sy), eyes: 1, pose: nil, t: 0, stem: path.stem, outline: path.outline))
    }

    /// The resting frame of a shape: no wander, no blink, no move (`stillFrame`).
    /// Memoised per shape and face for polar bodies; path bodies include the def id.
    public static func still(_ shape: MascotShape, _ expression: ShapeExpression, color: String = "#000000", avatarDef: ShapeAvatarDef? = nil) -> ShapeFrame {
        // Only an explicit avatarDef switches the cache lane; object presets are not implied.
        // a def without an id keys on its own value: two custom bodies never share a still
        let defKey = avatarDef.map { $0.id ?? "custom-\($0.hashValue)" } ?? "polar"
        let key = "\(shape.rawValue)|\(expression.rawValue)|\(defKey)"
        stills.lock.lock()
        let cached = stills.frames[key]
        stills.lock.unlock()
        var frame: ShapeFrame
        if let cached {
            frame = cached
        } else {
            let path = pathInputs(shape: shape, avatarDef: avatarDef)
            frame = compose(Inputs(shape: shape, radii: path.radii, rest: path.rest, face: ShapeEngineData.expressions[expression]!, gaze: (0, 0, 0), open: (1, 1),
                                   color: color, body: (0, 0, 0, 1, 1), eyes: 1, pose: nil, t: 0, stem: path.stem, outline: path.outline))
            stills.lock.lock()
            stills.frames[key] = frame
            stills.lock.unlock()
        }
        frame.color = color
        return frame
    }
}

// MARK: - The live engine

/// What a shape shows: its body, face and colour.
public struct ShapeEngineState: Equatable, Sendable {
    public var shape: MascotShape
    public var expression: ShapeExpression
    public var color: String
    /// Path-based body from a portable avatarDef (v2.1).
    public var avatarDef: ShapeAvatarDef?

    public init(shape: MascotShape, expression: ShapeExpression, color: String, avatarDef: ShapeAvatarDef? = nil) {
        self.shape = shape
        self.expression = expression
        self.color = color
        self.avatarDef = avatarDef
    }
}

/// One live shape (`ShapeEngine`): what is sliding, the blink schedule, the
/// pointer turn and the move playing; draws a frame for any moment. Times are
/// seconds on one clock.
public final class ShapeEngine {
    private let seed: Double
    private var blinks: [Double] = []
    private var blinkHorizon = 0.0
    private let start: Double
    public private(set) var state: ShapeEngineState
    private var fromRadii: [Double]
    private var fromOutline: [CGPoint]?
    private var shapeAt = -Double.infinity
    private var fromFace: ShapeFace
    private var faceAt = -Double.infinity
    private var fromColor: String
    private var colorAt = -Double.infinity
    private var fromStem: Double
    private var move: (id: ShapeMove, at: Double)?
    private let yaw = ShapeFollower(0)
    private let pitch = ShapeFollower(0)
    /// 1 while the gaze wanders, 0 while it follows the pointer.
    private let wanders = ShapeFollower(1)
    /// The body's lean (ShapeMotion), degrees off the rest turn: the gaze follows it, the outline never bends for it.
    private var leanGaze = (yaw: 0.0, pitch: 0.0)
    private var last: Double?

    public init(_ state: ShapeEngineState, now: Double, seed: Double = Double.random(in: 0..<1000)) {
        self.seed = seed
        self.state = state
        self.start = now
        let live = Self.outline(for: state)
        fromRadii = live.map { ShapeAvatarOutline.radiiFromOutlinePoints($0.points) } ?? Self.radii(state.shape)
        fromOutline = live?.points
        fromFace = ShapeEngineData.expressions[state.expression]!
        fromColor = state.color
        fromStem = Self.stemOf(state.shape)
    }

    /// Whether a body wears the pumpkin's stem (1) or not (0).
    static func stemOf(_ shape: MascotShape) -> Double { shape == .pumpkin ? 1 : 0 }

    private static func radii(_ shape: MascotShape) -> [Double] { ShapeEngineData.radii[shape] ?? ShapeEngineData.radii[.circle]! }

    /// Live outline cache for a path-bodied avatarDef (explicit def only).
    static func outline(for state: ShapeEngineState) -> ShapeAvatarOutline.Live? {
        guard let def = state.avatarDef else { return nil }
        let live = ShapeAvatarOutline.liveOutline(from: def)
        return live.pathBody ? live : nil
    }

    private static func bodyFingerprint(_ def: ShapeAvatarDef?) -> String {
        guard let def else { return "" }
        switch def.body {
        case let .path(d): return "path:\(d)"
        case let .parts(parts): return "parts:\(parts.count):\(parts.map(ShapeAvatarCompile.primitivePath).joined())"
        case let .radii(values): return "radii:\(values.map { String($0) }.joined(separator: ","))"
        }
    }

    /// The current shape, face and colour; a change slides from what shows now.
    public func set(_ next: ShapeEngineState, now: Double) {
        let shapeChanged = next.shape != state.shape
            || (next.avatarDef?.id ?? "") != (state.avatarDef?.id ?? "")
            || Self.bodyFingerprint(next.avatarDef) != Self.bodyFingerprint(state.avatarDef)
        if shapeChanged {
            fromRadii = radiiNow(now)
            fromOutline = outlinePointsNow(now)
            fromStem = stemNow(now)
            shapeAt = now
        }
        if next.expression != state.expression {
            fromFace = faceNow(now)
            faceAt = now
        }
        if next.color.lowercased() != state.color.lowercased() {
            fromColor = colorNow(now)
            colorAt = now
        }
        state = next
    }

    /// The pointer around the mascot (-1...1 each axis, y down), or nil when it left.
    public func pointer(_ at: CGPoint?) {
        guard let at else {
            yaw.target = 0
            pitch.target = 0
            wanders.target = 1
            return
        }
        let gaze = ShapeIdle.hoverGaze(at.x, at.y)
        yaw.target = gaze.yaw
        pitch.target = gaze.pitch
        wanders.target = 0
    }

    public func play(_ move: ShapeMove, now: Double) {
        self.move = (move, now)
    }

    /// Where the body's own motion leans (yaw right, pitch up, degrees off the
    /// rest turn): the face looks that way (`leanGaze` of it), so a sway reads
    /// on the eyes while the outline keeps its one resting turn (`lean`).
    public func lean(yaw: Double, pitch: Double) {
        leanGaze = (yaw * ShapeEngineData.leanGaze, pitch * ShapeEngineData.leanGaze)
    }

    /// Whether a move still plays at `now`.
    public func playing(_ now: Double) -> Bool {
        guard let move else { return false }
        return now - move.at <= ShapeMoves.length(move.id)
    }

    private func targetOutline() -> ShapeAvatarOutline.Live? { Self.outline(for: state) }

    private func targetRadii() -> [Double] {
        if let live = targetOutline() {
            return ShapeAvatarOutline.radiiFromOutlinePoints(live.points)
        }
        return Self.radii(state.shape)
    }

    private func outlinePointsNow(_ now: Double) -> [CGPoint]? {
        let to = targetOutline()
        let k = ShapeMath.easeOutQuint((now - shapeAt) / ShapeEngineData.morphSeconds)
        if fromOutline == nil && to == nil { return nil }
        let from = fromOutline ?? to?.points
        let dest = to?.points ?? fromOutline
        guard let from, let dest else { return nil }
        return k >= 1 ? dest : ShapeAvatarOutline.blendOutlines(from, dest, k)
    }

    private func radiiNow(_ now: Double) -> [Double] {
        let k = ShapeMath.easeOutQuint((now - shapeAt) / ShapeEngineData.morphSeconds)
        let to = targetRadii()
        return k >= 1 ? to : ShapeMath.blendRadii(fromRadii, to, k)
    }

    /// How much of the pumpkin's stem shows: it grows in and out with a change of shape.
    private func stemNow(_ now: Double) -> Double {
        let k = ShapeMath.easeOutQuint((now - shapeAt) / ShapeEngineData.morphSeconds)
        return ShapeMath.lerp(fromStem, Self.stemOf(state.shape), k)
    }

    private func faceNow(_ now: Double) -> ShapeFace {
        let k = ShapeMath.easeOutQuint((now - faceAt) / ShapeEngineData.morphSeconds)
        let target = ShapeEngineData.expressions[state.expression]!
        return k >= 1 ? target : ShapeFrames.blend(fromFace, target, k)
    }

    private func colorNow(_ now: Double) -> String {
        let k = ShapeMath.easeOutQuint((now - colorAt) / ShapeEngineData.morphSeconds)
        return k >= 1 ? state.color : ShapeMath.mixHex(fromColor, state.color, k)
    }

    /// The frame at `now`.
    public func frame(_ now: Double) -> ShapeFrame {
        let dt = last.map { min(0.1, max(0, now - $0)) } ?? 0
        last = now
        let t = now - start
        if t + 6 > blinkHorizon {
            blinkHorizon = t + 30
            blinks = ShapeIdle.blinkSchedule(seed, until: blinkHorizon)
        }
        let yawNow = yaw.step(dt)
        let pitchNow = pitch.step(dt)
        let wanderWeight = wanders.step(dt)
        let w = ShapeIdle.wander(t, seed)
        let body = ShapeIdle.drift(t, seed)
        let rest = radiiNow(now)
        var radii = rest
        var face = faceNow(now)
        let blink = ShapeIdle.blinkOpen(t, blinks)
        var x = body.x, y = body.y, rot = 0.0, scale = 1.0, eyes = 1.0
        var pose: (pose: ShapeMovePose, weight: Double)?
        var stem = stemNow(now)
        let movePlaying = playing(now)
        if let move, movePlaying {
            let u = now - move.at
            let weight = ShapeMoves.weight(move.id, u)
            let p = ShapeMoves.at(move.id, u, rest: rest)
            if let r = p.radii {
                radii = ShapeMath.blendRadii(rest, r, weight)
                // a body turned into another whole body (an egg, a hexagon) loses its stem until it comes back
                stem *= 1 - weight
            }
            if let patch = p.face { face = ShapeFrames.blend(face, patch.applied(to: face), weight) }
            x += (p.x ?? 0) * weight
            y += (p.y ?? 0) * weight
            rot = (p.rot ?? 0) * weight
            scale = ShapeMath.lerp(1, p.scale ?? 1, weight)
            eyes = ShapeMath.lerp(1, p.eyes ?? 1, weight)
            pose = (p, weight)
        }
        let live = targetOutline()
        let outlinePts = outlinePointsNow(now)
        let morphK = ShapeMath.easeOutQuint((now - shapeAt) / ShapeEngineData.morphSeconds)
        var outline: ShapeFrames.PathOutline?
        if let live, let outlinePts {
            outline = ShapeFrames.PathOutline(
                path: live.path,
                extras: live.extras,
                points: outlinePts,
                face: live.face,
                morphing: morphK < 1 || fromOutline != nil
            )
            if morphK >= 1 && !movePlaying {
                outline?.morphing = false
            }
        }
        return ShapeFrames.compose(ShapeFrames.Inputs(
            shape: state.shape, radii: radii, rest: rest, face: face,
            gaze: (w.yaw * wanderWeight + yawNow + leanGaze.yaw, w.pitch * wanderWeight + pitchNow + leanGaze.pitch, w.roll * wanderWeight),
            open: (blink, blink), color: colorNow(now),
            body: (x, y, rot, scale * (2 - body.breath), scale * body.breath),
            eyes: eyes, pose: pose, t: t, stem: live != nil ? 0 : stem,
            outline: outline
        ))
    }
}
