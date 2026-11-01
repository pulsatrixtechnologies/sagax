// The bot's character and look on the wire, mirroring the desktop's tests:
// `shared/mascot-skins.test.ts`, `floating-bots/mascots.test.ts` (look) and
// `server/bot-avatar.test.ts` (framing). Everything here is cosmetic, so the
// rule under test is mostly "never fail a bot over it".
import CoreGraphics
import XCTest
@testable import CompanionCore

final class MascotLookTests: XCTestCase {
    private func look(_ json: String) -> MascotLook {
        let wrapped = "{\"look\":\(json)}"
        struct Box: Decodable { var look: MascotLook? }
        return (try! JSONDecoder().decode(Box.self, from: Data(wrapped.utf8))).look ?? .owl
    }

    private func bot(_ extra: String) throws -> Bot {
        let json = """
        {"id":"b1","threadId":"t1","name":"Ada","title":"","description":"","notifications":true,
         "color":"purple","unread":false,"modelSelection":{"instanceId":"e","model":"m"},"createdAt":1\(extra)}
        """
        return try JSONDecoder().decode(Bot.self, from: Data(json.utf8))
    }

    // MARK: look

    func testAbsentOrMalformedLookIsTheOwl() {
        XCTAssertEqual(look("null"), .owl)
        XCTAssertEqual(look("{\"character\":\"shape\",\"shape\":\"zigzag\"}"), .owl)
        XCTAssertEqual(look("{\"character\":\"robot\"}"), .owl)
        XCTAssertEqual(look("\"shape\""), .owl)
        XCTAssertEqual(look("42"), .owl)
        XCTAssertEqual(look("{}"), .owl)
        // strict, like zod: an unknown key or an explicit null throws it all away
        XCTAssertEqual(look("{\"character\":\"shape\",\"extra\":1}"), .owl)
        XCTAssertEqual(look("{\"character\":\"shape\",\"shape\":null}"), .owl)
    }

    /// The bug the owner saw (2026-10-09): the desktop's editor saves all three
    /// skins (`completeMascotLook`), so every look edited there carries
    /// `skins.bunbu`; the phone refused that key and drew the owl. A skin
    /// never costs the character (`botMascotLook` drops it and keeps the rest).
    func testASkinOfAnotherCharacterNeverTurnsTheLookIntoTheOwl() {
        XCTAssertEqual(
            look("{\"character\":\"trombi\",\"skins\":{\"trombi\":\"gold\",\"owl\":\"x\"}}"),
            MascotLook(character: .trombi, skins: .init(trombi: .gold))
        )
        let edited = look(#"{"character":"shape","style":"2d","shape":"cloud","skins":{"shape":"plain","trombi":"classic","bunbu":"plain"}}"#)
        XCTAssertEqual(edited.character, .shape)
        XCTAssertEqual(edited.shape, .cloud)
        XCTAssertEqual(edited.skins?.bunbu, .plain)
        XCTAssertEqual(look(#"{"character":"bunbu","skins":null}"#), MascotLook(character: .bunbu))
        XCTAssertEqual(look(#"{"character":"bunbu","skins":{"bunbu":"fur"}}"#).skins?.bunbu, .plush, "a legacy id")
    }

    func testKeepsAValidLookAsItIs() {
        XCTAssertEqual(
            look("{\"character\":\"trombi\",\"skins\":{\"trombi\":\"gold\"}}"),
            MascotLook(character: .trombi, skins: .init(trombi: .gold))
        )
        let shape = look("{\"character\":\"shape\",\"style\":\"3d\",\"shape\":\"cloud\",\"skins\":{\"shape\":\"neon\"}}")
        XCTAssertEqual(shape.character, .shape)
        XCTAssertEqual(shape.style, .threeD)
        XCTAssertEqual(shape.shape, .cloud)
        XCTAssertEqual(shape.skins?.shape, .neon)
    }

    func testCompleteFillsEveryChoice() {
        XCTAssertEqual(
            MascotLook(character: .shape).complete,
            CompleteMascotLook(character: .shape, style: .flat, shape: .circle, shapeSkin: .plain, trombiSkin: .classic, bunbuSkin: .plain)
        )
    }

    func testEachCharacterKeepsItsOwnSkinWhenSwitchingAndBack() {
        var full = MascotLook(character: .shape, skins: .init(shape: .neon, trombi: .retro98)).complete
        full.character = .trombi
        full.character = .shape
        XCTAssertEqual(full.shapeSkin, .neon)
        XCTAssertEqual(full.trombiSkin, .retro98)
    }

    func testEncodesOnlyWhatIsSet() throws {
        let data = try JSONEncoder().encode(MascotLook(character: .trombi, skins: .init(trombi: .gold)))
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        XCTAssertEqual(object?["character"] as? String, "trombi")
        XCTAssertNil(object?["style"])
        XCTAssertEqual((object?["skins"] as? [String: Any])?["trombi"] as? String, "gold")
        XCTAssertNil((object?["skins"] as? [String: Any])?["shape"])
        // round trip
        XCTAssertEqual(try JSONDecoder().decode(MascotLook.self, from: data), MascotLook(character: .trombi, skins: .init(trombi: .gold)))
    }

    func testThePickerOrdersMatchTheDesktop() {
        XCTAssertEqual(MascotCharacter.allCases.map(\.rawValue), ["owl", "crab", "shape", "trombi", "bunbu", "shiba", "grump", "ogre", "frog"])
        // the desktop's stored ids (MASCOT_SHAPES, 2026-10-28): the first eight keep their ids
        XCTAssertEqual(MascotShape.allCases.map(\.rawValue), [
            "circle", "bean", "squircle", "pill", "pick", "hexagon", "cloud", "drop", "pumpkin", "egg", "gem", "wedge", "diamond", "star", "clover", "flower",
            "blossom", "cat", "ghost", "jellyfish", "axolotl", "puff", "pin", "marker", "sprite", "flask", "tube", "potion", "chomp", "nibble", "shield", "bubble",
            // object silhouettes (shape-engine v2, 2026-11-01)
            "pad", "cup", "bulb", "say", "sprout", "tin", "tome", "ship",
        ])
        // the rest of the lists are checked against the desktop's own in MascotLookFixtureTests
        XCTAssertEqual(ShapeSkin.allCases.first, .plain)
        XCTAssertEqual(TrombiSkin.allCases.first, .classic)
        XCTAssertEqual(BunbuSkin.allCases.first, .plain)
        XCTAssertEqual(ShibaSkin.allCases.first, .plain)
    }

    /// A look made on the desktop never falls back to the owl on the phone:
    /// its shape ids, the legacy ones, and the premium skins.
    func testDesktopShapeIdsLegacyIdsAndUnknownSkinsKeepTheLook() throws {
        func look(_ json: String) throws -> MascotLook { try JSONDecoder().decode(MascotLook.self, from: Data(json.utf8)) }
        XCTAssertEqual(try look(#"{"character":"shape","shape":"bean"}"#).shape, .blob)
        XCTAssertEqual(try look(#"{"character":"shape","shape":"pick"}"#).shape, .triangle)
        XCTAssertEqual(try look(#"{"character":"shape","shape":"blob"}"#).shape, .blob, "the phone's old id")
        XCTAssertEqual(try look(#"{"character":"shape","shape":"star"}"#).shape, .star, "a shape of its own again")
        XCTAssertEqual(try look(#"{"character":"shape","shape":"house"}"#).shape, .hexagon, "a retired shape")
        XCTAssertEqual(try look(#"{"character":"shape","shape":"pumpkin"}"#).shape, .pumpkin)
        let gold = try look(#"{"character":"shape","shape":"cloud","skins":{"shape":"gold"}}"#)
        XCTAssertEqual(gold.character, .shape)
        XCTAssertEqual(gold.shape, .cloud)
        XCTAssertEqual(gold.skins?.shape, .gold)
        XCTAssertNil(try look(#"{"character":"shape","shape":"cloud","skins":{"shape":"plasma"}}"#).skins?.shape, "a newer build's skin")
        let data = try JSONEncoder().encode(MascotLook(character: .shape, shape: .triangle))
        XCTAssertTrue(String(decoding: data, as: UTF8.self).contains(#""pick""#))
    }

    // MARK: skin

    func testSkinsStartWithNoneAndKeepKnownValues() {
        XCTAssertEqual(MascotSkin.allCases.first, MascotSkin.none)
        for skin in MascotSkin.allCases { XCTAssertEqual(MascotSkin.resolve(skin.rawValue), skin) }
    }

    func testMissingLegacyAndJunkSkinsReadAsNone() throws {
        for raw in ["null", "\"\"", "\"plasma\"", "42", "{\"skin\":\"gold\"}", "\"GOLD\""] {
            XCTAssertEqual(try bot(",\"mascotSkin\":\(raw)").resolvedMascotSkin, MascotSkin.none, raw)
        }
        XCTAssertEqual(try bot("").resolvedMascotSkin, MascotSkin.none)
        XCTAssertEqual(MascotSkin.resolve(nil), MascotSkin.none)
    }

    // MARK: bot

    func testABotWithoutAnyOfTheFieldsStillDecodesAsTheOwl() throws {
        let decoded = try bot("")
        XCTAssertNil(decoded.mascotLook)
        XCTAssertEqual(decoded.resolvedMascotLook.character, .owl)
        XCTAssertEqual(decoded.framing.zoom, 1)
        XCTAssertEqual(decoded.framing.focusX, 0.5)
    }

    func testABotWithAMalformedLookStillDecodes() throws {
        let decoded = try bot(",\"mascotLook\":{\"character\":\"dragon\"},\"mascotSkin\":7")
        XCTAssertEqual(decoded.resolvedMascotLook.character, .owl)
        XCTAssertEqual(decoded.resolvedMascotSkin, MascotSkin.none)
    }

    func testABotCarriesItsWholeLook() throws {
        let decoded = try bot("""
        ,"mascotLook":{"character":"shape","shape":"hexagon","skins":{"shape":"glossy"}},"mascotSkin":"frost",
        "avatarUrl":"/api/attachments/a.png","avatarCrop":"rounded","avatarZoom":2.226,"avatarFocusX":1.4,"avatarFocusY":-0.2
        """)
        XCTAssertEqual(decoded.resolvedMascotLook, CompleteMascotLook(character: .shape, shape: .hexagon, shapeSkin: .glossy))
        XCTAssertEqual(decoded.resolvedMascotSkin, .frost)
        XCTAssertEqual(decoded.framing.zoom, 2.23)
        XCTAssertEqual(decoded.framing.focusX, 1)
        XCTAssertEqual(decoded.framing.focusY, 0)
        // and it survives a round trip (the widget snapshot re-encodes bots)
        let again = try JSONDecoder().decode(Bot.self, from: JSONEncoder().encode(decoded))
        XCTAssertEqual(again, decoded)
    }

    // MARK: patch

    func testThePatchSendsOnlyTheLookFieldsThatAreSet() throws {
        let empty = try JSONSerialization.jsonObject(with: JSONEncoder().encode(BotProfilePatch())) as? [String: Any]
        XCTAssertEqual(empty?.isEmpty, true)

        let patch = BotProfilePatch(
            color: "teal", mascotSkin: .gold,
            mascotLook: MascotLook(character: .shape, shape: .drop, skins: .init(shape: .pastel)),
            mascotExpression: "happy", avatarZoom: 1.5, avatarFocusX: 0.25, avatarFocusY: 0.75
        )
        let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(patch)) as? [String: Any]
        XCTAssertEqual(object?["color"] as? String, "teal")
        XCTAssertEqual(object?["mascotSkin"] as? String, "gold")
        XCTAssertEqual(object?["mascotExpression"] as? String, "happy")
        XCTAssertEqual(object?["avatarZoom"] as? Double, 1.5)
        XCTAssertEqual(object?["avatarFocusX"] as? Double, 0.25)
        XCTAssertEqual(object?["avatarFocusY"] as? Double, 0.75)
        let look = object?["mascotLook"] as? [String: Any]
        XCTAssertEqual(look?["character"] as? String, "shape")
        XCTAssertEqual(look?["shape"] as? String, "drop")
        XCTAssertNil(object?["name"])
        XCTAssertNil(object?["avatarUrl"])
    }

    // MARK: colours

    func testTheTwelveColoursAreTheDesktopsExactly() {
        XCTAssertEqual(MausColors.names, ["green", "blue", "red", "orange", "purple", "cyan", "pink", "yellow", "teal", "coral", "white", "black"])
        let expected = [
            "green": "#009957", "blue": "#377FE6", "red": "#D94B52", "orange": "#E78531",
            "purple": "#8057C8", "cyan": "#0EA5C6", "pink": "#D84F8B", "yellow": "#D8A729",
            "teal": "#01A492", "coral": "#E5634E", "white": "#F4F4F4", "black": "#1D1E22",
        ]
        for (name, hex) in expected { XCTAssertEqual(MausColors.hex[name], hex, name) }
        // Every colour of the palettes in shared/mascot-colors.ts decodes too,
        // the Clay palette included (MascotLookFixtureTests checks each value).
        XCTAssertEqual(MausColors.hex.count, 63)
        XCTAssertEqual(MausColors.hex["navy"], "#1E3A70")
        XCTAssertEqual(MausColors.hex["mint"], "#98DDB9")
        XCTAssertEqual(MausColors.ink["black"], "#8B93A3")
        XCTAssertEqual(MausColors.ink["blue"], "#377FE6")
        XCTAssertEqual(MausColors.hex(for: "#abcdef"), "#ABCDEF")
        XCTAssertNil(MausColors.hex(for: "mauve"))
        XCTAssertEqual(ShapeArt.hex("mauve"), "#009957")
    }

    // MARK: framing

    func testClampsLikeTheServer() {
        XCTAssertEqual(AvatarFraming.clampZoom(2.226), 2.23)
        XCTAssertEqual(AvatarFraming.clampZoom(8), 3)
        XCTAssertEqual(AvatarFraming.clampZoom(nil), 1)
        XCTAssertEqual(AvatarFraming.clampZoom(.nan), 1)
        XCTAssertEqual(AvatarFraming.clampFocus(-0.2), 0)
        XCTAssertEqual(AvatarFraming.clampFocus(1.4), 1)
        XCTAssertEqual(AvatarFraming.clampFocus(nil), 0.5)
        XCTAssertEqual(AvatarFraming.clampFocus(0.12345), 0.123)
    }

    func testFramesAPictureLikeObjectFitCoverThenScale() {
        // a 200x100 landscape in a 50 box: cover makes it 100x50
        let centred = AvatarFraming.imageRect(imageSize: CGSize(width: 200, height: 100), box: 50, zoom: nil, focusX: nil, focusY: nil)
        XCTAssertEqual(centred, CGRect(x: -25, y: 0, width: 100, height: 50))
        // focus on the left edge keeps the left edge in the box
        let left = AvatarFraming.imageRect(imageSize: CGSize(width: 200, height: 100), box: 50, zoom: 1, focusX: 0, focusY: 0.5)
        XCTAssertEqual(left.minX, 0)
        // zoom 2 about the centre doubles it around the box centre
        let zoomed = AvatarFraming.imageRect(imageSize: CGSize(width: 100, height: 100), box: 50, zoom: 2, focusX: 0.5, focusY: 0.5)
        XCTAssertEqual(zoomed, CGRect(x: -25, y: -25, width: 100, height: 100))
        // zoom about a corner keeps that corner fixed
        let corner = AvatarFraming.imageRect(imageSize: CGSize(width: 100, height: 100), box: 50, zoom: 3, focusX: 1, focusY: 1)
        XCTAssertEqual(corner.maxX, 50, accuracy: 0.0001)
        XCTAssertEqual(corner.maxY, 50, accuracy: 0.0001)
    }

    func testCropCorners() {
        XCTAssertEqual(AvatarFraming.cornerRadius(.circle, box: 40), 20)
        XCTAssertEqual(AvatarFraming.cornerRadius(.rounded, box: 50), 11)
        XCTAssertEqual(AvatarFraming.cornerRadius(.square, box: 50), 0)
    }

    // MARK: states

    func testShapeMoodsAndTrombiPosesMirrorTheDesktop() {
        XCTAssertEqual(ShapeMood.forState(nil), .idle)
        XCTAssertEqual(ShapeMood.forState("searching"), .thinking)
        XCTAssertEqual(ShapeMood.forState("radar"), .working)
        XCTAssertEqual(ShapeMood.forState("playful"), .happy)
        XCTAssertEqual(ShapeMood.forState("powering-down"), .sleeping)
        XCTAssertEqual(ShapeMood.forState("alerting"), .blocked)
        XCTAssertEqual(ShapeMood.forState("writing"), .streaming)
        XCTAssertEqual(ShapeMood.forState("alerting").folded, .idle)
        XCTAssertEqual(TrombiPose.forState("writing"), .think)
        XCTAssertEqual(TrombiPose.forState("working"), .think)
        XCTAssertEqual(TrombiPose.forState("celebrate"), .celebrate)
        XCTAssertEqual(TrombiPose.forState("drowsy"), .sleep)
        XCTAssertEqual(TrombiPose.forState("notifying"), .speak)
        XCTAssertEqual(TrombiPose.forState("listening"), .speak)
        XCTAssertEqual(TrombiPose.forState("idle"), .idle)
    }

    // MARK: shapes

    func testEveryShapeHasArtThatParses() {
        // every shape's outline comes from the geometry file's radii (ShapeGeometryData), the engine's resting body
        for shape in MascotShape.allCases {
            let art = ShapeArt.art[shape]
            XCTAssertNotNil(art, shape.rawValue)
            XCTAssertTrue(art?.d.hasPrefix("M") == true)
            let bounds = SVGPath.parse(art!.d).boundingBoxOfPath
            XCTAssertGreaterThan(bounds.width, 30, shape.rawValue)
            XCTAssertLessThanOrEqual(bounds.maxX, 100, shape.rawValue)
            XCTAssertGreaterThanOrEqual(bounds.minX, 0, shape.rawValue)
            XCTAssertEqual(art!.d, ShapeStillArt.body[shape], shape.rawValue)
        }
        // the circle is 64 radii of 1 R: 10...90 on both axes, its face at the anchor
        let circle = SVGPath.parse(ShapeArt.art[.circle]!.d).boundingBoxOfPath
        XCTAssertEqual(circle.minX, 10, accuracy: 0.01)
        XCTAssertEqual(circle.maxY, 90, accuracy: 0.01)
        XCTAssertEqual(ShapeArt.art[.circle]!.eyes, CGPoint(x: 54, y: 58))
    }

    func testShapeSkinPaintMatchesTheDesktop() {
        // shapeSkinPaint("neon", "#377FE6") on the desktop (shapeSkinBase, #187)
        let neon = ShapeArt.paint(.neon, hex: "#377FE6")
        XCTAssertEqual(neon.fill, "#0D0F15")
        XCTAssertEqual(neon.stroke, "#5F99EB")
        XCTAssertEqual(neon.eyes, "#91B9F1")
        XCTAssertEqual(neon.glow, "#4B8CE9")
        XCTAssertEqual(neon.strokeWidth, 3.6)
        XCTAssertEqual(ShapeArt.paint(.glossy, hex: "#377FE6").shine, true)
        XCTAssertEqual(ShapeArt.paint(.outline, hex: "#377FE6").strokeWidth, 4.4)
        XCTAssertEqual(ShapeArt.paint(.night, hex: "#377FE6").eyes, "#F6F1E8")
    }

    // MARK: Trombi

    func testTrombiHasEveryPoseAndAnAvatarBox() {
        for pose in TrombiPose.allCases { XCTAssertNotNil(TrombiArt.poses[pose], pose.rawValue) }
        XCTAssertEqual(TrombiArt.avatarWidth(42), 33)
        XCTAssertEqual(TrombiArt.avatarHeight(42), 40)
        // the wire is three arcs: bottom at 266 + 46
        let wire = SVGPath.parse(TrombiArt.wire).boundingBoxOfPath
        XCTAssertEqual(wire.maxY, 312, accuracy: 0.01)
        XCTAssertEqual(wire.minY, 56, accuracy: 0.01)
    }

    func testTrombiSkinsTintColoursLikeTheCSSFilters() {
        XCTAssertEqual(CSSColorFilter.apply(TrombiArt.filter(.classic), hex: "#AAB4BF"), "#AAB4BF")
        // grayscale(1) of pure red is its luminance
        XCTAssertEqual(CSSColorFilter.apply([.grayscale(1)], hex: "#FF0000"), "#363636")
        // contrast pushes away from mid grey; black stays black under sepia
        XCTAssertEqual(CSSColorFilter.apply([.contrast(2)], hex: "#C0C0C0"), "#FFFFFF")
        XCTAssertEqual(CSSColorFilter.apply([.sepia(1)], hex: "#000000"), "#000000")
        // white under the gold skin is a warm cream, never blue
        let gold = RGB(hex: CSSColorFilter.apply(TrombiArt.filter(.gold), hex: "#FFFFFF"))
        XCTAssertGreaterThan(gold.r, gold.b)
    }

    // MARK: keyframes

    func testKeyframesInterpolateLikeABrowser() {
        let blink = CSSKeyframes([(0, [1]), (0.92, [1]), (0.95, [0.1]), (1, [1])])
        XCTAssertEqual(blink.value(at: 0, duration: 4, timing: .linear)?[0], 1)
        XCTAssertEqual(blink.value(at: 4 * 0.95, duration: 4, timing: .linear)![0], 0.1, accuracy: 0.0001)
        XCTAssertEqual(blink.value(at: 4 * 0.935, duration: 4, timing: .linear)![0], 0.55, accuracy: 0.001)
        // looping
        XCTAssertEqual(blink.value(at: 8 + 4 * 0.95, duration: 4, timing: .linear)![0], 0.1, accuracy: 0.0001)
        // the delay holds the element's own look
        XCTAssertNil(blink.value(at: 0.5, duration: 4, delay: 1))
        // ease-in-out is symmetric about the middle
        XCTAssertEqual(CSSTiming.easeInOut.value(0.5), 0.5, accuracy: 0.001)
        XCTAssertLessThan(CSSTiming.easeInOut.value(0.25), 0.25)
        // alternate plays the odd cycles backwards
        let ramp = CSSKeyframes([(0, [0]), (1, [10])])
        XCTAssertEqual(ramp.value(at: 1.25, duration: 1, timing: .linear, alternate: true)![0], 7.5, accuracy: 0.0001)
    }
}
