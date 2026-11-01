#if DEBUG
// DEBUG-only probe for the long-transcript measure. Writes a small JSON
// file when `-long-transcript-measure` is set, so a headless UI test or
// simctl pull can record time-to-first-layout and resident memory without
// driving a visible window.
import SwiftUI
import CompanionCore

enum LongTranscriptMeasure {
    static let flag = "-long-transcript-measure"
    static let outFlag = "-long-transcript-measure-out"

    static var enabled: Bool {
        ProcessInfo.processInfo.arguments.contains(flag)
    }

    /// Process start, captured once when the flag is present.
    static let processStart = CFAbsoluteTimeGetCurrent()

    static var outputURL: URL {
        let args = ProcessInfo.processInfo.arguments
        if let index = args.firstIndex(of: outFlag),
           args.indices.contains(index + 1) {
            return URL(fileURLWithPath: args[index + 1])
        }
        return FileManager.default.temporaryDirectory
            .appendingPathComponent("sagax-long-transcript-metrics.json")
    }

    static func write(
        phase: String,
        rowCount: Int,
        lazyStack: Bool,
        firstLayoutSeconds: Double?
    ) {
        guard enabled else { return }
        let memory = residentMemoryBytes()
        var payload: [String: Any] = [
            "phase": phase,
            "rowCount": rowCount,
            "lazyStack": lazyStack,
            "secondsSinceProcessStart": CFAbsoluteTimeGetCurrent() - processStart,
            "residentMemoryBytes": memory as Any,
        ]
        if let firstLayoutSeconds {
            payload["firstLayoutSeconds"] = firstLayoutSeconds
        }
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted]),
              let _ = try? data.write(to: outputURL, options: .atomic)
        else { return }
    }

    static func residentMemoryBytesPublic() -> UInt64? {
        var info = mach_task_basic_info()
        var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size) / 4
        let result = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
            }
        }
        guard result == KERN_SUCCESS else { return nil }
        return info.resident_size
    }

    private static func residentMemoryBytes() -> UInt64? {
        residentMemoryBytesPublic()
    }
}

/// Marks first layout of the transcript content and publishes metrics for
/// the headless measure. Invisible; no effect when the flag is off.
struct LongTranscriptMetricsProbe: View {
    let rowCount: Int
    let lazyStack: Bool
    @State private var wroteFirst = false
    @State private var firstLayoutSeconds: Double?
    @State private var memoryBytes: UInt64?

    var body: some View {
        Color.clear
            .frame(width: 0, height: 0)
            .accessibilityElement()
            .accessibilityIdentifier("long-transcript-metrics")
            .accessibilityLabel(Text("Long transcript metrics"))
            .accessibilityValue(Text(accessibilityValue))
            .onAppear { report(phase: "appear") }
            .background(
                GeometryReader { proxy in
                    Color.clear
                        .onAppear { report(phase: "layout") }
                        .onValueChange(of: proxy.size.height) { _ in
                            report(phase: "layout")
                        }
                }
            )
    }

    private var accessibilityValue: String {
        var parts = ["rows=\(rowCount)", "lazy=\(lazyStack)"]
        if let firstLayoutSeconds {
            parts.append(String(format: "firstLayout=%.3f", firstLayoutSeconds))
        }
        if let memoryBytes {
            parts.append("rss=\(memoryBytes)")
        }
        return parts.joined(separator: ";")
    }

    private func report(phase: String) {
        guard LongTranscriptMeasure.enabled else { return }
        let elapsed = CFAbsoluteTimeGetCurrent() - LongTranscriptMeasure.processStart
        if phase == "layout", !wroteFirst {
            wroteFirst = true
            firstLayoutSeconds = elapsed
            memoryBytes = LongTranscriptMeasure.residentMemoryBytesPublic()
            LongTranscriptMeasure.write(
                phase: "first-layout",
                rowCount: rowCount,
                lazyStack: lazyStack,
                firstLayoutSeconds: elapsed
            )
        } else if phase == "appear" {
            LongTranscriptMeasure.write(
                phase: "appear",
                rowCount: rowCount,
                lazyStack: lazyStack,
                firstLayoutSeconds: nil
            )
        }
    }
}

#endif
