// The iPad Skills page's compact skill row (#4165), the desktop profile's
// (#4148, src/components/bot-settings/SkillsSection.tsx-parts/plainParts.tsx
// and actions.tsx): glyph, name, one grey line that says "Needs review" or
// "Off" before the description, a shared glyph whose label lists the bots,
// and the more menu. Turn on / Turn off and Review changes are menu items;
// the rest (sharing, where it was learned, every warning, the actions) is
// in the opened skill.
import Foundation

public enum SkillRowRules {
    /// What a person can do with one skill, in the menu's order
    /// (actions.tsx `skillActions`).
    public enum Action: String, Hashable, Sendable {
        case open, review, edit, turnOn, turnOff, share, unshare, remove
    }

    /// The row's state (`data-skill-state`).
    public enum State: String, Hashable, Sendable {
        case needsPerson = "needs-person", off, on
    }

    /// The server's warning for a SKILL.md changed after its review.
    public static func changedAfterReview(_ skill: ManagedSkill) -> Bool {
        skill.warnings.contains { $0.contains("changed after review") }
    }

    /// A skill that waits for the person: any warning to read.
    public static func needsPerson(_ skill: ManagedSkill) -> Bool { !skill.warnings.isEmpty }

    /// Off, for a skill the person can switch (an engine's own is never "off").
    public static func off(_ skill: ManagedSkill, origin: SkillOrigin?) -> Bool {
        !skill.enabled && origin != .native
    }

    public static func state(_ skill: ManagedSkill, origin: SkillOrigin?) -> State {
        needsPerson(skill) ? .needsPerson : off(skill, origin: origin) ? .off : .on
    }

    /// Shared with the person's bots or the library: the shared glyph shows.
    public static func shared(origin: SkillOrigin?, libraryOn: Bool) -> Bool {
        libraryOn && (origin == .me || origin == .library)
    }

    /// The bots a shared skill is shared with, in order; nil for a private one.
    public static func sharedBots(_ info: SkillOriginInfo?, libraryOn: Bool) -> [String]? {
        guard shared(origin: info?.origin, libraryOn: libraryOn) else { return nil }
        return info?.assignedBots.map(\.name) ?? []
    }

    /// The menu: Open always; for a person who may change it, Review changes
    /// (changed after its review), Edit (where the iPad edits it: the bot's
    /// own copy), Turn on or Turn off, Share or Stop sharing, Remove.
    public static func actions(_ skill: ManagedSkill, origin: SkillOrigin?, libraryOn: Bool, canWrite: Bool) -> [Action] {
        var items: [Action] = [.open]
        guard canWrite, origin != .native else { return items }
        if changedAfterReview(skill) { items.append(.review) }
        if origin == nil || origin == .private { items.append(.edit) }
        items.append(skill.enabled ? .turnOff : .turnOn)
        if libraryOn && origin == .private { items.append(.share) }
        if libraryOn && (origin == .me || origin == .library) { items.append(.unshare) }
        items.append(.remove)
        return items
    }

    /// The opened skill's actions: the menu less Open, Edit and Review
    /// changes, which the open view draws itself.
    public static func detailActions(_ skill: ManagedSkill, origin: SkillOrigin?, libraryOn: Bool, canWrite: Bool) -> [Action] {
        actions(skill, origin: origin, libraryOn: libraryOn, canWrite: canWrite).filter { ![.open, .edit, .review].contains($0) }
    }

    /// The warnings the opened skill lists in full (changed after review has
    /// its own line and Review changes there).
    public static func detailWarnings(_ skill: ManagedSkill) -> [String] {
        skill.warnings.filter { !$0.contains("changed after review") }
    }

    /// The server's "changed after review" warning, word for word, or nil:
    /// the opened skill of a shared skill says it above its text, since its
    /// review lives with the editor and not in the details list.
    public static func changedAfterReviewLine(_ skill: ManagedSkill) -> String? {
        skill.warnings.first { $0.contains("changed after review") }
    }

    /// The list in the page's order: the skills that need the person first,
    /// in their own order, then the others in theirs (ShowMoreFold `keep`).
    public static func ordered(_ skills: [ManagedSkill]) -> [ManagedSkill] {
        fold(skills, shown: .max).head
    }

    /// Rows the card shows before "Show N more" (SkillsSection.tsx
    /// `SKILLS_SHOWN`, #4104).
    public static let shown = 4

    /// The card's fold (ShowMoreFold `foldItems` with `skillStaysInView`): a
    /// skill that needs the person or was just added is never hidden; those
    /// come first in their own order and the shown part grows to hold them
    /// all, then the others follow up to `shown`.
    public static func fold(_ skills: [ManagedSkill], shown: Int = shown, added: Set<String> = []) -> (head: [ManagedSkill], rest: [ManagedSkill]) {
        let keep = { (skill: ManagedSkill) in needsPerson(skill) || added.contains(skill.name) }
        let kept = skills.filter(keep)
        let others = skills.filter { !keep($0) }
        let room = max(0, shown - kept.count)
        return (kept + others.prefix(room), Array(others.dropFirst(room)))
    }

    /// The skills added since the last list (SkillsSection.tsx `addedSkills`):
    /// the first list, or the first after an empty one, is the bot's own.
    public static func freshlyAdded(seen: Set<String>?, now names: [String]) -> Set<String> {
        guard let seen, !seen.isEmpty else { return [] }
        return Set(names.filter { !seen.contains($0) })
    }
}
