// The mascot shapes, drawn by the open-bot-avatar engine (#4145, #4159; MIT,
// see NOTICE): a port of `src/components/ShapeMascot.tsx`. Every shape is the
// engine's still of the look's definition, the very frame the desktop draws:
// a catalog shape (ours and the engine's gallery) reads its baked still
// (`ShapeEngineStill`, from src/components/shape-stills); a person's own
// shape (a pasted engine definition, or a drawing in the older portable
// format that is no object preset) has none, so the engine infers it once at
// run time, as the desktop's `runtimeStill` does (`ShapeEngineBake` runs that
// code in JavaScriptCore). The still is drawn with its cross-sections in the
// body's colour, the eyes in the skin's ink, the mood from the bot's state
// (`engineMood`: at work it thinks, done it is happy, else at rest). A skin
// paints the body's face (its largest cross-section, under its projection)
// with its fill, glow, shine, edge and layers, the eyes over it; the Outline
// skin is the engine's flat body (depth 0). The phone draws the still at
// every size (the engine's live loop is not ported); the fourteen Shapes
// moves play over it at 44 pt and up as on the desktop (`ShapeEngine` gives
// the move's timeline: the body's motion, the eyes closing or opening, its
// turn into the egg, the hexagon or the triangle, and what it adds beside the
// body), never under Reduce Motion.
import Combine
import CompanionCore
import SwiftUI

struct ShapeMascotView: View {
    var shape: MascotShape = .circle
    var skin: ShapeSkin = .plain
    /// A bot colour name (`green`) or any hex.
    let color: String
    var size: CGFloat = 44
    var mood: ShapeMood = .idle
    /// A person's own shape (`mascotLook.avatarDef`): a pasted engine definition or the older portable format.
    var avatarDef: MascotAvatarDef? = nil
    /// Off draws a still frame (thumbnails, lists).
    var animated = false
    /// Plays the Shapes moves asked for (`OwlMascotHandle.shape(_:)`).
    var handle: OwlMascotHandle?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var player = ShapeMovePlayer()
    /// A move plays: the drawing follows the display's rate until it ends.
    @State private var moving = false

    /// From this size up a move plays and a tap winks (`FX_FULL_MIN`).
    static let liveMinSize: CGFloat = 44
    /// The canvas is this much larger than the box: rings and ribbons reach past the body.
    static let overflow: CGFloat = 1.7

    /// Bumped when a person's own shape was baked off the main thread: draw it now.
    @State private var baked = 0

    var body: some View {
        let flat = skin == .outline
        if let def = avatarDef, ShapeEngineStill.bakedShape(shape, avatarDef: def) == nil,
           !ShapeEngineBake.isReady(shape, avatarDef: def, flat: flat) {
            // a person's own shape: the engine infers it once, off the main thread
            Color.clear.frame(width: size, height: size)
                .task(id: OwnBake(shape: shape, flat: flat, avatarDef: def)) {
                    let shape = shape
                    await Task.detached(priority: .userInitiated) { _ = ShapeEngineBake.still(shape, avatarDef: def, flat: flat) }.value
                    baked += 1
                }
        } else if let still = ShapeEngineStill.of(shape, avatarDef: avatarDef, flat: flat) {
            engineBody(still)
        } else {
            Color.clear.frame(width: size, height: size)
        }
    }

    private struct OwnBake: Equatable {
        var shape: MascotShape
        var flat: Bool
        var avatarDef: MascotAvatarDef
    }

    private func engineBody(_ still: ShapeEngineStill) -> some View {
        let live = animated && !reduceMotion && scenePhase == .active && size >= Self.liveMinSize
        let hex = ShapeArt.hex(color)
        let flat = skin == .outline
        // the skin's larger look (its aura, particles) from 44 pt up when animated (`fxDetail`)
        let full = animated && size >= Self.liveMinSize
        return TimelineView(.animation(paused: !moving)) { timeline in
            Canvas { context, canvas in
                let now = timeline.date.timeIntervalSinceReferenceDate
                let move = moving ? player.frame(now) : nil
                let drawn = move?.morph.flatMap { ShapeEngineStill.of($0, flat: flat) } ?? still
                ShapeEngineRenderer.draw(in: &context, canvas: canvas, box: size, still: drawn, mood: mood.engine, skin: skin, hex: hex, full: full, move: move)
            }
            .frame(width: size * Self.overflow, height: size * Self.overflow)
        }
        .frame(width: size, height: size)
        // a tap: a wink, without taking the tap from the row or button around it
        .simultaneousGesture(TapGesture().onEnded {
            guard live, !moving else { return }
            play(.wink)
        }, including: live ? .all : .subviews)
        .onReceive(handle?.$shapeMove.eraseToAnyPublisher() ?? Empty().eraseToAnyPublisher()) { request in
            guard live, let request, player.take(request.key) else { return }
            play(request.move)
        }
        .accessibilityHidden(true)
    }

    /// Plays a move over the still, at the display's rate, then rests again.
    private func play(_ move: ShapeMove) {
        let now = Date().timeIntervalSinceReferenceDate
        player.play(move, shape: shape, color: ShapeArt.hex(color), now: now)
        moving = true
        let seconds = ShapeMoves.length(move) + 0.12
        let until = Date().addingTimeInterval(seconds)
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) {
            if Date() >= until { moving = false }
        }
    }
}

/// The move playing over an engine still: its frame at a moment, how open
/// each eye is against the resting face, and the body it has turned into.
struct ShapeMoveFrame {
    let frame: ShapeFrame
    /// Left eye then right (the one further left on screen), 1 at rest (`moveEyeOpen`).
    let open: (Double, Double)
    /// The shape the move has turned the body into, once more than half way (`MOVE_BODY`).
    let morph: MascotShape?
}

/// Holds a move's own timeline (`ShapeEngine`) while it plays.
final class ShapeMovePlayer {
    private var engine: ShapeEngine?
    private var rest: ShapeFrame?
    private var move: ShapeMove?
    private var lastKey = 0

    /// `MOVE_BODY`: the body a move turns into for a while.
    static let bodies: [ShapeMove: MascotShape] = [.egg: .egg, .hexagon: .hexagon, .play: .triangle, .orbit: .triangle]

    /// Whether a requested move is new (each request plays once).
    func take(_ key: Int) -> Bool {
        guard key != lastKey else { return false }
        lastKey = key
        return true
    }

    func play(_ move: ShapeMove, shape: MascotShape, color: String, now: Double) {
        // the gallery's shapes have no body of their own in the moves' set: they move as the circle does
        let state = ShapeEngineState(shape: shape.isBody ? shape : .circle, expression: .neutral, color: color)
        let engine = ShapeEngine(state, now: now, seed: 7)
        engine.play(move, now: now)
        self.engine = engine
        self.move = move
        rest = ShapeFrames.still(state.shape, .neutral, color: color)
    }

    func frame(_ now: Double) -> ShapeMoveFrame? {
        guard let engine, let move, let rest, engine.playing(now) else { return nil }
        let frame = engine.frame(now)
        let eyes = frame.eyeShapes.sorted { $0.x < $1.x }
        let base = rest.eyeShapes.sorted { $0.x < $1.x }
        func open(_ i: Int) -> Double {
            guard eyes.indices.contains(i), base.indices.contains(i), base[i].h > 0 else { return 1 }
            return min(1.5, max(0.08, eyes[i].h / base[i].h))
        }
        let morph = frame.morphed >= 0.5 ? Self.bodies[move] : nil
        return ShapeMoveFrame(frame: frame, open: (open(0), open(1)), morph: morph)
    }
}

/// Draws an engine still (`ShapeSvg` in ShapeMascot.tsx).
enum ShapeEngineRenderer {
    /// The engine draws across its whole 0..100 box: the drawing takes 84% of the mascot's box.
    static let drawn: CGFloat = 0.84
    /// The eyes' ink when a skin leaves it to the body (`#151515`).
    static let defaultInk = "#151515"

    static func draw(in context: inout GraphicsContext, canvas: CGSize, box: CGFloat, still: ShapeEngineStill, mood: ShapeEngineMood,
                     skin: ShapeSkin, hex: String, full: Bool = false, move: ShapeMoveFrame? = nil) {
        let paint = ShapeArt.paint(skin, hex: hex)
        let layers = ShapeSkinLayers.of(skin, hex: hex, full: full)
        let body = isHex(paint.fill) ? paint.fill : hex
        let ink = isHex(paint.eyes) ? paint.eyes : defaultInk
        let frame = still.frame(mood)
        let side = box * drawn
        var ctx = context
        ctx.translateBy(x: (canvas.width - side) / 2, y: (canvas.height - side) / 2)
        ctx.scaleBy(x: side / 100, y: side / 100)
        if let move { ctx.concatenate(move.frame.affine) }
        let open = move?.open ?? (1, 1)
        let leftmost = leftEye(frame)

        if let move { ShapeRenderer.drawRings(move.frame, front: false, in: ctx) }
        // a skin that draws over the flat body paints its face (`skinIsFlat`)
        let skinned = layers.paints || paint.stroke != nil || paint.shine
        let face = skinned ? still.face(of: frame) : nil
        var onFace = ctx
        if let face { onFace.concatenate(face.transform) }
        let facePath = face.map { Path(SVGPath.cached($0.outline.d)) }
        let faceRule = FillStyle(eoFill: face?.outline.evenOdd ?? false)
        // the skin's aura, behind the body
        if let facePath { ShapeSkinPainter.under(layers, face: facePath, rule: faceRule, in: onFace) }
        // the body: the cross-sections back to front in its colour, the eyes in their planes
        var root = ctx
        root.concatenate(frame.root)
        var eyeIndex = 0
        for part in frame.parts {
            switch part {
            case let .slice(index, matrix):
                guard still.outlines.indices.contains(index) else { continue }
                let outline = still.outlines[index]
                var c = root
                c.concatenate(matrix)
                c.fill(Path(SVGPath.cached(outline.d)), with: .color(Color(hex: body)), style: FillStyle(eoFill: outline.evenOdd))
            case let .eye(mark, matrix):
                let amount = eyeIndex == leftmost ? open.0 : open.1
                eyeIndex += 1
                eye(mark.opened(amount), matrix: matrix, ink: ink, in: root)
            }
        }
        // the skin paints the face (fill, edge, shine, its layers), the eyes over it, its particles over all
        if let facePath {
            ShapeSkinPainter.face(layers, paint: paint, face: facePath, rule: faceRule, in: onFace)
            eyeIndex = 0
            for part in frame.parts {
                guard case let .eye(mark, matrix) = part else { continue }
                let amount = eyeIndex == leftmost ? open.0 : open.1
                eyeIndex += 1
                eye(mark.opened(amount), matrix: matrix, ink: ink, in: root)
            }
            ShapeSkinPainter.around(layers, face: facePath, rule: faceRule, in: onFace)
        }
        if let move { ShapeRenderer.drawMoveFront(move.frame, fill: body, in: ctx) }
    }

    /// One eye in its plane: the engine's pill, or its happy arc.
    private static func eye(_ mark: ShapeEngineStill.Eye, matrix: CGAffineTransform, ink: String, in context: GraphicsContext) {
        var c = context
        c.concatenate(matrix)
        switch mark {
        case let .pill(x, y, width, height, radius):
            c.fill(Path(roundedRect: CGRect(x: x, y: y, width: width, height: height), cornerRadius: radius), with: .color(Color(hex: ink)))
        case let .arc(d, strokeWidth):
            c.stroke(Path(SVGPath.cached(d)), with: .color(Color(hex: ink)), style: StrokeStyle(lineWidth: strokeWidth, lineCap: .round))
        }
    }

    /// Which of the frame's eyes is the left one on screen (`withEyes`).
    private static func leftEye(_ frame: ShapeEngineStill.Frame) -> Int {
        let xs: [Double] = frame.parts.compactMap {
            guard case let .eye(mark, matrix) = $0 else { return nil }
            if case let .pill(x, _, _, _, _) = mark { return Double(matrix.tx) + x }
            return Double(matrix.tx)
        }
        return xs.count > 1 && xs[1] < xs[0] ? 1 : 0
    }

    private static func isHex(_ value: String) -> Bool {
        value.count == 7 && value.hasPrefix("#") && value.dropFirst().allSatisfy(\.isHexDigit)
    }
}

/// What a Shapes move adds beside an engine body (`moveExtrasMarkup`): the
/// rings, the thought dots and marks, the specks, the ribbons and the badge.
enum ShapeRenderer {
    /// A move's rings on one side of the body, in the box (`moveExtrasMarkup`).
    static func drawRings(_ frame: ShapeFrame, front: Bool, in ctx: GraphicsContext) {
        for (i, ring) in frame.rings.enumerated() { stroke(front ? ring.front : ring.back, ring: ring, index: i, in: ctx) }
    }

    /// What a move adds in front of an engine body (`moveExtrasMarkup`'s
    /// front): the thought dots and marks in the body's colour, the specks,
    /// the rings' front, the ribbons and the badge.
    static func drawMoveFront(_ frame: ShapeFrame, fill: String, in ctx: GraphicsContext) {
        dots(frame, fill: fill, in: ctx)
        marks(frame, fill: fill, in: ctx)
        drawExtras(in: ctx, frame: frame)
        badge(frame, in: ctx)
    }

    private static func badge(_ frame: ShapeFrame, in ctx: GraphicsContext) {
        guard let badge = frame.badge, badge.r > 0 else { return }
        ctx.fill(Path(ellipseIn: CGRect(x: badge.x - badge.r, y: badge.y - badge.r, width: 2 * badge.r, height: 2 * badge.r)), with: .color(Color(hex: "#2a8fe8")))
    }

    private static func dots(_ frame: ShapeFrame, fill: String, in ctx: GraphicsContext) {
        for dot in frame.dots where dot.r > 0 {
            var d = ctx
            d.opacity = dot.opacity
            d.fill(Path(ellipseIn: CGRect(x: dot.x - dot.r, y: dot.y - dot.r, width: 2 * dot.r, height: 2 * dot.r)), with: .color(Color(hex: fill)))
        }
    }

    /// A move's marks (the exclamation's bar) in the dots' colour, beside the body.
    private static func marks(_ frame: ShapeFrame, fill: String, in ctx: GraphicsContext) {
        for mark in frame.marks where mark.opacity > 0 {
            let path = CGMutablePath()
            ShapeMath.smoothClosedPath(mark.points, into: path)
            var m = ctx
            m.opacity = mark.opacity
            m.fill(Path(path), with: .color(Color(hex: fill)))
        }
    }

    /// Specks, rings in front, ribbons: in the box, around the body.
    private static func drawExtras(in ctx: GraphicsContext, frame: ShapeFrame) {
        let speckColor = Color(hex: ShapeMath.mixHex(frame.color, "#0b0b0e", 0.62))
        for speck in frame.specks where speck.opacity > 0 {
            var s = ctx
            s.opacity = speck.opacity
            s.fill(Path(ellipseIn: CGRect(x: speck.x - speck.r, y: speck.y - speck.r, width: 2 * speck.r, height: 2 * speck.r)), with: .color(speckColor))
        }
        for (i, ring) in frame.rings.enumerated() { stroke(ring.front, ring: ring, index: i, in: ctx) }
        for ribbon in frame.ribbons where ribbon.opacity > 0 {
            guard let visible = ribbon.visible else { continue }
            var path = Path()
            path.move(to: ribbon.from)
            path.addQuadCurve(to: ribbon.to, control: ribbon.control)
            var r = ctx
            r.opacity = ribbon.opacity
            r.stroke(path.trimmedPath(from: visible.lowerBound, to: visible.upperBound),
                     with: rainbow(ribbon.hue, ribbon.hueSpan, x1: ribbon.x1, x2: ribbon.x2),
                     style: StrokeStyle(lineWidth: ribbon.width, lineCap: .round))
        }
    }

    private static func stroke(_ runs: [[CGPoint]], ring: ShapeRingDraw, index: Int, in context: GraphicsContext) {
        guard ring.opacity > 0, !runs.isEmpty else { return }
        var path = Path()
        for run in runs where run.count > 1 {
            path.move(to: run[0])
            for p in run.dropFirst() { path.addLine(to: p) }
        }
        var c = context
        c.opacity = ring.opacity
        c.stroke(path, with: rainbow(ring.hue, ring.hueSpan, x1: ring.x1, x2: ring.x2), style: StrokeStyle(lineWidth: ring.width, lineCap: .round, lineJoin: .round))
    }

    /// `rainbowStops` across the line: hsl(h, 55%, 62%) at 0, 0.5 and 1.
    private static func rainbow(_ hue: Double, _ span: Double, x1: Double, x2: Double) -> GraphicsContext.Shading {
        let stops = ShapeMath.rainbowStops(hue, span).enumerated().map { i, h in
            Gradient.Stop(color: hsl(h, 0.55, 0.62), location: Double(i) / 2)
        }
        return .linearGradient(Gradient(stops: stops), startPoint: CGPoint(x: x1, y: 0), endPoint: CGPoint(x: x2, y: 0))
    }

    /// An HSL colour as SwiftUI draws it.
    static func hsl(_ h: Double, _ s: Double, _ l: Double) -> Color {
        let c = (1 - abs(2 * l - 1)) * s
        let hp = (h.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360) / 60
        let x = c * (1 - abs(hp.truncatingRemainder(dividingBy: 2) - 1))
        let (r, g, b): (Double, Double, Double) = switch Int(hp) {
        case 0: (c, x, 0)
        case 1: (x, c, 0)
        case 2: (0, c, x)
        case 3: (0, x, c)
        case 4: (x, 0, c)
        default: (c, 0, x)
        }
        let m = l - c / 2
        return Color(.sRGB, red: r + m, green: g + m, blue: b + m, opacity: 1)
    }
}
