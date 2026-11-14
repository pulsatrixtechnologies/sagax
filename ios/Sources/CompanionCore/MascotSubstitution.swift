// Where the phone draws a bot's look with less than the desktop does, and
// what it draws instead. A known character is never drawn as another one:
// a shape stays that shape in its colour (and draws its skins in full), Bunbu stays Bunbu, Shiba stays
// Shiba, Frog stays Frog, Trombi stays Trombi, and only a skin's premium layers (textures, particles, the
// repainted wire) give way to the closest finish the phone has. Each
// substitution is logged once (subsystem `ca.pulsatrix.sagax`, category
// `mascot`), so a mismatch someone reports can be told apart from a bug.
import Foundation
import os

public enum MascotSubstitution {
    public struct Entry: Hashable, Sendable {
        /// The character drawn: always the look's own.
        public let character: MascotCharacter
        /// What the desktop draws (`shape skin galaxy`).
        public let wanted: String
        /// What the phone draws instead.
        public let drawn: String
    }

    /// Owl skins the phone draws with their palette, aura and rim only.
    static let owlBaseOnly: Set<MascotSkin> = [.snowy, .barn, .chrome, .holo, .galaxy, .spirit]
    /// Trombi skins the phone tints rather than repaints.
    static let trombiTinted: Set<TrombiSkin> = [.chrome, .glitch, .holo, .molten]
    /// Bunbu skins whose premium layers the phone does not draw.
    static let bunbuBaseOnly: Set<BunbuSkin> = [.velvet, .gold, .neon, .chrome, .crystal, .holo, .galaxy, .molten]
    /// Ogre skins whose premium layers (auras, foils, scan lines, the plates' sweep) the phone does not draw.
    static let ogreBaseOnly: Set<OgreSkin> = [.lava, .armor, .retro98, .gold, .neon, .chrome, .glitch, .holo, .molten]

    /// The substitutions drawing this look on the phone makes (none for most).
    public static func entries(for look: CompleteMascotLook, owlSkin: MascotSkin = .none) -> [Entry] {
        switch look.character {
        case .owl:
            guard owlBaseOnly.contains(owlSkin) else { return [] }
            return [Entry(character: .owl, wanted: "owl skin \(owlSkin.rawValue)", drawn: "its palette, aura and rim, without its effects")]
        case .shape:
            // every shape skin paints its layers on the face (ShapeSkinLayers, #4159)
            return []
        case .trombi:
            guard trombiTinted.contains(look.trombiSkin) else { return [] }
            return [Entry(character: .trombi, wanted: "Trombi skin \(look.trombiSkin.rawValue)", drawn: "the classic drawing tinted toward its colours")]
        case .bunbu:
            guard bunbuBaseOnly.contains(look.bunbuSkin) else { return [] }
            return [Entry(character: .bunbu, wanted: "Bunbu skin \(look.bunbuSkin.rawValue)", drawn: "its base finish")]
        case .shiba:
            guard ShibaArt.baseOnly.contains(look.shibaSkin) else { return [] }
            return [Entry(character: .shiba, wanted: "Shiba skin \(look.shibaSkin.rawValue)", drawn: "its palette and coat gradient, without its effects")]
        case .grump:
            guard grumpFlat.contains(look.grumpSkin) else { return [] }
            return [Entry(character: .grump, wanted: "Grump skin \(look.grumpSkin.rawValue)", drawn: "its palette, flat, without its effects")]
        case .ogre:
            guard ogreBaseOnly.contains(look.ogreSkin) else { return [] }
            return [Entry(character: .ogre, wanted: "Ogre skin \(look.ogreSkin.rawValue)", drawn: "its colours and marks, without its effects")]
        case .frog:
            guard FrogArt.baseOnly.contains(look.frogSkin) else { return [] }
            return [Entry(character: .frog, wanted: "Frog skin \(look.frogSkin.rawValue)", drawn: "its palette and skin gradient, patterns as their base tone, without its effects")]
        case .crab:
            return []
        }
    }

    /// Grump's skins whose gradients, patterns and effects the phone draws as a flat palette.
    static let grumpFlat: Set<GrumpSkin> = [.calico, .tabby, .retro98, .gold, .void, .neon, .chrome, .glitch, .holo, .molten]

    private static let logger = Logger(subsystem: "ca.pulsatrix.sagax", category: "mascot")
    private static let lock = NSLock()
    nonisolated(unsafe) private static var logged = Set<Entry>()

    /// Logs this look's substitutions, each once per launch.
    public static func report(_ look: CompleteMascotLook, owlSkin: MascotSkin = .none) {
        for entry in entries(for: look, owlSkin: owlSkin) {
            lock.lock()
            let first = logged.insert(entry).inserted
            lock.unlock()
            if first {
                logger.notice("mascot look substituted: \(entry.wanted, privacy: .public) drawn as \(entry.drawn, privacy: .public)")
            }
        }
    }
}
