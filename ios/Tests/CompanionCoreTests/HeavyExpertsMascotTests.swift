// #5487 / M-20261127-178 (phone lot of #5476 / PR #5484): every expert of a
// Heavy run is the conversation's bot, duplicated, drawn as the chat header
// draws it (`ChatAvatarView` / `BotMascotView` with the bot unchanged) in the
// row and in the Thoughts sheet. Never a colour per expert, an owl or a
// generic shape. The views live in the app target, so these checks read its
// sources, as BotProfileAppearanceRowTests and ModeMenuCascadeLayoutTests do.
import Foundation
import XCTest

final class HeavyExpertsMascotTests: XCTestCase {
    private func source(_ path: String) throws -> String {
        let ios = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try String(contentsOf: ios.appendingPathComponent(path), encoding: .utf8)
    }

    func testHeavyRowNeverGivesExpertsTheirOwnColourOrOwl() throws {
        let row = try source("App/Features/Chat/HeavyTeamRowView.swift")
        // the old AGENT_COLORS pile is gone (desktop removed it in #5484)
        XCTAssertFalse(row.contains("expertColors"), "no colour per expert")
        XCTAssertFalse(row.contains("AGENT_COLORS"), "no cite of the desktop's retired AGENT_COLORS")
        XCTAssertFalse(row.contains("OwlMascotView"), "experts are never an owl of their own")
        // every expert is the conversation as the header draws it
        XCTAssertTrue(row.contains("ExpertAvatarView") || row.contains("ChatAvatarView(chat:"), "experts use the conversation avatar")
        XCTAssertTrue(row.contains("struct ExpertAvatarView") || row.contains("ChatAvatarView(chat: chat"), "one expert avatar shared by the row and Thoughts")
    }

    func testHeavyThoughtsSheetDrawsTheConversationAvatarPerExpert() throws {
        let row = try source("App/Features/Chat/HeavyTeamRowView.swift")
        // Thoughts used to paint OwlMascotView(color: expertColors[index]) in each section header
        let thoughts = try XCTUnwrap(
            row.range(of: "struct HeavyThoughtsSheet"),
            "HeavyThoughtsSheet is gone"
        )
        let sheet = String(row[thoughts.lowerBound...])
        XCTAssertFalse(sheet.contains("OwlMascotView"), "Thoughts never draws an owl per expert")
        XCTAssertFalse(sheet.contains("expertColors"), "Thoughts never paints a colour per expert")
        // the sheet receives the conversation so each expert is that bot
        XCTAssertTrue(sheet.contains("let chat: Chat") || sheet.contains("var chat: Chat"), "Thoughts gets the conversation")
        XCTAssertTrue(
            sheet.contains("ExpertAvatarView") || sheet.contains("ChatAvatarView(chat:"),
            "each expert in Thoughts is the conversation avatar"
        )
        // the row opens the sheet with the same chat
        XCTAssertTrue(row.contains("HeavyThoughtsSheet(line: line, chat:"), "the row passes chat into Thoughts")
    }

    func testHeavyOrbitExpertsAreTheConversationAvatar() throws {
        let row = try source("App/Features/Chat/HeavyTeamRowView.swift")
        let orbit = try XCTUnwrap(row.range(of: "struct HeavyOrbitView"), "HeavyOrbitView is gone")
        let body = String(row[orbit.lowerBound...])
        // the orbit's experts used to be OwlMascotView(color: expertColors[index])
        XCTAssertFalse(body.contains("OwlMascotView"), "orbit experts are never owls of their own")
        XCTAssertTrue(
            body.contains("ExpertAvatarView") || body.contains("ChatAvatarView(chat:"),
            "orbit experts are the conversation avatar"
        )
    }

    func testHeavyGalleryUsesTheRealRowAndNoExpertColourPile() throws {
        let gallery = try source("App/Mascots/HeavyTeamGallery.swift")
        XCTAssertTrue(gallery.contains("HeavyTeamRowView(line:"), "gallery draws the real row")
        XCTAssertFalse(gallery.contains("expertColors"), "gallery invents no colour pile")
        XCTAssertFalse(gallery.contains("OwlMascotView"), "gallery invents no owl per expert")
        XCTAssertFalse(gallery.contains("AGENT_COLORS"), "gallery does not cite AGENT_COLORS")
    }
}
