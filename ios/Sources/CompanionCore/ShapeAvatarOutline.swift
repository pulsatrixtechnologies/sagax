// Outline math for path-based Shape bodies (v2.1): flatten validated SVG
// paths, resample to a fixed point count for morphing, blend outlines, and
// probe containment. Port of shared/shape-avatar-outline.ts.
//
// Path bodies keep concavities and appendages the 64-radii polar form cannot
// express. Catalogue polar shapes stay on the radii pipeline.
import CoreGraphics
import Foundation

public typealias ShapeOutlinePoint = CGPoint

public enum ShapeAvatarOutline {
    public static let sampleCount = 64

    private static func round2(_ v: Double) -> Double { ShapeMath.round2(v) }

    private static func tokenizeNumbers(_ s: String) -> [Double] {
        let re = try! NSRegularExpression(pattern: #"-?\d*\.?\d+(?:e[+-]?\d+)?"#, options: [.caseInsensitive])
        let range = NSRange(s.startIndex..<s.endIndex, in: s)
        return re.matches(in: s, options: [], range: range).compactMap { match in
            guard let r = Range(match.range, in: s) else { return nil }
            return Double(s[r])
        }
    }

    private static func tokenizeCommands(_ d: String) -> [(command: Character, args: [Double])] {
        let re = try! NSRegularExpression(pattern: #"([MmLlCcQqZz])([^MmLlCcQqZz]*)"#)
        let range = NSRange(d.startIndex..<d.endIndex, in: d)
        return re.matches(in: d, options: [], range: range).compactMap { match in
            guard match.numberOfRanges >= 3,
                  let cmdRange = Range(match.range(at: 1), in: d),
                  let argsRange = Range(match.range(at: 2), in: d),
                  let command = d[cmdRange].first else { return nil }
            return (command, tokenizeNumbers(String(d[argsRange])))
        }
    }

    private static func pointLineDistance(_ p: CGPoint, _ a: CGPoint, _ b: CGPoint) -> Double {
        let dx = Double(b.x - a.x)
        let dy = Double(b.y - a.y)
        let len = hypot(dx, dy)
        if len < 1e-12 { return hypot(Double(p.x - a.x), Double(p.y - a.y)) }
        return abs(dx * Double(a.y - p.y) - dy * Double(a.x - p.x)) / len
    }

    private static func subdivideCubic(
        _ p0: CGPoint, _ p1: CGPoint, _ p2: CGPoint, _ p3: CGPoint,
        tolerance: Double, into out: inout [CGPoint], depth: Int = 0
    ) {
        let d1 = pointLineDistance(p1, p0, p3)
        let d2 = pointLineDistance(p2, p0, p3)
        if d1 + d2 < tolerance || depth > 24 {
            out.append(p3)
            return
        }
        let p01 = CGPoint(x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2)
        let p12 = CGPoint(x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2)
        let p23 = CGPoint(x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2)
        let p012 = CGPoint(x: (p01.x + p12.x) / 2, y: (p01.y + p12.y) / 2)
        let p123 = CGPoint(x: (p12.x + p23.x) / 2, y: (p12.y + p23.y) / 2)
        let mid = CGPoint(x: (p012.x + p123.x) / 2, y: (p012.y + p123.y) / 2)
        subdivideCubic(p0, p01, p012, mid, tolerance: tolerance, into: &out, depth: depth + 1)
        subdivideCubic(mid, p123, p23, p3, tolerance: tolerance, into: &out, depth: depth + 1)
    }

    private static func subdivideQuad(
        _ p0: CGPoint, _ p1: CGPoint, _ p2: CGPoint,
        tolerance: Double, into out: inout [CGPoint], depth: Int = 0
    ) {
        let d = pointLineDistance(p1, p0, p2)
        if d < tolerance || depth > 24 {
            out.append(p2)
            return
        }
        let p01 = CGPoint(x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2)
        let p12 = CGPoint(x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2)
        let mid = CGPoint(x: (p01.x + p12.x) / 2, y: (p01.y + p12.y) / 2)
        subdivideQuad(p0, p01, mid, tolerance: tolerance, into: &out, depth: depth + 1)
        subdivideQuad(mid, p12, p2, tolerance: tolerance, into: &out, depth: depth + 1)
    }

    /// Flatten absolute/relative M/L/C/Q/Z path data into polylines (one per subpath).
    public static func flattenPath(_ d: String, tolerance: Double = 0.08) -> [[CGPoint]] {
        var polylines: [[CGPoint]] = []
        var current: [CGPoint] = []
        var at = CGPoint.zero
        var start = CGPoint.zero

        for (command, args) in tokenizeCommands(d) {
            let absolute = command.isUppercase
            let letter = Character(command.uppercased())
            if letter == "M" {
                if !current.isEmpty { polylines.append(current) }
                guard args.count >= 2 else { continue }
                let x = absolute ? args[0] : Double(at.x) + args[0]
                let y = absolute ? args[1] : Double(at.y) + args[1]
                at = CGPoint(x: x, y: y)
                start = at
                current = [at]
                var i = 2
                while i + 1 < args.count {
                    let lx = absolute ? args[i] : Double(at.x) + args[i]
                    let ly = absolute ? args[i + 1] : Double(at.y) + args[i + 1]
                    at = CGPoint(x: lx, y: ly)
                    current.append(at)
                    i += 2
                }
            } else if letter == "L" {
                var i = 0
                while i + 1 < args.count {
                    let x = absolute ? args[i] : Double(at.x) + args[i]
                    let y = absolute ? args[i + 1] : Double(at.y) + args[i + 1]
                    at = CGPoint(x: x, y: y)
                    current.append(at)
                    i += 2
                }
            } else if letter == "C" {
                var i = 0
                while i + 5 < args.count {
                    let p1 = CGPoint(
                        x: absolute ? args[i] : Double(at.x) + args[i],
                        y: absolute ? args[i + 1] : Double(at.y) + args[i + 1]
                    )
                    let p2 = CGPoint(
                        x: absolute ? args[i + 2] : Double(at.x) + args[i + 2],
                        y: absolute ? args[i + 3] : Double(at.y) + args[i + 3]
                    )
                    let p3 = CGPoint(
                        x: absolute ? args[i + 4] : Double(at.x) + args[i + 4],
                        y: absolute ? args[i + 5] : Double(at.y) + args[i + 5]
                    )
                    subdivideCubic(at, p1, p2, p3, tolerance: tolerance, into: &current)
                    at = p3
                    i += 6
                }
            } else if letter == "Q" {
                var i = 0
                while i + 3 < args.count {
                    let p1 = CGPoint(
                        x: absolute ? args[i] : Double(at.x) + args[i],
                        y: absolute ? args[i + 1] : Double(at.y) + args[i + 1]
                    )
                    let p2 = CGPoint(
                        x: absolute ? args[i + 2] : Double(at.x) + args[i + 2],
                        y: absolute ? args[i + 3] : Double(at.y) + args[i + 3]
                    )
                    subdivideQuad(at, p1, p2, tolerance: tolerance, into: &current)
                    at = p2
                    i += 4
                }
            } else if letter == "Z" {
                if Swift.abs(Double(at.x - start.x)) > 1e-9 || Swift.abs(Double(at.y - start.y)) > 1e-9 {
                    current.append(start)
                    at = start
                }
            }
        }
        if !current.isEmpty { polylines.append(current) }
        return polylines
    }

    public static func polygonArea(_ points: [CGPoint]) -> Double {
        guard points.count >= 3 else { return 0 }
        var area = 0.0
        for i in points.indices {
            let a = points[i]
            let b = points[(i + 1) % points.count]
            area += Double(a.x) * Double(b.y) - Double(b.x) * Double(a.y)
        }
        return abs(area) / 2
    }

    /// Closed polyline resampled to `count` points by arc length (winding preserved).
    public static func resampleClosed(_ points: [CGPoint], count: Int = sampleCount) -> [CGPoint] {
        if points.count < 3 || count < 3 {
            return Array(repeating: CGPoint(x: 50, y: 50), count: count)
        }
        var ring = points
        let first = ring[0]
        let last = ring[ring.count - 1]
        if hypot(Double(first.x - last.x), Double(first.y - last.y)) > 1e-6 {
            ring.append(first)
        }
        var seg: [Double] = [0]
        var total = 0.0
        for i in 1..<ring.count {
            total += hypot(Double(ring[i].x - ring[i - 1].x), Double(ring[i].y - ring[i - 1].y))
            seg.append(total)
        }
        if total < 1e-6 {
            return Array(repeating: first, count: count)
        }
        var out: [CGPoint] = []
        out.reserveCapacity(count)
        for i in 0..<count {
            let target = (Double(i) / Double(count)) * total
            var j = 1
            while j < seg.count && seg[j] < target { j += 1 }
            let a = ring[j - 1]
            let b = j < ring.count ? ring[j] : ring[0]
            let t0 = seg[j - 1]
            let t1 = j < seg.count ? seg[j] : total
            let f = t1 > t0 ? (target - t0) / (t1 - t0) : 0
            out.append(CGPoint(
                x: Double(a.x) + (Double(b.x) - Double(a.x)) * f,
                y: Double(a.y) + (Double(b.y) - Double(a.y)) * f
            ))
        }
        return out
    }

    /// Smooth closed cubic path through box-unit points.
    public static func smoothClosedOutline(_ points: [CGPoint], tension: Double = 1) -> String {
        let n = points.count
        guard n >= 3 else { return "M50 50Z" }
        var d = "M\(ShapeMath.js(round2(Double(points[0].x)))) \(ShapeMath.js(round2(Double(points[0].y))))"
        for i in 0..<n {
            let p0 = points[(i - 1 + n) % n]
            let p1 = points[i]
            let p2 = points[(i + 1) % n]
            let p3 = points[(i + 2) % n]
            let c1 = CGPoint(
                x: Double(p1.x) + ((Double(p2.x) - Double(p0.x)) / 6) * tension,
                y: Double(p1.y) + ((Double(p2.y) - Double(p0.y)) / 6) * tension
            )
            let c2 = CGPoint(
                x: Double(p2.x) - ((Double(p3.x) - Double(p1.x)) / 6) * tension,
                y: Double(p2.y) - ((Double(p3.y) - Double(p1.y)) / 6) * tension
            )
            d += "C\(ShapeMath.js(round2(Double(c1.x)))) \(ShapeMath.js(round2(Double(c1.y)))) \(ShapeMath.js(round2(Double(c2.x)))) \(ShapeMath.js(round2(Double(c2.y)))) \(ShapeMath.js(round2(Double(p2.x)))) \(ShapeMath.js(round2(Double(p2.y))))"
        }
        return d + "Z"
    }

    public static func blendOutlines(_ from: [CGPoint], _ to: [CGPoint], _ t: Double) -> [CGPoint] {
        let n = min(from.count, to.count)
        return (0..<n).map { i in
            CGPoint(
                x: Double(from[i].x) + (Double(to[i].x) - Double(from[i].x)) * t,
                y: Double(from[i].y) + (Double(to[i].y) - Double(from[i].y)) * t
            )
        }
    }

    public static func pointInsideOutline(_ poly: [CGPoint], x: Double, y: Double) -> Bool {
        var hit = false
        var j = poly.count - 1
        for i in poly.indices {
            let xi = Double(poly[i].x), yi = Double(poly[i].y)
            let xj = Double(poly[j].x), yj = Double(poly[j].y)
            if (yi > y) != (yj > y), x < ((xj - xi) * (y - yi)) / (yj - yi + Double.ulpOfOne) + xi {
                hit.toggle()
            }
            j = i
        }
        return hit
    }

    public static func pointInsideOutline(_ poly: [CGPoint], _ p: CGPoint) -> Bool {
        pointInsideOutline(poly, x: Double(p.x), y: Double(p.y))
    }

    /// Ray from center (default 50,50) at angle (0 up, clockwise), farthest inside hit in box units.
    public static func rayRadiusOutline(
        _ poly: [CGPoint],
        angle: Double,
        center: CGPoint = CGPoint(x: 50, y: 50),
        reach: Double = 55
    ) -> Double {
        let dx = sin(angle)
        let dy = -cos(angle)
        var lo = 0.0
        var hi = reach
        if !pointInsideOutline(poly, x: Double(center.x) + dx * 0.5, y: Double(center.y) + dy * 0.5) {
            return 0
        }
        for _ in 0..<18 {
            let mid = (lo + hi) / 2
            if pointInsideOutline(poly, x: Double(center.x) + dx * mid, y: Double(center.y) + dy * mid) {
                lo = mid
            } else {
                hi = mid
            }
        }
        return lo
    }

    /// Align winding so sample 0 is near the top (smallest y), then clockwise.
    public static func normalizeOutlineWinding(_ points: [CGPoint]) -> [CGPoint] {
        guard points.count >= 3 else { return points }
        var top = 0
        for i in 1..<points.count {
            if points[i].y < points[top].y - 1e-6 {
                top = i
            } else if abs(Double(points[i].y - points[top].y)) < 1e-6, points[i].x < points[top].x {
                top = i
            }
        }
        var rotated = Array(points[top...]) + Array(points[..<top])
        var area = 0.0
        for i in rotated.indices {
            let a = rotated[i]
            let b = rotated[(i + 1) % rotated.count]
            area += Double(a.x) * Double(b.y) - Double(b.x) * Double(a.y)
        }
        // Positive = counter-clockwise in y-down; we want clockwise.
        if area > 0 {
            rotated = [rotated[0]] + rotated.dropFirst().reversed()
        }
        return rotated
    }

    public struct Live: Sendable {
        /// Exact silhouette path (may include appendages); used when not morphing.
        public var path: String
        /// Extra filled body pieces under the same volume transform.
        public var extras: [String]
        /// 64 points for morph / eye probes.
        public var points: [CGPoint]
        /// Face anchor in box units.
        public var face: CGPoint
        public var eye: (w: Double, h: Double, gap: Double)
        /// True when the body came from path/parts (not polar radii).
        public var pathBody: Bool
    }

    public static func silhouettePath(from def: ShapeAvatarDef) -> (path: String, extras: [String]) {
        switch def.body {
        case let .path(d):
            return (d, [])
        case let .parts(parts):
            let paths = parts.map(ShapeAvatarCompile.primitivePath)
            return (paths.first ?? "", Array(paths.dropFirst()))
        case .radii:
            return ("", [])
        }
    }

    private static func largestRing(in paths: [String]) -> [CGPoint] {
        var best: [CGPoint] = []
        var bestArea = 0.0
        for path in paths {
            for poly in flattenPath(path) {
                let area = polygonArea(poly)
                if area > bestArea {
                    best = poly
                    bestArea = area
                }
            }
        }
        return best
    }

    /// Build the live outline for an avatarDef. Radii defs leave pathBody false.
    public static func liveOutline(from def: ShapeAvatarDef, count: Int = ShapeAvatarOutline.sampleCount) -> Live {
        let compiled = ShapeAvatarCompile.compile(def)
        if case .radii = def.body {
            return Live(
                path: "",
                extras: [],
                points: Array(repeating: CGPoint(x: 50, y: 50), count: count),
                face: CGPoint(x: compiled.face.x, y: compiled.face.y),
                eye: (compiled.eye.w, compiled.eye.h, compiled.eye.gap),
                pathBody: false
            )
        }
        let silhouette = silhouettePath(from: def)
        let best = largestRing(in: [silhouette.path] + silhouette.extras)
        let points = normalizeOutlineWinding(resampleClosed(best, count: count))
        return Live(
            path: silhouette.path.isEmpty ? smoothClosedOutline(points) : silhouette.path,
            extras: silhouette.extras,
            points: points,
            face: CGPoint(x: compiled.face.x, y: compiled.face.y),
            eye: (compiled.eye.w, compiled.eye.h, compiled.eye.gap),
            pathBody: true
        )
    }

    /// Sample any closed path string to N morph points (largest-area subpath).
    public static func samplePathToOutline(_ d: String, count: Int = sampleCount) -> [CGPoint] {
        let best = largestRing(in: [d])
        return normalizeOutlineWinding(resampleClosed(best, count: count))
    }

    /// Approximate polar radii (R units, BODY.unit = 40) from an outline in box units.
    public static func radiiFromOutlinePoints(
        _ points: [CGPoint],
        count: Int = sampleCount,
        center: CGPoint = CGPoint(x: 50, y: 50),
        unit: Double = 40
    ) -> [Double] {
        (0..<count).map { i in
            let angle = (Double(i) / Double(count)) * Double.pi * 2
            let box = rayRadiusOutline(points, angle: angle, center: center)
            return max(0.3, min(1.4, box / unit))
        }
    }
}
