// The reply as it is being typed.
import SwiftUI
import CompanionCore

/// The reply as it is being typed, styled to match the settled reply it is
/// about to become: the same bubble, fill, padding and ink as the bot's
/// settled reply (TextBubble, #4066; it was flat text on the background
/// until the reply landed in its bubble). The handover should be invisible,
/// and any difference in padding reads as the message jumping on arrival.
///
/// A caret rather than a spinner: a spinner says "something is happening
/// somewhere", which the reader already knows. A caret at the end of real
/// text says how far along it is.
///
/// The caret does not blink, deliberately. The obvious way to blink it —
/// `withAnimation(.repeatForever) { flag.toggle() }` in `onAppear` — animates
/// the change once and then sits still, and a caret that blinks twice and
/// stops looks more broken than one that never blinks. A correct version
/// animates opacity on a separate view, which needs a device to get right;
/// static is honest until then.
struct StreamingBubble: View {
    @Environment(\.themePalette) var themePalette
    let text: String?
    let reasoning: String?
    var color: String = "blue"
    /// iPad desktop shell: the desktop's ink.
    @Environment(\.desktopChatText) private var desktop
    /// iPad desktop shell: the settled bubble's width cap.
    @Environment(\.desktopBubbleCap) private var bubbleCap
    /// So the bubble repaints when the person flips the bot-colour switch.
    @ObservedObject private var bubblePrefs = SidebarPrefsModel.shared
    @ObservedObject private var openBot = ThemeStore.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let reasoning, !reasoning.isEmpty, text?.isEmpty != false {
                AgentThoughtChamberView(
                    reasoning: reasoning,
                    botName: "Bot",
                    mascotColor: MausPalette.color(color),
                    isStreaming: true
                )
                .padding(.vertical, 2)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            if let text, !text.isEmpty {
                HStack(alignment: .bottom, spacing: 0) {
                    // Same renderer as the settled bubble, for the same
                    // reason as the padding: a live reply showing `**bold**`
                    // that snaps to bold on arrival is the message jumping,
                    // just in a different dimension. The parser tolerates the
                    // half-finished markdown this is always holding — an
                    // unclosed fence renders as code, an unclosed link as the
                    // characters typed so far.
                    MarkdownText(source: text, caret: true)
                        .foregroundStyle(desktop?.ink ?? BubbleColor.theirsText)
                        .fixedSize(horizontal: false, vertical: true)
                        // a growing answer wraps: on the iPad desktop shell
                        // it takes the bubble's cap, as a settled one that wraps
                        .frame(maxWidth: desktop != nil ? .infinity : nil, alignment: .leading)
                        .padding(.horizontal, desktop != nil ? DesktopChatMetrics.bubblePadding.leading : Theme.Chat.bubblePaddingH)
                        .padding(.vertical, desktop != nil ? DesktopChatMetrics.bubblePadding.top : Theme.Chat.bubblePaddingV)
                        .background(
                            RoundedRectangle(cornerRadius: desktop != nil ? DesktopChatMetrics.bubbleRadius : Theme.Metric.bubbleRadius, style: .continuous)
                                .fill(BubbleColor.theirs(desktop: desktop))
                        )
                        .frame(maxWidth: desktop != nil ? (bubbleCap ?? .infinity) : nil, alignment: .leading)
                    Spacer(minLength: desktop == nil ? Theme.Chat.bubbleTrailingGap : 0)
                }
            }
        }
        // No `.textSelection` on purpose: selecting text that is still growing
        // fights the reader, and the settled bubble a frame later is
        // selectable anyway.
    }
}
