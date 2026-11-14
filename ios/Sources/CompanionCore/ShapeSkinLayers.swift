// The layers a premium shape skin paints on the body's face (#4159): a port
// of `shapeSkinLayers` in src/components/skin-fx/shape-skins.tsx. The base
// finish (`ShapeArt.paint`) is what every skin starts from; a premium skin
// adds its own fill (a gradient for some), light and texture clipped to the
// face (`inner`), an edge, and from 44 pt up (`full`) what the desktop adds
// at that size: an aura behind (`under`, blurred) and particles around.
// Everything sits in the shape's 0..100 box; `Figure.face` is the face's
// own outline, whatever the shape. The desktop's moving layers (the sweeps,
// the neon current, the circuit pulses) have no still look and are left
// out; a twinkle, a glint or an ember is drawn where it rests.
import CoreGraphics
import Foundation

public struct ShapeSkinLayers: Sendable, Equatable {
    public struct Stop: Sendable, Equatable {
        public let offset: Double
        public let color: String
        public let opacity: Double

        public init(_ offset: Double, _ color: String, _ opacity: Double = 1) {
            self.offset = offset
            self.color = color
            self.opacity = opacity
        }
    }

    /// How a figure is painted.
    public enum Ink: Sendable, Equatable {
        case solid(String, opacity: Double)
        /// From `from` to `to`: in the bounding box (0..1) of what it paints, or in the 0..100 box; repeated past its ends or padded.
        case linear(stops: [Stop], from: CGPoint, to: CGPoint, inBox: Bool, repeats: Bool)
        /// Centre and radius in the bounding box (0..1) of what it paints.
        case radial(stops: [Stop], center: CGPoint, radius: Double)

        static func color(_ hex: String, _ opacity: Double = 1) -> Ink { .solid(hex, opacity: opacity) }
    }

    /// What a mark draws.
    public enum Figure: Sendable, Equatable {
        /// The face's own outline.
        case face
        case path(String)
        case rect(CGRect, corner: Double)
        case ellipse(CGRect)
        case circle(CGPoint, radius: Double)
    }

    public struct Mark: Sendable, Equatable {
        public var figure: Figure
        public var fill: Ink?
        public var stroke: Ink?
        public var lineWidth: Double
        public var roundCap: Bool
        public var transform: CGAffineTransform
        public var opacity: Double
        /// A Gaussian blur's deviation, in box units (0: none).
        public var blur: Double

        public init(_ figure: Figure, fill: Ink? = nil, stroke: Ink? = nil, lineWidth: Double = 0, roundCap: Bool = false,
                    transform: CGAffineTransform = .identity, opacity: Double = 1, blur: Double = 0) {
            self.figure = figure
            self.fill = fill
            self.stroke = stroke
            self.lineWidth = lineWidth
            self.roundCap = roundCap
            self.transform = transform
            self.opacity = opacity
            self.blur = blur
        }
    }

    /// The face's fill (the base fill, or the skin's gradient).
    public let fill: Ink
    /// The edge layer draws its own edge: the base stroke is skipped.
    public let ownEdge: Bool
    /// Behind the body: auras and bloom.
    public let under: [Mark]
    /// Inside the face (clipped to it).
    public let inner: [Mark]
    /// The edge, over the inner layers.
    public let edge: [Mark]
    /// Around the body, over the eyes: particles.
    public let around: [Mark]

    /// Whether the skin paints anything past its base finish.
    public var paints: Bool {
        if case .solid = fill {} else { return true }
        return !under.isEmpty || !inner.isEmpty || !edge.isEmpty || !around.isEmpty
    }

    // MARK: fixed art in 0..100

    /// Stars of the galaxy skin: x, y, radius.
    static let stars: [(Double, Double, Double)] = [
        (22, 34, 0.9), (36, 22, 0.6), (58, 18, 1.1), (74, 30, 0.7), (82, 48, 1),
        (66, 44, 0.5), (44, 40, 0.7), (28, 58, 1.2), (18, 74, 0.6), (40, 72, 0.9),
        (56, 64, 0.6), (70, 70, 1.1), (84, 66, 0.6), (50, 86, 0.8), (32, 88, 0.5), (64, 88, 0.7),
    ]
    static let star4 = "M0 -3.4L0.8 -0.8L3.4 0L0.8 0.8L0 3.4L-0.8 0.8L-3.4 0L-0.8 -0.8Z"
    static let traces = ["M4 30H24V42H40", "M96 26H78V38H64", "M8 62H30V54H44", "M96 70H74V58H60", "M30 98V84H46V74", "M70 98V82H56", "M50 2V14H38V24", "M62 4V20H76"]
    static let pads: [(Double, Double)] = [(40, 42), (64, 38), (44, 54), (60, 58), (46, 74), (56, 82), (38, 24), (76, 20)]
    static let cracks = [
        "M8 40L22 46L30 40L42 50L50 46L60 56L74 50L84 58L96 54",
        "M30 40L34 28L44 22",
        "M60 56L58 70L66 80L64 94",
        "M42 50L36 66L24 72L14 86",
        "M74 50L80 36L92 30",
        "M58 70L46 82",
    ]
    static let facets = [
        "M50 52L20 18M50 52L82 20M50 52L4 60M50 52L96 56M50 52L30 98M50 52L72 98M50 52L50 0",
        "M20 18L4 60L30 98L72 98L96 56L82 20L50 0Z",
    ]
    static let facetLight = ["M50 52L20 18L50 0Z", "M50 52L96 56L72 98Z", "M50 52L4 60L20 18Z"]
    static let rainbowColors = ["#ff8be6", "#ffe98a", "#8dffc8", "#7df4ff", "#b49bff", "#ff8be6"]

    /// `Rainbow`: a repeating rainbow along `angle`, `period` box units long.
    static func rainbow(period: Double, angle: Double) -> Ink {
        let rad = angle * .pi / 180
        let round2 = { (v: Double) in (v * 100).rounded() / 100 }
        let stops = rainbowColors.enumerated().map { Stop(Double($0.offset) / Double(rainbowColors.count - 1), $0.element) }
        return .linear(stops: stops, from: .zero, to: CGPoint(x: round2(cos(rad) * period), y: round2(sin(rad) * period)), inBox: false, repeats: true)
    }

    /// SVG's `rotate(deg cx cy)`.
    static func rotate(_ degrees: Double, _ cx: Double, _ cy: Double) -> CGAffineTransform {
        CGAffineTransform(translationX: cx, y: cy).rotated(by: degrees * .pi / 180).translatedBy(x: -cx, y: -cy)
    }

    /// SVG's `translate(x y) scale(s)`.
    static func place(_ x: Double, _ y: Double, scale: Double = 1) -> CGAffineTransform {
        CGAffineTransform(translationX: x, y: y).scaledBy(x: scale, y: scale)
    }

    static let box = CGRect(x: 0, y: 0, width: 100, height: 100)

    /// The gold's brushed lines (its `brush` pattern over the box): 0.7 high every 2.2.
    static let brush: String = stride(from: 0.0, to: 100, by: 2.2).map { y in
        let top = (y * 100).rounded() / 100
        return "M0 \(top)H100V\(((top + 0.7) * 100).rounded() / 100)H0Z"
    }.joined()

    /// The circuit's grid (its `grid` pattern over the box): a line every 8.
    static let grid: String = stride(from: 0, to: 100, by: 8).map { "M0 \($0)H100M\($0) 0V100" }.joined()

    // MARK: the skins

    /// The layers of a skin for a bot colour (`hex`); `full` is the desktop's larger look (44 pt and up, animated).
    public static func of(_ skin: ShapeSkin, hex: String, full: Bool) -> ShapeSkinLayers {
        let base = ShapeArt.paint(skin, hex: hex)
        let plainFill = Ink.color(base.fill)
        switch skin {
        case .outline:
            let ink = "#1b1f27"
            let hatch = (0..<6).map { n in
                Mark(.path("M\(52 + n * 8) 104L104 \(52 + n * 8)"), stroke: .color(ink), lineWidth: 1.1, opacity: 0.18)
            }
            let foil = rainbow(period: 60, angle: 0)
            // the boiling line rests on one take (its displacement is the desktop's filter alone)
            let edge = full
                ? [Mark(.face, stroke: foil, lineWidth: 8.4), Mark(.face, stroke: .color(ink), lineWidth: 4.2)]
                : [Mark(.face, stroke: foil, lineWidth: 8.4, opacity: 0.75)]
            return ShapeSkinLayers(fill: plainFill, ownEdge: full, under: [], inner: hatch, edge: edge, around: [])

        case .gold:
            let fill = Ink.linear(stops: [Stop(0, "#fff4c2"), Stop(0.22, "#f2c94c"), Stop(0.55, "#c8901e"), Stop(0.8, "#8a5a0c"), Stop(1, "#e9b949")],
                                  from: .zero, to: CGPoint(x: 0.35, y: 1), inBox: true, repeats: false)
            let inner = [
                Mark(.path(brush), fill: .color("#fff8de", 0.22)),
                Mark(.ellipse(CGRect(x: 34 - 16, y: 26 - 8, width: 32, height: 16)), fill: .color("#fffbe8", 0.45), transform: rotate(-24, 34, 26)),
            ]
            let glint = Ink.color("#fff3b0")
            let around = full ? [
                Mark(.path(star4), fill: glint, transform: place(80, 18, scale: 1.5)),
                Mark(.path(star4), fill: glint, transform: place(14, 30)),
                Mark(.path(star4), fill: glint, transform: place(90, 70, scale: 0.8)),
            ] : []
            return ShapeSkinLayers(fill: fill, ownEdge: false, under: [], inner: inner, edge: [], around: around)

        case .neon:
            let tube = ShapeArt.tint(hex, 0.2)
            let plate = Ink.radial(stops: [Stop(0, hex, 0.28), Stop(1, hex, 0.04)], center: CGPoint(x: 0.5, y: 0.55), radius: 0.6)
            let under = full ? [Mark(.face, stroke: .color(tube), lineWidth: 10, opacity: 0.5, blur: 3)] : []
            let edge = [
                Mark(.face, stroke: .color(tube), lineWidth: 4),
                Mark(.face, stroke: .color("#ffffff", 0.9), lineWidth: 1.3),
            ]
            return ShapeSkinLayers(fill: plainFill, ownEdge: true, under: under, inner: [Mark(.rect(box, corner: 0), fill: plate)], edge: edge, around: [])

        case .chrome:
            let fill = Ink.linear(stops: [Stop(0, "#fdfdfe"), Stop(0.3, "#c9d2db"), Stop(0.49, ShapeArt.mix(hex, "#4b5561", 0.7)), Stop(0.53, "#262d35"),
                                          Stop(0.76, "#8c98a6"), Stop(1, "#e6ebf0")],
                                  from: .zero, to: CGPoint(x: 0, y: 1), inBox: true, repeats: false)
            let inner = [
                Mark(.ellipse(CGRect(x: 32 - 18, y: 24 - 7, width: 36, height: 14)), fill: .color("#ffffff", 0.75), transform: rotate(-20, 32, 24)),
                Mark(.rect(CGRect(x: 62, y: 16, width: 5, height: 14), corner: 2), fill: .color("#ffffff", 0.55), transform: rotate(14, 64, 23)),
                Mark(.rect(CGRect(x: 70, y: 18, width: 3, height: 10), corner: 1.5), fill: .color("#ffffff", 0.4), transform: rotate(14, 71, 23)),
                Mark(.face, stroke: .color("#ffffff", 0.6), lineWidth: 2.4),
            ]
            return ShapeSkinLayers(fill: fill, ownEdge: false, under: [], inner: inner, edge: [], around: [])

        case .crystal:
            let fill = Ink.linear(stops: [Stop(0, ShapeArt.tint(hex, 0.8), 0.9), Stop(0.5, ShapeArt.tint(hex, 0.45), 0.62), Stop(1, hex, 0.75)],
                                  from: .zero, to: CGPoint(x: 1, y: 1), inBox: true, repeats: false)
            var inner = facetLight.enumerated().map { i, facet in
                Mark(.path(facet), fill: .color(i == 1 ? hex : "#ffffff", i == 1 ? 0.18 : 0.22))
            }
            inner += facets.map { Mark(.path($0), stroke: .color("#ffffff", 0.45), lineWidth: 0.8) }
            inner.append(Mark(.face, fill: .color("#ffffff"), transform: place(9, 9, scale: 0.82), opacity: 0.18))
            if full {
                inner.append(Mark(.path("M-10 64C10 58 22 70 40 64S70 56 90 64S120 70 130 62"), stroke: .color("#ffffff"), lineWidth: 1.3, roundCap: true, opacity: 0.6))
                inner.append(Mark(.path("M-10 78C8 72 24 84 44 78S76 70 96 78S124 84 132 76"), stroke: .color("#ffffff"), lineWidth: 0.8, roundCap: true, opacity: 0.6))
            }
            let under = full ? [Mark(.face, stroke: .color(ShapeArt.tint(hex, 0.6)), lineWidth: 6, opacity: 0.5, blur: 2)] : []
            let around = full ? [(18.0, 22.0), (86, 34), (76, 86), (12, 70)].map { Mark(.path(star4), fill: .color("#ffffff"), transform: place($0.0, $0.1)) } : []
            return ShapeSkinLayers(fill: fill, ownEdge: true, under: under, inner: inner,
                                   edge: [Mark(.face, stroke: .color("#ffffff", 0.9), lineWidth: 1.5)], around: around)

        case .circuit:
            let trace = ShapeArt.mix(hex, "#7dffea", 0.45)
            var inner = [Mark(.path(grid), stroke: .color(trace, 0.1), lineWidth: 0.5)]
            inner += traces.map { Mark(.path($0), stroke: .color(trace, 0.45), lineWidth: 1.2) }
            inner += pads.map { Mark(.circle(CGPoint(x: $0.0, y: $0.1), radius: 1.5), fill: .color(trace), opacity: 0.7) }
            let under = full ? [Mark(.face, stroke: .color(trace), lineWidth: 6, opacity: 0.45, blur: 2.4)] : []
            return ShapeSkinLayers(fill: plainFill, ownEdge: true, under: under, inner: inner,
                                   edge: [Mark(.face, stroke: .color(trace), lineWidth: 2)], around: [])

        case .holo:
            let pearl = Ink.linear(stops: [Stop(0, "#fbf8ff"), Stop(0.6, "#e3e9ff"), Stop(1, "#d9d2f5")], from: .zero, to: CGPoint(x: 1, y: 1), inBox: true, repeats: false)
            let foil = rainbow(period: 50, angle: 45)
            var inner = [Mark(.rect(CGRect(x: -60, y: -60, width: 220, height: 220), corner: 0), fill: foil, opacity: full ? 0.6 : 0.45)]
            if full {
                inner.append(Mark(.rect(CGRect(x: -80, y: -60, width: 240, height: 220), corner: 0), fill: rainbow(period: 70, angle: -30), opacity: 0.28))
            }
            let around = full ? [(14.0, 24.0, "#ff8be6"), (88, 30, "#7df4ff"), (84, 84, "#ffe98a"), (10, 78, "#8dffc8")].map {
                Mark(.path(star4), fill: .color($0.2), transform: place($0.0, $0.1))
            } : []
            return ShapeSkinLayers(fill: pearl, ownEdge: true, under: [], inner: inner,
                                   edge: [Mark(.face, stroke: foil, lineWidth: 3.2), Mark(.face, stroke: .color("#ffffff"), lineWidth: 0.9)], around: around)

        case .molten:
            let rock = Ink.radial(stops: [Stop(0, "#3d1d14"), Stop(1, "#170806")], center: CGPoint(x: 0.45, y: 0.4), radius: 0.7)
            let heat = Ink.radial(stops: [Stop(0, "#ff5a1f", 0.7), Stop(0.6, "#ff5a1f", 0.12), Stop(1, "#ff5a1f", 0)], center: CGPoint(x: 0.5, y: 1), radius: 0.75)
            var inner = [Mark(.rect(box, corner: 0), fill: heat)]
            if full { inner += cracks.map { Mark(.path($0), stroke: .color("#ff6a1a"), lineWidth: 4, roundCap: true, opacity: 0.8, blur: 1.8) } }
            inner += cracks.map { Mark(.path($0), stroke: .color("#ff8a2a"), lineWidth: 1.7, roundCap: true) }
            inner += cracks.map { Mark(.path($0), stroke: .color("#ffe08a"), lineWidth: 0.6, roundCap: true) }
            let under = full ? [Mark(.face, stroke: .color("#ff5a1f"), lineWidth: 8, opacity: 0.45, blur: 3.2)] : []
            var around: [Mark] = []
            if full {
                around += [34.0, 52, 68].map { Mark(.path("M\(Int($0)) 14c-3 -3 3 -5 0 -8s3 -5 0 -8"), stroke: .color("#ff9a4a"), lineWidth: 1.2, roundCap: true) }
                around += [30.0, 46, 60, 72, 40].map { Mark(.circle(CGPoint(x: $0, y: 20), radius: 1.1), fill: .color("#ffb347")) }
            }
            return ShapeSkinLayers(fill: rock, ownEdge: true, under: under, inner: inner,
                                   edge: [Mark(.face, stroke: .color("#ff6a1a", 0.9), lineWidth: 1.4)], around: around)

        case .galaxy:
            let space = Ink.radial(stops: [Stop(0, ShapeArt.mix(hex, "#3b1d7a", 0.45)), Stop(0.65, "#1a0f45"), Stop(1, "#07051a")], center: CGPoint(x: 0.5, y: 0.55), radius: 0.65)
            let nebulaOpacity = full ? 0.75 : 0.35
            let nebulaBlur = full ? 6.0 : 0
            var inner = [
                Mark(.ellipse(CGRect(x: 34 - 26, y: 40 - 14, width: 52, height: 28)), fill: .color("#ff5fd2"), transform: rotate(-25, 34, 40), opacity: nebulaOpacity, blur: nebulaBlur),
                Mark(.ellipse(CGRect(x: 68 - 24, y: 66 - 12, width: 48, height: 24)), fill: .color("#4fd8ff"), transform: rotate(20, 68, 66), opacity: nebulaOpacity, blur: nebulaBlur),
                Mark(.ellipse(CGRect(x: 56 - 14, y: 34 - 9, width: 28, height: 18)), fill: .color(hex), opacity: nebulaOpacity, blur: nebulaBlur),
            ]
            inner += stars.enumerated().filter { full || $0.offset % 2 == 0 }.map { Mark(.circle(CGPoint(x: $0.element.0, y: $0.element.1), radius: $0.element.2), fill: .color("#ffffff")) }
            inner.append(Mark(.path(star4), fill: .color("#ffffff"), transform: place(62, 26, scale: 0.9)))
            let under = full ? [Mark(.face, stroke: .color(ShapeArt.tint(hex, 0.3)), lineWidth: 6, opacity: 0.4, blur: 2.4)] : []
            let around = full ? [(10.0, 30.0), (92, 22), (90, 80)].map { Mark(.path(star4), fill: .color("#ffffff"), transform: place($0.0, $0.1, scale: 0.7)) } : []
            return ShapeSkinLayers(fill: space, ownEdge: true, under: under, inner: inner,
                                   edge: [Mark(.face, stroke: .color(ShapeArt.tint(hex, 0.5), 0.75), lineWidth: 1.2)], around: around)

        case .plain, .pastel, .glossy, .night:
            return ShapeSkinLayers(fill: plainFill, ownEdge: false, under: [], inner: [], edge: [], around: [])
        }
    }
}
