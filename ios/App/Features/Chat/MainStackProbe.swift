#if DEBUG
// Main-thread stack high-water mark for the headless chat-open measure.
// `-stack-probe <out.json>`: a timer on the main run loop (a shallow frame)
// paints the free part of the main thread's stack with a pattern, and each
// tick reads how deep the stack reached since the last paint.
import Foundation
import Darwin

enum MainStackProbe {
    static let flag = "-stack-probe"
    private static let pattern: UInt64 = 0x5A5A_C0DE_5A5A_C0DE
    /// Never painted: the guard page side and what this frame and its calls use.
    private static let lowMargin: UInt = 32 * 1024
    private static let highMargin: UInt = 64 * 1024

    static var outputPath: String? {
        let args = ProcessInfo.processInfo.arguments
        guard let index = args.firstIndex(of: flag), args.indices.contains(index + 1) else { return nil }
        return args[index + 1]
    }

    private static var timer: Timer?
    private(set) static var peak = 0
    private(set) static var rowPeak = 0
    private static var rowSymbols: [String] = []
    /// The message kinds the transcript drew (the fixture is the one asked for).
    private static var rowKinds: Set<String> = []
    /// [seconds since 1970, bytes] for each tick that saw more than 64 KB.
    private static var ticks: [[Double]] = []

    static func startIfRequested() {
        guard Thread.isMainThread, timer == nil, outputPath != nil else { return }
        paint()
        timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { _ in tick() }
    }

    /// The stack's top (highest address) and size, main thread.
    private static func bounds() -> (top: UInt, bottom: UInt, size: Int) {
        let thread = pthread_self()
        let top = UInt(bitPattern: pthread_get_stackaddr_np(thread))
        let size = pthread_get_stacksize_np(thread)
        return (top, top - UInt(size), size)
    }

    @inline(never)
    private static func stackPointer() -> UInt {
        var marker: UInt8 = 0
        return withUnsafeMutablePointer(to: &marker) { UInt(bitPattern: $0) }
    }

    /// How many bytes of the main stack are in use at the caller.
    static func depth() -> Int {
        Int(bounds().top - stackPointer())
    }

    @inline(never)
    private static func paint() {
        let b = bounds()
        let low = (b.bottom + lowMargin) & ~7
        let high = (stackPointer() - highMargin) & ~7
        guard high > low, var p = UnsafeMutablePointer<UInt64>(bitPattern: low),
              let end = UnsafeMutablePointer<UInt64>(bitPattern: high) else { return }
        while p < end { p.pointee = pattern; p += 1 }
    }

    @inline(never)
    private static func highWater() -> Int {
        let b = bounds()
        let low = (b.bottom + lowMargin) & ~7
        let high = (stackPointer() - highMargin) & ~7
        guard high > low, var p = UnsafePointer<UInt64>(bitPattern: low),
              let end = UnsafePointer<UInt64>(bitPattern: high) else { return 0 }
        while p < end, p.pointee == pattern { p += 1 }
        return Int(b.top - UInt(bitPattern: p))
    }

    /// Whether the build compiles out the `#if DEBUG` layout probes of the
    /// transcript (`STACK_MEASURE`, set by `scripts/check-ios-chat-stack.sh`).
    /// A phone runs Release, where those probes are not in the tree at all, so
    /// a measure that carried them would report a stack a phone never builds.
    /// The measure says which tree it read, and `ChatOpenStackUITests` refuses
    /// a number that came from the other one (#5169).
    static let compiledOutDebugProbes = {
        #if STACK_MEASURE
        return true
        #else
        return false
        #endif
    }()

    /// A transcript row's body: how deep its ancestors already are.
    static func noteRow(kind: String) {
        guard timer != nil else { return }
        rowKinds.insert(kind)
        let d = depth()
        if d > rowPeak {
            rowPeak = d
            rowSymbols = Thread.callStackSymbols
        }
    }

    private static func tick() {
        let reached = highWater()
        if reached > peak { peak = reached }
        if reached > 64 * 1024 { ticks.append([Date().timeIntervalSince1970, Double(reached)]) }
        paint()
        write()
    }

    private static func write() {
        guard let path = outputPath else { return }
        let b = bounds()
        // What the deepest row body is made of: how many frames, and how many
        // of them are ours. The 2026-11-27 run counted 704 frames and 3 of
        // ours (this function, `MessageRow.body`, `main`): the depth is
        // AttributeGraph and SwiftUICore walking the layout down from the
        // window, 86 nested attribute updates of about 7 700 bytes each. That
        // is why half of a phone's 1 MB is below what one row body costs.
        let payload: [String: Any] = [
            "stackSize": b.size,
            "peakBytes": peak,
            "rowBodyDepthBytes": rowPeak,
            "rowBodySymbols": rowSymbols,
            "rowBodyFrames": rowSymbols.count,
            "rowBodyOwnFrames": rowSymbols.filter { $0.contains("5Sagax") }.count,
            "debugProbesCompiledOut": Self.compiledOutDebugProbes,
            "ticks": ticks,
            "rowKinds": rowKinds.sorted(),
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted]) else { return }
        try? data.write(to: URL(fileURLWithPath: path), options: .atomic)
    }
}
#endif
