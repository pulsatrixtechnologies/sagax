import Foundation

/// A home row's name block: the bot's name, then its role on its OWN line
/// below (the owner 2026-11-06: the title always sits under the name, never
/// "Name · Role" on one line).
public enum HomeNameLine {
    /// The name, and the role to show under it: nil when the role is empty
    /// or the name already carries it (a bot named "Osprey Ops" with the
    /// role "Ops").
    public static func lines(name: String, role: String) -> (name: String, role: String?) {
        let trimmedRole = role.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedRole.isEmpty else { return (name, nil) }
        if name.range(of: trimmedRole, options: [.caseInsensitive, .diacriticInsensitive]) != nil { return (name, nil) }
        return (name, trimmedRole)
    }
}
