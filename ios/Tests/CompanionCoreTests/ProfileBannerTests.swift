import XCTest
@testable import CompanionCore

final class ProfileBannerTests: XCTestCase {
    func testWhiteMascotDarkensALightBand() {
        let plain = ProfileBanner.colors(accent: "#F6B897", mascot: nil)
        XCTAssertLessThan(ProfileBanner.contrast(plain.to, "#FFFFFF"), ProfileBanner.minContrast)
        let moved = ProfileBanner.colors(accent: "#F6B897", mascot: "#FFFFFF")
        XCTAssertGreaterThanOrEqual(ProfileBanner.contrast(moved.to, "#FFFFFF"), ProfileBanner.targetContrast)
    }

    func testABandThatReadsIsLeftAlone() {
        XCTAssertEqual(ProfileBanner.colors(accent: "#D94B52", mascot: "#1B1F27").to, ProfileBanner.colors(accent: "#D94B52", mascot: nil).to)
    }

    func testEveryBotColourReadsOnItsOwnBand() {
        for (name, hex) in MausColors.hex {
            let moved = ProfileBanner.colors(accent: hex, mascot: hex)
            XCTAssertGreaterThanOrEqual(ProfileBanner.contrast(moved.to, hex), ProfileBanner.minContrast, name)
        }
    }

    func testDominantColourFollowsTheSkin() {
        var look = MascotLook.owl.complete
        look.character = .shiba
        look.shibaSkin = .white
        XCTAssertEqual(MascotDominant.color(look: look, color: "blue", owlSkin: .none), "#F4EEE4")
        for character in MascotCharacter.allCases {
            look.character = character
            XCTAssertTrue(MausColors.isHex(MascotDominant.color(look: look, color: "orange", owlSkin: .none)))
        }
    }
}
