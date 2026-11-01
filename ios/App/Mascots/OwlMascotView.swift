// The Sagax owl in SwiftUI: a port of `src/components/OwlAvatar.tsx` (the
// parts, in paint order, and the rim), `OwlSkinFx.tsx` (the seven skins and
// their effects) and `owl-loop.ts` (blinks, beats, wing moves), on top of the
// pure numbers in `CompanionCore.OwlArt`.
//
// `animated: false` draws the resting pose once in a `Canvas` and never ticks,
// which is what a long roster needs. Animated owls tick at 60 fps (30 below
// 40 pt) while the app is active. Reduce Motion keeps only the blinks, as on the desktop.
// The owl overflows its box on purpose (the hop, the aura, the flames): the
// canvas is larger than the frame and the frame does not clip.
import Combine
import CompanionCore
import SwiftUI

/// Wing moves and beats for an owl that is on screen, like the desktop's
/// `OwlAvatarHandle`: hold one, pass it to `OwlMascotView`, call it on tap.
final class OwlMascotHandle: ObservableObject {
    enum Command {
        case play(OwlState, Double)
        case blink
        case flourish(OwlWingMove)
    }

    @Published fileprivate(set) var revision = 0
    fileprivate var pending: [Command] = []

    /// Play a state for a moment (success/alert run once), then resume.
    func play(_ state: OwlState, duration: Double = OwlBeat.heldDuration) { send(.play(state, duration)) }
    func blink() { send(.blink) }
    /// Open the wings for one move.
    func flourish(_ move: OwlWingMove) { send(.flourish(move)) }
    /// One of the fourteen Shapes moves, for a shape on screen (the editor's
    /// Moves); each call is a new request, as the desktop's `FxMoveRequest`.
    @Published private(set) var shapeMove: ShapeMoveRequest?
    func shape(_ move: ShapeMove) {
        shapeMove = ShapeMoveRequest(move: move, key: (shapeMove?.key ?? 0) + 1)
    }

    /// One of the app's one-shot motions (`MausMotion` names).
    func motion(_ name: String) {
        guard let beat = OwlBeat.forMotion(name) else { return }
        if beat.blink { blink() }
        if let play = beat.play { self.play(play) }
        if let wings = beat.wings { flourish(wings) }
    }

    private func send(_ command: Command) {
        pending.append(command)
        revision += 1
    }

    fileprivate func drain() -> [Command] {
        defer { pending.removeAll() }
        return pending
    }
}

/// A Shapes move asked for once (`FxMoveRequest`): a new key replays it.
struct ShapeMoveRequest: Equatable {
    let move: ShapeMove
    let key: Int
}

struct OwlMascotView: View {
    /// A bot colour name (`green`) or any hex.
    let color: String
    var skin: MascotSkin = .none
    var size: CGFloat = 44
    /// The continuous state. success and alert play once when entered.
    var state: OwlState = .idle
    /// Off draws the resting pose once, with no loop at all.
    var animated = false
    /// Play the skin's effects even while `animated` is off (skin pickers).
    var skinAnimated: Bool?
    /// Pin the wings open (0...1) in the still pose, for previews.
    var wings: Double = 0
    var handle: OwlMascotHandle?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var motion = OwlMotion()
    /// Keeps a still owl ticking while a wing move or beat plays.
    @State private var transientUntil: Date = .distantPast
    @State private var wake = 0

    /// The canvas is this much larger than the box, so the owl can overflow it.
    static let overflow: CGFloat = 1.5

    var body: some View {
        let hex = MausColors.owlHex(color)
        let live = (animated || transientUntil > Date()) && scenePhase == .active
        let fxLive = size >= OwlArt.detailMinSize && (skinAnimated ?? animated) && !reduceMotion && scenePhase == .active
        let ticking = live || fxLive
        let restState = animated && state.isOneShot ? OwlState.idle : state
        // `wake` re-reads `transientUntil` once a move has finished, so the timeline pauses
        let _ = wake
        // a header or panel owl hops and flaps: 60 fps there (30 read as
        // judder on a 120 Hz iPhone); a small one keeps 30
        TimelineView(.animation(minimumInterval: size >= 40 ? 1.0 / 60.0 : 1.0 / 30.0, paused: !ticking)) { timeline in
            Canvas { context, canvas in
                let now = timeline.date.timeIntervalSinceReferenceDate
                let frame: OwlRenderer.Frame
                if live {
                    let live = motion.tick(now: now, base: restState, hop: OwlArt.hop(forSize: size), reduced: reduceMotion)
                    frame = OwlRenderer.Frame(pose: live.pose, pupil: live.pupil, lid: live.lid)
                } else {
                    frame = OwlRenderer.Frame.still(state, hop: OwlArt.hop(forSize: size), wings: wings)
                }
                OwlRenderer.draw(
                    in: &context, canvas: canvas, box: size, hex: hex, skin: skin, frame: frame,
                    fxTime: fxLive ? now : nil
                )
            }
            .frame(width: size * Self.overflow, height: size * Self.overflow)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
        .owlOnChange(of: state) { new in
            // a one-shot plays when the bot enters it, not on first mount
            if animated && new.isOneShot { motion.play(new, duration: OwlBeat.heldDuration) }
        }
        .onReceive(handle?.$revision.eraseToAnyPublisher() ?? Empty().eraseToAnyPublisher()) { _ in
            guard let handle else { return }
            var longest = 0.0
            for command in handle.drain() {
                switch command {
                case let .play(s, d):
                    motion.play(s, duration: d)
                    longest = max(longest, s.isOneShot ? 1.8 : d)
                case .blink:
                    motion.blink()
                    longest = max(longest, 0.5)
                case let .flourish(move):
                    guard !reduceMotion else { continue }
                    motion.flourish(move)
                    longest = max(longest, move.duration)
                }
            }
            guard longest > 0 else { return }
            transientUntil = Date().addingTimeInterval(longest + 0.1)
            DispatchQueue.main.asyncAfter(deadline: .now() + longest + 0.15) { wake += 1 }
        }
    }
}

/// The owl's drawing, in viewBox units (0 0 256 256), in the desktop's paint order.
enum OwlRenderer {
    struct Frame {
        var pose: OwlPoseFrame
        /// Pupil offset in viewBox units.
        var pupil: CGPoint
        var lid: Double

        /// The resting pose a still owl holds.
        static func still(_ state: OwlState, hop: Double, wings: Double = 0) -> Frame {
            var pose = OwlArt.stillPose(state, hop: hop)
            pose.open = min(1, max(0, wings))
            return Frame(pose: pose, pupil: OwlArt.gazeOffset(pose.gaze), lid: pose.lid)
        }
    }

    /// The traced art, parsed once.
    struct Art {
        let body: [Path]
        let silhouette: Path
        let cream: [Path]
        let patch: [Path]
        let spots: [Path]
        let feet: [Path]
        let beak: [Path]
        let wing: [Path]
        let wingUnion: Path
        let socket: [Path]
        let lid: Path

        static let shared: Art = {
            func paths(_ ds: [String]) -> [Path] { ds.map(MascotPaths.path) }
            let greyDark = OwlArt.layer(.greyDark)
            return Art(
                body: paths(OwlArt.layer(.plumage)),
                silhouette: MascotPaths.union(OwlArt.layer(.plumage)),
                cream: paths(OwlArt.layer(.cream)),
                patch: paths(OwlArt.layer(.patch)),
                spots: paths(OwlArt.layer(.grey)),
                feet: paths(greyDark.filter { !OwlArt.isBeak($0) }),
                beak: paths(greyDark.filter(OwlArt.isBeak)),
                wing: paths(OwlArt.layer(.wingNear)),
                wingUnion: MascotPaths.union(OwlArt.layer(.wingNear)),
                socket: paths(OwlArt.layer(.socket)),
                lid: MascotPaths.path(OwlArt.lidPath)
            )
        }()
    }

    /// Draws the owl centred in `canvas`, its 256 box mapped onto `box` points.
    static func draw(in context: inout GraphicsContext, canvas: CGSize, box: CGFloat, hex: String, skin: MascotSkin, frame: Frame, fxTime: Double?) {
        let art = Art.shared
        let palette = OwlSkins.palette(skin, base: OwlArt.palette(hex), hex: hex)
        let look = OwlSkins.look(skin, hex: hex)
        let rim = skin == .none ? OwlArt.rim(hex) : look.rim
        let rimWidth = OwlArt.rimWidth(box)
        let detail = box >= OwlArt.detailMinSize
        let pose = frame.pose
        let fx = OwlSkinFx(skin: skin, look: look, detail: detail, time: fxTime, art: art)

        var ctx = context
        let k = box / OwlArt.viewBox
        ctx.translateBy(x: (canvas.width - box) / 2, y: (canvas.height - box) / 2)
        ctx.scaleBy(x: k, y: k)

        // the rig: translate, then tilt and squash about the ground point
        ctx.translateBy(x: pose.x, y: pose.y)
        ctx.pivot(OwlArt.ground, rotate: pose.tilt, scaleX: pose.sx, scaleY: pose.sy)

        fx.back(&ctx)

        // the far wing: the near wing mirrored, behind the body, only while open
        let far = OwlArt.farWing(pose.wing, open: pose.open)
        if far.visible {
            var w = ctx
            w.pivot(OwlArt.farShoulder, rotate: far.degrees, scaleX: far.scale, scaleY: far.scale)
            w.translateBy(x: OwlArt.farMirrorX * 2, y: 0)
            w.scaleBy(x: -1, y: 1)
            if let rim { stroke(&w, art.wing, rim, rimWidth) }
            fill(&w, art.wing, OwlArt.shade(palette.wingNear, 0.25))
        }
        let near = OwlArt.nearWing(pose.wing, open: pose.open)
        if let rim {
            // the near wing's rim sits behind the body, so it only shows once the wing is out
            var w = ctx
            w.pivot(OwlArt.shoulder, rotate: near.degrees, scaleX: near.scale, scaleY: near.scale)
            stroke(&w, art.wing, rim, rimWidth)
            var r = ctx
            r.opacity = fx.rimOpacity
            stroke(&r, art.body + art.feet, rim, rimWidth)
        }

        // body
        fill(&ctx, art.body, palette.plumage)
        fx.plumage(&ctx)
        fill(&ctx, art.cream, palette.cream)
        fill(&ctx, art.patch, palette.plumage)
        if detail { fill(&ctx, art.spots, palette.grey) }
        fill(&ctx, art.feet, palette.greyDark)
        fill(&ctx, art.beak, palette.greyDark)

        // near wing
        var wing = ctx
        wing.pivot(OwlArt.shoulder, rotate: near.degrees, scaleX: near.scale, scaleY: near.scale)
        fill(&wing, art.wing, palette.wingNear)
        fx.wing(&wing)

        // head
        fill(&ctx, art.socket, palette.socket)
        fx.eyeGlow(&ctx)
        var eyes = ctx
        eyes.pivot(OwlArt.eye, scaleX: pose.eyeScale, scaleY: pose.eyeScale)
        let e = OwlArt.eye
        eyes.fill(circle(e, OwlArt.irisRadius), with: .color(Color(hex: palette.iris)))
        var pupil = eyes
        pupil.translateBy(x: frame.pupil.x, y: frame.pupil.y)
        pupil.fill(circle(e, OwlArt.pupilRadius), with: .color(Color(hex: palette.pupil)))
        pupil.fill(circle(OwlArt.highlightCenter, OwlArt.highlightRadius), with: .color(Color(hex: palette.highlight)))
        let lid = min(1, max(0, frame.lid))
        if lid > 0.001 {
            var lids = eyes
            lids.clip(to: circle(e, OwlArt.lidClipRadius))
            lids.translateBy(x: 0, y: OwlArt.lidTop)
            lids.scaleBy(x: 1, y: lid)
            lids.translateBy(x: 0, y: -OwlArt.lidTop)
            lids.fill(art.lid, with: .color(Color(hex: palette.plumage)))
        }

        fx.front(&ctx)
    }

    static func circle(_ c: CGPoint, _ r: CGFloat) -> Path {
        Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2))
    }

    static func fill(_ ctx: inout GraphicsContext, _ paths: [Path], _ hex: String) {
        let color = Color(hex: hex)
        for p in paths { ctx.fill(p, with: .color(color)) }
    }

    static func stroke(_ ctx: inout GraphicsContext, _ paths: [Path], _ rim: RGBA, _ width: CGFloat) {
        let color = Color(rim)
        for p in paths { ctx.stroke(p, with: .color(color), style: StrokeStyle(lineWidth: width, lineJoin: .round)) }
    }
}

private extension View {
    /// `onChange` on iOS 16 and 17 alike, here rather than the app's shim so
    /// the widget extension, which draws owls too, compiles this file alone.
    @ViewBuilder
    func owlOnChange<V: Equatable>(of value: V, perform action: @escaping (V) -> Void) -> some View {
        if #available(iOS 17.0, *) {
            onChange(of: value) { _, new in action(new) }
        } else {
            onChange(of: value) { new in action(new) }
        }
    }
}
