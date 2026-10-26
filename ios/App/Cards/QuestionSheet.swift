import CompanionCore
import SwiftUI

/// The one look of every interactive question (JC 2026-10-20), the
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

    init(desktop: DesktopTheme?) {
        self.desktop = desktop
        fill = desktop?.card ?? BubbleColor.theirs
        ink = desktop?.ink ?? BubbleColor.theirsText
        inkSecondary = desktop?.inkSecondary ?? BubbleColor.theirsText.opacity(0.62)
    }

    func font(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        desktop?.font(size, weight) ?? .system(size: size + 1, weight: weight)
    }
}

/// The card around a question.
struct QuestionSheet<Content: View>: View {
    let colors: QuestionSheetColors
    let title: String
    var meta: String? = nil
    var onDismiss: (() -> Void)? = nil
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 8) {
                Text(title)
                    .font(colors.font(14, .semibold))
                    .foregroundStyle(colors.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                Spacer(minLength: 4)
                if let meta {
                    Text(meta)
                        .font(colors.font(11.5).monospacedDigit())
                        .foregroundStyle(colors.inkSecondary)
                }
                if let onDismiss {
                    Button {
                        Haptics.selection()
                        onDismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(colors.inkSecondary)
                            .frame(width: 28, height: 28)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .padding(.top, -5)
                    .padding(.trailing, -6)
                    .accessibilityLabel(Text("Dismiss"))
                }
            }
            content()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(colors.fill, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .frame(maxWidth: colors.desktop == nil ? .infinity : 560, alignment: .leading)
    }
}

/// One answer: the 22 pt key (or a box), then the label.
struct QuestionSheetRow: View {
    let colors: QuestionSheetColors
    let index: Int
    let label: String
    var detail: String? = nil
    var multi = false
    var on = false
    var settled = false
    var disabled = false
    let action: () -> Void

    static func key(_ index: Int) -> String { String(UnicodeScalar(UInt8(65 + min(index, 25)))) }

    var body: some View {
        Button {
            Haptics.selection()
            action()
        } label: {
            HStack(alignment: .center, spacing: 12) {
                if multi { box } else { keyBadge }
                VStack(alignment: .leading, spacing: 1) {
                    Text(label)
                        .font(colors.font(13.5))
                        .foregroundStyle(colors.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    if let detail, !detail.isEmpty {
                        Text(detail)
                            .font(colors.font(12.5))
                            .foregroundStyle(colors.inkSecondary)
                            .fixedSize(horizontal: false, vertical: true)
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
            .background {
                if on {
                    RoundedRectangle(cornerRadius: 10, style: .continuous).fill(colors.ink.opacity(settled ? 0.06 : 0.07))
                }
            }
            .contentShape(Rectangle())
            .opacity(settled && !on ? 0.45 : 1)
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

/// "Ignore the question". When the card carries `expiresAt`, the label
/// says it closes on its own and shows the time left.
struct QuestionIgnoreControl: View {
    let colors: QuestionSheetColors
    let expiresAt: Double?
    let disabled: Bool
    let action: () -> Void

    var body: some View {
        if expiresAt == nil {
            control(.ignore)
        } else {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                control(QuestionIgnore.face(expiresAt: expiresAt, now: context.date))
            }
        }
    }

    private func control(_ face: QuestionIgnore.Face) -> some View {
        Button(action: action) {
            Text(Self.words(face))
                .font(colors.font(13, .medium))
                .foregroundStyle(colors.inkSecondary)
                .padding(.horizontal, 12)
                .frame(minHeight: 28)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.4 : 1)
        .accessibilityLabel(Text("Ignore without answering"))
    }

    private static func words(_ face: QuestionIgnore.Face) -> String {
        switch face {
        case .ignore:
            String(localized: "Ignore the question")
        case let .closesAutomatically(remaining):
            String(localized: "Ignore, closes automatically") + " · " + QuestionIgnore.clock(remaining)
        }
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
