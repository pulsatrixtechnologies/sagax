// A premium shape skin paints the body's face on the phone as on the
// desktop (#4159, item 4): `shapeSkinLayers` in
// src/components/skin-fx/shape-skins.tsx, its still look at every size and
// its larger look (filters, particles) from 44 pt up.
import CoreGraphics
import XCTest
@testable import CompanionCore

final class ShapeSkinLayersTests: XCTestCase {
    private let green = "#009957"
    private let premium: [ShapeSkin] = [.outline, .gold, .neon, .chrome, .crystal, .circuit, .holo, .molten, .galaxy]

    func testEveryPremiumSkinPaintsItsLayersOnTheFace() {
        for skin in premium {
            for full in [false, true] {
                let layers = ShapeSkinLayers.of(skin, hex: green, full: full)
                XCTAssertTrue(layers.paints, "\(skin.rawValue) full=\(full)")
                XCTAssertFalse(layers.inner.isEmpty && layers.edge.isEmpty, "\(skin.rawValue) full=\(full)")
            }
        }
        for skin in [ShapeSkin.plain, .pastel, .glossy, .night] {
            let layers = ShapeSkinLayers.of(skin, hex: green, full: true)
            XCTAssertFalse(layers.paints, skin.rawValue)
            XCTAssertEqual(layers.fill, .solid(ShapeArt.paint(skin, hex: green).fill, opacity: 1), skin.rawValue)
        }
    }

    func testGoldIsAGradientWithBrushLinesUnderItsOwnStroke() {
        let gold = ShapeSkinLayers.of(.gold, hex: green, full: false)
        guard case let .linear(stops, from, to, inBox, repeats) = gold.fill else { return XCTFail("gold fill") }
        XCTAssertEqual(stops.map(\.color), ["#fff4c2", "#f2c94c", "#c8901e", "#8a5a0c", "#e9b949"])
        XCTAssertEqual(from, .zero)
        XCTAssertEqual(to, CGPoint(x: 0.35, y: 1))
        XCTAssertTrue(inBox)
        XCTAssertFalse(repeats)
        XCTAssertFalse(gold.ownEdge, "the base stroke stays")
        // the brushed lines: one 0.7 high every 2.2 across the box, then the highlight
        guard case let .path(brush) = gold.inner.first?.figure else { return XCTFail("brush") }
        XCTAssertEqual(brush.components(separatedBy: "M").count - 1, 46)
        XCTAssertEqual(gold.inner.first?.fill, .solid("#fff8de", opacity: 0.22))
        XCTAssertEqual(gold.inner.count, 2)
        XCTAssertTrue(gold.around.isEmpty, "the glints are the larger look")
        XCTAssertEqual(ShapeSkinLayers.of(.gold, hex: green, full: true).around.count, 3)
    }

    func testOutlineHasItsRainbowHaloAndHatching() {
        let still = ShapeSkinLayers.of(.outline, hex: green, full: false)
        XCTAssertFalse(still.ownEdge)
        XCTAssertEqual(still.inner.count, 6, "six hatch lines")
        XCTAssertEqual(still.inner.first?.opacity, 0.18)
        XCTAssertEqual(still.edge.count, 1)
        XCTAssertEqual(still.edge.first?.figure, .face)
        XCTAssertEqual(still.edge.first?.lineWidth, 8.4)
        XCTAssertEqual(still.edge.first?.opacity, 0.75)
        guard case let .linear(stops, _, to, inBox, repeats)? = still.edge.first?.stroke else { return XCTFail("rainbow") }
        XCTAssertEqual(stops.map(\.color), ["#ff8be6", "#ffe98a", "#8dffc8", "#7df4ff", "#b49bff", "#ff8be6"])
        XCTAssertEqual(to, CGPoint(x: 60, y: 0))
        XCTAssertFalse(inBox)
        XCTAssertTrue(repeats)
        let full = ShapeSkinLayers.of(.outline, hex: green, full: true)
        XCTAssertTrue(full.ownEdge, "the boiling line draws its own edge")
        XCTAssertEqual(full.edge.last?.stroke, .solid("#1b1f27", opacity: 1))
    }

    func testGalaxyStarsFollowTheSize() {
        let still = ShapeSkinLayers.of(.galaxy, hex: green, full: false)
        let full = ShapeSkinLayers.of(.galaxy, hex: green, full: true)
        func stars(_ layers: ShapeSkinLayers) -> Int {
            layers.inner.filter { if case .circle = $0.figure { return true } else { return false } }.count
        }
        XCTAssertEqual(stars(still), 8, "every other star")
        XCTAssertEqual(stars(full), 16)
        guard case .radial = still.fill else { return XCTFail("deep space fill") }
        XCTAssertTrue(still.ownEdge)
        XCTAssertEqual(still.edge.first?.stroke, .solid(ShapeArt.tint(green, 0.5), opacity: 0.75))
        XCTAssertEqual(full.under.first?.blur, 2.4)
    }

    func testColourDrivenLayersFollowTheBotColour() {
        let neon = ShapeSkinLayers.of(.neon, hex: green, full: false)
        XCTAssertEqual(neon.edge.first?.stroke, .solid(ShapeArt.tint(green, 0.2), opacity: 1))
        let circuit = ShapeSkinLayers.of(.circuit, hex: green, full: false)
        XCTAssertEqual(circuit.edge.first?.stroke, .solid(ShapeArt.mix(green, "#7dffea", 0.45), opacity: 1))
        let chrome = ShapeSkinLayers.of(.chrome, hex: green, full: false)
        guard case let .linear(stops, _, _, _, _) = chrome.fill else { return XCTFail("chrome fill") }
        XCTAssertEqual(stops[2].color, ShapeArt.mix(green, "#4b5561", 0.7))
    }

    /// The phone draws a shape skin's layers now: nothing is substituted.
    func testNoShapeSkinIsSubstitutedAnyMore() {
        for skin in ShapeSkin.allCases {
            XCTAssertTrue(MascotSubstitution.entries(for: CompleteMascotLook(character: .shape, shape: .cloud, shapeSkin: skin)).isEmpty, skin.rawValue)
        }
    }
}
