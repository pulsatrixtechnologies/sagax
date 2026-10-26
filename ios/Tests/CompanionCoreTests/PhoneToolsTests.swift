import XCTest
@testable import CompanionCore

final class PhoneToolsTests: XCTestCase {
    private func request(_ json: String) throws -> PhoneToolRequest {
        try JSONDecoder().decode(PhoneToolRequest.self, from: Data(json.utf8))
    }

    private func wire(tool: String, args: String = "{}", allowAlways: Bool = true, preApproved: Bool = false, expiresAt: Double = 4_000_000_000_000) throws -> PhoneToolRequest {
        try request(#"{"id":"r1","tool":"\#(tool)","args":\#(args),"access":"read","botId":"b1","botName":"Wren","threadId":"t1","allowAlways":\#(allowAlways),"preApproved":\#(preApproved),"createdAt":1,"expiresAt":\#(expiresAt)}"#)
    }

    func testDecodesARequestAndAnUnknownTool() throws {
        let known = try wire(tool: "contacts", args: #"{"query":"Marie","fields":["phone"],"reason":"appeler"}"#)
        XCTAssertEqual(known.tool, .contacts)
        XCTAssertEqual(known.string("query"), "Marie")
        XCTAssertEqual(known.reason, "appeler")
        let unknown = try wire(tool: "teleport")
        XCTAssertNil(unknown.tool)
        XCTAssertEqual(PhoneToolRules.choices(for: unknown), [.deny])
    }

    func testTheCardOffersRefuserToujoursPermettreUneFois() throws {
        XCTAssertEqual(PhoneToolRules.choices(for: try wire(tool: "location")), [.deny, .always, .once])
        XCTAssertEqual(PhoneToolRules.choices(for: try wire(tool: "location", allowAlways: false)), [.deny, .once])
        // never Toujours permettre for a shortcut, the clipboard or photos, whatever the server says
        XCTAssertEqual(PhoneToolRules.choices(for: try wire(tool: "shortcut")), [.deny, .once])
        XCTAssertEqual(PhoneToolRules.choices(for: try wire(tool: "clipboard")), [.deny, .once])
        XCTAssertEqual(PhoneToolRules.decision(.always), .always)
    }

    func testAGrantRunsWithoutACardOnlyWithTheAppOpen() throws {
        let granted = try wire(tool: "status", preApproved: true)
        XCTAssertTrue(PhoneToolRules.runsWithoutCard(granted, appActive: true, offered: [.status]))
        XCTAssertFalse(PhoneToolRules.runsWithoutCard(granted, appActive: false, offered: [.status]))
        XCTAssertFalse(PhoneToolRules.runsWithoutCard(granted, appActive: true, offered: [.location]))
        XCTAssertFalse(PhoneToolRules.runsWithoutCard(try wire(tool: "status"), appActive: true, offered: [.status]))
        XCTAssertFalse(PhoneToolRules.runsWithoutCard(try wire(tool: "clipboard", preApproved: true), appActive: true, offered: [.clipboard]))
        let expired = try wire(tool: "status", preApproved: true, expiresAt: 1_000)
        XCTAssertFalse(PhoneToolRules.runsWithoutCard(expired, appActive: true, offered: [.status]))
        XCTAssertTrue(PhoneToolRules.isExpired(expired))
    }

    func testOfferedFollowsTheSwitches() {
        XCTAssertEqual(PhoneToolRules.offered(disabled: []), PhoneTool.allCases)
        XCTAssertFalse(PhoneToolRules.offered(disabled: ["clipboard"]).contains(.clipboard))
    }

    func testContactsCarryOnlyTheFieldsAskedForUpToTheLimit() throws {
        let ask = try wire(tool: "contacts", args: #"{"query":"Marie","fields":["phone"],"limit":1}"#)
        let found = [
            PhoneContact(name: "Marie Tremblay", phones: ["+1 514 555 0101"], emails: ["marie@example.com"], birthday: "1990-01-02"),
            PhoneContact(name: "Marie Roy", phones: ["+1 514 555 0102"]),
        ]
        XCTAssertEqual(PhoneToolShaping.contacts(found, for: ask), .object(["contacts": .array([.object(["name": .string("Marie Tremblay"), "phones": .array([.string("+1 514 555 0101")])])])]))
        let defaults = try wire(tool: "contacts", args: #"{"query":"Marie"}"#)
        XCTAssertEqual(PhoneToolShaping.requestedFields(defaults), ["phone", "email"])
    }

    func testLocationIsRoundedUnlessPrecise() {
        let at = Date(timeIntervalSince1970: 0)
        let coarse = PhoneToolShaping.location(latitude: 45.5016889, longitude: -73.567256, accuracy: 5, at: at, precise: false)
        XCTAssertEqual(coarse.object?["latitude"], .number(45.502))
        XCTAssertEqual(coarse.object?["accuracyMeters"], .number(100))
        let precise = PhoneToolShaping.location(latitude: 45.5016889, longitude: -73.567256, accuracy: 5, at: at, precise: true)
        XCTAssertEqual(precise.object?["latitude"], .number(45.501689))
    }

    func testRemindersEventsClipboardAndPhotos() {
        let due = Date(timeIntervalSince1970: 1_800_000_000)
        let list = PhoneToolShaping.reminders([PhoneReminder(title: "Pain", due: due, list: "Épicerie"), PhoneReminder(title: "Lait")], limit: 1)
        XCTAssertEqual(list.object?["reminders"]?.array?.count, 1)
        let events = PhoneToolShaping.events([
            PhoneEvent(title: "B", start: due.addingTimeInterval(60), end: due.addingTimeInterval(120)),
            PhoneEvent(title: "A", start: due, end: due.addingTimeInterval(60)),
        ], limit: nil)
        XCTAssertEqual(events.object?["events"]?.array?.first?.object?["title"], .string("A"))
        XCTAssertEqual(PhoneToolShaping.clipboard(nil), .object(["empty": .bool(true)]))
        XCTAssertEqual(PhoneToolShaping.clipboard(String(repeating: "a", count: 5_000)).object?["text"]?.string?.count, 4_000)
        let photos = PhoneToolShaping.photos([Data([1]), Data([2]), Data([3]), Data([4])], max: 9)
        XCTAssertEqual(photos.object?["images"]?.array?.count, 3)
        XCTAssertEqual(PhoneToolShaping.scaledSize(width: 4_000, height: 3_000).width, 1_280)
        XCTAssertEqual(PhoneToolShaping.scaledSize(width: 800, height: 600).width, 800)
    }

    func testStatusAndShortcutURL() {
        let status = PhoneToolShaping.status(batteryLevel: 0.456, batteryState: "charging", lowPowerMode: false, network: (status: "satisfied", type: "wifi", expensive: false, constrained: false), focused: nil)
        XCTAssertEqual(status.object?["battery"]?.object?["level"], .number(0.46))
        XCTAssertNil(status.object?["focus"])
        let url = PhoneToolShaping.shortcutURL(name: "Café du matin", input: "double")
        XCTAssertEqual(url?.scheme, "shortcuts")
        XCTAssertEqual(url?.host, "run-shortcut")
        XCTAssertTrue(url?.absoluteString.contains("name=Caf%C3%A9%20du%20matin") == true)
    }

    func testDatesTheBotSends() {
        XCTAssertNotNil(PhoneToolShaping.date("2026-10-21T09:00:00Z"))
        XCTAssertNotNil(PhoneToolShaping.date("2026-10-21T09:00:00.000-04:00"))
        XCTAssertNotNil(PhoneToolShaping.date("2026-10-21"))
        XCTAssertNil(PhoneToolShaping.date("demain"))
    }

    func testAnAnswerEncodesForTheServer() throws {
        let answer = PhoneToolAnswer(decision: .once, result: .object(["started": .bool(true)]))
        let body = try JSONSerialization.jsonObject(with: JSONEncoder().encode(answer)) as? [String: Any]
        XCTAssertEqual(body?["decision"] as? String, "once")
        XCTAssertEqual((body?["result"] as? [String: Any])?["started"] as? Bool, true)
        let refusal = try JSONSerialization.jsonObject(with: JSONEncoder().encode(PhoneToolAnswer.denied)) as? [String: Any]
        XCTAssertNil(refusal?["result"])
    }

    func testPlainLocalWiFiOffersNothingAndRefusesWithAReason() throws {
        let ask = try wire(tool: "location", preApproved: true)
        XCTAssertNil(PhoneToolRules.transportRefusal(protectedTransport: true))
        let refusal = try XCTUnwrap(PhoneToolRules.transportRefusal(protectedTransport: false))
        XCTAssertTrue(refusal.contains("HTTPS or Tailscale"))
        XCTAssertEqual(PhoneToolAnswer.refused(refusal).decision, .deny)
        XCTAssertEqual(PhoneToolAnswer.refused(refusal).error, refusal)
        XCTAssertFalse(PhoneToolRules.runsWithoutCard(ask, appActive: true, offered: [.location], protectedTransport: false))
        XCTAssertTrue(PhoneToolRules.runsWithoutCard(ask, appActive: true, offered: [.location], protectedTransport: true))
        XCTAssertEqual(PhoneToolRules.transport(protectedTransport: false), "local")
        XCTAssertEqual(PhoneToolRules.transport(protectedTransport: true), "protected")
    }

    func testCreateCardsShowEveryFieldAndShortcutsTheirWholeInput() throws {
        let reminder = try wire(tool: "reminders", args: #"{"action":"create","title":"Pain","due":"2026-10-22T09:00:00Z","list":"Épicerie","notes":"blé entier"}"#)
        XCTAssertEqual(PhoneToolDetails.fields(reminder).map(\.key), ["title", "due", "list", "notes"])
        let event = try wire(tool: "calendar", args: #"{"action":"create","title":"Dentiste","start":"2026-10-22T09:00:00Z","end":"2026-10-22T10:00:00Z","location":"Laval","notes":"carte"}"#)
        XCTAssertEqual(PhoneToolDetails.fields(event).map(\.key), ["title", "start", "end", "location", "notes"])
        let long = String(repeating: "x", count: 900)
        let shortcut = try wire(tool: "shortcut", args: #"{"name":"Payer","input":"\#(long)"}"#)
        let rows = PhoneToolDetails.fields(shortcut)
        XCTAssertEqual(rows.map(\.key), ["name", "input"])
        XCTAssertEqual(rows.last?.value, long)
        XCTAssertTrue(PhoneToolDetails.warnsOfSideEffects(shortcut))
        XCTAssertFalse(PhoneToolDetails.warnsOfSideEffects(try wire(tool: "status")))
        XCTAssertTrue(PhoneToolDetails.fields(try wire(tool: "status")).isEmpty)
    }

    func testTheClipboardIsReadFirstAndShownBeforeItGoes() {
        XCTAssertEqual(PhoneToolDetails.clipboardPreview(nil), nil)
        XCTAssertEqual(PhoneToolDetails.clipboardPreview("court"), "court")
        let preview = PhoneToolDetails.clipboardPreview(String(repeating: "a", count: 500))
        XCTAssertEqual(preview?.count, 201)
        XCTAssertEqual(preview?.last, "…")
    }

    func testACardScanIsOnceOnlyAndSendsNoSecurityCode() throws {
        let scan = try wire(tool: "card_scan", allowAlways: true, preApproved: true)
        XCTAssertEqual(scan.tool, .cardScan)
        XCTAssertTrue(PhoneTool.cardScan.fromComputer)
        XCTAssertEqual(PhoneToolRules.choices(for: scan), [.deny, .once])
        XCTAssertFalse(PhoneToolRules.runsWithoutCard(scan, appActive: true, offered: [.cardScan]))
        let card = PhoneToolShaping.scannedCard(number: "4111 1111 1111 1111", expMonth: 9, expYear: 2029, holder: "MARIE TREMBLAY")
        XCTAssertEqual(card, .object(["number": .string("4111111111111111"), "expMonth": .number(9), "expYear": .number(2029), "holder": .string("MARIE TREMBLAY")]))
        XCTAssertEqual(PhoneToolShaping.scannedCard(number: "4111111111111111", expMonth: 13, expYear: nil, holder: nil).object?.keys.sorted(), ["number"])
        XCTAssertEqual(PhoneToolShaping.maskedNumber("4111111111111111"), "•••• 1111")
    }
}
