// Build a Shape avatar definition from a short description. Offline keyword
// match is the fallback used by the phone editor and unit tests (never call
// real providers in tests). Port of shared/shape-avatar-generate.ts.
import Foundation

public enum ShapeAvatarGenerate {
    public static let directionMax = 400

    private struct Hint {
        let id: String
        let words: NSRegularExpression
    }

    private static let hints: [Hint] = [
        Hint(id: "pad", words: try! NSRegularExpression(pattern: #"\b(pad|game\s*pad|controller|gamepad|manette|joy\s*pad)\b"#, options: .caseInsensitive)),
        Hint(id: "cup", words: try! NSRegularExpression(pattern: #"\b(cup|mug|tasse|coffee|tea|boisson)\b"#, options: .caseInsensitive)),
        Hint(id: "bulb", words: try! NSRegularExpression(pattern: #"\b(bulb|light\s*bulb|ampoule|lamp|idea)\b"#, options: .caseInsensitive)),
        Hint(id: "say", words: try! NSRegularExpression(pattern: #"\b(say|speech|bubble|chat|bulle|message|talk)\b"#, options: .caseInsensitive)),
        Hint(id: "sprout", words: try! NSRegularExpression(pattern: #"\b(sprout|plant|leaf|plante|flower|pot|pousse)\b"#, options: .caseInsensitive)),
        Hint(id: "tin", words: try! NSRegularExpression(pattern: #"\b(tin|can|soda|canette|drink)\b"#, options: .caseInsensitive)),
        Hint(id: "tome", words: try! NSRegularExpression(pattern: #"\b(tome|book|livre|manual|novel)\b"#, options: .caseInsensitive)),
        Hint(id: "ship", words: try! NSRegularExpression(pattern: #"\b(ship|rocket|fus[eé]e|space|missile)\b"#, options: .caseInsensitive)),
    ]

    private static func matches(_ regex: NSRegularExpression, _ text: String) -> Bool {
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        return regex.firstMatch(in: text, options: [], range: range) != nil
    }

    public static func matchObjectPreset(direction: String) -> String {
        let text = direction.trimmingCharacters(in: .whitespacesAndNewlines)
        for hint in hints where matches(hint.words, text) {
            return hint.id
        }
        var sum = 0
        for (i, ch) in text.utf16.enumerated() {
            sum = (sum + Int(ch) * (i + 1)) % 997
        }
        let ids = ShapeAvatarPresets.objectIds.map(\.rawValue)
        return ids[sum % ids.count]
    }

    /// Local keyword → preset mapping (unit-test safe; no network).
    public static func generate(direction: String) -> ShapeAvatarDef {
        let bounded = String(direction.trimmingCharacters(in: .whitespacesAndNewlines).prefix(directionMax))
        let id = matchObjectPreset(direction: bounded.isEmpty ? "friendly shape" : bounded)
        guard let preset = ShapeAvatarPresets.byId(id) else {
            return ShapeAvatarPresets.pad
        }
        let name: String
        if bounded.isEmpty {
            name = preset.name ?? id
        } else {
            name = String(bounded.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression).prefix(60))
        }
        let def = ShapeAvatarDef(
            schemaVersion: ShapeAvatarSchema.version,
            id: id,
            name: name,
            body: preset.body,
            eyes: preset.eyes,
            accessories: preset.accessories
        )
        switch ShapeAvatarValidator.check(def) {
        case let .ok(valid):
            return valid
        case .error:
            return preset
        }
    }

    public static func look(with def: ShapeAvatarDef, current: MascotLook) -> MascotLook {
        var next = current.complete
        next.character = .shape
        if let id = def.id, let shape = MascotShape.stored(id), ShapeAvatarPresets.isObjectShape(shape) {
            next.shape = shape
        }
        next.avatarDef = def
        return next.stored
    }

    public static func describe(_ def: ShapeAvatarDef) -> String {
        let compiled = ShapeAvatarCompile.compile(def)
        let body: String
        switch def.body {
        case let .radii(values): body = "radii(\(values.count))"
        case .path: body = "path"
        case let .parts(parts): body = "parts(\(parts.count))"
        }
        return [
            "id=\(def.id ?? "(custom)")",
            "name=\(def.name ?? "")",
            "body=\(body)",
            "eyes=\(compiled.eye.shape.rawValue)@\(compiled.face.x),\(compiled.face.y)",
            "accessories=\(compiled.accessories.count)",
        ].joined(separator: " ")
    }
}
