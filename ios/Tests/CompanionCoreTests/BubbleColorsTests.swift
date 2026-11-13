import XCTest
@testable import CompanionCore

/// The conversation bubbles (2026-10-28): the person's own message in the
/// accent with white text (#4096; the hue a step deeper where white would not
/// read at 4.5:1, a neutral accent keeps its button's ink), a bot's reply in a
/// neutral grey; the same derivation as the desktop's `src/lib/bubble-colors.ts`.
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
                    // cut from the accent: white text on a coloured one (#4096);
                    // Black, the Grok look, keeps its neutral grey (2026-11-01)
                    if !BubbleColors.keepsNeutralBubbles(p.id), p.bubbleUser != BubbleColors.user(accent: p.accent, buttonInk: p.accentInk).fill {
                        failures.append("\(family.id.rawValue)/\(variant.id) \(scheme.rawValue): bubble is not cut from the accent")
                    }
                    if !BubbleColors.keepsNeutralBubbles(p.id), !BubbleColors.isNeutral(p.accent), p.bubbleUserText != SkinColor(0xFFFFFF) {
                        failures.append("\(family.id.rawValue)/\(variant.id) \(scheme.rawValue): text is not white")
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

    /// Black is the Grok look (2026-11-01): reference app's neutral bubbles, the
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
            if BubbleColors.isNeutral(accent) {
                XCTAssertEqual(u.fill.hex, accent.hex, String(accent.hex, radix: 16))
                XCTAssertEqual(u.ink, BubbleColors.accentInk(on: accent), String(accent.hex, radix: 16))
            } else {
                XCTAssertEqual(u.fill, BubbleColors.whiteInkFill(accent), String(accent.hex, radix: 16))
                XCTAssertEqual(u.ink, SkinColor(0xFFFFFF), String(accent.hex, radix: 16))
            }
            XCTAssertGreaterThanOrEqual(u.ink.contrast(on: u.fill), BubbleColors.minimumContrast, String(accent.hex, radix: 16))
        }
    }

    /// Regression (#4096): the person's bubble on a saturated accent (a pink,
    /// an orange) was written in near black; the reference writes every
    /// accent bubble in white, on a deeper shade of the hue where white would
    /// not read. The same values as the desktop's `userBubble`.
    func testASaturatedAccentIsWrittenInWhiteAsTheReference() {
        let desktop: [(UInt32, UInt32)] = [(0xF472B6, 0xE3127F), (0xF97316, 0xC55405), (0xFACC15, 0x907303), (0x60A5FA, 0x0871F3)]
        for (accent, fill) in desktop {
            let u = BubbleColors.user(accent: SkinColor(accent))
            XCTAssertEqual(u.ink, SkinColor(0xFFFFFF), String(accent, radix: 16))
            XCTAssertEqual(String(u.fill.hex, radix: 16), String(fill, radix: 16), String(accent, radix: 16))
            XCTAssertGreaterThanOrEqual(u.ink.contrast(on: u.fill), BubbleColors.minimumContrast)
        }
        XCTAssertEqual(BubbleColors.user(accent: SkinColor(0x5B21B6)).fill, SkinColor(0x5B21B6))
        XCTAssertEqual(BubbleColors.user(accent: SkinColor(0x5B21B6)).ink, SkinColor(0xFFFFFF))
        // a skin's dark button ink no longer wins on a coloured accent
        XCTAssertEqual(BubbleColors.user(accent: SkinColor(0xF97316), buttonInk: SkinColor(0x1C150C)).ink, SkinColor(0xFFFFFF))
        // a neutral accent keeps its button's ink
        XCTAssertEqual(BubbleColors.user(accent: SkinColor(0xF5F5F5), buttonInk: SkinColor(0x121212)).ink, SkinColor(0x121212))
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
    /// bubble was white in a 1:1. With a bot's colour it takes that colour in
    /// white text (#4096), at 4.5:1 or better, for every bot colour.
    func testMyBubbleInAOneToOneTakesTheBotsColour() {
        let midnight = SkinColor(0xF5F5F5)
        XCTAssertNil(BubbleColors.user(botColor: nil))
        XCTAssertNil(BubbleColors.user(botColor: "not-a-colour"))
        for name in ["red", "green", "blue", "purple", "orange"] {
            guard let paint = BubbleColors.user(botColor: name) else { XCTFail("no paint for \(name)"); continue }
            XCTAssertNotEqual(paint.fill, midnight, name)
            XCTAssertGreaterThanOrEqual(paint.ink.contrast(on: paint.fill), BubbleColors.minimumContrast, name)
            let bot = SkinColor(css: MausColors.hex(for: name)!)!
            XCTAssertEqual(paint.fill, BubbleColors.whiteInkFill(bot), "\(name): not the bot's colour")
            XCTAssertEqual(paint.ink, SkinColor(0xFFFFFF), name)
        }
    }
}
