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
        // no fixed desktop width left in the pane's flow
        XCTAssertFalse(pane.contains(".frame(width: 352, alignment: .leading)"))
        XCTAssertFalse(pane.contains(".frame(width: 206, height: 32)"))
        // the side by side band keeps its buttons column only when wide
        let hero = try declaration(pane, from: "private var hero: some View {")
        XCTAssertTrue(hero.contains("if compact {"))
    }

    func testTheAppearancePaneHasNoSourceBarAndNothingUnderTheName() throws {
        // regression #4076: the owner asked to hide the source bar (Mascot,
        // Generate, Upload, the search) and the strip under the mascot's
        // name (the summary line, In use, the moves menu, Play a move)
        let pane = try source("App/Desktop/PersonaAppearancePane.swift")
        for gone in ["persona-appearance.mode.", "persona-appearance.search", "persona-appearance.generate",
                     "persona-appearance.upload", "persona-appearance.summary", "persona-appearance.action",
                     "persona-appearance.moves", "persona-appearance.move-list", "persona-appearance.play",
                     "PhotosPicker", "\"Avatar source\"", "\"Play a move\"", "\"In use\""] {
            XCTAssertFalse(pane.contains(gone), gone)
        }
        // the preview keeps its stage, the name and Randomize; Reset sits in the tab row
        let hero = try declaration(pane, from: "private var hero: some View {")
        XCTAssertTrue(hero.contains("heroName(name)"))
        XCTAssertTrue(hero.contains("randomizeButton"))
        let tabs = try declaration(pane, from: "private func tabRow(")
        XCTAssertTrue(tabs.contains("resetButton"))
    }

    func testResetNeverSqueezesThePhoneTabs() throws {
        // regression #4076: on the smallest phone, Reset beside the scrolling
        // tabs cut a tab's value; compact, Reset sits on its own row under
        // the full width tabs
        let pane = try source("App/Desktop/PersonaAppearancePane.swift")
        let tabs = try declaration(pane, from: "private func tabRow(")
        let compactBranch = try XCTUnwrap(tabs.components(separatedBy: "} else {").first)
        XCTAssertTrue(compactBranch.contains("VStack(alignment: .trailing"))
        XCTAssertFalse(compactBranch.contains("HStack"))
        let scroll = try XCTUnwrap(compactBranch.range(of: "ScrollView(.horizontal"))
        let reset = try XCTUnwrap(compactBranch.range(of: "resetButton"))
        XCTAssertLessThan(scroll.lowerBound, reset.lowerBound)
    }

    func testTheHomeHeaderFadeCoversTheHeaderNotOnlyTheStatusBar() throws {
        let theme = try source("App/Theme.swift")
        let fade = try declaration(theme, from: "struct TopScrollEdgeFade: ViewModifier {")
        // the gradient starts at the safe area's top, under the header,
        // and a band of the background fills the status bar above it
        XCTAssertFalse(fade.contains(".ignoresSafeArea(edges: underStatusBar ? .top : [])"))
        XCTAssertTrue(fade.contains("Color.clear.frame(height: 0).background(background.ignoresSafeArea(edges: .top))"))
    }

    func testTheAppsMenuIsOpaqueAndSaysConnectApps() throws {
        let home = try source("App/HomeRoster.swift")
        let button = try declaration(home, from: "struct HomeAppsButton: View {")
        // not the system menu, whose glass let the list read through
        XCTAssertFalse(button.contains("Menu {"))
        let menu = try declaration(home, from: "struct HomeAppsMenu: View {")
        // #4103: the desktop's Plugins window is Connect Apps (#4153), and
        // the phone takes the same name
        XCTAssertTrue(menu.contains("String(localized: \"Connect apps\")"))
        XCTAssertFalse(menu.contains("String(localized: \"Plugins\")"))
        XCTAssertFalse(home.contains("Label(String(localized: \"Connect apps\")"))
        // a dimmed home under an opaque card: the one card both menus share
        XCTAssertTrue(menu.contains("HomeMenuCard("))
        let card = try declaration(home, from: "struct HomeMenuCard<Content: View>: View {")
        XCTAssertTrue(card.contains("Theme.dim"))
        XCTAssertTrue(card.contains(".background(HomeMenuStyle.surface, in:"))
    }

    // #4066: the "+" menu drew over a nearly transparent layer, so the list
    // read through it, and the apps menu carried its own copy of the card.
    func testThePlusMenuIsTheSameOpaqueCardOverTheDimmedHome() throws {
        let home = try source("App/HomeRoster.swift")
        let plus = try declaration(home, from: "struct HomePlusMenu: View {")
        XCTAssertTrue(plus.contains("HomeMenuCard("))
        XCTAssertFalse(plus.contains("Color.black.opacity(0.001)"))
        XCTAssertFalse(plus.contains(".themeGlass("))
        let apps = try declaration(home, from: "struct HomeAppsMenu: View {")
        // one card, one divider: neither menu draws its own
        for menu in [plus, apps] {
            XCTAssertFalse(menu.contains("Theme.dim"))
            XCTAssertFalse(menu.contains("RoundedRectangle(cornerRadius: 24"))
            XCTAssertFalse(menu.contains("Rectangle()\n"))
            XCTAssertTrue(menu.contains("HomeMenuDivider()"))
        }
    }

    // #4066: the pane's width began at 0, so an iPad drew the phone layout
    // for one frame: before it is measured, the size class decides.
    func testTheAppearancePaneStartsFromTheWindowsSizeClass() throws {
        let pane = try source("App/Desktop/PersonaAppearancePane.swift")
        XCTAssertFalse(pane.contains("@State private var paneWidth: CGFloat = 0"))
        XCTAssertTrue(pane.contains("@State private var paneWidth: CGFloat?"))
        XCTAssertTrue(pane.contains("@Environment(\\.horizontalSizeClass)"))
    }

    // #4066: the bot's note on the working line is never cut (at most
    // `LiveTextPlace.lineTextMax` units, so it wraps as the desktop's does).
    func testTheWorkingNoteIsNeverCut() throws {
        let chat = try source("App/ChatView.swift")
        let note = try XCTUnwrap(chat.range(of: "private func noteText(_ words: String) -> some View {"))
        let body = chat[note.upperBound...].prefix(400)
        XCTAssertFalse(body.contains(".lineLimit(2)"))
        XCTAssertTrue(body.contains(".lineLimit(nil)"))
    }

    // #4066: the answer being written was flat text on the background until
    // it landed in the grey bubble of the settled reply: it grows in that
    // same bubble now, with the same fill, padding and ink.
    func testTheStreamingAnswerGrowsInTheSettledReplysBubble() throws {
        let live = try source("App/Features/Chat/StreamingBubble.swift")
        let settled = try source("App/Features/Chat/TextBubble.swift")
        XCTAssertTrue(live.contains(".fill(BubbleColor.theirs(desktop: desktop))"))
        XCTAssertTrue(settled.contains("return BubbleColor.theirs(desktop: desktop)"))
        XCTAssertTrue(live.contains("Theme.Chat.bubblePaddingH"))
        XCTAssertTrue(live.contains("BubbleColor.theirsText"))
        XCTAssertFalse(live.contains("Theme.textPrimary)"))
    }
}
