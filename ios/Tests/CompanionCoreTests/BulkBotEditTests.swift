// Edit N bots from the home selection: the mirror of shared/bulk-bot-edit.ts
// and the bot-by-bot runner (partial results, undo).
import Foundation
import XCTest
@testable import CompanionCore

final class BulkBotEditTests: XCTestCase {
    // MARK: Lists

    func testAddKeepsOrderAndAppendsWhatIsMissing() {
        XCTAssertEqual(BulkBotEdit.applyListEdit(["a", "b"], BulkListEdit(mode: .add, items: ["b", "c", "c"])), ["a", "b", "c"])
    }

    func testRemoveDropsTheItems() {
        XCTAssertEqual(BulkBotEdit.applyListEdit(["a", "b", "c"], BulkListEdit(mode: .remove, items: ["b", "z"])), ["a", "c"])
    }

    func testReplaceIsExactlyTheItemsDeduplicated() {
        XCTAssertEqual(BulkBotEdit.applyListEdit(["a"], BulkListEdit(mode: .replace, items: ["c", "b", "c"])), ["c", "b"])
        XCTAssertFalse(BulkBotEdit.listEditChanges(["a", "b"], BulkListEdit(mode: .add, items: ["a"])))
        XCTAssertTrue(BulkBotEdit.listEditChanges(["a", "b"], BulkListEdit(mode: .replace, items: ["b", "a"])))
    }

    func testReplaceStartsFromTheItemsEveryBotHas() {
        XCTAssertEqual(BulkBotEdit.commonListItems([["a", "b", "c"], ["c", "a"], ["a", "c", "d"]]), ["a", "c"])
        XCTAssertEqual(BulkBotEdit.commonListItems([]), [])
    }

    func testABotWithoutItsOwnMcpListStartsFromEveryEnabledServer() {
        let edit = BulkListEdit(mode: .remove, items: ["docs"])
        XCTAssertEqual(BulkBotEdit.mcpServersAfter(nil, enabled: ["docs", "git", "web"], edit), ["git", "web"])
        XCTAssertEqual(BulkBotEdit.mcpServersAfter(["docs"], enabled: ["docs", "git"], edit), [])
    }

    // MARK: Mixed values

    func testCommonValueOrEachBotsOwn() {
        let same = BulkBotEdit.commonValue([
            BulkBotValue(botId: "1", value: BulkValue.object(["model": .string("m"), "instanceId": .string("i")])),
            BulkBotValue(botId: "2", value: BulkValue.object(["instanceId": .string("i"), "model": .string("m")])),
        ])
        XCTAssertFalse(same.isMixed, "key order does not matter")

        let mixed = BulkBotEdit.commonValue([
            BulkBotValue(botId: "1", value: BulkValue.string("ask")),
            BulkBotValue(botId: "2", value: BulkValue.string("full")),
        ])
        guard case let .mixed(rows) = mixed else { return XCTFail("expected mixed values") }
        XCTAssertEqual(rows.map(\.botId), ["1", "2"])
        XCTAssertEqual(rows.map(\.value), [.string("ask"), .string("full")])

        XCTAssertFalse(BulkBotEdit.commonValue([BulkBotValue<BulkValue>(botId: "1", value: nil), BulkBotValue(botId: "2", value: .null)]).isMixed,
                       "absent and null are both not set")
    }

    func testSnapshotSpellsOutTheDefaults() {
        let atlas = Bot.bulkFixture(id: "b1", name: "Atlas")
        let snapshot = BulkBotField.snapshot(atlas)
        XCTAssertEqual(snapshot["browser"], .bool(true))
        XCTAssertEqual(snapshot["speakReplies"], .bool(false))
        XCTAssertEqual(snapshot["voice"], .string(""))
        XCTAssertEqual(snapshot["computer"], .null)
        XCTAssertEqual(snapshot["mcpServers"], .null)
        XCTAssertEqual(snapshot["approvalMode"], .string("ask"))
    }

    // MARK: Patches

    func testPatchForBotSendsOnlyWhatDiffers() {
        let bot: BulkPatch = ["voice": .string("v1"), "notifications": .bool(true)]
        XCTAssertEqual(BulkBotEdit.patchForBot(bot, ["voice": .string("v1"), "notifications": .bool(false)]), ["notifications": .bool(false)])
        XCTAssertEqual(BulkBotEdit.patchForBot(bot, ["voice": .string("v1"), "confirmFullAccess": .bool(true)]), [:],
                       "a consent alone is no change")
    }

    func testFullAccessCarriesItsConfirmation() {
        let atlas = Bot.bulkFixture(id: "b1", name: "Atlas")
        let patch = BulkBotEditPlan(fields: ["approvalMode": .string("full")]).patch(for: atlas, enabledServers: [])
        XCTAssertEqual(patch["approvalMode"], .string("full"))
        XCTAssertEqual(patch["confirmFullAccess"], .bool(true))
        XCTAssertNil(BulkBotEditPlan(fields: ["approvalMode": .string("auto")]).patch(for: atlas, enabledServers: [])["confirmFullAccess"])
    }

    func testPlanPatchIncludesTheMcpListTheBotEndsWith() {
        let atlas = Bot.bulkFixture(id: "b1", name: "Atlas")
        let plan = BulkBotEditPlan(mcpServers: BulkListEdit(mode: .add, items: ["git"]))
        XCTAssertEqual(plan.patch(for: atlas, enabledServers: ["docs"])["mcpServers"], .strings(["docs", "git"]))
        XCTAssertEqual(plan.patch(for: atlas, enabledServers: ["docs", "git"]), [:], "already mounted: nothing to send")
    }

    func testRevertPatchPutsBackEachFieldOrNull() {
        let before: BulkPatch = ["voice": .string("v1")]
        let patch: BulkPatch = ["voice": .string("v2"), "computer": .string("off"), "confirmFullAccess": .bool(true)]
        XCTAssertEqual(BulkBotEdit.revertPatch(before, patch), ["voice": .string("v1"), "computer": .null])
    }

    func testEncodedPatchIsPlainJson() throws {
        let data = try JSONEncoder().encode(["mcpServers": BulkValue.null, "browser": .bool(false)] as BulkPatch)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertTrue(json["mcpServers"] is NSNull)
        XCTAssertEqual(json["browser"] as? Bool, false)
        XCTAssertEqual(BulkValue.encoding(ModelSelection(instanceId: "i", model: "m")).stableKey, #"{"instanceId":"i","model":"m"}"#)
    }

    // MARK: Grants

    func testGrantStepsKeepEachChosenLevel() {
        let current = [BotGrantRecord(target: "user:a", level: .use), BotGrantRecord(target: "team:t", level: .edit)]
        let add = BulkBotEdit.grantSteps(current, .add, [BotGrantRecord(target: "user:a", level: .run), BotGrantRecord(target: "user:b", level: .use)])
        XCTAssertEqual(add.put, [BotGrantRecord(target: "user:a", level: .run), BotGrantRecord(target: "user:b", level: .use)])
        XCTAssertEqual(add.remove, [])

        let remove = BulkBotEdit.grantSteps(current, .remove, [BotGrantRecord(target: "team:t", level: .use), BotGrantRecord(target: "user:z", level: .use)])
        XCTAssertEqual(remove, BulkGrantSteps(put: [], remove: ["team:t"]))

        let replace = BulkBotEdit.grantSteps(current, .replace, [BotGrantRecord(target: "team:t", level: .edit)])
        XCTAssertEqual(replace, BulkGrantSteps(put: [], remove: ["user:a"]))
    }

    func testGrantRevertStepsPutTheGrantsBack() {
        let before = [BotGrantRecord(target: "user:a", level: .use), BotGrantRecord(target: "team:t", level: .edit)]
        let after = [BotGrantRecord(target: "user:a", level: .run), BotGrantRecord(target: "user:b", level: .use)]
        let revert = BulkBotEdit.grantRevertSteps(before: before, after: after)
        XCTAssertEqual(revert.put, before)
        XCTAssertEqual(revert.remove, ["user:b"])
    }

    // MARK: Summary and counts

    func testSummaryLine() {
        let text = BulkSummary.text(botCount: 4, botsWord: { "\($0) bots" }, lines: [
            BulkSummaryLine(field: "Model", value: "X"), BulkSummaryLine(field: "Voice", value: "Y"),
        ])
        XCTAssertEqual(text, "4 bots · Model → X · Voice → Y")
        XCTAssertEqual(BulkSummary.listValue(BulkListEdit(mode: .remove, items: ["git"]), label: { $0 }, none: "nothing"), "- git")
    }

    func testOutcomeCounts() {
        let counts = BulkBotEdit.outcomeCounts([
            BulkBotOutcome(botId: "1", ok: true),
            BulkBotOutcome(botId: "2", ok: true, skipped: true),
            BulkBotOutcome(botId: "3", ok: false, reasons: ["no"]),
        ])
        XCTAssertEqual(counts, BulkOutcomeCounts(ok: 1, failed: 1, skipped: 1))
    }

    // MARK: Runner

    func testPartialResultEachBotForItsOwnReasons() async {
        let api = FakeBulkAPI()
        api.refusePatch["b2"] = "The model is not available to this bot."
        let bots = [
            Bot.bulkFixture(id: "b1", name: "Atlas"),
            Bot.bulkFixture(id: "b2", name: "Nova"),
            Bot.bulkFixture(id: "b3", name: "Orion", voice: "v2"),
        ]
        let plan = BulkBotEditPlan(fields: ["voice": .string("v2")])
        let result = await BulkBotEditRunner.apply(plan, bots: bots, enabledServers: [], api: api, reason: Self.reason)
        XCTAssertEqual(result.outcomes.map(\.ok), [true, false, true])
        XCTAssertEqual(result.outcomes[1].reasons, ["The model is not available to this bot."])
        XCTAssertTrue(result.outcomes[2].skipped, "Orion already has that voice")
        XCTAssertEqual(api.calls, [#"PATCH b1 {"voice":"v2"}"#, #"PATCH b2 {"voice":"v2"}"#])
        XCTAssertEqual(result.undo.map(\.botId), ["b1"])
        XCTAssertEqual(result.undo.first?.patch, ["voice": .string("")])
    }

    func testGrantsThenUndo() async {
        let api = FakeBulkAPI()
        api.grants["b1"] = [BotGrantRecord(target: "user:a", level: .use)]
        let plan = BulkBotEditPlan(
            grants: BulkGrantEdit(mode: .replace, items: [BotGrantRecord(target: "user:b", level: .run)])
        )
        let atlas = Bot.bulkFixture(id: "b1", name: "Atlas")
        let result = await BulkBotEditRunner.apply(plan, bots: [atlas], enabledServers: [], api: api, reason: Self.reason)
        XCTAssertEqual(result.outcomes.first?.ok, true)
        XCTAssertEqual(api.grants["b1"], [BotGrantRecord(target: "user:b", level: .run)])

        let undone = await BulkBotEditRunner.undo(result.undo, api: api, reason: Self.reason)
        XCTAssertEqual(undone.outcomes.first?.ok, true)
        XCTAssertEqual(api.grants["b1"], [BotGrantRecord(target: "user:a", level: .use)])
    }

    func testUndoOfFullAccessSendsItsConfirmation() async {
        let api = FakeBulkAPI()
        let undo = BulkBotUndo(botId: "b1", patch: ["approvalMode": .string("full")])
        _ = await BulkBotEditRunner.undo([undo], api: api, reason: Self.reason)
        XCTAssertEqual(api.calls, [#"PATCH b1 {"applyToAllThreads":true,"approvalMode":"full","confirmFullAccess":true}"#])
    }

    // #1674: a bot with several threads refused a model that named none.
    // The change is the bot's own, as Edit bot makes it: it names the bot's
    // thread, on Apply and on undo; a change without a model names none.
    func testANewModelNamesEachBotsThreadOnApplyAndUndo() async {
        let api = FakeBulkAPI()
        let model = BulkValue.object(["instanceId": .string("claude"), "model": .string("other")])
        let plan = BulkBotEditPlan(fields: ["modelSelection": model, "speakReplies": .bool(true)])
        let bots = [Bot.bulkFixture(id: "b1", name: "Atlas"), Bot.bulkFixture(id: "b2", name: "Iris")]
        let result = await BulkBotEditRunner.apply(plan, bots: bots, enabledServers: [], api: api, reason: Self.reason)
        XCTAssertEqual(result.outcomes.map(\.ok), [true, true])
        XCTAssertEqual(api.calls, [
            #"PATCH b1 {"modelSelection":{"instanceId":"claude","model":"other"},"speakReplies":true,"threadId":"t-b1"}"#,
            #"PATCH b2 {"modelSelection":{"instanceId":"claude","model":"other"},"speakReplies":true,"threadId":"t-b2"}"#,
        ])
        let undoAPI = FakeBulkAPI()
        _ = await BulkBotEditRunner.undo(result.undo, api: undoAPI, reason: Self.reason)
        XCTAssertEqual(undoAPI.calls.count, 2)
        XCTAssertTrue(undoAPI.calls.allSatisfy { $0.contains(#""threadId":"t-b"#) }, "\(undoAPI.calls)")
        XCTAssertEqual(BulkBotEdit.withConsents(["voice": .string("ava"), "threadId": .string("draft")], threadId: "t-b1"), ["voice": .string("ava")])
    }

    private static let reason: @Sendable (Error) -> String = { error in
        (error as? APIError)?.errorDescription ?? "failed"
    }
}

private final class FakeBulkAPI: BulkBotEditAPI, @unchecked Sendable {
    var refusePatch: [String: String] = [:]
    var grants: [String: [BotGrantRecord]] = [:]
    private(set) var calls: [String] = []

    func patchBotFields(botId: String, patch: BulkPatch) async throws -> Bot {
        calls.append("PATCH \(botId) \(BulkValue.object(patch).stableKey)")
        if let message = refusePatch[botId] { throw APIError.status(code: 400, message: message) }
        return Bot.bulkFixture(id: botId, name: botId)
    }

    private func answer(_ botId: String) throws -> BotGrants {
        let rows = (grants[botId] ?? []).map { #"{"target":"\#($0.target)","level":"\#($0.level.rawValue)"}"# }
        return try JSONDecoder().decode(BotGrants.self, from: Data(#"{"grants":[\#(rows.joined(separator: ","))]}"#.utf8))
    }

    func botGrants(botId: String) async throws -> BotGrants { try answer(botId) }

    func putGrant(botId: String, target: String, level: GrantLevel) async throws -> BotGrants {
        var list = grants[botId] ?? []
        if let index = list.firstIndex(where: { $0.target == target }) { list[index].level = level } else { list.append(BotGrantRecord(target: target, level: level)) }
        grants[botId] = list
        return try answer(botId)
    }

    func removeGrant(botId: String, target: String) async throws -> BotGrants {
        grants[botId]?.removeAll { $0.target == target }
        return try answer(botId)
    }

}

private extension Bot {
    static func bulkFixture(id: String, name: String, voice: String? = nil) -> Bot {
        let voiceField = voice.map { #","voice":"\#($0)""# } ?? ""
        let json = #"{"id":"\#(id)","threadId":"t-\#(id)","name":"\#(name)","title":"","description":"","notifications":true,"color":"blue","unread":false,"modelSelection":{"instanceId":"claude","model":"default"},"createdAt":0\#(voiceField)}"#
        return try! JSONDecoder().decode(Bot.self, from: Data(json.utf8))
    }
}
