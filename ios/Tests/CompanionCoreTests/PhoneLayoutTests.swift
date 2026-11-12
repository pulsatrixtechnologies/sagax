// #4041: on the iPhone the bot profile page was wider than the screen
// (the desktop's Appearance rows at their desktop widths widened the
// whole column, cut on both sides), the home's rows scrolled sharp under
// the avatar and the +, and the apps menu was the system's glass menu
// with the list reading through it and "Connect apps" where the desktop
// says "Plugins". The views live in the app target, so these checks read
// its sources, as the other source checks of this package do.
import Foundation
import XCTest

final class PhoneLayoutTests: XCTestCase {
    private func source(_ path: String) throws -> String {
        let ios = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try String(contentsOf: ios.appendingPathComponent(path), encoding: .utf8)
    }

    /// The text of one declaration: from `start` to the next top-level `struct` or `extension`.
    private func declaration(_ text: String, from start: String) throws -> String {
        let begin = try XCTUnwrap(text.range(of: start), "\(start) is gone")
        let rest = text[begin.upperBound...]
        let end = ["\nstruct ", "\nextension ", "\nenum ", "\nprivate struct "]
            .compactMap { rest.range(of: $0)?.lowerBound }.min() ?? rest.endIndex
        return String(rest[..<end])
    }

    func testTheProfilePageIsExactlyAsWideAsTheScreen() throws {
        let page = try source("App/Profile/BotProfilePage.swift")
        // the column takes the viewport's width, so no row can widen it
        XCTAssertTrue(page.contains(".frame(width: viewport.size.width)"))
        // the bar condenses once the name passes under its lower edge, both
        // read on screen: the preference from inside the scroll never
        // reached the page, so the bar kept the banner's colour over the content
        XCTAssertTrue(page.contains("let now = nameEdge < barEdge"))
        XCTAssertFalse(page.contains("BotProfileNameEdgeKey"))
    }

    func testTheAppearancePaneStacksOnAPhone() throws {
        let pane = try source("App/Desktop/PersonaAppearancePane.swift")
        XCTAssertTrue(pane.contains("static let compactBelow"))
        // the preview: stage, name and buttons stacked; the moves in its flow
        XCTAssertTrue(pane.contains("moveList(width: nil)"))
        // the search on its own row, the chips scrolling in theirs
        XCTAssertTrue(pane.contains("mascotSearch(width: nil)"))
        // no fixed desktop width left in the pane's flow
        XCTAssertFalse(pane.contains(".frame(width: 352, alignment: .leading)"))
        XCTAssertFalse(pane.contains(".frame(width: 206, height: 32)"))
        // the side by side band keeps its buttons column only when wide
        let hero = try declaration(pane, from: "private var hero: some View {")
        XCTAssertTrue(hero.contains("if compact {"))
    }

    func testTheHomeHeaderFadeCoversTheHeaderNotOnlyTheStatusBar() throws {
        let theme = try source("App/Theme.swift")
        let fade = try declaration(theme, from: "struct TopScrollEdgeFade: ViewModifier {")
        // the gradient starts at the safe area's top, under the header,
        // and a band of the background fills the status bar above it
        XCTAssertFalse(fade.contains(".ignoresSafeArea(edges: underStatusBar ? .top : [])"))
        XCTAssertTrue(fade.contains("Color.clear.frame(height: 0).background(background.ignoresSafeArea(edges: .top))"))
    }

    func testTheAppsMenuIsOpaqueAndSaysPlugins() throws {
        let home = try source("App/HomeRoster.swift")
        let button = try declaration(home, from: "struct HomeAppsButton: View {")
        // not the system menu, whose glass let the list read through
        XCTAssertFalse(button.contains("Menu {"))
        let menu = try declaration(home, from: "struct HomeAppsMenu: View {")
        XCTAssertTrue(menu.contains("String(localized: \"Plugins\")"))
        XCTAssertFalse(menu.contains("\"Connect apps\""))
        XCTAssertFalse(home.contains("Label(String(localized: \"Connect apps\")"))
        // a dimmed home under an opaque card
        XCTAssertTrue(menu.contains("Theme.dim"))
        XCTAssertTrue(menu.contains(".background(surface, in:"))
    }
}
