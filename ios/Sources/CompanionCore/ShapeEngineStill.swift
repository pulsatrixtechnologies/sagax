// The shapes as the open-bot-avatar engine draws them (#4145, #4159; MIT,
// see NOTICE): the phone draws the very frames the desktop draws, read from
// the baked stills (ShapeEngineStillData, generated from
// src/components/shape-stills by ios-mascot-export.test.ts). A still holds a
// body's cross-sections once, then, for each of the engine's moods, the root
// motion and the shapes back to front: a cross-section placed by its matrix,
// or an eye (the engine's pill, or its happy arc) in its own plane. The
// phone never infers a body's volume: the engine did, at bake time.
//
// `readStill`, `moodFrame` and `skinFace` in src/components/shape-avatar.ts
// and ShapeMascot.tsx are what this file follows.
import CoreGraphics
import Foundation

/// The engine's moods (`AvatarMotion`).
public enum ShapeEngineMood: String, CaseIterable, Sendable {
    case idle, thinking, happy
}

public extension ShapeMood {
    /// `engineMood`: at work it thinks, done it is happy, else at rest.
    var engine: ShapeEngineMood {
        switch self {
        case .thinking, .working, .streaming, .blocked: return .thinking
        case .happy: return .happy
        case .idle, .sleeping: return .idle
        }
    }
}

public struct ShapeEngineStill: Sendable {
    /// One cross-section's outline (`StillPath`): its path, fill rule and the area of its box.
    public struct Outline: Sendable, Equatable {
        public let d: String
        public let evenOdd: Bool
        public let area: Double
    }

    /// An eye as the engine marks it (`EyeMark`), in its face plane.
    public enum Eye: Sendable, Equatable {
        case pill(x: Double, y: Double, width: Double, height: Double, radius: Double)
        case arc(d: String, strokeWidth: Double)

        /// The eye opened or closed around its middle (`openEye`): a pill only; the happy arc stays.
        public func opened(_ open: Double) -> Eye {
            guard case let .pill(x, y, width, height, _) = self, open != 1 else { return self }
            let h = max(0.6, height * open)
            return .pill(x: x, y: y + (height - h) / 2, width: width, height: h, radius: min(width, h) / 2)
        }
    }

    /// One shape of a frame, back to front.
    public enum Part: Sendable {
        case slice(outline: Int, matrix: CGAffineTransform)
        case eye(Eye, matrix: CGAffineTransform)
    }

    /// One mood's frame: the root motion and the shapes.
    public struct Frame: Sendable {
        public let root: CGAffineTransform
        public let parts: [Part]
    }

    public let outlines: [Outline]
    public let moods: [ShapeEngineMood: Frame]

    /// The frame of a mood (idle when the still has none).
    public func frame(_ mood: ShapeEngineMood) -> Frame {
        moods[mood] ?? moods[.idle] ?? Frame(root: .identity, parts: [])
    }

    /// The face a skin paints (`skinFace`): the frame's largest cross-section,
    /// with its projection and the root motion; nil when the frame has none.
    public func face(of frame: Frame) -> (outline: Outline, transform: CGAffineTransform)? {
        var best: (outline: Outline, matrix: CGAffineTransform)?
        for part in frame.parts {
            guard case let .slice(index, matrix) = part, outlines.indices.contains(index) else { continue }
            let outline = outlines[index]
            if best == nil || outline.area >= best!.outline.area { best = (outline, matrix) }
        }
        // the slice's matrix first, then the root's (`mul(root, matrix)`)
        return best.map { ($0.outline, $0.matrix.concatenating(frame.root)) }
    }

    /// An SVG `matrix(a b c d e f)` as Core Graphics takes it.
    static func matrix(_ values: ArraySlice<Double>) -> CGAffineTransform? {
        guard values.count == 6 else { return nil }
        let v = Array(values)
        return CGAffineTransform(a: v[0], b: v[1], c: v[2], d: v[3], tx: v[4], ty: v[5])
    }

    /// A still file (`StillFile`) read back (`readStill`); nil when it is not one.
    public static func read(_ json: String) -> ShapeEngineStill? {
        guard let object = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
              let p = object["p"] as? [[Any]], let m = object["m"] as? [String: Any] else { return nil }
        var outlines: [Outline] = []
        for entry in p {
            guard entry.count == 3, let d = entry[0] as? String, let rule = entry[1] as? NSNumber, let area = entry[2] as? NSNumber else { return nil }
            outlines.append(Outline(d: d, evenOdd: rule.intValue == 1, area: area.doubleValue))
        }
        var moods: [ShapeEngineMood: Frame] = [:]
        for mood in ShapeEngineMood.allCases {
            guard let at = m[mood.rawValue] as? [String: Any], let r = at["r"] as? [NSNumber], let s = at["s"] as? [[Any]],
                  let root = matrix(r.map(\.doubleValue)[...]) else { continue }
            var parts: [Part] = []
            for shape in s {
                guard let head = shape.first else { continue }
                let numbers = shape.dropFirst().compactMap { ($0 as? NSNumber)?.doubleValue }
                guard let matrix = matrix(numbers[...]) else { continue }
                if let index = head as? NSNumber {
                    parts.append(.slice(outline: index.intValue, matrix: matrix))
                } else if let mark = head as? [String: Any], let eye = eye(mark) {
                    parts.append(.eye(eye, matrix: matrix))
                }
            }
            moods[mood] = Frame(root: root, parts: parts)
        }
        guard moods[.idle] != nil else { return nil }
        return ShapeEngineStill(outlines: outlines, moods: moods)
    }

    private static func eye(_ mark: [String: Any]) -> Eye? {
        func n(_ key: String) -> Double? { (mark[key] as? NSNumber)?.doubleValue }
        switch mark["shape"] as? String {
        case "pill":
            guard let x = n("x"), let y = n("y"), let w = n("width"), let h = n("height"), let r = n("radius") else { return nil }
            return .pill(x: x, y: y, width: w, height: h, radius: r)
        case "arc":
            guard let d = mark["d"] as? String, let width = n("strokeWidth") else { return nil }
            return .arc(d: d, strokeWidth: width)
        default:
            return nil
        }
    }

    private static let lock = NSLock()
    private static var cache: [String: ShapeEngineStill] = [:]

    /// A shape's still, read once and kept: in volume, or flat (depth 0, the Outline skin).
    public static func of(_ shape: MascotShape, flat: Bool = false) -> ShapeEngineStill? {
        let key = flat ? "\(shape.rawValue)@flat" : shape.rawValue
        lock.lock()
        defer { lock.unlock() }
        if let hit = cache[key] { return hit }
        guard let json = (flat ? ShapeEngineStillData.flat : ShapeEngineStillData.stills)[shape.rawValue], let still = read(json) else { return nil }
        cache[key] = still
        return still
    }
}
