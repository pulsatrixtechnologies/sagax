@testable import CompanionCore
import Foundation
import XCTest

/// #4250 / #4305: the desktop gained a typed `perspicax` trigger source
/// ("When something changes in a product"). The phone names it, reads it
/// when it rides under `sourceNext`, shows a routine that starts that way
/// in the desktop's words and saves it with its watched resources.
final class ParityProductTriggerTests: XCTestCase {
    private var root: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    }

    private func desktopEnglish() throws -> [String: String] {
        let data = try Data(contentsOf: root.appendingPathComponent("src/locales/en.json"))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: String])
    }

    /// Every source type of `TRIGGER_SOURCE_TYPES` has a phone label: a
    /// brand as written, or the desktop's `triggers.source.<type>` words.
    func testEveryDesktopSourceTypeIsNamedOnThePhone() throws {
        let text = try String(contentsOf: root.appendingPathComponent("shared/trigger-sources.ts"), encoding: .utf8)
        let block = try XCTUnwrap(text.range(of: #"TRIGGER_SOURCE_TYPES = \[[^\]]*\]"#, options: .regularExpression).map { String(text[$0]) })
        let regex = try NSRegularExpression(pattern: #""([a-z]+)""#)
        let types = regex.matches(in: block, range: NSRange(block.startIndex..., in: block)).compactMap { Range($0.range(at: 1), in: block).map { String(block[$0]) } }
        XCTAssertTrue(types.contains("perspicax"))
        let english = try desktopEnglish()
        for type in types {
            XCTAssertNotEqual(WebhookPublicURL.sourceLabel(type), type, type)
            if WebhookPublicURL.isTranslatedSource(type) {
                XCTAssertEqual(english["triggers.source.\(type)"], WebhookPublicURL.sourceLabel(type), type)
            }
        }
    }

    func testResourceChangedIsNamed() {
        XCTAssertEqual(WebhookPublicURL.eventLabel("resource.changed"), "Resource changed")
        XCTAssertEqual(WebhookPublicURL.sourceLabel("perspicax"), "Product change")
    }

    /// The server sends a newer source under `sourceNext` (webhookForApp):
    /// this build reads it as its typed source, as webhookFromServer does.
    func testSourceNextIsReadAsTheSource() throws {
        let json = #"{"id":"w1","name":"","botId":"b1","enabled":true,"deliveryCount":2,"sourceNext":{"type":"perspicax","events":["resource.changed"],"filters":{"resource":["perspicax://cw/boards/12/open"]}}}"#
        let hook = try JSONDecoder().decode(WebhookListing.self, from: Data(json.utf8))
        XCTAssertEqual(hook.sourceType, "perspicax")
        XCTAssertEqual(hook.sourceEvents, ["resource.changed"])
        XCTAssertEqual(hook.sourceFilters, "resource: perspicax://cw/boards/12/open")
    }

    private func productSchedule() throws -> RoutineSchedule {
        let json = #"{"type":"event","source":"perspicax","resources":["perspicax://cw/boards/12/open","perspicax://cw/tickets/*"]}"#
        return try JSONDecoder().decode(RoutineSchedule.self, from: Data(json.utf8))
    }

    func testAProductRoutineOpensAsProductAndSavesItsResources() throws {
        let schedule = try productSchedule()
        XCTAssertTrue(schedule.isProductEvent)
        let form = RoutineScheduleForm(schedule: schedule, seedAt: Date())
        XCTAssertEqual(form.recurrence, .product)
        XCTAssertEqual(form.productResources, "perspicax://cw/boards/12/open\nperspicax://cw/tickets/*")
        XCTAssertFalse(form.scheduleChanged)
        XCTAssertNil(form.problem)
        let saved = try form.schedule(savedAt: Date())
        XCTAssertTrue(RoutinePatch.sameSchedule(saved, schedule))
        let body = RoutinePatch.scheduleBody(saved)
        XCTAssertEqual(body["type"] as? String, "event")
        XCTAssertEqual(body["source"] as? String, "perspicax")
        XCTAssertEqual(body["resources"] as? [String], ["perspicax://cw/boards/12/open", "perspicax://cw/tickets/*"])
        XCTAssertNil(body["timing"])
    }

    func testWatchedResourcesAreCheckedAsTheDesktopDoes() throws {
        var form = RoutineScheduleForm(schedule: try productSchedule(), seedAt: Date())
        form.productResources = "perspicax://cw/boards/{board}/open"
        XCTAssertEqual(form.problem, .productResources)
        form.productResources = "https://example.test/x"
        XCTAssertEqual(form.problem, .productResources)
        form.productResources = "  "
        XCTAssertEqual(form.problem, .productResources)
        XCTAssertThrowsError(try form.schedule(savedAt: Date()))
        form.productResources = "perspicax://a, perspicax://a\nperspicax://b"
        XCTAssertNil(form.problem)
        XCTAssertTrue(form.scheduleChanged)
        XCTAssertEqual(try form.schedule(savedAt: Date()).resources, ["perspicax://a", "perspicax://b"])
        form.productResources = "perspicax://a\nperspicax://b"
        form.addProductResource("perspicax://b")
        form.addProductResource("perspicax://c")
        XCTAssertEqual(RoutineScheduleForm.productURIs(form.productResources), ["perspicax://a", "perspicax://b", "perspicax://c"])
    }

    func testProductChoiceIsOfferedOnALinkedServerOrWhenTheRoutineHasIt() {
        XCTAssertFalse(RoutineEditorRules.repeatChoices(current: .daily, teamGoal: false).contains(.product))
        XCTAssertTrue(RoutineEditorRules.repeatChoices(current: .daily, teamGoal: false, productLinked: true).contains(.product))
        XCTAssertFalse(RoutineEditorRules.repeatChoices(current: .daily, teamGoal: true, productLinked: true).contains(.product))
        XCTAssertTrue(RoutineEditorRules.repeatChoices(current: .product, teamGoal: false).contains(.product))
        XCTAssertTrue(RoutineRecurrence.product.isTrigger)
        XCTAssertFalse(RoutineRecurrence.product.repeatsOnClock)
    }

    func testAGithubRoutineKeepsItsEventsAndFilters() throws {
        let json = #"{"type":"event","source":"github","events":["issue.opened"],"filters":{"repo":["acme/app"]}}"#
        let schedule = try JSONDecoder().decode(RoutineSchedule.self, from: Data(json.utf8))
        let body = RoutinePatch.scheduleBody(schedule)
        XCTAssertEqual(body["events"] as? [String], ["issue.opened"])
        XCTAssertEqual(body["filters"] as? [String: [String]], ["repo": ["acme/app"]])
    }

    func testWatchableResourcesAreReadAsTheDesktopReadsThem() {
        let json = #"{"available":true,"resources":[{"uri":"perspicax://cw/boards/12/open","name":" Open tickets "},{"uri":"perspicax://cw/boards/{board}/open","template":true},{"uri":"https://example.test"}]}"#
        let list = WatchableResource.list(from: Data(json.utf8))
        XCTAssertEqual(list, [
            WatchableResource(uri: "perspicax://cw/boards/12/open", name: "Open tickets"),
            WatchableResource(uri: "perspicax://cw/boards/{board}/open", template: true),
        ])
        XCTAssertEqual(WatchableResource.list(from: Data(#"{"available":false,"resources":[]}"#.utf8)), [])
    }
}
