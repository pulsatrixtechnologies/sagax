// Our own object-shaped Shape presets (clean room, v2.1): closed path
// silhouettes with concavities and appendages that read at 28..96 px.
// Geometry only; colour is the bot's. Port of shared/shape-avatar-presets.ts;
// the bodies themselves come from shared/mascot-geometry.json (generated).
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

    /// One object shape as the app draws it: its path body and pill eyes from
    /// ShapeGeometryData.objectBodies (generated from shared/mascot-geometry.json,
    /// the one source the desktop reads too).
    private static func objectDef(_ shape: MascotShape, name: String) -> ShapeAvatarDef {
        guard let body = ShapeGeometryData.objectBodies[shape] else {
            preconditionFailure("no object body for \(shape.rawValue) in mascot-geometry.json")
        }
        return pathDef(
            id: shape.rawValue,
            name: name,
            d: body.path,
            eyes: ShapeAvatarCompile.defaultPillEyes(anchor: [body.anchor.x, body.anchor.y], size: .init(w: body.w, h: body.h))
        )
    }

    public static let pad = objectDef(.pad, name: "Pad")
    public static let cup = objectDef(.cup, name: "Cup")
    public static let bulb = objectDef(.bulb, name: "Bulb")
    public static let say = objectDef(.say, name: "Say")
    public static let sprout = objectDef(.sprout, name: "Sprout")
    public static let tin = objectDef(.tin, name: "Tin")
    public static let tome = objectDef(.tome, name: "Tome")
    public static let ship = objectDef(.ship, name: "Ship")

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

    /// A saved def that carries an object preset's id is a stale copy of that
    /// preset: the current preset wins (desktop avatarDefForShape, 2026-11-09).
    public static func current(_ def: ShapeAvatarDef) -> ShapeAvatarDef {
        if let id = def.id, let shape = objectIds.first(where: { $0.rawValue == id }), let preset = byShape(shape) { return preset }
        return def
    }

    /// Definition for the current shape: custom avatarDef, or the object preset.
    public static func definition(for look: MascotLook) -> ShapeAvatarDef? {
        if let def = look.avatarDef { return current(def) }
        if let shape = look.shape, isObjectShape(shape) { return byShape(shape) }
        return nil
    }

    public static func definition(for look: CompleteMascotLook) -> ShapeAvatarDef? {
        if let def = look.avatarDef { return current(def) }
        if isObjectShape(look.shape) { return byShape(look.shape) }
        return nil
    }

    /// Like desktop avatarDefForShape: custom wins, else object preset for object ids.
    public static func avatarDef(for shape: MascotShape, avatarDef: ShapeAvatarDef?) -> ShapeAvatarDef? {
        if let avatarDef { return current(avatarDef) }
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
