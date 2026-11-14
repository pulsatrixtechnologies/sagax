// A person's own shape as an open-bot-avatar definition (#4160, #4159; MIT,
// see NOTICE): the engine's JSON (one body path in a 0 0 100 100 box and the
// eyes), pasted on the desktop and stored in mascotLook.avatarDef beside the
// older portable format (ShapeAvatarDef) that field already holds. A port of
// shared/engine-avatar-def.ts: the two formats are told apart by `version`
// (the older one has `schemaVersion`), as `isEngineAvatarDef` does.
import Foundation

/// The engine's `AvatarDefinition` as the desktop stores it (`EngineAvatarDef`).
public struct EngineAvatarDef: Codable, Hashable, Sendable {
    public struct Body: Codable, Hashable, Sendable {
        public var path: String
        public init(path: String) { self.path = path }
    }

    public struct Eyes: Codable, Hashable, Sendable {
        public var x: Double
        public var y: Double
        public var spacing: Double
        public var scale: Double
        public init(x: Double, y: Double, spacing: Double, scale: Double) {
            self.x = x
            self.y = y
            self.spacing = spacing
            self.scale = scale
        }
    }

    public var version: Int
    public var id: String
    public var name: String
    public var body: Body
    public var eyes: Eyes

    public init(id: String, name: String, body: Body, eyes: Eyes) {
        version = 1
        self.id = id
        self.name = name
        self.body = body
        self.eyes = eyes
    }
}

/// What mascotLook.avatarDef holds (`MascotAvatarDef`): a person's own
/// drawing in the older portable format, or a pasted engine definition. The
/// phone keeps either as it came and sends it back unchanged on save.
public enum MascotAvatarDef: Hashable, Sendable, Codable {
    case own(ShapeAvatarDef)
    case engine(EngineAvatarDef)

    /// The older portable format, when that is what the look holds.
    public var own: ShapeAvatarDef? {
        if case let .own(def) = self { return def }
        return nil
    }

    /// The pasted engine definition, when that is what the look holds.
    public var engine: EngineAvatarDef? {
        if case let .engine(def) = self { return def }
        return nil
    }

    /// The definition's id (an object preset's id on a saved copy of it).
    public var id: String? {
        switch self {
        case let .own(def): return def.id
        case let .engine(def): return def.id
        }
    }

    private struct Format: Decodable {
        var schemaVersion: Int?
        var version: Int?
    }

    private struct Invalid: Error {}

    /// Reads either format; one that is neither, or a portable drawing the
    /// validator refuses, throws (the look then loads without it, as the
    /// desktop's `botMascotLook` drops it).
    public init(from decoder: Decoder) throws {
        let format = try Format(from: decoder)
        if format.version != nil, format.schemaVersion == nil {
            let def = try EngineAvatarDef(from: decoder)
            guard def.version == 1 else { throw Invalid() }
            self = .engine(def)
            return
        }
        guard case let .ok(valid) = ShapeAvatarValidator.check(try ShapeAvatarDef(from: decoder)) else { throw Invalid() }
        self = .own(valid)
    }

    public func encode(to encoder: Encoder) throws {
        switch self {
        case let .own(def): try def.encode(to: encoder)
        case let .engine(def): try def.encode(to: encoder)
        }
    }
}
