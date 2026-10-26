// Settings search (matrix ST11), as the desktop's SettingsModal filters its
// sections: the trimmed, lowercased query matches when the translated label
// or any of the page's keywords contains it; an empty query matches all.
// The keywords are the desktop's (English, as there) for the pages both
// apps have, plus the phone's own pages.
import Foundation

/// A page of the phone's Settings a search can open.
public enum SettingsDestination: String, CaseIterable, Hashable, Sendable {
    // The Settings list, in the desktop's order (NavigationMenus.settings),
    // then the pages one level in.
    case general, organization, appearance, notifications, privacy, achievements, experimental, plugins, account, botComputer, pages, usage
    case rules, approvalGrants, timeZone, language, haptics, quickReplies, walkieVoice, about, credentials, securityKeys

    /// The desktop's section keywords for the same page (SettingsModal.tsx
    /// `SECTIONS`), and words for the phone's own pages.
    public var keywords: [String] {
        switch self {
        // The links, feedback and the bot's settings sit on the root now
        // (Grok Bot iOS 1.14); General keeps the chat's settings.
        case .general: return ["general", "chat", "quick replies", "call voice", "walkie"]
        case .experimental: return ["early", "preview", "skill", "authoring", "browser", "templates", "connected apps"]
        // Pair devices: the computers this phone is paired with
        case .account: return ["profile", "name", "email", "account", "sign out", "delete account", "switch account",
                               "companion", "device", "phone", "desktop", "pair", "pairing", "remote", "server", "connect", "computers"]
        case .usage: return ["tokens", "cost", "billing", "usage", "budget", "spent", "history", "csv", "export"]
        case .plugins: return ["plugins", "tools", "skills", "mcp", "install"]
        case .rules: return ["auto-review", "rules", "approvals", "always allow", "commands"]
        case .approvalGrants: return ["approval", "approvals", "custom rules", "rules", "allow", "ask", "refuse", "recipients", "allowed recipients", "destinataires", "règles", "approbation", "always allowed"]
        case .timeZone: return ["time zone", "timezone", "clock"]
        case .botComputer: return ["computer", "local vm", "vm", "virtual", "desktop", "ordinateur", "update", "reset", "recover", "disk", "rename", "other computers"]
        case .pages: return ["pages", "published", "publish", "share", "revoke", "pages publiées"]
        case .appearance: return ["skin", "theme", "appearance", "font", "threads", "show threads", "hide threads", "sidebar", "hidden", "hide", "show", "dark", "light", "app icon", "icon",
                                     "activity", "tools", "tool calls", "run", "density", "compact", "comfortable", "list", "logo", "search", "recherche", "plus", "top", "haut"]
        case .language: return ["language", "langue", "français", "english", "português"]
        case .haptics: return ["haptics", "vibration", "notifications", "sound", "sounds", "mute", "silent", "chime"]
        case .quickReplies: return ["quick replies", "replies", "shortcuts"]
        case .walkieVoice: return ["walkie", "voice", "speech"]
        case .achievements: return ["achievements", "trophies", "trophy", "points", "gamerscore", "level", "unlock", "succès", "trophées"]
        case .organization: return ["company", "organization", "organisation", "perspicax", "sharing", "full access", "approvals", "routines in my name", "delegation"]
        case .about: return ["about", "version", "build", "license", "à propos"]
        case .credentials: return ["vault", "credentials", "coffre", "card", "carte", "password", "mot de passe", "address", "adresse"]
        case .securityKeys: return ["security", "sécurité", "passkey", "face id", "security key", "clé"]
        case .notifications: return ["notifications", "notification", "sound", "sounds", "mute", "silent", "chime", "alert", "banner", "badge", "unread", "nudge", "wizz", "buzz", "persistent"]
        case .privacy: return ["privacy", "presence", "online", "away", "offline", "last seen", "status", "en ligne", "confidentialité"]
        }
    }

    /// Whether this page matches `query` given its translated `label`.
    public func matches(_ query: String, label: String) -> Bool {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return true }
        if label.lowercased().contains(q) { return true }
        return keywords.contains { $0.lowercased().contains(q) }
    }
}

public enum SettingsSearch {
    /// The pages, among `available`, that match `query`, in their order.
    public static func results(_ query: String, available: [SettingsDestination], label: (SettingsDestination) -> String) -> [SettingsDestination] {
        available.filter { $0.matches(query, label: label($0)) }
    }
}
