// App Attest (DeviceCheck): the phone proves to the Sagax server it signed in
// to that a request comes from this app on a genuine device. A key lives in
// the Secure Enclave; the server checks Apple's attestation of it once, then
// an assertion on each sign-in and token refresh (server/routes/app-attest.ts).
//
// Log only, never a lock: a device that cannot attest (simulator, old
// hardware), a server that does not know the routes, or a check that fails
// leaves the app working exactly as before. This type never throws.
import CryptoKit
import Foundation

/// The platform side (DCAppAttestService), behind a protocol so the flow is
/// testable without a device.
public protocol AppAttestProvider: Sendable {
    var isSupported: Bool { get }
    func generateKey() async throws -> String
    func attestKey(_ keyId: String, clientDataHash: Data) async throws -> Data
    func generateAssertion(_ keyId: String, clientDataHash: Data) async throws -> Data
}

/// The server side, implemented by `CompanionClient`.
public protocol AppAttestServer: Sendable {
    func appAttestChallenge() async throws -> String?
    func registerAttestation(keyId: String, attestation: Data, challenge: String, appVersion: String, deviceName: String) async throws -> AppAttestAnswer
    func assertAttestation(keyId: String, assertion: Data, challenge: String) async throws -> AppAttestAnswer
}

public struct AppAttestAnswer: Decodable, Equatable, Sendable {
    public var configured: Bool?
    public var challenge: String?
    public var ok: Bool?
    public var reason: String?
}

/// The key id this phone attested with, per server connection. A key can be
/// attested once, so a second server gets its own key.
public protocol AppAttestKeyStore: AnyObject {
    func keyId(for connectionID: String) -> String?
    func setKeyId(_ keyId: String?, for connectionID: String)
}

public final class UserDefaultsAppAttestKeyStore: AppAttestKeyStore, @unchecked Sendable {
    private let defaults: UserDefaults
    public init(defaults: UserDefaults = .standard) { self.defaults = defaults }
    private func name(_ id: String) -> String { "sagax.appAttest.keyId.\(id)" }
    public func keyId(for connectionID: String) -> String? { defaults.string(forKey: name(connectionID)) }
    public func setKeyId(_ keyId: String?, for connectionID: String) {
        if let keyId { defaults.set(keyId, forKey: name(connectionID)) } else { defaults.removeObject(forKey: name(connectionID)) }
    }
}

public enum AppAttestOutcome: Equatable, Sendable {
    /// Simulator or old device: nothing to do.
    case unsupported
    /// The server has no App Attest (older server or no team id).
    case notConfigured
    case attested
    case asserted
    /// The check did not hold, or could not be made; the app works anyway.
    case failed(String)
}

public struct AppAttestFlow: Sendable {
    public let provider: AppAttestProvider
    public let server: AppAttestServer
    public let appVersion: String
    public let deviceName: String

    public init(provider: AppAttestProvider, server: AppAttestServer, appVersion: String, deviceName: String) {
        self.provider = provider
        self.server = server
        self.appVersion = String(appVersion.prefix(40))
        self.deviceName = String(deviceName.prefix(80))
    }

    /// What the app hashes as clientData: the challenge itself.
    public static func clientDataHash(challenge: String) -> Data {
        Data(SHA256.hash(data: Data(challenge.utf8)))
    }

    public func run(connectionID: String, keys: AppAttestKeyStore) async -> AppAttestOutcome {
        guard provider.isSupported else { return .unsupported }
        do {
            if let keyId = keys.keyId(for: connectionID) {
                guard let challenge = try await server.appAttestChallenge() else { return .notConfigured }
                do {
                    let assertion = try await provider.generateAssertion(keyId, clientDataHash: Self.clientDataHash(challenge: challenge))
                    let answer = try await server.assertAttestation(keyId: keyId, assertion: assertion, challenge: challenge)
                    if answer.ok == true { return .asserted }
                    if answer.configured == false { return .notConfigured }
                    // the server forgot this key (a new server data folder, another person): attest a fresh one
                    if answer.reason == "unknown_key" { keys.setKeyId(nil, for: connectionID) } else { return .failed(answer.reason ?? "assertion") }
                } catch {
                    // the key is gone from the Secure Enclave (invalidKey): attest a fresh one
                    keys.setKeyId(nil, for: connectionID)
                }
            }
            guard let challenge = try await server.appAttestChallenge() else { return .notConfigured }
            let keyId = try await provider.generateKey()
            let attestation = try await provider.attestKey(keyId, clientDataHash: Self.clientDataHash(challenge: challenge))
            let answer = try await server.registerAttestation(keyId: keyId, attestation: attestation, challenge: challenge, appVersion: appVersion, deviceName: deviceName)
            if answer.ok == true {
                keys.setKeyId(keyId, for: connectionID)
                return .attested
            }
            return answer.configured == false ? .notConfigured : .failed(answer.reason ?? "attestation")
        } catch {
            return .failed(String(describing: type(of: error)))
        }
    }
}

private struct AttestChallengeBody: Encodable {}
private struct AttestRegisterBody: Encodable {
    var keyId: String
    var attestation: String
    var challenge: String
    var appVersion: String
    var deviceName: String
}
private struct AttestAssertBody: Encodable {
    var keyId: String
    var assertion: String
    var challenge: String
}

extension CompanionClient: AppAttestServer {
    func appAttestRequest(_ action: String, body: some Encodable) throws -> URLRequest {
        try makeRequest("POST", "/api/attest/\(action)", encodedBody: body)
    }

    public func appAttestChallenge() async throws -> String? {
        let answer = try await send(appAttestRequest("challenge", body: AttestChallengeBody()), as: AppAttestAnswer.self)
        return answer.configured == true ? answer.challenge : nil
    }

    public func registerAttestation(keyId: String, attestation: Data, challenge: String, appVersion: String, deviceName: String) async throws -> AppAttestAnswer {
        let body = AttestRegisterBody(keyId: keyId, attestation: attestation.base64EncodedString(), challenge: challenge, appVersion: appVersion, deviceName: deviceName)
        return try await send(appAttestRequest("register", body: body), as: AppAttestAnswer.self)
    }

    public func assertAttestation(keyId: String, assertion: Data, challenge: String) async throws -> AppAttestAnswer {
        let body = AttestAssertBody(keyId: keyId, assertion: assertion.base64EncodedString(), challenge: challenge)
        return try await send(appAttestRequest("assert", body: body), as: AppAttestAnswer.self)
    }
}
