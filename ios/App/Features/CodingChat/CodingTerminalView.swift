// A shell call as a terminal block (`CodingTerminal.tsx`).
import CompanionCore
import SwiftUI

struct CodingTerminalView: View {
    @Environment(\.themePalette) var themePalette
    let command: String
    var output: String?
    var exitCode: Int?
    var ok: Bool?
    var durationMs: Double?
    var tests: TestSummary?
    /// Open while running or after a failure.
    var initiallyExpanded: Bool = false

    @State private var expanded = false

    private var failed: Bool { ok == false || (exitCode ?? 0) != 0 }
    private var running: Bool { ok == nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                guard output != nil || running else { return }
                expanded.toggle()
            } label: {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(verbatim: "$")
                        .font(Theme.Font.code)
                        .foregroundStyle(Theme.textTertiary)
                    Text(verbatim: command)
                        .font(Theme.Font.code)
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(expanded ? nil : 2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    trailing
                }
                .padding(10)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("coding-terminal-head")

            if expanded, let output, !output.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    Text(verbatim: output)
                        .font(Theme.Font.code)
                        .foregroundStyle(Theme.textSecondary)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.horizontal, 10)
                .padding(.bottom, 10)
                .accessibilityIdentifier("coding-terminal-output")
            }
        }
        .background(Theme.inset, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(Theme.hairline, lineWidth: 1)
        )
        .onAppear {
            expanded = initiallyExpanded || running || failed
        }
        .onChange(of: ok) { _ in
            if running || failed { expanded = true }
        }
    }

    @ViewBuilder
    private var trailing: some View {
        HStack(spacing: 6) {
            if let tests {
                Text(verbatim: testLabel(tests))
                    .font(Theme.Font.label)
                    .foregroundStyle(tests.failed > 0 ? Theme.danger : Theme.success)
            }
            if let durationMs {
                Text(verbatim: durationLabel(durationMs))
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textTertiary)
                    .monospacedDigit()
            }
            if running {
                ProgressView().controlSize(.mini)
            } else if failed {
                Text(verbatim: exitCode.map { "\($0)" } ?? "✕")
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.danger)
            } else if ok == true {
                Image(systemName: "checkmark")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.success)
            }
        }
    }

    private func testLabel(_ tests: TestSummary) -> String {
        var parts: [String] = []
        if tests.passed > 0 { parts.append(CodingChatRules.testsPassedLabel(tests.passed)) }
        if tests.failed > 0 { parts.append(CodingChatRules.testsFailedLabel(tests.failed)) }
        if tests.skipped > 0 { parts.append(CodingChatRules.testsSkippedLabel(tests.skipped)) }
        return parts.joined(separator: " · ")
    }

    private func durationLabel(_ ms: Double) -> String {
        if ms < 1000 { return "\(Int(ms))ms" }
        let seconds = ms / 1000
        if seconds < 60 { return String(format: "%.1fs", seconds) }
        return "\(Int(seconds / 60))m"
    }
}
