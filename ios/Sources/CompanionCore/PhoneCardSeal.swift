import CryptoKit
import Foundation

// "Scanner avec l'iPhone" sealed end to end (JC 2026-10-21): the card read
// on this phone is encrypted for the computer's New card form that asked,
// with the one-time key that form made for this scan. The server relays an
// opaque envelope and never holds the number in clear. Same HPKE suite as
// PhoneSecret.swift (P-256, HKDF-SHA256, AES-256-GCM); wire contract with
// shared/phone-card-seal.ts: change both or neither.

public enum PhoneCardSealError: Error, Equatable, Sendable {
    case invalidKey
    case invalidCard
    case encryptionFailed
    case unavailable
}

public enum PhoneCardSeal {
    public static let info = "Sagax phone card scan v1"
    static let aadLabel = "sagax-phone-card-scan-v1"

    /// PhoneSecret's key id: the first 16 bytes of the key's SHA-256.
    public static func keyId(_ publicKey: String) throws -> String {
        guard PhoneSecretCrypto.normalizedPublicKey(publicKey) != nil else { throw PhoneCardSealError.invalidKey }
        return try PhoneSecretCrypto.publicKeyId(publicKey)
    }

    /// Six digits the form and the phone both show for this key: a pairing
    /// check that the right form and the right phone are talking, not an
    /// authentication (20 bits a malicious server could grind).
    public static func matchCode(_ publicKey: String) throws -> String {
        guard PhoneSecretCrypto.normalizedPublicKey(publicKey) != nil, let raw = decode(publicKey) else { throw PhoneCardSealError.invalidKey }
        let digest = Array(SHA256.hash(data: raw))
        let value = (UInt32(digest[16]) << 24) | (UInt32(digest[17]) << 16) | (UInt32(digest[18]) << 8) | UInt32(digest[19])
        return String(format: "%06u", value % 1_000_000)
    }

    public static func authenticatedData(requestId: String, keyId: String) -> Data {
        Data([aadLabel, requestId, keyId].joined(separator: "\n").utf8)
    }

    /// The card as the form reads it: the number, the expiry and the name.
    /// There is no security code here: it is never read and never sent.
    public static func plaintext(number: String, expMonth: Int?, expYear: Int?, holder: String?) throws -> Data {
        guard case let .object(row) = PhoneToolShaping.scannedCard(number: number, expMonth: expMonth, expYear: expYear, holder: holder),
              let digits = row["number"]?.string, (13...19).contains(digits.count)
        else { throw PhoneCardSealError.invalidCard }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(WidgetJSON.object(row))
    }

    /// The envelope the phone answers with: `{ encapsulatedKey, ciphertext }`.
    @available(iOS 17.0, macOS 14.0, *)
    public static func seal(number: String, expMonth: Int?, expYear: Int?, holder: String?, publicKey: String, requestId: String) throws -> WidgetJSON {
        guard let raw = decode(publicKey), PhoneSecretCrypto.normalizedPublicKey(publicKey) != nil,
              let key = try? P256.KeyAgreement.PublicKey(x963Representation: raw)
        else { throw PhoneCardSealError.invalidKey }
        let message = try plaintext(number: number, expMonth: expMonth, expYear: expYear, holder: holder)
        do {
            var sender = try HPKE.Sender(recipientKey: key, ciphersuite: .P256_SHA256_AES_GCM_256, info: Data(info.utf8))
            let ciphertext = try sender.seal(message, authenticating: authenticatedData(requestId: requestId, keyId: try keyId(publicKey)))
            return .object(["encapsulatedKey": .string(encode(sender.encapsulatedKey)), "ciphertext": .string(encode(ciphertext))])
        } catch {
            throw PhoneCardSealError.encryptionFailed
        }
    }

    static func encode(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    static func decode(_ value: String) -> Data? {
        var base64 = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        return Data(base64Encoded: base64)
    }
}
