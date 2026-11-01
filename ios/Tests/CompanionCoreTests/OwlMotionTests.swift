import XCTest
@testable import CompanionCore

/// The owl's rig never jumps between two frames, whatever the order of its
/// states and beats (2026-11-01: a change of state restarted the pose
/// function and the owl hopped or snapped its wings in one frame).
final class OwlMotionTests: XCTestCase {
    /// The largest change between two frames 1/60 s apart that the states'
    /// own loops produce (the alert shake, the success hop, the working
    /// wing beat), with a margin. A jump between states is larger.
    private struct Limits {
        static let x = 8.0
        static let y = 7.0
        /// The success beat's own squash-to-stretch at takeoff changes sx/sy
        /// by about 0.17 in one frame (the desktop's art, kept); the states'
        /// resting scales differ by less than 0.03, so this is not the check.
        static let scale = 0.2
        static let tilt = 1.0
        static let wing = 6.0
        static let eye = 0.05
    }

    private let fps = 60.0
    private let bases: [OwlState] = [.idle, .thinking, .working, .sleepy]

    private func assertContinuous(_ a: OwlPoseFrame, _ b: OwlPoseFrame, _ label: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertLessThanOrEqual(abs(b.x - a.x), Limits.x, "x \(label)", file: file, line: line)
        XCTAssertLessThanOrEqual(abs(b.y - a.y), Limits.y, "y \(label)", file: file, line: line)
        XCTAssertLessThanOrEqual(abs(b.sx - a.sx), Limits.scale, "sx \(label)", file: file, line: line)
        XCTAssertLessThanOrEqual(abs(b.sy - a.sy), Limits.scale, "sy \(label)", file: file, line: line)
        XCTAssertLessThanOrEqual(abs(b.tilt - a.tilt), Limits.tilt, "tilt \(label)", file: file, line: line)
        XCTAssertLessThanOrEqual(abs(b.wing - a.wing), Limits.wing, "wing \(label)", file: file, line: line)
        XCTAssertLessThanOrEqual(abs(b.eyeScale - a.eyeScale), Limits.eye, "eyeScale \(label)", file: file, line: line)
    }

    /// Without the transition, a change of state is a jump the limits catch:
    /// the test would have failed on the code JC saw.
    func testARawChangeOfStateIsAJumpTheLimitsCatch() {
        let working = OwlArt.pose(.working, 0.0417) // the wings up
        let idle = OwlArt.pose(.idle, 0)
        XCTAssertGreaterThan(abs(working.wing - idle.wing), Limits.wing)
        let thinking = OwlArt.pose(.thinking, 0.8) // tilted
        XCTAssertGreaterThan(abs(thinking.tilt - OwlArt.pose(.working, 0).tilt), Limits.tilt)
    }

    func testEveryChangeOfBaseStateIsContinuous() {
        for from in bases {
            for to in bases where to != from {
                for switchAt in [0.37, 0.71, 1.13, 1.6] {
                    let motion = OwlMotion()
                    var previous: OwlPoseFrame?
                    let start = 1000.0
                    for i in 0..<Int((switchAt + 1.2) * fps) {
                        let t = Double(i) / fps
                        let base = t < switchAt ? from : to
                        let frame = motion.tick(now: start + t, base: base, hop: 1, reduced: false)
                        if let previous { assertContinuous(previous, frame.pose, "\(from)->\(to) at \(switchAt)s, t=\(t)") }
                        previous = frame.pose
                    }
                }
            }
        }
    }

    func testBeatsAndOneShotsStartAndEndWithoutAJump() {
        for base in bases {
            for beat in OwlState.allCases {
                for playAt in [0.29, 0.83] {
                    let motion = OwlMotion()
                    var previous: OwlPoseFrame?
                    let start = 5000.0
                    for i in 0..<Int((playAt + 3.5) * fps) {
                        let t = Double(i) / fps
                        if abs(t - playAt) < 0.5 / fps { motion.play(beat, duration: 0.9) }
                        let frame = motion.tick(now: start + t, base: base, hop: 1, reduced: false)
                        if let previous { assertContinuous(previous, frame.pose, "\(beat) over \(base) at \(playAt)s, t=\(t)") }
                        previous = frame.pose
                    }
                }
            }
        }
    }

    func testTheTransitionLandsExactlyOnTheNewLoop() {
        var transition = OwlPoseTransition()
        var from = OwlPoseFrame()
        from.y = -20
        from.wing = 14
        transition.begin(from: from, at: 0)
        let target = OwlArt.pose(.idle, 0)
        XCTAssertEqual(transition.apply(target, now: 0).y, -20, accuracy: 1e-9)
        let mid = transition.apply(target, now: OwlPoseTransition.duration / 2)
        XCTAssertTrue(mid.y < 0 && mid.y > -20)
        XCTAssertEqual(transition.apply(target, now: OwlPoseTransition.duration + 0.01), target)
        XCTAssertFalse(transition.isRunning)
    }

    func testReduceMotionKeepsTheOwlStill() {
        let motion = OwlMotion()
        for i in 0..<120 {
            let frame = motion.tick(now: Double(i) / fps, base: i < 60 ? .working : .thinking, hop: 1, reduced: true)
            XCTAssertEqual(frame.pose.y, 0)
            XCTAssertEqual(frame.pose.tilt, 0)
        }
    }
}
