import CoreGraphics
import Foundation

/// One frame of a live owl: the rig, the pupil offset (viewBox units) and
/// how far the lids are down.
public struct OwlMotionFrame: Equatable, Sendable {
    public var pose: OwlPoseFrame
    public var pupil: CGPoint
    public var lid: Double

    public init(pose: OwlPoseFrame, pupil: CGPoint, lid: Double) {
        self.pose = pose
        self.pupil = pupil
        self.lid = lid
    }
}

/// Eases the rig from the pose the owl was in to the one a new state starts
/// with. `OwlArt.pose` is a function of the state and the time since it
/// began: on a change of state (thinking to working, the end of a one-shot,
/// a beat that runs out) it restarts from the new state's first pose, and
/// the owl jumped there in one frame (2026-11-01: a 20-unit hop up between
/// two frames on a physical iPhone). The transition carries the last pose
/// drawn and blends toward the live one for `duration`.
public struct OwlPoseTransition: Sendable {
    /// Long enough to read as one motion, short enough not to lag a state.
    public static let duration: Double = 0.28

    private var from: OwlPoseFrame?
    private var start: Double = 0

    public init() {}

    public var isRunning: Bool { from != nil }

    public mutating func begin(from pose: OwlPoseFrame, at now: Double) {
        from = pose
        start = now
    }

    public mutating func apply(_ target: OwlPoseFrame, now: Double) -> OwlPoseFrame {
        guard let from else { return target }
        let u = (now - start) / Self.duration
        if u >= 1 {
            self.from = nil
            return target
        }
        // ease-in-out (smoothstep): no kick on the first frame, no stop on the last
        let v = max(0, u)
        let k = v * v * (3 - 2 * v)
        return Self.mix(from, target, k)
    }

    /// The rig between `a` and `b` (0 = a). Gaze, lid and `done` follow `b`:
    /// the gaze and the blinks are smoothed on their own.
    public static func mix(_ a: OwlPoseFrame, _ b: OwlPoseFrame, _ k: Double) -> OwlPoseFrame {
        func l(_ x: Double, _ y: Double) -> Double { x + (y - x) * k }
        var out = b
        out.x = l(a.x, b.x)
        out.y = l(a.y, b.y)
        out.sx = l(a.sx, b.sx)
        out.sy = l(a.sy, b.sy)
        out.tilt = l(a.tilt, b.tilt)
        out.wing = l(a.wing, b.wing)
        out.open = l(a.open, b.open)
        out.eyeScale = l(a.eyeScale, b.eyeScale)
        return out
    }
}

/// `createOwlController`'s tick, without the DOM: a beat, the blinks, a wing
/// move and the gaze, stepped by the caller's clock (the timeline's date).
/// Every change of the pose function goes through `OwlPoseTransition`, so the
/// rig never jumps between two frames.
public final class OwlMotion {
    private var base: OwlState = .idle
    private var beat: (state: OwlState, until: Double?)?
    private var beatPending = false
    private var t0: Double?
    private var last: Double?
    private var nextBlink: Double = 0
    private var blinkStart: Double = -1
    private var blinkPending = false
    private var wingMove: (move: OwlWingMove, start: Double?)?
    private var gaze = OwlArt.gazeRest
    private var transition = OwlPoseTransition()
    /// The rig last drawn before the wing move, which the transition starts from.
    private var lastRig: OwlPoseFrame?

    public init() {}

    public func play(_ state: OwlState, duration: Double) {
        beat = (state, state.isOneShot ? nil : duration)
        beatPending = true
    }

    public func blink() { blinkPending = true }

    public func flourish(_ move: OwlWingMove) { wingMove = (move, nil) }

    /// Starts the pose function again at `now`, easing from the last rig drawn.
    private func restart(at now: Double) {
        t0 = now
        if let lastRig { transition.begin(from: lastRig, at: now) }
    }

    public func tick(now: Double, base newBase: OwlState, hop: Double, reduced: Bool) -> OwlMotionFrame {
        if newBase != base {
            base = newBase
            if beat == nil { beatPending = true }
        }
        if t0 == nil || beatPending {
            restart(at: now)
            beatPending = false
        }
        if nextBlink == 0 { nextBlink = now + 1 + Double.random(in: 0...4) }
        if blinkPending {
            blinkStart = now
            blinkPending = false
        }
        let dt = last.map { min(0.1, max(0, now - $0)) } ?? 0
        last = now
        var start = t0 ?? now

        if let until = beat?.until, (now - start) >= until {
            beat = nil
            restart(at: now)
            start = now
        }
        let state = beat?.state ?? base
        let oneShot = beat.map { $0.state.isOneShot } ?? false
        var pose = OwlArt.pose(state, now - start, loop: !oneShot, hop: hop)
        if pose.done {
            beat = nil
            // the next frame starts the base loop again from this pose
            lastRig = pose
            restart(at: now)
        }
        pose = transition.apply(pose, now: now)
        lastRig = pose
        if var move = wingMove {
            if move.start == nil { move.start = now }
            wingMove = move
            let w = OwlArt.wingPose(move.move, now - (move.start ?? now), hop: hop)
            if w.done {
                wingMove = nil
            } else {
                pose.open = max(pose.open, w.open)
                pose.wing += w.flap
                pose.x += w.x
                pose.y += w.y
                pose.sy *= w.sy
            }
        }

        // blink every 3-6 s (slower when sleepy); kept under reduced motion
        if now >= nextBlink {
            blinkStart = now
            nextBlink = now + (state == .sleepy ? 4 + Double.random(in: 0...3) : 3 + Double.random(in: 0...3))
        }
        let blinkDuration = state == .sleepy ? 0.45 : 0.16
        let blinkAmount = blinkStart >= 0 && now - blinkStart < blinkDuration ? sin(Double.pi * (now - blinkStart) / blinkDuration) : 0
        let lid = max(pose.lid, blinkAmount)

        if reduced {
            wingMove = nil
            var still = OwlPoseFrame()
            still.eyeScale = state == .alert ? 1.15 : 1
            gaze = OwlArt.gazeOffset(pose.gaze)
            return OwlMotionFrame(pose: still, pupil: gaze, lid: lid)
        }
        let target = OwlArt.gazeOffset(pose.gaze)
        let k = 1 - exp(-dt * 6)
        gaze = CGPoint(x: gaze.x + (target.x - gaze.x) * k, y: gaze.y + (target.y - gaze.y) * k)
        return OwlMotionFrame(pose: pose, pupil: gaze, lid: lid)
    }
}
