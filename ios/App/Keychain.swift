import CompanionCore

/// Main-app compatibility facade. The implementation lives in AppShared so
/// trusted extensions see the same credential rather than a target-private
/// keychain item.
enum Keychain {
    /// Save a token from a sign-in or a pairing as the one copy: the shared
    /// group the extensions read, written in place; then the app-private
    /// legacy copy and the copies of `duplicates` (other records of the same
    /// server) removed, so no stale token can be picked up later.
    static func save(_ token: String, for connectionId: String, removingDuplicates duplicates: [String] = []) throws {
        try CompanionCredentials.commit(
            token,
            for: connectionId,
            removingDuplicates: duplicates,
            in: SagaxKeychainSlots()
        )
    }

    /// Every other token this phone holds for these records, both groups,
    /// for a second chance after a 401. Never throws.
    static func candidates(for ids: [String], excluding current: String?) -> [CredentialCandidate] {
        CompanionCredentials.candidates(ids: ids, excluding: current, in: SagaxKeychainSlots())
    }

    /// The stored token: nil only when there genuinely is not one.
    ///
    /// The distinction between "no token" and "cannot read the token" matters
    /// far more than it looks. `SecItemCopyMatching` answers
    /// `errSecInteractionNotAllowed` while the keychain is unavailable — the
    /// window after a reboot before the phone's first unlock, which is exactly
    /// when iOS starts apps in the background. Folding that into nil made it
    /// indistinguishable from "this phone was never paired", so the app
    /// discarded a perfectly good connection and showed the pairing screen to
    /// someone who had done nothing but restart their phone. Getting back in
    /// means walking to the computer for a new code.
    ///
    /// So: `errSecItemNotFound` is the only nil. Everything else throws, and
    /// the caller decides whether to wait or to give up.
    static func token(for connectionId: String) throws -> String? {
        try SagaxSharedKeychain.tokenMigratingLegacyItem(for: connectionId)
    }

    @discardableResult
    static func remove(_ connectionId: String) -> Bool {
        SagaxSharedKeychain.removeIncludingLegacyItem(connectionId)
    }
}

typealias KeychainError = SagaxSharedKeychainError
