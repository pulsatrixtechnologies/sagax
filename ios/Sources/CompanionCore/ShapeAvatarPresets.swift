// Our own object-shaped Shape presets (clean room, v2.1): closed path
// silhouettes with concavities and appendages that read at 28..96 px.
// Geometry only; colour is the bot's. Port of shared/shape-avatar-presets.ts.
import Foundation

public enum ShapeAvatarPresets {
    public static let objectIds: [MascotShape] = [.pad, .cup, .bulb, .say, .sprout, .tin, .tome, .ship]

    private static func pathDef(
        id: String,
        name: String,
        d: String,
        eyes: ShapeAvatarEyes,
        accessories: [ShapeAvatarAccessory]? = nil
    ) -> ShapeAvatarDef {
        ShapeAvatarDef(
            schemaVersion: ShapeAvatarSchema.version,
            id: id,
            name: name,
            body: .path(d),
            eyes: eyes,
            accessories: accessories
        )
    }

    /// Pad: wide body with clear side grips that read at 28 px.
    public static let pad = pathDef(
        id: "pad",
        name: "Pad",
        d: [
            "M22 34",
            "C22 24 32 18 44 18",
            "L56 18",
            "C68 18 78 24 78 34",
            "L78 42",
            "L90 46",
            "C96 48 98 54 96 60",
            "C94 68 86 72 78 70",
            "L78 74",
            "C76 84 66 90 50 90",
            "C34 90 24 84 22 74",
            "L22 70",
            "C14 72 6 68 4 60",
            "C2 54 4 48 10 46",
            "L22 42",
            "Z",
        ].joined(),
        eyes: ShapeAvatarCompile.defaultPillEyes(anchor: [50, 46], size: .init(w: 7, h: 13))
    )

    /// Cup: mug body with a C-handle (outer + evenodd cut).
    public static let cup = pathDef(
        id: "cup",
        name: "Cup",
        d: [
            "M26 16",
            "L58 16",
            "L60 30",
            "L72 28",
            "C90 28 98 40 98 52",
            "C98 66 88 78 68 78",
            "L60 76",
            "L62 84",
            "C62 92 54 96 44 96",
            "C34 96 26 92 26 84",
            "Z",
            "M60 38",
            "L68 36",
            "C80 36 86 44 86 52",
            "C86 62 78 70 66 70",
            "L60 68",
            "Z",
        ].joined(),
        eyes: ShapeAvatarCompile.defaultPillEyes(anchor: [42, 48], size: .init(w: 7, h: 14))
    )

    /// Bulb: round glass plus a clear stepped screw base.
    public static let bulb = pathDef(
        id: "bulb",
        name: "Bulb",
        d: [
            "M50 6",
            "C72 6 90 26 90 46",
            "C90 60 80 70 66 76",
            "L60 80",
            "L66 84",
            "L66 88",
            "L60 90",
            "L64 94",
            "L36 94",
            "L40 90",
            "L34 88",
            "L34 84",
            "L40 80",
            "L34 76",
            "C20 70 10 60 10 46",
            "C10 26 28 6 50 6",
            "Z",
        ].joined(),
        eyes: ShapeAvatarCompile.defaultPillEyes(anchor: [50, 36], size: .init(w: 7.5, h: 14))
    )

    /// Say: rounded speech bubble with a large triangular tail.
    public static let say = pathDef(
        id: "say",
        name: "Say",
        d: [
            "M20 14",
            "L72 14",
            "C86 14 94 24 94 36",
            "L94 52",
            "C94 66 84 76 70 76",
            "L44 76",
            "L22 96",
            "L34 76",
            "L28 76",
            "C14 76 6 66 6 52",
            "L6 36",
            "C6 24 10 14 20 14",
            "Z",
        ].joined(),
        eyes: ShapeAvatarCompile.defaultPillEyes(anchor: [50, 40], size: .init(w: 7.5, h: 14))
    )

    /// Sprout: pot with two leaf lobes that stick above the rim.
    public static let sprout = pathDef(
        id: "sprout",
        name: "Sprout",
        d: [
            "M50 52",
            "C40 42 22 34 14 26",
            "C6 18 10 6 24 6",
            "C38 6 46 22 50 36",
            "C54 22 62 6 76 6",
            "C90 6 94 18 86 26",
            "C78 34 60 42 50 52",
            "L68 56",
            "C78 56 84 66 82 76",
            "L78 94",
            "C76 98 62 100 50 100",
            "C38 100 24 98 22 94",
            "L18 76",
            "C16 66 22 56 32 56",
            "Z",
        ].joined(),
        eyes: ShapeAvatarCompile.defaultPillEyes(anchor: [50, 74], size: .init(w: 6.5, h: 12))
    )

    /// Tin: tall can with a clear spout on the top-right.
    public static let tin = pathDef(
        id: "tin",
        name: "Tin",
        d: [
            "M30 22",
            "L58 22",
            "L66 10",
            "L80 10",
            "L80 22",
            "L70 26",
            "L70 88",
            "C70 96 60 100 50 100",
            "C40 100 30 96 30 88",
            "Z",
        ].joined(),
        eyes: ShapeAvatarCompile.defaultPillEyes(anchor: [50, 52], size: .init(w: 7, h: 14))
    )

    /// Tome: closed book with a thick left spine step.
    public static let tome = pathDef(
        id: "tome",
        name: "Tome",
        d: [
            "M12 20",
            "L28 12",
            "L86 12",
            "C94 12 98 18 98 26",
            "L98 82",
            "C98 90 94 96 86 96",
            "L28 96",
            "L12 88",
            "Z",
        ].joined(),
        eyes: ShapeAvatarCompile.defaultPillEyes(anchor: [60, 48], size: .init(w: 7, h: 13))
    )

    /// Ship: rocket with wide side fins and a pointed nose.
    public static let ship = pathDef(
        id: "ship",
        name: "Ship",
        d: [
            "M50 4",
            "C62 4 70 18 70 32",
            "L70 58",
            "L92 86",
            "L70 74",
            "L70 90",
            "C70 98 60 100 50 100",
            "C40 100 30 98 30 90",
            "L30 74",
            "L8 86",
            "L30 58",
            "L30 32",
            "C30 18 38 4 50 4",
            "Z",
        ].joined(),
        eyes: ShapeAvatarCompile.defaultPillEyes(anchor: [50, 38], size: .init(w: 7, h: 13))
    )

    public static let all: [ShapeAvatarDef] = [pad, cup, bulb, say, sprout, tin, tome, ship]

    public static func byId(_ id: String) -> ShapeAvatarDef? {
        all.first { $0.id == id }
    }

    public static func byShape(_ shape: MascotShape) -> ShapeAvatarDef? {
        byId(shape.rawValue)
    }

    public static func isObjectShape(_ shape: MascotShape) -> Bool {
        objectIds.contains(shape)
    }

    public static func isObjectShapeId(_ value: String) -> Bool {
        objectIds.contains { $0.rawValue == value }
    }

    /// Definition for the current shape: custom avatarDef, or the object preset.
    public static func definition(for look: MascotLook) -> ShapeAvatarDef? {
        if let def = look.avatarDef { return def }
        if let shape = look.shape, isObjectShape(shape) { return byShape(shape) }
        return nil
    }

    public static func definition(for look: CompleteMascotLook) -> ShapeAvatarDef? {
        if let def = look.avatarDef { return def }
        if isObjectShape(look.shape) { return byShape(look.shape) }
        return nil
    }

    /// Like desktop avatarDefForShape: custom wins, else object preset for object ids.
    public static func avatarDef(for shape: MascotShape, avatarDef: ShapeAvatarDef?) -> ShapeAvatarDef? {
        if let avatarDef { return avatarDef }
        return byShape(shape)
    }

    /// The two eyes a still of `def` wears, in box units (0...100): the
    /// engine's own upright capsules, the pill eyes the desktop and the
    /// phone draw on every body. The still SVG and the evidence stills use
    /// them, so an export never shows the round dots it once drew (a rect
    /// twice the eye's width, rounded by that width, touching its twin).
    public static func stillEyes(_ def: ShapeAvatarDef) -> [ShapeEyeBox] {
        let shape = def.id.flatMap(MascotShape.init(rawValue:)) ?? .circle
        return ShapeFrames.gaze(shape, .neutral, color: "#000000", nx: 0, ny: 0, avatarDef: def).eyeShapes
    }

    /// Flat still SVG for export (no volume). Eyes as the engine's pills.
    public static func stillSvg(_ def: ShapeAvatarDef, fill: String, size: Int = 96) -> String {
        let live = ShapeAvatarOutline.liveOutline(from: def)
        let path = live.path.isEmpty
            ? (live.points.isEmpty ? "M50 10A40 40 0 1 1 49.9 10Z" : ShapeAvatarOutline.smoothClosedOutline(live.points))
            : live.path
        let r = { (v: Double) in String(format: "%.2f", v) }
        let eyes = stillEyes(def).map { e in
            "<rect x=\"\(r(e.x - e.w / 2))\" y=\"\(r(e.y - e.h / 2))\" width=\"\(r(e.w))\" height=\"\(r(e.h))\" rx=\"\(r(e.w / 2))\" ry=\"\(r(e.w / 2))\""
                + (abs(e.tilt) > 0.01 ? " transform=\"rotate(\(r(e.tilt)) \(r(e.x)) \(r(e.y)))\"" : "")
                + " fill=\"#16181d\"/>"
        }
        let extras = live.extras.map { "<path d=\"\($0)\" fill=\"\(fill)\"/>" }.joined()
        return [
            "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\" width=\"\(size)\" height=\"\(size)\">",
            "<path d=\"\(path)\" fill=\"\(fill)\" fill-rule=\"evenodd\"/>",
            extras,
            eyes.joined(),
            "</svg>\n",
        ].joined()
    }
}
