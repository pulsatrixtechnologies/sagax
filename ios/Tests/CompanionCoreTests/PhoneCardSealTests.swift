import CryptoKit
import XCTest
@testable import CompanionCore

final class PhoneCardSealTests: XCTestCase {
    // a fixed key; shared/phone-card-seal.test.ts pins the same values
    private let publicKey = "BI2XxkLkDjK8RYguiDPEwsWPmG2DGFkqlRSg0sVasL-HyW1-N_RIvm6cVQGadXeUWyolisP8qszBjBy_vjx_XPo"
    private let privateD = "KAM8s70VpviMD-zzoLeQybAjPCiPR1HGpN8kkOfjYvM"

    func testMatchesTheDesktop() throws {
        XCTAssertEqual(try PhoneCardSeal.keyId(publicKey), "aIOcqutt7r9OXgV4z50O1A")
        XCTAssertEqual(try PhoneCardSeal.matchCode(publicKey), "288033")
        XCTAssertEqual(String(decoding: PhoneCardSeal.authenticatedData(requestId: "req-1", keyId: "k"), as: UTF8.self), "sagax-phone-card-scan-v1\nreq-1\nk")
        XCTAssertThrowsError(try PhoneCardSeal.matchCode("AAAA"))
    }

    func testSealsForTheFormThatAskedOnlyAndNeverTheSecurityCode() throws {
        guard #available(macOS 14.0, iOS 17.0, *) else { throw XCTSkip("HPKE needs macOS 14") }
        let sealed = try PhoneCardSeal.seal(number: "4111 1111 1111 1111", expMonth: 9, expYear: 2029, holder: "ANN", publicKey: publicKey, requestId: "req-1")
        let row = try XCTUnwrap(sealed.object)
        XCTAssertFalse("\(row)".contains("4111"))
        let key = try P256.KeyAgreement.PrivateKey(rawRepresentation: XCTUnwrap(PhoneCardSeal.decode(privateD)))
        var recipient = try HPKE.Recipient(
            privateKey: key,
            ciphersuite: .P256_SHA256_AES_GCM_256,
            info: Data(PhoneCardSeal.info.utf8),
            encapsulatedKey: XCTUnwrap(PhoneCardSeal.decode(XCTUnwrap(row["encapsulatedKey"]?.string)))
        )
        let ciphertext = try XCTUnwrap(PhoneCardSeal.decode(XCTUnwrap(row["ciphertext"]?.string)))
        let opened = try recipient.open(ciphertext, authenticating: PhoneCardSeal.authenticatedData(requestId: "req-1", keyId: "aIOcqutt7r9OXgV4z50O1A"))
        XCTAssertEqual(String(decoding: opened, as: UTF8.self), #"{"expMonth":9,"expYear":2029,"holder":"ANN","number":"4111111111111111"}"#)
        // bound to the request: another request id does not open it
        var other = try HPKE.Recipient(privateKey: key, ciphersuite: .P256_SHA256_AES_GCM_256, info: Data(PhoneCardSeal.info.utf8),
                                       encapsulatedKey: XCTUnwrap(PhoneCardSeal.decode(XCTUnwrap(row["encapsulatedKey"]?.string))))
        XCTAssertThrowsError(try other.open(ciphertext, authenticating: PhoneCardSeal.authenticatedData(requestId: "req-2", keyId: "aIOcqutt7r9OXgV4z50O1A")))
        // the desktop opens what this phone sealed: shared/phone-card-seal.test.ts keeps one such envelope
        if ProcessInfo.processInfo.environment["PRINT_CARD_SEAL_FIXTURE"] == "1" {
            print("CARD_SEAL_FIXTURE \(row["encapsulatedKey"]!.string!) \(row["ciphertext"]!.string!)")
        }
    }

    func testRefusesABadKeyOrNumber() throws {
        guard #available(macOS 14.0, iOS 17.0, *) else { throw XCTSkip("HPKE needs macOS 14") }
        XCTAssertThrowsError(try PhoneCardSeal.seal(number: "4111111111111111", expMonth: nil, expYear: nil, holder: nil, publicKey: "AAAA", requestId: "r"))
        XCTAssertThrowsError(try PhoneCardSeal.seal(number: "41", expMonth: nil, expYear: nil, holder: nil, publicKey: publicKey, requestId: "r"))
    }
}
