// A fenced code block (`ChatMarkdown.tsx` CodeBlock). The phone keeps its
// look (reference 02): the language over the code on an inset panel,
// pushed sideways rather than wrapped. The desktop's toolbar lives in the
// long-press menu: Copy code, Save (the share sheet, as a snippet file named
// the desktop's way) and Wrap long lines. A block longer than 30 lines folds
// behind "Show all N lines" once the message is complete.
import SwiftUI
import UIKit
import CompanionCore

struct CodeBlockView: View {
    /// The UIKit face of `Theme.mono(12)`, for its line box.
    static var codeFace: UIFont { UIFont(name: "GeistMono-Regular", size: 12) ?? .monospacedSystemFont(ofSize: 12, weight: .regular) }

    @Environment(\.themePalette) var themePalette
    let language: String?
    let code: String
    /// Still being written: never folds, so a growing block does not jump.
    var pending = false
    /// The streaming caret after the last character.
    var caret: Text = Text("")
    var identifier: String?

    @State private var wrap = false
    @State private var expanded = false
    @State private var share: RichShareItem?
    @StateObject private var feedback = RichCopyFeedback()
    /// iPad desktop shell: ChatMarkdown.tsx's CodeBlock with its toolbar.
    @Environment(\.desktopChatText) private var desktop

    private var lineCount: Int { CodeBlocks.countLines(code) }
    private var collapsible: Bool { !pending && lineCount > CodeBlocks.collapseLines }
    private var folded: Bool { collapsible && !expanded }

    var body: some View {
        if let desktop {
            desktopBody(desktop)
        } else {
            phoneBody
        }
    }

    /// The desktop block: inset panel, hairline ring at 40 %, radius 8; a
    /// header strip (raised at 30 %) with the language chip, "N lines" and
    /// Wrap, Save, Copy; the code 12/18 monospaced, 12 in.
    private func desktopBody(_ theme: DesktopTheme) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                if let language, !language.isEmpty {
                    Text(verbatim: CodeBlocks.languageDisplayName(language))
                        .font(theme.font(11, .medium))
                        .tracking(0.275)
                        .foregroundStyle(theme.ink)
                        .lineLimit(1)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(theme.raised, in: RoundedRectangle(cornerRadius: 4))
                        .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(theme.hairline.opacity(0.4), lineWidth: 1))
                }
                Text(lineCount == 1 ? "1 line" : "\(lineCount) lines")
                    .font(theme.font(11))
                    .foregroundStyle(theme.inkSecondary)
                Spacer(minLength: 8)
                DesktopBlockTool(icon: "text.word.spacing", title: "Wrap", pressed: wrap) { wrap.toggle() }
                    .accessibilityLabel(Text("Wrap long lines"))
                DesktopBlockTool(icon: "arrow.down.to.line", title: "Save") {
                    share = RichShareItem.writing(code, named: CodeBlocks.snippetFileName(language))
                }
                .accessibilityLabel(Text("Save as file"))
                DesktopBlockTool(icon: "doc.on.doc", title: feedback.copied == nil ? "Copy" : "Copied") { feedback.copy("code", code) }
                    .accessibilityLabel(Text("Copy code"))
            }
            .padding(.horizontal, 12)
            .frame(height: 33.7)
            .background(theme.raised.opacity(0.3))
            .overlay(alignment: .bottom) { Rectangle().fill(theme.hairline.opacity(0.3)).frame(height: 1) }
            Group {
                // Shiki's github-dark / -light roles, once the block is settled
                let body = !pending && DesktopCodeHighlight.supports(language)
                    ? Text(DesktopCodeHighlight.attributed(code, language: language, ink: theme.ink, dark: theme.dark))
                    : Text(verbatim: code)
                let text = (body + caret)
                    .font(Theme.mono(12))
                    .tracking(DesktopChatMetrics.monoTracking(12))
                    // `leading-[18px]` measured on the face drawn (Geist Mono,
                    // whose natural line is not SF Mono's)
                    .lineSpacing(max(0, 18 - Self.codeFace.lineHeight))
                    // the 18 pt line box's half-leading above and below
                    .padding(.vertical, (max(0, 18 - Self.codeFace.lineHeight) * 2).rounded(.down) / 4)
                    .foregroundStyle(theme.ink)
                    .textSelection(.enabled)
                if wrap {
                    text.fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    ScrollView(.horizontal, showsIndicators: false) { text }
                }
            }
            .frame(maxHeight: folded ? 352 : nil, alignment: .top)
            .clipped()
            .padding(12)
        }
        // inside the 1 pt border, as the desktop's box
        .padding(1)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.4), lineWidth: 1))
        .sheet(item: $share) { item in
            ActivityShareSheet(items: [item.url])
        }
        .accessibilityElement(children: .contain)
        .modifier(RichIdentifier(identifier: identifier))
    }

    private var phoneBody: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let language, !language.isEmpty {
                Text(verbatim: CodeBlocks.languageDisplayName(language))
                    .font(Theme.mono(11, .medium))
                    .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
            }
            codeText
                .frame(maxHeight: folded ? 352 : nil, alignment: .top)
                .clipped()
                .mask {
                    if folded {
                        LinearGradient(stops: [.init(color: .black, location: 0.8), .init(color: .clear, location: 1)], startPoint: .top, endPoint: .bottom)
                    } else {
                        Rectangle()
                    }
                }
            if collapsible {
                Button {
                    expanded.toggle()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: expanded ? "chevron.up" : "chevron.down")
                        if expanded { Text("Collapse") } else { Text("Show all \(lineCount) lines") }
                    }
                    .font(.system(size: 11.5))
                    .foregroundStyle(Theme.textSecondary)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 4)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier(identifier.map { "\($0)-fold" } ?? "code-fold")
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Theme.parity(Color.secondary.opacity(0.14), Theme.inset))
        )
        .overlay(alignment: .topTrailing) {
            RichCopiedBadge(feedback: feedback, identifier: identifier.map { "\($0)-copied" } ?? "code-copied")
        }
        .contentShape(.contextMenuPreview, RoundedRectangle(cornerRadius: 10, style: .continuous))
        .contextMenu {
            Button {
                feedback.copy("code", code)
            } label: {
                Label("Copy code", systemImage: "doc.on.doc")
            }
            Button {
                share = RichShareItem.writing(code, named: CodeBlocks.snippetFileName(language))
            } label: {
                Label("Save as file", systemImage: "square.and.arrow.down")
            }
            Button {
                wrap.toggle()
            } label: {
                if wrap {
                    Label("Disable line wrapping", systemImage: "arrow.left.and.right.text.vertical")
                } else {
                    Label("Wrap long lines", systemImage: "text.word.spacing")
                }
            }
        }
        .sheet(item: $share) { item in
            ActivityShareSheet(items: [item.url])
        }
        .accessibilityElement(children: .contain)
        .modifier(RichIdentifier(identifier: identifier))
    }

    @ViewBuilder
    private var codeText: some View {
        let text = (Text(verbatim: code) + caret)
            .font(Theme.Font.code)
            .lineSpacing(Theme.bodyLineSpacing)
            .textSelection(.enabled)
        if wrap {
            text.fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            // Horizontal scroll rather than wrapping: wrapped code is harder
            // to read than code you have to push sideways, and indentation
            // is most of what a snippet is saying.
            ScrollView(.horizontal, showsIndicators: false) { text }
        }
    }
}
