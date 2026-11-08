import Foundation

/// The one list of technical status rows the chat never draws (the maintainer,
/// 2026-10-26): the chat shows messages, approval cards, real errors the
/// person can act on, and questions. A note about the plumbing (an MCP
/// server skipped, a session rebuilt, Auto's pick, the Workspace line, an
/// automatic recovery, a connector switch, a model fallback) stays in the
/// server log, never inline in the chat.
///
/// Same rules as the desktop's shared/chat-notices.ts: ChatNoticesTests
/// reads Fixtures/chat-notices.json, which shared/chat-notices.test.ts keeps
/// in step with that file.
public enum ChatNotices {
    /// Every activity row whose name starts with one of these is technical.
    public static let hiddenPrefixes = ["notice:", "recovery: Automatic recovery:"]
    /// Except these, which ask something of the person: approve in
    /// 1Password, send the message again, see that a bot now controls the
    /// computer (and can be stopped).
    public static let shown = [
        "notice: Waiting for 1Password: approve the request in 1Password on your computer.",
        "notice: The server environment is starting. This can take a few minutes.",
        "notice: The server environment did not start in time. Send the message again in a few minutes.",
        "notice: The bot is now controlling this computer: its screen, mouse and keyboard. Stop it at any time with Stop.",
    ]

    /// True for an activity row name the chat leaves out.
    public static func isTechnical(_ name: String?) -> Bool {
        guard let name, !name.isEmpty else { return false }
        if shown.contains(name) { return false }
        return hiddenPrefixes.contains { name.hasPrefix($0) }
    }
}
