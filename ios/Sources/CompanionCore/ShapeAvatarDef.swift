// Portable Shape avatar definition (schema v1), shared with
// shared/shape-avatar-def.ts. Geometry only; colour stays on the bot.
// Strict validation refuses scripts, oversized paths and out-of-bounds
// values so a pasted or generated JSON cannot break the drawing.
import Foundation

public enum ShapeAvatarSchema {
    public static let version = 1
    public static let boxMin: Double = 0
    public static let boxMax: Double = 100
    public static let idMax = 48
    public static let nameMax = 80
    public static let pathChars = 4_000
    public static let pathCommands = 128
    public static let partsMax = 12
    public static let accessoriesMax = 8
    public static let radiiCount = 64
    public static let radiusMin: Double = 0.3
    public static let radiusMax: Double = 1.4
    public static let eyeMin: Double = 1
    public static let eyeMax: Double = 18
    public static let gapMin: Double = 2
    public static let gapMax: Double = 40
}

public enum ShapeAvatarEyeShape: String, Codable, Sendable, Hashable {
    case pill, round, arch
}

public enum ShapeAvatarPrimitive: Codable, Hashable, Sendable {
    case ellipse(cx: Double, cy: Double, rx: Double, ry: Double)
    case circle(cx: Double, cy: Double, r: Double)
    case rect(x: Double, y: Double, w: Double, h: Double, rx: Double?, ry: Double?)
    case path(d: String)

    private enum CodingKeys: String, CodingKey {
        case type, cx, cy, rx, ry, r, x, y, w, h, d
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let type = try c.decode(String.self, forKey: .type)
        switch type {
        case "ellipse":
            self = .ellipse(
                cx: try c.decode(Double.self, forKey: .cx),
                cy: try c.decode(Double.self, forKey: .cy),
                rx: try c.decode(Double.self, forKey: .rx),
                ry: try c.decode(Double.self, forKey: .ry)
            )
        case "circle":
            self = .circle(
                cx: try c.decode(Double.self, forKey: .cx),
                cy: try c.decode(Double.self, forKey: .cy),
                r: try c.decode(Double.self, forKey: .r)
            )
        case "rect":
            self = .rect(
                x: try c.decode(Double.self, forKey: .x),
                y: try c.decode(Double.self, forKey: .y),
                w: try c.decode(Double.self, forKey: .w),
                h: try c.decode(Double.self, forKey: .h),
                rx: try c.decodeIfPresent(Double.self, forKey: .rx),
                ry: try c.decodeIfPresent(Double.self, forKey: .ry)
            )
        case "path":
            self = .path(d: try c.decode(String.self, forKey: .d))
        default:
            throw DecodingError.dataCorruptedError(forKey: .type, in: c, debugDescription: "unknown primitive \(type)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .ellipse(cx, cy, rx, ry):
            try c.encode("ellipse", forKey: .type)
            try c.encode(cx, forKey: .cx); try c.encode(cy, forKey: .cy)
            try c.encode(rx, forKey: .rx); try c.encode(ry, forKey: .ry)
        case let .circle(cx, cy, r):
            try c.encode("circle", forKey: .type)
            try c.encode(cx, forKey: .cx); try c.encode(cy, forKey: .cy); try c.encode(r, forKey: .r)
        case let .rect(x, y, w, h, rx, ry):
            try c.encode("rect", forKey: .type)
            try c.encode(x, forKey: .x); try c.encode(y, forKey: .y)
            try c.encode(w, forKey: .w); try c.encode(h, forKey: .h)
            try c.encodeIfPresent(rx, forKey: .rx); try c.encodeIfPresent(ry, forKey: .ry)
        case let .path(d):
            try c.encode("path", forKey: .type)
            try c.encode(d, forKey: .d)
        }
    }
}

public enum ShapeAvatarBody: Codable, Hashable, Sendable {
    case radii([Double])
    case path(String)
    case parts([ShapeAvatarPrimitive])

    private enum CodingKeys: String, CodingKey { case kind, radii, d, parts }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.decode(String.self, forKey: .kind) {
        case "radii": self = .radii(try c.decode([Double].self, forKey: .radii))
        case "path": self = .path(try c.decode(String.self, forKey: .d))
        case "parts": self = .parts(try c.decode([ShapeAvatarPrimitive].self, forKey: .parts))
        default:
            throw DecodingError.dataCorruptedError(forKey: .kind, in: c, debugDescription: "unknown body kind")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .radii(values):
            try c.encode("radii", forKey: .kind)
            try c.encode(values, forKey: .radii)
        case let .path(d):
            try c.encode("path", forKey: .kind)
            try c.encode(d, forKey: .d)
        case let .parts(parts):
            try c.encode("parts", forKey: .kind)
            try c.encode(parts, forKey: .parts)
        }
    }
}

public struct ShapeAvatarEyes: Codable, Hashable, Sendable {
    public var anchor: [Double]
    public var size: Size
    public var shape: ShapeAvatarEyeShape?
    public var gap: Double?

    public struct Size: Codable, Hashable, Sendable {
        public var w: Double
        public var h: Double

        public init(w: Double, h: Double) {
            self.w = w
            self.h = h
        }
    }

    public init(anchor: [Double], size: Size, shape: ShapeAvatarEyeShape? = nil, gap: Double? = nil) {
        self.anchor = anchor
        self.size = size
        self.shape = shape
        self.gap = gap
    }
}

public struct ShapeAvatarAccessory: Codable, Hashable, Sendable {
    public var d: String
    public var role: String?

    public init(d: String, role: String? = nil) {
        self.d = d
        self.role = role
    }
}

/// Geometry-only Shape avatar definition (schema v1).
public struct ShapeAvatarDef: Codable, Hashable, Sendable {
    public var schemaVersion: Int
    public var id: String?
    public var name: String?
    public var body: ShapeAvatarBody
    public var eyes: ShapeAvatarEyes
    public var accessories: [ShapeAvatarAccessory]?

    public init(
        schemaVersion: Int = ShapeAvatarSchema.version,
        id: String? = nil,
        name: String? = nil,
        body: ShapeAvatarBody,
        eyes: ShapeAvatarEyes,
        accessories: [ShapeAvatarAccessory]? = nil
    ) {
        self.schemaVersion = schemaVersion
        self.id = id
        self.name = name
        self.body = body
        self.eyes = eyes
        self.accessories = accessories
    }
}

public enum ShapeAvatarValidation {
    case ok(ShapeAvatarDef)
    case error(String)

    public var def: ShapeAvatarDef? {
        if case let .ok(def) = self { return def }
        return nil
    }
}

public enum ShapeAvatarValidator {
    private static let pathSafe = try! NSRegularExpression(pattern: #"^[MmLlCcQqZz0-9eE.,+\-\s]+$"#)
    private static let slug = try! NSRegularExpression(pattern: #"^[a-z][a-z0-9-]{0,47}$"#)
    private static let roleSafe = try! NSRegularExpression(pattern: #"^[a-z][a-z0-9_-]*$"#)

    public static func validate(_ value: Any) -> ShapeAvatarValidation {
        guard !(value is NSNull) else { return .error("definition is missing") }
        if let text = value as? String {
            guard let data = text.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) else {
                return .error("definition must be valid JSON")
            }
            return validate(json)
        }
        guard let object = value as? [String: Any] else {
            return .error("definition must be a JSON object")
        }
        if object["color"] != nil || object["fill"] != nil || object["palette"] != nil {
            return .error("definition is geometry only; colour is separate")
        }
        if object["script"] != nil || object["onClick"] != nil || object["href"] != nil {
            return .error("definition must not carry scripts or links")
        }
        guard let data = try? JSONSerialization.data(withJSONObject: object),
              let def = try? JSONDecoder().decode(ShapeAvatarDef.self, from: data) else {
            return .error("invalid definition")
        }
        return check(def)
    }

    public static func validateJSON(_ data: Data) -> ShapeAvatarValidation {
        guard let json = try? JSONSerialization.jsonObject(with: data) else {
            return .error("definition must be valid JSON")
        }
        if let wrap = json as? [String: Any] {
            if let nested = wrap["def"] { return validate(nested) }
            if let nested = wrap["avatar"] { return validate(nested) }
        }
        return validate(json)
    }

    public static func check(_ def: ShapeAvatarDef) -> ShapeAvatarValidation {
        guard def.schemaVersion == ShapeAvatarSchema.version else {
            return .error("schemaVersion must be \(ShapeAvatarSchema.version)")
        }
        if let id = def.id {
            guard matches(slug, id), id.count <= ShapeAvatarSchema.idMax else {
                return .error("id must be a lowercase slug (a-z, 0-9, hyphen), not a GUID")
            }
        }
        if let name = def.name {
            let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty, trimmed.count <= ShapeAvatarSchema.nameMax else {
                return .error("name is invalid")
            }
        }
        if let problem = checkBody(def.body) { return .error(problem) }
        if let problem = checkEyes(def.eyes) { return .error(problem) }
        if let accessories = def.accessories {
            guard accessories.count <= ShapeAvatarSchema.accessoriesMax else {
                return .error("too many accessories")
            }
            for accessory in accessories {
                if let problem = assertSafePath(accessory.d, label: "accessory") { return .error(problem) }
                if let role = accessory.role {
                    guard role.count <= 32, matches(roleSafe, role) else {
                        return .error("accessory role is invalid")
                    }
                }
            }
        }
        return .ok(def)
    }

    private static func checkBody(_ body: ShapeAvatarBody) -> String? {
        switch body {
        case let .radii(values):
            guard values.count == ShapeAvatarSchema.radiiCount else {
                return "radii must have \(ShapeAvatarSchema.radiiCount) values"
            }
            for value in values {
                guard value.isFinite,
                      value >= ShapeAvatarSchema.radiusMin,
                      value <= ShapeAvatarSchema.radiusMax else {
                    return "radius out of bounds"
                }
            }
            return nil
        case let .path(d):
            return assertSafePath(d)
        case let .parts(parts):
            guard (1...ShapeAvatarSchema.partsMax).contains(parts.count) else {
                return "parts count out of range"
            }
            for part in parts {
                if let problem = checkPrimitive(part) { return problem }
            }
            return nil
        }
    }

    private static func checkPrimitive(_ part: ShapeAvatarPrimitive) -> String? {
        let box = ShapeAvatarSchema.boxMin...ShapeAvatarSchema.boxMax
        switch part {
        case let .ellipse(cx, cy, rx, ry):
            guard box.contains(cx), box.contains(cy), (0.5...50).contains(rx), (0.5...50).contains(ry) else {
                return "ellipse out of bounds"
            }
        case let .circle(cx, cy, r):
            guard box.contains(cx), box.contains(cy), (0.5...50).contains(r) else {
                return "circle out of bounds"
            }
        case let .rect(x, y, w, h, rx, ry):
            guard box.contains(x), box.contains(y), (1...100).contains(w), (1...100).contains(h) else {
                return "rect out of bounds"
            }
            if let rx, !(0...50).contains(rx) { return "rect rx out of bounds" }
            if let ry, !(0...50).contains(ry) { return "rect ry out of bounds" }
        case let .path(d):
            return assertSafePath(d)
        }
        return nil
    }

    private static func checkEyes(_ eyes: ShapeAvatarEyes) -> String? {
        guard eyes.anchor.count == 2,
              let ax = eyes.anchor.first, let ay = eyes.anchor.last,
              ax.isFinite, ay.isFinite,
              (ShapeAvatarSchema.boxMin...ShapeAvatarSchema.boxMax).contains(ax),
              (ShapeAvatarSchema.boxMin...ShapeAvatarSchema.boxMax).contains(ay) else {
            return "eye anchor out of bounds"
        }
        guard (ShapeAvatarSchema.eyeMin...ShapeAvatarSchema.eyeMax).contains(eyes.size.w),
              (ShapeAvatarSchema.eyeMin...ShapeAvatarSchema.eyeMax).contains(eyes.size.h) else {
            return "eye size out of bounds"
        }
        if let gap = eyes.gap, !(ShapeAvatarSchema.gapMin...ShapeAvatarSchema.gapMax).contains(gap) {
            return "eye gap out of bounds"
        }
        return nil
    }

    public static func assertSafePath(_ d: String, label: String = "path") -> String? {
        let trimmed = d.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "\(label) must be a non-empty SVG path" }
        guard trimmed.count <= ShapeAvatarSchema.pathChars else {
            return "\(label) is too long (max \(ShapeAvatarSchema.pathChars) chars)"
        }
        guard matches(pathSafe, trimmed) else {
            return "\(label) may only use M/L/C/Q/Z commands and numbers"
        }
        let lowered = trimmed.lowercased()
        if lowered.contains("<") || lowered.contains("javascript:") || lowered.contains("url(") {
            return "\(label) contains forbidden content"
        }
        let commands = trimmed.unicodeScalars.filter { "MmLlCcQqZz".unicodeScalars.contains($0) }.count
        guard commands <= ShapeAvatarSchema.pathCommands else {
            return "\(label) has too many commands (max \(ShapeAvatarSchema.pathCommands))"
        }
        guard trimmed.contains(where: { "Mm".contains($0) }),
              trimmed.contains(where: { "Zz".contains($0) }) else {
            return "\(label) must be a closed path (M...Z)"
        }
        return nil
    }

    private static func matches(_ regex: NSRegularExpression, _ text: String) -> Bool {
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        return regex.firstMatch(in: text, options: [], range: range) != nil
    }
}

// MARK: - Compile / primitives / share (shared/shape-avatar-def.ts)

public struct CompiledShapeAvatar: Sendable {
    public var outline: String
    public var extras: [String]
    public var face: (x: Double, y: Double)
    public var eye: (w: Double, h: Double, shape: ShapeAvatarEyeShape, gap: Double)
    public var accessories: [(d: String, role: String?)]
    public var radii: [Double]?
}

public enum ShapeAvatarCompile {
    private static func round2(_ v: Double) -> Double { ShapeMath.round2(v) }

    /// Rounded rect as a closed cubic path in box units.
    public static func roundedRectPath(x: Double, y: Double, w: Double, h: Double, r: Double) -> String {
        let rr = max(0, min(r, w / 2, h / 2))
        let x2 = x + w
        let y2 = y + h
        if rr <= 0 {
            return "M\(round2(x)) \(round2(y))L\(round2(x2)) \(round2(y))L\(round2(x2)) \(round2(y2))L\(round2(x)) \(round2(y2))Z"
        }
        return [
            "M\(round2(x + rr)) \(round2(y))",
            "L\(round2(x2 - rr)) \(round2(y))",
            "Q\(round2(x2)) \(round2(y)) \(round2(x2)) \(round2(y + rr))",
            "L\(round2(x2)) \(round2(y2 - rr))",
            "Q\(round2(x2)) \(round2(y2)) \(round2(x2 - rr)) \(round2(y2))",
            "L\(round2(x + rr)) \(round2(y2))",
            "Q\(round2(x)) \(round2(y2)) \(round2(x)) \(round2(y2 - rr))",
            "L\(round2(x)) \(round2(y + rr))",
            "Q\(round2(x)) \(round2(y)) \(round2(x + rr)) \(round2(y))",
            "Z",
        ].joined()
    }

    /// Ellipse as four cubic Beziers (absolute).
    public static func ellipsePath(cx: Double, cy: Double, rx: Double, ry: Double) -> String {
        let k = 0.5522847498
        let ox = round2(rx * k)
        let oy = round2(ry * k)
        let x0 = round2(cx - rx)
        let x1 = round2(cx + rx)
        let y0 = round2(cy - ry)
        let y1 = round2(cy + ry)
        let c = round2(cx)
        let m = round2(cy)
        return [
            "M\(c) \(y0)",
            "C\(round2(cx + ox)) \(y0) \(x1) \(round2(cy - oy)) \(x1) \(m)",
            "C\(x1) \(round2(cy + oy)) \(round2(cx + ox)) \(y1) \(c) \(y1)",
            "C\(round2(cx - ox)) \(y1) \(x0) \(round2(cy + oy)) \(x0) \(m)",
            "C\(x0) \(round2(cy - oy)) \(round2(cx - ox)) \(y0) \(c) \(y0)",
            "Z",
        ].joined()
    }

    public static func circlePath(cx: Double, cy: Double, r: Double) -> String {
        ellipsePath(cx: cx, cy: cy, rx: r, ry: r)
    }

    public static func primitivePath(_ part: ShapeAvatarPrimitive) -> String {
        switch part {
        case let .ellipse(cx, cy, rx, ry):
            return ellipsePath(cx: cx, cy: cy, rx: rx, ry: ry)
        case let .circle(cx, cy, r):
            return circlePath(cx: cx, cy: cy, r: r)
        case let .rect(x, y, w, h, rx, ry):
            return roundedRectPath(x: x, y: y, w: w, h: h, r: rx ?? ry ?? 0)
        case let .path(d):
            return d
        }
    }

    public static func compile(_ def: ShapeAvatarDef) -> CompiledShapeAvatar {
        let eyeShape = def.eyes.shape ?? .pill
        let gap = def.eyes.gap ?? max(def.eyes.size.w * 1.6, 8)
        let eye = (w: def.eyes.size.w, h: def.eyes.size.h, shape: eyeShape, gap: gap)
        let accessories = (def.accessories ?? []).map { (d: $0.d, role: $0.role) }
        switch def.body {
        case let .radii(values):
            return CompiledShapeAvatar(
                outline: "",
                extras: [],
                face: (def.eyes.anchor[0], def.eyes.anchor[1]),
                eye: eye,
                accessories: accessories,
                radii: values
            )
        case let .path(d):
            return CompiledShapeAvatar(
                outline: d,
                extras: [],
                face: (def.eyes.anchor[0], def.eyes.anchor[1]),
                eye: eye,
                accessories: accessories,
                radii: nil
            )
        case let .parts(parts):
            let paths = parts.map(primitivePath)
            return CompiledShapeAvatar(
                outline: paths.first ?? "",
                extras: Array(paths.dropFirst()),
                face: (def.eyes.anchor[0], def.eyes.anchor[1]),
                eye: eye,
                accessories: accessories,
                radii: nil
            )
        }
    }

    /// Default pill eyes near the upper middle of the 0..100 box.
    public static func defaultPillEyes(
        anchor: [Double] = [54, 42],
        size: ShapeAvatarEyes.Size = .init(w: 7.5, h: 16)
    ) -> ShapeAvatarEyes {
        ShapeAvatarEyes(anchor: anchor, size: size, shape: .pill, gap: 14)
    }
}

public enum ShapeAvatarShareCodec {
    public static func encode(_ def: ShapeAvatarDef, color: String? = nil, mood: String? = nil) throws -> String {
        var payload: [String: Any] = [
            "v": 1,
            "def": try JSONSerialization.jsonObject(with: JSONEncoder().encode(def)),
        ]
        if let color { payload["color"] = color }
        if let mood { payload["mood"] = mood }
        let data = try JSONSerialization.data(withJSONObject: payload)
        return String(data: data, encoding: .utf8) ?? "{}"
    }

    public static func decode(_ raw: String) -> (validation: ShapeAvatarValidation, color: String?, mood: String?) {
        guard let data = raw.trimmingCharacters(in: .whitespacesAndNewlines).data(using: .utf8),
              let value = try? JSONSerialization.jsonObject(with: data) else {
            return (.error("share link must be valid JSON"), nil, nil)
        }
        guard let record = value as? [String: Any] else {
            return (.error("share link must be an object"), nil, nil)
        }
        let nested = record["def"] ?? record["avatar"] ?? value
        let result = ShapeAvatarValidator.validate(nested)
        let color = record["color"] as? String
        let mood = record["mood"] as? String
        return (result, color, mood)
    }

    public static func parsePayload(_ raw: String) -> ShapeAvatarValidation {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return .error("definition is empty") }
        guard let data = text.data(using: .utf8) else { return .error("definition must be valid JSON") }
        return ShapeAvatarValidator.validateJSON(data)
    }
}
