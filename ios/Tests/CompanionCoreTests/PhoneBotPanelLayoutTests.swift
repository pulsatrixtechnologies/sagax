// #4101: on the iPhone the bot panel's cards sat further in than their own
// titles (a card padded by its column AND by itself), the routine names cut
// although the card had room, the settings gear sat at the top left and the
// close control at the top right. The reference app: the round back control
// at the top left, share and more at the top right, no gear, every group on
// one side margin. The views live in the app target, so these checks read
// its sources, as PhoneLayoutTests does.
import Foundation
@testable import CompanionCore
import XCTest

final class PhoneBotPanelLayoutTests: XCTestCase {
    private func source(_ path: String) throws -> String {
        let ios = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try String(contentsOf: ios.appendingPathComponent(path), encoding: .utf8)
    }

    /// The text of one member: from `start` to the next member at the same indent.
    private func member(_ text: String, from start: String) throws -> String {
        let begin = try XCTUnwrap(text.range(of: start), "\(start) is gone")
        let rest = text[begin.upperBound...]
        let end = ["\n    private var ", "\n    private func ", "\n    // MARK: "]
            .compactMap { rest.range(of: $0)?.lowerBound }.min() ?? rest.endIndex
        return String(rest[..<end])
    }

    func testTheLeadingControlIsTopLeftAndTheActionsTopRight() throws {
        let panel = try source("App/Profile/BotPanelPhone.swift")
        let bar = try member(panel, from: "private var topBar: some View {")
        XCTAssertFalse(panel.contains("\"gearshape\""), "no gear on the panel")
        let back = try XCTUnwrap(bar.range(of: "ProfileBackButton"), "the round back control")
        let spacer = try XCTUnwrap(bar.range(of: "Spacer()"))
        let share = try XCTUnwrap(bar.range(of: "ShareGlassButton"), "share at the top right")
        let more = try XCTUnwrap(bar.range(of: "\"ellipsis\""), "more at the top right")
        XCTAssertLessThan(back.lowerBound, spacer.lowerBound)
        XCTAssertLessThan(spacer.lowerBound, share.lowerBound)
        XCTAssertLessThan(share.lowerBound, more.lowerBound)
        // the more menu opens under its control, in the trailing corner
        XCTAssertTrue(panel.contains("anchor: .topTrailing"))
    }

    func testThePanelHasNoTabSwitchAndAnEditPill() throws {
        let panel = try source("App/Profile/BotPanelPhone.swift")
        XCTAssertFalse(panel.contains("PanelTabBar("), "Library and Routines are rows that push their page")
        let identity = try member(panel, from: "private var identity: some View {")
        XCTAssertTrue(identity.contains("PanelEditPill"))
    }

    func testEveryGroupTakesTheMarginOnce() throws {
        let panel = try source("App/Profile/BotPanelPhone.swift")
        // the column holds the side margin; no card, title or control in it
        // pads itself again (the double padding drew a card 48 pt in)
        let body = try member(panel, from: "private var overviewBody: some View {")
        XCTAssertTrue(body.contains(".phonePanelColumn()"))
        XCTAssertFalse(panel.contains(".padding(.horizontal, Theme.Profile.cardMargin)"))
        let components = try source("App/Profile/ProfileComponents.swift")
        XCTAssertTrue(components.contains(".padding(.horizontal, margin ?? columnMargin)"), "a card reads its column's margin")
        let tasks = try source("App/Profile/BotTaskListCard.swift")
        XCTAssertFalse(tasks.contains(".padding(.horizontal, insets && !isHidden ? 16 : 0)"))
        // the pages pushed from the panel sit on the same margin
        let library = try source("App/Profile/BotPanelPhoneLibrary.swift")
        XCTAssertTrue(library.contains(".phonePanelColumn()"))
        let pages = try member(panel, from: "private func overviewPage(")
        XCTAssertTrue(pages.contains("routinesPage.phonePanelColumn()"))
    }

    func testARoutineNameGetsTheCardsWidthAndItsScheduleTwoLines() throws {
        let panel = try source("App/Profile/BotPanelPhone.swift")
        let row = try member(panel, from: "private func routineCardRow(")
        // no leading icon column eats the name's width; the schedule and
        // the state read on two lines, as the reference's Routines page
        XCTAssertFalse(row.contains("ProfileRowIcon"))
        XCTAssertTrue(row.contains(".lineLimit(PhonePanelMetrics.routineSubtitleLines)"))
    }

    func testPushedPagesUseTheReferenceBar() throws {
        let panel = try source("App/Profile/BotPanelPhone.swift")
        let pages = try member(panel, from: "private func overviewPage(")
        // the system bar put the back control 3 pt in and 5 pt high and a
        // 19 pt title; the reference: back on the page margin, 16 pt title
        XCTAssertTrue(pages.contains(".phonePageBar("))
        XCTAssertFalse(pages.contains(".navigationTitle("))
        let rows = try source("App/Profile/BotPanelPhoneRows.swift")
        XCTAssertTrue(rows.contains("ProfileBackButton(action: back)"))
        XCTAssertTrue(rows.contains(".toolbar(.hidden, for: .navigationBar)"))
        XCTAssertTrue(rows.contains("SwipeBackBridge()"), "the swipe back keeps working")
    }

    func testTheComputerBarSitsUnderTheStatusBarOnce() throws {
        let shell = try source("App/ComputerImmersiveLayout.swift")
        // inside the safe area, adding its inset again drew the bar a status
        // bar too low; ignoring the safe area drew it under the clock
        XCTAssertFalse(shell.contains("safeAreaInsets.top"))
        XCTAssertFalse(shell.contains("        .ignoresSafeArea()\n    }\n\n    private func showsChrome"))
        XCTAssertTrue(shell.contains(".padding(.top, Theme.PhonePanel.barCentre - Theme.Metric.glassLarge / 2)"))
    }

    func testTheComputerBarsTakeThePageMarginOnce() throws {
        let shell = try source("App/ComputerImmersiveLayout.swift")
        XCTAssertTrue(shell.contains(".padding(.horizontal, Theme.PhonePanel.margin)"), "the shell sets the page margin")
        // the bars it wraps add no edge of their own: both counted put back,
        // help, more, clipboard and keyboard 35 pt in instead of 17
        let view = try source("App/ComputerView.swift")
        let top = try member(view, from: "private var topBar: some View {")
        XCTAssertFalse(top.contains(".padding(.horizontal"))
        let bottom = try member(view, from: "private var bottomButtons: some View {")
        XCTAssertFalse(bottom.contains(".padding(.horizontal"))
        let org = try member(view, from: "private func orgImmersiveScreen<")
        let orgTop = try XCTUnwrap(org.components(separatedBy: "bottom:").first)
        XCTAssertFalse(orgTop.contains(".padding(.horizontal"))
    }

    func testTheOrganizationStagesStartUnderTheBarOnTheMargin() throws {
        // the bars float without a band now: a stage's content (its screen
        // picker, the label and the picture) starts below the back control
        // instead of behind it, and on the same 17 pt margin
        let view = try source("App/ComputerView.swift")
        let org = try member(view, from: "private func orgImmersiveScreen<")
        XCTAssertTrue(org.contains(".padding(.top, Theme.PhonePanel.barCentre + Theme.Metric.glassLarge / 2 + 12)"))
        let orgTop = try XCTUnwrap(org.components(separatedBy: "bottom:").first)
        XCTAssertFalse(orgTop.contains("chooser("), "the picker scrolls with the stage, not in the bar")
        for stage in ["private var localVmScreen: some View {", "private var sandboxScreen: some View {", "private var browserScreen: some View {"] {
            let body = try member(view, from: stage)
            XCTAssertFalse(body.contains("Theme.Metric.screenEdge"), stage)
        }
    }

    func testTheLibraryRowDrawsAFolderWithBooksAndCardsAreOutlined() throws {
        // the reference's Library mark is a folder holding books, not the
        // row of books of "books.vertical"; its cards carry a faint outline
        let panel = try source("App/Profile/BotPanelPhone.swift")
        XCTAssertTrue(panel.contains("glyph: AnyShape(LibraryFolderGlyph()), title: Text(\"Library\")"))
        let rows = try source("App/Profile/BotPanelPhoneRows.swift")
        XCTAssertTrue(rows.contains("struct LibraryFolderGlyph: Shape"))
        XCTAssertTrue(rows.contains(".environment(\\.profileCardOutlined, true)"), "the panel's column outlines its cards")
        let components = try source("App/Profile/ProfileComponents.swift")
        XCTAssertTrue(components.contains("if outlined { shape.strokeBorder(Theme.hairline"))
        XCTAssertGreaterThan(PhonePanelMetrics.cardOutline, 0)
    }
}
