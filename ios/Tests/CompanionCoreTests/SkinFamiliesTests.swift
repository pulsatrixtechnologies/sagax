import XCTest
@testable import CompanionCore

/// Skin families on the phone (2026-10-19): every listed skin is one variant
/// of one family, a saved selection reads back as the skin it wears, and a
/// choice writes the same ThemeSelection fields as before.
final class SkinFamiliesTests: XCTestCase {
    func testEveryListedSkinHasExactlyOnePlace() {
        var seen: [SkinID] = []
        for family in SkinFamily.all where family.id != .retro98 {
            XCTAssertFalse(family.variants.isEmpty, family.name)
            for variant in family.variants {
                XCTAssertFalse(variant.schemes.isEmpty, variant.name)
                seen += [variant.light, variant.dark].compactMap { $0 }
            }
        }
        XCTAssertEqual(Set(seen).count, seen.count, "a skin in two variants")
        XCTAssertEqual(Set(seen), Set(SkinID.visible(retroUnlocked: false)))
        for skin in seen {
            let place = SkinPlace.of(skin)
            XCTAssertEqual(place.variant.skin(place.scheme), skin)
        }
    }

    func testDesktopVariantsMatch() {
        // the same pairs as src/lib/skin-families.ts
        XCTAssertEqual(SkinPlace.of(.pulsatrixLight).variant, SkinPlace.of(.pulsatrix).variant)
        XCTAssertEqual(SkinPlace.of(.daylight).variant, SkinPlace.of(.midnight).variant)
        XCTAssertEqual(SkinPlace.of(.linen).variant, SkinPlace.of(.graphite).variant)
        XCTAssertEqual(SkinPlace.of(.atelier).variant, SkinPlace.of(.foundry).variant)
        XCTAssertEqual(SkinPlace.of(.dusk).family.id, .studio)
        XCTAssertEqual(SkinPlace.of(.lagoon).family.id, .atelier)
        XCTAssertEqual(SkinPlace.of(.dim).family.id, .phone)
    }

    func testSavedSelectionsReadBackUnchanged() {
        // the default: Black twice, pinned dark
        let base = ThemeSelection()
        XCTAssertEqual(base.skinChoice(deviceDark: false).place.variant.id, "black")
        XCTAssertEqual(base.skinChoice(deviceDark: false).mode, .dark)
        // a fixed skin
        let fixed = ThemeSelection(mode: .fixed, fixedSkin: .graphite)
        XCTAssertEqual(fixed.skinChoice(deviceDark: false).place.variant.id, "slate")
        XCTAssertEqual(fixed.skinChoice(deviceDark: false).mode, .dark)
        // a family pair following the phone is Auto
        let auto = ThemeSelection(mode: .system, lightSkin: .daylight, darkSkin: .midnight)
        XCTAssertEqual(auto.skinChoice(deviceDark: true).mode, .auto)
        XCTAssertEqual(auto.skinChoice(deviceDark: true).place.variant.id, "neutral")
        // an older mixed pair keeps wearing its skins, shown by the worn one
        let mixed = ThemeSelection(mode: .system, lightSkin: .pulsatrixLight, darkSkin: .black)
        XCTAssertEqual(mixed.skinChoice(deviceDark: false).place.family.id, .pulsatrix)
        XCTAssertEqual(mixed.skinChoice(deviceDark: false).mode, .light)
        XCTAssertEqual(mixed.skinChoice(deviceDark: true).place.family.id, .phone)
        XCTAssertEqual(mixed.skin(deviceDark: true), .black)
    }

    func testChoosingWritesTheSameFields() {
        let neutral = SkinPlace.of(.midnight).variant
        let auto = ThemeSelection().choosing(neutral, mode: .auto)
        XCTAssertEqual(auto.mode, .system)
        XCTAssertEqual(auto.skin(deviceDark: false), .daylight)
        XCTAssertEqual(auto.skin(deviceDark: true), .midnight)
        let light = ThemeSelection().choosing(neutral, mode: .light)
        XCTAssertEqual(light.mode, .fixed)
        XCTAssertEqual(light.fixedSkin, .daylight)
        // a mode the variant lacks falls to the one it has
        let plum = SkinPlace.of(.dusk).variant
        XCTAssertEqual(ThemeSelection().choosing(plum, mode: .light).fixedSkin, .dusk)
        XCTAssertEqual(ThemeSelection().choosing(plum, mode: .auto).fixedSkin, .dusk)
        XCTAssertEqual(ThemeSelection.carry(.auto, to: plum, worn: .light), .dark)
        XCTAssertEqual(ThemeSelection.carry(.dark, to: SkinPlace.of(.lagoon).variant, worn: .dark), .light)
        XCTAssertEqual(ThemeSelection.carry(.auto, to: neutral, worn: .dark), .auto)
    }

    func testEverySlotHasTheAppearanceOfItsSkin() {
        for family in SkinFamily.all {
            for variant in family.variants {
                if let light = variant.light { XCTAssertFalse(light.isDark, "\(family.id)/\(variant.id) light") }
                if let dark = variant.dark { XCTAssertTrue(dark.isDark, "\(family.id)/\(variant.id) dark") }
            }
        }
    }

    func testThePickerOffersOnlyTheVariantsOfTheSchemeWorn() {
        let studio = SkinFamily.of(.studio)
        XCTAssertEqual(studio.variants(for: .dark).map(\.id), ["neutral", "slate", "plum"])
        XCTAssertEqual(studio.variants(for: .light).map(\.id), ["neutral", "slate"])
        let atelier = SkinFamily.of(.atelier)
        XCTAssertEqual(atelier.variants(for: .dark).map(\.id), ["brass"])
        XCTAssertEqual(atelier.variants(for: .light).map(\.id), ["brass", "lagoon"])
        for family in SkinFamily.all {
            for scheme in [SkinScheme.light, .dark] {
                for variant in family.variants(for: scheme) {
                    XCTAssertEqual(variant.skin(scheme).isDark, scheme == .dark, "\(family.id)/\(variant.id)")
                }
            }
        }
        // Hibou 98 has only a light look, the phone family only a dark one
        XCTAssertTrue(SkinFamily.of(.retro98).variants(for: .dark).isEmpty)
        XCTAssertTrue(SkinFamily.of(.phone).variants(for: .light).isEmpty)
        // the worn variant stays listed
        let lagoon = SkinPlace.of(.lagoon).variant
        XCTAssertTrue(atelier.variants(for: .dark, keeping: lagoon).contains(lagoon))
    }
}
