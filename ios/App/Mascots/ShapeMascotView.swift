// The mascot shapes: a port of `src/components/ShapeMascot.tsx`. One body
// in every shape of the set, drawn in volume as on the desktop since #786 (one
// drawing since 2026-10-28): a few slices of one outline turned with the pose,
// one flat colour, two opaque eyes in a solid ink on the face, under the face's
// own matrix (capsules at rest, ovals while busy, arches when pleased), every
// shape on the same ground. The Outline skin stays flat on purpose, eyes cut
// through it.
//
// What moves it is the desktop's own code, ported in CompanionCore with its
// numbers generated from the desktop's modules: `ShapeEngine` (gaze, blinks,
// breath, changes of shape, face and colour, the fourteen moves),
// `ShapeMotion` (the pose: settle and glance at rest, the busy loops, a
// mood change's slide, a tap's squash and hop) and `ShapeVolume` (slices,
// bend, eyes, inks). The live loop runs only for an animated drawing of
// 44 pt or more (`fxDetail`), at 30 frames a second at rest and the
// display's rate during a move; smaller ones, lists and Reduce Motion draw
// the still pose and run no timer at all. On a large layout with a pointer,
// the body and the face turn toward it while it is over the mascot.
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
    /// A face of its own, over the mood's.
    var expression: ShapeExpression?
    /// Path-based body (v2.1); object shapes also resolve presets when nil.
    var avatarDef: ShapeAvatarDef? = nil
    /// Off draws a still frame (thumbnails, lists).
    var animated = false
    /// Plays the Shapes moves asked for (`OwlMascotHandle.shape(_:)`).
    var handle: OwlMascotHandle?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var player = ShapePlayer()
    /// A move plays: the loop runs at the display's rate until it ends.
    @State private var moving = false

    /// `FX_FULL_MIN`: full detail (the live loop) from this size up.
    static let liveMinSize: CGFloat = 44
    /// The canvas is this much larger than the box: rings and ribbons reach past the body.
    static let overflow: CGFloat = 1.7

    var body: some View {
        let active = animated && !reduceMotion && scenePhase == .active
        let live = active && size >= Self.liveMinSize
        // a flat skin bounces while working (shape-mascot.css), even small
        let bouncing = active && skin == .outline && mood == .working
        let face = expression ?? ShapeEngineData.moodExpression[mood] ?? .neutral
        let resolvedDef = ShapeAvatarPresets.avatarDef(for: shape, avatarDef: avatarDef)
        let state = ShapeEngineState(shape: shape, expression: face, color: ShapeArt.hex(color), avatarDef: resolvedDef)
        TimelineView(.animation(minimumInterval: moving ? nil : ShapeVolumeData.idleFrame, paused: !(live || bouncing))) { timeline in
            Canvas { context, canvas in
                let now = timeline.date.timeIntervalSinceReferenceDate
                let drawn = live ? player.frame(state, mood: mood, now: now)
                    : (ShapeFrames.still(shape, face, color: state.color, avatarDef: resolvedDef), ShapeVolume.grounded(ShapeVolume.rest, shape))
                ShapeRenderer.draw(in: &context, canvas: canvas, box: size, frame: drawn.0, pose: drawn.1, shape: shape, skin: skin, hex: state.color,
                                   eyes: ShapeVolume.eyeStyle(mood), bounce: bouncing ? now : nil)
            }
            .frame(width: size * Self.overflow, height: size * Self.overflow)
        }
        .frame(width: size, height: size)
        .onContinuousHover { phase in
            guard live else { return }
            switch phase {
            case let .active(at):
                // -1...1 at about three box widths away (`pointerAround`)
                let reach = max(240, size * 3)
                player.pointer(CGPoint(x: (at.x - size / 2) / reach, y: (at.y - size / 2) / reach))
            case .ended:
                player.pointer(nil)
            }
        }
        // a tap: a wink and a squash-and-hop, without taking the tap from the row or button around it
        .simultaneousGesture(TapGesture().onEnded {
            guard live else { return }
            let now = Date().timeIntervalSinceReferenceDate
            player.poke(now: now)
            run(ShapeMoves.length(.wink))
        }, including: live ? .all : .subviews)
        .onReceive(handle?.$shapeMove.eraseToAnyPublisher() ?? Empty().eraseToAnyPublisher()) { request in
            guard live, let request else { return }
            if player.play(request, now: Date().timeIntervalSinceReferenceDate) { run(ShapeMoves.length(request.move)) }
        }
        .accessibilityHidden(true)
    }

    /// The display's rate for `seconds`, then back to the resting pace.
    private func run(_ seconds: Double) {
        moving = true
        let until = Date().addingTimeInterval(seconds + 0.1)
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds + 0.1) {
            if Date() >= until { moving = false }
        }
    }
}

/// Holds the live engine and motion across redraws (`engine.current`,
/// `motion.current`), made on the first live frame; a still drawing never
/// asks it for a frame.
final class ShapePlayer {
    private var engine: ShapeEngine?
    private var motion: ShapeMotion?
    private var lastMove = 0
    private var pendingPointer: CGPoint??
    /// A seed of its own, so two mascots on one screen never move in step.
    private let seed = Double.random(in: 0..<1000)

    func frame(_ state: ShapeEngineState, mood: ShapeMood, now: Double) -> (ShapeFrame, ShapePose) {
        let run: ShapeEngine
        if let engine {
            if engine.state != state { engine.set(state, now: now) }
            run = engine
        } else {
            run = ShapeEngine(state, now: now, seed: seed)
            engine = run
        }
        let sway: ShapeMotion
        if let motion {
            sway = motion
        } else {
            sway = ShapeMotion(mood.motion, seed: seed, start: now)
            motion = sway
        }
        if let pointer = pendingPointer {
            run.pointer(pointer)
            sway.pointer(pointer)
            pendingPointer = nil
        }
        sway.setMood(mood.motion, now: now)
        let swayed = sway.pose(now)
        // the sway's lean moves the gaze; the outline keeps its resting turn (ShapeVolume.upright)
        run.lean(yaw: swayed.yaw - ShapeVolume.rest.yaw, pitch: swayed.pitch - ShapeVolume.rest.pitch)
        let frame = run.frame(now)
        let pose = ShapeVolume.grounded(ShapeVolume.upright(swayed), state.shape)
        return (frame, pose)
    }

    /// Plays a requested move once; false when it was already played.
    @discardableResult
    func play(_ request: ShapeMoveRequest, now: Double) -> Bool {
        guard request.key != lastMove else { return false }
        lastMove = request.key
        engine?.play(request.move, now: now)
        return engine != nil
    }

    func poke(now: Double) {
        engine?.play(.wink, now: now)
        motion?.pokeAt(now)
    }

    func pointer(_ at: CGPoint?) {
        if let engine {
            engine.pointer(at)
            motion?.pointer(at)
        } else {
            pendingPointer = .some(at)
        }
    }
}

enum ShapeRenderer {
    /// shape-mascot.css `shape-bounce`, 0.9 s, on a flat body (`.shape-body`).
    static let bounce = CSSKeyframes([(0, [0, 1, 1]), (0.45, [-0.06, 0.98, 1.03]), (0.7, [0, 1.04, 0.96]), (1, [0, 1, 1])])

    /// Draws one frame centred in `canvas`, its 100 box mapped onto `box` points (`ShapeFrameSvg`).
    static func draw(in context: inout GraphicsContext, canvas: CGSize, box: CGFloat, frame: ShapeFrame, pose: ShapePose, shape: MascotShape,
                     skin: ShapeSkin, hex: String, eyes style: ShapeEyeStyle = .capsule, bounce time: Double? = nil) {
        var ctx = context
        let k = box / 100
        ctx.translateBy(x: (canvas.width - box) / 2, y: (canvas.height - box) / 2)
        ctx.scaleBy(x: k, y: k)

        // rings behind the body
        for (i, ring) in frame.rings.enumerated() { stroke(ring.back, ring: ring, index: i, in: ctx) }
        if skin == .outline {
            drawFlat(in: ctx, frame: frame, skin: skin, hex: hex, bounce: time)
        } else {
            drawVolume(in: ctx, box: box, frame: frame, pose: pose, skin: skin, hex: hex, style: style)
        }
        drawExtras(in: ctx, frame: frame)
    }

    /// The badge's notch: the face steps aside around the badge.
    private static func notch(_ frame: ShapeFrame, in ctx: inout GraphicsContext) {
        guard let badge = frame.badge else { return }
        var keep = Path(CGRect(x: -60, y: -60, width: 220, height: 220))
        keep.addEllipse(in: CGRect(x: badge.x - badge.r - badge.notch, y: badge.y - badge.r - badge.notch,
                                   width: 2 * (badge.r + badge.notch), height: 2 * (badge.r + badge.notch)))
        ctx.clip(to: keep, style: FillStyle(eoFill: true))
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

    /// A body in volume (shape-volume.ts drawShape): its slices in the
    /// side's fill, then the face with the stem behind it, the dots, the
    /// marks, the badge and the two eyes, all under the face's one matrix.
    private static func drawVolume(in ctx: GraphicsContext, box: CGFloat, frame: ShapeFrame, pose: ShapePose, skin: ShapeSkin, hex: String, style: ShapeEyeStyle) {
        let paint = ShapeArt.paint(skin, hex: hex)
        let solid = skin == .plain
        let ink = ShapeVolume.ink(solid ? frame.color : paint.fill)
        let fill = solid ? ink.fill : paint.fill
        let sideFill = solid ? ink.side : paint.fill
        let detail = ShapeVolumeDetail.of(Double(box))
        // the one drawing: a plain body bends with the resting turn; a skin's own art is drawn on the outline at rest
        guard let drawing = ShapeVolume.drawShape(frame, pose, detail: detail, style: style, bend: solid) else { return }
        let body = Path(drawing.fillPath)
        let evenOdd = FillStyle(eoFill: drawing.pathD != nil)
        let extras = drawing.extras.map { Path(SVGPath.parse($0)) }

        // a move's motion (breath, drift, a move's turn) carries the whole body
        var moved = ctx
        moved.concatenate(drawing.motion)
        // the body behind its face: slices of the same outline, turned with it
        for t in drawing.slices {
            var c = moved
            c.concatenate(t)
            c.fill(body, with: .color(Color(hex: sideFill)), style: evenOdd)
            for extra in extras { c.fill(extra, with: .color(Color(hex: sideFill))) }
        }
        var face = moved
        face.concatenate(drawing.face)
        // the pumpkin's stem: behind the face, its foot under the body's top
        if let stem = drawing.stem {
            let path = CGMutablePath()
            stem.outline.add(to: path)
            var c = face
            c.opacity = stem.opacity
            c.fill(Path(path), with: .color(Color(hex: ShapeMath.mixHex(ShapeEngineData.stemInk, fill.hasPrefix("#") && fill.count == 7 ? fill : ShapeEngineData.stemInk, 0.12))))
        }
        var faceBody = face
        notch(frame, in: &faceBody)
        if let glow = paint.glow {
            var g = faceBody
            g.addFilter(.blur(radius: 2.4))
            g.fill(body, with: .color(Color(hex: glow)), style: evenOdd)
        }
        faceBody.fill(body, with: .color(Color(hex: fill)), style: evenOdd)
        for extra in extras { faceBody.fill(extra, with: .color(Color(hex: fill))) }
        if let edge = ink.edge {
            // a near-white or near-black face keeps its silhouette: one hairline, on the face only
            var c = faceBody
            c.opacity = 0.2
            c.stroke(body, with: .color(Color(hex: edge)), style: StrokeStyle(lineWidth: detail == .tiny ? 2.4 : 1.6, lineJoin: .round))
        }
        if paint.shine {
            let g = Gradient(stops: [
                .init(color: .white.opacity(0.55), location: 0),
                .init(color: .white.opacity(0.08), location: 0.45),
                .init(color: .black.opacity(0.18), location: 1),
            ])
            let bounds = body.boundingRect
            let center = CGPoint(x: bounds.minX + 0.32 * bounds.width, y: bounds.minY + 0.26 * bounds.height)
            faceBody.fill(body, with: .radialGradient(g, center: center, startRadius: 0, endRadius: 0.75 * max(bounds.width, bounds.height)), style: evenOdd)
        }
        if let stroke = paint.stroke {
            faceBody.stroke(body, with: .color(Color(hex: stroke)), style: StrokeStyle(lineWidth: paint.strokeWidth, lineJoin: .round))
        }
        dots(frame, fill: fill, in: faceBody)
        marks(frame, fill: fill, in: faceBody)
        badge(frame, in: face)

        // the eyes in their ink (dark, or light on a dark body), on the face, under its
        // matrix: they go through the very same transforms as the outline
        guard !drawing.eyes.isEmpty else { return }
        face.fill(Path(ShapeVolume.path(drawing.eyes)), with: .color(Color(hex: solid ? ink.eyes : paint.eyes)))
    }

    /// A flat skin (Outline): the eyes cut through the body, the bounce while working.
    private static func drawFlat(in ctx: GraphicsContext, frame: ShapeFrame, skin: ShapeSkin, hex: String, bounce time: Double?) {
        let paint = ShapeArt.paint(skin, hex: hex)
        let outline: CGPath = {
            if let path = frame.bodyPath, !frame.pathMorphing {
                return SVGPath.parse(path)
            }
            let path = CGMutablePath()
            ShapeMath.smoothClosedPath(frame.body, into: path)
            return path
        }()
        let eyes = CGMutablePath()
        for eye in frame.eyes { ShapeMath.smoothClosedPath(eye, into: eyes) }
        let body = Path(outline)
        var cut = body
        cut.addPath(Path(eyes))
        let evenOdd = FillStyle(eoFill: true)
        var group = ctx
        if let time, let v = bounce.value(at: time, duration: 0.9, timing: .easeInOut) {
            let bounds = body.applying(frame.affine).boundingRect
            let origin = CGPoint(x: bounds.midX, y: bounds.maxY)
            group.translateBy(x: 0, y: v[0] * bounds.height)
            group.pivot(origin, scaleX: v[1], scaleY: v[2])
        }
        var shaped = group
        shaped.concatenate(frame.affine)
        notch(frame, in: &shaped)
        shaped.fill(cut, with: .color(Color(hex: paint.fill)), style: evenOdd)
        if let stroke = paint.stroke {
            shaped.stroke(cut, with: .color(Color(hex: stroke)), style: StrokeStyle(lineWidth: paint.strokeWidth, lineJoin: .round))
        }
        dots(frame, fill: paint.fill, in: shaped)
        marks(frame, fill: paint.fill, in: shaped)
        badge(frame, in: group)
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
