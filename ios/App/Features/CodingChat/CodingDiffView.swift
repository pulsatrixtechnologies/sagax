// A file edit as a unified diff (`CodingDiff.tsx`).
import CompanionCore
import SwiftUI

struct CodingDiffView: View {
    @Environment(\.themePalette) var themePalette
    let file: DiffFile
    var initiallyExpanded: Bool = true

    @State private var expanded = true

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                expanded.toggle()
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "doc.text")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textSecondary)
                    Text(verbatim: file.path)
                        .font(Theme.Font.code)
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if file.added > 0 {
                        Text(verbatim: "+\(file.added)")
                            .font(Theme.Font.label)
                            .foregroundStyle(Theme.success)
                            .monospacedDigit()
                    }
                    if file.removed > 0 {
                        Text(verbatim: "-\(file.removed)")
                            .font(Theme.Font.label)
                            .foregroundStyle(Theme.danger)
                            .monospacedDigit()
                    }
                    Image(systemName: expanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(Theme.textTertiary)
                }
                .padding(10)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("coding-diff-head.\(file.path)")

            if expanded {
                if file.binary == true {
                    Text("Binary file")
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.textSecondary)
                        .padding(.horizontal, 10)
                        .padding(.bottom, 10)
                } else if file.hunks.isEmpty {
                    Text("No line changes shown.")
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.textTertiary)
                        .padding(.horizontal, 10)
                        .padding(.bottom, 10)
                } else {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(file.hunks.enumerated()), id: \.offset) { _, hunk in
                            ForEach(Array(collapsed(hunk.lines).enumerated()), id: \.offset) { _, row in
                                switch row {
                                case let .line(line):
                                    diffLine(line)
                                case let .skip(count):
                                    Text(verbatim: "… \(count) unchanged lines")
                                        .font(Theme.Font.label)
                                        .foregroundStyle(Theme.textTertiary)
                                        .padding(.horizontal, 10)
                                        .padding(.vertical, 4)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .background(Theme.inset.opacity(0.7))
                                }
                            }
                        }
                    }
                    .padding(.bottom, 6)
                }
            }
        }
        .background(Theme.inset, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(Theme.hairline, lineWidth: 1)
        )
        .onAppear { expanded = initiallyExpanded }
    }

    private enum Row {
        case line(DiffLine)
        case skip(Int)
    }

    /// Fold long unchanged runs the way the desktop does.
    private func collapsed(_ lines: [DiffLine]) -> [Row] {
        var out: [Row] = []
        var ctxRun = 0
        func flushCtx() {
            if ctxRun > 6 {
                out.append(.skip(ctxRun))
            } else if ctxRun > 0 {
                // Keep them; the loop already emitted them when run was short.
            }
            ctxRun = 0
        }
        // Simpler: emit ctx lines, and when a run of ctx exceeds 8, replace the middle with a skip.
        var buffer: [DiffLine] = []
        func flushBuffer(keepEdges: Bool) {
            if buffer.count > 8 {
                let head = Array(buffer.prefix(2))
                let tail = Array(buffer.suffix(2))
                for line in head { out.append(.line(line)) }
                out.append(.skip(buffer.count - 4))
                for line in tail { out.append(.line(line)) }
            } else {
                for line in buffer { out.append(.line(line)) }
            }
            buffer = []
        }
        for line in lines {
            if line.kind == .ctx {
                buffer.append(line)
            } else {
                flushBuffer(keepEdges: true)
                out.append(.line(line))
            }
        }
        flushBuffer(keepEdges: true)
        _ = (ctxRun, flushCtx)
        return out
    }

    private func diffLine(_ line: DiffLine) -> some View {
        let prefix: String
        let color: Color
        let bg: Color
        switch line.kind {
        case .add:
            prefix = "+"
            color = Theme.success
            bg = Theme.success.opacity(0.12)
        case .del:
            prefix = "-"
            color = Theme.danger
            bg = Theme.danger.opacity(0.12)
        case .ctx:
            prefix = " "
            color = Theme.textSecondary
            bg = Color.clear
        }
        return HStack(alignment: .top, spacing: 0) {
            Text(verbatim: prefix)
                .font(Theme.Font.code)
                .foregroundStyle(color)
                .frame(width: 14, alignment: .center)
            Text(verbatim: line.text)
                .font(Theme.Font.code)
                .foregroundStyle(color)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 1)
        .background(bg)
    }
}
