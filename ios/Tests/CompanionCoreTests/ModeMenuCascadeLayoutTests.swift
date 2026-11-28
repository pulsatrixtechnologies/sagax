// #5338: on iPhone and iPad the composer's mode menu keeps its root on
// screen; Reasoning and All models open as the system's nested menus, never
// as a page that replaces the menu with a back row (docs/model-modes.md).
import Foundation
import XCTest

final class ModeMenuCascadeLayoutTests: XCTestCase {
    private func source(_ path: String) throws -> String {
        let ios = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try String(contentsOf: ios.appendingPathComponent(path), encoding: .utf8)
    }

    private func member(_ text: String, from start: String) throws -> String {
        let begin = try XCTUnwrap(text.range(of: start), "\(start) is gone")
        let rest = text[begin.upperBound...]
        let end = ["\n    private var ", "\n    private func ", "\n    @ViewBuilder\n    private var ", "\n    // MARK: "]
            .compactMap { rest.range(of: $0)?.lowerBound }.min() ?? rest.endIndex
        return String(rest[..<end])
    }

    func testPhoneModeMenuUsesNestedMenusNotReplacedPages() throws {
        let sheet = try source("App/Features/Chat/ModelMenuSheet.swift")
        let modes = try member(sheet, from: "private var modes: some View {")
        XCTAssertTrue(modes.contains("ComposerCascadeReasoning"), "Reasoning opens as a nested menu")
        XCTAssertTrue(modes.contains("ComposerCascadeAllModels"), "All models opens as a nested menu")
        XCTAssertFalse(modes.contains("panel = .reasoning"), "Reasoning must not replace the menu")
        XCTAssertFalse(modes.contains("panel = .providers"), "All models must not replace the menu")
        XCTAssertFalse(modes.contains("pageButton"), "the cascade rows are menus, not page buttons")
        // the composer path no longer swaps the whole list for a back panel
        let menu = try member(sheet, from: "private var menu: some View {")
        XCTAssertFalse(menu.contains("ComposerMenuPanel"), "no replaced-page panel in the composer menu")
        XCTAssertFalse(menu.contains("panel != .root"), "the root modes stay on screen")
    }

    func testIPadModeMenuUsesNestedMenusNotReplacedPages() throws {
        let desktop = try source("App/Desktop/DesktopModelMenu.swift")
        let body = try member(desktop, from: "var body: some View {")
        XCTAssertTrue(body.contains("modesPage") || desktop.contains("ComposerCascadeAllModels"))
        XCTAssertFalse(body.contains("panel == .root"), "no panel switch that hides the modes")
        XCTAssertFalse(body.contains("ComposerMenuPanel"), "no replaced-page panel on iPad")
        let modes = try member(desktop, from: "private var modesPage: some View {")
        XCTAssertTrue(modes.contains("ComposerCascadeReasoning"), "Effort opens as a nested menu")
        XCTAssertTrue(modes.contains("ComposerCascadeAllModels"), "Custom opens as a nested menu")
        XCTAssertTrue(modes.contains("Text(\"Custom\")") || modes.contains("\"Custom\""), "Custom row, not All models")
        XCTAssertTrue(modes.contains("Text(\"Effort\")") || modes.contains("\"Effort\""), "Effort, one name")
        XCTAssertFalse(modes.contains("Text(\"All models\")"), "no All models row on the root")
        XCTAssertFalse(modes.contains("Text(\"Providers\")"), "no Providers footer")
        XCTAssertFalse(modes.contains("panel = .reasoning"))
        XCTAssertFalse(modes.contains("panel = .providers"))
        XCTAssertTrue(desktop.contains("static let width: CGFloat = 280"), "MODE_MENU_WIDTH")
    }

    func testCascadeShellLivesBesideTheSharedChrome() throws {
        let chrome = try source("App/Features/Chat/ModelMenuChrome.swift")
        XCTAssertTrue(chrome.contains("struct ComposerCascadeAllModels"), "one shell for Custom / All models on phone and iPad")
        XCTAssertTrue(chrome.contains("struct ComposerCascadeReasoning"), "one shell for Effort / Reasoning on phone and iPad")
        XCTAssertTrue(chrome.contains("Menu {"), "the system's nested menus")
        XCTAssertTrue(chrome.contains("onManage"), "Manage models under Custom on iPad")
        // a provider with one account skips the account level
        XCTAssertTrue(chrome.contains("ComposerModes.open"), "single-account providers open on their models")
    }

    /// #5529: the iPad composer chip opens DesktopModelMenu (280 px), not the
    /// phone ModelMenuSheet and not the retired 880 pt DesktopModelPicker.
    func testIPadComposerChipOpensDesktopModeMenu() throws {
        let composer = try source("App/Desktop/DesktopComposer.swift")
        let chip = try member(composer, from: "private var modelChip: some View {")
        XCTAssertTrue(chip.contains("openModel()"), "chip opens the shell's mode menu")
        XCTAssertFalse(chip.contains("ModelMenuSheet"), "phone sheet stays off the iPad chip")
        XCTAssertFalse(chip.contains("modelMenuOpen"), "no local sheet state")
        let shell = try source("App/Desktop/DesktopShell.swift")
        XCTAssertTrue(shell.contains("DesktopModelMenu("), "shell hosts the 280 px menu")
        XCTAssertFalse(shell.contains("DesktopModelPicker("), "old dialog is gone from the shell")
    }
}
