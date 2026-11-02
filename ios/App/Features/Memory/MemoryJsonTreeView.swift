// Folding JSON tree for memory notes in read mode (desktop MemoryJsonTree.tsx).
import CompanionCore
import SwiftUI

struct MemoryJsonTreeView: View {
    let source: String
    @State private var open: Set<String> = [MemoryJsonTree.rootPath]

    var body: some View {
        if let value = MemoryJsonTree.parse(source) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Button {
                        open = MemoryJsonTree.expandAllPaths(value)
                    } label: {
                        Label(String(localized: "Expand all"), systemImage: "arrow.up.left.and.arrow.down.right")
                    }
                    .buttonStyle(.borderless)
                    Button {
                        open = []
                    } label: {
                        Label(String(localized: "Collapse all"), systemImage: "arrow.down.right.and.arrow.up.left")
                    }
                    .buttonStyle(.borderless)
                }
                .font(.caption)
                .foregroundStyle(Theme.textSecondary)

                MemoryJsonNodeView(label: nil, value: value, path: MemoryJsonTree.rootPath, open: $open, depth: 1)
            }
            .padding(10)
            .background(Theme.inset.opacity(0.4), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .accessibilityIdentifier("memory-json-tree")
        } else {
            Text(source)
                .font(.system(.footnote, design: .monospaced))
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct MemoryJsonNodeView: View {
    let label: String?
    let value: MemoryJsonValue
    let path: String
    @Binding var open: Set<String>
    let depth: Int
    @State private var shown = MemoryJsonTree.pageSize

    var body: some View {
        let kind = MemoryJsonTree.kind(of: value)
        if kind != .object && kind != .array {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                if let label {
                    Text(label).foregroundColor(Theme.textPrimary)
                    Text(":").foregroundColor(Theme.textTertiary)
                }
                scalar
            }
            .font(.system(.footnote, design: .monospaced))
            .padding(.leading, 20)
        } else {
            let isOpen = open.contains(path)
            let kids = MemoryJsonTree.children(of: value)
            VStack(alignment: .leading, spacing: 2) {
                Button {
                    if isOpen { open.remove(path) } else { open.insert(path) }
                } label: {
                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        Image(systemName: isOpen ? "chevron.down" : "chevron.right")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Theme.textSecondary)
                        if let label {
                            Text(label).foregroundColor(Theme.textPrimary)
                            Text(":").foregroundColor(Theme.textTertiary)
                        }
                        Text(kind == .array ? "[" : "{")
                            .foregroundStyle(Theme.textSecondary)
                        if !isOpen {
                            Text("… \(kind == .array ? "]" : "}")")
                                .foregroundStyle(Theme.textSecondary)
                        }
                        Text(kind == .array
                             ? String(localized: "\(kids.count) items")
                             : String(localized: "\(kids.count) keys"))
                            .font(.caption2)
                            .foregroundStyle(Theme.textTertiary)
                    }
                    .font(.system(.footnote, design: .monospaced))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("memory-json-fold")

                if isOpen {
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(Array(kids.prefix(shown).enumerated()), id: \.offset) { _, pair in
                            MemoryJsonNodeView(
                                label: pair.0,
                                value: pair.1,
                                path: MemoryJsonTree.childPath(path, key: pair.0),
                                open: $open,
                                depth: depth + 1
                            )
                        }
                        if kids.count > shown {
                            Button(String(localized: "Show \(kids.count - shown) more")) {
                                shown += MemoryJsonTree.pageSize
                            }
                            .font(.caption)
                            .padding(.leading, 20)
                        }
                    }
                    .padding(.leading, 8)
                    .overlay(alignment: .leading) {
                        Rectangle()
                            .fill(Theme.hairline.opacity(0.4))
                            .frame(width: 1)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var scalar: some View {
        switch value {
        case let .string(text):
            let clipped = text.count > 240 ? String(text.prefix(240)) + "…" : text
            Text(String(reflecting: clipped)).foregroundStyle(Theme.success)
        case let .number(n):
            Text(formatNumber(n)).foregroundStyle(Theme.accent)
        case let .bool(b):
            Text(b ? "true" : "false").foregroundStyle(Theme.warning)
        case .null:
            Text("null").foregroundStyle(Theme.textTertiary)
        default:
            EmptyView()
        }
    }

    private func formatNumber(_ n: Double) -> String {
        if n.rounded() == n, n >= Double(Int.min), n <= Double(Int.max) {
            return String(Int(n))
        }
        return String(n)
    }
}
