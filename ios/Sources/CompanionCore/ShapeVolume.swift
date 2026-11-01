// The shapes in volume on the phone: a port of the desktop's
// `src/components/shape-volume.ts` (2026-10-18, #786; one drawing since
// 2026-10-28), its numbers generated into `ShapeVolumeData` from the
// desktop's own module, and checked against what the desktop draws
// (Fixtures/shape-volume.json, ShapeVolumeTests).
//
// - The body is a few slices of one outline, stacked in depth and turned
//   with the pose (a little roll; the yaw and pitch are the resting turn,
//   always), so it shows a side. The slices' depth scales with the body's
//   thickness (`ShapeFrame.depth`), so a thin body stays one body.
// - The resting turn bends the outline in a gentle perspective (`warp`):
//   the shape rounds into it and its top stays on top. A sway or a move
//   never bends it further: the body keeps its proportions.
// - Two opaque eyes in a solid ink (dark, or light on a dark body), capsules
//   at rest, wide ovals while busy, full arches when pleased (`faceEyes`),
//   in the face's own space: they go through the very same transforms as
//   the outline, so nothing can ever put them beside it.
// - Every shape stands on the same ground (`groundLift`) at a size of its
//   own (`fit`), so a list of bots rests on one line.
// `drawShape` turns a frame and a pose into the one drawing
// ShapeMascotView.swift puts on screen; ShapeMotion.swift moves the pose.
import CoreGraphics
import Foundation

/// A pose at one moment: the turn (degrees), the scale and a small lift
/// (box units, up is negative).
public struct ShapePose: Equatable, Sendable {
    public var yaw, pitch, roll, scale, lift: Double

    public init(yaw: Double, pitch: Double, roll: Double, scale: Double, lift: Double) {
        self.yaw = yaw
        self.pitch = pitch
        self.roll = roll
        self.scale = scale
        self.lift = lift
    }
}

/// How many slices a size draws (`VolumeDetail`).
public enum ShapeVolumeDetail: String, CaseIterable, Sendable {
    case tiny, small, full

    /// `volumeDetail`.
    public static func of(_ size: Double) -> ShapeVolumeDetail {
        if size < ShapeVolumeData.sizes.small { return .tiny }
        if size < ShapeVolumeData.sizes.full { return .small }
        return .full
    }
}

/// How a mood draws the eyes (`EyeStyle`).
public enum ShapeEyeStyle: String, CaseIterable, Sendable {
    case capsule, oval, arc
}

/// Every matrix of one pose: the slices behind the face (back to front) and the face (`PoseMatrices`).
public struct ShapePoseMatrices: Sendable {
    public var slices: [CGAffineTransform]
    public var face: CGAffineTransform
}

/// A closed smooth outline as cubic segments (`smoothClosed`), so the bend
/// moves every point the desktop's path string holds, control points included.
public struct ShapeOutline: Sendable {
    public var start: CGPoint
    public var segments: [(c1: CGPoint, c2: CGPoint, to: CGPoint)]

    public init(start: CGPoint, segments: [(c1: CGPoint, c2: CGPoint, to: CGPoint)]) {
        self.start = start
        self.segments = segments
    }

    public init?(points: [CGPoint]) {
        guard let first = points.first else { return nil }
        start = first
        segments = ShapeMath.smoothSegments(points)
    }

    /// Every point the path names (the start, then each segment's three).
    public var allPoints: [CGPoint] { [start] + segments.flatMap { [$0.c1, $0.c2, $0.to] } }

    /// The on-curve points as the desktop reads them back from the path it
    /// wrote (`outlinePoints`: M, then each C's end point), two decimals.
    public var onCurve: [CGPoint] {
        let r2 = { (v: CGFloat) in CGFloat(ShapeMath.round2(Double(v))) }
        return ([start] + segments.map(\.to)).map { CGPoint(x: r2($0.x), y: r2($0.y)) }
    }

    public func mapped(_ f: (CGPoint) -> CGPoint) -> ShapeOutline {
        ShapeOutline(start: f(start), segments: segments.map { (f($0.c1), f($0.c2), f($0.to)) })
    }

    /// Every point at two decimals: the outline as the desktop's path string holds it before a bend.
    public var rounded: ShapeOutline {
        mapped { CGPoint(x: ShapeMath.round2(Double($0.x)), y: ShapeMath.round2(Double($0.y))) }
    }

    public func add(to path: CGMutablePath) {
        path.move(to: start)
        for s in segments { path.addCurve(to: s.to, control1: s.c1, control2: s.c2) }
        path.closeSubpath()
    }

    /// As the desktop writes it (two decimals).
    public var d: String {
        let f = { (v: CGFloat) in ShapeMath.js(ShapeMath.round2(Double(v))) }
        var out = "M\(f(start.x)) \(f(start.y))"
        for s in segments { out += "C\(f(s.c1.x)) \(f(s.c1.y)) \(f(s.c2.x)) \(f(s.c2.y)) \(f(s.to.x)) \(f(s.to.y))" }
        return out + "Z"
    }
}

/// One eye as the drawing shows it (`StyledEye`): a capsule (the engine's
/// own), a wide oval (busy) or an arch (pleased), about its middle; or a
/// capsule the engine already drew, as its outline (the flat skins' eyes).
public enum ShapeStyledEye: Sendable {
    case capsule(cx: Double, cy: Double, w: Double, h: Double, tilt: Double)
    case oval(cx: Double, cy: Double, rx: Double, ry: Double)
    /// The pleased arch: a half ellipse hw x hh over its baseline y, with the inner half ellipse ix x iy back.
    /// `cy` is the eye's own middle, which a shrink is measured from.
    case arc(cx: Double, cy: Double, y: Double, hw: Double, hh: Double, ix: Double, iy: Double)
    case outline(ShapeOutline)
}

/// The paints of one body colour (`InkPaint`).
public struct ShapeInkPaint: Equatable, Sendable {
    public var fill: String
    /// The side's fill (the slices): tinted a little toward the edge ink on a near-white or near-black body.
    public var side: String
    /// A faint hairline for a near-white or near-black face, else nil.
    public var edge: String?
    public var eyes: String
}

/// One drawing of a shape (`ShapeDrawing`): everything the picture shows, in
/// the face's own space (box units) plus the matrices that place it.
public struct ShapeDrawing: Sendable {
    /// The outline, bent with the resting turn (a plain body) or flat (a skin's own art).
    /// Largest ring (eye probes / slices). Path bodies may also set `pathD`.
    public var outline: ShapeOutline
    /// Exact warped path string when a path body is live (may be multi-subpath; evenodd).
    public var pathD: String? = nil
    /// Extra warped filled body pieces (parts after the first).
    public var extras: [String] = []
    /// The eyes on the outline, in the face's space, in the mood's style.
    public var eyes: [ShapeStyledEye]
    /// The pumpkin's stem in the face's space, or nil.
    public var stem: (outline: ShapeOutline, opacity: Double)?
    /// The slices behind the face (back to front) and the face.
    public var slices: [CGAffineTransform]
    public var face: CGAffineTransform
    /// The body's motion (drift, breath, a move's turn and size).
    public var motion: CGAffineTransform

    /// CGPath to fill for the body (exact path when set, else smooth outline).
    public var fillPath: CGPath {
        if let pathD, !pathD.isEmpty {
            return SVGPath.parse(pathD)
        }
        let path = CGMutablePath()
        outline.add(to: path)
        return path
    }
}

public enum ShapeVolume {
    public static var rest: ShapePose { ShapeVolumeData.rest }

    private static let rad = Double.pi / 180

    // MARK: Ground

    /// Every shape stands on the same ground: its lowest point sits where the
    /// pebble's does (stored id bean). Box units (`groundLift`).
    public static func groundLift(_ shape: MascotShape) -> Double {
        func down(_ s: MascotShape) -> Double {
            ShapeMath.radiusAt(ShapeEngineData.radii[s] ?? [], Double.pi) * (ShapeVolumeData.fit[s] ?? 1)
        }
        return ShapeVolumeData.rest.scale * 40 * (down(.blob) - down(shape))
    }

    /// A pose standing on the shared ground, at the shape's own size (`grounded`).
    public static func grounded(_ pose: ShapePose, _ shape: MascotShape) -> ShapePose {
        var out = pose
        out.scale = pose.scale * (ShapeVolumeData.fit[shape] ?? 1)
        out.lift = pose.lift + groundLift(shape)
        return out
    }

    /// The pose the body is drawn in: the resting turn out of the picture
    /// plane, whatever the sway or the move asks (`uprightPose`). A yaw or a
    /// pitch of its own keystoned the outline and spread the slices beside
    /// the face; now a lean only moves the gaze (`ShapeEngine.lean`). The
    /// roll, the scale and the lift are the pose's own.
    public static func upright(_ pose: ShapePose) -> ShapePose {
        var out = pose
        out.yaw = ShapeVolumeData.rest.yaw
        out.pitch = ShapeVolumeData.rest.pitch
        return out
    }

    // MARK: Slices

    private static func sliceScale(_ z: Double) -> Double {
        ShapeVolumeData.core + (1 - ShapeVolumeData.core) * (max(0, 1 - pow(z / ShapeVolumeData.depth, 2))).squareRoot()
    }

    private static var front: Double { ShapeVolumeData.depth * 0.82 }

    /// The slice at depth z (box units), scaled by s, around the box's middle (`sliceNumbers`).
    private static func slice(_ z: Double, _ s: Double, _ pose: ShapePose) -> CGAffineTransform {
        let k = pose.scale
        let yaw = pose.yaw * rad, pitch = pose.pitch * rad, roll = pose.roll * rad
        let squash = ShapeVolumeData.turnSquash
        let sx = s * k * (1 - squash * (1 - cos(yaw)))
        let sy = s * k * (1 - squash * (1 - cos(pitch)))
        // the depth shows toward the turn: the face moves up and right, the back down and left
        let dx = z * sin(yaw) * k
        let dy = -z * sin(pitch) * k
        let cr = cos(roll), sr = sin(roll)
        let a = cr * sx, b = sr * sx, c = -sr * sy, d = cr * sy
        let tx = cr * dx - sr * dy
        let ty = sr * dx + cr * dy
        let e = 50 + tx - (a * 50 + c * 50)
        let f = 50 + pose.lift + ty - (b * 50 + d * 50)
        return CGAffineTransform(a: a, b: b, c: c, d: d, tx: e, ty: f)
    }

    /// Every matrix of one pose (`poseMatrices`). `depth` is the body's
    /// thickness now (`ShapeFrame.depth`, 0...1). The pose's yaw and pitch
    /// are always the resting turn (`upright`).
    public static func matrices(_ detail: ShapeVolumeDetail, _ pose: ShapePose = ShapeVolumeData.rest, depth: Double = 1) -> ShapePoseMatrices {
        let p = upright(pose)
        let n = ShapeVolumeData.slices[detail] ?? 9
        let k = min(1, max(0, depth.isFinite ? depth : 1))
        let total = ShapeVolumeData.depth
        let slices = (0..<(n - 1)).map { i -> CGAffineTransform in
            let z = -total + (front + total) * Double(i) / Double(n - 1)
            return slice(z * k, sliceScale(z), p)
        }
        return ShapePoseMatrices(slices: slices, face: slice(front * k, sliceScale(front), p))
    }

    /// The face's matrix (the slice the eyes sit on), as `faceNumbers`.
    public static func face(_ pose: ShapePose, depth: Double = 1) -> CGAffineTransform {
        let k = min(1, max(0, depth.isFinite ? depth : 1))
        return slice(front * k, sliceScale(front), upright(pose))
    }

    /// The body's motion (box units: shift, turn about the middle, scale about the middle), as `motionNumbers`.
    public static func motion(_ m: (x: Double, y: Double, rot: Double, sx: Double, sy: Double)) -> CGAffineTransform {
        let r = m.rot * rad
        let a = cos(r) * m.sx, b = sin(r) * m.sx, c = -sin(r) * m.sy, d = cos(r) * m.sy
        return CGAffineTransform(a: a, b: b, c: c, d: d, tx: m.x + 50 - (a * 50 + c * 50), ty: m.y + 50 - (b * 50 + d * 50))
    }

    // MARK: The bend

    /// The bend's sines and cosines for a pose (its resting turn) (`bendOf`).
    private static func bendOf(_ pose: ShapePose) -> (sy: Double, cy: Double, sp: Double, cp: Double) {
        let p = upright(pose)
        return (sin(p.yaw * rad), cos(p.yaw * rad), sin(p.pitch * rad), cos(p.pitch * rad))
    }

    /// One point (box units) under the out-of-plane turn's sines and cosines (`warpPoint`).
    private static func warpPoint(_ p: CGPoint, _ b: (sy: Double, cy: Double, sp: Double, cp: Double)) -> CGPoint {
        let u = (Double(p.x) - 50) / 40
        let v = (Double(p.y) - 50) / 40
        let narrow = ShapeVolumeData.outOfPlane.narrow, perspective = ShapeVolumeData.outOfPlane.perspective
        let across = 1 - narrow * (1 - b.cy)
        let down = 1 - narrow * (1 - b.cp)
        let tall = 1 + perspective * u * b.sy
        let wide = 1 - perspective * v * b.sp
        return CGPoint(x: 50 + 40 * u * across * wide, y: 50 + 40 * v * down * tall)
    }

    /// One point (box units) under the pose's out-of-plane turn (its resting turn).
    public static func warp(_ p: CGPoint, _ pose: ShapePose) -> CGPoint {
        warpPoint(p, bendOf(pose))
    }

    /// An outline under the pose's out-of-plane turn (`warpPath`).
    public static func warp(_ outline: ShapeOutline, _ pose: ShapePose) -> ShapeOutline {
        let b = bendOf(pose)
        return outline.mapped { warpPoint($0, b) }
    }

    /// A path string (absolute M/C/L/Q/Z with number pairs) under the pose's out-of-plane turn.
    public static func warpPath(_ d: String, _ pose: ShapePose) -> String {
        guard !d.isEmpty else { return d }
        let b = bendOf(pose)
        let re = try! NSRegularExpression(pattern: #"([A-Za-z])|(-?\d*\.?\d+(?:e-?\d+)?)"#)
        let range = NSRange(d.startIndex..<d.endIndex, in: d)
        var out: [String] = []
        var x: Double?
        for match in re.matches(in: d, options: [], range: range) {
            guard let full = Range(match.range, in: d) else { continue }
            let token = String(d[full])
            if token.rangeOfCharacter(from: .letters) != nil {
                out.append(token)
                continue
            }
            guard let v = Double(token) else { continue }
            if x == nil {
                x = v
                continue
            }
            let warped = warpPoint(CGPoint(x: x!, y: v), b)
            let last = out.last ?? ""
            let gap = (!last.isEmpty && last.rangeOfCharacter(from: .letters) == nil) ? " " : ""
            out.append("\(gap)\(ShapeMath.js(ShapeMath.round2(Double(warped.x)))) \(ShapeMath.js(ShapeMath.round2(Double(warped.y))))")
            x = nil
        }
        return out.joined()
    }

    // MARK: Eyes

    /// `eyeStyleFor`.
    public static func eyeStyle(_ mood: ShapeMood) -> ShapeEyeStyle { ShapeVolumeData.moodEyes[mood] ?? .capsule }

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

    /// The eye scaled by `k` about its middle (an arch about the middle of its baseline) (`scaledEye`).
    private static func scaled(_ eye: ShapeStyledEye, _ k: Double) -> ShapeStyledEye {
        switch eye {
        case let .capsule(cx, cy, w, h, tilt):
            return .capsule(cx: cx, cy: cy, w: w * k, h: h * k, tilt: tilt)
        case let .oval(cx, cy, rx, ry):
            return .oval(cx: cx, cy: cy, rx: rx * k, ry: ry * k)
        case let .arc(cx, cy, y, hw, hh, ix, iy):
            return .arc(cx: cx, cy: cy, y: cy + (y - cy) * k, hw: hw * k, hh: hh * k, ix: ix * k, iy: iy * k)
        case let .outline(outline):
            return .outline(outline)
        }
    }

    /// Points along the eye's edge, to test it against the outline (`eyePoints`).
    public static func eyePoints(_ eye: ShapeStyledEye) -> [CGPoint] {
        switch eye {
        case let .capsule(cx, cy, w, h, tilt):
            return ShapeGaze.eyeOutline(cx, cy, w, h, tilt)
        case let .oval(cx, cy, rx, ry):
            return (0..<24).map { i in
                let a = Double(i) / 24 * Double.pi * 2
                return CGPoint(x: cx + rx * cos(a), y: cy + ry * sin(a))
            }
        case let .arc(cx, _, y, hw, hh, _, _):
            return (0...24).map { i in
                let a = Double.pi + Double(i) / 24 * Double.pi
                return CGPoint(x: cx + hw * cos(a), y: y + hh * sin(a))
            }
        case let .outline(outline):
            return outline.onCurve
        }
    }

    /// The pleased arch and the busy oval, built on an eye's box (`styledEye`): its width holds through a blink; its height follows the lid.
    private static func styled(_ box: (cx: Double, cy: Double, w: Double, h: Double), _ style: ShapeEyeStyle, _ gap: Double) -> ShapeStyledEye? {
        let size = max(box.w * 2.2, 0.01)
        let open = min(1, box.h / max(box.w * 1.6, 0.01))
        if style == .oval {
            let rx = min(size * 0.46, gap * 0.44)
            let ry = max(0.4, size * 0.33 * open)
            return .oval(cx: box.cx, cy: box.cy, rx: rx, ry: ry)
        }
        if style == .arc {
            // a full, thick half-moon arch, low in the face and centred on the eye
            let hw = min(max(box.w * 1.35, box.h * 0.44), gap * 0.42)
            let hh = hw * 0.9 * max(0.25, open)
            let t = max(1.2, hw * 0.72)
            return .arc(cx: box.cx, cy: box.cy, y: box.cy + size * 0.36, hw: hw, hh: hh, ix: max(0.2, hw - t), iy: max(0.15, hh - t))
        }
        return nil
    }

    /// The eyes on the face, in the face's own space (`faceEyes`): each
    /// capsule's middle bent with the outline, the capsule itself upright on
    /// screen (the pose's roll undone), the two eyes one level pair of the
    /// same size, in the mood's style; then both shrunk alike, about their
    /// middles (the largest share that fits, by bisection), until every point
    /// of them sits inside `outline` (the on-curve points of the outline the
    /// drawing shows).
    public static func faceEyes(_ frame: ShapeFrame, _ pose: ShapePose, bend: Bool, style: ShapeEyeStyle = .capsule, outline: [CGPoint] = []) -> [ShapeStyledEye] {
        guard !frame.eyeShapes.isEmpty else { return [] }
        let b = bendOf(pose)
        let tilt = bend ? -pose.roll : 0
        let centers = frame.eyeShapes.map { eye -> CGPoint in
            let p = CGPoint(x: eye.x, y: eye.y)
            return bend ? warpPoint(p, b) : p
        }
        let level: Double? = centers.count == 2 ? (Double(centers[0].y) + Double(centers[1].y)) / 2 : nil
        let capsules = frame.eyeShapes.enumerated().map { i, eye -> (cx: Double, cy: Double, w: Double, h: Double, tilt: Double) in
            (Double(centers[i].x), level ?? Double(centers[i].y), eye.w, eye.h, eye.tilt + tilt)
        }
        let gap = capsules.count > 1 ? abs(capsules[1].cx - capsules[0].cx) : Double.infinity
        var eyes: [ShapeStyledEye] = capsules.map { eye in
            let capsule = ShapeStyledEye.capsule(cx: eye.cx, cy: eye.cy, w: eye.w, h: eye.h, tilt: eye.tilt)
            if style == .capsule { return capsule }
            let pts = ShapeGaze.eyeOutline(eye.cx, eye.cy, eye.w, eye.h, eye.tilt)
            let xs = pts.map { Double($0.x) }, ys = pts.map { Double($0.y) }
            return styled((eye.cx, eye.cy, xs.max()! - xs.min()!, ys.max()! - ys.min()!), style, gap) ?? capsule
        }
        if outline.count > 2 {
            func fits(_ k: Double) -> Bool {
                eyes.allSatisfy { eye in eyePoints(scaled(eye, k)).allSatisfy { inside(outline, $0) } }
            }
            if !fits(1) {
                // the largest share of the size that fits, by bisection (an eye point moves out monotonically as it grows)
                var lo = 0.0, hi = 1.0
                for _ in 0..<8 {
                    let mid = (lo + hi) / 2
                    if fits(mid) { lo = mid } else { hi = mid }
                }
                // a hair under the largest share found, so a point between two samples stays inside too
                eyes = eyes.map { scaled($0, lo * 0.98) }
            }
        }
        return eyes
    }

    /// The eyes of a path drawn in a style (the flat skins, the phone's
    /// fixtures) (`styledEyes`): capsules are the path's own; ovals and
    /// arches are built on each eye's box.
    public static func styledEyes(_ eyes: [ShapeOutline], _ style: ShapeEyeStyle) -> [ShapeStyledEye] {
        guard style != .capsule, !eyes.isEmpty else { return eyes.map { .outline($0) } }
        let boxes = eyes.map { eye -> (cx: Double, cy: Double, w: Double, h: Double) in
            let points = eye.allPoints
            let xs = points.map { ShapeMath.round2(Double($0.x)) }, ys = points.map { ShapeMath.round2(Double($0.y)) }
            let x0 = xs.min() ?? 0, x1 = xs.max() ?? 0, y0 = ys.min() ?? 0, y1 = ys.max() ?? 0
            return ((x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0)
        }
        // two eyes never touch: an oval or an arch stays within its share of the gap between them
        let gap = boxes.count > 1 ? abs(boxes[1].cx - boxes[0].cx) : Double.infinity
        return boxes.compactMap { styled($0, style, gap) }
    }

    /// Half an ellipse over the top, from its left end to its right one (or back), as two cubic quarters.
    private static func upperHalf(_ path: CGMutablePath, cx: Double, cy: Double, rx: Double, ry: Double, leftToRight: Bool) {
        let k = 0.5522847498
        if leftToRight {
            path.addCurve(to: CGPoint(x: cx, y: cy - ry), control1: CGPoint(x: cx - rx, y: cy - k * ry), control2: CGPoint(x: cx - k * rx, y: cy - ry))
            path.addCurve(to: CGPoint(x: cx + rx, y: cy), control1: CGPoint(x: cx + k * rx, y: cy - ry), control2: CGPoint(x: cx + rx, y: cy - k * ry))
        } else {
            path.addCurve(to: CGPoint(x: cx, y: cy - ry), control1: CGPoint(x: cx + rx, y: cy - k * ry), control2: CGPoint(x: cx + k * rx, y: cy - ry))
            path.addCurve(to: CGPoint(x: cx - rx, y: cy), control1: CGPoint(x: cx - k * rx, y: cy - ry), control2: CGPoint(x: cx - rx, y: cy - k * ry))
        }
    }

    /// The styled eyes as one path to fill.
    public static func path(_ eyes: [ShapeStyledEye]) -> CGPath {
        let path = CGMutablePath()
        for eye in eyes {
            switch eye {
            case let .capsule(cx, cy, w, h, tilt):
                ShapeMath.smoothClosedPath(ShapeGaze.eyeOutline(cx, cy, w, h, tilt), into: path)
            case let .outline(outline):
                outline.add(to: path)
            case let .oval(cx, cy, rx, ry):
                path.addEllipse(in: CGRect(x: cx - rx, y: cy - ry, width: 2 * rx, height: 2 * ry))
            case let .arc(cx, _, y, hw, hh, ix, iy):
                path.move(to: CGPoint(x: cx - hw, y: y))
                upperHalf(path, cx: cx, cy: y, rx: hw, ry: hh, leftToRight: true)
                path.addLine(to: CGPoint(x: cx + ix, y: y))
                upperHalf(path, cx: cx, cy: y, rx: ix, ry: iy, leftToRight: false)
                path.closeSubpath()
            }
        }
        return path
    }

    /// The styled eyes as the desktop writes them (`eyePath`; tests).
    public static func d(_ eyes: [ShapeStyledEye]) -> String {
        let f = { (v: Double) in ShapeMath.js(ShapeMath.round2(v)) }
        return eyes.map { eye -> String in
            switch eye {
            case let .capsule(cx, cy, w, h, tilt):
                return ShapeMath.smoothClosed(ShapeGaze.eyeOutline(cx, cy, w, h, tilt))
            case let .outline(outline):
                return outline.d
            case let .oval(cx, cy, rx, ry):
                return "M\(f(cx - rx)) \(f(cy))A\(f(rx)) \(f(ry)) 0 1 0 \(f(cx + rx)) \(f(cy))A\(f(rx)) \(f(ry)) 0 1 0 \(f(cx - rx)) \(f(cy))Z"
            case let .arc(cx, _, y, hw, hh, ix, iy):
                return "M\(f(cx - hw)) \(f(y))A\(f(hw)) \(f(hh)) 0 0 1 \(f(cx + hw)) \(f(y))L\(f(cx + ix)) \(f(y))A\(f(ix)) \(f(iy)) 0 0 0 \(f(cx - ix)) \(f(y))Z"
            }
        }.joined()
    }

    // MARK: The drawing

    /// The one drawing of a frame in a pose (`drawShape`). `bend` is true for
    /// a plain body (its outline takes the resting turn's perspective; a
    /// skin's own art is drawn on the outline at rest).
    public static func drawShape(_ frame: ShapeFrame, _ pose: ShapePose, detail: ShapeVolumeDetail, style: ShapeEyeStyle = .capsule, bend: Bool = true) -> ShapeDrawing? {
        // Path body: exact silhouette when settled; resampled smooth ring while morphing.
        let pathSource: String? = {
            guard frame.bodyPath != nil || !frame.bodyExtras.isEmpty else { return nil }
            if frame.pathMorphing { return ShapeAvatarOutline.smoothClosedOutline(frame.body) }
            return frame.bodyD
        }()
        // Probe ring: frame.body points (path morph samples or polar).
        guard let flat = ShapeOutline(points: frame.body)?.rounded else { return nil }
        let m = matrices(detail, pose, depth: frame.depth)
        let outline = bend ? warp(flat, pose) : flat
        let warpedPath: String? = pathSource.map { bend ? warpPath($0, pose) : $0 }
        let warpedExtras = frame.bodyExtras.map { bend ? warpPath($0, pose) : $0 }
        let stem = frame.stem.flatMap { stem -> (outline: ShapeOutline, opacity: Double)? in
            guard let stalk = ShapeOutline(points: stem.points)?.rounded else { return nil }
            return (bend ? warp(stalk, pose) : stalk, stem.opacity)
        }
        return ShapeDrawing(
            outline: outline,
            pathD: warpedPath,
            extras: warpedExtras,
            eyes: faceEyes(frame, pose, bend: bend, style: style, outline: outline.onCurve),
            stem: stem,
            slices: m.slices,
            face: m.face,
            motion: motion(frame.motion)
        )
    }

    // MARK: Ink

    private static func luminance(_ hex: String) -> Double {
        let (r, g, b) = ShapeMath.rgb(hex)
        func channel(_ c: Double) -> Double {
            let v = c / 255
            return v <= 0.03928 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    }

    /// One body colour's paints (`inkPaint`).
    public static func ink(_ hex: String) -> ShapeInkPaint {
        let lum = luminance(hex)
        // a near-white body would vanish on a light ground, a near-black one on a dark ground:
        // a faint hairline around the face keeps its silhouette, and its side is tinted a
        // little toward the other ink (a hairline on every slice drew grey rings under a white body)
        let edge: String? = lum > 0.7 ? "#000000" : lum < 0.03 ? "#ffffff" : nil
        return ShapeInkPaint(
            fill: ShapeMath.mixHex(hex, hex, 0),
            side: edge.map { ShapeMath.mixHex(hex, $0, ShapeVolumeData.sideTint) } ?? ShapeMath.mixHex(hex, hex, 0),
            edge: edge,
            eyes: lum < 0.05 ? ShapeVolumeData.eyeInkOnDark : ShapeVolumeData.eyeInk
        )
    }
}
