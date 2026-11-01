// Trombi, the Hibou 98 paperclip, as a bot's avatar: a port of
// `src/components/retro-assistant/Trombi.tsx` and `trombi.css`, framed the
// way `CharacterAvatar` in `Avatar.tsx` frames it (78 % of the box wide,
// standing on the box's bottom edge), with the four skins of
// `shape-mascot.css` applied colour by colour.
import CompanionCore
import SwiftUI

struct TrombiMascotView: View {
    var skin: TrombiSkin = .classic
    var size: CGFloat = 44
    var pose: TrombiPose = .idle
    var animated = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        let live = animated && !reduceMotion && scenePhase == .active
        let width = TrombiArt.avatarWidth(size)
        let height = TrombiArt.avatarHeight(size)
        TimelineView(.animation(minimumInterval: size >= 40 ? 1.0 / 60.0 : 1.0 / 30.0, paused: !live)) { timeline in
            Canvas { context, canvas in
                TrombiRenderer.draw(
                    in: &context, canvas: canvas, width: width, skin: skin, pose: pose,
                    time: live ? timeline.date.timeIntervalSinceReferenceDate : nil
                )
            }
            .frame(width: width * 1.4, height: height * 1.4)
            // the drawing's own box sits on the avatar's bottom edge
            .frame(width: width, height: height)
            .modifier(TrombiNeon(on: skin == .neon))
        }
        .frame(width: size, height: size, alignment: .bottom)
        .accessibilityHidden(true)
    }
}

/// `drop-shadow(0 0 3px #5ff) drop-shadow(0 0 6px #f5f)`.
private struct TrombiNeon: ViewModifier {
    let on: Bool
    func body(content: Content) -> some View {
        if on {
            content
                .shadow(color: Color(hex: "#55FFFF"), radius: 3)
                .shadow(color: Color(hex: "#FF55FF"), radius: 6)
        } else {
            content
        }
    }
}

enum TrombiRenderer {
    // trombi.css
    static let sway = CSSKeyframes([(0, [-2]), (0.5, [2.2]), (1, [-2])])
    static let blink = CSSKeyframes([(0, [1]), (0.92, [1]), (0.95, [0.08]), (1, [1])])
    static let browPop = CSSKeyframes([(0, [0]), (0.7, [0]), (0.78, [-5]), (0.86, [0]), (1, [0])])
    static let lookUp = CSSKeyframes([(0, [5, -8]), (0.5, [1, -9]), (1, [5, -8])])
    static let dots = CSSKeyframes([(0, [0.25]), (0.4, [1]), (1, [0.25])])
    static let breathe = CSSKeyframes([(0, [1, 1]), (0.5, [1.015, 0.985]), (1, [1, 1])])
    static let zzMove = CSSKeyframes([(0, [0, 8]), (1, [10, -14])])
    static let zzFade = CSSKeyframes([(0, [0]), (0.25, [1]), (1, [0])])
    // translateY, scaleX, scaleY, rotate
    static let bounce = CSSKeyframes([
        (0, [0, 1, 1, 0]), (0.1, [0, 1.06, 0.92, 0]), (0.35, [-34, 0.97, 1.04, -3]), (0.55, [-34, 0.97, 1.04, 3]),
        (0.8, [0, 1.05, 0.94, 0]), (0.9, [0, 1, 1, 0]), (1, [0, 1, 1, 0]),
    ])
    static let sparkScale = CSSKeyframes([(0, [0.3, 0]), (0.5, [1.15, 45]), (1, [0.3, 0])])
    static let sparkFade = CSSKeyframes([(0, [0]), (0.3, [1]), (0.5, [1]), (0.8, [0]), (1, [0])])
    static let browUp = CSSKeyframes([(0, [0]), (0.35, [-6]), (0.55, [-6]), (1, [0])])

    static let eyeGradientStops: [(String, Double)] = [("#FFFFFF", 0), ("#FFFFFF", 0.62), ("#E3E7EC", 0.9), ("#C9CFD7", 1)]
    static let spark = MascotPaths.path("M0 -10 L2.6 -2.6 L10 0 L2.6 2.6 L0 10 L-2.6 2.6 L-10 0 L-2.6 -2.6 Z")
    static let sparks: [(x: Double, y: Double, s: Double, color: String, delay: Double)] = [
        (2, 92, 1.1, "#FFD23F", 0), (188, 66, 1.3, "#5FD4FF", 0.3), (176, 162, 0.8, "#FF7AB8", 0.6),
        (30, 170, 0.9, "#8CF07A", 0.9), (196, 120, 0.8, "#FFD23F", 0.15),
    ]

    /// The body's own box (wire, eyes and brows), for its transform origins.
    static let bodyBox: CGRect = {
        var p = MascotPaths.path(TrombiArt.wire)
        for c in [TrombiArt.eyeLeft, TrombiArt.eyeRight] {
            p.addEllipse(in: CGRect(x: c.x - TrombiArt.eyeRadius, y: c.y - TrombiArt.eyeRadius, width: TrombiArt.eyeRadius * 2, height: TrombiArt.eyeRadius * 2))
        }
        return p.boundingRect
    }()

    /// Draws Trombi at `width` points wide, its drawing box centred in `canvas`.
    static func draw(in context: inout GraphicsContext, canvas: CGSize, width: CGFloat, skin: TrombiSkin, pose: TrombiPose, time: Double?) {
        let filters = TrombiArt.filter(skin)
        func color(_ hex: String, _ opacity: Double = 1) -> Color {
            Color(hex: CSSColorFilter.apply(filters, hex: hex), opacity: opacity)
        }
        func path(_ d: String) -> Path { MascotPaths.path(d) }
        let shape = TrombiArt.poses[pose] ?? TrombiArt.poses[.idle]!
        let vb = TrombiArt.viewBox
        let k = width / vb.width
        let height = width / TrombiArt.aspect

        var ctx = context
        ctx.translateBy(x: (canvas.width - width) / 2, y: (canvas.height - height) / 2)
        ctx.scaleBy(x: k, y: k)
        ctx.translateBy(x: -vb.minX, y: -vb.minY)

        // MARK: paper
        let sheet = path(TrombiArt.sheet)
        let sheetBox = sheet.boundingRect
        do {
            var shadow = ctx
            shadow.translateBy(x: 3, y: 6)
            shadow.addFilter(.blur(radius: 3.2))
            shadow.fill(sheet, with: .color(.black.opacity(0.18)))
        }
        let paper = Gradient(stops: [("#FFF8C4", 0.0), ("#FDF1A6", 0.6), ("#F6E48A", 1.0)].map { .init(color: color($0.0), location: $0.1) })
        ctx.fill(sheet, with: .linearGradient(paper, startPoint: CGPoint(x: sheetBox.maxX, y: sheetBox.minY), endPoint: CGPoint(x: sheetBox.minX, y: sheetBox.maxY)))
        do {
            var inside = ctx
            inside.clip(to: sheet)
            let curl = Gradient(stops: [
                .init(color: color("#FFFFFF", 0), location: 0), .init(color: color("#FFFFFF", 0), location: 0.55),
                .init(color: color("#FFFEF2", 0.75), location: 0.8), .init(color: color("#E9D77A", 0.55), location: 0.93),
                .init(color: color("#C9B457", 0.7), location: 1),
            ])
            inside.fill(sheet, with: .linearGradient(curl, startPoint: CGPoint(x: 150, y: 250), endPoint: CGPoint(x: 250, y: 150)))
            for line in TrombiArt.ruled { inside.stroke(path(line), with: .color(color("#9FB8A4")), lineWidth: 1) }
            inside.stroke(path(TrombiArt.margin), with: .color(color("#E08A8A")), lineWidth: 0.9)
            // the wire's shadow, skewed flat onto the pad
            var cast = inside
            cast.translateBy(x: 94, y: 317)
            cast.concatenate(CGAffineTransform(a: 1, b: 0, c: -0.45, d: 0.24, tx: 0, ty: 0))
            cast.translateBy(x: -94, y: -317)
            cast.opacity = 0.28
            cast.addFilter(.blur(radius: 3.2))
            cast.stroke(path(TrombiArt.wire), with: .color(color("#3A3520")), style: StrokeStyle(lineWidth: 15, lineCap: .round))
            let foot = Gradient(stops: [.init(color: .black.opacity(0.32), location: 0), .init(color: .black.opacity(0), location: 1)])
            var ellipse = inside
            ellipse.translateBy(x: 96, y: 318)
            ellipse.scaleBy(x: 1, y: 6.0 / 50.0)
            ellipse.fill(Path(ellipseIn: CGRect(x: -50, y: -50, width: 100, height: 100)), with: .radialGradient(foot, center: .zero, startRadius: 0, endRadius: 50))
        }
        ctx.stroke(sheet, with: .color(color("#C7B25A")), style: StrokeStyle(lineWidth: 1.1, lineJoin: .round))
        let corner = path(TrombiArt.curl)
        ctx.fill(corner, with: .color(color("#FFFBE0")))
        ctx.stroke(corner, with: .color(color("#C7B25A")), style: StrokeStyle(lineWidth: 1, lineJoin: .round))

        // MARK: body (transform-origin 50% 100% of its own box)
        var body = ctx
        let origin = CGPoint(x: bodyBox.midX, y: bodyBox.maxY)
        if let time {
            switch pose {
            case .idle, .speak:
                if let v = sway.value(at: time, duration: pose == .idle ? 4.5 : 5, timing: .easeInOut) { body.pivot(origin, rotate: v[0]) }
            case .sleep:
                if let v = breathe.value(at: time, duration: 3.2, timing: .easeInOut) { body.pivot(origin, scaleX: v[0], scaleY: v[1]) }
            case .celebrate:
                if let v = bounce.value(at: time, duration: 1.3, timing: .cubic(0.3, 0.7, 0.4, 1)) {
                    body.translateBy(x: 0, y: v[0])
                    body.pivot(origin, rotate: v[3], scaleX: v[1], scaleY: v[2])
                }
            default:
                break
            }
        } else if pose == .celebrate {
            body.translateBy(x: 0, y: -10)
        }

        let wire = path(TrombiArt.wire)
        let round = { (w: CGFloat) in StrokeStyle(lineWidth: w, lineCap: .round, lineJoin: .round) }
        body.stroke(wire, with: .color(color("#39414C")), style: round(14))
        body.stroke(wire, with: .color(color("#AAB4BF")), style: round(11))
        var shade = body
        shade.translateBy(x: 1.9, y: 1.9)
        shade.stroke(wire, with: .color(color("#77828F")), style: round(3.4))
        var light = body
        light.translateBy(x: -1.7, y: -1.7)
        light.stroke(wire, with: .color(color("#F4F7FA")), style: round(2.6))
        var glint = body
        glint.translateBy(x: -1.8, y: -1.8)
        glint.stroke(wire, with: .color(color("#FFFFFF")), style: StrokeStyle(lineWidth: 1.1, lineCap: .round, lineJoin: .round, dash: [18, 60, 9, 90]))
        body.fill(OwlRenderer.circle(CGPoint(x: 73, y: 65), 2), with: .color(color("#FFFFFF")))
        body.fill(OwlRenderer.circle(CGPoint(x: 137, y: 80), 1.3), with: .color(color("#FFFFFF", 0.8)))
        body.fill(OwlRenderer.circle(CGPoint(x: 60, y: 297), 1.7), with: .color(color("#FFFFFF")))

        // MARK: face
        var face = body
        face.pivot(TrombiArt.facePivot, rotate: shape.tilt)
        var pupil = shape.pupil
        var blinkY: CGFloat = 1
        if let time {
            switch pose {
            case .think:
                if let v = lookUp.value(at: time, duration: 3, timing: .easeInOut) { pupil = CGPoint(x: v[0], y: v[1]) }
                blinkY = blink.value(at: time, duration: 5, delay: 1, timing: .ease)?[0] ?? 1
            case .idle:
                blinkY = blink.value(at: time, duration: 4, timing: .ease)?[0] ?? 1
            case .speak:
                blinkY = blink.value(at: time, duration: 3.4, timing: .ease)?[0] ?? 1
            default:
                break
            }
        }
        let eyeStops = Gradient(stops: eyeGradientStops.map { .init(color: color($0.0), location: $0.1) })
        for (side, center) in [(CGFloat(4), TrombiArt.eyeLeft), (CGFloat(-4), TrombiArt.eyeRight)] {
            var eye = face
            if blinkY != 1 { eye.pivot(center, scaleX: 1, scaleY: blinkY) }
            let r = TrombiArt.eyeRadius
            let ball = Path(ellipseIn: CGRect(x: center.x - r, y: center.y - r, width: r * 2, height: r * 2))
            // radialGradient cx .45 cy .36 r .7 of the eye's box
            let gc = CGPoint(x: center.x - r + 0.45 * 2 * r, y: center.y - r + 0.36 * 2 * r)
            eye.fill(ball, with: .radialGradient(eyeStops, center: gc, startRadius: 0, endRadius: 0.7 * 2 * r))
            var inner = eye
            inner.clip(to: ball)
            inner.fill(OwlRenderer.circle(CGPoint(x: center.x + side + pupil.x, y: center.y + 4 + pupil.y), 13.4), with: .color(.black))
            eye.stroke(ball, with: .color(color("#1B1F27")), lineWidth: 1.7)
        }
        var brows = face
        if let time {
            let browBox = path(shape.browLeft).boundingRect.union(path(shape.browRight).boundingRect)
            if pose == .speak, let v = browPop.value(at: time, duration: 2.2, timing: .easeInOut) {
                brows.translateBy(x: 0, y: v[0])
            } else if pose == .celebrate, let v = browUp.value(at: time, duration: 1.3, timing: .easeInOut) {
                brows.translateBy(x: 0, y: v[0])
            }
            _ = browBox
        }
        for d in [shape.browLeft, shape.browRight] {
            let brow = path(d)
            brows.fill(brow, with: .color(color("#1B1F27")))
            brows.stroke(brow, with: .color(color("#1B1F27")), style: StrokeStyle(lineWidth: 1.6, lineJoin: .round))
        }

        // MARK: extras
        switch pose {
        case .think:
            for (i, dot) in [(184.0, 72.0, 4.0), (197.0, 52.0, 5.5), (210.0, 26.0, 7.5)].enumerated() {
                var d = ctx
                if let time { d.opacity = dots.value(at: time, duration: 1.5, delay: Double(i) * 0.25, timing: .ease)?[0] ?? 1 }
                let c = OwlRenderer.circle(CGPoint(x: dot.0, y: dot.1), dot.2)
                d.fill(c, with: .color(color("#FFFFFF")))
                d.stroke(c, with: .color(color("#1B1F27")), lineWidth: 1.6)
            }
        case .sleep:
            for (i, z) in [("z", 180.0, 74.0, 16.0), ("Z", 192.0, 52.0, 22.0), ("Z", 204.0, 28.0, 28.0)].enumerated() {
                var g = ctx
                if let time {
                    if let m = zzMove.value(at: time, duration: 3, delay: Double(i), timing: .linear) { g.translateBy(x: m[0], y: m[1]) }
                    g.opacity = zzFade.value(at: time, duration: 3, delay: Double(i), timing: .linear)?[0] ?? 1
                }
                drawZ(&g, z.0, at: CGPoint(x: z.1, y: z.2), size: z.3, fill: color("#1D2F8F"))
            }
        case .celebrate:
            for (i, s) in sparks.enumerated() {
                var g = ctx
                g.translateBy(x: s.x, y: s.y)
                g.scaleBy(x: s.s, y: s.s)
                if let time {
                    let delay = [0, 0.3, 0.6, 0.9, 0.15][i]
                    if let v = sparkScale.value(at: time, duration: 1.3, delay: delay, timing: .easeOut) {
                        g.scaleBy(x: v[0], y: v[0])
                        g.rotate(by: .degrees(v[1]))
                    }
                    g.opacity = sparkFade.value(at: time, duration: 1.3, delay: delay, timing: .easeOut)?[0] ?? 1
                }
                g.fill(spark, with: .color(color(s.color)))
                g.stroke(spark, with: .color(color("#1B1F27")), lineWidth: 1.2)
            }
        default:
            break
        }
    }

    /// A bold Tahoma-ish letter with a white outline under its fill.
    private static func drawZ(_ ctx: inout GraphicsContext, _ letter: String, at point: CGPoint, size: CGFloat, fill: Color) {
        let font = Font.system(size: size, weight: .bold)
        let outline = ctx.resolve(Text(letter).font(font).foregroundColor(.white))
        let ink = ctx.resolve(Text(letter).font(font).foregroundColor(fill))
        // the SVG text's baseline sits at y
        let anchor = UnitPoint(x: 0, y: 0.78)
        for (dx, dy) in [(-1.5, 0.0), (1.5, 0.0), (0.0, -1.5), (0.0, 1.5), (-1.1, -1.1), (1.1, 1.1), (-1.1, 1.1), (1.1, -1.1)] {
            ctx.draw(outline, at: CGPoint(x: point.x + dx, y: point.y + dy), anchor: anchor)
        }
        ctx.draw(ink, at: point, anchor: anchor)
    }
}
