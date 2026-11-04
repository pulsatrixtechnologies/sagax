// Crab, the pixel-rect mascot: a port of `src/components/CrabMascot.tsx`
// drawn from `CrabArt` (the desktop's idle sprite, Clawd-Still 24x16). Under
// 48 pt it is a bust. While animated it does the desktop's CSS idle (a bob
// of one cell, a blink, a look-around, on happy a clap with sparkles) as one
// rigid pixel sprite at the desktop's footprint (#340, CrabRig). Reduce
// Motion keeps it still, as on the desktop.
import CompanionCore
import SwiftUI

struct CrabMascotView: View {
    var skin: CrabSkin = .plain
    /// A bot colour name (`orange`) or any hex.
    let color: String
    var size: CGFloat = 44
    var mood: CrabMood = .idle
    var animated = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        let live = animated && !reduceMotion && scenePhase == .active
        TimelineView(.animation(minimumInterval: 1.0 / 60.0, paused: !live)) { timeline in
            Canvas { context, canvas in
                CrabRenderer.draw(
                    in: &context, canvas: canvas, box: size, skin: skin, hex: CrabArt.hex(color),
                    mood: mood, time: live ? timeline.date.timeIntervalSinceReferenceDate : nil
                )
            }
            .frame(width: size, height: size)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// `CrabMood` in CrabMascot.tsx, from `bunbuMoodFor` in Avatar.tsx.
enum CrabMood: Sendable {
    case idle, thinking, working, happy, sleeping, listening, speaking

    init(state: MausState) {
        self = CrabMood(bunbu: BunbuMood(state: state))
    }

    init(bunbu: BunbuMood) {
        switch bunbu {
        case .thinking: self = .thinking
        case .working: self = .working
        case .happy: self = .happy
        case .sleeping: self = .sleeping
        case .listening: self = .listening
        case .speaking: self = .speaking
        case .idle: self = .idle
        }
    }

    /// `crabExpressionForMood`.
    var face: String {
        switch self {
        case .thinking: return "curious"
        case .working: return "attentive"
        case .happy: return "happy"
        case .sleeping: return "sleepy"
        case .listening: return "attentive"
        case .speaking: return "excited"
        case .idle: return "neutral"
        }
    }
}

enum CrabRenderer {
    /// The desktop's CSS idle (crab-mascot.css): only the blink and the look
    /// move inside the sprite; the rest is CrabRig (one rigid sprite).
    static let blink = CSSKeyframes([(0, [1]), (0.42, [1]), (0.5, [0.12]), (0.58, [1]), (1, [1])])
    static let look = CSSKeyframes([
        (0, [0, 0]),
        (0.22, [3.4, 1]),
        (0.48, [-2.2, 1.6]),
        (0.74, [2, -1]),
        (1, [0, 0]),
    ])
    static let spark = CSSKeyframes([
        (0, [0]),
        (0.20, [1]),
        (0.34, [0.3]),
        (0.48, [1]),
        (0.62, [0.3]),
        (0.76, [1]),
        (1, [0]),
    ])

    static func draw(in context: inout GraphicsContext, canvas: CGSize, box: CGFloat, skin: CrabSkin, hex: String, mood: CrabMood, time: Double?) {
        let paint = CrabArt.paint(skin, hex: hex)
        let marks = CrabArt.marks(skin, hex: hex)
        let drawn = CrabArt.eyes(mood.face)
        let bust = box <= CrabArt.bustMax
        var ctx = context
        ctx.translateBy(x: (canvas.width - box) / 2, y: (canvas.height - box) / 2)
        if bust {
            let b = CrabArt.bust
            ctx.scaleBy(x: box / b.width, y: box / b.height)
            ctx.translateBy(x: -b.minX, y: -b.minY)
        } else {
            // `crabViewBox`: the whole 100 x 100 sprite fills the box, as
            // CrabMascot draws it everywhere (the gallery tiles, the
            // editor's stage, the avatars). The 0.6 footprint
            // (`CRAB_DESKTOP_SCALE`) is only the desktop's floating bot.
            ctx.scaleBy(x: box / 100, y: box / 100)
        }

        func loop(_ frames: CSSKeyframes, _ duration: Double, delay: Double = 0, rest: [Double], alternate: Bool = false) -> [Double] {
            guard let time, let value = frames.value(at: time, duration: duration, delay: delay, timing: .easeInOut, alternate: alternate) else { return rest }
            return value
        }
        let sleeping = mood == .sleeping
        let listening = mood == .listening
        let speaking = mood == .speaking
        let happy = mood == .happy

        let rig = CrabRig.pose(sleeping: sleeping, listening: listening, speaking: speaking, happy: happy, time: time)
        let eyeOpen = sleeping ? 0.12 : loop(blink, 3.2, rest: [1])[0]
        let lookXY = sleeping ? [0.0, 0.0] : loop(look, 10.9, rest: [0, 0])
        let sparkOpacity = happy && !bust ? loop(spark, 1.8, rest: [0])[0] : 0

        var whole = ctx
        // one rigid sprite: it steps up whole cells and tilts on its ground point, never stretches
        whole.translateBy(x: 0, y: rig.lift)
        if rig.tilt != 0 { whole.pivot(CrabArt.ground, rotate: rig.tilt) }

        func fill(_ rect: CrabArt.Rect, _ hex: String, in base: GraphicsContext, opacity: Double = 1) {
            var c = base
            if opacity < 1 { c.opacity = opacity }
            c.fill(Path(rect.cg), with: .color(Color(hex: hex)))
        }

        for mark in marks.under { fill(mark.r, mark.fill, in: whole, opacity: mark.opacity) }
        fill(CrabArt.body, paint.fill, in: whole)
        for mark in marks.inner { fill(mark.r, mark.fill, in: whole, opacity: mark.opacity) }

        // arms and legs stay on the body's grid: a clap lifts both arms one cell, nothing rotates apart
        var arms = whole
        arms.translateBy(x: 0, y: rig.armLift)
        fill(CrabArt.armL, paint.accent, in: arms)
        fill(CrabArt.armR, paint.accent, in: arms)

        if !bust {
            for leg in CrabArt.legs { fill(leg, paint.fill, in: whole) }
        }

        var eyes = whole
        eyes.translateBy(x: lookXY[0], y: lookXY[1])
        func eye(_ pupil: CrabArt.Rect, _ pivot: CGPoint) {
            var lid = eyes
            lid.pivot(pivot, scaleX: 1, scaleY: eyeOpen)
            fill(pupil, paint.eyes, in: lid)
        }
        eye(drawn.pupils.0, CrabArt.eyeLPivot)
        eye(drawn.pupils.1, CrabArt.eyeRPivot)

        if sparkOpacity > 0.01 {
            for dot in CrabArt.sparkles {
                fill(dot, CrabArt.spark, in: whole, opacity: sparkOpacity)
            }
        }
        for mark in marks.around { fill(mark.r, mark.fill, in: whole, opacity: mark.opacity) }
    }
}
