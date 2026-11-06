// personaSharingSummary / chat header audience (#2141): grants, else who may
// see it, else not shared. The chat header shows "Private" when the viewer
// owns an unshared bot.
import Foundation

public enum BotSharingSummary {
    /// Empty-sharing copy (`botSettings.sharing.empty`).
    public static let emptySharing = String(localized: "Not shared with anyone yet.")

    /// Short "Private" for the chat header audience pill (`chat.header.private`).
    public static let headerPrivate = String(localized: "Private")

    /// "Sharing" in the summary: the grants when there are any, else who may
    /// see it, else not shared (`src/lib/bot-sharing.ts`).
    public static func summary(grants: Int, visibility: BotVisibility?) -> String {
        if grants > 0 {
            return String(format: String(localized: "Shared with %@"), String(grants))
        }
        switch visibility {
        case .everyone: return String(localized: "Everyone who can sign in")
        case .admins: return String(localized: "Admins only")
        case .people: return String(localized: "Only these people")
        case nil: return emptySharing
        }
    }

    public static func summary(for bot: Bot) -> String {
        let grants = bot.grants?.count ?? bot.directGrants?.count ?? 0
        return summary(grants: grants, visibility: bot.visibility)
    }

    /// Whether the summary means the bot is shared with someone else.
    public static func isShared(_ summary: String) -> Bool {
        summary != emptySharing
    }

    /// Chat header audience (#2141): "Private" when the viewer owns an
    /// unshared bot, otherwise the sharing summary.
    public static func headerAudience(for bot: Bot, viewerOwns: Bool) -> (label: String, shared: Bool) {
        let sharing = summary(for: bot)
        let shared = isShared(sharing)
        if !shared && viewerOwns {
            return (headerPrivate, false)
        }
        return (sharing, shared)
    }
}
