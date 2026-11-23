import CompanionCore
import SwiftUI

/// The one look of every interactive question (owner 2026-10-20), the
/// desktop's `src/components/QuestionSheet.tsx` in SwiftUI: under the bot's
/// bubble, a separate card in the bubble's own fill, 16 pt corners and
/// padding, the question in bold, then one row per answer: a small rounded
/// key (A, B, C) and the label in plain text. No outline, no filled buttons.
/// A tap is the answer. Choose-several questions draw a box instead of the
/// key; a question in words draws one plain field. Once answered the card
/// stays, the chosen row marked and the others dimmed.
///
/// Used by `QuestionCardView` (AskUserQuestion) and `FlatQuestionCardView`
/// (ask_person and the bots' flat asks).
struct QuestionSheetColors {
    let fill: Color
    let ink: Color
    let inkSecondary: Color
    let desktop: DesktopTheme?
    /// #4490: Dynamic Type factor (a form passes its `ScaledMetric`); 1 keeps
    /// every other card exactly as it was.
    let scale: CGFloat

    /// `secondaryOpacity`: 0.62 keeps every other card as it was; the form passes 0.7,
    /// which holds 4.5:1 on the card and on its pills in the light theme.
    init(desktop: DesktopTheme?, scale: CGFloat = 1, secondaryOpacity: Double = 0.62) {
        self.desktop = desktop
        self.scale = scale
        fill = desktop?.card ?? BubbleColor.theirs
        ink = desktop?.ink ?? BubbleColor.theirsText
        inkSecondary = desktop?.inkSecondary ?? BubbleColor.theirsText.opacity(secondaryOpacity)
    }

    func font(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        desktop?.font(size * scale, weight) ?? .system(size: (size + 1) * scale, weight: weight)
    }
}

/// The card around a question.
struct QuestionSheet<Content: View>: View {
    let colors: QuestionSheetColors
    let title: String
    var meta: String? = nil
    var onDismiss: (() -> Void)? = nil
    /// #3471: the × of a waiting card skips it ("Skip this without answering").
    var dismissLabel: String? = nil
    var dismissId: String? = nil
    /// The title is the bot's question: draw it with the bubble's markdown (#5043).
    var markdownTitle = false
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            QuestionSheetHeader(colors: colors, title: title, markdown: markdownTitle, meta: meta, onDismiss: onDismiss, dismissLabel: dismissLabel, dismissId: dismissId)
            content()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(colors.fill, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .frame(maxWidth: colors.desktop == nil ? .infinity : 560, alignment: .leading)
    }
}

/// The card's title line: the title, an optional progress, the skip ×.
struct QuestionSheetHeader: View {
    let colors: QuestionSheetColors
    let title: String
    /// The title is the bot's own question (#5043).
    var markdown = false
    var meta: String? = nil
    var onDismiss: (() -> Void)? = nil
    var dismissLabel: String? = nil
    var dismissId: String? = nil

    private var titleText: some View {
        Group {
            if markdown {
                CardMarkdown(source: title)
                    .foregroundStyle(colors.ink)
            } else {
                Text(title)
                    .font(colors.font(14, .semibold))
                    .foregroundStyle(colors.ink)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .textSelection(.enabled)
    }

    private var metaText: some View {
        Text(meta ?? "")
            .font(colors.font(11.5).monospacedDigit())
            .foregroundStyle(colors.inkSecondary)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var dismissButton: some View {
        Group {
            if let onDismiss {
                Button {
                    Haptics.selection()
                    onDismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(colors.inkSecondary)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.top, -13)
                .padding(.trailing, -14)
                .padding(.bottom, -13)
                .accessibilityLabel(dismissLabel.map { Text(verbatim: $0) } ?? Text("Dismiss"))
                .accessibilityIdentifier(dismissId ?? "question-dismiss")
            }
        }
    }

    var body: some View {
        // title and progress share a line when both fit; otherwise the progress
        // goes under the title, so no word is ever broken to make room
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 8) {
                titleText
                Spacer(minLength: 4)
                if meta != nil { metaText }
                dismissButton
            }
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .top, spacing: 8) {
                    titleText
                    Spacer(minLength: 4)
                    dismissButton
                }
                if meta != nil { metaText }
            }
        }
    }
}

/// One answer: the 22 pt key (or a box), then the label.
struct QuestionSheetRow: View {
    let colors: QuestionSheetColors
    let index: Int
    let label: String
    var detail: String? = nil
    /// Lucide icon key from the option (#2048 page targets); mapped to SF Symbol.
    var icon: String? = nil
    var multi = false
    var on = false
    var settled = false
    /// #4490: a checklist row ticks without the highlighted fill.
    var quiet = false
    /// #4490: a checklist row is a 44 pt target.
    var minHeight: CGFloat = 0
    var disabled = false
    let action: () -> Void

    static func key(_ index: Int) -> String { String(UnicodeScalar(UInt8(65 + min(index, 25)))) }

    /// Lucide name → SF Symbol for the few icons the page-target card uses.
    static func systemIcon(for key: String?) -> String? {
        switch key {
        case "file-text": return "doc.text"
        case "layout-dashboard": return "rectangle.split.3x3"
        case "sparkles": return "sparkles"
        case "box": return "shippingbox"
        default: return nil
        }
    }

    var body: some View {
        Button {
            Haptics.selection()
            action()
        } label: {
            HStack(alignment: .center, spacing: 12) {
                if multi { box } else { keyBadge }
                if let symbol = Self.systemIcon(for: icon) {
                    Image(systemName: symbol)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(colors.inkSecondary)
                        .frame(width: 18, height: 18)
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text(label)
                        .font(colors.font(13.5))
                        .foregroundStyle(colors.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    if let detail, !detail.isEmpty {
                        CardMarkdown(source: detail)
                            .foregroundStyle(colors.inkSecondary)
                    }
                }
                Spacer(minLength: 0)
                if settled && on {
                    Image(systemName: "checkmark")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(colors.inkSecondary)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 7)
            .frame(minHeight: minHeight)
            .background {
                if on && !quiet {
                    RoundedRectangle(cornerRadius: 10, style: .continuous).fill(colors.ink.opacity(settled ? 0.06 : 0.07))
                }
            }
            .contentShape(Rectangle())
            // Settled-unpicked and unavailable options (#2048) share the same dim.
            .opacity((settled && !on) || (disabled && !on && !quiet) ? 0.45 : 1)
        }
        .buttonStyle(QuestionSheetRowStyle(colors: colors))
        .disabled(settled || disabled)
        .padding(.horizontal, -8)
        .accessibilityAddTraits(on ? [.isSelected] : [])
    }

    private var keyBadge: some View {
        Text(Self.key(index))
            .font(colors.font(11.5, .medium))
            .foregroundStyle(on ? colors.ink : colors.inkSecondary)
            .frame(width: 22, height: 22)
            .background(colors.ink.opacity(on ? 0.16 : 0.06), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(colors.ink.opacity(on ? 0.28 : 0.14), lineWidth: 1))
    }

    private var box: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 5, style: .continuous)
                .fill(colors.ink.opacity(on ? 0.16 : 0.06))
            RoundedRectangle(cornerRadius: 5, style: .continuous)
                .strokeBorder(colors.ink.opacity(on ? 0.28 : 0.18), lineWidth: 1)
            if on {
                Image(systemName: "checkmark")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(colors.ink)
            }
        }
        .frame(width: 18, height: 18)
        .frame(width: 22, height: 22)
    }
}

/// A pressed (or hovered, on iPad with a pointer) row lights up a little.
private struct QuestionSheetRowStyle: ButtonStyle {
    let colors: QuestionSheetColors
    @State private var hovering = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(colors.ink.opacity(configuration.isPressed || hovering ? 0.05 : 0))
            )
            .onHover { hovering = $0 }
    }
}

/// One plain field for an answer in words; Return or the arrow sends.
struct QuestionSheetField: View {
    let colors: QuestionSheetColors
    let placeholder: LocalizedStringKey
    @Binding var text: String
    var focus: FocusState<Bool>.Binding
    let canSend: Bool
    let send: () -> Void

    var body: some View {
        HStack(alignment: .bottom, spacing: 6) {
            TextField(placeholder, text: $text, axis: .vertical)
                .font(colors.font(13.5))
                .foregroundStyle(colors.ink)
                .lineLimit(1...4)
                .focused(focus)
                .textFieldStyle(.plain)
                .submitLabel(.send)
                .onSubmit { if canSend { send() } }
                .padding(.vertical, 2)
            if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Button(action: send) {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(colors.fill)
                        .frame(width: 24, height: 24)
                        .background(colors.ink, in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(!canSend)
                .opacity(canSend ? 1 : 0.3)
                .accessibilityLabel(Text("Submit answer"))
            }
        }
        .padding(.leading, 12)
        .padding(.trailing, 6)
        .padding(.vertical, 6)
        .background(colors.ink.opacity(0.04), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(colors.ink.opacity(0.12), lineWidth: 1))
    }
}

/// A line under the rows: an answer given in words, or why the card closed.
struct QuestionSheetNote: View {
    let colors: QuestionSheetColors
    let text: String
    var closed = false

    var body: some View {
        Label {
            Text(text)
                .font(colors.font(12.5))
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: closed ? "xmark" : "checkmark")
                .font(.system(size: 11, weight: .semibold))
        }
        .foregroundStyle(colors.inkSecondary)
    }
}

/// The quiet send of a choose-several question or a set: text, no fill.
struct QuestionSheetSend: View {
    let colors: QuestionSheetColors
    let label: LocalizedStringKey
    let enabled: Bool
    let action: () -> Void

    var body: some View {
        HStack {
            Spacer(minLength: 0)
            Button(action: { if enabled { action() } }) {
                Text(label)
                    .font(colors.font(13, .medium))
                    .foregroundStyle(colors.inkSecondary)
                    .padding(.horizontal, 12)
                    .frame(height: 28)
                    .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .opacity(enabled ? 1 : 0.4)
        }
    }
}

/// #4490: the buttons of a form or a checklist. The first action is the main
/// one and is drawn last, filled, where the eye ends; the others are quiet
/// text. Each is a 44 pt target; at a large text size they stack and wrap.
struct QuestionSheetButtons: View {
    let colors: QuestionSheetColors
    let actions: [String]
    let enabled: Bool
    let onPress: (String) -> Void

    private var ordered: [String] { Array(actions.dropFirst()) + actions.prefix(1) }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 6) {
                Spacer(minLength: 0)
                ForEach(Array(ordered.enumerated()), id: \.offset) { position, action in button(action, position) }
            }
            VStack(alignment: .trailing, spacing: 6) {
                // stacked, the main action stays last (bottom) and filled
                ForEach(Array(ordered.enumerated()), id: \.offset) { position, action in button(action, position) }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
    }

    private func button(_ action: String, _ position: Int) -> some View {
        let main = position == actions.count - 1
        return Button {
            Haptics.selection()
            if enabled { onPress(action) }
        } label: {
            Text(action)
                .font(colors.font(13.5, .medium))
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .foregroundStyle(main ? colors.fill : colors.ink)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .frame(minHeight: 44)
                .background { if main { Capsule().fill(colors.ink).padding(.vertical, 4) } }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .opacity(enabled ? 1 : 0.35)
        .accessibilityIdentifier("form-action-\(position)")
    }
}
