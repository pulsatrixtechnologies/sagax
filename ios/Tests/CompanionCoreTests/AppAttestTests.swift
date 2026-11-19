// App Attest on the phone: the flow never throws and never blocks the app.
import Foundation
import XCTest
@testable import CompanionCore

private struct FakeProvider: AppAttestProvider {
    var isSupported = true
    var assertionFails = false
    func generateKey() async throws -> String { "key-new" }
    func attestKey(_ keyId: String, clientDataHash: Data) async throws -> Data { Data([1, 2]) }
    func generateAssertion(_ keyId: String, clientDataHash: Data) async throws -> Data {
        if assertionFails { throw NSError(domain: "DCError", code: 3) }
        return Data([3])
    }
}

private final class FakeServer: AppAttestServer, @unchecked Sendable {
    var challenge: String? = "challenge-abcdefghijkl"
    var registerAnswer = AppAttestAnswer(ok: true)
    var assertAnswer = AppAttestAnswer(ok: true)
    var calls: [String] = []
    func appAttestChallenge() async throws -> String? { calls.append("challenge"); return challenge }
    func registerAttestation(keyId: String, attestation: Data, challenge: String, appVersion: String, deviceName: String) async throws -> AppAttestAnswer { calls.append("register"); return registerAnswer }
    func assertAttestation(keyId: String, assertion: Data, challenge: String) async throws -> AppAttestAnswer { calls.append("assert"); return assertAnswer }
}

private final class MemoryKeys: AppAttestKeyStore {
    var ids: [String: String] = [:]
    func keyId(for connectionID: String) -> String? { ids[connectionID] }
    func setKeyId(_ keyId: String?, for connectionID: String) { ids[connectionID] = keyId }
}

final class AppAttestTests: XCTestCase {
    private func flow(_ provider: FakeProvider, _ server: FakeServer) -> AppAttestFlow {
        AppAttestFlow(provider: provider, server: server, appVersion: "1.0 (1)", deviceName: "Phone")
    }

    func testAnUnsupportedDeviceDoesNothing() async {
        let server = FakeServer()
        let outcome = await flow(FakeProvider(isSupported: false), server).run(connectionID: "c", keys: MemoryKeys())
        XCTAssertEqual(outcome, .unsupported)
        XCTAssertEqual(server.calls, [])
    }

    func testTheFirstRunAttestsAndKeepsTheKeyThenAssertsAfterwards() async {
        let server = FakeServer(); let keys = MemoryKeys()
        let f = flow(FakeProvider(), server)
        let first = await f.run(connectionID: "c", keys: keys)
        XCTAssertEqual(first, .attested)
        XCTAssertEqual(keys.keyId(for: "c"), "key-new")
        server.calls = []
        let second = await f.run(connectionID: "c", keys: keys)
        XCTAssertEqual(second, .asserted)
        XCTAssertEqual(server.calls, ["challenge", "assert"])
    }

    func testAServerWithoutAppAttestIsLeftAlone() async {
        let server = FakeServer(); server.challenge = nil
        let keys = MemoryKeys()
        let outcome = await flow(FakeProvider(), server).run(connectionID: "c", keys: keys)
        XCTAssertEqual(outcome, .notConfigured)
        XCTAssertNil(keys.keyId(for: "c"))
    }

    func testARefusedAttestationKeepsNoKeyAndNeverThrows() async {
        let server = FakeServer(); server.registerAnswer = AppAttestAnswer(ok: false, reason: "attestation")
        let keys = MemoryKeys()
        let outcome = await flow(FakeProvider(), server).run(connectionID: "c", keys: keys)
        XCTAssertEqual(outcome, .failed("attestation"))
        XCTAssertNil(keys.keyId(for: "c"))
    }

    func testAKeyTheServerForgotOrTheEnclaveLostIsReplaced() async {
        let server = FakeServer(); server.assertAnswer = AppAttestAnswer(ok: false, reason: "unknown_key")
        let keys = MemoryKeys(); keys.ids["c"] = "key-old"
        let replaced = await flow(FakeProvider(), server).run(connectionID: "c", keys: keys)
        XCTAssertEqual(replaced, .attested)
        XCTAssertEqual(keys.keyId(for: "c"), "key-new")
        keys.ids["d"] = "key-gone"
        let lost = await flow(FakeProvider(assertionFails: true), FakeServer()).run(connectionID: "d", keys: keys)
        XCTAssertEqual(lost, .attested)
        XCTAssertEqual(keys.keyId(for: "d"), "key-new")
    }

    func testTheClientDataHashIsTheSha256OfTheChallenge() {
        // sha256("abc")
        XCTAssertEqual(AppAttestFlow.clientDataHash(challenge: "abc").map { String(format: "%02x", $0) }.joined(),
                       "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    }
}
