// Settings > Appearance > Conversation > "Accent on bot bubbles"
// (`sagax.botBubble.v1`, the key the desktop writes too). Off by default:
// the bot's reply bubble stays the skin's grey. On, ONLY a bot's own reply
// bubble (1:1 chat and room, settled or being written) takes a soft tint of the
// skin's accent over that grey, the page's own ink on it, exactly the
// desktop's `.bot-reply-accent` (src/styles.css: 14 % of the accent mixed
// into the bubble grey). The person's bubbles, another person's message and
// the cards stay as they are.
import Foundation

public enum BotBubble {
    /// Synced with the person (`USER_PREFERENCE_KEYS`). "1" is on.
    public static let key = "sagax.botBubble.v1"

    /// The share of the accent mixed into the grey (desktop: 14%).
    public static let tint = 0.14

    public struct Paint: Equatable, Sendable {
        public var fill: SkinColor
        public var ink: SkinColor
    }

    /// Nil keeps the skin. `base` is the skin's bot bubble grey, `ink` the
    /// page's text on it (kept as is: the tint is too light to change its contrast).
    public static func paint(enabled: Bool, accent: SkinColor, base: SkinColor, ink: SkinColor) -> Paint? {
        guard enabled else { return nil }
        return Paint(fill: SkinColor(accent.hex, alpha: tint).over(base), ink: ink)
    }
}
