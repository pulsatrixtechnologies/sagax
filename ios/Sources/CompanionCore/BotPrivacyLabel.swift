// The profile page's privacy line under the bot's name ("Private to you"),
// from visibility and sharing (reference app parity, #2127).
import Foundation

public enum BotPrivacyLabel {
    /// Whether this bot is private to the viewer alone.
    public static func isPrivateToViewer(
        visibility: BotVisibility?,
        sharedWithOthers: Bool,
        organization: Bool
    ) -> Bool {
        if sharedWithOthers { return false }
        switch visibility ?? .everyone {
        case .everyone:
            // On a solo computer everyone means the one person. On an
            // organization workspace it is shared with the org.
            return !organization
        case .admins, .people:
            return true
        }
    }

    /// The short line under "Name · Title".
    public static func text(
        visibility: BotVisibility?,
        sharedWithOthers: Bool,
        organization: Bool
    ) -> String {
        if isPrivateToViewer(visibility: visibility, sharedWithOthers: sharedWithOthers, organization: organization) {
            return String(localized: "Private to you")
        }
        if sharedWithOthers {
            return String(localized: "Shared")
        }
        switch visibility ?? .everyone {
        case .everyone:
            return String(localized: "Visible to everyone")
        case .admins:
            return String(localized: "Admins only")
        case .people:
            return String(localized: "Only some people")
        }
    }
}
