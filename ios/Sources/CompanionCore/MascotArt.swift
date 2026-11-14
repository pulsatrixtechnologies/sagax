// The other two Sagax characters as data, and the bits of CSS the desktop
// animates and tints them with:
//
// - `ShapeArt`: `SHAPE_ART` (src/components/shape-art.ts) and
//   `shapeSkinBase` (skin-fx/shape-skins.tsx), both read from the one
//   geometry file (`ShapeGeometryData`, generated from
//   shared/mascot-geometry.json).
// - `TrombiArt`: `src/components/retro-assistant/trombi-art.ts` (geometry and
//   the pose shapes) plus the skins of `shape-mascot.css`.
// - `CSSColorFilter`: the CSS filter functions Trombi's skins use, applied to
//   a colour, since a flat drawing can be tinted colour by colour exactly.
// - `CSSKeyframes`: keyframe interpolation with CSS timing functions, so the
//   phone's mascots move on the desktop's curves.
import CoreGraphics
import Foundation

// MARK: - Shapes

public enum ShapeArt {
    public struct Art: Sendable {
        /// The outline, viewBox 0 0 100 100.
        public let d: String
        /// Where the pair of eyes is centred.
        public let eyes: CGPoint
        public let gap: CGFloat
    }

    /// Every shape's resting outline and face (`SHAPE_ART`): the geometry
    /// file's 64 radii smoothed into one closed path in the 0..100 box, and
    /// its face anchor in box units.
    public static let art: [MascotShape: Art] = Dictionary(uniqueKeysWithValues: MascotShape.allCases.map { shape in
        let radii = ShapeGeometryData.radii[shape] ?? ShapeGeometryData.radii[.circle]!
        let n = Double(radii.count)
        let points = radii.enumerated().map { i, r -> CGPoint in
            let a = Double(i) / n * Double.pi * 2
            return ShapeMath.toBox(CGPoint(x: r * sin(a), y: -r * cos(a)))
        }
        let face = ShapeGeometryData.faceAnchor[shape] ?? ShapeEngineData.eyeShift
        return (shape, Art(d: ShapeMath.smoothClosed(points), eyes: ShapeMath.toBox(CGPoint(x: face.x, y: face.y)), gap: 11))
    })

    /// How a skin paints a shape (`shapeSkinPaint`).
    public struct Paint: Equatable, Sendable {
        public var fill: String
        public var stroke: String?
        public var strokeWidth: CGFloat
        public var eyes: String
        public var glow: String?
        public var shine: Bool
    }

    /// The shape's reading of a colour (`hexOf`): a name, a `#RRGGBB`, or green.
    public static func hex(_ color: String) -> String {
        MausColors.hex(for: color) ?? MausColors.hex["green"]!
    }

    /// Mixes a hex colour toward white (`tint` in ShapeMascot.tsx).
    public static func tint(_ hex: String, _ amount: Double) -> String {
        let c = RGB(hex: hex)
        func mix(_ v: Double) -> Double { (v + (255 - v) * amount).rounded() }
        return RGB(r: mix(c.r), g: mix(c.g), b: mix(c.b)).hex
    }

    /// Mixes a hex colour toward another (`mix` in skin-fx.ts).
    public static func mix(_ hex: String, _ toward: String, _ t: Double) -> String {
        let a = RGB(hex: hex), b = RGB(hex: toward)
        func ch(_ x: Double, _ y: Double) -> Double { (x * (1 - t) + y * t).rounded() }
        return RGB(r: ch(a.r, b.r), g: ch(a.g, b.g), b: ch(a.b, b.b)).hex
    }

    /// A paint rule of the geometry file on a bot colour (`paintOf`): the
    /// bot's colour, a tint of it toward white, a mix toward another colour,
    /// or a fixed hex (upper case, as the phone has always written it).
    public static func paintOf(_ rule: ShapePaintRule, hex: String) -> String {
        switch rule {
        case .bot: return hex
        case let .tint(amount): return tint(hex, amount)
        case let .hex(value): return RGB(hex: value).hex
        case let .mix(toward, t): return mix(hex, toward, t)
        }
    }

    /// `shapeSkinBase` (skin-fx/shape-skins.tsx): the finish every size
    /// draws, from the skin rules of the geometry file (`ShapeGeometryData.skins`).
    /// The premium editions add light, texture and effects on top
    /// (`shapeSkinLayers`, ported as `ShapeSkinLayers`).
    public static func paint(_ skin: ShapeSkin, hex: String) -> Paint {
        let rule = ShapeGeometryData.skins[skin] ?? ShapeGeometryData.skins[.plain]!
        let fill = paintOf(rule.fill, hex: hex)
        // dark eyes, or light ones on a dark body (black, the deep palette): always readable
        let eyes: String
        switch rule.eyes {
        case .auto: eyes = MascotInk.eyeInkOn(fill)
        case .soft: eyes = MascotInk.eyeInkOn(fill) == MascotInk.dark ? "#3A3F4B" : MascotInk.light
        case let .paint(paint): eyes = paintOf(paint, hex: hex)
        }
        return Paint(fill: fill, stroke: rule.stroke.map { paintOf($0, hex: hex) }, strokeWidth: CGFloat(rule.strokeWidth), eyes: eyes,
                     glow: rule.glow.map { paintOf($0, hex: hex) }, shine: rule.shine)
    }

    /// `clayStops` (shape-engine.ts): a light from the upper left fading to
    /// a dark rim, the Plain skin's fill.
    public static func clayStops(_ hex: String) -> [(offset: Double, color: String)] {
        [
            (0, mix(hex, "#FFFFFF", 0.62)),
            (0.3, mix(hex, "#FFFFFF", 0.2)),
            (0.7, RGB(hex: hex).hex),
            (1, mix(hex, "#0B0B0E", 0.4)),
        ]
    }

    /// The eyes' vertical look per mood: up while thinking, down asleep.
    public static func look(_ mood: ShapeMood) -> CGFloat {
        switch mood {
        case .thinking: return -4
        case .sleeping: return 2
        default: return 0
        }
    }

    /// The two eye centres' x for an art (`ex ∓ (gap / 2 + 4)`).
    public static func eyeXs(_ art: Art) -> (CGFloat, CGFloat) {
        (art.eyes.x - art.gap / 2 - 4, art.eyes.x + art.gap / 2 + 4)
    }
}

// MARK: - Trombi

public enum TrombiArt {
    /// viewBox -50 0 310 380.
    public static let viewBox = CGRect(x: -50, y: 0, width: 310, height: 380)
    /// Width over height of the drawing.
    public static let aspect: CGFloat = 310 / 380

    public static let wire = "M 48 164 L 48 266 A 46 46 0 0 0 140 266 L 140 94 A 38 38 0 0 0 64 94 L 64 236 A 30 30 0 0 0 124 236 L 124 156"
    public static let sheet = "M-40 338 L115 365 C165 318 222 222 248 156 C204 128 150 162 104 129 C78 180 -2 280 -40 338 Z"
    public static let ruled = [
        "M-30.8 324.4 L126.3 353.7", "M-20.7 309.8 L137.5 341.2", "M-9.8 294.5 L148.7 327.6",
        "M1.6 278.7 L159.6 313.3", "M13.2 262.8 L170.3 298.4", "M24.9 246.9 L180.5 283.2",
        "M36.3 231.2 L190.3 267.9", "M47.3 215.9 L199.6 252.7", "M57.7 201.3 L208.2 237.8",
        "M67.4 187.5 L216.2 223.3", "M76.2 174.5 L223.6 209.4", "M84.1 162.6 L230.1 196.2",
        "M90.9 152.0 L236.0 184.0", "M96.5 142.6 L241.0 172.9", "M101.0 134.7 L245.1 163.2",
    ]
    public static let margin = "M-21.4 341.2 L-13.6 330.1 L-5.0 318.2 L4.2 305.4 L13.9 292.1 L23.9 278.3 L34.2 264.1 L44.6 249.7 L55.0 235.3 L65.2 220.9 L75.1 206.6 L84.6 192.7 L93.6 179.2 L101.8 166.3 L109.3 154.1 L115.8 142.7 L121.3 132.2 M-17.5 341.9 L-9.7 330.9 L-1.1 318.9 L8.1 306.2 L17.8 292.9 L27.9 279.2 L38.1 265.0 L48.5 250.7 L58.8 236.2 L69.0 221.8 L78.9 207.5 L88.3 193.6 L97.2 180.1 L105.5 167.1 L112.9 154.8 L119.4 143.4 L124.9 132.9"
    public static let curl = "M222 170 Q240 166 248 156 Q242 172 234 182 Z"
    public static let eyeLeft = CGPoint(x: 58, y: 118)
    public static let eyeRight = CGPoint(x: 140, y: 118)
    public static let eyeRadius: CGFloat = 28
    /// The face's rotation pivot.
    public static let facePivot = CGPoint(x: 99, y: 118)

    public struct PoseShape: Sendable {
        public let tilt: CGFloat
        public let pupil: CGPoint
        public let browLeft: String
        public let browRight: String
    }

    public static let poses: [TrombiPose: PoseShape] = [
        .idle: PoseShape(tilt: -2, pupil: CGPoint(x: 1.7, y: 2.3), browLeft: "M34 83 Q58 62 80 81 Q58 75.5 34 83 Z", browRight: "M118 81 Q140 62 164 83 Q140 75.5 118 81 Z"),
        .speak: PoseShape(tilt: -3, pupil: CGPoint(x: -5.7, y: -1.1), browLeft: "M34 79 Q58 56 80 77 Q58 69.5 34 79 Z", browRight: "M118 77 Q140 56 164 79 Q140 69.5 118 77 Z"),
        .think: PoseShape(tilt: 2, pupil: CGPoint(x: 5.7, y: -9.2), browLeft: "M34 76 Q58 51 80 74 Q58 64.5 34 76 Z", browRight: "M118 85 Q140 69 164 85 Q140 82.5 118 85 Z"),
        .bored: PoseShape(tilt: -2, pupil: CGPoint(x: -8, y: 5.7), browLeft: "M34 85 Q58 69 80 84 Q58 82.5 34 85 Z", browRight: "M118 84 Q140 69 164 85 Q140 82.5 118 84 Z"),
        .sleep: PoseShape(tilt: 3, pupil: CGPoint(x: 0, y: 10.3), browLeft: "M34 86 Q58 70 80 85 Q58 83.5 34 86 Z", browRight: "M118 85 Q140 70 164 86 Q140 83.5 118 85 Z"),
        .celebrate: PoseShape(tilt: 0, pupil: CGPoint(x: 0, y: -3.4), browLeft: "M34 75 Q58 49 80 72 Q58 62.5 34 75 Z", browRight: "M118 72 Q140 49 164 75 Q140 62.5 118 72 Z"),
        .send: PoseShape(tilt: 2, pupil: CGPoint(x: 8, y: -5.7), browLeft: "M34 81 Q58 60 80 79 Q58 73.5 34 81 Z", browRight: "M118 76 Q140 55 164 78 Q140 68.5 118 76 Z"),
    ]

    /// A Trombi skin's CSS filter (`.trombi-skin-*` in shape-mascot.css), as
    /// a colour transform. Neon also glows, which a colour cannot carry: the
    /// renderer adds its two drop shadows.
    public static func filter(_ skin: TrombiSkin) -> [CSSColorFilter] {
        switch skin {
        case .classic: return []
        case .gold: return [.sepia(0.9), .saturate(2.4), .hueRotate(-12), .brightness(1.04)]
        case .neon: return [.saturate(1.6)]
        case .retro98: return [.grayscale(0.35), .contrast(1.15)]
        // The desktop repaints Trombi for these four (`trombiPaint` in
        // skin-fx/trombi-skins.tsx: a metal, dark or rainbow wire and a
        // matching note). The phone tints its classic drawing toward the
        // same colours instead (`MascotSubstitution` records it).
        case .chrome: return [.grayscale(1), .contrast(1.1), .brightness(1.02)]
        case .glitch: return [.hueRotate(100), .saturate(1.4), .brightness(0.35)]
        case .holo: return [.hueRotate(220), .saturate(0.6), .brightness(1.08)]
        case .molten: return [.sepia(1), .saturate(3), .hueRotate(-30), .brightness(0.85)]
        }
    }

    /// The avatar's Trombi: 78 % of the box wide, standing on its bottom edge.
    public static func avatarWidth(_ box: CGFloat) -> CGFloat { (box * 0.78).rounded() }
    public static func avatarHeight(_ box: CGFloat) -> CGFloat { (avatarWidth(box) / aspect).rounded() }
}

// MARK: - CSS colour filters

/// The CSS `filter` functions that only move colours, per Filter Effects 1
/// (shorthands run in sRGB, each step clamped).
public enum CSSColorFilter: Equatable, Sendable {
    case grayscale(Double)
    case sepia(Double)
    case saturate(Double)
    case hueRotate(Double)
    case brightness(Double)
    case contrast(Double)

    /// Applies the filters in order to an sRGB colour in 0...1.
    public static func apply(_ filters: [CSSColorFilter], r: Double, g: Double, b: Double) -> (Double, Double, Double) {
        var c = (r, g, b)
        for f in filters { c = f.apply(c) }
        return c
    }

    /// Applies the filters to a `#RRGGBB` and returns one.
    public static func apply(_ filters: [CSSColorFilter], hex: String) -> String {
        guard !filters.isEmpty else { return hex }
        let c = RGB(hex: hex)
        let (r, g, b) = apply(filters, r: c.r / 255, g: c.g / 255, b: c.b / 255)
        return RGB(r: r * 255, g: g * 255, b: b * 255).hex
    }

    func apply(_ c: (Double, Double, Double)) -> (Double, Double, Double) {
        func m(_ k: [Double]) -> (Double, Double, Double) {
            (k[0] * c.0 + k[1] * c.1 + k[2] * c.2,
             k[3] * c.0 + k[4] * c.1 + k[5] * c.2,
             k[6] * c.0 + k[7] * c.1 + k[8] * c.2)
        }
        let out: (Double, Double, Double)
        switch self {
        case let .grayscale(a):
            let s = 1 - min(1, max(0, a))
            out = m([0.2126 + 0.7874 * s, 0.7152 - 0.7152 * s, 0.0722 - 0.0722 * s,
                     0.2126 - 0.2126 * s, 0.7152 + 0.2848 * s, 0.0722 - 0.0722 * s,
                     0.2126 - 0.2126 * s, 0.7152 - 0.7152 * s, 0.0722 + 0.9278 * s])
        case let .sepia(a):
            let s = 1 - min(1, max(0, a))
            out = m([0.393 + 0.607 * s, 0.769 - 0.769 * s, 0.189 - 0.189 * s,
                     0.349 - 0.349 * s, 0.686 + 0.314 * s, 0.168 - 0.168 * s,
                     0.272 - 0.272 * s, 0.534 - 0.534 * s, 0.131 + 0.869 * s])
        case let .saturate(s):
            out = m([0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
                     0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
                     0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s])
        case let .hueRotate(deg):
            let a = deg * .pi / 180, co = cos(a), si = sin(a)
            out = m([0.213 + co * 0.787 - si * 0.213, 0.715 - co * 0.715 - si * 0.715, 0.072 - co * 0.072 + si * 0.928,
                     0.213 - co * 0.213 + si * 0.143, 0.715 + co * 0.285 + si * 0.140, 0.072 - co * 0.072 - si * 0.283,
                     0.213 - co * 0.213 - si * 0.787, 0.715 - co * 0.715 + si * 0.715, 0.072 + co * 0.928 + si * 0.072])
        case let .brightness(a):
            out = (c.0 * a, c.1 * a, c.2 * a)
        case let .contrast(a):
            let i = 0.5 - 0.5 * a
            out = (c.0 * a + i, c.1 * a + i, c.2 * a + i)
        }
        func clamp(_ v: Double) -> Double { min(1, max(0, v)) }
        return (clamp(out.0), clamp(out.1), clamp(out.2))
    }
}

// MARK: - CSS keyframes

/// A CSS timing function.
public enum CSSTiming: Sendable {
    case linear
    case cubic(Double, Double, Double, Double)

    public static let ease = CSSTiming.cubic(0.25, 0.1, 0.25, 1)
    public static let easeIn = CSSTiming.cubic(0.42, 0, 1, 1)
    public static let easeOut = CSSTiming.cubic(0, 0, 0.58, 1)
    public static let easeInOut = CSSTiming.cubic(0.42, 0, 0.58, 1)

    /// Progress through one keyframe interval, eased.
    public func value(_ x: Double) -> Double {
        switch self {
        case .linear:
            return x
        case let .cubic(x1, y1, x2, y2):
            if x <= 0 { return 0 }
            if x >= 1 { return 1 }
            func bx(_ t: Double) -> Double { 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t }
            func by(_ t: Double) -> Double { 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t }
            // bisection: monotonic in t for valid timing functions
            var lo = 0.0, hi = 1.0, t = x
            for _ in 0..<30 {
                t = (lo + hi) / 2
                if bx(t) < x { lo = t } else { hi = t }
            }
            return by(t)
        }
    }
}

/// One CSS `@keyframes` rule over a vector of numbers (opacity, a translate,
/// a scale), evaluated the way a browser does: each interval eased by the
/// animation's timing function, offsets without a value skipped.
public struct CSSKeyframes: Sendable {
    public let frames: [(offset: Double, value: [Double])]

    public init(_ frames: [(Double, [Double])]) {
        self.frames = frames.sorted { $0.0 < $1.0 }.map { (offset: $0.0, value: $0.1) }
    }

    /// The value `t` seconds into an infinite animation of `duration` that
    /// starts after `delay`; nil while the delay runs (fill-mode none, so the
    /// element keeps its own still look). `alternate` plays every other cycle
    /// backwards.
    public func value(at t: Double, duration: Double, delay: Double = 0, timing: CSSTiming = .ease, alternate: Bool = false) -> [Double]? {
        guard duration > 0, t >= delay, let first = frames.first, let last = frames.last else { return nil }
        let elapsed = (t - delay) / duration
        var progress = elapsed - floor(elapsed)
        if alternate && Int(floor(elapsed)) % 2 == 1 { progress = 1 - progress }
        if progress <= first.offset { return first.value }
        if progress >= last.offset { return last.value }
        for i in 1..<frames.count where progress <= frames[i].offset {
            let a = frames[i - 1], b = frames[i]
            let span = b.offset - a.offset
            let k = timing.value(span > 0 ? (progress - a.offset) / span : 1)
            return zip(a.value, b.value).map { $0 + ($1 - $0) * k }
        }
        return last.value
    }
}

// MARK: - Eye ink

/// `shared/mascot-colors.ts`: the eyes' ink that reads best on a body colour.
public enum MascotInk {
    public static let dark = "#1B1F27"
    public static let light = "#F6F1E8"

    static func channel(_ value: Double) -> Double {
        let c = value / 255
        return c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
    }

    /// WCAG relative luminance of a `#RRGGBB`.
    public static func luminance(_ hex: String) -> Double {
        let c = RGB(hex: hex)
        return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
    }

    public static func contrast(_ a: String, _ b: String) -> Double {
        let x = luminance(a), y = luminance(b)
        return (max(x, y) + 0.05) / (min(x, y) + 0.05)
    }

    /// `eyeInkOn`.
    public static func eyeInkOn(_ fill: String) -> String {
        contrast(fill, dark) >= contrast(fill, light) ? dark : light
    }
}

// MARK: - Bunbu

/// Bunbu, our own collectible-vinyl little monster: `BUNBU_ART` in
/// `src/components/bunbu-art.ts` (box 0..100) and how a Bunbu skin paints
/// it (`bunbuSkinBase` in skin-fx/bunbu-skins.tsx).
public enum BunbuArt {
    public static let body = "M50 29C68.5 29 80.5 41.5 81 59C81.5 73 79.5 83.5 73.5 89.5C70.5 94 66.5 96 61.5 96C57.5 96 55 94.2 53.2 92.2C51.2 93.2 48.8 93.2 46.8 92.2C45 94.2 42.5 96 38.5 96C33.5 96 29.5 94 26.5 89.5C20.5 83.5 18.5 73 19 59C19.5 41.5 31.5 29 50 29Z"
    public static let earLeft = "M34 42C28.5 31 24 15 27.5 7.5C30.5 2 38 2.5 40.5 9C43.5 17.5 45 30 45 40Z"
    public static let earRight = "M66 42C71.5 31 76 15 72.5 7.5C69.5 2 62 2.5 59.5 9C56.5 17.5 55 30 55 40Z"
    public static let innerLeft = "M35.5 35C31.5 27 29.2 16 31 10.5C32.5 7.5 36 7.8 37.4 11.5C39.5 18 40.6 27 40.8 33Z"
    public static let innerRight = "M64.5 35C68.5 27 70.8 16 69 10.5C67.5 7.5 64 7.8 62.6 11.5C60.5 18 59.4 27 59.2 33Z"
    public struct Arm: Sendable {
        public let cx: CGFloat, cy: CGFloat, rx: CGFloat, ry: CGFloat, rotate: CGFloat
    }
    public static let armLeft = Arm(cx: 20.5, cy: 67, rx: 6, ry: 9.5, rotate: 22)
    public static let armRight = Arm(cx: 79.5, cy: 67, rx: 6, ry: 9.5, rotate: -22)
    public static let tuft = "M47.4 30.6Q47.6 26.6 50.4 25.6M50.6 30.4Q52 27.2 55 27"
    public static let eyeLeft = CGPoint(x: 39, y: 51)
    public static let eyeRight = CGPoint(x: 61, y: 51)
    public static let eyeRx: CGFloat = 6.2
    public static let eyeRy: CGFloat = 7
    public static let nose = "M47.6 56.4Q50 55.4 52.4 56.4Q51.2 59.4 50 59.4Q48.8 59.4 47.6 56.4Z"
    public static let mouth = "M39.5 61.2Q50 64.6 60.5 61.2Q58.8 70.6 50 71Q41.2 70.6 39.5 61.2Z"
    public static let mouthWide = "M37 60.6Q50 65 63 60.6Q61 73 50 73.4Q39 73 37 60.6Z"
    public static let tongue = (cx: CGFloat(50), cy: CGFloat(69.2), rx: CGFloat(4.2), ry: CGFloat(1.7))
    public static let teeth: [CGFloat] = [42.2, 46.1, 50, 53.9, 57.8]
    public static let cheekLeft = CGPoint(x: 29.5, y: 60)
    public static let cheekRight = CGPoint(x: 70.5, y: 60)
    public static let cheekRx: CGFloat = 4
    public static let cheekRy: CGFloat = 2.4
    public static let heart = "M50 88.5C40.5 82.6 40.2 74.4 45.6 74.2C48 74.1 49.4 75.8 50 77.3C50.6 75.8 52 74.1 54.4 74.2C59.8 74.4 59.5 82.6 50 88.5Z"

    /// `bunbuLipY`: the upper lip's height at x (the teeth hang from it).
    public static func lipY(_ x: CGFloat, wide: Bool = false) -> CGFloat {
        let (x0, y0, yc): (CGFloat, CGFloat, CGFloat) = wide ? (37, 60.6, 65) : (39.5, 61.2, 64.6)
        let t = (x - x0) / (2 * (50 - x0))
        return (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * yc + t * t * y0
    }

    /// The colour Bunbu shows where no bot gives one (`hexOf` in BunbuMascot.tsx): mint.
    public static func hex(_ color: String) -> String {
        MausColors.hex(for: color) ?? "#98DDB9"
    }

    /// `bunbuSkinBase`: Plush and Velvet are Bunbu's own, every other skin
    /// is the shapes' finish of the same name.
    public static func paint(_ skin: BunbuSkin, hex: String) -> ShapeArt.Paint {
        switch skin {
        case .plush:
            return ShapeArt.Paint(fill: hex, stroke: nil, strokeWidth: 0, eyes: MascotInk.eyeInkOn(hex), glow: nil, shine: false)
        case .velvet:
            let deep = ShapeArt.mix("#5B1640", hex, 0.22)
            return ShapeArt.Paint(fill: deep, stroke: ShapeArt.mix("#FF9CCF", hex, 0.25), strokeWidth: 1.2, eyes: "#FDF3FF", glow: nil, shine: false)
        case .plain: return ShapeArt.paint(.plain, hex: hex)
        case .pastel: return ShapeArt.paint(.pastel, hex: hex)
        case .night: return ShapeArt.paint(.night, hex: hex)
        case .gold: return ShapeArt.paint(.gold, hex: hex)
        case .neon: return ShapeArt.paint(.neon, hex: hex)
        case .chrome: return ShapeArt.paint(.chrome, hex: hex)
        case .crystal: return ShapeArt.paint(.crystal, hex: hex)
        case .holo: return ShapeArt.paint(.holo, hex: hex)
        case .galaxy: return ShapeArt.paint(.galaxy, hex: hex)
        case .molten: return ShapeArt.paint(.molten, hex: hex)
        }
    }

    /// Light eyes mean a dark finish (night, neon, galaxy, molten, velvet).
    public static func isDark(_ paint: ShapeArt.Paint) -> Bool { MascotInk.luminance(paint.eyes) > 0.5 }

    /// The tummy's heart: a lighter tint of the fill on the soft finishes.
    public static func tummy(_ skin: BunbuSkin, paint: ShapeArt.Paint, hex: String) -> (fill: String, opacity: Double) {
        switch skin {
        case .plain, .pastel, .plush: return (ShapeArt.mix(paint.fill, "#FFFFFF", 0.45), 0.9)
        default: return ("#FFFFFF", 0.16)
        }
    }

    /// The ears' inside: a soft pink on light finishes, a quiet glow on dark ones.
    public static func innerEar(paint: ShapeArt.Paint, hex: String) -> (fill: String, opacity: Double) {
        isDark(paint) ? (ShapeArt.mix(hex, "#FFFFFF", 0.5), 0.28) : (ShapeArt.mix(paint.fill, "#F59AC0", 0.78), 0.9)
    }
}
