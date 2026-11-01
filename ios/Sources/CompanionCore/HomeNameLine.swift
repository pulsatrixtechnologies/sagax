import Foundation

/// A home row's first line in the Grok Bot look (2026-11-01): the bot's
/// name and its role on one line, "Name · Role", in place of the role chip.
public enum HomeNameLine {
    public static let separator = " · "

    /// The name alone when the role is empty or the name already carries
    /// it (a bot named "Katarina · Ops" with the role "Ops").
    public static func text(name: String, role: String) -> String {
        let trimmedRole = role.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedRole.isEmpty else { return name }
        if name.range(of: trimmedRole, options: [.caseInsensitive, .diacriticInsensitive]) != nil { return name }
        return name + separator + trimmedRole
    }
}
