import XCTest
@testable import CompanionCore

// Fake numbers only (Luhn-valid test numbers, never a real card).
final class VaultLoginCardTests: XCTestCase {
    func testAVaultLoginCardDecodesItsSite() throws {
        let json = """
        {"target":"vaultLogin","label":"Login for example.test","requestKey":"k1","vault":{"principalId":"local","domain":"example.test"}}
        """
        let secret = try JSONDecoder().decode(SecretRequestCardData.self, from: Data(json.utf8))
        XCTAssertTrue(VaultLoginCard.isVaultLogin(secret))
        XCTAssertEqual(secret.vault?.site, "example.test")
        let plain = try JSONDecoder().decode(SecretRequestCardData.self, from: Data(#"{"target":"OPENAI_API_KEY"}"#.utf8))
        XCTAssertFalse(VaultLoginCard.isVaultLogin(plain))
    }

    func testOnePasswordItemsShowANameAndAVaultNeverAnId() throws {
        let json = """
        {"available":true,"items":[{"vaultId":"vlt1","itemId":"aaaa1111","title":"Example work","vaultName":"Travail","domains":["example.test"]}]}
        """
        let list = try JSONDecoder().decode(VaultCardOnePasswordList.self, from: Data(json.utf8))
        XCTAssertTrue(list.available)
        XCTAssertEqual(list.items[0].label, "Example work · Travail")
        XCTAssertFalse(list.items[0].label.contains("aaaa1111"))
        let off = try JSONDecoder().decode(VaultCardOnePasswordList.self, from: Data(#"{"available":false}"#.utf8))
        XCTAssertTrue(off.items.isEmpty)
    }

    func testMatchingOffersTheSiteThenTheSameSiteNeverANote() throws {
        let json = """
        {"items":[
          {"id":"a1","kind":"login","name":"Portal","domains":["example.test"],"hasPassword":true,"hasNotes":false},
          {"id":"a2","kind":"login","name":"Admin","domains":["admin.example.test"],"hasPassword":true,"hasNotes":false},
          {"id":"a3","kind":"note","name":"Example note","domains":["example.test"],"hasPassword":false,"hasNotes":true},
          {"id":"a4","kind":"login","name":"Other","domains":["other.test"],"hasPassword":true,"hasNotes":false}
        ]}
        """
        let list = try JSONDecoder().decode(VaultList.self, from: Data(json.utf8))
        let matches = VaultLoginMatching.matching(list.items, request: VaultRequestPublic(domain: "example.test"))
        XCTAssertEqual(matches.map(\.id), ["a1", "a2"])
    }

    func testPreselectsOnlyAnExactHostNeverAnotherSubdomain() throws {
        let json = """
        {"items":[
          {"id":"a2","kind":"login","name":"Admin","domains":["admin.example.test"],"hasPassword":true,"hasNotes":false},
          {"id":"a1","kind":"login","name":"Portal","domains":["example.test"],"hasPassword":true,"hasNotes":false,"source":"1password"}
        ]}
        """
        let list = try JSONDecoder().decode(VaultList.self, from: Data(json.utf8))
        XCTAssertEqual(list.items[1].source, "1password")
        let request = VaultRequestPublic(domain: "example.test")
        let matches = VaultLoginMatching.matching(list.items, request: request)
        XCTAssertEqual(VaultLoginMatching.preselected(saved: matches, onePassword: [], request: request), "a1")
        let other = VaultLoginMatching.matching([list.items[0]], request: request)
        XCTAssertNil(VaultLoginMatching.preselected(saved: other, onePassword: [], request: request))
    }
}

final class CardScanReadingTests: XCTestCase {
    private let now = ISO8601DateFormatter().date(from: "2026-10-21T12:00:00Z")!

    func testReadsTheNumberTheExpiryAndTheName() {
        let lines = ["BANQUE EXEMPLE", "4242 4242 4242 4242", "MEMBER SINCE 03/19", "VALID THRU 08/29", "ADA LOVELACE", "VISA"]
        let result = CardScanReading.read(lines: lines, now: now)
        XCTAssertEqual(result.pan, "4242424242424242")
        XCTAssertEqual(result.expMonth, 8)
        XCTAssertEqual(result.expYear, 2029)
        XCTAssertEqual(result.holder, "ADA LOVELACE")
    }

    func testRefusesANumberThatFailsLuhnAndAnImpossibleDate() {
        let result = CardScanReading.read(lines: ["4242 4242 4242 4241", "13/29", "05/1999"], now: now)
        XCTAssertNil(result.pan)
        XCTAssertNil(result.expMonth)
    }

    func testABackPhotoFillsOnlyWhatTheFrontMissed() {
        let front = CardScanReading.read(lines: ["5555 5555 5555 4444", "JEAN TREMBLAY"], now: now)
        let back = CardScanReading.read(lines: ["12/2030", "AUTHORIZED SIGNATURE"], now: now)
        let merged = front.merged(with: back)
        XCTAssertEqual(merged.pan, "5555555555554444")
        XCTAssertEqual(merged.holder, "JEAN TREMBLAY")
        XCTAssertEqual(merged.expMonth, 12)
        XCTAssertEqual(merged.expYear, 2030)
    }

    func testReadsOnlyAsciiDigits() {
        // Arabic-Indic digits that would spell a Luhn-valid number
        let result = CardScanReading.read(lines: ["٤٢٤٢ ٤٢٤٢ ٤٢٤٢ ٤٢٤٢"], now: now)
        XCTAssertNil(result.pan)
    }

    func testLuhn() {
        XCTAssertTrue(CardScanReading.luhnValid("4242424242424242"))
        XCTAssertFalse(CardScanReading.luhnValid("4242424242424241"))
        XCTAssertFalse(CardScanReading.luhnValid("4242"))
    }
}
