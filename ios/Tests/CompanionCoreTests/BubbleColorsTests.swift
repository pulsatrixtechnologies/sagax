import XCTest
@testable import CompanionCore

/// The conversation bubbles (2026-10-28): the person's own message in the
/// accent exactly (2026-10-29) with the button's ink at 4.5:1 or better, a bot's reply in a neutral grey; the
/// same derivation as the desktop's `src/lib/bubble-colors.ts`.
final class BubbleColorsTests: XCTestCase {
    func testThePersonsBubbleUsesTheAccentAndItsTextReadsOnEverySkinAndColour() {
        var failures: [String] = []
        for family in SkinFamily.all {
            for variant in family.variants {
                for scheme in variant.schemes {
                    let p = variant.look(scheme, depth: .accent).palette
                    let ratio = p.bubbleUserText.contrast(on: p.bubbleUser)
                    if ratio < BubbleColors.minimumContrast {
                        failures.append(String(format: "%@/%@ %@: %.2f", family.id.rawValue, variant.id, scheme.rawValue, ratio))
                    }
                    // the accent exactly, the colour its accent buttons are filled with;
                    // Black, the Grok look, keeps its neutral grey (2026-11-01)
                    if !BubbleColors.keepsNeutralBubbles(p.id), p.bubbleUser.hex != p.accent.hex {
                        failures.append("\(family.id.rawValue)/\(variant.id) \(scheme.rawValue): bubble is not the accent")
                    }
                }
            }
        }
        XCTAssertEqual(failures, [])
    }

    func testTheBotsBubbleIsANeutralGreyOffThePage() {
        for id in SkinID.allCases {
            let p = id.palette
            let bot = p.bubbleAssistant
            XCTAssertEqual(bot.red, bot.green, accuracy: 0.005, id.rawValue)
            XCTAssertEqual(bot.green, bot.blue, accuracy: 0.005, id.rawValue)
            XCTAssertNotEqual(bot, p.bg, id.rawValue)
            XCTAssertGreaterThanOrEqual(p.bubbleAssistantText.contrast(on: bot), 4.5, id.rawValue)
            XCTAssertNotEqual(bot, p.bubbleUser, id.rawValue)
        }
        // lighter than a dark page, darker than a light one
        XCTAssertGreaterThan(SkinPalette.black.bubbleAssistant.luminance, SkinPalette.black.bg.luminance)
        XCTAssertLessThan(SkinID.pulsatrixLight.palette.bubbleAssistant.luminance, SkinID.pulsatrixLight.palette.bg.luminance)
    }

    /// Black is the Grok look (2026-11-01): Grok Bot's neutral bubbles, the
    /// person's a step lighter than the bot's, never the accent.
    func testBlackKeepsGrokNeutralBubbles() {
        let p = SkinPalette.black
        XCTAssertTrue(BubbleColors.keepsNeutralBubbles(.black))
        XCTAssertFalse(BubbleColors.keepsNeutralBubbles(.dim))
        XCTAssertEqual(p.bubbleAssistant, SkinColor(0x202020))
        XCTAssertEqual(p.bubbleUser, SkinColor(0x2E2E30))
        XCTAssertNotEqual(p.bubbleUser, p.accent)
        XCTAssertGreaterThan(p.bubbleUser.luminance, p.bubbleAssistant.luminance)
        XCTAssertGreaterThanOrEqual(p.bubbleUserText.contrast(on: p.bubbleUser), BubbleColors.minimumContrast)
    }

    func testAnyAccentCarriesItsText() {
        var accents: [SkinColor] = [0xF97316, 0xFF0000, 0x00FF00, 0x0000FF, 0xFFFF00, 0xFFFFFF, 0x000000, 0x808080, 0xE8E8E8].map { SkinColor($0) }
        for hue in stride(from: 0, to: 256, by: 11) { accents.append(SkinColor(UInt32(hue) << 16 | UInt32(255 - hue) << 8 | 0x80)) }
        for accent in accents {
            let u = BubbleColors.user(accent: accent)
            XCTAssertEqual(u.fill.hex, accent.hex, String(accent.hex, radix: 16))
            XCTAssertEqual(u.ink, BubbleColors.accentInk(on: accent), String(accent.hex, radix: 16))
            XCTAssertGreaterThanOrEqual(u.ink.contrast(on: u.fill), BubbleColors.minimumContrast, String(accent.hex, radix: 16))
        }
    }

    /// Regression (2026-10-29): the orange bubble was a darker orange than
    /// the accent button beside it. It is now the exact orange, dark ink on it.
    func testAnOrangeAccentStaysExactWithTheButtonsDarkInk() {
        for hex: UInt32 in [0xF97316, 0xFF9500, 0xE78531] {
            let u = BubbleColors.user(accent: SkinColor(hex))
            XCTAssertEqual(u.fill, SkinColor(hex))
            XCTAssertEqual(u.ink, SkinColor(0x111111))
            XCTAssertGreaterThanOrEqual(u.ink.contrast(on: u.fill), BubbleColors.minimumContrast)
        }
        XCTAssertEqual(BubbleColors.user(accent: SkinColor(0x5B21B6)).ink, SkinColor(0xFFFFFF))
        // a skin's own button ink wins where it reads, else the rule
        XCTAssertEqual(BubbleColors.user(accent: SkinColor(0xF97316), buttonInk: SkinColor(0x1C150C)).ink, SkinColor(0x1C150C))
        XCTAssertEqual(BubbleColors.user(accent: SkinColor(0x2F62DD), buttonInk: SkinColor(0x111111)).ink, SkinColor(0xFFFFFF))
    }

    func testTheBubbleInkIsTheAccentButtonsInk() {
        for hex: UInt32 in [0xD94B52, 0x377FE6, 0x009957, 0x8057C8, 0xE78531, 0x808080] {
            let fill = SkinColor(hex)
            XCTAssertEqual(BotAccent.ink(on: fill), BubbleColors.accentInk(on: fill))
            XCTAssertGreaterThanOrEqual(BubbleColors.accentInk(on: fill).contrast(on: fill), BubbleColors.minimumContrast, String(hex, radix: 16))
        }
    }

    func testAnAccentThatAlreadyCarriesWhiteIsUsedAsIs() {
        XCTAssertEqual(BubbleColors.user(accent: SkinColor(0x2F62DD)).fill, SkinColor(0x2F62DD))
    }

    /// Regression (2026-10-28): on Midnight the accent is near white, so my
    /// bubble was white in a 1:1. With a bot's colour it takes that colour
    /// exactly (2026-10-29), with text at 4.5:1 or better, for every bot colour.
    func testMyBubbleInAOneToOneTakesTheBotsColour() {
        let midnight = SkinColor(0xF5F5F5)
        XCTAssertNil(BubbleColors.user(botColor: nil))
        XCTAssertNil(BubbleColors.user(botColor: "not-a-colour"))
        for name in ["red", "green", "blue", "purple", "orange"] {
            guard let paint = BubbleColors.user(botColor: name) else { XCTFail("no paint for \(name)"); continue }
            XCTAssertNotEqual(paint.fill, midnight, name)
            XCTAssertGreaterThanOrEqual(paint.ink.contrast(on: paint.fill), BubbleColors.minimumContrast, name)
            let bot = SkinColor(css: MausColors.hex(for: name)!)!
            XCTAssertEqual(paint.fill.hex, bot.hex, "\(name): not the bot's colour")
        }
    }
}
