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
        let payload: [String: Any] = [
            "stackSize": b.size,
            "peakBytes": peak,
            "rowBodyDepthBytes": rowPeak,
            "rowBodySymbols": rowSymbols,
            "ticks": ticks,
            "rowKinds": rowKinds.sorted(),
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted]) else { return }
        try? data.write(to: URL(fileURLWithPath: path), options: .atomic)
    }
}
#endif
