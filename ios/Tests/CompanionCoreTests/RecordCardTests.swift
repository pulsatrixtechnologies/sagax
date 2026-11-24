// Record cards (#4572, lot S3): the phone's parser against the vectors the web
// app's parser is checked with (shared/record-card-vectors.json), then the
// links, the products that may open and the way times are worded.
import XCTest
@testable import CompanionCore

final class RecordCardTests: XCTestCase {
    private struct Vectors {
        var cards: [[String: Any]]
        var answers: [[String: Any]]
        var links: [[String: Any]]
        var texts: [[String: Any]]
    }

    private func vectors() throws -> Vectors {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("shared/record-card-vectors.json")
        let data = try Data(contentsOf: url)
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        func list(_ key: String) throws -> [[String: Any]] { try XCTUnwrap(root[key] as? [[String: Any]]) }
        return Vectors(cards: try list("cards"), answers: try list("answers"), links: try list("links"), texts: try list("texts"))
    }

    /// What the model encodes, as the JSON a client would read back.
    private func wire<T: Encodable>(_ value: T?) throws -> Any {
        guard let value else { return NSNull() }
        return try JSONSerialization.jsonObject(with: JSONEncoder().encode(value), options: [.fragmentsAllowed])
    }

    private func same(_ a: Any, _ b: Any, _ name: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue((a as AnyObject).isEqual(b), "\(name)\nswift: \(a)\nvector: \(b)", file: file, line: line)
    }

    func testCardsMatchTheVectors() throws {
        let all = try vectors().cards
        XCTAssertGreaterThan(all.count, 30)
        for entry in all {
            let name = entry["name"] as? String ?? "?"
            let parsed = RecordCardParser.parse(entry["raw"] is NSNull ? nil : entry["raw"])
            same(try wire(parsed), entry["expected"] ?? NSNull(), "card: \(name)")
        }
    }

    func testAnswersMatchTheVectors() throws {
        for entry in try vectors().answers {
            let name = entry["name"] as? String ?? "?"
            let answer = RecordCardParser.parseAnswer(entry["raw"] is NSNull ? nil : entry["raw"])
            let encoded: Any
            switch answer {
            case let .card(card): encoded = ["card": try wire(card)]
            case let .miss(miss): encoded = try wire(miss)
            }
            // the TypeScript answer for a card is `{ card }`; a miss is its own object
            same(encoded, entry["expected"] ?? NSNull(), "answer: \(name)")
        }
    }

    func testLinksMatchTheVectors() throws {
        for entry in try vectors().links {
            let name = entry["name"] as? String ?? "?"
            let parsed = RecordLinks.parse(try XCTUnwrap(entry["href"] as? String))
            same(try wire(parsed), entry["expected"] ?? NSNull(), "link: \(name)")
        }
    }

    func testTextsMatchTheVectors() throws {
        for entry in try vectors().texts {
            let name = entry["name"] as? String ?? "?"
            XCTAssertEqual(RecordLinks.withoutLinks(try XCTUnwrap(entry["text"] as? String)), entry["expected"] as? String, name)
        }
    }

    func testMarkdownMatchesTheDesktopLink() {
        let ref = RecordRef(product: "nimbus_desk", kind: "bill", id: "88213")
        XCTAssertEqual(RecordLinks.link(ref), "sagax://record/nimbus_desk/bill/88213")
        XCTAssertEqual(RecordLinks.markdown(label: "BILL-20417", ref: ref), "[BILL-20417](sagax://record/nimbus_desk/bill/88213)")
        XCTAssertEqual(RecordLinks.markdown(label: "  A [note]  ", ref: ref), "[A \\[note\\]](sagax://record/nimbus_desk/bill/88213)")
        XCTAssertEqual(RecordLinks.parse(RecordLinks.link(ref)), ref)
    }

    func testChipTextIsTheLinkedCopyOnlyWhileItIsTheSameMessage() {
        let linked = "Voir [BILL-1](sagax://record/nimbus_desk/bill/1)."
        XCTAssertEqual(RecordLinks.chipText(text: "Voir BILL-1.", recordText: linked), linked)
        XCTAssertEqual(RecordLinks.chipText(text: "Autre chose.", recordText: linked), "Autre chose.")
        XCTAssertEqual(RecordLinks.chipText(text: "Rien.", recordText: nil), "Rien.")
        XCTAssertNil(RecordLinks.chipText(text: nil, recordText: nil))
    }

    // MARK: the products that may open

    func testARecordOpensOnlyWhenThePersonHoldsItsProductAndKind() throws {
        let body: [String: Any] = ["products": [
            ["id": "nimbus_desk", "name": "Nimbus Desk", "records": [
                ["kind": "bill", "name": ["en": "Bill", "fr": "Facture"]],
                ["kind": "contract", "name": ["en": "Contract"]],
            ]],
            ["id": "other_tool", "name": "Other", "records": []],
        ]]
        let products = RecordProducts.parse(body, language: "fr")
        XCTAssertTrue(products.canOpen(RecordRef(product: "nimbus_desk", kind: "bill", id: "1")))
        XCTAssertFalse(products.canOpen(RecordRef(product: "nimbus_desk", kind: "device", id: "1")))
        XCTAssertFalse(products.canOpen(RecordRef(product: "other_tool", kind: "bill", id: "1")))
        XCTAssertFalse(products.canOpen(RecordRef(product: "not_held", kind: "bill", id: "1")))
        XCTAssertEqual(products.kindName(RecordRef(product: "nimbus_desk", kind: "bill", id: "1")), "Facture")
        XCTAssertEqual(products.kindName(RecordRef(product: "nimbus_desk", kind: "contract", id: "1")), "Contract")
    }

    // MARK: times

    private func date(_ iso: String) -> Date { RecordCardFormat.instant(iso)! }

    func testACalendarDayIsNeverShiftedByAZone() {
        let now = date("2026-11-17T12:00:00Z")
        for tz in ["Pacific/Auckland", "America/Los_Angeles", "UTC"] {
            XCTAssertEqual(RecordCardFormat.absolute("2026-11-25", now: now, lang: "en", tz: tz), RecordCardFormat.absolute("2026-11-25", now: now, lang: "en", tz: "UTC"), tz)
        }
        XCTAssertTrue(RecordCardFormat.absolute("2026-11-25", now: now, lang: "en", tz: "America/Toronto").contains("25"))
    }

    func testADueDayIsLateOnceItIsOverInTheCardsZone() {
        // 2026-11-06 02:00 UTC is still the 5th in Toronto
        let eveningOfTheFifth = date("2026-11-06T02:00:00Z")
        XCTAssertNil(RecordCardFormat.lateness("2026-11-05", now: eveningOfTheFifth, lang: "en", tz: "America/Toronto"))
        XCTAssertNotNil(RecordCardFormat.lateness("2026-11-05", now: eveningOfTheFifth, lang: "en", tz: "UTC"))
        let theSixth = date("2026-11-06T15:00:00Z")
        XCTAssertNotNil(RecordCardFormat.lateness("2026-11-05", now: theSixth, lang: "fr", tz: "America/Toronto"))
        XCTAssertNil(RecordCardFormat.lateness("2026-11-20T10:00:00-05:00", now: theSixth, lang: "en", tz: nil))
    }

    func testTodayAndYesterdayAreWordsNotDates() {
        let now = date("2026-11-17T15:00:00Z")
        let today = RecordCardFormat.absolute("2026-11-17", now: now, lang: "en", tz: "America/Toronto")
        let yesterday = RecordCardFormat.absolute("2026-11-16", now: now, lang: "en", tz: "America/Toronto")
        XCTAssertEqual(today, "today")
        XCTAssertEqual(yesterday, "yesterday")
        XCTAssertEqual(RecordCardFormat.absolute("2026-11-18", now: now, lang: "fr", tz: "America/Toronto"), "demain")
    }

    func testAGuidIsNeverALabel() {
        XCTAssertTrue(RecordCardFormat.isGuid("123e4567-e89b-12d3-a456-426614174000"))
        XCTAssertTrue(RecordCardFormat.isGuid("{123E4567-E89B-12D3-A456-426614174000}"))
        XCTAssertFalse(RecordCardFormat.isGuid("BILL-20417"))
    }
}
